/* professional_schedules
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.professional_schedules', 'U') IS NULL
BEGIN
CREATE TABLE dbo.professional_schedules (
    id INT IDENTITY(1, 1) NOT NULL,
    professional_id INT NOT NULL,
    weekday TINYINT NOT NULL,
    starts_at TIME(0) NOT NULL,
    ends_at TIME(0) NOT NULL,
    active BIT NOT NULL CONSTRAINT DF_schedule_active DEFAULT ((1)),
    CONSTRAINT PK_professional_schedules PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_schedule_range', 'C') IS NULL
ALTER TABLE dbo.professional_schedules WITH CHECK ADD CONSTRAINT CK_schedule_range CHECK ([ends_at]>[starts_at]);

IF OBJECT_ID(N'dbo.CK_schedule_weekday', 'C') IS NULL
ALTER TABLE dbo.professional_schedules WITH CHECK ADD CONSTRAINT CK_schedule_weekday CHECK ([weekday]>=(1) AND [weekday]<=(7));

IF OBJECT_ID(N'dbo.FK_schedule_prof', 'F') IS NULL
ALTER TABLE dbo.professional_schedules WITH CHECK ADD CONSTRAINT FK_schedule_prof FOREIGN KEY (professional_id) REFERENCES dbo.professionals (id);
