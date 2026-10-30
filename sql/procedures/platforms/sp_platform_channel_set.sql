/* sp_platform_channel_set
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_platform_channel_set (0069) =====================
   Liga un canal de venta con su plataforma (UBER_EATS, DIDI_FOOD, RAPPI), o
   lo desliga con @platform = NULL. Mostrador nunca es una plataforma.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_platform_channel_set
    @channel_id NVARCHAR(64),
    @platform   VARCHAR(12) = NULL,
    @user_id    INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET @channel_id = NULLIF(LTRIM(RTRIM(@channel_id)), N'');
    SET @platform = NULLIF(UPPER(LTRIM(RTRIM(@platform))), '');

    IF @channel_id IS NULL OR @channel_id = N'LOCAL'
        THROW 51000, 'Elige un canal de venta que no sea Mostrador.', 1;
    IF @platform IS NOT NULL AND @platform NOT IN ('UBER_EATS', 'DIDI_FOOD', 'RAPPI')
        THROW 51000, 'Plataforma no admitida.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.commercial_policy p
                    CROSS APPLY OPENJSON(p.payload, '$.channels') WITH (id NVARCHAR(64)) c
                    WHERE p.id = 1 AND c.id = @channel_id)
        THROW 51000, 'Ese canal de venta no existe.', 1;

    IF @platform IS NULL
        DELETE FROM dbo.platform_channels WHERE channel_id = @channel_id;
    ELSE IF EXISTS (SELECT 1 FROM dbo.platform_channels WHERE channel_id = @channel_id)
        UPDATE dbo.platform_channels SET platform = @platform, updated_at = SYSDATETIME(), updated_by = @user_id
         WHERE channel_id = @channel_id;
    ELSE
        INSERT INTO dbo.platform_channels (channel_id, platform, updated_by) VALUES (@channel_id, @platform, @user_id);

    SELECT @channel_id AS channel_id, @platform AS plataforma;
END
GO
