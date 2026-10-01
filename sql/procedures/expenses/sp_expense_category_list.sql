/* sp_expense_category_list
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Conceptos de egreso, en el orden que el negocio eligio. Con
   @include_inactive = 0 (lo que usa quien registra un egreso) solo salen los
   activos; la pantalla de administracion pide todos. */
CREATE OR ALTER PROCEDURE dbo.sp_expense_category_list
    @include_inactive BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        c.id, c.name, c.kind, c.is_system, c.active, c.sort_order,
        (SELECT COUNT(*) FROM dbo.expenses e WHERE e.category_id = c.id AND e.voided_at IS NULL) AS usos
    FROM dbo.expense_categories c
    WHERE @include_inactive = 1 OR c.active = 1
    ORDER BY c.sort_order, c.name;
END
GO
