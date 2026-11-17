/* asistente_mensajes
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.asistente_mensajes', 'U') IS NULL
BEGIN
CREATE TABLE dbo.asistente_mensajes (
    id BIGINT IDENTITY(1, 1) NOT NULL,
    user_id INT NOT NULL,
    autor VARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL,
    texto NVARCHAR(1000) COLLATE Modern_Spanish_CI_AS NOT NULL,
    payload NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NULL,
    en DATETIME2(0) NOT NULL CONSTRAINT DF_asistente_mensajes_en DEFAULT (sysdatetime()),
    CONSTRAINT PK_asistente_mensajes PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_asistente_mensajes_autor', 'C') IS NULL
ALTER TABLE dbo.asistente_mensajes WITH CHECK ADD CONSTRAINT CK_asistente_mensajes_autor CHECK ([autor]='persona' OR [autor]='wybix');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_asistente_mensajes_user' AND object_id = OBJECT_ID(N'dbo.asistente_mensajes'))
CREATE NONCLUSTERED INDEX IX_asistente_mensajes_user ON dbo.asistente_mensajes (user_id, id DESC);
