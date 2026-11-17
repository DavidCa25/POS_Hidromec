/* asistente_descartes
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.asistente_descartes', 'U') IS NULL
BEGIN
CREATE TABLE dbo.asistente_descartes (
    id INT IDENTITY(1, 1) NOT NULL,
    alcance VARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL,
    valor NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NOT NULL,
    user_id INT NULL,
    motivo NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
    hasta DATETIME2(0) NULL,
    creado_en DATETIME2(0) NOT NULL CONSTRAINT DF_asistente_descartes_creado DEFAULT (sysdatetime()),
    CONSTRAINT PK_asistente_descartes PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_asistente_descartes_alcance', 'C') IS NULL
ALTER TABLE dbo.asistente_descartes WITH CHECK ADD CONSTRAINT CK_asistente_descartes_alcance CHECK ([alcance]='regla' OR [alcance]='clave');
