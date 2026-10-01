/* import_mappings
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.import_mappings', 'U') IS NULL
BEGIN
CREATE TABLE dbo.import_mappings (
    id INT IDENTITY(1, 1) NOT NULL,
    nombre NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NOT NULL,
    huella NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NOT NULL,
    mapping_json NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NOT NULL,
    veces_usado INT NOT NULL CONSTRAINT DF_import_mappings_veces DEFAULT ((0)),
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_import_mappings_created DEFAULT (sysdatetime()),
    last_used_at DATETIME2(0) NULL,
    user_id INT NULL,
    CONSTRAINT PK_import_mappings PRIMARY KEY CLUSTERED (id),
    CONSTRAINT UQ_import_mappings_huella UNIQUE NONCLUSTERED (huella)
);
END;
