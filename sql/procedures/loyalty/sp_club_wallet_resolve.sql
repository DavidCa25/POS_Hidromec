SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_club_wallet_resolve (0066) =====================
   La caja leyó el código de un pase (`WXC-<serial>`): ¿qué cliente es?

   Por su teléfono (últimos 10 dígitos de mobile o phone), igual que el Club
   y los puntos reconocen al cliente. Si el pase se emitió en otra sucursal
   y aquí no existe ese cliente, se da de alta con su nombre y teléfono -como
   hacen sp_membership_apply_remote y sp_loyalty_points_apply_remote-.

   Devuelve una fila: { customer_id, serial, phone_key, customer_name, pase }
     pase = 0 -> el serial no está en esta caja (la IPC pregunta a la nube).
   ============================================================================ */
CREATE OR ALTER PROCEDURE dbo.sp_club_wallet_resolve
    @serial VARCHAR(40)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @s CHAR(24) = LOWER(LTRIM(RTRIM(@serial))), @tel VARCHAR(10), @nombre NVARCHAR(120), @cliente INT;
    SELECT @tel = phone_key, @nombre = customer_name FROM dbo.club_wallet_passes WHERE serial = @s;
    IF @tel IS NULL
    BEGIN
        SELECT CAST(NULL AS INT) AS customer_id, @s AS serial, CAST(NULL AS VARCHAR(10)) AS phone_key, CAST(NULL AS NVARCHAR(120)) AS customer_name, CAST(0 AS BIT) AS pase;
        RETURN;
    END

    SELECT TOP 1 @cliente = id FROM dbo.customers
     WHERE RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(NULLIF(mobile, N''), ISNULL(phone, N'')), N' ', N''), N'-', N''), N'(', N''), N')', N''), N'+', N''), N'.', N''), 10) = @tel
     ORDER BY active DESC, id;

    IF @cliente IS NULL AND @nombre IS NOT NULL
    BEGIN
        INSERT INTO dbo.customers (customerName, phone, active) VALUES (@nombre, @tel, 1);
        SET @cliente = SCOPE_IDENTITY();
    END

    SELECT @cliente AS customer_id, @s AS serial, @tel AS phone_key,
           ISNULL((SELECT customerName FROM dbo.customers WHERE id = @cliente), @nombre) AS customer_name, CAST(1 AS BIT) AS pase;
END
GO
