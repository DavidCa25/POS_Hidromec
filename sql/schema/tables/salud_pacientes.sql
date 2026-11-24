/* salud_pacientes
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.salud_pacientes', 'U') IS NULL
BEGIN
CREATE TABLE dbo.salud_pacientes (
    customer_id INT NOT NULL,
    curp NVARCHAR(18) COLLATE Modern_Spanish_CI_AS NULL,
    sexo CHAR(1) COLLATE Modern_Spanish_CI_AS NULL,
    tutor NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL,
    contacto_emergencia NVARCHAR(160) COLLATE Modern_Spanish_CI_AS NULL,
    grupo_sanguineo NVARCHAR(5) COLLATE Modern_Spanish_CI_AS NULL,
    alergias NVARCHAR(600) COLLATE Modern_Spanish_CI_AS NULL,
    antecedentes NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NULL,
    consentimiento_at DATETIME2(0) NULL,
    consentimiento_por INT NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_salud_pac_created DEFAULT (sysdatetime()),
    updated_at DATETIME2(0) NULL,
    version TIMESTAMP NOT NULL,
    CONSTRAINT PK_salud_pacientes PRIMARY KEY CLUSTERED (customer_id)
);
END;

IF OBJECT_ID(N'dbo.CK_salud_pacientes_antecedentes', 'C') IS NULL
ALTER TABLE dbo.salud_pacientes WITH CHECK ADD CONSTRAINT CK_salud_pacientes_antecedentes CHECK ([antecedentes] IS NULL OR isjson([antecedentes])=(1));

IF OBJECT_ID(N'dbo.CK_salud_pacientes_sexo', 'C') IS NULL
ALTER TABLE dbo.salud_pacientes WITH CHECK ADD CONSTRAINT CK_salud_pacientes_sexo CHECK ([sexo] IS NULL OR ([sexo]='X' OR [sexo]='M' OR [sexo]='F'));

IF OBJECT_ID(N'dbo.FK_salud_pacientes_customer', 'F') IS NULL
ALTER TABLE dbo.salud_pacientes WITH CHECK ADD CONSTRAINT FK_salud_pacientes_customer FOREIGN KEY (customer_id) REFERENCES dbo.customers (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_salud_pacientes_curp' AND object_id = OBJECT_ID(N'dbo.salud_pacientes'))
CREATE UNIQUE NONCLUSTERED INDEX UX_salud_pacientes_curp ON dbo.salud_pacientes (curp) WHERE ([curp] IS NOT NULL);
