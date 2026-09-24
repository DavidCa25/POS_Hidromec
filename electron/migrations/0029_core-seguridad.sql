/* ============================================================
   0029 — core seguridad

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0029_core-seguridad.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0029_core-seguridad.sql ========== */
/* ============================================================
   0029 — Las dos marcas que necesita la sesion.

   Sin tablas nuevas. Los permisos viven en el binario -un permiso es
   parte del producto, no un dato del negocio- y el rol de cada persona ya
   esta en `users.rol`.

   NO se anade CHECK a `users.rol`. Una migracion que falle sobre la base
   de un cliente por un valor inesperado es peor que el valor inesperado:
   el codigo trata lo desconocido como "sin rol asignado", con cero
   paquetes, y un administrador lo resuelve desde la pantalla.
   ============================================================ */

/* ------------------------------------------- LA TABLA TIENE QUE EXISTIR

   `database_metadata` la crea el BASELINE, es decir el punto de partida de
   toda base instalada desde el template. Pero una instalacion que lleva anos
   migrando nacio ANTES del baseline y nunca paso por el: no la tiene.

   Esta migracion la daba por hecha y el arranque moria con
   «Invalid object name 'dbo.database_metadata'» antes de abrir ninguna
   ventana. Una migracion no puede suponer nada del estado previo: la
   plantilla de hoy no es la base de un cliente de hace dos anos.

   La definicion es la MISMA que la del baseline, a proposito: dos formas de
   la misma tabla segun por donde se entre es exactamente el problema que se
   esta arreglando. */
IF OBJECT_ID(N'dbo.database_metadata', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.database_metadata (
        clave          NVARCHAR(64)  NOT NULL CONSTRAINT PK_database_metadata PRIMARY KEY,
        valor          NVARCHAR(255) NOT NULL,
        actualizado_en DATETIME2(0)  NOT NULL CONSTRAINT DF_database_metadata_actualizado_en DEFAULT SYSDATETIME()
    );
END;
GO

/* security_model_version
     Que interpretacion de los roles entiende el binario. Una caja cuyo
     numero sea MENOR que el de la base no puede administrar modulos:
     interpretaria los permisos con reglas viejas, y en MultiCaja eso
     significa que la misma persona tendria permisos distintos segun la
     caja donde entre. */
IF NOT EXISTS (SELECT 1 FROM dbo.database_metadata WHERE clave = 'security_model_version')
    INSERT INTO dbo.database_metadata (clave, valor) VALUES ('security_model_version', '1');
GO

/* security_revision
     Sube cuando cambia un rol o el estado activo de alguien. Las sesiones
     abiertas comparan contra ella y recalculan. Sin esto, un permiso
     retirado desde otra caja seguiria vivo hasta cerrar sesion: en un
     turno de ocho horas, una tarde entera. */
IF NOT EXISTS (SELECT 1 FROM dbo.database_metadata WHERE clave = 'security_revision')
    INSERT INTO dbo.database_metadata (clave, valor) VALUES ('security_revision', '1');
GO

/* ---------- sp_authorize_supervisor (SQL_STORED_PROCEDURE) ---------- */
/* sp_authorize_supervisor
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Comprueba la identidad de quien autoriza una operacion sensible.
 *
 * QUE CAMBIO Y POR QUE
 * --------------------
 * Antes filtraba por `rol IN ('admin','supervisor')`. Eso congelaba el modelo
 * viejo dentro de SQL: cualquier rol nuevo habria obligado a tocar este
 * procedimiento, y la pregunta que de verdad se hace -"¿esta persona puede
 * autorizar ESTA operacion?"- no es sobre su rol sino sobre el paquete que la
 * operacion exige.
 *
 * Ahora solo responde a lo que SQL puede responder de verdad: si las
 * credenciales son correctas y quien es esa persona. QUIEN PUEDE AUTORIZAR lo
 * decide el proceso principal con el catalogo de paquetes, que viaja en el
 * binario junto a las acciones que protege.
 *
 * LO QUE NO CAMBIA
 * ----------------
 * Que la contrasena se valide aqui, contra el hash de la base. Y que esto
 * siga existiendo aunque el paquete se pueda dar por rol: su valor no es
 * tecnico sino disuasorio. Nacio contra el robo hormiga, y que un cajero tenga que llamar
 * al encargado deja un rastro con nombre y hora que un permiso silencioso no
 * deja.
 */
CREATE OR ALTER PROCEDURE dbo.sp_authorize_supervisor
    @usuario NVARCHAR(50), @password NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @id INT, @rol NVARCHAR(20), @nombre NVARCHAR(50);

    SELECT TOP 1 @id = id, @nombre = usuario, @rol = rol
    FROM dbo.users
    WHERE usuario = @usuario
      AND active = 1
      AND password_hash = CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256', @password), 2);

    IF @id IS NULL RETURN;      -- sin filas: credenciales incorrectas

    SELECT @id AS id, @nombre AS usuario, @rol AS rol;
END
GO

/* ---------- sp_bump_security_revision (SQL_STORED_PROCEDURE) ---------- */
/* sp_bump_security_revision
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Invalida las sesiones abiertas de TODAS las cajas.
 *
 * Se llama cuando cambia algo que altera lo que alguien puede hacer: su rol o
 * su estado activo. Las sesiones no se cierran: la proxima accion sensible
 * recalcula permisos contra la base.
 *
 * Es un contador global y no uno por usuario a proposito. Un cambio de
 * permisos ocurre unas pocas veces al ano en un negocio pequeno, y que
 * recalculen todas las sesiones cuesta una consulta diminuta por maquina.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_bump_security_revision]
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.database_metadata WHERE clave = 'security_revision')
        INSERT INTO dbo.database_metadata (clave, valor) VALUES ('security_revision', '1');

    UPDATE dbo.database_metadata
       SET valor = CONVERT(NVARCHAR(255), CONVERT(INT, valor) + 1),
           actualizado_en = SYSDATETIME()
     WHERE clave = 'security_revision';

    SELECT CONVERT(INT, valor) AS security_revision
      FROM dbo.database_metadata WHERE clave = 'security_revision';
END
GO

/* ---------- sp_get_security_state (SQL_STORED_PROCEDURE) ---------- */
/* sp_get_security_state
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* El estado de seguridad de la base, en una sola consulta barata.
 *
 * `security_revision` la leen las sesiones abiertas para saber si sus
 * permisos siguen siendo validos; se consulta a lo sumo cada pocos segundos
 * por maquina, no en cada accion.
 *
 * `security_model_version` la compara el binario al arrancar: si la base va
 * por delante, esta caja no sabe interpretar los permisos vigentes.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_get_security_state]
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        CONVERT(INT, ISNULL((SELECT valor FROM dbo.database_metadata
                              WHERE clave = 'security_revision'), '1')) AS security_revision,
        CONVERT(INT, ISNULL((SELECT valor FROM dbo.database_metadata
                              WHERE clave = 'security_model_version'), '1')) AS security_model_version;
END
GO
