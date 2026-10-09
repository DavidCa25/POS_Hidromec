/* sp_get_sale_by_folio
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE [dbo].[sp_get_sale_by_folio]
  @sale_id INT
AS
BEGIN
  SET NOCOUNT ON;

  IF @sale_id IS NULL OR @sale_id <= 0
  BEGIN
    RAISERROR('sale_id inválido.',16,1);
    RETURN;
  END

  SELECT
    s.id AS sale_id,
    s.datee,
    s.useer_id AS user_id,
    s.total,
    s.payment_method,
    (SELECT payment_method,amount,received,reference FROM dbo.sale_payments WHERE sale_id=s.id FOR JSON PATH) payments_json,
    JSON_VALUE(s.commercial_snapshot,'$.channelId') commercial_channel,
    TRY_CONVERT(DECIMAL(12,2),JSON_VALUE(s.commercial_snapshot,'$.discount')) commercial_discount,
    s.customer_id,
    s.paid_amount,
    s.balance,
    s.due_date,
    s.invoice_status,
    ISNULL(r.refund_total,0) AS refund_total,
    s.service_mode,
    s.register_id
  FROM dbo.sales s
  OUTER APPLY (
    SELECT SUM(sr.refund_total) AS refund_total
    FROM dbo.sale_refunds sr
    WHERE sr.sale_id = s.id
  ) r
  WHERE s.id = @sale_id;

  IF EXISTS(SELECT 1 FROM dbo.sales WHERE id=@sale_id AND commercial_snapshot IS NOT NULL)
  BEGIN
    ;WITH sold AS(SELECT product_id,SUM(quantity) quantity,SUM(quantity*unitary_price) line_total,MAX(unit_cost) unit_cost,MAX(inventory_mode) inventory_mode FROM dbo.sale_detail WHERE sale_id=@sale_id GROUP BY product_id),
    returned AS(SELECT d.product_id,SUM(d.quantity) qty FROM dbo.sale_refund_detail d JOIN dbo.sale_refunds r ON r.id=d.refund_id WHERE r.sale_id=@sale_id GROUP BY d.product_id)
    SELECT @sale_id sale_id,s.product_id,p.nombre,s.quantity,CAST(s.line_total/s.quantity AS DECIMAL(10,2)) unitary_price,s.line_total,
      ISNULL(r.qty,0) refunded_qty,s.quantity-ISNULL(r.qty,0) remaining_qty,NULL sale_detail_id,s.unit_cost,s.inventory_mode,
      N'Oferta comercial: devolución proporcional al importe pagado' note,p.clave_prod_serv,p.clave_unidad,p.objeto_impuesto,p.tasa_iva,
      N'Oferta comercial' modifiers
    FROM sold s JOIN dbo.products p ON p.id=s.product_id LEFT JOIN returned r ON r.product_id=s.product_id;
    RETURN;
  END;
  ;WITH refunded AS (
    SELECT
      srd.product_id,
      SUM(srd.quantity) AS refunded_qty
    FROM dbo.sale_refunds sr
    JOIN dbo.sale_refund_detail srd ON srd.refund_id = sr.id
    WHERE sr.sale_id = @sale_id
    GROUP BY srd.product_id
  )
  SELECT
    d.sale_id,
    d.product_id,
    p.nombre,
    d.quantity,
    d.unitary_price,
    (d.quantity * d.unitary_price) AS line_total,
    ISNULL(r.refunded_qty,0) AS refunded_qty,
    (d.quantity - ISNULL(r.refunded_qty,0)) AS remaining_qty,
    d.id AS sale_detail_id,
    d.unit_cost,
    d.inventory_mode,
    d.note,
    p.clave_prod_serv,
    p.clave_unidad,
    p.objeto_impuesto,
    p.tasa_iva,
    mods.modifiers
  FROM dbo.sale_detail d
  JOIN dbo.products p ON p.id = d.product_id
  LEFT JOIN refunded r ON r.product_id = d.product_id
  OUTER APPLY (
    SELECT STRING_AGG(CONCAT(CASE WHEN m.quantity > 1 THEN CONCAT(m.quantity, 'x ') ELSE '' END, m.option_name), ', ')
           WITHIN GROUP (ORDER BY m.id) AS modifiers
    FROM dbo.sale_detail_modifiers m
    WHERE m.sale_detail_id = d.id
  ) mods
  WHERE d.sale_id = @sale_id
  ORDER BY d.product_id, d.id;
END
GO
