/* sp_service_order_authorize
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* El cliente aprueba el presupuesto.
 *
 * SE AUTORIZA UNA VERSION, NO "LA ORDEN"
 * --------------------------------------
 * El cliente aprueba un importe concreto. Si despues se anade una linea, lo
 * que aprobo ya no es lo que se le va a cobrar, y decir que "la orden esta
 * autorizada" seria falso. Por eso se guarda CUAL version aprobo: cuando el
 * presupuesto vuelva a moverse, la comparacion lo dira sola.
 *
 * Sin esto, la conversacion del mostrador es "usted autorizo" contra "yo
 * autorice otra cosa", y no hay forma de saber quien tiene razon.
 *
 * QUIEN AUTORIZA NO TIENE USUARIO EN WYBIX
 * ----------------------------------------
 * Es el cliente, por telefono o en el mostrador. Se guarda su nombre tal cual
 * y por que via, mas el usuario de la casa que lo registro. Son dos personas y
 * las dos importan: una da el permiso y la otra responde de haberlo anotado.
 *
 * SE PUEDE AUTORIZAR VARIAS VECES
 * -------------------------------
 * Cada reautorizacion deja su propio evento. Tres cambios de presupuesto son
 * tres autorizaciones, y el historial las ensena todas.
 */
CREATE OR ALTER PROCEDURE dbo.sp_service_order_authorize
    @id         INT,
    @by_name    NVARCHAR(120),
    @channel    NVARCHAR(20) = 'MOSTRADOR',
    @user_id    INT = NULL,
    @rowver     BINARY(8) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @actual BINARY(8), @status NVARCHAR(20), @version INT,
            @autorizada INT, @sale_id INT;
    SELECT @actual = rowver, @status = status, @version = quote_version,
           @autorizada = authorized_version, @sale_id = sale_id
      FROM dbo.service_orders WHERE id = @id;

    IF @status IS NULL
    BEGIN
        RAISERROR('Esa orden no existe.', 16, 1);
        RETURN;
    END

    IF @rowver IS NOT NULL AND @rowver <> @actual
    BEGIN
        RAISERROR('CONFLICTO_DE_VERSION', 16, 1);
        RETURN;
    END

    IF @status = 'CANCELADA'
    BEGIN
        RAISERROR('Esta orden esta cancelada.', 16, 1);
        RETURN;
    END

    IF @sale_id IS NOT NULL
    BEGIN
        RAISERROR('Esta orden ya se cobro.', 16, 1);
        RETURN;
    END

    IF @by_name IS NULL OR LTRIM(RTRIM(@by_name)) = ''
    BEGIN
        RAISERROR('Anota quien autoriza.', 16, 1);
        RETURN;
    END

    /* Autorizar dos veces la misma version no es un error, pero tampoco es un
       hecho nuevo: se dice y no se escribe otro evento igual. */
    IF @autorizada IS NOT NULL AND @autorizada >= @version
    BEGIN
        RAISERROR('Este presupuesto ya estaba autorizado.', 16, 1);
        RETURN;
    END

    DECLARE @total DECIMAL(14, 2) = ISNULL(
        (SELECT SUM(line_total) FROM dbo.service_order_lines
          WHERE order_id = @id AND status <> 'CANCELADA'), 0);

    BEGIN TRAN;

    UPDATE dbo.service_orders
       SET authorized_version = @version,
           authorized_at = SYSDATETIME(),
           authorized_by_name = @by_name,
           authorized_channel = ISNULL(@channel, 'MOSTRADOR'),
           authorized_by_user = @user_id,
           /* Autorizar pone la orden en marcha, pero no la saca de donde ya
              estaba: si el taller ya empezo, sigue EN_PROCESO. */
           status = CASE WHEN status IN ('BORRADOR', 'ABIERTA') THEN 'ABIERTA' ELSE status END
     WHERE id = @id;

    INSERT INTO dbo.service_order_events
        (order_id, event_type, quote_version, amount, detail, user_id)
    VALUES
        (@id,
         CASE WHEN @autorizada IS NULL THEN 'AUTORIZADA' ELSE 'REAUTORIZADA' END,
         @version, @total,
         @by_name + ' (' + ISNULL(@channel, 'MOSTRADOR') + ')', @user_id);

    COMMIT TRAN;

    EXEC dbo.sp_service_order_get @id = @id;
END
GO
