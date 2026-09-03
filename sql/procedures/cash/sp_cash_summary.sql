/* sp_cash_summary
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Resumen de caja de los ultimos @days dias + pagos a proveedores */
CREATE OR ALTER PROCEDURE dbo.sp_cash_summary
    @days INT = 30
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        ISNULL(SUM(CASE WHEN typee = 'WITHDRAW' THEN amount ELSE 0 END), 0) AS salidas,
        ISNULL(SUM(CASE WHEN typee <> 'WITHDRAW' THEN amount ELSE 0 END), 0) AS entradas,
        COUNT(*) AS movimientos,
        (SELECT ISNULL(SUM(amount), 0) FROM supplier_payments
          WHERE datee >= DATEADD(DAY, -@days, CAST(GETDATE() AS DATE))) AS pagos_proveedores
    FROM cash_movements
    WHERE datee >= DATEADD(DAY, -@days, CAST(GETDATE() AS DATE));
END
GO
