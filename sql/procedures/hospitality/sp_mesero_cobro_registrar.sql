/* sp_mesero_cobro_registrar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0097 · UNA MESA QUE COBRÓ UN MESERO, A SU BOLSA.

   Se llama justo después de registrar la venta (y su propina) que cobró el
   mesero desde su tablet, en la MISMA transacción. El efectivo que entró por
   esa venta (movimientos SALE y TIP de la venta: lo que de verdad cuenta el
   cajón, ya con pagos divididos) lo trae el mesero, no el cajón: sale con un
   MESERO_BOLSA (−) del mismo turno. Así el corte solo espera lo que el mesero
   ya entregó.

   Una vez por venta: llamarlo otra vez devuelve lo ya registrado. */
CREATE OR ALTER PROCEDURE dbo.sp_mesero_cobro_registrar
    @sale_id INT,
    @mesero_id INT,
    @cuenta_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.mesero_cobros WHERE sale_id = @sale_id)
    BEGIN
        DECLARE @register INT, @closure INT, @metodo NVARCHAR(30), @total DECIMAL(12, 2);
        SELECT @register = register_id, @closure = closure_id, @metodo = payment_method, @total = total
          FROM dbo.sales WHERE id = @sale_id;
        IF @register IS NULL THROW 51000, 'Esa venta no existe.', 1;
        IF @closure IS NULL
            SELECT TOP (1) @closure = id FROM dbo.cash_closures
             WHERE register_id = @register AND closed_at IS NULL ORDER BY opened_at DESC, id DESC;
        IF @closure IS NULL THROW 51000, 'No hay un turno abierto en la caja de esa venta.', 1;

        DECLARE @efectivo DECIMAL(12, 2) = ISNULL((SELECT SUM(amount) FROM dbo.cash_movements
                                                    WHERE reference_id = @sale_id AND typee IN ('SALE', 'TIP')), 0);
        DECLARE @propina DECIMAL(12, 2) = 0, @prop_metodo VARCHAR(12) = NULL;
        IF OBJECT_ID(N'dbo.propinas', 'U') IS NOT NULL
            SELECT @propina = ISNULL(monto, 0), @prop_metodo = metodo FROM dbo.propinas WHERE sale_id = @sale_id;

        DECLARE @mov INT = NULL;
        BEGIN TRAN;
            IF @efectivo > 0
            BEGIN
                INSERT INTO dbo.cash_movements (datee, userId, typee, reference_id, reference, amount, note, closure_id, register_id)
                VALUES (GETDATE(), @mesero_id, 'MESERO_BOLSA', @sale_id, CONCAT(N'MESERO VENTA ', @sale_id), -@efectivo,
                        N'Efectivo que cobró el mesero: lo trae él hasta entregarlo', @closure, @register);
                SET @mov = SCOPE_IDENTITY();
            END;
            INSERT INTO dbo.mesero_cobros (sale_id, mesero_id, cuenta_id, closure_id, register_id, metodo, total, propina, propina_metodo, efectivo, cash_movement_id)
            VALUES (@sale_id, @mesero_id, @cuenta_id, @closure, @register, @metodo, @total, @propina, @prop_metodo, @efectivo, @mov);
        COMMIT;
    END;

    SELECT sale_id, mesero_id, cuenta_id, closure_id, metodo, total, propina, propina_metodo, efectivo, cobrado_en
      FROM dbo.mesero_cobros WHERE sale_id = @sale_id;
END;
GO
