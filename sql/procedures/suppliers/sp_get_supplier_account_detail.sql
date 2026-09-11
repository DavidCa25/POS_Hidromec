/* sp_get_supplier_account_detail
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_get_supplier_account_detail
    @supplier_id INT
AS
BEGIN
    SET NOCOUNT ON;

    -- 1) Compras con saldo pendiente
    SELECT
        p.id            AS purchase_id,
        p.datee,
        p.total,
        p.balance,
        p.payment_status
    FROM purchase p
    WHERE p.supplier_id = @supplier_id
      AND p.balance > 0
    ORDER BY p.datee ASC;

    -- 2) Pagos hechos al proveedor
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
