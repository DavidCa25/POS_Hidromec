/* ============================================================
   0028 — core modulos

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0028_core-modulos.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0028_core-modulos.sql ========== */
/* ============================================================
   0028 — El registro de modulos del negocio.

   UNA SOLA COSA: que capacidades tiene encendidas la empresa. Nada de
   permisos, nada de sesion. La seguridad va en su propia migracion para
   que cada subsistema se pueda evaluar, revertir y entender por separado.

   Todo idempotente. Una instalacion que actualice no ve ninguna
   diferencia hasta que su dueno entre a Aplicaciones.
   ============================================================ */

/* Una fila por modulo ENCENDIDO ALGUNA VEZ. La fila ausente significa
   apagado, asi que una base nueva no necesita que se le siembre nada.

   Sin columna `config`: un JSON generico acaba siendo el sitio donde cae
   todo lo que nadie quiso modelar, y no se puede consultar ni migrar. El
   modulo que necesite configuracion tendra su tabla, como ya la tienen
   TAECEL, la facturacion y los respaldos.

   Y sin una columna BIT por modulo: anadir Servicios, Agenda o lo que
   venga despues es una fila, no una migracion. */
IF OBJECT_ID(N'dbo.business_modules', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.business_modules (
        module_key NVARCHAR(40) COLLATE Modern_Spanish_CI_AS NOT NULL,
        enabled    BIT NOT NULL CONSTRAINT DF_business_modules_enabled DEFAULT ((0)),
        enabled_at DATETIME2(0) NULL,
        enabled_by INT NULL,
        updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_business_modules_updated_at DEFAULT (SYSDATETIME()),
        CONSTRAINT PK_business_modules PRIMARY KEY CLUSTERED (module_key)
    );
END;
GO

IF OBJECT_ID(N'dbo.FK_business_modules_user', 'F') IS NULL
   AND OBJECT_ID(N'dbo.business_modules', 'U') IS NOT NULL
ALTER TABLE dbo.business_modules WITH NOCHECK
  ADD CONSTRAINT FK_business_modules_user FOREIGN KEY (enabled_by) REFERENCES dbo.users (id);
GO

/* ------------------------------------- siembra desde lo que ya existia

   Los dos modulos que hoy viven en columnas de `business_config` pasan al
   registro con el valor que ya tenian. Un negocio Hospitality sigue siendo
   Hospitality y quien tenia Fidelizacion la conserva.

   `business_profile` NO se borra ni se cambia: pasa a ser el preset con el
   que nacio el negocio -util para etiquetas, catalogos semilla y soporte- y
   deja de gobernar comportamiento. Que deje de gobernar es justo lo que
   permite Retail + Hospitality y Retail + Servicios. */
IF NOT EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = 'hospitality')
   AND EXISTS (SELECT 1 FROM dbo.business_config)
    INSERT INTO dbo.business_modules (module_key, enabled, enabled_at)
    SELECT 'hospitality',
           CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(business_profile, '')))) = 'HOSPITALITY' THEN 1 ELSE 0 END,
           CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(business_profile, '')))) = 'HOSPITALITY' THEN SYSDATETIME() END
      FROM (SELECT TOP 1 business_profile FROM dbo.business_config ORDER BY id) AS b;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = 'loyalty')
   AND EXISTS (SELECT 1 FROM dbo.business_config)
    INSERT INTO dbo.business_modules (module_key, enabled, enabled_at)
    SELECT 'loyalty',
           CASE WHEN ISNULL(loyalty_enabled, 0) = 1 THEN 1 ELSE 0 END,
           CASE WHEN ISNULL(loyalty_enabled, 0) = 1 THEN SYSDATETIME() END
      FROM (SELECT TOP 1 loyalty_enabled FROM dbo.business_config ORDER BY id) AS b;
GO

/* Una base sin `business_config` todavia -instalacion a medias- no siembra
   nada, y la fila ausente significa apagado. `sp_setup_inicial` siembra al
   dar de alta el negocio. */
GO

/* ---------- sp_get_business_modules (SQL_STORED_PROCEDURE) ---------- */
/* sp_get_business_modules
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Que modulos tiene encendidos el NEGOCIO.
 *
 * Una fila ausente significa apagado, asi que esto devuelve solo lo que
 * alguna vez se encendio. Quien pregunta decide por omision, y la omision es
 * siempre "no".
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_get_business_modules]
AS
BEGIN
    SET NOCOUNT ON;
    SELECT module_key, enabled, enabled_at, enabled_by, updated_at
      FROM dbo.business_modules
     ORDER BY module_key;
END
GO

/* ---------- sp_set_business_module (SQL_STORED_PROCEDURE) ---------- */
/* sp_set_business_module
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Enciende o apaga un modulo, y deja constancia de quien lo hizo.
 *
 * APAGAR NO DESTRUYE NADA. Solo cambia este BIT: las tablas del modulo, sus
 * datos y su historial se quedan donde estan. Volver a encenderlo devuelve
 * todo al estado en que quedo.
 *
 * DUAL-WRITE durante la ventana de compatibilidad: mientras existan cajas que
 * leen las columnas antiguas de `business_config`, este procedimiento escribe
 * tambien alli. Se retira cuando ninguna version soportada dependa de ellas,
 * no en una fecha.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_set_business_module]
    @module_key NVARCHAR(40),
    @enabled    BIT,
    @user_id    INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF LTRIM(RTRIM(ISNULL(@module_key, ''))) = ''
    BEGIN
        RAISERROR('Falta el identificador del modulo.', 16, 1);
        RETURN;
    END

    BEGIN TRAN;

    MERGE dbo.business_modules AS d
    USING (SELECT @module_key AS module_key) AS s
       ON d.module_key = s.module_key
     WHEN MATCHED THEN
          UPDATE SET enabled = @enabled,
                     enabled_at = CASE WHEN @enabled = 1 AND d.enabled = 0 THEN SYSDATETIME()
                                       ELSE d.enabled_at END,
                     enabled_by = CASE WHEN @enabled = 1 THEN ISNULL(@user_id, d.enabled_by)
                                       ELSE d.enabled_by END,
                     updated_at = SYSDATETIME()
     WHEN NOT MATCHED THEN
          INSERT (module_key, enabled, enabled_at, enabled_by, updated_at)
          VALUES (@module_key, @enabled,
                  CASE WHEN @enabled = 1 THEN SYSDATETIME() END,
                  CASE WHEN @enabled = 1 THEN @user_id END,
                  SYSDATETIME());

    /* Espejo hacia las columnas antiguas, mientras hagan falta. */
    IF @module_key = 'loyalty'
        UPDATE dbo.business_config SET loyalty_enabled = @enabled;

    IF @module_key = 'hospitality'
        UPDATE dbo.business_config
           SET business_profile = CASE WHEN @enabled = 1 THEN 'HOSPITALITY' ELSE 'RETAIL' END;

    COMMIT;

    SELECT module_key, enabled, enabled_at, enabled_by, updated_at
      FROM dbo.business_modules WHERE module_key = @module_key;
END
GO
