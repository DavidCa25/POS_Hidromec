/* sale_detail_impuestos
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.sale_detail_impuestos', 'U') IS NULL
BEGIN
CREATE TABLE dbo.sale_detail_impuestos (
    id INT IDENTITY(1, 1) NOT NULL,
    sale_detail_id INT NOT NULL,
    impuesto_id INT NOT NULL,
    nombre NVARCHAR(80) COLLATE Modern_Spanish_CI_AS NOT NULL,
    clase VARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL,
    factor VARCHAR(6) COLLATE Modern_Spanish_CI_AS NOT NULL,
    tasa DECIMAL(9, 6) NULL,
    cuota DECIMAL(12, 4) NULL,
    cantidad DECIMAL(14, 4) NULL,
    base DECIMAL(14, 4) NOT NULL,
    importe DECIMAL(14, 4) NOT NULL,
    CONSTRAINT PK_sale_detail_impuestos PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_sale_detail_impuestos_detalle', 'F') IS NULL
ALTER TABLE dbo.sale_detail_impuestos WITH CHECK ADD CONSTRAINT FK_sale_detail_impuestos_detalle FOREIGN KEY (sale_detail_id) REFERENCES dbo.sale_detail (id);

IF OBJECT_ID(N'dbo.FK_sale_detail_impuestos_impuesto', 'F') IS NULL
ALTER TABLE dbo.sale_detail_impuestos WITH CHECK ADD CONSTRAINT FK_sale_detail_impuestos_impuesto FOREIGN KEY (impuesto_id) REFERENCES dbo.CAT_impuestos (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sale_detail_impuestos_detalle' AND object_id = OBJECT_ID(N'dbo.sale_detail_impuestos'))
CREATE NONCLUSTERED INDEX IX_sale_detail_impuestos_detalle ON dbo.sale_detail_impuestos (sale_detail_id) INCLUDE (importe, impuesto_id);
