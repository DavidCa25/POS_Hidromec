/* register_assignments
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.register_assignments', 'U') IS NULL
BEGIN
CREATE TABLE dbo.register_assignments (
    register_id INT NOT NULL,
    machine_id NVARCHAR(64) COLLATE Modern_Spanish_CI_AS NOT NULL,
    machine_name NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL,
    claimed_at DATETIME2(0) NOT NULL CONSTRAINT DF_register_assignments_claimed_at DEFAULT (sysutcdatetime()),
    heartbeat_at DATETIME2(0) NOT NULL CONSTRAINT DF_register_assignments_heartbeat_at DEFAULT (sysutcdatetime()),
    lease_until DATETIME2(0) NOT NULL CONSTRAINT DF_register_assignments_lease_until DEFAULT (sysutcdatetime()),
    released_at DATETIME2(0) NULL,
    released_by NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NULL,
    CONSTRAINT PK_register_assignments PRIMARY KEY CLUSTERED (register_id)
);
END;

IF OBJECT_ID(N'dbo.FK_register_assignments_register', 'F') IS NULL
ALTER TABLE dbo.register_assignments WITH CHECK ADD CONSTRAINT FK_register_assignments_register FOREIGN KEY (register_id) REFERENCES dbo.registers (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_register_assignments_machine' AND object_id = OBJECT_ID(N'dbo.register_assignments'))
CREATE NONCLUSTERED INDEX IX_register_assignments_machine ON dbo.register_assignments (machine_id) INCLUDE (lease_until, released_at);
