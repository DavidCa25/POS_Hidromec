/* sp_production_plan
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0060 · Planea una tanda (no mueve inventario).

   Con @batch_id cambia lo planeado de una tanda TODAVIA planeada. Sin el,
   crea una; @uuid hace el reintento idempotente: la misma tanda, no otra. */
CREATE OR ALTER PROCEDURE dbo.sp_production_plan
    @user_id         INT,
    @product_id      INT = NULL,
    @planned_qty     DECIMAL(12, 2),
    @production_date DATE = NULL,
    @note            NVARCHAR(255) = NULL,
    @machine_name    NVARCHAR(120) = NULL,
    @uuid            UNIQUEIDENTIFIER = NULL,
    @batch_id        INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @planned_qty IS NULL OR @planned_qty <= 0
    BEGIN RAISERROR('Indica cuantas piezas vas a producir.', 16, 1); RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE id = @user_id AND active = 1)
    BEGIN RAISERROR('Usuario invalido.', 16, 1); RETURN; END

    IF @batch_id IS NOT NULL
    BEGIN
        UPDATE dbo.production_batches SET planned_qty = @planned_qty, note = ISNULL(@note, note)
         WHERE id = @batch_id AND status = 'PLANNED';
        IF @@ROWCOUNT = 0
        BEGIN RAISERROR('Esta tanda ya empezo: lo planeado ya no se cambia.', 16, 1); RETURN; END
        SELECT id, LOWER(CONVERT(VARCHAR(36), uuid)) AS uuid FROM dbo.production_batches WHERE id = @batch_id;
        RETURN;
    END

    IF @uuid IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.production_batches WHERE uuid = @uuid)
    BEGIN
        SELECT id, LOWER(CONVERT(VARCHAR(36), uuid)) AS uuid FROM dbo.production_batches WHERE uuid = @uuid;
        RETURN;
    END
    IF NOT EXISTS (SELECT 1 FROM dbo.production_formulas f JOIN dbo.products p ON p.id = f.product_id
                   WHERE f.product_id = @product_id AND p.active = 1 AND p.inventory_mode = 'DIRECT')
    BEGIN RAISERROR('Este producto no tiene formula de produccion.', 16, 1); RETURN; END

    DECLARE @nuevo UNIQUEIDENTIFIER = ISNULL(@uuid, NEWID());
    INSERT INTO dbo.production_batches (uuid, product_id, status, production_date, planned_qty, note, machine_name, created_by)
    VALUES (@nuevo, @product_id, 'PLANNED', ISNULL(@production_date, CAST(GETDATE() AS DATE)),
            @planned_qty, @note, @machine_name, @user_id);
    SELECT id, LOWER(CONVERT(VARCHAR(36), uuid)) AS uuid FROM dbo.production_batches WHERE uuid = @nuevo;
END
GO
