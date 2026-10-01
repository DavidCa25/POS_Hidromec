/* services
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.services', 'U') IS NULL
BEGIN
CREATE TABLE dbo.services (
    product_id INT NOT NULL,
    duration_minutes INT NOT NULL CONSTRAINT DF_services_duration DEFAULT ((30)),
    requires_professional BIT NOT NULL CONSTRAINT DF_services_req_prof DEFAULT ((1)),
    default_commission_pct DECIMAL(5, 2) NULL,
    schedulable BIT NOT NULL CONSTRAINT DF_services_sched DEFAULT ((1)),
    notes NVARCHAR(400) COLLATE Modern_Spanish_CI_AS NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_services_created DEFAULT (sysdatetime()),
    updated_at DATETIME2(0) NULL,
    CONSTRAINT PK_services PRIMARY KEY CLUSTERED (product_id)
);
END;

IF OBJECT_ID(N'dbo.CK_services_commission', 'C') IS NULL
ALTER TABLE dbo.services WITH CHECK ADD CONSTRAINT CK_services_commission CHECK ([default_commission_pct] IS NULL OR [default_commission_pct]>=(0) AND [default_commission_pct]<=(100));

IF OBJECT_ID(N'dbo.CK_services_duration', 'C') IS NULL
ALTER TABLE dbo.services WITH CHECK ADD CONSTRAINT CK_services_duration CHECK ([duration_minutes]>=(1) AND [duration_minutes]<=(1440));

IF OBJECT_ID(N'dbo.FK_services_product', 'F') IS NULL
ALTER TABLE dbo.services WITH CHECK ADD CONSTRAINT FK_services_product FOREIGN KEY (product_id) REFERENCES dbo.products (id);
