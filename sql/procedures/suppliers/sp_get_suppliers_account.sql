/* sp_get_suppliers_account
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Estado de cuenta de cada proveedor.
--
-- QUE FALTABA
-- -----------
-- Solo devolvia `total_paid`, asi que la pantalla de Proveedores podia
-- ensenar cuanto se le ha pagado a alguien pero no cuanto se le compro ni
-- cuanto se le debe. Para saber si habia una deuda pendiente habia que ir a
-- la Tabla de compras y sumar a mano.
--
-- LA FUENTE DE VERDAD ES `purchase.balance`
-- -----------------------------------------
-- El saldo NO se calcula como comprado - pagado. Esos dos numeros pueden no
-- cuadrar por motivos legitimos -un pago suelto sin compra asociada, o
-- historico anterior al catalogo de proveedores- y restarlos inventaria una
-- deuda que nadie registro. `purchase.balance` es lo que la Tabla de compras
-- muestra en la columna Pago, y es lo que se usa aqui: una sola cifra, una
-- sola fuente.
--
-- El proveedor de una compra se lee de la cabecera, con respaldo en la linea
-- para las compras anteriores a "una compra, un proveedor" -misma regla que
-- `sp_get_purchases`, o los totales no cuadrarian entre las dos pantallas-.
CREATE OR ALTER PROCEDURE dbo.sp_get_suppliers_account
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH compras AS (
        SELECT
            COALESCE(p.supplier_id, pd.supplier_id) AS supplier_id,
            p.id,
            p.total,
            p.balance,
            p.datee
        FROM dbo.purchase p
        OUTER APPLY (
            SELECT TOP 1 d.supplier_id
            FROM dbo.purchase_detail d
            WHERE d.puchase_id = p.id AND d.supplier_id IS NOT NULL
            ORDER BY d.id
        ) pd
    ),
    resumen AS (
        SELECT
            supplier_id,
            SUM(ISNULL(total, 0))                                     AS total_comprado,
            SUM(ISNULL(balance, 0))                                   AS saldo_pendiente,
            SUM(CASE WHEN ISNULL(balance, 0) > 0 THEN 1 ELSE 0 END)   AS compras_pendientes,
            COUNT(*)                                                  AS compras,
            MAX(datee)                                                AS last_purchase
        FROM compras
        WHERE supplier_id IS NOT NULL
        GROUP BY supplier_id
    )
    SELECT
        s.id                            AS supplier_id,
        s.nombre,
        s.telefono,
        s.correo,
        s.rfc,
        ISNULL(pg.total_paid, 0)        AS total_paid,
        pg.last_payment,
        ISNULL(c.total_comprado, 0)     AS total_comprado,
        ISNULL(c.saldo_pendiente, 0)    AS saldo_pendiente,
        ISNULL(c.compras_pendientes, 0) AS compras_pendientes,
        ISNULL(c.compras, 0)            AS compras,
        c.last_purchase
    FROM CAT_suppliers s
    LEFT JOIN (
        SELECT supplier_id, SUM(amount) AS total_paid, MAX(datee) AS last_payment
        FROM supplier_payments
        GROUP BY supplier_id
    ) pg ON pg.supplier_id = s.id
    LEFT JOIN resumen c ON c.supplier_id = s.id
    WHERE ISNULL(s.activo, 1) = 1
    ORDER BY s.nombre ASC;
END
GO
