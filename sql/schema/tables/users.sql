/* users
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.users', 'U') IS NULL
BEGIN
CREATE TABLE dbo.users (
    id INT IDENTITY(1, 1) NOT NULL,
    usuario NVARCHAR(50) COLLATE Modern_Spanish_CI_AS NOT NULL,
    password_hash NVARCHAR(255) COLLATE Modern_Spanish_CI_AS NOT NULL,
    rol NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL,
    active BIT NULL DEFAULT ((1)),
    creation_date DATETIME NULL DEFAULT (getdate()),
    uuid UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_users_uuid DEFAULT (newid()),
    corporate BIT NOT NULL CONSTRAINT DF_users_corporate DEFAULT ((0)),
    corporate_scope NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NULL,
    PRIMARY KEY CLUSTERED (id),
    UNIQUE NONCLUSTERED (usuario)
);
END;

IF OBJECT_ID(N'dbo.CK_users_corporate_scope', 'C') IS NULL
ALTER TABLE dbo.users WITH CHECK ADD CONSTRAINT CK_users_corporate_scope CHECK ([corporate_scope] IS NULL OR isjson([corporate_scope])=(1));

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_users_uuid' AND object_id = OBJECT_ID(N'dbo.users'))
CREATE UNIQUE NONCLUSTERED INDEX UX_users_uuid ON dbo.users (uuid);
