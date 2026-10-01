/* local_host_lease
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.local_host_lease', 'U') IS NULL
BEGIN
CREATE TABLE dbo.local_host_lease (
    id TINYINT NOT NULL,
    machine_id NVARCHAR(64) COLLATE Modern_Spanish_CI_AS NOT NULL,
    machine_name NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL,
    direccion NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
    puerto INT NULL,
    claimed_at DATETIME2(0) NOT NULL CONSTRAINT DF_local_host_claimed DEFAULT (sysutcdatetime()),
    heartbeat_at DATETIME2(0) NOT NULL CONSTRAINT DF_local_host_heartbeat DEFAULT (sysutcdatetime()),
    lease_until DATETIME2(0) NOT NULL,
    CONSTRAINT PK_local_host_lease PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_local_host_lease_uno', 'C') IS NULL
ALTER TABLE dbo.local_host_lease WITH CHECK ADD CONSTRAINT CK_local_host_lease_uno CHECK ([id]=(1));
