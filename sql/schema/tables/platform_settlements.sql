/* platform_settlements
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.platform_settlements', 'U') IS NULL
BEGIN
CREATE TABLE dbo.platform_settlements (
    id INT IDENTITY(1, 1) NOT NULL,
    platform VARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL,
    period_from DATE NOT NULL,
    period_to DATE NOT NULL,
    status VARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_platform_settlements_status DEFAULT ('BORRADOR'),
    source_file NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
    gross_sales DECIMAL(14, 2) NOT NULL CONSTRAINT DF_platform_settlements_gross DEFAULT ((0)),
    marketing DECIMAL(14, 2) NOT NULL CONSTRAINT DF_platform_settlements_marketing DEFAULT ((0)),
    service_fees DECIMAL(14, 2) NOT NULL CONSTRAINT DF_platform_settlements_fees DEFAULT ((0)),
    refunds DECIMAL(14, 2) NOT NULL CONSTRAINT DF_platform_settlements_refunds DEFAULT ((0)),
    isr_withheld DECIMAL(14, 2) NOT NULL CONSTRAINT DF_platform_settlements_isr DEFAULT ((0)),
    iva_withheld DECIMAL(14, 2) NOT NULL CONSTRAINT DF_platform_settlements_iva DEFAULT ((0)),
    other_adjustments DECIMAL(14, 2) NOT NULL CONSTRAINT DF_platform_settlements_other DEFAULT ((0)),
    iva_rate DECIMAL(5, 4) NOT NULL CONSTRAINT DF_platform_settlements_rate DEFAULT ((0.16)),
    deposit_expected AS (CONVERT([decimal](14,2),((((([gross_sales]-[marketing])-[service_fees])-[refunds])-[isr_withheld])-[iva_withheld])-[other_adjustments])) PERSISTED,
    deposit_real DECIMAL(14, 2) NULL,
    deposit_date DATE NULL,
    note NVARCHAR(255) COLLATE Modern_Spanish_CI_AS NULL,
    expense_id INT NULL,
    created_by INT NOT NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_platform_settlements_created DEFAULT (sysdatetime()),
    updated_at DATETIME2(0) NULL,
    confirmed_by INT NULL,
    confirmed_at DATETIME2(0) NULL,
    voided_by INT NULL,
    voided_at DATETIME2(0) NULL,
    void_reason NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
    CONSTRAINT PK_platform_settlements PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_platform_settlements_amounts', 'C') IS NULL
ALTER TABLE dbo.platform_settlements WITH CHECK ADD CONSTRAINT CK_platform_settlements_amounts CHECK ([gross_sales]>=(0) AND [marketing]>=(0) AND [service_fees]>=(0) AND [refunds]>=(0) AND [isr_withheld]>=(0) AND [iva_withheld]>=(0));

IF OBJECT_ID(N'dbo.CK_platform_settlements_confirmed', 'C') IS NULL
ALTER TABLE dbo.platform_settlements WITH CHECK ADD CONSTRAINT CK_platform_settlements_confirmed CHECK ([status]='BORRADOR' OR [confirmed_at] IS NOT NULL OR [status]='CANCELADA');

IF OBJECT_ID(N'dbo.CK_platform_settlements_deposit', 'C') IS NULL
ALTER TABLE dbo.platform_settlements WITH CHECK ADD CONSTRAINT CK_platform_settlements_deposit CHECK ([deposit_real] IS NULL OR [deposit_date] IS NOT NULL);

IF OBJECT_ID(N'dbo.CK_platform_settlements_period', 'C') IS NULL
ALTER TABLE dbo.platform_settlements WITH CHECK ADD CONSTRAINT CK_platform_settlements_period CHECK ([period_from]<=[period_to]);

IF OBJECT_ID(N'dbo.CK_platform_settlements_platform', 'C') IS NULL
ALTER TABLE dbo.platform_settlements WITH CHECK ADD CONSTRAINT CK_platform_settlements_platform CHECK ([platform]='RAPPI' OR [platform]='DIDI_FOOD' OR [platform]='UBER_EATS');

IF OBJECT_ID(N'dbo.CK_platform_settlements_rate', 'C') IS NULL
ALTER TABLE dbo.platform_settlements WITH CHECK ADD CONSTRAINT CK_platform_settlements_rate CHECK ([iva_rate]>=(0) AND [iva_rate]<(1));

IF OBJECT_ID(N'dbo.CK_platform_settlements_status', 'C') IS NULL
ALTER TABLE dbo.platform_settlements WITH CHECK ADD CONSTRAINT CK_platform_settlements_status CHECK ([status]='CANCELADA' OR [status]='CONFIRMADA' OR [status]='BORRADOR');

IF OBJECT_ID(N'dbo.CK_platform_settlements_void', 'C') IS NULL
ALTER TABLE dbo.platform_settlements WITH CHECK ADD CONSTRAINT CK_platform_settlements_void CHECK ([status]='CANCELADA' AND [voided_at] IS NOT NULL AND [voided_by] IS NOT NULL OR [status]<>'CANCELADA' AND [voided_at] IS NULL);

IF OBJECT_ID(N'dbo.FK_platform_settlements_created', 'F') IS NULL
ALTER TABLE dbo.platform_settlements WITH CHECK ADD CONSTRAINT FK_platform_settlements_created FOREIGN KEY (created_by) REFERENCES dbo.users (id);

IF OBJECT_ID(N'dbo.FK_platform_settlements_expense', 'F') IS NULL
ALTER TABLE dbo.platform_settlements WITH CHECK ADD CONSTRAINT FK_platform_settlements_expense FOREIGN KEY (expense_id) REFERENCES dbo.expenses (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_platform_settlements_period' AND object_id = OBJECT_ID(N'dbo.platform_settlements'))
CREATE NONCLUSTERED INDEX IX_platform_settlements_period ON dbo.platform_settlements (platform, period_from, period_to) INCLUDE (status);
