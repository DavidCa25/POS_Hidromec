/* service_commissions
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.service_commissions', 'U') IS NULL
BEGIN
CREATE TABLE dbo.service_commissions (
    id INT IDENTITY(1, 1) NOT NULL,
    order_id INT NOT NULL,
    order_line_id INT NOT NULL,
    sale_id INT NOT NULL,
    professional_id INT NOT NULL,
    base_amount DECIMAL(14, 2) NOT NULL,
    pct DECIMAL(5, 2) NOT NULL,
    amount DECIMAL(14, 2) NOT NULL,
    earned_at DATETIME2(0) NOT NULL CONSTRAINT DF_commissions_at DEFAULT (sysdatetime()),
    CONSTRAINT PK_service_commissions PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_commissions_line', 'F') IS NULL
ALTER TABLE dbo.service_commissions WITH CHECK ADD CONSTRAINT FK_commissions_line FOREIGN KEY (order_line_id) REFERENCES dbo.service_order_lines (id);

IF OBJECT_ID(N'dbo.FK_commissions_order', 'F') IS NULL
ALTER TABLE dbo.service_commissions WITH CHECK ADD CONSTRAINT FK_commissions_order FOREIGN KEY (order_id) REFERENCES dbo.service_orders (id);

IF OBJECT_ID(N'dbo.FK_commissions_prof', 'F') IS NULL
ALTER TABLE dbo.service_commissions WITH CHECK ADD CONSTRAINT FK_commissions_prof FOREIGN KEY (professional_id) REFERENCES dbo.professionals (id);

IF OBJECT_ID(N'dbo.FK_commissions_sale', 'F') IS NULL
ALTER TABLE dbo.service_commissions WITH CHECK ADD CONSTRAINT FK_commissions_sale FOREIGN KEY (sale_id) REFERENCES dbo.sales (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_commissions_prof' AND object_id = OBJECT_ID(N'dbo.service_commissions'))
CREATE NONCLUSTERED INDEX IX_commissions_prof ON dbo.service_commissions (professional_id, earned_at DESC);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_commissions_line' AND object_id = OBJECT_ID(N'dbo.service_commissions'))
CREATE UNIQUE NONCLUSTERED INDEX UX_commissions_line ON dbo.service_commissions (order_line_id);
