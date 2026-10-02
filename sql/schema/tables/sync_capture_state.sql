/* sync_capture_state
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.sync_capture_state', 'U') IS NULL
BEGIN
CREATE TABLE dbo.sync_capture_state (
    aggregate_type VARCHAR(30) COLLATE Modern_Spanish_CI_AS NOT NULL,
    last_rv BINARY(8) NOT NULL CONSTRAINT DF_sync_capture_state_rv DEFAULT (0x0000000000000000),
    updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_sync_capture_state_upd DEFAULT (sysutcdatetime()),
    CONSTRAINT PK_sync_capture_state PRIMARY KEY CLUSTERED (aggregate_type)
);
END;
