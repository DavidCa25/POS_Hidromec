/* salud_config
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.salud_config', 'U') IS NULL
BEGIN
CREATE TABLE dbo.salud_config (
    id TINYINT NOT NULL,
    preset NVARCHAR(40) COLLATE Modern_Spanish_CI_AS NOT NULL,
    farmacia BIT NOT NULL CONSTRAINT DF_salud_config_farmacia DEFAULT ((0)),
    clinica BIT NOT NULL CONSTRAINT DF_salud_config_clinica DEFAULT ((0)),
    dental BIT NOT NULL CONSTRAINT DF_salud_config_dental DEFAULT ((0)),
    estudios BIT NOT NULL CONSTRAINT DF_salud_config_estudios DEFAULT ((0)),
    set_at DATETIME2(0) NOT NULL CONSTRAINT DF_salud_config_set DEFAULT (sysdatetime()),
    set_by INT NULL,
    CONSTRAINT PK_salud_config PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_salud_config_uno', 'C') IS NULL
ALTER TABLE dbo.salud_config WITH CHECK ADD CONSTRAINT CK_salud_config_uno CHECK ([id]=(1));
