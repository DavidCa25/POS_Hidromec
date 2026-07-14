/* ============================================================
   Cuentas por pagar a proveedores
   - sp_get_suppliers_account : lista de proveedores (CAT_suppliers)
        con nombre, telefono, correo y lo que se les debe.
   - sp_get_supplier_account_detail : compras con saldo + pagos.

   Tablas: CAT_suppliers, purchase, supplier_payments.
   Correr en SSMS.
   ============================================================ */

CREATE OR ALTER PROCEDURE dbo.sp_get_suppliers_account
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        s.id                        AS supplier_id,
        s.nombre,
        s.telefono,
        s.correo,
        s.contacto,
        ISNULL(a.owed, 0)           AS owed,
        ISNULL(a.open_purchases, 0) AS open_purchases,
        a.last_purchase
    FROM CAT_suppliers s
    LEFT JOIN (
        SELECT
            supplier_id,
            SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END) AS owed,
            SUM(CASE WHEN balance > 0 THEN 1 ELSE 0 END)       AS open_purchases,
            MAX(datee)                                         AS last_purchase
        FROM purchase
        WHERE supplier_id IS NOT NULL
        GROUP BY supplier_id
    ) a ON a.supplier_id = s.id
    WHERE ISNULL(s.activo, 1) = 1
    ORDER BY ISNULL(a.owed, 0) DESC, s.nombre ASC;
END
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
