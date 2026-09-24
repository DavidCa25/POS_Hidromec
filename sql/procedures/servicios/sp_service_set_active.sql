/* sp_service_set_active
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Retira un servicio del catalogo, o lo devuelve.
 *
 * NO BORRA
 * --------
 * La ficha de `services` se queda y el producto se marca inactivo. Un servicio
 * borrado se llevaria por delante las lineas de ordenes cerradas que lo
 * mencionan, y con ellas el historial de lo que se le cobro a un cliente. Lo
 * que se quiere es que deje de ofrecerse, no que deje de haber existido.
 */
CREATE OR ALTER PROCEDURE dbo.sp_service_set_active
    @product_id INT,
    @active     BIT
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.services WHERE product_id = @product_id)
    BEGIN
        RAISERROR('Ese producto no es un servicio.', 16, 1);
        RETURN;
    END

    UPDATE dbo.products SET active = @active WHERE id = @product_id;

    /* Al retirarlo, deja de poder agendarse. Sin esto, la Agenda seguiria
       ofreciendo citas de algo que ya no se vende. */
    IF @active = 0
        UPDATE dbo.services SET schedulable = 0, updated_at = SYSDATETIME()
         WHERE product_id = @product_id;

    SELECT @product_id AS product_id, @active AS active;
END
GO
