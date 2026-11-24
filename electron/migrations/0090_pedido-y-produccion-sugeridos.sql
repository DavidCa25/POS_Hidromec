/* ============================================================
   0090 — pedido y produccion sugeridos

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   NO toca tablas ni datos. Solo objetos programables.
   ============================================================ */

/* ---------- sp_production_suggestions (SQL_STORED_PROCEDURE) ---------- */
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

/* ---------- sp_purchase_order_suggestions (SQL_STORED_PROCEDURE) ---------- */
/* sp_purchase_order_suggestions
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0090 · EL PEDIDO SUGERIDO, POR PROVEEDOR.

   Lo que se acaba lo dice sp_reorder_suggestions (mismo ritmo, mismas reglas:
   solo DIRECT se compra; una receta se repone comprando su ingrediente). Aqui
   solo se le agrega a quien comprarselo y cuanto pedir:

     proveedor   el predeterminado del producto (product_suppliers.is_default);
                 si no tiene, el primero activo; si no tiene ninguno, NULL y la
                 pantalla lo junta en «Sin proveedor».
     pedir       lo que falta para @dias_objetivo dias, redondeado hacia arriba a
                 la presentacion de compra predeterminada (caja de 12 -> 12, 24…).
     costo       por UNIDAD BASE: el de la ultima compra (products.cost, que
                 sp_register_purchase deja por unidad base); si nunca se ha
                 comprado, el que se apunto al ligar el proveedor. Es una
                 referencia: el costo real lo escribe quien registra la compra.

   Solo lee. No crea pedidos ni compras: eso lo hace la persona en Compras. */
CREATE OR ALTER PROCEDURE dbo.sp_purchase_order_suggestions
    @dias_alerta   INT = 7,
    @dias_objetivo INT = 7
AS
BEGIN
    SET NOCOUNT ON;
    IF @dias_alerta   IS NULL OR @dias_alerta   < 0 SET @dias_alerta   = 7;
    IF @dias_objetivo IS NULL OR @dias_objetivo <= 0 SET @dias_objetivo = 7;

    CREATE TABLE #r (
        id INT, nombre NVARCHAR(200), part_number NVARCHAR(100), inventory_mode NVARCHAR(20), base_uom NVARCHAR(10),
        stock DECIMAL(18, 2), vendido_ventana DECIMAL(18, 2), prom_diario DECIMAL(12, 2), dias_restantes INT,
        sugerido DECIMAL(18, 4), limita_nombre NVARCHAR(200), limita_stock DECIMAL(18, 4), limita_uom NVARCHAR(10), limita_necesita DECIMAL(18, 6));
    INSERT INTO #r EXEC dbo.sp_reorder_suggestions @dias_ventana = 30, @dias_alerta = @dias_alerta, @dias_objetivo = @dias_objetivo;

    ;WITH prov AS (
        SELECT ps.product_id, ps.supplier_id, ps.last_cost,
               ROW_NUMBER() OVER (PARTITION BY ps.product_id ORDER BY ps.is_default DESC, ps.supplier_id) AS k
          FROM dbo.product_suppliers ps
          JOIN dbo.CAT_suppliers s ON s.id = ps.supplier_id AND ISNULL(s.activo, 1) = 1
         WHERE ps.active = 1
    ),
    pres AS (
        SELECT pp.product_id, pp.id, pp.name, pp.factor_to_base,
               ROW_NUMBER() OVER (PARTITION BY pp.product_id ORDER BY pp.is_default DESC, pp.id) AS k
          FROM dbo.product_presentations pp
         WHERE pp.active = 1 AND pp.factor_to_base > 1
    )
    SELECT pv.supplier_id, s.nombre AS supplier_name, s.telefono AS supplier_phone,
           r.id AS product_id, r.nombre AS product_name, r.base_uom, r.stock, r.prom_diario, r.dias_restantes,
           pr.id AS presentation_id, pr.name AS presentation_name, CAST(pr.factor_to_base AS DECIMAL(18, 4)) AS presentation_factor,
           CAST(CASE WHEN pr.factor_to_base > 1 THEN CEILING(r.sugerido / pr.factor_to_base) * pr.factor_to_base
                     ELSE CEILING(r.sugerido) END AS DECIMAL(18, 2)) AS pedir,
           CAST(COALESCE(NULLIF(p.cost, 0), pv.last_cost, 0) AS DECIMAL(12, 4)) AS costo
      FROM #r r
      JOIN dbo.products p ON p.id = r.id
      LEFT JOIN prov pv ON pv.product_id = r.id AND pv.k = 1
      LEFT JOIN dbo.CAT_suppliers s ON s.id = pv.supplier_id
      LEFT JOIN pres pr ON pr.product_id = r.id AND pr.k = 1
     WHERE r.inventory_mode = 'DIRECT' AND r.sugerido > 0
     ORDER BY CASE WHEN pv.supplier_id IS NULL THEN 1 ELSE 0 END, s.nombre, r.dias_restantes, r.nombre;
END
GO
