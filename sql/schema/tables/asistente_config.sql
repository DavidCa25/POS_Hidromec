/* asistente_config
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.asistente_config', 'U') IS NULL
BEGIN
CREATE TABLE dbo.asistente_config (
    regla VARCHAR(80) COLLATE Modern_Spanish_CI_AS NOT NULL,
    activa BIT NOT NULL CONSTRAINT DF_asistente_config_activa DEFAULT ((1)),
    umbrales NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NULL,
    actualizado_en DATETIME2(0) NOT NULL CONSTRAINT DF_asistente_config_actualizado DEFAULT (sysdatetime()),
    user_id INT NULL,
    CONSTRAINT PK_asistente_config PRIMARY KEY CLUSTERED (regla)
);
END;
