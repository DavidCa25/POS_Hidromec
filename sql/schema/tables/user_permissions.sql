/* user_permissions
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.user_permissions', 'U') IS NULL
BEGIN
CREATE TABLE dbo.user_permissions (
    user_id INT NOT NULL,
    permiso VARCHAR(40) COLLATE Modern_Spanish_CI_AS NOT NULL,
    granted_by INT NULL,
    granted_at DATETIME2(0) NOT NULL CONSTRAINT DF_user_permissions_granted_at DEFAULT (sysdatetime()),
    CONSTRAINT PK_user_permissions PRIMARY KEY CLUSTERED (user_id, permiso)
);
END;

IF OBJECT_ID(N'dbo.FK_user_permissions_user', 'F') IS NULL
ALTER TABLE dbo.user_permissions WITH CHECK ADD CONSTRAINT FK_user_permissions_user FOREIGN KEY (user_id) REFERENCES dbo.users (id);
