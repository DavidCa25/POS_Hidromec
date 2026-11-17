/* asistente_frases
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.asistente_frases', 'U') IS NULL
BEGIN
CREATE TABLE dbo.asistente_frases (
    id INT IDENTITY(1, 1) NOT NULL,
    texto NVARCHAR(400) COLLATE Modern_Spanish_CI_AS NOT NULL,
    intent VARCHAR(60) COLLATE Modern_Spanish_CI_AS NOT NULL,
    confirmado BIT NOT NULL CONSTRAINT DF_asistente_frases_confirmado DEFAULT ((1)),
    user_id INT NULL,
    en DATETIME2(0) NOT NULL CONSTRAINT DF_asistente_frases_en DEFAULT (sysdatetime()),
    CONSTRAINT PK_asistente_frases PRIMARY KEY CLUSTERED (id)
);
END;
