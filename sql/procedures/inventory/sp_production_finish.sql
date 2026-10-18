/* sp_production_finish
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0060 · Termina una tanda: entran las piezas BUENAS.

   Lo que falta para lo planeado es merma de produccion y pide motivo. Salir
   mas de lo planeado se permite (la masa rindio). Costo por pieza buena =
   lo consumido al empezar / piezas buenas: la merma queda absorbida en el
   costo, y ese costo pasa a ser el del producto. */
CREATE OR ALTER PROCEDURE dbo.sp_production_finish
    @user_id      INT,
    @batch_id     INT,
    @good_qty     DECIMAL(12, 2),
    @waste_reason NVARCHAR(40) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @status VARCHAR(12), @product_id INT, @planned DECIMAL(12, 2), @total DECIMAL(14, 4), @uuid UNIQUEIDENTIFIER;

    IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE id = @user_id AND active = 1)
    BEGIN RAISERROR('Usuario invalido.', 16, 1); RETURN; END
    IF @good_qty IS NULL OR @good_qty < 0
    BEGIN RAISERROR('Indica cuantas piezas salieron buenas.', 16, 1); RETURN; END

    BEGIN TRY
        BEGIN TRAN;
        SELECT @status = status, @product_id = product_id, @planned = planned_qty, @total = total_cost, @uuid = uuid
          FROM dbo.production_batches WITH (UPDLOCK, HOLDLOCK) WHERE id = @batch_id;
        IF @status IS NULL RAISERROR('La tanda no existe.', 16, 1);
        IF @status = 'DONE' RAISERROR('Esta tanda ya se registro.', 16, 1);
        IF @status <> 'IN_PROGRESS' RAISERROR('Primero empieza la tanda: asi salen sus ingredientes.', 16, 1);

        DECLARE @waste DECIMAL(12, 2) = CASE WHEN @planned > @good_qty THEN @planned - @good_qty ELSE 0 END;
        SET @waste_reason = NULLIF(LTRIM(RTRIM(@waste_reason)), N'');
        IF @waste > 0 AND @waste_reason IS NULL RAISERROR('Indica el motivo de la merma.', 16, 1);

        DECLARE @unit DECIMAL(14, 4) = CASE WHEN @good_qty > 0 THEN ISNULL(@total, 0) / @good_qty END;

        IF @good_qty > 0
        BEGIN
            UPDATE dbo.products
               SET stock = stock + @good_qty, cost = @unit
             WHERE id = @product_id;
            INSERT INTO dbo.inventory_movements (product_id, typee, reference, quantity, datee, descriptionn, source, unit_cost)
            VALUES (@product_id, 'entrada', CONVERT(NVARCHAR(36), @uuid), @good_qty, GETDATE(),
                    LEFT(CONCAT(N'Produccion terminada',
                         CASE WHEN @waste > 0 THEN CONCAT(N' (merma ', CONVERT(NVARCHAR(30), @waste), N': ', @waste_reason, N')') ELSE N'' END), 255),
                    'PRODUCTION', @unit);
        END

        UPDATE dbo.production_batches
           SET status = 'DONE', good_qty = @good_qty, waste_qty = @waste,
               waste_reason = CASE WHEN @waste > 0 THEN @waste_reason END,
               unit_cost = @unit, finished_by = @user_id, finished_at = SYSDATETIME()
         WHERE id = @batch_id;
        COMMIT TRAN;
        SELECT @batch_id AS id, 'DONE' AS status, @good_qty AS good_qty, @waste AS waste_qty, @unit AS unit_cost;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO
