/* sp_production_suggestions
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0090 · «HOY CONVIENE HACER»: cuanto producir de cada producto con formula.

   El dia de la semana manda: una panaderia vende distinto el lunes que el
   sabado. Se toma lo vendido ESE dia de la semana en las ultimas 4 semanas
   (los dias sin venta cuentan como 0, para no inflar el promedio) y se le
   resta lo que ya hay y lo que ya esta planeado o en preparacion hoy. Lo que
   falta se redondea hacia arriba a tandas completas (el rinde de la formula).

   Solo lee. Planear sigue siendo un toque de la persona (sp_production_plan). */
CREATE OR ALTER PROCEDURE dbo.sp_production_suggestions
    @production_date DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @production_date = ISNULL(@production_date, CAST(GETDATE() AS DATE));
    DECLARE @desde DATE = DATEADD(DAY, -28, @production_date);
    DECLARE @dia INT = DATEPART(WEEKDAY, @production_date);

    ;WITH vendido AS (
        SELECT sd.product_id, SUM(sd.quantity) AS piezas
          FROM dbo.sale_detail sd
          JOIN dbo.sales s ON s.id = sd.sale_id
         WHERE s.datee >= @desde AND s.datee < @production_date
           AND DATEPART(WEEKDAY, s.datee) = @dia
         GROUP BY sd.product_id
    ),
    en_curso AS (
        SELECT b.product_id, SUM(b.planned_qty) AS piezas
          FROM dbo.production_batches b
         WHERE (b.production_date = @production_date AND b.status = 'PLANNED') OR b.status = 'IN_PROGRESS'
         GROUP BY b.product_id
    ),
    calc AS (
        SELECT f.product_id, p.nombre AS product_name, f.yield_qty,
               CAST(p.stock AS DECIMAL(18, 2)) AS stock,
               CAST(ISNULL(v.piezas, 0) / 4.0 AS DECIMAL(18, 2)) AS promedio_dia,
               CAST(ISNULL(c.piezas, 0) AS DECIMAL(18, 2)) AS en_curso
          FROM dbo.production_formulas f
          JOIN dbo.products p ON p.id = f.product_id
          LEFT JOIN vendido v ON v.product_id = f.product_id
          LEFT JOIN en_curso c ON c.product_id = f.product_id
         WHERE p.active = 1 AND p.inventory_mode = 'DIRECT'
    )
    SELECT product_id, product_name, yield_qty, stock, promedio_dia, en_curso,
           CAST(CASE WHEN promedio_dia - stock - en_curso <= 0 THEN 0
                     ELSE CEILING((promedio_dia - stock - en_curso) / yield_qty) * yield_qty END AS DECIMAL(18, 2)) AS sugerido
      FROM calc
     WHERE promedio_dia > 0
     ORDER BY CASE WHEN promedio_dia - stock - en_curso > 0 THEN 0 ELSE 1 END, promedio_dia DESC, product_name;
END
GO
