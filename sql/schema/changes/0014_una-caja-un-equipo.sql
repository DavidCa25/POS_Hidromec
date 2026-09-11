/* ---------------------------------------------------------------------------
   BLOQUE DE ESQUEMA — una caja, un equipo.

   Crea `register_assignments` y le siembra una fila LIBRE por cada caja que ya
   exista. La siembra es lo que hace que la actualizacion no le cambie nada a
   nadie: al arrancar, cada equipo reclama la caja que ya tenia guardada en su
   `device-config.json` y la toma sin conflicto, porque nadie mas la tiene.

   Idempotente: se puede reejecutar. Ni la tabla se duplica ni las filas.
   No toca `registers`, ni `cash_closures`, ni `sales`: ningun turno ni ninguna
   venta historica cambia.
   --------------------------------------------------------------------------- */

IF OBJECT_ID(N'dbo.register_assignments', 'U') IS NULL
BEGIN
CREATE TABLE dbo.register_assignments (
    register_id  INT NOT NULL,
    machine_id   NVARCHAR(64) COLLATE Modern_Spanish_CI_AS NOT NULL,
    machine_name NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL,
    claimed_at   DATETIME2(0) NOT NULL CONSTRAINT DF_register_assignments_claimed_at DEFAULT (sysutcdatetime()),
    heartbeat_at DATETIME2(0) NOT NULL CONSTRAINT DF_register_assignments_heartbeat_at DEFAULT (sysutcdatetime()),
    lease_until  DATETIME2(0) NOT NULL CONSTRAINT DF_register_assignments_lease_until DEFAULT (sysutcdatetime()),
    released_at  DATETIME2(0) NULL,
    released_by  NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NULL,
    CONSTRAINT PK_register_assignments PRIMARY KEY CLUSTERED (register_id),
    CONSTRAINT FK_register_assignments_register FOREIGN KEY (register_id)
        REFERENCES dbo.registers (id)
);
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_register_assignments_machine' AND object_id = OBJECT_ID(N'dbo.register_assignments'))
CREATE NONCLUSTERED INDEX IX_register_assignments_machine ON dbo.register_assignments (machine_id) INCLUDE (lease_until, released_at);
GO

/* Una fila LIBRE por caja existente. `machine_id` vacio no coincide con
   ninguna maquina real, y `released_at` puesto la deja disponible: la primera
   que la reclame se la lleva. */
INSERT INTO dbo.register_assignments
    (register_id, machine_id, machine_name, claimed_at, heartbeat_at, lease_until, released_at, released_by)
SELECT r.id, N'', NULL, SYSUTCDATETIME(), SYSUTCDATETIME(), SYSUTCDATETIME(), SYSUTCDATETIME(), N'INICIAL'
FROM dbo.registers r
WHERE NOT EXISTS (SELECT 1 FROM dbo.register_assignments a WHERE a.register_id = r.id);
