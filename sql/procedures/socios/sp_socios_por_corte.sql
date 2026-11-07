/* sp_socios_por_corte
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ======================= sp_socios_por_corte (0079) =======================
   El conteo de cada caja: lo que le toca a cada socio de lo vendido en un
   corte (@closure_id), o en los cortes de un rango de dias.

   Una fila por corte y socio. Un turno abierto tambien sale: es el conteo
   de lo que va del dia.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_socios_por_corte
    @closure_id INT = NULL,
    @desde      DATE = NULL,
    @hasta      DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @closure_id IS NULL AND (@desde IS NULL OR @hasta IS NULL)
        THROW 51000, N'Indica el corte o el rango de días.', 1;

    EXEC dbo.sp_socios_asignar;

    SELECT c.id AS closure_id, c.register_id, r.name AS caja, c.opened_at, c.closed_at,
           x.socio_id, s.nombre,
           CAST(ROUND(SUM(x.ingreso), 2) AS DECIMAL(14, 2))  AS vendido,
           CAST(ROUND(SUM(x.costo), 2) AS DECIMAL(14, 2))    AS costo,
           CAST(ROUND(SUM(x.ganancia), 2) AS DECIMAL(14, 2)) AS ganancia,
           CAST(ROUND(SUM(x.total), 2) AS DECIMAL(14, 2))    AS le_toca
      FROM dbo.socios_reparto x
      JOIN dbo.sales v ON v.id = x.sale_id
      JOIN dbo.cash_closures c ON c.id = v.closure_id
      LEFT JOIN dbo.registers r ON r.id = c.register_id
      JOIN dbo.socios s ON s.id = x.socio_id
     WHERE (@closure_id IS NOT NULL AND c.id = @closure_id)
        OR (@closure_id IS NULL AND c.opened_at >= @desde
            AND c.opened_at < DATEADD(DAY, 1, CAST(@hasta AS DATETIME2(0))))
     GROUP BY c.id, c.register_id, r.name, c.opened_at, c.closed_at, x.socio_id, s.nombre, s.orden
     ORDER BY c.opened_at DESC, s.orden, x.socio_id;
END
GO
