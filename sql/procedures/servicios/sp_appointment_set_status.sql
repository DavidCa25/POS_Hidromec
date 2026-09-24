/* sp_appointment_set_status
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Confirma, atiende, cancela o marca que no llego.
 *
 * "CANCELADA" Y "NO_ASISTIO" NO SON LO MISMO
 * ------------------------------------------
 * Una se avisa y la otra se pierde. Para el negocio son dos cosas distintas:
 * la primera libera el hueco con tiempo, la segunda deja a alguien parado una
 * hora. Juntarlas en un solo estado haria imposible saber cual de los dos
 * problemas tiene el negocio, que es justo lo que se querria saber.
 *
 * ATENDIDA SE PONE SOLA
 * ---------------------
 * Cuando la cita se convierte en orden de servicio,
 * `sp_appointment_to_order` la marca. Ponerla a mano existe para el caso en
 * que se atendio sin abrir orden -una revision de cortesia-, no como camino
 * normal.
 */
CREATE OR ALTER PROCEDURE dbo.sp_appointment_set_status
    @id      INT,
    @status  NVARCHAR(15),
    @notes   NVARCHAR(400) = NULL,
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @antes NVARCHAR(15), @order_id INT;
    SELECT @antes = status, @order_id = service_order_id FROM dbo.appointments WHERE id = @id;

    IF @antes IS NULL
    BEGIN
        RAISERROR('Esa cita no existe.', 16, 1);
        RETURN;
    END

    IF @status NOT IN ('AGENDADA', 'CONFIRMADA', 'ATENDIDA', 'CANCELADA', 'NO_ASISTIO')
    BEGIN
        RAISERROR('Estado de cita desconocido.', 16, 1);
        RETURN;
    END

    /* Una cita que ya genero trabajo no se cancela: el trabajo existe. Lo que
       se cancela en ese caso es la orden, y eso arrastra la cita. */
    IF @status IN ('CANCELADA', 'NO_ASISTIO') AND @order_id IS NOT NULL
    BEGIN
        RAISERROR('Esta cita ya genero una orden de servicio. Cancela la orden.', 16, 1);
        RETURN;
    END

    UPDATE dbo.appointments
       SET status = @status,
           notes = CASE WHEN @notes IS NULL THEN notes
                        ELSE LEFT(ISNULL(notes + ' · ', '') + @notes, 400) END,
           updated_at = SYSDATETIME()
     WHERE id = @id;

    EXEC dbo.sp_appointment_get @id = @id;
END
GO
