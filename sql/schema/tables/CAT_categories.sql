/* CAT_categories
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.CAT_categories', 'U') IS NULL
BEGIN
CREATE TABLE dbo.CAT_categories (
    id INT IDENTITY(1, 1) NOT NULL,
    namee NVARCHAR(100) COLLATE Modern_Spanish_CI_AS NOT NULL,
    uuid UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_CAT_categories_uuid DEFAULT (newid()),
    PRIMARY KEY CLUSTERED (id),
    UNIQUE NONCLUSTERED (namee)
);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_CAT_categories_uuid' AND object_id = OBJECT_ID(N'dbo.CAT_categories'))
CREATE UNIQUE NONCLUSTERED INDEX UX_CAT_categories_uuid ON dbo.CAT_categories (uuid);
