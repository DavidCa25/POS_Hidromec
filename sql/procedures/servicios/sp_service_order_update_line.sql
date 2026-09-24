/* sp_service_order_update_line
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Cambia una linea: cantidad, precio, quien la hace, en que va, o la cancela.
 *
 * CANCELAR NO ES BORRAR
 * ---------------------
 * Una linea cancelada se queda en la orden con `status = 'CANCELADA'` y deja
 * de sumar. Borrarla escondería que se cotizo y se quito, que es justo la
 * conversacion que acaba habiendo en el mostrador: "yo nunca pedi eso".
 *
 * SOLO SUBE EL PRESUPUESTO SI CAMBIA EL DINERO
 * --------------------------------------------
 * Poner la linea en EN_PROCESO o asignarle a otra persona no cambia lo que el
 * cliente va a pagar, asi que no invalida su autorizacion. Cambiar la cantidad
 * o el precio, si. Subir la version por todo convertiria la reautorizacion en
 * un aviso que aparece siempre, y un aviso que aparece siempre no se lee.
 *
 * Los parametros en NULL no se tocan: esta pantalla se usa para cambiar UNA
 * cosa a la vez, y mandar el resto obligaria al renderer a reenviar un estado
 * que puede haber cambiado por debajo.
 */
CREATE OR ALTER PROCEDURE dbo.sp_service_order_update_line
    @line_id         INT,
    @quantity        DECIMAL(12, 2) = NULL,
    @unit_price      DECIMAL(12, 2) = NULL,
    @professional_id INT = NULL,
    @commission_pct  DECIMAL(5, 2) = NULL,
    @status          NVARCHAR(12) = NULL,
    @notes           NVARCHAR(400) = NULL,
    @user_id         INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @order_id INT, @kind NVARCHAR(10), @product_id INT,
            @nombre NVARCHAR(120), @estado_actual NVARCHAR(12),
            @cant_actual DECIMAL(12, 2), @precio_actual DECIMAL(12, 2);

    SELECT @order_id = l.order_id, @kind = l.line_kind, @product_id = l.product_id,
           @nombre = l.name_snapshot, @estado_actual = l.status,
           @cant_actual = l.quantity, @precio_actual = l.unit_price_snapshot
      FROM dbo.service_order_lines l WHERE l.id = @line_id;

    IF @order_id IS NULL
    BEGIN
        RAISERROR('Esa linea ya no existe.', 16, 1);
        RETURN;
    END

    DECLARE @orden_status NVARCHAR(20), @sale_id INT;
    SELECT @orden_status = status, @sale_id = sale_id FROM dbo.service_orders WHERE id = @order_id;

    IF @sale_id IS NOT NULL
    BEGIN
        RAISERROR('Esta orden ya se cobro y sus lineas no se pueden cambiar.', 16, 1);
        RETURN;
    END

    IF @orden_status = 'CANCELADA'
    BEGIN
        RAISERROR('Esta orden esta cancelada.', 16, 1);
        RETURN;
    END

    IF @quantity IS NOT NULL AND @quantity <= 0
    BEGIN
        RAISERROR('La cantidad tiene que ser mayor que cero.', 16, 1);
        RETURN;
    END

    IF @unit_price IS NOT NULL AND @unit_price < 0
    BEGIN
        RAISERROR('El precio no puede ser negativo.', 16, 1);
        RETURN;
    END

    IF @status IS NOT NULL AND @status NOT IN ('PENDIENTE', 'EN_PROCESO', 'HECHA', 'CANCELADA')
    BEGIN
        RAISERROR('Estado de linea desconocido.', 16, 1);
        RETURN;
    END

    IF @professional_id IS NOT NULL
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.professionals WHERE id = @professional_id AND active = 1)
        BEGIN
            RAISERROR('Ese profesional no existe o esta dado de baja.', 16, 1);
            RETURN;
        END
        IF @kind = 'SERVICIO'
           AND EXISTS (SELECT 1 FROM dbo.service_professionals WHERE service_product_id = @product_id)
           AND NOT EXISTS (SELECT 1 FROM dbo.service_professionals
                            WHERE service_product_id = @product_id
                              AND professional_id = @professional_id)
        BEGIN
            RAISERROR('Esa persona no tiene asignado este servicio.', 16, 1);
            RETURN;
        END
    END

    /* Lo que de verdad mueve el dinero. Cancelar tambien: la linea deja de
       sumar y el total baja. */
    DECLARE @cambia_importe BIT =
        CASE WHEN (@quantity IS NOT NULL AND @quantity <> @cant_actual)
                OR (@unit_price IS NOT NULL AND @unit_price <> @precio_actual)
                OR (@status = 'CANCELADA' AND @estado_actual <> 'CANCELADA')
                OR (@estado_actual = 'CANCELADA' AND @status IS NOT NULL AND @status <> 'CANCELADA')
             THEN 1 ELSE 0 END;

    BEGIN TRAN;

    UPDATE dbo.service_order_lines
       SET quantity = ISNULL(@quantity, quantity),
           unit_price_snapshot = ISNULL(@unit_price, unit_price_snapshot),
           professional_id = ISNULL(@professional_id, professional_id),
           commission_pct_snapshot = ISNULL(@commission_pct, commission_pct_snapshot),
           status = ISNULL(@status, status),
           notes = ISNULL(@notes, notes)
     WHERE id = @line_id;

    IF @cambia_importe = 1
        UPDATE dbo.service_orders SET quote_version = quote_version + 1 WHERE id = @order_id;

    DECLARE @version INT = (SELECT quote_version FROM dbo.service_orders WHERE id = @order_id);

    INSERT INTO dbo.service_order_events
        (order_id, event_type, quote_version, amount, detail, user_id)
    SELECT @order_id,
           CASE WHEN @status = 'CANCELADA' AND @estado_actual <> 'CANCELADA' THEN 'LINEA_QUITADA'
                WHEN @status = 'HECHA' AND @estado_actual <> 'HECHA' THEN 'LINEA_HECHA'
                WHEN @cambia_importe = 1 THEN 'LINEA_CAMBIADA'
                ELSE 'LINEA_NOTA' END,
           @version,
           CASE WHEN @cambia_importe = 1 THEN l.line_total END,
           @nombre + CASE WHEN @status IS NOT NULL THEN ' -> ' + @status ELSE '' END,
           @user_id
      FROM dbo.service_order_lines l WHERE l.id = @line_id;

    COMMIT TRAN;

    EXEC dbo.sp_service_order_get @id = @order_id;
END
GO
