/* salud_planes
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.salud_planes', 'U') IS NULL
BEGIN
CREATE TABLE dbo.salud_planes (
    id INT IDENTITY(1, 1) NOT NULL,
    paciente_id INT NOT NULL,
    titulo NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NOT NULL,
    estado NVARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_salud_planes_estado DEFAULT (N'PROPUESTO'),
    orden_id INT NULL,
    created_by INT NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_salud_planes_created DEFAULT (sysdatetime()),
    aceptado_at DATETIME2(0) NULL,
    CONSTRAINT PK_salud_planes PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_salud_planes_estado', 'C') IS NULL
ALTER TABLE dbo.salud_planes WITH CHECK ADD CONSTRAINT CK_salud_planes_estado CHECK ([estado]=N'CANCELADO' OR [estado]=N'TERMINADO' OR [estado]=N'ACEPTADO' OR [estado]=N'PROPUESTO');

IF OBJECT_ID(N'dbo.FK_salud_planes_pac', 'F') IS NULL
ALTER TABLE dbo.salud_planes WITH CHECK ADD CONSTRAINT FK_salud_planes_pac FOREIGN KEY (paciente_id) REFERENCES dbo.salud_pacientes (customer_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_salud_planes_paciente' AND object_id = OBJECT_ID(N'dbo.salud_planes'))
CREATE NONCLUSTERED INDEX IX_salud_planes_paciente ON dbo.salud_planes (paciente_id, created_at DESC);
