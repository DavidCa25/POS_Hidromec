/* sp_top_customers
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
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
