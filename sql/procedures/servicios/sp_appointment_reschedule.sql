/* sp_appointment_reschedule
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Mueve una cita a otra hora.
 *
 * NO REESCRIBE: CREA LA NUEVA Y ENLAZA
 * ------------------------------------
 * La cita original queda como CANCELADA con un enlace desde la nueva. Podria
 * haberse cambiado la fecha en la misma fila -es una linea de codigo menos-,
 * pero entonces un cliente al que se le mueve la cita tres veces dejaria una
 * sola fila con la ultima fecha, y la pregunta "¿por que este cliente siempre
 * se queja?" no tendria respuesta en ningun sitio.
 *
 * Con el enlace, tres reprogramaciones son tres filas encadenadas y se ven.
 *
 * SE HEREDA TODO SALVO LA HORA
 * ----------------------------
 * Cliente, activo, servicio y persona se conservan. Lo que se esta moviendo es
 * la hora; si ademas cambia el resto, eso es una cita distinta y se agenda
 * como tal.
 */
CREATE OR ALTER PROCEDURE dbo.sp_appointment_reschedule
    @id               INT,
    @starts_at        DATETIME2(0),
    @ends_at          DATETIME2(0) = NULL,
    @professional_id  INT = NULL,
    @reason           NVARCHAR(200) = NULL,
    @permitir_encimar BIT = 0,
    @user_id          INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @customer_id INT, @asset_id INT, @service_id INT,
            @prof_actual INT, @status NVARCHAR(15), @order_id INT,
            @duracion INT, @notes NVARCHAR(400);

    SELECT @customer_id = customer_id, @asset_id = customer_asset_id,
           @service_id = service_product_id, @prof_actual = professional_id,
           @status = status, @order_id = service_order_id, @notes = notes,
           @duracion = DATEDIFF(MINUTE, starts_at, ends_at)
      FROM dbo.appointments WHERE id = @id;

    IF @customer_id IS NULL
    BEGIN
        RAISERROR('Esa cita no existe.', 16, 1);
        RETURN;
    END

    IF @status NOT IN ('AGENDADA', 'CONFIRMADA')
    BEGIN
        RAISERROR('Solo se reprograma una cita que sigue en pie.', 16, 1);
        RETURN;
    END

    IF @order_id IS NOT NULL
    BEGIN
        RAISERROR('Esta cita ya genero una orden de servicio.', 16, 1);
        RETURN;
    END

    IF @ends_at IS NULL SET @ends_at = DATEADD(MINUTE, ISNULL(NULLIF(@duracion, 0), 30), @starts_at);

    DECLARE @nueva INT;

    BEGIN TRAN;

    UPDATE dbo.appointments
       SET status = 'CANCELADA',
           notes = LEFT(ISNULL(@notes + ' · ', '') + 'Reprogramada'
                        + CASE WHEN @reason IS NULL THEN '' ELSE ': ' + @reason END, 400),
           updated_at = SYSDATETIME()
     WHERE id = @id;

    INSERT INTO dbo.appointments
        (customer_id, customer_asset_id, professional_id, service_product_id,
         starts_at, ends_at, status, notes, created_by, rescheduled_from_id)
    VALUES
        (@customer_id, @asset_id, ISNULL(@professional_id, @prof_actual), @service_id,
         @starts_at, @ends_at, 'AGENDADA', @reason, @user_id, @id);

    SET @nueva = SCOPE_IDENTITY();

    /* El choque se comprueba DESPUES de crear la nueva y con la original ya
       cancelada: si se comprobara antes, la cita se chocaria consigo misma. */
    DECLARE @otra_id INT = NULL, @otra_desde DATETIME2(0), @otra_hasta DATETIME2(0);
    IF ISNULL(@professional_id, @prof_actual) IS NOT NULL AND @permitir_encimar = 0
        SELECT TOP 1 @otra_id = b.id, @otra_desde = b.starts_at, @otra_hasta = b.ends_at
          FROM dbo.appointments b
         WHERE b.professional_id = ISNULL(@professional_id, @prof_actual)
           AND b.id <> @nueva
           AND b.status IN ('AGENDADA', 'CONFIRMADA')
           AND b.starts_at < @ends_at AND @starts_at < b.ends_at
         ORDER BY b.starts_at;

    IF @otra_id IS NOT NULL
    BEGIN
        ROLLBACK TRAN;
        /* Los mismos tres datos que en sp_appointment_save, y por lo mismo:
           mover una cita y crearla chocan igual, asi que la pantalla no puede
           tener que entender dos formatos para decir la misma frase. */
        DECLARE @quien2 NVARCHAR(120) =
            ISNULL((SELECT full_name FROM dbo.professionals
                     WHERE id = ISNULL(@professional_id, @prof_actual)), '');
        DECLARE @msg2 NVARCHAR(400) =
            'CITA_ENCIMADA|' + @quien2
            + '|' + CONVERT(NVARCHAR(5), @otra_desde, 108)
            + '|' + CONVERT(NVARCHAR(5), @otra_hasta, 108);
        RAISERROR(@msg2, 16, 1);
        RETURN;
    END

    COMMIT TRAN;

    EXEC dbo.sp_appointment_get @id = @nueva;
END
GO
