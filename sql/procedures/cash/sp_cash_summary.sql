/* sp_cash_summary
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Resumen de caja de los ultimos @days dias + pagos a proveedores + egresos.
   0049: "entradas" era todo lo que no fuera WITHDRAW -incluidos el fondo
   inicial, las devoluciones y los pagos a proveedor, que son negativos- y
   "salidas" solo los retiros, en negativo. Ahora las dos son lo que dicen:
   dinero que entro y dinero que salio del cajon, en positivo, sin contar el
   fondo inicial (no es dinero que entre: es el mismo que ya estaba).
   Retiros y egresos se dan aparte: un retiro no es un gasto. */
CREATE OR ALTER PROCEDURE dbo.sp_cash_summary
    @days INT = 30
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @desde DATE = DATEADD(DAY, -@days, CAST(GETDATE() AS DATE));

    SELECT
        ISNULL(SUM(CASE WHEN typee <> 'OPENING' AND amount < 0 THEN -amount ELSE 0 END), 0) AS salidas,
        ISNULL(SUM(CASE WHEN typee <> 'OPENING' AND amount > 0 THEN amount ELSE 0 END), 0) AS entradas,
        ISNULL(SUM(CASE WHEN typee = 'WITHDRAW' THEN -amount ELSE 0 END), 0) AS retiros,
        SUM(CASE WHEN typee <> 'OPENING' THEN 1 ELSE 0 END) AS movimientos,
        (SELECT ISNULL(SUM(amount), 0) FROM dbo.supplier_payments
          WHERE datee >= @desde) AS pagos_proveedores,
        /* Todos los egresos, salgan o no del cajon (una renta por
           transferencia tambien es un egreso). Los cancelados no cuentan. */
        (SELECT ISNULL(SUM(amount), 0) FROM dbo.expenses
          WHERE expense_date >= @desde AND voided_at IS NULL) AS egresos
    FROM dbo.cash_movements
    WHERE datee >= @desde;
END
GO
