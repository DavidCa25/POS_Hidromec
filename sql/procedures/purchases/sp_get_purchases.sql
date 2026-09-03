/* sp_get_purchases
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE sp_get_purchases
AS
BEGIN
    SELECT
        p.id AS purchase_id,
        p.datee,
        u.usuario AS user_name,
        p.total,
        p.tax_rate,
        p.tax_amount,
        pd.id AS purchase_detail_id,
        pr.nombre,
        pd.quantity,
        pd.unitary_price,
        pd.subtotal,
        s.nombre
    FROM purchase p
    INNER JOIN purchase_detail pd ON p.id = pd.puchase_id
    INNER JOIN users u ON p.useer_id = u.id
    INNER JOIN products pr ON pd.product_id = pr.id
    INNER JOIN CAT_suppliers s ON pd.supplier_id = s.id
    ORDER BY p.datee ASC;
END;
GO
