/* ============================================================
   0032 — servicios giro

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0032_servicios-giro.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0032_servicios-giro.sql ========== */
/* ============================================================
   0032 — El giro del modulo Servicios.

   UNA SOLA COSA: recordar que clase de negocio de servicios es este, para
   que el modulo se presente como corresponde —que pestana abre, como se
   llama aqui la cosa sobre la que se trabaja— desde el primer dia y no
   despues de que alguien lo configure a mano.

   POR QUE UNA TABLA PROPIA Y NO UNA COLUMNA EN business_config
   ------------------------------------------------------------
   Lo dice la propia 0028 al crear el registro de modulos: «sin columna
   config: un JSON generico acaba siendo el sitio donde cae todo lo que
   nadie quiso modelar. El modulo que necesite configuracion tendra su
   tabla». Esta es la de Servicios. business_config es del NEGOCIO —su
   nombre, su direccion, su ticket—; el giro es del MODULO, y un negocio
   que apague Servicios no deberia arrastrar una columna suya para siempre.

   POR QUE EL CATALOGO DE GIROS NO ESTA AQUI
   -----------------------------------------
   Solo se guarda el identificador elegido. Que enciende cada giro, como se
   llama y que ejemplos da vive en electron/servicios/presets.json, que es
   lo que leen la interfaz, el proceso principal y el gestor de demos. Si
   estuviera tambien aqui habria dos catalogos, y el de la base solo se
   actualizaria con una migracion: el dia que se anada un giro, las
   instalaciones viejas lo rechazarian por no conocerlo.

   Y POR QUE NO HAY CHECK CONSTRAINT CONTRA UNA LISTA
   ---------------------------------------------------
   Por lo mismo. Un CHECK con los cinco giros de hoy convierte anadir el
   sexto en una migracion obligatoria para todo el parque. La lista valida
   la comprueba el proceso principal contra el JSON, que es donde puede
   cambiar sin romper nada.

   Todo idempotente. Una instalacion que actualice no ve ninguna diferencia:
   sin fila, el modulo se comporta exactamente como se comportaba.
   ============================================================ */

