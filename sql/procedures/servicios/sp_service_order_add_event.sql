/* sp_service_order_add_event
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* --------------------------------------------- historial: nota y pausa
   El dominio de ordenes no tiene un estado «pausada», y no se inventa: una
   linea sigue EN_PROCESO y la pausa queda en el historial, que es donde el
   taller la busca («¿por que tardo tanto?»).                                */
CREATE OR ALTER PROCEDURE dbo.sp_service_order_add_event
    @order_id   INT,
    @event_type NVARCHAR(30),
    @detail     NVARCHAR(400),
    @user_id    INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @event_type = UPPER(LTRIM(RTRIM(ISNULL(@event_type, ''))));
    IF @event_type NOT IN ('NOTA', 'PAUSA', 'REANUDA')
    BEGIN RAISERROR('Ese evento no se registra por aqui.', 16, 1); RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.service_orders WHERE id = @order_id)
    BEGIN RAISERROR('Esa orden no existe.', 16, 1); RETURN; END
    IF LEN(LTRIM(RTRIM(ISNULL(@detail, '')))) = 0 AND @event_type = 'NOTA'
    BEGIN RAISERROR('La nota esta vacia.', 16, 1); RETURN; END

    INSERT INTO dbo.service_order_events (order_id, event_type, detail, user_id)
    VALUES (@order_id, @event_type, LEFT(LTRIM(RTRIM(@detail)), 400), @user_id);
    SELECT SCOPE_IDENTITY() AS id;
END
GO
