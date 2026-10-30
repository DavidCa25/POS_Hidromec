/* platform_channels
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.platform_channels', 'U') IS NULL
BEGIN
CREATE TABLE dbo.platform_channels (
    channel_id NVARCHAR(64) COLLATE Modern_Spanish_CI_AS NOT NULL,
    platform VARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL,
    updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_platform_channels_updated DEFAULT (sysdatetime()),
    updated_by INT NULL,
    CONSTRAINT PK_platform_channels PRIMARY KEY CLUSTERED (channel_id)
);
END;

IF OBJECT_ID(N'dbo.CK_platform_channels_local', 'C') IS NULL
ALTER TABLE dbo.platform_channels WITH CHECK ADD CONSTRAINT CK_platform_channels_local CHECK ([channel_id]<>N'LOCAL');

IF OBJECT_ID(N'dbo.CK_platform_channels_platform', 'C') IS NULL
ALTER TABLE dbo.platform_channels WITH CHECK ADD CONSTRAINT CK_platform_channels_platform CHECK ([platform]='RAPPI' OR [platform]='DIDI_FOOD' OR [platform]='UBER_EATS');
