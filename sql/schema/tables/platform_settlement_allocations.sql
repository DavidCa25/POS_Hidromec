/* platform_settlement_allocations
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.platform_settlement_allocations', 'U') IS NULL
BEGIN
CREATE TABLE dbo.platform_settlement_allocations (
    id INT IDENTITY(1, 1) NOT NULL,
    settlement_id INT NOT NULL,
    sale_id INT NULL,
    channel_id NVARCHAR(64) COLLATE Modern_Spanish_CI_AS NULL,
    alloc_date DATE NOT NULL,
    discount_base DECIMAL(18, 6) NOT NULL,
    discount_iva DECIMAL(18, 6) NOT NULL,
    refund_base DECIMAL(18, 6) NOT NULL,
    refund_iva DECIMAL(18, 6) NOT NULL,
    fee_base DECIMAL(18, 6) NOT NULL,
    fee_iva DECIMAL(18, 6) NOT NULL,
    withheld DECIMAL(18, 6) NOT NULL,
    CONSTRAINT PK_platform_settlement_allocations PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_platform_settlement_allocations_sale', 'F') IS NULL
ALTER TABLE dbo.platform_settlement_allocations WITH CHECK ADD CONSTRAINT FK_platform_settlement_allocations_sale FOREIGN KEY (sale_id) REFERENCES dbo.sales (id);

IF OBJECT_ID(N'dbo.FK_platform_settlement_allocations_settlement', 'F') IS NULL
ALTER TABLE dbo.platform_settlement_allocations WITH CHECK ADD CONSTRAINT FK_platform_settlement_allocations_settlement FOREIGN KEY (settlement_id) REFERENCES dbo.platform_settlements (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_platform_settlement_allocations_date' AND object_id = OBJECT_ID(N'dbo.platform_settlement_allocations'))
CREATE NONCLUSTERED INDEX IX_platform_settlement_allocations_date ON dbo.platform_settlement_allocations (alloc_date) INCLUDE (channel_id, discount_base, discount_iva, fee_base, fee_iva, refund_base, refund_iva, settlement_id, withheld);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_platform_settlement_allocations_sale' AND object_id = OBJECT_ID(N'dbo.platform_settlement_allocations'))
CREATE NONCLUSTERED INDEX IX_platform_settlement_allocations_sale ON dbo.platform_settlement_allocations (sale_id) INCLUDE (settlement_id) WHERE ([sale_id] IS NOT NULL);
