/* sp_service_order_charge_preview
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Lo que hay que cobrar de una orden, y si se puede cobrar.
 *
 * POR QUE COBRAR NO SE HACE ENTERO AQUI
 * -------------------------------------
 * Porque vender ya existe, y funciona. `sp_register_sale` valida el turno,
 * renueva el arriendo de la caja en MultiCaja, mueve el inventario, resuelve
 * recetas, aplica fidelizacion y deja el movimiento de efectivo. Reimplementar
 * media venta dentro del modulo de Servicios habria creado una segunda forma
 * de vender que se separa de la primera en la siguiente entrega.
 *
 * Asi que el reparto es: este procedimiento dice QUE cobrar y comprueba que se
 * pueda; la venta la registra el camino de siempre; y despues
 * `sp_service_order_link_sale` ata las dos cosas y calcula las comisiones.
 *
 * Tambien evita meter `sp_register_sale` dentro de un INSERT...EXEC: esa
 * construccion es fragil justo donde no puede serlo, porque el procedimiento
 * de venta lleva su propia transaccion.
 *
 * LAS VALIDACIONES SE DEVUELVEN, NO SE LANZAN
 * -------------------------------------------
 * Esto lo llama la pantalla ANTES de cobrar, para pintar el boton. Un error
 * que corta no sirve: lo que hace falta es "puedes, pero ojo con esto".
 */
CREATE OR ALTER PROCEDURE dbo.sp_service_order_charge_preview
    @order_id INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @status NVARCHAR(20), @sale_id INT, @version INT, @autorizada INT, @customer_id INT;
    SELECT @status = status, @sale_id = sale_id, @version = quote_version,
           @autorizada = authorized_version, @customer_id = customer_id
      FROM dbo.service_orders WHERE id = @order_id;

    IF @status IS NULL
    BEGIN
        RAISERROR('Esa orden no existe.', 16, 1);
        RETURN;
    END

    DECLARE @lineas INT = (SELECT COUNT(*) FROM dbo.service_order_lines
                            WHERE order_id = @order_id AND status <> 'CANCELADA');
    DECLARE @total DECIMAL(14, 2) = ISNULL(
        (SELECT SUM(line_total) FROM dbo.service_order_lines
          WHERE order_id = @order_id AND status <> 'CANCELADA'), 0);

    /* Lo que IMPIDE cobrar, y lo que solo hay que advertir. La diferencia
       importa: la primera lista apaga el boton y la segunda pide confirmar. */
    DECLARE @impedimento NVARCHAR(300) = NULL;

    IF @sale_id IS NOT NULL
        SET @impedimento = 'Esta orden ya se cobro con la venta ' + CONVERT(NVARCHAR(12), @sale_id) + '.';
    ELSE IF @status = 'CANCELADA'
        SET @impedimento = 'Esta orden esta cancelada.';
    ELSE IF @lineas = 0
        SET @impedimento = 'La orden no tiene nada que cobrar.';

    SELECT @order_id AS order_id,
           @customer_id AS customer_id,
           @status AS status,
           @sale_id AS sale_id,
           @total AS total,
           @lineas AS lines_count,
           @impedimento AS blocked_reason,
           CONVERT(BIT, CASE WHEN @impedimento IS NULL THEN 1 ELSE 0 END) AS can_charge,

           /* Cobrar algo que el cliente no aprobo es la forma mas rapida de
              tener una discusion en el mostrador. No se impide -hay negocios
              donde el cliente esta delante y aprueba de viva voz-, se avisa. */
           CONVERT(BIT, CASE WHEN @autorizada IS NULL OR @version > @autorizada
                             THEN 1 ELSE 0 END) AS needs_reauthorization,

           /* Cobrar con trabajo a medias pasa: el cliente paga y se lleva el
              coche manana. Se avisa igualmente. */
           (SELECT COUNT(*) FROM dbo.service_order_lines
             WHERE order_id = @order_id AND status IN ('PENDIENTE', 'EN_PROCESO')) AS lines_pending;

    /* Las partidas, con la forma que espera la venta: `line_no`, producto,
       cantidad y el precio CONGELADO. El precio de hoy no interviene: se cobra
       lo que se acordo. */
    SELECT ROW_NUMBER() OVER (ORDER BY l.line_no, l.id) AS line_no,
           l.product_id,
           l.quantity,
           l.unit_price_snapshot AS unit_price,
           LEFT(ISNULL(l.notes, ''), 200) AS note,
           l.id AS order_line_id,
           l.line_kind,
           l.name_snapshot,
           l.professional_id,
           l.commission_pct_snapshot
      FROM dbo.service_order_lines l
     WHERE l.order_id = @order_id AND l.status <> 'CANCELADA'
     ORDER BY l.line_no, l.id;
END
GO
