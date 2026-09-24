/* sp_get_professionals
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Quien hace el trabajo, con lo que la pantalla necesita para pintarlo.
 *
 * `services_count` distingue "hace de todo" -ninguna fila en la matriz- de
 * "hace estos cuatro". `open_lines` dice cuanto tiene encima ahora mismo, que
 * es lo que de verdad se pregunta al repartir un trabajo que acaba de entrar.
 */
CREATE OR ALTER PROCEDURE dbo.sp_get_professionals
    @solo_activos BIT = 1,
    @service_product_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT pr.id, pr.full_name, pr.title, pr.phone, pr.email,
           pr.user_id, u.usuario AS user_name,
           pr.default_commission_pct, pr.color, pr.active,
           (SELECT COUNT(*) FROM dbo.service_professionals sp
             WHERE sp.professional_id = pr.id) AS services_count,
           (SELECT COUNT(*) FROM dbo.service_order_lines l
              JOIN dbo.service_orders o ON o.id = l.order_id
             WHERE l.professional_id = pr.id
               AND l.status IN ('PENDIENTE', 'EN_PROCESO')
               AND o.status NOT IN ('CANCELADA', 'ENTREGADA')) AS open_lines
      FROM dbo.professionals pr
      LEFT JOIN dbo.users u ON u.id = pr.user_id
     WHERE (@solo_activos = 0 OR pr.active = 1)
       AND (@service_product_id IS NULL
            /* Sin matriz para ese servicio, lo hace cualquiera. */
            OR NOT EXISTS (SELECT 1 FROM dbo.service_professionals sp
                            WHERE sp.service_product_id = @service_product_id)
            OR EXISTS (SELECT 1 FROM dbo.service_professionals sp
                        WHERE sp.service_product_id = @service_product_id
                          AND sp.professional_id = pr.id))
     ORDER BY pr.full_name;
END
GO
