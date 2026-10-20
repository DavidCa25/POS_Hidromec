/* sp_production_cancel
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0060 · Cancela una tanda PLANEADA (no movio nada). Una que ya empezo no
   se cancela: sus ingredientes ya se usaron. Si no salio nada, se termina
   con 0 piezas buenas y su motivo, y queda como merma. */
CREATE OR ALTER PROCEDURE dbo.sp_production_cancel
    @user_id  INT,
    @batch_id INT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.production_batches
       SET status = 'CANCELLED', cancelled_by = @user_id, cancelled_at = SYSDATETIME()
     WHERE id = @batch_id AND status = 'PLANNED';
    IF @@ROWCOUNT = 0
    BEGIN RAISERROR('Solo se cancela una tanda planeada. Si ya empezo y no salio nada, terminala con 0 piezas buenas.', 16, 1); RETURN; END
    SELECT @batch_id AS id, 'CANCELLED' AS status;
END
GO
