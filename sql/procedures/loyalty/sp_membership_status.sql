SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_membership_status (0063) =====================
   Lo que la caja enseña del Club al elegir a un cliente.

     1  membresías del cliente, con su estado de HOY:
          ACTIVA     pagada (o dentro de los días de gracia)
          VENCIDA    paid_until + gracia < hoy: el beneficio no se da
          CANCELADA  dada de baja
        y cuántos canjes le quedan hoy (los de TODAS las sucursales que ya
        bajaron de la nube cuentan).
     2  productos que se pueden dar con cada plan
     3  planes activos, para afiliar a quien todavía no es socio

   Solo lectura.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_membership_status
    @customer_id INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @hoy DATE = CAST(GETDATE() AS DATE);

    SELECT m.id, LOWER(CONVERT(VARCHAR(36), m.uuid)) AS uuid, m.plan_id, p.name AS plan_name, m.paid_until,
           p.grace_days, p.daily_limit,
           CASE WHEN m.status = N'CANCELLED' THEN 'CANCELADA'
                WHEN m.paid_until IS NULL OR DATEADD(DAY, p.grace_days, m.paid_until) < @hoy THEN 'VENCIDA'
                ELSE 'ACTIVA' END AS estado,
           ISNULL(h.usados, 0) AS usados_hoy,
           CASE WHEN p.daily_limit - ISNULL(h.usados, 0) < 0 THEN 0 ELSE p.daily_limit - ISNULL(h.usados, 0) END AS disponibles_hoy,
           h.ultimo AS ultimo_canje, h.donde AS ultimo_canje_en,
           p.sale_product_id, sp.nombre AS sale_product_name, sp.price AS sale_product_price,
           sp.inventory_mode AS sale_product_inventory_mode, sp.tasa_iva AS sale_product_tasa_iva, sp.objeto_impuesto AS sale_product_objeto_impuesto,
           sp.clave_prod_serv AS sale_product_clave_prod_serv, sp.clave_unidad AS sale_product_clave_unidad
      FROM dbo.customer_memberships m
      JOIN dbo.membership_plans p ON p.id = m.plan_id
      LEFT JOIN dbo.products sp ON sp.id = p.sale_product_id
      OUTER APPLY (SELECT SUM(r.units) AS usados, MAX(r.created_at) AS ultimo,
                          (SELECT TOP 1 ISNULL(r2.location_name, N'esta sucursal') FROM dbo.membership_redemptions r2
                            WHERE r2.membership_id = m.id AND r2.redeem_date = @hoy AND r2.voided_at IS NULL ORDER BY r2.created_at DESC) AS donde
                     FROM dbo.membership_redemptions r
                    WHERE r.membership_id = m.id AND r.redeem_date = @hoy AND r.voided_at IS NULL) h
     WHERE m.customer_id = @customer_id
     ORDER BY CASE WHEN m.status = N'ACTIVE' THEN 0 ELSE 1 END, m.paid_until DESC;

    SELECT pp.plan_id, pr.id AS product_id, pr.nombre, pr.price, pr.inventory_mode, pr.tasa_iva, pr.objeto_impuesto, pr.clave_prod_serv, pr.clave_unidad
      FROM dbo.membership_plan_products pp
      JOIN dbo.products pr ON pr.id = pp.product_id
     WHERE pp.plan_id IN (SELECT plan_id FROM dbo.customer_memberships WHERE customer_id = @customer_id)
     ORDER BY pp.plan_id, pr.nombre;

    SELECT p.id, p.name, p.period_days, p.daily_limit, p.sale_product_id, sp.nombre AS sale_product_name, sp.price AS sale_product_price,
           sp.inventory_mode AS sale_product_inventory_mode, sp.tasa_iva AS sale_product_tasa_iva, sp.objeto_impuesto AS sale_product_objeto_impuesto,
           sp.clave_prod_serv AS sale_product_clave_prod_serv, sp.clave_unidad AS sale_product_clave_unidad
      FROM dbo.membership_plans p
      JOIN dbo.products sp ON sp.id = p.sale_product_id
     WHERE p.active = 1
     ORDER BY p.name;
END;
GO
