/* sp_get_purchases
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Compras con su detalle, una fila por partida.
--
-- Devolvia DOS columnas llamadas `nombre` -el producto y el proveedor-. Un
-- recordset no puede tener dos columnas con el mismo nombre: el driver se
-- queda con una y la otra se pierde, asi que la tabla de compras mostraba
-- ambas en blanco. Cada columna sale ya con el nombre que espera la pantalla.
--
-- El proveedor se lee de la CABECERA, que es donde manda desde que una compra
-- es de un solo proveedor. Las compras ANTERIORES a esa regla tienen
-- `purchase.supplier_id` en NULL y el proveedor solo en la linea: por eso el
-- COALESCE. Sin el, todo el historial viejo sale sin proveedor.
--
-- Y las uniones son LEFT: una compra sin partidas, o cuyo producto se dio de
-- baja, tiene que seguir apareciendo.
CREATE OR ALTER PROCEDURE sp_get_purchases
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        p.id                AS purchase_id,
        p.datee,
        p.datee             AS date_iso,
        u.usuario           AS user_name,
        p.total,
        p.tax_rate,
        p.tax_amount,
        p.balance,
        p.payment_status,
        COALESCE(p.supplier_id, pd.supplier_id) AS supplier_id,
        prov.nombre         AS supplier_name,

        pd.id               AS purchase_detail_id,
        pd.product_id,
        pr.nombre           AS product_name,
        pr.part_number,
        pd.quantity,
        pd.unitary_price,
        pd.subtotal,
        pd.profit_percent,

        -- En que se compro y cuanto entro al inventario, en unidad base.
        pd.presentation_id,
        pp.name             AS presentation_name,
        pd.factor_to_base,
        pd.base_quantity,
        pr.base_uom
    FROM dbo.purchase p
    INNER JOIN dbo.users u             ON u.id  = p.useer_id
    LEFT  JOIN dbo.purchase_detail pd   ON pd.puchase_id = p.id
    LEFT  JOIN dbo.CAT_suppliers prov   ON prov.id = COALESCE(p.supplier_id, pd.supplier_id)
    LEFT  JOIN dbo.products pr          ON pr.id = pd.product_id
    LEFT  JOIN dbo.product_presentations pp ON pp.id = pd.presentation_id
    ORDER BY p.datee DESC, p.id DESC, pd.id ASC;
END;
GO
