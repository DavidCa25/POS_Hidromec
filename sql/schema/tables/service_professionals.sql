/* service_professionals
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.service_professionals', 'U') IS NULL
BEGIN
CREATE TABLE dbo.service_professionals (
    service_product_id INT NOT NULL,
    professional_id INT NOT NULL,
    commission_pct DECIMAL(5, 2) NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_svcprof_created DEFAULT (sysdatetime()),
    CONSTRAINT PK_service_professionals PRIMARY KEY CLUSTERED (service_product_id, professional_id)
);
END;

IF OBJECT_ID(N'dbo.FK_svcprof_prof', 'F') IS NULL
ALTER TABLE dbo.service_professionals WITH CHECK ADD CONSTRAINT FK_svcprof_prof FOREIGN KEY (professional_id) REFERENCES dbo.professionals (id);

IF OBJECT_ID(N'dbo.FK_svcprof_service', 'F') IS NULL
ALTER TABLE dbo.service_professionals WITH CHECK ADD CONSTRAINT FK_svcprof_service FOREIGN KEY (service_product_id) REFERENCES dbo.services (product_id);
