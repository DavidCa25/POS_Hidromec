/* service_order_lines
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.service_order_lines', 'U') IS NULL
BEGIN
CREATE TABLE dbo.service_order_lines (
    id INT IDENTITY(1, 1) NOT NULL,
    order_id INT NOT NULL,
    line_no INT NOT NULL,
    line_kind NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL,
    product_id INT NOT NULL,
    name_snapshot NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NOT NULL,
    unit_price_snapshot DECIMAL(12, 2) NOT NULL,
    unit_cost_snapshot DECIMAL(14, 4) NULL,
    tasa_iva_snapshot DECIMAL(5, 4) NOT NULL CONSTRAINT DF_solines_iva DEFAULT ((0.16)),
    quantity DECIMAL(12, 2) NOT NULL CONSTRAINT DF_solines_qty DEFAULT ((1)),
    line_total AS (CONVERT([decimal](14,2),[quantity]*[unit_price_snapshot])) PERSISTED,
    professional_id INT NULL,
    commission_pct_snapshot DECIMAL(5, 2) NULL,
    status NVARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_solines_status DEFAULT ('PENDIENTE'),
    notes NVARCHAR(400) COLLATE Modern_Spanish_CI_AS NULL,
    added_at DATETIME2(0) NOT NULL CONSTRAINT DF_solines_added DEFAULT (sysdatetime()),
    added_by INT NULL,
    version TIMESTAMP NOT NULL,
    CONSTRAINT PK_service_order_lines PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_solines_kind', 'C') IS NULL
ALTER TABLE dbo.service_order_lines WITH CHECK ADD CONSTRAINT CK_solines_kind CHECK ([line_kind]='PRODUCTO' OR [line_kind]='SERVICIO');

IF OBJECT_ID(N'dbo.CK_solines_qty', 'C') IS NULL
ALTER TABLE dbo.service_order_lines WITH CHECK ADD CONSTRAINT CK_solines_qty CHECK ([quantity]>(0));

IF OBJECT_ID(N'dbo.FK_solines_order', 'F') IS NULL
ALTER TABLE dbo.service_order_lines WITH CHECK ADD CONSTRAINT FK_solines_order FOREIGN KEY (order_id) REFERENCES dbo.service_orders (id);

IF OBJECT_ID(N'dbo.FK_solines_product', 'F') IS NULL
ALTER TABLE dbo.service_order_lines WITH CHECK ADD CONSTRAINT FK_solines_product FOREIGN KEY (product_id) REFERENCES dbo.products (id);

IF OBJECT_ID(N'dbo.FK_solines_prof', 'F') IS NULL
ALTER TABLE dbo.service_order_lines WITH CHECK ADD CONSTRAINT FK_solines_prof FOREIGN KEY (professional_id) REFERENCES dbo.professionals (id);

IF OBJECT_ID(N'dbo.FK_solines_user', 'F') IS NULL
ALTER TABLE dbo.service_order_lines WITH CHECK ADD CONSTRAINT FK_solines_user FOREIGN KEY (added_by) REFERENCES dbo.users (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_solines_order' AND object_id = OBJECT_ID(N'dbo.service_order_lines'))
CREATE NONCLUSTERED INDEX IX_solines_order ON dbo.service_order_lines (order_id, line_no);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_solines_version' AND object_id = OBJECT_ID(N'dbo.service_order_lines'))
CREATE NONCLUSTERED INDEX IX_solines_version ON dbo.service_order_lines (version) INCLUDE (order_id, professional_id, status);
