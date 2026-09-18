/* sp_service_order_set_status
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Mueve la orden por sus estados operativos.
 *
 * LOS CINCO ESTADOS, Y POR QUE SON CINCO
 * --------------------------------------
 *   BORRADOR    una cotizacion sin trabajo detras. Puede no llegar a existir.
 *   ABIERTA     el trabajo entro. El coche esta dentro.
 *   EN_PROCESO  alguien esta trabajando en el.
 *   TERMINADA   el trabajo esta hecho y falta cobrar y entregar.
 *   ENTREGADA   se fue. Se cierra.
 *   CANCELADA   no se hizo. Tiene su propio procedimiento.
 *
 * No hay un estado "pagada" ni "autorizada": el dinero se deduce de la venta
 * enlazada y la autorizacion de las versiones. Un estado que diga lo mismo que
 * ya dicen otros dos datos acaba contradiciendolos.
 *
 * LAS TRANSICIONES SE VALIDAN AQUI
 * --------------------------------
 * Y no en la pantalla. Una pantalla que esconde el boton es cortesia; lo que
 * impide que una orden pase de ENTREGADA a EN_PROCESO por una llamada suelta
 * es esto.
 *
 * TERMINAR EXIGE QUE HAYA ALGO HECHO
 * ----------------------------------
 * Una orden sin una sola linea hecha no esta terminada: esta vacia. Marcarla
 * como terminada solo la sacaria de la lista de trabajo pendiente sin que
 * nadie hubiera trabajado.
 */
CREATE OR ALTER PROCEDURE dbo.sp_service_order_set_status
    @id      INT,
    @status  NVARCHAR(20),
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

    IF @status NOT IN ('BORRADOR', 'ABIERTA', 'EN_PROCESO', 'TERMINADA', 'ENTREGADA')
    BEGIN
        RAISERROR('Estado desconocido. Para cancelar hay un procedimiento aparte.', 16, 1);
        RETURN;
    END

    IF @antes = 'CANCELADA'
    BEGIN
        RAISERROR('Esta orden esta cancelada.', 16, 1);
        RETURN;
    END

    IF @antes = 'ENTREGADA'
    BEGIN
        RAISERROR('Esta orden ya se entrego.', 16, 1);
        RETURN;
    END

    /* Una orden vuelve atras mientras no se haya entregado: el taller descubre
       algo mas y hay que seguir. Lo que no hace es retroceder a BORRADOR, que
       es un estado anterior a que el trabajo existiera. */
    IF @status = 'BORRADOR' AND @antes <> 'BORRADOR'
    BEGIN
        RAISERROR('Una orden con trabajo no vuelve a ser un borrador.', 16, 1);
        RETURN;
    END

    IF @status = 'TERMINADA'
       AND NOT EXISTS (SELECT 1 FROM dbo.service_order_lines
                        WHERE order_id = @id AND status = 'HECHA')
    BEGIN
        RAISERROR('No hay ninguna linea marcada como hecha.', 16, 1);
        RETURN;
    END

    /* Entregar sin cobrar deja el trabajo fuera y el dinero dentro. Si el
       negocio quiere fiar, se cobra a credito: eso SI es una venta, con su
       saldo y su vencimiento. Lo que no puede es no existir. */
    IF @status = 'ENTREGADA' AND @sale_id IS NULL
    BEGIN
        RAISERROR('Cobra la orden antes de entregarla. Si es a credito, registra la venta a credito.', 16, 1);
        RETURN;
    END

    IF @antes = @status
    BEGIN
        EXEC dbo.sp_service_order_get @id = @id;
        RETURN;
    END

    BEGIN TRAN;

    UPDATE dbo.service_orders
       SET status = @status,
           closed_at = CASE WHEN @status = 'ENTREGADA' THEN SYSDATETIME() ELSE closed_at END,
           closed_by = CASE WHEN @status = 'ENTREGADA' THEN @user_id ELSE closed_by END
     WHERE id = @id;

    INSERT INTO dbo.service_order_events
        (order_id, event_type, from_status, to_status, user_id)
    VALUES
        (@id, 'ESTADO', @antes, @status, @user_id);

    COMMIT TRAN;

    EXEC dbo.sp_service_order_get @id = @id;
END
GO
