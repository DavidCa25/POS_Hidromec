/*
 * Wybix — Baseline V1 · Infraestructura de versionado
 *
 * Estas dos tablas NO son esquema de producto: las usa el propio mecanismo de
 * migraciones. Por eso viven aqui y no en `sql/schema/tables/`, y por eso el
 * extractor de esquema las excluye — si se versionaran junto al producto, cada
 * instalacion produciria deriva falsa por el contenido de sus propias filas.
 *
 * `database_metadata` responde a una pregunta que `schema_migrations` no puede
 * responder tras un reseteo de historial: "¿desde que punto de partida nacio
 * esta base?". Sin ella, una base recien instalada y una base antigua a la que
 * se le hubiera vaciado la tabla de migraciones serian indistinguibles.
 */

IF OBJECT_ID('dbo.schema_migrations', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.schema_migrations (
        id         INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_schema_migrations PRIMARY KEY,
        filename   NVARCHAR(255)      NOT NULL CONSTRAINT UQ_schema_migrations_filename UNIQUE,
        applied_at DATETIME2(0)       NOT NULL CONSTRAINT DF_schema_migrations_applied_at DEFAULT SYSDATETIME()
    );
END
GO

IF OBJECT_ID('dbo.database_metadata', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.database_metadata (
        clave          NVARCHAR(64)  NOT NULL CONSTRAINT PK_database_metadata PRIMARY KEY,
        valor          NVARCHAR(255) NOT NULL,
        actualizado_en DATETIME2(0)  NOT NULL CONSTRAINT DF_database_metadata_actualizado_en DEFAULT SYSDATETIME()
    );
END
GO

/* El punto de partida de esta base. Lo escribe el constructor del baseline, no
 * el runner de migraciones: una migracion nunca debe cambiar este valor. */
IF NOT EXISTS (SELECT 1 FROM dbo.database_metadata WHERE clave = 'baseline_version')
    INSERT INTO dbo.database_metadata (clave, valor) VALUES ('baseline_version', '1');
GO
