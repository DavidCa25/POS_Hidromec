/* sp_service_order_get
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Una orden entera: cabecera, lineas e historial.
 *
 * TRES CONJUNTOS, UNA SOLA IDA
 * ----------------------------
 * La pantalla de detalle necesita las tres cosas a la vez. Tres llamadas
 * separadas darian tres fotos de tres instantes, y con dos personas editando
 * la misma orden eso significa ver lineas que ya no estan junto a un total que
 * ya las descontó.
 *
 * EL ESTADO ECONOMICO SE CALCULA AQUI, NO SE GUARDA
 * -------------------------------------------------
 * `economic_status` sale de la venta enlazada y de su saldo:
 *
 *   SIN_COBRAR   no hay venta todavia
 *   PAGADA       hay venta y no debe nada
 *   POR_COBRAR   hay venta a credito con saldo
 *
 * Si esto viviera en una columna, un abono registrado en otra caja la dejaria
 * mintiendo hasta que alguien la refrescara, y el mostrador le cobraria dos
 * veces al cliente. El dinero esta en `sales`; aqui solo se mira.
 *
 * REAUTORIZACION
 * --------------
 * `needs_reauthorization` es 1 cuando el presupuesto cambio despues de que el
 * cliente autorizara: `quote_version > authorized_version`. No es un estado
 * guardado, es una comparacion, y por eso no puede quedarse desfasada.
 */
CREATE OR ALTER PROCEDURE dbo.sp_service_order_get
    @id INT
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.service_orders WHERE id = @id)
    BEGIN
        RAISERROR('Esa orden no existe.', 16, 1);
        RETURN;
    END

    -- ------------------------------------------------------------ cabecera
    SELECT o.id, o.folio, o.status,
           o.customer_id, c.customerName AS customer_name,
           c.phone AS customer_phone, c.mobile AS customer_mobile,
           o.customer_asset_id,
           a.label AS asset_label, a.kind AS asset_kind,
           a.identifier AS asset_identifier, a.brand AS asset_brand,
           a.model AS asset_model, a.year_or_age AS asset_year_or_age,
           a.color AS asset_color,
           o.reported_issue, o.diagnosis, o.notes,
           o.quote_version, o.authorized_version, o.authorized_at,
           o.authorized_by_name, o.authorized_channel, o.authorized_by_user,
           CONVERT(BIT, CASE WHEN o.authorized_version IS NULL
                              OR o.quote_version > o.authorized_version
                             THEN 1 ELSE 0 END) AS needs_reauthorization,
           o.promised_at, o.opened_at, o.opened_by, uo.usuario AS opened_by_name,
           o.closed_at, o.closed_by, uc.usuario AS closed_by_name,
           o.sale_id, o.register_id,

           /* EL TESTIGO VIAJA COMO TEXTO, y no como los ocho bytes crudos.
              Un ROWVERSION es un `binary(8)`; al cruzar el puente de contextos
              de Electron deja de ser un Buffer y llega como una lista de
              numeros. El proceso principal no sabia reconstruirlo, lo mandaba
              NULL, y la comprobacion de concurrencia no se hacia NUNCA: los dos
              guardaban y el ultimo ganaba, que es justo lo que el testigo
              existe para impedir. En hexadecimal cruza intacto y ademas se lee
              en un registro.

              Y la conversion es DOBLE a proposito: `rowversion` no es
              `binary(8)` para CONVERT, y con un solo paso el estilo 1 se
              ignora en silencio -devuelve los ocho bytes como caracteres, no
              el hexadecimal-. Eso fue justo lo que dejo el testigo inservible
              la primera vez. */
           CONVERT(VARCHAR(18), CONVERT(BINARY(8), o.rowver), 1) AS rowver,

           /* El importe vivo: las lineas canceladas no cuentan. */
           ISNULL((SELECT SUM(l.line_total)
                     FROM dbo.service_order_lines l
                    WHERE l.order_id = o.id AND l.status <> 'CANCELADA'), 0) AS total,
           ISNULL((SELECT SUM(l.line_total)
                     FROM dbo.service_order_lines l
                    WHERE l.order_id = o.id AND l.status <> 'CANCELADA'
                      AND l.line_kind = 'SERVICIO'), 0) AS total_servicios,
           ISNULL((SELECT SUM(l.line_total)
                     FROM dbo.service_order_lines l
                    WHERE l.order_id = o.id AND l.status <> 'CANCELADA'
                      AND l.line_kind = 'PRODUCTO'), 0) AS total_productos,

           CASE WHEN o.sale_id IS NULL THEN 'SIN_COBRAR'
                WHEN ISNULL(s.balance, 0) > 0 THEN 'POR_COBRAR'
                ELSE 'PAGADA' END AS economic_status,
           s.total AS sale_total,
           s.balance AS sale_balance,
           s.payment_method AS sale_payment_method,
           s.datee AS sale_date
      FROM dbo.service_orders o
      JOIN dbo.customers c ON c.id = o.customer_id
      LEFT JOIN dbo.customer_assets a ON a.id = o.customer_asset_id
      LEFT JOIN dbo.sales s ON s.id = o.sale_id
      LEFT JOIN dbo.users uo ON uo.id = o.opened_by
      LEFT JOIN dbo.users uc ON uc.id = o.closed_by
     WHERE o.id = @id;

    -- -------------------------------------------------------------- lineas
    SELECT l.id, l.order_id, l.line_no, l.line_kind, l.product_id,
           l.name_snapshot, l.unit_price_snapshot, l.unit_cost_snapshot,
           l.tasa_iva_snapshot, l.quantity, l.line_total,
           l.professional_id, pr.full_name AS professional_name, pr.color AS professional_color,
           l.commission_pct_snapshot,
           l.status, l.notes, l.added_at, l.added_by,
           /* El precio de HOY, solo para que la pantalla pueda avisar de que
              cambio. Lo que se cobra sigue siendo la copia. */
           p.price AS current_price,
           p.nombre AS current_name
      FROM dbo.service_order_lines l
      JOIN dbo.products p ON p.id = l.product_id
      LEFT JOIN dbo.professionals pr ON pr.id = l.professional_id
     WHERE l.order_id = @id
     ORDER BY l.line_no, l.id;

    -- ----------------------------------------------------------- historial
    SELECT e.id, e.order_id, e.happened_at, e.event_type,
           e.from_status, e.to_status, e.quote_version, e.amount, e.detail,
           e.user_id, u.usuario AS user_name
      FROM dbo.service_order_events e
      LEFT JOIN dbo.users u ON u.id = e.user_id
     WHERE e.order_id = @id
     ORDER BY e.happened_at DESC, e.id DESC;
END
GO
