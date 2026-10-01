/* hosp_ordenes
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.hosp_ordenes', 'U') IS NULL
BEGIN
CREATE TABLE dbo.hosp_ordenes (
    id INT IDENTITY(1, 1) NOT NULL,
    cuenta_id INT NOT NULL,
    enviada_por INT NULL,
    enviada_en DATETIME2(7) NOT NULL CONSTRAINT DF_hosp_ordenes_enviada DEFAULT (sysdatetime()),
    CONSTRAINT PK_hosp_ordenes PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_hosp_ordenes_cuenta', 'F') IS NULL
ALTER TABLE dbo.hosp_ordenes WITH CHECK ADD CONSTRAINT FK_hosp_ordenes_cuenta FOREIGN KEY (cuenta_id) REFERENCES dbo.hosp_cuentas (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_hosp_ordenes_cuenta' AND object_id = OBJECT_ID(N'dbo.hosp_ordenes'))
CREATE NONCLUSTERED INDEX IX_hosp_ordenes_cuenta ON dbo.hosp_ordenes (cuenta_id);
