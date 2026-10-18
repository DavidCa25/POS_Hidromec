/* sp_production_waste
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0060 · Merma de producto TERMINADO: lo que estaba a la venta y se tiro.

   Sale de la existencia con su movimiento (salida / WASTE, referencia = uuid)
   y queda con su motivo, quien y su costo. No deja la existencia negativa: no
   se puede tirar lo que el sistema dice que no hay. @uuid hace el reintento
   idempotente. */
CREATE OR ALTER PROCEDURE dbo.sp_production_waste
    @user_id      INT,
    @product_id   INT,
    @qty          DECIMAL(12, 2),
    @reason       NVARCHAR(40),
    @waste_date   DATE = NULL,
    @machine_name NVARCHAR(120) = NULL,
    @uuid         UNIQUEIDENTIFIER = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @stock DECIMAL(12, 2), @cost DECIMAL(14, 4), @nombre NVARCHAR(100), @errmsg NVARCHAR(300);
    SET @reason = NULLIF(LTRIM(RTRIM(@reason)), N'');

    IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE id = @user_id AND active = 1)
    BEGIN RAISERROR('Usuario invalido.', 16, 1); RETURN; END
    IF @qty IS NULL OR @qty <= 0
    BEGIN RAISERROR('Indica cuantas piezas se tiraron.', 16, 1); RETURN; END
    IF @reason IS NULL
    BEGIN RAISERROR('Indica el motivo de la merma.', 16, 1); RETURN; END
    IF @uuid IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.production_waste WHERE uuid = @uuid)
    BEGIN
        SELECT id, LOWER(CONVERT(VARCHAR(36), uuid)) AS uuid FROM dbo.production_waste WHERE uuid = @uuid;
        RETURN;
    END

    BEGIN TRY
        BEGIN TRAN;
        SELECT @stock = stock, @cost = ISNULL(cost, 0), @nombre = nombre
          FROM dbo.products WITH (UPDLOCK, HOLDLOCK)
         WHERE id = @product_id AND active = 1 AND inventory_mode = 'DIRECT';
        IF @stock IS NULL RAISERROR('Solo se registra merma de un producto con inventario directo.', 16, 1);
        IF @stock < @qty
        BEGIN
            SET @errmsg = CONCAT('Solo hay ', CONVERT(NVARCHAR(30), CAST(@stock AS FLOAT)), ' de ', @nombre, ' en el sistema. Revisa la cantidad o haz un conteo.');
            RAISERROR(@errmsg, 16, 1);
        END

        DECLARE @nuevo UNIQUEIDENTIFIER = ISNULL(@uuid, NEWID());
        UPDATE dbo.products SET stock = stock - @qty WHERE id = @product_id;
        INSERT INTO dbo.inventory_movements (product_id, typee, reference, quantity, datee, descriptionn, source, unit_cost)
        VALUES (@product_id, 'salida', CONVERT(NVARCHAR(36), @nuevo), @qty, GETDATE(), LEFT(CONCAT(N'Merma: ', @reason), 255), 'WASTE', @cost);
        INSERT INTO dbo.production_waste (uuid, product_id, waste_date, qty, reason, unit_cost, machine_name, created_by)
        VALUES (@nuevo, @product_id, ISNULL(@waste_date, CAST(GETDATE() AS DATE)), @qty, @reason, @cost, @machine_name, @user_id);
        COMMIT TRAN;
        SELECT id, LOWER(CONVERT(VARCHAR(36), uuid)) AS uuid FROM dbo.production_waste WHERE uuid = @nuevo;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO
