/* sp_get_supplier_payments
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_get_supplier_payments
    @supplier_id INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        sp.id,
        sp.purchase_id,
        sp.datee,
        sp.amount,
        sp.payment_method,
        sp.note
    FROM supplier_payments sp
    WHERE sp.supplier_id = @supplier_id
    ORDER BY sp.datee DESC;
END
GO
