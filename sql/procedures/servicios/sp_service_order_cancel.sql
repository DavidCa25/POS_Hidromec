/* sp_service_order_cancel
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Cancela una orden: el trabajo no se hizo.
 *
 * TIENE SU PROPIO PROCEDIMIENTO PORQUE NO ES UN ESTADO MAS
 * --------------------------------------------------------
 * Los demas estados describen por donde va el trabajo. Cancelar dice que no
 * va a haber trabajo, y eso pide dos cosas que los otros no: un motivo, y que
 * no se pueda hacer sobre algo ya cobrado.
 *
 * EL MOTIVO ES OBLIGATORIO
 * ------------------------
 * Una orden cancelada sin motivo es una pregunta sin respuesta dentro de seis
 * meses: se cancelo porque el cliente se arrepintio, porque no habia refaccion,
 * o porque alguien se equivoco de orden. Son tres cosas distintas y solo una
 * es un problema del negocio.
 *
 * NO SE CANCELA LO YA COBRADO
 * ---------------------------
 * Si hay venta, el dinero ya se movio. Deshacerlo es una devolucion, con su
 * autorizacion presencial y su registro, no un cambio de estado aqui.
 */
CREATE OR ALTER PROCEDURE dbo.sp_service_order_cancel
    @id      INT,
    @reason  NVARCHAR(400),
    @user_id INT = NULL,
    @rowver  BINARY(8) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @actual BINARY(8), @antes NVARCHAR(20), @sale_id INT;
    SELECT @actual = rowver, @antes = status, @sale_id = sale_id
      FROM dbo.service_orders WHERE id = @id;

    IF @antes IS NULL
    BEGIN
        RAISERROR('Esa orden no existe.', 16, 1);
        RETURN;
    END

    IF @rowver IS NOT NULL AND @rowver <> @actual
    BEGIN
        RAISERROR('CONFLICTO_DE_VERSION', 16, 1);
        RETURN;
    END

    IF @antes = 'CANCELADA'
    BEGIN
        RAISERROR('Esta orden ya estaba cancelada.', 16, 1);
        RETURN;
    END

    IF @sale_id IS NOT NULL
    BEGIN
        RAISERROR('Esta orden ya se cobro. Para deshacerlo hay que hacer una devolucion sobre la venta.', 16, 1);
        RETURN;
    END

    IF @reason IS NULL OR LTRIM(RTRIM(@reason)) = ''
    BEGIN
        RAISERROR('Anota por que se cancela.', 16, 1);
        RETURN;
    END

    BEGIN TRAN;

    UPDATE dbo.service_orders
       SET status = 'CANCELADA',
           closed_at = SYSDATETIME(),
           closed_by = @user_id
     WHERE id = @id;

    /* Las lineas pendientes se cancelan con ella: dejarlas en PENDIENTE las
       mantendria contando como trabajo por hacer en la carga de cada persona. */
    UPDATE dbo.service_order_lines
       SET status = 'CANCELADA'
     WHERE order_id = @id AND status IN ('PENDIENTE', 'EN_PROCESO');

    /* Las citas que llevaban a esta orden dejan de tener sentido. */
    UPDATE dbo.appointments
       SET status = 'CANCELADA', updated_at = SYSDATETIME()
     WHERE service_order_id = @id AND status IN ('AGENDADA', 'CONFIRMADA');

    INSERT INTO dbo.service_order_events
        (order_id, event_type, from_status, to_status, detail, user_id)
    VALUES
        (@id, 'CANCELADA', @antes, 'CANCELADA', @reason, @user_id);

    COMMIT TRAN;

    EXEC dbo.sp_service_order_get @id = @id;
END
GO
