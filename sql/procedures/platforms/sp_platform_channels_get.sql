/* sp_platform_channels_get
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_platform_channels_get (0069) =====================
   Los canales de venta del negocio (los de la politica comercial, menos
   Mostrador) y la plataforma de entrega que cada uno representa, si ya se
   eligio. Trae tambien cuantas ventas pagadas en plataforma tuvo cada canal
   en los ultimos 90 dias, para que se note cual falta ligar.

     1  canales          channel_id, nombre, activo, plataforma, ventas_90d
     2  sin canal        ventas pagadas en plataforma sin canal de plataforma
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_platform_channels_get
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @desde DATETIME2(0) = DATEADD(DAY, -90, CAST(GETDATE() AS DATE));

    ;WITH ventas AS (
        SELECT JSON_VALUE(s.commercial_snapshot, '$.channel') AS channel_id
          FROM dbo.sales s
         WHERE s.datee >= @desde
           AND (EXISTS (SELECT 1 FROM dbo.sale_payments p WHERE p.sale_id = s.id AND p.payment_method = 'PLATAFORMA')
                OR (s.payment_method = 'PLATAFORMA' AND NOT EXISTS (SELECT 1 FROM dbo.sale_payments p WHERE p.sale_id = s.id))))
    SELECT c.id AS channel_id, c.name AS nombre, c.active AS activo, pc.platform AS plataforma,
           (SELECT COUNT(*) FROM ventas v WHERE v.channel_id = c.id) AS ventas_90d
      FROM dbo.commercial_policy p
     CROSS APPLY OPENJSON(p.payload, '$.channels') WITH (id NVARCHAR(64), name NVARCHAR(120), active BIT) c
      LEFT JOIN dbo.platform_channels pc ON pc.channel_id = c.id
     WHERE p.id = 1 AND c.id <> N'LOCAL'
     ORDER BY CASE WHEN pc.platform IS NULL THEN 1 ELSE 0 END, c.name;

    SELECT COUNT(*) AS ventas, CAST(ISNULL(SUM(ISNULL(p.amount, s.total)), 0) AS DECIMAL(14, 2)) AS importe
      FROM dbo.sales s
      LEFT JOIN dbo.sale_payments p ON p.sale_id = s.id AND p.payment_method = 'PLATAFORMA'
      LEFT JOIN dbo.platform_channels pc ON pc.channel_id = JSON_VALUE(s.commercial_snapshot, '$.channel')
     WHERE s.datee >= @desde AND pc.channel_id IS NULL
       AND (p.id IS NOT NULL OR (s.payment_method = 'PLATAFORMA' AND NOT EXISTS (SELECT 1 FROM dbo.sale_payments x WHERE x.sale_id = s.id)));
END
GO
