/* ============================================================
   0066 — Tarjeta del Club en Wallet (esquema)

   club_wallet_passes   Los pases de Apple Wallet / Google Wallet que la
                        nube emitió para clientes de esta empresa. El
                        código del pase dice `WXC-<serial>`: con esta tabla
                        la caja sabe de quién es SIN internet. Llegan al
                        emitir uno aquí y por club_pull (`wallet_passes`),
                        los emitidos en otras sucursales.

                        phone_key = últimos 10 dígitos del teléfono, la
                        misma llave con la que el Club reconoce al cliente.

   Aditiva: nada existente cambia de significado.
   ============================================================ */

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID(N'dbo.club_wallet_passes', N'U') IS NULL
    CREATE TABLE dbo.club_wallet_passes (
        serial          CHAR(24)      NOT NULL,
        phone_key       VARCHAR(10)   NOT NULL,
        customer_name   NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL,
        created_at      DATETIME2(0)  NOT NULL CONSTRAINT DF_club_wallet_passes_created DEFAULT SYSDATETIME(),
        CONSTRAINT PK_club_wallet_passes PRIMARY KEY (serial),
        CONSTRAINT CK_club_wallet_passes_serial CHECK (serial NOT LIKE '%[^0-9a-f]%'),
        CONSTRAINT CK_club_wallet_passes_phone CHECK (LEN(phone_key) = 10 AND phone_key NOT LIKE '%[^0-9]%')
    );
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_club_wallet_passes_phone' AND object_id = OBJECT_ID(N'dbo.club_wallet_passes'))
    CREATE NONCLUSTERED INDEX IX_club_wallet_passes_phone ON dbo.club_wallet_passes (phone_key);
GO
