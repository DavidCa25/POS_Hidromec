/* propinas_config
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.propinas_config', 'U') IS NULL
BEGIN
CREATE TABLE dbo.propinas_config (
    id TINYINT NOT NULL,
    reparto VARCHAR(8) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_propinas_config_reparto DEFAULT ('HORAS'),
    sugeridas VARCHAR(40) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_propinas_config_sug DEFAULT ('10,15,20'),
    comision_pct DECIMAL(5, 2) NOT NULL CONSTRAINT DF_propinas_config_com DEFAULT ((0)),
    comision_a VARCHAR(8) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_propinas_config_coma DEFAULT ('NEGOCIO'),
    updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_propinas_config_upd DEFAULT (sysdatetime()),
    updated_by INT NULL,
    CONSTRAINT PK_propinas_config PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_propinas_config_com', 'C') IS NULL
ALTER TABLE dbo.propinas_config WITH CHECK ADD CONSTRAINT CK_propinas_config_com CHECK ([comision_pct]>=(0) AND [comision_pct]<=(20));

IF OBJECT_ID(N'dbo.CK_propinas_config_coma', 'C') IS NULL
ALTER TABLE dbo.propinas_config WITH CHECK ADD CONSTRAINT CK_propinas_config_coma CHECK ([comision_a]='PROPINA' OR [comision_a]='NEGOCIO');

IF OBJECT_ID(N'dbo.CK_propinas_config_id', 'C') IS NULL
ALTER TABLE dbo.propinas_config WITH CHECK ADD CONSTRAINT CK_propinas_config_id CHECK ([id]=(1));

IF OBJECT_ID(N'dbo.CK_propinas_config_reparto', 'C') IS NULL
ALTER TABLE dbo.propinas_config WITH CHECK ADD CONSTRAINT CK_propinas_config_reparto CHECK ([reparto]='IGUALES' OR [reparto]='HORAS' OR [reparto]='ATENDIO');
