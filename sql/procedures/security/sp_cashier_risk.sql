/* sp_cashier_risk
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 5) Índice de riesgo por cajero (semáforo bajo/medio/alto) */
CREATE OR ALTER PROCEDURE dbo.sp_cashier_risk
    @from DATE = NULL, @to DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @from IS NULL SET @from = DATEADD(DAY, -30, CAST(GETDATE() AS DATE));
    IF @to   IS NULL SET @to   = CAST(GETDATE() AS DATE);

    ;WITH agg AS (
        SELECT u.id AS user_id, u.usuario AS cajero,
            SUM(CASE WHEN e.event_type = 'VOID_SALE'      THEN 1 ELSE 0 END) AS anuladas,
            SUM(CASE WHEN e.event_type = 'REFUND'         THEN 1 ELSE 0 END) AS devoluciones,
            SUM(CASE WHEN e.event_type = 'DRAWER_NO_SALE' THEN 1 ELSE 0 END) AS cajon_sin_venta,
            SUM(CASE WHEN e.event_type = 'ITEM_REMOVED'   THEN 1 ELSE 0 END) AS eliminados,
            SUM(CASE WHEN e.event_type IN ('DISCOUNT','PRICE_CHANGE') THEN 1 ELSE 0 END) AS descuentos,
            SUM(ISNULL(e.amount, 0)) AS monto_riesgo
        FROM dbo.users u
        LEFT JOIN dbo.security_events e
            ON e.user_id = u.id AND e.datee >= @from AND e.datee < DATEADD(DAY, 1, @to)
        WHERE u.rol IN ('cajero','supervisor','admin')
        GROUP BY u.id, u.usuario
    ),
    scored AS (
        SELECT *,
            (anuladas*8 + devoluciones*6 + cajon_sin_venta*5 + eliminados*3 + descuentos*4) AS raw
        FROM agg
    )
    SELECT user_id, cajero, anuladas, devoluciones, cajon_sin_venta, eliminados, descuentos, monto_riesgo,
        CASE WHEN raw > 100 THEN 100 ELSE raw END AS score,
        CASE WHEN raw >= 60 THEN 'alto' WHEN raw >= 30 THEN 'medio' ELSE 'bajo' END AS nivel
    FROM scored
    ORDER BY raw DESC;
END
GO
