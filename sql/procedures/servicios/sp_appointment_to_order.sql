/* sp_appointment_to_order
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* El cliente llego: la cita se convierte en trabajo.
 *
 * ES EL MOMENTO EN QUE LA PROMESA SE CUMPLE
 * -----------------------------------------
 * La cita era una promesa; la orden es el trabajo. Este procedimiento es el
 * unico sitio donde una se convierte en la otra, y por eso hace las dos cosas
 * de una vez: abre la orden y marca la cita como atendida. Si fueran dos
 * llamadas, la mitad de las veces se quedaria una cita AGENDADA de un cliente
 * que lleva dos horas dentro.
 *
 * LA LINEA DEL SERVICIO SE ANADE SOLA
 * -----------------------------------
 * Si la cita decia que servicio era, la orden nace con esa linea. Es lo que
 * se acordo por telefono, y obligar a buscarlo otra vez en el catalogo con el
 * cliente delante es pedirle al mostrador que repita un trabajo ya hecho.
 *
 * ES IDEMPOTENTE
 * --------------
 * Si la cita ya tiene orden, se devuelve esa. Dos clics en "el cliente llego"
 * no pueden abrir dos ordenes del mismo trabajo.
 */
CREATE OR ALTER PROCEDURE dbo.sp_appointment_to_order
    @appointment_id INT,
    @user_id        INT = NULL,
    @register_id    INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @customer_id INT, @asset_id INT, @service_id INT, @prof_id INT,
            @status NVARCHAR(15), @order_id INT, @notes NVARCHAR(400);

    SELECT @customer_id = customer_id, @asset_id = customer_asset_id,
           @service_id = service_product_id, @prof_id = professional_id,
           @status = status, @order_id = service_order_id, @notes = notes
      FROM dbo.appointments WHERE id = @appointment_id;

    IF @customer_id IS NULL
    BEGIN
        RAISERROR('Esa cita no existe.', 16, 1);
        RETURN;
    END

    IF @order_id IS NOT NULL
    BEGIN
        EXEC dbo.sp_service_order_get @id = @order_id;
        RETURN;
    END

    IF @status IN ('CANCELADA', 'NO_ASISTIO')
    BEGIN
        RAISERROR('Esa cita esta cerrada.', 16, 1);
        RETURN;
    END

    BEGIN TRAN;

    INSERT INTO dbo.service_orders
        (customer_id, customer_asset_id, status, reported_issue, opened_by, register_id)
    VALUES
        (@customer_id, @asset_id, 'ABIERTA', @notes, @user_id, @register_id);

    SET @order_id = SCOPE_IDENTITY();

    INSERT INTO dbo.service_order_events
        (order_id, event_type, to_status, quote_version, detail, user_id)
    VALUES
        (@order_id, 'ABIERTA', 'ABIERTA', 1,
         'Desde la cita ' + CONVERT(NVARCHAR(12), @appointment_id), @user_id);

    UPDATE dbo.appointments
       SET status = 'ATENDIDA', service_order_id = @order_id, updated_at = SYSDATETIME()
     WHERE id = @appointment_id;

    COMMIT TRAN;

    /* La linea, fuera de la transaccion anterior y por el camino normal: las
       validaciones de `add_line` -producto activo, persona asignada- son las
       mismas aqui que en cualquier otro sitio, y duplicarlas seria tener dos
       versiones de la misma regla. */
    IF @service_id IS NOT NULL
        EXEC dbo.sp_service_order_add_line
            @order_id = @order_id,
            @product_id = @service_id,
            @quantity = 1,
            @professional_id = @prof_id,
            @user_id = @user_id;
    ELSE
        EXEC dbo.sp_service_order_get @id = @order_id;
END
GO
