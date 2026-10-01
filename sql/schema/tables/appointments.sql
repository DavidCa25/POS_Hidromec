/* appointments
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.appointments', 'U') IS NULL
BEGIN
CREATE TABLE dbo.appointments (
    id INT IDENTITY(1, 1) NOT NULL,
    customer_id INT NOT NULL,
    customer_asset_id INT NULL,
    professional_id INT NULL,
    service_product_id INT NULL,
    starts_at DATETIME2(0) NOT NULL,
    ends_at DATETIME2(0) NOT NULL,
    status NVARCHAR(15) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_appt_status DEFAULT ('AGENDADA'),
    service_order_id INT NULL,
    rescheduled_from_id INT NULL,
    notes NVARCHAR(400) COLLATE Modern_Spanish_CI_AS NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_appt_created DEFAULT (sysdatetime()),
    created_by INT NULL,
    updated_at DATETIME2(0) NULL,
    version TIMESTAMP NOT NULL,
    CONSTRAINT PK_appointments PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_appt_range', 'C') IS NULL
ALTER TABLE dbo.appointments WITH CHECK ADD CONSTRAINT CK_appt_range CHECK ([ends_at]>[starts_at]);

IF OBJECT_ID(N'dbo.FK_appt_asset', 'F') IS NULL
ALTER TABLE dbo.appointments WITH CHECK ADD CONSTRAINT FK_appt_asset FOREIGN KEY (customer_asset_id) REFERENCES dbo.customer_assets (id);

IF OBJECT_ID(N'dbo.FK_appt_customer', 'F') IS NULL
ALTER TABLE dbo.appointments WITH CHECK ADD CONSTRAINT FK_appt_customer FOREIGN KEY (customer_id) REFERENCES dbo.customers (id);

IF OBJECT_ID(N'dbo.FK_appt_order', 'F') IS NULL
ALTER TABLE dbo.appointments WITH CHECK ADD CONSTRAINT FK_appt_order FOREIGN KEY (service_order_id) REFERENCES dbo.service_orders (id);

IF OBJECT_ID(N'dbo.FK_appt_prev', 'F') IS NULL
ALTER TABLE dbo.appointments WITH CHECK ADD CONSTRAINT FK_appt_prev FOREIGN KEY (rescheduled_from_id) REFERENCES dbo.appointments (id);

IF OBJECT_ID(N'dbo.FK_appt_prof', 'F') IS NULL
ALTER TABLE dbo.appointments WITH CHECK ADD CONSTRAINT FK_appt_prof FOREIGN KEY (professional_id) REFERENCES dbo.professionals (id);

IF OBJECT_ID(N'dbo.FK_appt_service', 'F') IS NULL
ALTER TABLE dbo.appointments WITH CHECK ADD CONSTRAINT FK_appt_service FOREIGN KEY (service_product_id) REFERENCES dbo.services (product_id);

IF OBJECT_ID(N'dbo.FK_appt_user', 'F') IS NULL
ALTER TABLE dbo.appointments WITH CHECK ADD CONSTRAINT FK_appt_user FOREIGN KEY (created_by) REFERENCES dbo.users (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_appointments_prof' AND object_id = OBJECT_ID(N'dbo.appointments'))
CREATE NONCLUSTERED INDEX IX_appointments_prof ON dbo.appointments (professional_id, starts_at) WHERE ([professional_id] IS NOT NULL);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_appointments_rango' AND object_id = OBJECT_ID(N'dbo.appointments'))
CREATE NONCLUSTERED INDEX IX_appointments_rango ON dbo.appointments (starts_at, ends_at) INCLUDE (customer_id, professional_id, status);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_appointments_version' AND object_id = OBJECT_ID(N'dbo.appointments'))
CREATE NONCLUSTERED INDEX IX_appointments_version ON dbo.appointments (version) INCLUDE (professional_id, status);
