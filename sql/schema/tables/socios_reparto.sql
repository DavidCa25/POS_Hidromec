/* socios_reparto
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.socios_reparto', 'U') IS NULL
BEGIN
CREATE TABLE dbo.socios_reparto (
    id INT IDENTITY(1, 1) NOT NULL,
    origen VARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL,
    sale_id INT NOT NULL,
    sale_detail_id INT NULL,
    refund_detail_id INT NULL,
    socio_id INT NOT NULL,
    fecha DATETIME2(0) NOT NULL,
    register_id INT NULL,
    ingreso DECIMAL(14, 4) NOT NULL,
    costo DECIMAL(14, 4) NOT NULL,
    ganancia DECIMAL(14, 4) NOT NULL,
    total AS ([costo]+[ganancia]) PERSISTED,
    CONSTRAINT PK_socios_reparto PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_socios_reparto_origen', 'C') IS NULL
ALTER TABLE dbo.socios_reparto WITH CHECK ADD CONSTRAINT CK_socios_reparto_origen CHECK ([origen]='VENTA' AND [sale_detail_id] IS NOT NULL AND [refund_detail_id] IS NULL OR [origen]='DEVOLUCION' AND [refund_detail_id] IS NOT NULL AND [sale_detail_id] IS NULL);

IF OBJECT_ID(N'dbo.FK_socios_reparto_detail', 'F') IS NULL
ALTER TABLE dbo.socios_reparto WITH CHECK ADD CONSTRAINT FK_socios_reparto_detail FOREIGN KEY (sale_detail_id) REFERENCES dbo.sale_detail (id);

IF OBJECT_ID(N'dbo.FK_socios_reparto_refund', 'F') IS NULL
ALTER TABLE dbo.socios_reparto WITH CHECK ADD CONSTRAINT FK_socios_reparto_refund FOREIGN KEY (refund_detail_id) REFERENCES dbo.sale_refund_detail (id);

IF OBJECT_ID(N'dbo.FK_socios_reparto_sale', 'F') IS NULL
ALTER TABLE dbo.socios_reparto WITH CHECK ADD CONSTRAINT FK_socios_reparto_sale FOREIGN KEY (sale_id) REFERENCES dbo.sales (id);

IF OBJECT_ID(N'dbo.FK_socios_reparto_socio', 'F') IS NULL
ALTER TABLE dbo.socios_reparto WITH CHECK ADD CONSTRAINT FK_socios_reparto_socio FOREIGN KEY (socio_id) REFERENCES dbo.socios (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_socios_reparto_fecha' AND object_id = OBJECT_ID(N'dbo.socios_reparto'))
CREATE NONCLUSTERED INDEX IX_socios_reparto_fecha ON dbo.socios_reparto (fecha) INCLUDE (costo, ganancia, ingreso, socio_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_socios_reparto_devolucion' AND object_id = OBJECT_ID(N'dbo.socios_reparto'))
CREATE UNIQUE NONCLUSTERED INDEX UX_socios_reparto_devolucion ON dbo.socios_reparto (refund_detail_id, socio_id) WHERE ([refund_detail_id] IS NOT NULL);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_socios_reparto_venta' AND object_id = OBJECT_ID(N'dbo.socios_reparto'))
CREATE UNIQUE NONCLUSTERED INDEX UX_socios_reparto_venta ON dbo.socios_reparto (sale_detail_id, socio_id) WHERE ([sale_detail_id] IS NOT NULL);
