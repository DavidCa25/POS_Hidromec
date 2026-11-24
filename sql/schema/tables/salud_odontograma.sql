/* salud_odontograma
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.salud_odontograma', 'U') IS NULL
BEGIN
CREATE TABLE dbo.salud_odontograma (
    id INT IDENTITY(1, 1) NOT NULL,
    paciente_id INT NOT NULL,
    diente TINYINT NOT NULL,
    cara NVARCHAR(2) COLLATE Modern_Spanish_CI_AS NOT NULL,
    estado NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL,
    nota NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
    user_id INT NULL,
    at DATETIME2(0) NOT NULL CONSTRAINT DF_salud_odo_at DEFAULT (sysdatetime()),
    CONSTRAINT PK_salud_odontograma PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_salud_odontograma_cara', 'C') IS NULL
ALTER TABLE dbo.salud_odontograma WITH CHECK ADD CONSTRAINT CK_salud_odontograma_cara CHECK ([cara]=N'T' OR [cara]=N'L' OR [cara]=N'V' OR [cara]=N'D' OR [cara]=N'M' OR [cara]=N'O');

IF OBJECT_ID(N'dbo.CK_salud_odontograma_diente', 'C') IS NULL
ALTER TABLE dbo.salud_odontograma WITH CHECK ADD CONSTRAINT CK_salud_odontograma_diente CHECK ([diente]/(10)>=(1) AND [diente]/(10)<=(4) AND ([diente]%(10)>=(1) AND [diente]%(10)<=(8)) OR [diente]/(10)>=(5) AND [diente]/(10)<=(8) AND ([diente]%(10)>=(1) AND [diente]%(10)<=(5)));

IF OBJECT_ID(N'dbo.CK_salud_odontograma_estado', 'C') IS NULL
ALTER TABLE dbo.salud_odontograma WITH CHECK ADD CONSTRAINT CK_salud_odontograma_estado CHECK ([estado]=N'SELLADOR' OR [estado]=N'FRACTURA' OR [estado]=N'IMPLANTE' OR [estado]=N'EXTRACCION' OR [estado]=N'ENDODONCIA' OR [estado]=N'CORONA' OR [estado]=N'AUSENTE' OR [estado]=N'OBTURADO' OR [estado]=N'CARIES' OR [estado]=N'SANO');

IF OBJECT_ID(N'dbo.FK_salud_odontograma_pac', 'F') IS NULL
ALTER TABLE dbo.salud_odontograma WITH CHECK ADD CONSTRAINT FK_salud_odontograma_pac FOREIGN KEY (paciente_id) REFERENCES dbo.salud_pacientes (customer_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_salud_odontograma_actual' AND object_id = OBJECT_ID(N'dbo.salud_odontograma'))
CREATE NONCLUSTERED INDEX IX_salud_odontograma_actual ON dbo.salud_odontograma (paciente_id, diente, cara, id DESC) INCLUDE (estado);
