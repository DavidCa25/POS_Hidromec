/* commercial_policy
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.commercial_policy', 'U') IS NULL
BEGIN
CREATE TABLE dbo.commercial_policy (
    id INT NOT NULL,
    version INT NOT NULL,
    payload NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NOT NULL,
    updated_by INT NULL,
    updated_at DATETIME2(7) NOT NULL DEFAULT (sysutcdatetime()),
    PRIMARY KEY CLUSTERED (id)
);
END;

ALTER TABLE dbo.commercial_policy WITH CHECK ADD CHECK (isjson([payload])=(1));

ALTER TABLE dbo.commercial_policy WITH CHECK ADD CHECK ([id]=(1));
