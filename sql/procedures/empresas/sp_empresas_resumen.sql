/* sp_empresas_resumen
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ======================== sp_empresas_resumen (0080) ======================
   Lo que "Mis empresas" ensena de ESTA empresa en un periodo. Cada base
   responde la suya; el proceso principal las pone lado a lado.

   ventas, tickets   lo cobrado (sales.total) y cuantas ventas.
   utilidad          la misma cuenta que Reportes (sp_get_profit_overview):
                     venta sin IVA menos costo, menos lo que descuentan las
                     plataformas. El numero coincide con el que el dueno ve
                     dentro de la empresa.
   turnos_abiertos   turnos sin cerrar ahora mismo.
   efectivo_en_caja  lo que deberia haber en los cajones de esos turnos:
                     fondo inicial + movimientos (la regla de sp_close_shift).
   ultima_venta      la mas reciente, de cualquier fecha.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_empresas_resumen
    @desde DATE = NULL,
    @hasta DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @desde IS NULL SET @desde = CAST(GETDATE() AS DATE);
    IF @hasta IS NULL SET @hasta = @desde;
    IF @hasta < @desde SET @hasta = @desde;

    DECLARE @utilidad TABLE (datee DATE, profit DECIMAL(18, 4));
    INSERT INTO @utilidad (datee, profit)
    EXEC dbo.sp_get_profit_overview @from_date = @desde, @to_date = @hasta;

    DECLARE @abiertos TABLE (id INT PRIMARY KEY, register_id INT, opened_at DATETIME2(0), opening_cash DECIMAL(10, 2));
    INSERT INTO @abiertos (id, register_id, opened_at, opening_cash)
    SELECT id, register_id, opened_at, opening_cash FROM dbo.cash_closures WHERE closed_at IS NULL;

    SELECT
        CAST(ISNULL((SELECT SUM(s.total) FROM dbo.sales s
                      WHERE s.datee >= @desde AND s.datee < DATEADD(DAY, 1, @hasta)), 0) AS DECIMAL(18, 2)) AS ventas,
        (SELECT COUNT(*) FROM dbo.sales s
          WHERE s.datee >= @desde AND s.datee < DATEADD(DAY, 1, @hasta)) AS tickets,
        CAST(ISNULL((SELECT SUM(profit) FROM @utilidad), 0) AS DECIMAL(18, 2)) AS utilidad,
        (SELECT COUNT(*) FROM @abiertos) AS turnos_abiertos,
        CAST(ISNULL((SELECT SUM(opening_cash) FROM @abiertos), 0)
           + ISNULL((SELECT SUM(m.amount)
                       FROM dbo.cash_movements m
                      WHERE m.typee <> 'OPENING'
                        AND EXISTS (SELECT 1 FROM @abiertos a
                                     WHERE m.closure_id = a.id
                                        OR (m.closure_id IS NULL AND m.register_id = a.register_id
                                            AND m.datee >= a.opened_at))), 0) AS DECIMAL(18, 2)) AS efectivo_en_caja,
        (SELECT MAX(s.datee) FROM dbo.sales s) AS ultima_venta;
END;
GO
