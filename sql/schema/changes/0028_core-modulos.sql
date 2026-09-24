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
