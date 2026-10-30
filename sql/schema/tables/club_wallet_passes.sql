/* club_wallet_passes
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.club_wallet_passes', 'U') IS NULL
BEGIN
CREATE TABLE dbo.club_wallet_passes (
    serial CHAR(24) COLLATE Modern_Spanish_CI_AS NOT NULL,
    phone_key VARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL,
    customer_name NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_club_wallet_passes_created DEFAULT (sysdatetime()),
    CONSTRAINT PK_club_wallet_passes PRIMARY KEY CLUSTERED (serial)
);
END;

IF OBJECT_ID(N'dbo.CK_club_wallet_passes_phone', 'C') IS NULL
ALTER TABLE dbo.club_wallet_passes WITH CHECK ADD CONSTRAINT CK_club_wallet_passes_phone CHECK (len([phone_key])=(10) AND NOT [phone_key] like '%[^0-9]%');

IF OBJECT_ID(N'dbo.CK_club_wallet_passes_serial', 'C') IS NULL
ALTER TABLE dbo.club_wallet_passes WITH CHECK ADD CONSTRAINT CK_club_wallet_passes_serial CHECK (NOT [serial] like '%[^0-9a-f]%');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_club_wallet_passes_phone' AND object_id = OBJECT_ID(N'dbo.club_wallet_passes'))
CREATE NONCLUSTERED INDEX IX_club_wallet_passes_phone ON dbo.club_wallet_passes (phone_key);
