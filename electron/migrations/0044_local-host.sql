/* ==========================================================================
   0044 — WYBIX LOCAL HOST: PANTALLAS DE COCINA POR LA RED LOCAL
   --------------------------------------------------------------------------
   Una tablet de cocina NUNCA habla con SQL Server. Habla con el Local Host
   (el proceso de Wybix en la computadora principal), que es quien toca la
   base con los procedimientos de siempre. Aqui vive lo que ese Host necesita:

   · local_host_lease          Quien es EL Host de esta base. Una fila, con
                               arriendo que caduca: dos equipos no pueden
                               servir la cocina de la misma base a la vez.
   · dispositivos_locales      Cada pantalla emparejada: su estacion, su
                               alcance y el HASH de su credencial (nunca la
                               credencial). Revocar la deja fuera.
   · dispositivos_emparejamientos
                               Los QR de emparejar: token de un solo uso, que
                               caduca, ligado a una estacion. Solo se guarda
                               su hash.
   · comandas.version          Un ROWVERSION. El Host pregunta «que cambio
                               desde la version N» y avisa a las pantallas.
                               La base sigue siendo la fuente de verdad: el
                               aviso en tiempo real solo dice «mira otra vez».

   La salida de una estacion ya contemplaba pantalla, impresora o ambas
   (`prep_stations.salida`): no se toca.
   ========================================================================== */

IF OBJECT_ID(N'dbo.local_host_lease', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.local_host_lease (
        id TINYINT NOT NULL CONSTRAINT PK_local_host_lease PRIMARY KEY
            CONSTRAINT CK_local_host_lease_uno CHECK (id = 1),
        machine_id NVARCHAR(64) NOT NULL,
        machine_name NVARCHAR(120) NULL,
        direccion NVARCHAR(200) NULL,
        puerto INT NULL,
        claimed_at DATETIME2(0) NOT NULL CONSTRAINT DF_local_host_claimed DEFAULT (SYSUTCDATETIME()),
        heartbeat_at DATETIME2(0) NOT NULL CONSTRAINT DF_local_host_heartbeat DEFAULT (SYSUTCDATETIME()),
        lease_until DATETIME2(0) NOT NULL
    );
END
GO

IF OBJECT_ID(N'dbo.dispositivos_locales', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.dispositivos_locales (
        id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_dispositivos_locales PRIMARY KEY
            CONSTRAINT DF_dispositivos_locales_id DEFAULT (NEWID()),
        nombre NVARCHAR(80) NOT NULL,
        alcance NVARCHAR(20) NOT NULL CONSTRAINT CK_dispositivos_locales_alcance CHECK (alcance IN ('KDS')),
        station_id INT NULL CONSTRAINT FK_dispositivos_locales_station REFERENCES dbo.prep_stations(id),
        /* «Todas las estaciones» es un alcance EXPLICITO, nunca el de omision. */
        todas BIT NOT NULL CONSTRAINT DF_dispositivos_locales_todas DEFAULT ((0)),
        credencial_hash CHAR(64) NOT NULL,
        emparejado_en DATETIME2(0) NOT NULL CONSTRAINT DF_dispositivos_locales_emp DEFAULT (SYSUTCDATETIME()),
        emparejado_por INT NULL,
        ultimo_contacto DATETIME2(0) NULL,
        ultima_ip NVARCHAR(64) NULL,
        agente NVARCHAR(200) NULL,
        revocado_en DATETIME2(0) NULL,
        revocado_por INT NULL,
        CONSTRAINT CK_dispositivos_locales_destino CHECK (todas = 1 OR station_id IS NOT NULL)
    );
    CREATE UNIQUE INDEX UX_dispositivos_locales_credencial ON dbo.dispositivos_locales(credencial_hash);
END
GO

IF OBJECT_ID(N'dbo.dispositivos_emparejamientos', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.dispositivos_emparejamientos (
        id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_dispositivos_emparejamientos PRIMARY KEY,
        token_hash CHAR(64) NOT NULL,
        alcance NVARCHAR(20) NOT NULL CONSTRAINT CK_dispositivos_emp_alcance CHECK (alcance IN ('KDS')),
        station_id INT NULL CONSTRAINT FK_dispositivos_emp_station REFERENCES dbo.prep_stations(id),
        todas BIT NOT NULL CONSTRAINT DF_dispositivos_emp_todas DEFAULT ((0)),
        nombre NVARCHAR(80) NOT NULL,
        creado_en DATETIME2(0) NOT NULL CONSTRAINT DF_dispositivos_emp_creado DEFAULT (SYSUTCDATETIME()),
        creado_por INT NULL,
        expira_en DATETIME2(0) NOT NULL,
        usado_en DATETIME2(0) NULL,
        dispositivo_id UNIQUEIDENTIFIER NULL
    );
    CREATE UNIQUE INDEX UX_dispositivos_emp_token ON dbo.dispositivos_emparejamientos(token_hash);
END
GO

IF COL_LENGTH(N'dbo.comandas', N'version') IS NULL
    ALTER TABLE dbo.comandas ADD version ROWVERSION;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_comandas_version' AND object_id = OBJECT_ID(N'dbo.comandas'))
    CREATE INDEX IX_comandas_version ON dbo.comandas(version) INCLUDE (station_id, estado);
GO
