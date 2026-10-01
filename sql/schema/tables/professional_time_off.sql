/* professional_time_off
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.professional_time_off', 'U') IS NULL
BEGIN
CREATE TABLE dbo.professional_time_off (
    id INT IDENTITY(1, 1) NOT NULL,
    professional_id INT NOT NULL,
    starts_at DATETIME2(0) NOT NULL,
    ends_at DATETIME2(0) NOT NULL,
    reason NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_timeoff_created DEFAULT (sysdatetime()),
    CONSTRAINT PK_professional_time_off PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_timeoff_range', 'C') IS NULL
ALTER TABLE dbo.professional_time_off WITH CHECK ADD CONSTRAINT CK_timeoff_range CHECK ([ends_at]>[starts_at]);

IF OBJECT_ID(N'dbo.FK_timeoff_prof', 'F') IS NULL
ALTER TABLE dbo.professional_time_off WITH CHECK ADD CONSTRAINT FK_timeoff_prof FOREIGN KEY (professional_id) REFERENCES dbo.professionals (id);
