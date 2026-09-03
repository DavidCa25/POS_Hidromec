/* sp_get_suppliers_account
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_get_suppliers_account
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        s.id                     AS supplier_id,
        s.nombre,
        s.telefono,
        s.correo,
        s.rfc,
        ISNULL(pg.total_paid, 0) AS total_paid,
        pg.last_payment
    FROM CAT_suppliers s
    LEFT JOIN (
        SELECT supplier_id, SUM(amount) AS total_paid, MAX(datee) AS last_payment
        FROM supplier_payments
        GROUP BY supplier_id
    ) pg ON pg.supplier_id = s.id
    WHERE ISNULL(s.activo, 1) = 1
    ORDER BY s.nombre ASC;
END
GO
