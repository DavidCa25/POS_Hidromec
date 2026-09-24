/* sp_service_order_link_sale
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Ata una orden a la venta que la cobro, y devenga las comisiones.
 *
 * ES EL SEGUNDO PASO DEL COBRO
 * ----------------------------
 * El primero es la venta de siempre. Este ata las dos cosas y hace lo unico
 * que el camino de venta no sabe hacer: repartir comisiones por linea.
 *
 * ES IDEMPOTENTE, Y ESO NO ES UN ADORNO
 * -------------------------------------
 * Entre la venta y este enlace puede caerse la red. Si se reintenta con la
 * misma venta, no pasa nada: la orden ya esta atada a ella y las comisiones ya
 * estan. Si se reintenta con OTRA venta, se rechaza: eso significaria que la
 * orden se cobro dos veces, y lo que hay que hacer entonces es devolver una de
 * las dos, no elegir cual gana.
 *
 * LA COMISION SE CONGELA AQUI Y NO SE VUELVE A CALCULAR
 * -----------------------------------------------------
 * Se guarda el importe, la base y el porcentaje con el que salio. Derivarla al
 * vuelo de las lineas significaria que cambiarle el porcentaje a alguien
 * reescribiria lo que ya gano el mes pasado, y eso es dinero que una persona
 * ya contaba.
 *
 * El indice unico sobre `order_line_id` es el que de verdad impide pagar dos
 * veces la misma linea: aqui se comprueba, pero la comprobacion tiene una
 * ventana y el indice no.
 */
CREATE OR ALTER PROCEDURE dbo.sp_service_order_link_sale
    @order_id INT,
    @sale_id  INT,
    @user_id  INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @status NVARCHAR(20), @ya INT, @customer_id INT;
    SELECT @status = status, @ya = sale_id, @customer_id = customer_id
      FROM dbo.service_orders WHERE id = @order_id;

    IF @status IS NULL
    BEGIN
        RAISERROR('Esa orden no existe.', 16, 1);
        RETURN;
    END

    IF NOT EXISTS (SELECT 1 FROM dbo.sales WHERE id = @sale_id)
    BEGIN
        RAISERROR('Esa venta no existe.', 16, 1);
        RETURN;
    END

    IF @ya IS NOT NULL AND @ya <> @sale_id
    BEGIN
        DECLARE @msg NVARCHAR(200) =
            'Esta orden ya estaba cobrada con la venta ' + CONVERT(NVARCHAR(12), @ya) + '.';
        RAISERROR(@msg, 16, 1);
        RETURN;
    END

    /* Una venta cobra UNA orden. Si esta venta ya cobro otra, atarla aqui
       repartiria el mismo dinero entre dos trabajos. */
    IF EXISTS (SELECT 1 FROM dbo.service_orders
                WHERE sale_id = @sale_id AND id <> @order_id)
    BEGIN
        RAISERROR('Esa venta ya cobro otra orden.', 16, 1);
        RETURN;
    END

    BEGIN TRAN;

    UPDATE dbo.service_orders
       SET sale_id = @sale_id,
           /* Cobrada es, como minimo, terminada. Entregarla es otro momento y
              otra decision: el cliente paga hoy y recoge manana. */
           status = CASE WHEN status IN ('BORRADOR', 'ABIERTA', 'EN_PROCESO')
                         THEN 'TERMINADA' ELSE status END
     WHERE id = @order_id;

    /* Las comisiones de las lineas que tienen a alguien detras y porcentaje.
       Las que no, no generan nada: no es un error, es que ese trabajo no
       comisiona. `NOT EXISTS` deja la operacion repetible. */
    INSERT INTO dbo.service_commissions
        (order_id, order_line_id, sale_id, professional_id, base_amount, pct, amount)
    SELECT l.order_id, l.id, @sale_id, l.professional_id,
           l.line_total,
           l.commission_pct_snapshot,
           CONVERT(DECIMAL(14, 2), l.line_total * l.commission_pct_snapshot / 100.0)
      FROM dbo.service_order_lines l
     WHERE l.order_id = @order_id
       AND l.status <> 'CANCELADA'
       AND l.professional_id IS NOT NULL
       AND ISNULL(l.commission_pct_snapshot, 0) > 0
       AND NOT EXISTS (SELECT 1 FROM dbo.service_commissions c WHERE c.order_line_id = l.id);

    DECLARE @comisiones DECIMAL(14, 2) = ISNULL(
        (SELECT SUM(amount) FROM dbo.service_commissions WHERE order_id = @order_id), 0);
    DECLARE @total DECIMAL(14, 2) = ISNULL(
        (SELECT total FROM dbo.sales WHERE id = @sale_id), 0);

    /* Solo la primera vez deja evento: reintentar un enlace no es un hecho
       nuevo del negocio, y el historial no puede contarlo como si lo fuera. */
    IF @ya IS NULL
        INSERT INTO dbo.service_order_events
            (order_id, event_type, from_status, to_status, amount, detail, user_id)
        VALUES
            (@order_id, 'COBRADA', @status,
             (SELECT status FROM dbo.service_orders WHERE id = @order_id),
             @total,
             'Venta ' + CONVERT(NVARCHAR(12), @sale_id)
               + CASE WHEN @comisiones > 0
                      THEN ' · comisiones ' + CONVERT(NVARCHAR(20), @comisiones)
                      ELSE '' END,
             @user_id);

    COMMIT TRAN;

    EXEC dbo.sp_service_order_get @id = @order_id;
END
GO
