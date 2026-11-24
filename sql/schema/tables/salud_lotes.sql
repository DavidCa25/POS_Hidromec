/* salud_lotes
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.salud_lotes', 'U') IS NULL
BEGIN
CREATE TABLE dbo.salud_lotes (
    id INT IDENTITY(1, 1) NOT NULL,
    product_id INT NOT NULL,
    lote NVARCHAR(40) COLLATE Modern_Spanish_CI_AS NOT NULL,
    caducidad DATE NOT NULL,
    cantidad DECIMAL(12, 3) NOT NULL CONSTRAINT DF_salud_lotes_cant DEFAULT ((0)),
    costo DECIMAL(14, 4) NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_salud_lotes_created DEFAULT (sysdatetime()),
    CONSTRAINT PK_salud_lotes PRIMARY KEY CLUSTERED (id),
    CONSTRAINT UQ_salud_lotes UNIQUE NONCLUSTERED (product_id, lote, caducidad)
);
END;

IF OBJECT_ID(N'dbo.CK_salud_lotes_cant', 'C') IS NULL
ALTER TABLE dbo.salud_lotes WITH CHECK ADD CONSTRAINT CK_salud_lotes_cant CHECK ([cantidad]>=(0));

IF OBJECT_ID(N'dbo.FK_salud_lotes_product', 'F') IS NULL
ALTER TABLE dbo.salud_lotes WITH CHECK ADD CONSTRAINT FK_salud_lotes_product FOREIGN KEY (product_id) REFERENCES dbo.products (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_salud_lotes_caducidad' AND object_id = OBJECT_ID(N'dbo.salud_lotes'))
CREATE NONCLUSTERED INDEX IX_salud_lotes_caducidad ON dbo.salud_lotes (caducidad) INCLUDE (cantidad, product_id) WHERE ([cantidad]>(0));

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_salud_lotes_fefo' AND object_id = OBJECT_ID(N'dbo.salud_lotes'))
CREATE NONCLUSTERED INDEX IX_salud_lotes_fefo ON dbo.salud_lotes (product_id, caducidad, id) INCLUDE (cantidad) WHERE ([cantidad]>(0));
