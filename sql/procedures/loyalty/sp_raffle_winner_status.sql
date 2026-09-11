/* sp_raffle_winner_status
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ---- Mover un ganador por sus estados: entregado, no reclamado, descalificado.

   NO SE BORRA HISTORIA. Un ganador descalificado se marca como tal y sigue en
   la tabla con su boleto y su sorteo: borrarlo dejaria un sorteo con un hueco
   que nadie podria explicar despues.

   Cuando un titular se cae, el suplente de la posicion siguiente pasa a
   WINNER. Es una decision explicita de quien administra -por eso se pide
   `@promover_suplente`- y no algo que ocurra solo: dar por bueno un suplente
   sin que nadie lo decida seria repartir un premio por defecto. */
CREATE OR ALTER PROCEDURE [dbo].[sp_raffle_winner_status]
    @winner_id INT,
    @status NVARCHAR(14),
    @user_id INT = NULL,
    @notes NVARCHAR(300) = NULL,
    @promover_suplente BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @status NOT IN ('WINNER', 'ALTERNATE', 'UNCLAIMED', 'DISQUALIFIED', 'DELIVERED')
    BEGIN RAISERROR('Estado de ganador invalido.', 16, 1); RETURN; END

    DECLARE @draw INT, @pos INT;
    SELECT @draw = draw_id, @pos = position FROM dbo.raffle_winners WHERE id = @winner_id;
    IF @draw IS NULL
    BEGIN RAISERROR('Ese ganador no existe.', 16, 1); RETURN; END

    BEGIN TRY
        BEGIN TRAN;

        UPDATE dbo.raffle_winners
           SET status = @status,
               notes = ISNULL(@notes, notes),
               delivered_at = CASE WHEN @status = 'DELIVERED' THEN SYSUTCDATETIME() ELSE delivered_at END,
               delivered_by_user_id = CASE WHEN @status = 'DELIVERED' THEN @user_id ELSE delivered_by_user_id END
         WHERE id = @winner_id;

        IF @promover_suplente = 1 AND @status IN ('UNCLAIMED', 'DISQUALIFIED')
        BEGIN
            UPDATE dbo.raffle_winners
               SET status = 'WINNER'
             WHERE id = (SELECT TOP 1 id FROM dbo.raffle_winners
                          WHERE draw_id = @draw AND status = 'ALTERNATE' AND position > @pos
                          ORDER BY position);
        END

        COMMIT TRAN;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(400) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
        RETURN;
    END CATCH

    SELECT w.id AS winner_id, w.position, w.status, w.delivered_at, e.entry_number
    FROM dbo.raffle_winners w
    JOIN dbo.raffle_entries e ON e.id = w.entry_id
    WHERE w.draw_id = @draw
    ORDER BY w.position;
END
GO
