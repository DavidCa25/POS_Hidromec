/* sp_cloud_daily_summary
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ------------------------------------------------------------
   1) Resumen de ventas del dia
   Total, numero de tickets, ticket promedio y desglose por
   forma de pago. Opcionalmente filtra por caja.
   ------------------------------------------------------------ */
CREATE OR ALTER PROCEDURE [dbo].[sp_cloud_daily_summary]
    @fecha DATE = NULL,
    @register_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @fecha IS NULL SET @fecha = CAST(GETDATE() AS DATE);

    SELECT
        @fecha AS fecha,
        ISNULL(SUM(s.total), 0)                                        AS total,
        COUNT(*)                                                       AS num_tickets,
        CASE WHEN COUNT(*) = 0 THEN 0
             ELSE CAST(ISNULL(SUM(s.total),0) / COUNT(*) AS DECIMAL(12,2))
        END                                                            AS ticket_promedio,
        ISNULL(SUM(CASE WHEN UPPER(s.payment_method) = 'EFECTIVO' THEN s.total ELSE 0 END), 0)   AS total_efectivo,
        ISNULL(SUM(CASE WHEN UPPER(s.payment_method) IN ('TARJETA','TERMINAL_MP') THEN s.total ELSE 0 END), 0) AS total_tarjeta,
        ISNULL(SUM(CASE WHEN UPPER(s.payment_method) = 'CREDITO' THEN s.total ELSE 0 END), 0)    AS total_credito,
        ISNULL(SUM(CASE WHEN UPPER(s.payment_method) = 'TRANSFERENCIA' THEN s.total ELSE 0 END), 0) AS total_transferencia
    FROM dbo.sales s
    WHERE CAST(s.datee AS DATE) = @fecha
      AND (@register_id IS NULL OR s.register_id = @register_id);
END
GO
