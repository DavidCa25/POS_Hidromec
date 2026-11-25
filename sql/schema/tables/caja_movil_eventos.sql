/* caja_movil_eventos
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.caja_movil_eventos', 'U') IS NULL
BEGIN
CREATE TABLE dbo.caja_movil_eventos (
    event_uuid UNIQUEIDENTIFIER NOT NULL,
    dispositivo_id UNIQUEIDENTIFIER NOT NULL,
    event_type NVARCHAR(40) COLLATE Modern_Spanish_CI_AS NOT NULL,
    resultado VARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL,
    referencia NVARCHAR(100) COLLATE Modern_Spanish_CI_AS NULL,
    error NVARCHAR(300) COLLATE Modern_Spanish_CI_AS NULL,
    recibido_en DATETIME2(0) NOT NULL CONSTRAINT DF_caja_movil_eventos_recibido DEFAULT (sysutcdatetime()),
    CONSTRAINT PK_caja_movil_eventos PRIMARY KEY CLUSTERED (event_uuid)
);
END;

IF OBJECT_ID(N'dbo.CK_caja_movil_eventos_resultado', 'C') IS NULL
ALTER TABLE dbo.caja_movil_eventos WITH CHECK ADD CONSTRAINT CK_caja_movil_eventos_resultado CHECK ([resultado]='REJECTED' OR [resultado]='APPLIED');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_caja_movil_eventos_dispositivo' AND object_id = OBJECT_ID(N'dbo.caja_movil_eventos'))
CREATE NONCLUSTERED INDEX IX_caja_movil_eventos_dispositivo ON dbo.caja_movil_eventos (dispositivo_id, recibido_en);
