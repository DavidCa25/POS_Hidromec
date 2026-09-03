/* ============================================================
   Proveedores (directorio + pagos)
   - Agrega RFC a CAT_suppliers (idempotente).
   - sp_get_suppliers_account : lista con contacto y TOTAL PAGADO
       (suma de supplier_payments). Ya NO usa purchase.balance como
       "deuda" (esa cifra no era deuda real: sp_register_purchase pone
       balance = total en cada compra).
   - sp_get_supplier_payments : historial de pagos de un proveedor.
   - sp_supplier_save : alta/edicion de proveedor.

   Los pagos a proveedor se registran como SALIDAS DE EFECTIVO desde el
   POS (venta). Correr en SSMS.
   ============================================================ */

/* RFC en proveedores */
IF COL_LENGTH('dbo.CAT_suppliers', 'rfc') IS NULL
    ALTER TABLE dbo.CAT_suppliers ADD rfc NVARCHAR(20) NULL;
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

/* Alta / edicion de proveedor. Si @id es NULL o 0 -> alta. */
CREATE OR ALTER PROCEDURE dbo.sp_supplier_save
    @id       INT = NULL,
    @nombre   NVARCHAR(100),
    @telefono NVARCHAR(20)  = NULL,
    @correo   NVARCHAR(100) = NULL,
    @rfc      NVARCHAR(20)  = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF (@id IS NULL OR @id = 0)
    BEGIN
        INSERT INTO CAT_suppliers (nombre, telefono, correo, rfc)
        VALUES (@nombre, @telefono, @correo, @rfc);
        SELECT SCOPE_IDENTITY() AS id;
    END
    ELSE
    BEGIN
        UPDATE CAT_suppliers
        SET nombre = @nombre, telefono = @telefono, correo = @correo, rfc = @rfc
        WHERE id = @id;
        SELECT @id AS id;
    END
END
GO
