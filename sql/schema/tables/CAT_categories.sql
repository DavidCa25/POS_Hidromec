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
    PRIMARY KEY CLUSTERED (id),
    UNIQUE NONCLUSTERED (namee)
);
END;
