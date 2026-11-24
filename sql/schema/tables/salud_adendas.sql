/* salud_adendas
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.salud_adendas', 'U') IS NULL
BEGIN
CREATE TABLE dbo.salud_adendas (
    id INT IDENTITY(1, 1) NOT NULL,
    documento_id INT NOT NULL,
    texto NVARCHAR(2000) COLLATE Modern_Spanish_CI_AS NOT NULL,
    autor_id INT NOT NULL,
    at DATETIME2(0) NOT NULL CONSTRAINT DF_salud_adendas_at DEFAULT (sysdatetime()),
    CONSTRAINT PK_salud_adendas PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_salud_adendas_doc', 'F') IS NULL
ALTER TABLE dbo.salud_adendas WITH CHECK ADD CONSTRAINT FK_salud_adendas_doc FOREIGN KEY (documento_id) REFERENCES dbo.salud_documentos (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_salud_adendas_doc' AND object_id = OBJECT_ID(N'dbo.salud_adendas'))
CREATE NONCLUSTERED INDEX IX_salud_adendas_doc ON dbo.salud_adendas (documento_id);
