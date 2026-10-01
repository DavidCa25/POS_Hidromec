/* business_modules
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.business_modules', 'U') IS NULL
BEGIN
CREATE TABLE dbo.business_modules (
    module_key NVARCHAR(40) COLLATE Modern_Spanish_CI_AS NOT NULL,
    enabled BIT NOT NULL CONSTRAINT DF_business_modules_enabled DEFAULT ((0)),
    enabled_at DATETIME2(0) NULL,
    enabled_by INT NULL,
    updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_business_modules_updated_at DEFAULT (sysdatetime()),
    CONSTRAINT PK_business_modules PRIMARY KEY CLUSTERED (module_key)
);
END;

IF OBJECT_ID(N'dbo.FK_business_modules_user', 'F') IS NULL
ALTER TABLE dbo.business_modules WITH NOCHECK ADD CONSTRAINT FK_business_modules_user FOREIGN KEY (enabled_by) REFERENCES dbo.users (id);
