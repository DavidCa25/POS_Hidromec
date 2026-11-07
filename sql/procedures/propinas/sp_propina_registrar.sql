/* sp_propina_registrar
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ======================= sp_propina_registrar (0079) ======================
   La propina de una venta. La llama el canal de cobro justo despues de que
   la venta quedo registrada. Una por venta.

   No es venta: no toca sales ni sale_detail, no lleva IVA, no entra en
   utilidad ni en el reparto de socios.

   EFECTIVO  entra al cajon del turno abierto de la caja de la venta
             (movimiento TIP): el corte la espera.
   TARJETA   llega al banco: no toca el cajon hasta que se paga el reparto.

   Quien atendio es quien cobro la venta.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_propina_registrar
    @sale_id INT,
    @monto   DECIMAL(10, 2),
    @metodo  VARCHAR(12),
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'propinas' AND enabled = 1)
        THROW 51000, N'Propinas no está activado.', 1;
    SET @metodo = UPPER(LTRIM(RTRIM(ISNULL(@metodo, ''))));
    IF @metodo NOT IN ('EFECTIVO', 'TARJETA') THROW 51000, N'La propina es en efectivo o con tarjeta.', 1;
    IF @monto IS NULL OR @monto <= 0 THROW 51000, N'La propina debe ser mayor a cero.', 1;

    DECLARE @register INT, @atendio INT, @total DECIMAL(10, 2);
    SELECT @register = register_id, @atendio = useer_id, @total = total FROM dbo.sales WHERE id = @sale_id;
    IF @atendio IS NULL THROW 51000, N'Esa venta no existe.', 1;
    IF @monto > ISNULL(@total, 0) THROW 51000, N'La propina no puede ser mayor que la cuenta.', 1;

    DECLARE @closure INT, @cash_id INT = NULL, @id INT;
    BEGIN TRAN;
        IF EXISTS (SELECT 1 FROM dbo.propinas WITH (UPDLOCK, HOLDLOCK) WHERE sale_id = @sale_id)
            THROW 51000, N'Esa venta ya tiene propina.', 1;

        SELECT TOP (1) @closure = id FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
         WHERE register_id = @register AND closed_at IS NULL
         ORDER BY opened_at DESC, id DESC;

        IF @metodo = 'EFECTIVO'
        BEGIN
            IF @closure IS NULL THROW 51000, N'No hay un turno abierto en esta caja para recibir la propina.', 1;
            INSERT INTO dbo.cash_movements (datee, userId, typee, reference_id, reference, amount, note, closure_id, register_id)
            VALUES (GETDATE(), ISNULL(@user_id, @atendio), 'TIP', @sale_id, CONCAT(N'PROPINA VENTA ', @sale_id),
                    @monto, N'Propina en efectivo', @closure, @register);
            SET @cash_id = SCOPE_IDENTITY();
        END

        INSERT INTO dbo.propinas (sale_id, monto, metodo, user_id, register_id, closure_id, fecha, cash_movement_id)
        VALUES (@sale_id, @monto, @metodo, @atendio, @register, @closure, SYSDATETIME(), @cash_id);
        SET @id = SCOPE_IDENTITY();
    COMMIT;

    SELECT id, sale_id, monto, metodo, user_id, register_id, closure_id, fecha, cash_movement_id
      FROM dbo.propinas WHERE id = @id;
END
GO
