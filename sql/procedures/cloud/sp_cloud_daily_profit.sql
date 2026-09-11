/* sp_cloud_daily_profit
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_cloud_daily_profit
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        -- Ganancia estimada: margen por linea (precio de venta menos ultimo costo)
        ISNULL(SUM(sd.quantity * (sd.unitary_price - ISNULL(p.last_cost, 0))), 0) AS utilidad,
        -- Venta bruta (sin impuestos ni redondeos) para calcular el margen %
        ISNULL(SUM(sd.quantity * sd.unitary_price), 0)                            AS venta_bruta
    FROM sales s
    JOIN sale_detail sd ON sd.sale_id = s.id
    LEFT JOIN products p ON p.id = sd.product_id
    WHERE CAST(s.datee AS DATE) = CAST(GETDATE() AS DATE);
END
GO
