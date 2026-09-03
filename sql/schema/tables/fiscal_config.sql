/* fiscal_config
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.fiscal_config', 'U') IS NULL
BEGIN
CREATE TABLE dbo.fiscal_config (
    id INT IDENTITY(1, 1) NOT NULL,
    rfc NVARCHAR(13) COLLATE Modern_Spanish_CI_AS NOT NULL,
    razon_social NVARCHAR(255) COLLATE Modern_Spanish_CI_AS NOT NULL,
    regimen_fiscal NVARCHAR(5) COLLATE Modern_Spanish_CI_AS NOT NULL,
    codigo_postal NVARCHAR(5) COLLATE Modern_Spanish_CI_AS NOT NULL,
    serie NVARCHAR(25) COLLATE Modern_Spanish_CI_AS NULL,
    fiscalapi_issuer_id NVARCHAR(100) COLLATE Modern_Spanish_CI_AS NULL,
    csd_registrado BIT NOT NULL DEFAULT ((0)),
    activo BIT NOT NULL DEFAULT ((1)),
    created_at DATETIME2(0) NOT NULL DEFAULT (sysdatetime()),
    updated_at DATETIME2(0) NOT NULL DEFAULT (sysdatetime()),
    PRIMARY KEY CLUSTERED (id)
);
END;
