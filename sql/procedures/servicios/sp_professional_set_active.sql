/* sp_professional_set_active
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Da de baja a un profesional, o lo devuelve.
 *
 * NO SE PUEDE DAR DE BAJA CON TRABAJO ENCIMA
 * ------------------------------------------
 * Si tiene lineas pendientes en ordenes abiertas, esas lineas se quedarian sin
 * responsable y sus comisiones sin destinatario. Primero se reasigna el
 * trabajo, despues se da de baja. Decirlo con el numero delante es mas util
 * que un "no se puede" a secas.
 */
CREATE OR ALTER PROCEDURE dbo.sp_professional_set_active
    @id     INT,
    @active BIT
AS
BEGIN
    SET NOCOUNT ON;

    IF @active = 0
    BEGIN
        DECLARE @pendientes INT = (
            SELECT COUNT(*)
              FROM dbo.service_order_lines l
              JOIN dbo.service_orders o ON o.id = l.order_id
             WHERE l.professional_id = @id
               AND l.status IN ('PENDIENTE', 'EN_PROCESO')
               AND o.status NOT IN ('CANCELADA', 'ENTREGADA'));

        IF @pendientes > 0
        BEGIN
            DECLARE @msg NVARCHAR(200) =
                'Tiene ' + CONVERT(NVARCHAR(10), @pendientes) +
                ' trabajo(s) sin terminar. Reasignalos antes de darlo de baja.';
            RAISERROR(@msg, 16, 1);
            RETURN;
        END
    END

    UPDATE dbo.professionals
       SET active = @active, updated_at = SYSDATETIME()
     WHERE id = @id;

    IF @@ROWCOUNT = 0
    BEGIN
        RAISERROR('Ese profesional ya no existe.', 16, 1);
        RETURN;
    END

    SELECT @id AS id, @active AS active;
END
GO
