/* socios_config
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.socios_config', 'U') IS NULL
BEGIN
CREATE TABLE dbo.socios_config (
    id TINYINT NOT NULL,
    regla CHAR(1) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_socios_config_regla DEFAULT ('C'),
    pct_vende DECIMAL(5, 2) NOT NULL CONSTRAINT DF_socios_config_pct DEFAULT ((30)),
    gasto_regla VARCHAR(8) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_socios_config_gasto DEFAULT ('IGUALES'),
    faltante_regla VARCHAR(8) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_socios_config_falt DEFAULT ('VENTAS'),
    sin_dueno_socio_id INT NULL,
    liquidacion VARCHAR(8) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_socios_config_liq DEFAULT ('SEMANAL'),
    dia_cierre TINYINT NULL,
    inicio DATE NOT NULL,
    updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_socios_config_upd DEFAULT (sysdatetime()),
    updated_by INT NULL,
    CONSTRAINT PK_socios_config PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_socios_config_dia', 'C') IS NULL
ALTER TABLE dbo.socios_config WITH CHECK ADD CONSTRAINT CK_socios_config_dia CHECK ([dia_cierre] IS NULL OR [dia_cierre]>=(1) AND [dia_cierre]<=(7));

IF OBJECT_ID(N'dbo.CK_socios_config_falt', 'C') IS NULL
ALTER TABLE dbo.socios_config WITH CHECK ADD CONSTRAINT CK_socios_config_falt CHECK ([faltante_regla]='VENTAS' OR [faltante_regla]='IGUALES');

IF OBJECT_ID(N'dbo.CK_socios_config_gasto', 'C') IS NULL
ALTER TABLE dbo.socios_config WITH CHECK ADD CONSTRAINT CK_socios_config_gasto CHECK ([gasto_regla]='VENTAS' OR [gasto_regla]='FIJO' OR [gasto_regla]='IGUALES');

IF OBJECT_ID(N'dbo.CK_socios_config_id', 'C') IS NULL
ALTER TABLE dbo.socios_config WITH CHECK ADD CONSTRAINT CK_socios_config_id CHECK ([id]=(1));

IF OBJECT_ID(N'dbo.CK_socios_config_liq', 'C') IS NULL
ALTER TABLE dbo.socios_config WITH CHECK ADD CONSTRAINT CK_socios_config_liq CHECK ([liquidacion]='MENSUAL' OR [liquidacion]='SEMANAL');

IF OBJECT_ID(N'dbo.CK_socios_config_pct', 'C') IS NULL
ALTER TABLE dbo.socios_config WITH CHECK ADD CONSTRAINT CK_socios_config_pct CHECK ([pct_vende]>=(0) AND [pct_vende]<=(100));

IF OBJECT_ID(N'dbo.CK_socios_config_regla', 'C') IS NULL
ALTER TABLE dbo.socios_config WITH CHECK ADD CONSTRAINT CK_socios_config_regla CHECK ([regla]='C' OR [regla]='B' OR [regla]='A');

IF OBJECT_ID(N'dbo.FK_socios_config_sin_dueno', 'F') IS NULL
ALTER TABLE dbo.socios_config WITH CHECK ADD CONSTRAINT FK_socios_config_sin_dueno FOREIGN KEY (sin_dueno_socio_id) REFERENCES dbo.socios (id);