IF OBJECT_ID(N'dbo.services_config', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.services_config (
        /* Una sola fila, siempre. El CHECK lo garantiza sin depender de que
           nadie se equivoque: no es una tabla de catalogo, es la
           configuracion del modulo para ESTE negocio. */
        id          TINYINT       NOT NULL CONSTRAINT PK_services_config PRIMARY KEY
                                  CONSTRAINT CK_services_config_fila_unica CHECK (id = 1),
        preset      NVARCHAR(40)  COLLATE Modern_Spanish_CI_AS NOT NULL,
        set_at      DATETIME2(0)  NOT NULL CONSTRAINT DF_services_config_set_at DEFAULT (SYSDATETIME()),
        set_by      INT           NULL
    );
END;
GO

IF OBJECT_ID(N'dbo.FK_services_config_user', 'F') IS NULL
   AND OBJECT_ID(N'dbo.services_config', 'U') IS NOT NULL
ALTER TABLE dbo.services_config WITH NOCHECK
  ADD CONSTRAINT FK_services_config_user FOREIGN KEY (set_by) REFERENCES dbo.users (id);
GO

/* ------------------------------------------------- nada que sembrar

   A proposito. La fila ausente significa «este negocio no ha elegido giro»,
   y eso es verdad en toda instalacion que venga de antes: encendio Servicios
   cuando los giros no existian. Sembrar 'OTRO' aqui seria escribirle una
   decision que no tomo, y ademas le quitaria al producto la unica forma de
   distinguir «eligio el generico» de «no ha elegido». La interfaz resuelve
   la ausencia con el mismo comportamiento de siempre. */
GO

/* ---------- sp_get_services_config (SQL_STORED_PROCEDURE) ---------- */
/* sp_get_services_config
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* El giro de Servicios de este negocio.
 *
 * Devuelve SIEMPRE una fila, aunque nadie haya elegido nada: con `preset` en
 * NULL. Devolver cero filas obligaria a cada sitio que lo lee a distinguir
 * «no hay fila» de «hay fila vacia», y esa es la clase de diferencia que
 * alguien acaba olvidando en uno de los sitios.
 *
 * `preset` en NULL significa «este negocio no ha elegido giro»: es lo que
 * tiene toda instalacion que encendio Servicios antes de que los giros
 * existieran. No es un error ni un estado a medias, y la interfaz lo resuelve
 * presentando el modulo como se presentaba entonces.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_get_services_config]
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        c.preset,
        c.set_at,
        c.set_by,
        u.usuario AS set_by_name
      FROM (SELECT 1 AS id) AS uno
      LEFT JOIN dbo.services_config AS c ON c.id = uno.id
      LEFT JOIN dbo.users           AS u ON u.id = c.set_by;
END
GO

/* ---------- sp_set_services_preset (SQL_STORED_PROCEDURE) ---------- */
/* sp_set_services_preset
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Guarda el giro de Servicios, y enciende el modulo en el mismo movimiento.
 *
 * LAS DOS COSAS JUNTAS, O NINGUNA
 * -------------------------------
 * Elegir giro y encender Servicios son una sola decision de quien la toma
 * -«mi negocio es un taller»- y separarlas deja dos estados a medias que hay
 * que explicar despues: el modulo encendido sin giro, y el giro guardado con
 * el modulo apagado. Por eso van en la misma transaccion y por eso este
 * procedimiento llama al del registro de modulos en vez de tener su propia
 * copia del MERGE: el registro sigue teniendo un unico sitio donde se
 * escribe.
 *
 * LO QUE NO VALIDA
 * ----------------
 * Que el giro exista. La lista de giros vive en electron/servicios/presets.json
 * y la comprueba el proceso principal antes de llamar aqui. Repetirla en un
 * CHECK convertiria anadir un giro en una migracion obligatoria para todo el
 * parque instalado, y el sexto giro no deberia costar eso. Lo que si se
 * exige es que venga algo: una cadena vacia no es una eleccion.
 *
 * NO BORRA NADA. Cambiar de giro cambia como se presenta el modulo -que
 * pestana abre, como se llama aqui un coche o una laptop- y no toca ni una
 * orden, ni un cliente, ni un activo. Un taller que se reinvente como taller
 * de electronicos conserva todo su historial.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_set_services_preset]
    @preset  NVARCHAR(40),
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @preset = UPPER(LTRIM(RTRIM(ISNULL(@preset, ''))));
    IF @preset = ''
    BEGIN
        RAISERROR('Falta el giro de Servicios.', 16, 1);
        RETURN;
    END

    BEGIN TRAN;

    MERGE dbo.services_config AS d
    USING (SELECT 1 AS id) AS s
       ON d.id = s.id
     WHEN MATCHED THEN
          UPDATE SET preset = @preset, set_at = SYSDATETIME(), set_by = @user_id
     WHEN NOT MATCHED THEN
          INSERT (id, preset, set_at, set_by) VALUES (1, @preset, SYSDATETIME(), @user_id);

    /* El modulo, por su propia puerta. Encender Servicios escribe en
       `business_modules` y en ningun otro sitio, y ese procedimiento es el
       unico que sabe hacerlo bien -incluido el espejo a las columnas
       antiguas-. Duplicar aqui el MERGE habria sido tener dos formas de
       encender un modulo, y la de Servicios se habria quedado atras en
       cuanto la otra cambiara.

       Su resultado se recoge en una tabla temporal en vez de dejarlo salir.
       Si saliera, el primer conjunto que recibe quien llama seria el del
       modulo y no el del giro, y leer `recordset[0].preset` devolveria
       `undefined` sin que nada fallara: el peor tipo de error, el que no
       avisa. Si algun dia cambia la forma de ese SELECT, esto revienta al
       aplicar la migracion, que es cuando se quiere saber. */
    DECLARE @modulo TABLE (
        module_key NVARCHAR(40), enabled BIT, enabled_at DATETIME2(0),
        enabled_by INT, updated_at DATETIME2(0));
    INSERT INTO @modulo
    EXEC dbo.sp_set_business_module @module_key = N'servicios', @enabled = 1, @user_id = @user_id;

    COMMIT;

    SELECT preset, set_at, set_by FROM dbo.services_config WHERE id = 1;
END
GO
