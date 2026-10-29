SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_club_wallet_customer (0066) =====================
   Lo que la nube necesita para emitir la tarjeta de un cliente: su nombre,
   su teléfono normalizado (últimos 10 dígitos de mobile o phone) y, si ya
   tiene, el serial de su pase.

   Devuelve una fila: { customer_id, customer_name, phone_key, serial }
   phone_key NULL = el cliente no tiene un teléfono de 10 dígitos.
   ============================================================================ */
CREATE OR ALTER PROCEDURE dbo.sp_club_wallet_customer
    @customer_id INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT c.id AS customer_id, c.customerName AS customer_name,
           CASE WHEN LEN(t.tel) = 10 AND t.tel NOT LIKE '%[^0-9]%' THEN t.tel END AS phone_key,
           (SELECT TOP 1 w.serial FROM dbo.club_wallet_passes w WHERE w.phone_key = t.tel ORDER BY w.created_at) AS serial
      FROM dbo.customers c
     CROSS APPLY (SELECT RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(NULLIF(c.mobile, N''), ISNULL(c.phone, N'')), N' ', N''), N'-', N''), N'(', N''), N')', N''), N'+', N''), N'.', N''), 10) AS tel) t
     WHERE c.id = @customer_id;
END
GO
