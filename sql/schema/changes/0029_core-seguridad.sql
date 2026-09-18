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
