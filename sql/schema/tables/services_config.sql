/* services_config
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.services_config', 'U') IS NULL
BEGIN
CREATE TABLE dbo.services_config (
    id TINYINT NOT NULL,
    preset NVARCHAR(40) COLLATE Modern_Spanish_CI_AS NOT NULL,
    set_at DATETIME2(0) NOT NULL CONSTRAINT DF_services_config_set_at DEFAULT (sysdatetime()),
    set_by INT NULL,
    CONSTRAINT PK_services_config PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_services_config_fila_unica', 'C') IS NULL
ALTER TABLE dbo.services_config WITH CHECK ADD CONSTRAINT CK_services_config_fila_unica CHECK ([id]=(1));

IF OBJECT_ID(N'dbo.FK_services_config_user', 'F') IS NULL
ALTER TABLE dbo.services_config WITH NOCHECK ADD CONSTRAINT FK_services_config_user FOREIGN KEY (set_by) REFERENCES dbo.users (id);
