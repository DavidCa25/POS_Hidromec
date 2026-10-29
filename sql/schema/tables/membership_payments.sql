/* membership_payments
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.membership_payments', 'U') IS NULL
BEGIN
CREATE TABLE dbo.membership_payments (
    id INT IDENTITY(1, 1) NOT NULL,
    uuid UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_membership_payments_uuid DEFAULT (newid()),
    membership_id INT NOT NULL,
    sale_id INT NULL,
    sale_detail_id INT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    period_from DATE NOT NULL,
    period_to DATE NOT NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_membership_payments_created DEFAULT (sysdatetime()),
    voided_at DATETIME2(0) NULL,
    void_refund_id INT NULL,
    CONSTRAINT PK_membership_payments PRIMARY KEY CLUSTERED (id),
    CONSTRAINT UX_membership_payments_uuid UNIQUE NONCLUSTERED (uuid)
);
END;

IF OBJECT_ID(N'dbo.FK_membership_payments_membership', 'F') IS NULL
ALTER TABLE dbo.membership_payments WITH CHECK ADD CONSTRAINT FK_membership_payments_membership FOREIGN KEY (membership_id) REFERENCES dbo.customer_memberships (id);

IF OBJECT_ID(N'dbo.FK_membership_payments_sale', 'F') IS NULL
ALTER TABLE dbo.membership_payments WITH CHECK ADD CONSTRAINT FK_membership_payments_sale FOREIGN KEY (sale_id) REFERENCES dbo.sales (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_membership_payments_membership' AND object_id = OBJECT_ID(N'dbo.membership_payments'))
CREATE NONCLUSTERED INDEX IX_membership_payments_membership ON dbo.membership_payments (membership_id, period_to);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_membership_payments_detalle' AND object_id = OBJECT_ID(N'dbo.membership_payments'))
CREATE UNIQUE NONCLUSTERED INDEX UX_membership_payments_detalle ON dbo.membership_payments (sale_detail_id) WHERE ([sale_detail_id] IS NOT NULL);
