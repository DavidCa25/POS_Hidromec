/* production_batches
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.production_batches', 'U') IS NULL
BEGIN
CREATE TABLE dbo.production_batches (
    id INT IDENTITY(1, 1) NOT NULL,
    uuid UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_production_batches_uuid DEFAULT (newid()),
    product_id INT NOT NULL,
    status VARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_production_batches_status DEFAULT ('PLANNED'),
    production_date DATE NOT NULL,
    planned_qty DECIMAL(12, 2) NOT NULL,
    good_qty DECIMAL(12, 2) NULL,
    waste_qty DECIMAL(12, 2) NULL,
    waste_reason NVARCHAR(40) COLLATE Modern_Spanish_CI_AS NULL,
    total_cost DECIMAL(14, 4) NULL,
    unit_cost DECIMAL(14, 4) NULL,
    note NVARCHAR(255) COLLATE Modern_Spanish_CI_AS NULL,
    machine_name NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL,
    created_by INT NOT NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_production_batches_created_at DEFAULT (sysdatetime()),
    started_by INT NULL,
    started_at DATETIME2(0) NULL,
    finished_by INT NULL,
    finished_at DATETIME2(0) NULL,
    cancelled_by INT NULL,
    cancelled_at DATETIME2(0) NULL,
    row_version TIMESTAMP NOT NULL,
    CONSTRAINT PK_production_batches PRIMARY KEY CLUSTERED (id),
    CONSTRAINT UQ_production_batches_uuid UNIQUE NONCLUSTERED (uuid)
);
END;

IF OBJECT_ID(N'dbo.CK_production_batches_good', 'C') IS NULL
ALTER TABLE dbo.production_batches WITH CHECK ADD CONSTRAINT CK_production_batches_good CHECK ([good_qty] IS NULL OR [good_qty]>=(0));

IF OBJECT_ID(N'dbo.CK_production_batches_planned', 'C') IS NULL
ALTER TABLE dbo.production_batches WITH CHECK ADD CONSTRAINT CK_production_batches_planned CHECK ([planned_qty]>(0));

IF OBJECT_ID(N'dbo.CK_production_batches_status', 'C') IS NULL
ALTER TABLE dbo.production_batches WITH CHECK ADD CONSTRAINT CK_production_batches_status CHECK ([status]='CANCELLED' OR [status]='DONE' OR [status]='IN_PROGRESS' OR [status]='PLANNED');

IF OBJECT_ID(N'dbo.CK_production_batches_waste', 'C') IS NULL
ALTER TABLE dbo.production_batches WITH CHECK ADD CONSTRAINT CK_production_batches_waste CHECK ([waste_qty] IS NULL OR [waste_qty]>=(0));

IF OBJECT_ID(N'dbo.FK_production_batches_cancelled_by', 'F') IS NULL
ALTER TABLE dbo.production_batches WITH CHECK ADD CONSTRAINT FK_production_batches_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES dbo.users (id);

IF OBJECT_ID(N'dbo.FK_production_batches_created_by', 'F') IS NULL
ALTER TABLE dbo.production_batches WITH CHECK ADD CONSTRAINT FK_production_batches_created_by FOREIGN KEY (created_by) REFERENCES dbo.users (id);

IF OBJECT_ID(N'dbo.FK_production_batches_finished_by', 'F') IS NULL
ALTER TABLE dbo.production_batches WITH CHECK ADD CONSTRAINT FK_production_batches_finished_by FOREIGN KEY (finished_by) REFERENCES dbo.users (id);

IF OBJECT_ID(N'dbo.FK_production_batches_product', 'F') IS NULL
ALTER TABLE dbo.production_batches WITH CHECK ADD CONSTRAINT FK_production_batches_product FOREIGN KEY (product_id) REFERENCES dbo.products (id);

IF OBJECT_ID(N'dbo.FK_production_batches_started_by', 'F') IS NULL
ALTER TABLE dbo.production_batches WITH CHECK ADD CONSTRAINT FK_production_batches_started_by FOREIGN KEY (started_by) REFERENCES dbo.users (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_production_batches_date' AND object_id = OBJECT_ID(N'dbo.production_batches'))
CREATE NONCLUSTERED INDEX IX_production_batches_date ON dbo.production_batches (production_date, status);
