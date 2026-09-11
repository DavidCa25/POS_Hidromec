/* sp_security_by_cashier
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 4) Resumen de eventos por cajero (para alertas) */
CREATE OR ALTER PROCEDURE dbo.sp_security_by_cashier
    @from DATE = NULL, @to DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @from IS NULL SET @from = DATEADD(DAY, -30, CAST(GETDATE() AS DATE));
    IF @to   IS NULL SET @to   = CAST(GETDATE() AS DATE);

    SELECT u.id AS user_id, u.usuario AS cajero,
        SUM(CASE WHEN e.event_type = 'VOID_SALE'      THEN 1 ELSE 0 END) AS anuladas,
        SUM(CASE WHEN e.event_type = 'REFUND'         THEN 1 ELSE 0 END) AS devoluciones,
        SUM(CASE WHEN e.event_type = 'DRAWER_NO_SALE' THEN 1 ELSE 0 END) AS cajon_sin_venta,
        SUM(CASE WHEN e.event_type = 'ITEM_REMOVED'   THEN 1 ELSE 0 END) AS eliminados,
        SUM(CASE WHEN e.event_type IN ('DISCOUNT','PRICE_CHANGE') THEN 1 ELSE 0 END) AS descuentos,
        SUM(CASE WHEN e.event_type = 'INV_ADJUST'     THEN 1 ELSE 0 END) AS ajustes_inv,
        SUM(ISNULL(e.amount, 0)) AS monto_riesgo
    FROM dbo.users u
    LEFT JOIN dbo.security_events e
        ON e.user_id = u.id AND e.datee >= @from AND e.datee < DATEADD(DAY, 1, @to)
    WHERE u.rol IN ('cajero','supervisor','admin')
    GROUP BY u.id, u.usuario
    ORDER BY monto_riesgo DESC;
END
GO
