/* ============================================================
   Estadisticas - SPs para el tablero por segmentos
   Usa: sales, sale_detail, customers, products, cash_movements,
        supplier_payments. Correr en SSMS.
   ============================================================ */

/* Clientes que mas compran (excluye Publico General = customer_id NULL) */
CREATE OR ALTER PROCEDURE dbo.sp_top_customers
    @limit INT = 10
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (@limit)
        c.id,
        c.customerName AS nombre,
        COUNT(s.id)    AS compras,
        SUM(s.total)   AS total
    FROM sales s
    JOIN customers c ON c.id = s.customer_id
    WHERE s.customer_id IS NOT NULL
    GROUP BY c.id, c.customerName
    ORDER BY SUM(s.total) DESC;
END
GO

/* Ventas por metodo de pago en los ultimos @days dias */
CREATE OR ALTER PROCEDURE dbo.sp_sales_by_payment
    @days INT = 30
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        payment_method,
        COUNT(*)     AS tickets,
        SUM(total)   AS total
    FROM sales
    WHERE datee >= DATEADD(DAY, -@days, CAST(GETDATE() AS DATE))
    GROUP BY payment_method
    ORDER BY SUM(total) DESC;
END
GO

/* Productos sin rotacion (activos, sin ninguna venta) */
CREATE OR ALTER PROCEDURE dbo.sp_dead_products
    @limit INT = 20
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (@limit)
        p.id,
        p.nombre,
        p.stock,
        p.price
    FROM products p
    WHERE p.active = 1
      AND NOT EXISTS (SELECT 1 FROM sale_detail sd WHERE sd.product_id = p.id)
    ORDER BY p.nombre;
END
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

/* KPIs de clientes */
CREATE OR ALTER PROCEDURE dbo.sp_customers_kpis
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        (SELECT COUNT(*) FROM customers WHERE active = 1) AS activos,
        (SELECT COUNT(*) FROM customers
          WHERE created_at >= DATEADD(DAY, -30, CAST(GETDATE() AS DATE))) AS nuevos_30d,
        (SELECT COUNT(DISTINCT customer_id) FROM sales WHERE customer_id IS NOT NULL) AS con_compras;
END
GO
