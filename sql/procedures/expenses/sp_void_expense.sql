/* sp_void_expense
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ------------------------------------------------------------------------
   CANCELAR UN EGRESO capturado por error. No se borra: queda marcado con
   quien, cuando y por que, y deja de contar en los reportes.

   Si fue en EFECTIVO, el dinero salio del cajon de un turno. Se puede
   cancelar mientras ESE turno siga abierto: se devuelve al cajon con un
   movimiento EXPENSE positivo en el mismo turno, y el corte queda como si el
   egreso no hubiera existido. Si el turno ya se cerro, el corte ya se
   entrego y no se reescribe: se cancela un egreso de otro medio o se
   registra lo que corresponda en el turno actual.
   ------------------------------------------------------------------------ */
CREATE OR ALTER PROCEDURE dbo.sp_void_expense
    @expense_id INT,
    @user_id    INT,
    @reason     NVARCHAR(200)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @reason = NULLIF(LTRIM(RTRIM(@reason)), N'');

    BEGIN TRY
        BEGIN TRAN;

        IF @reason IS NULL
            RAISERROR('Escribe por que se cancela el egreso.', 16, 1);

        DECLARE @metodo VARCHAR(20), @monto DECIMAL(12,2), @caja INT, @turno INT,
                @anulado DATETIME2(0), @cat NVARCHAR(60);
        SELECT @metodo = e.payment_method, @monto = e.amount, @caja = e.register_id,
               @turno = e.closure_id, @anulado = e.voided_at, @cat = c.name
          FROM dbo.expenses e WITH (UPDLOCK, HOLDLOCK)
          JOIN dbo.expense_categories c ON c.id = e.category_id
         WHERE e.id = @expense_id;

        IF @metodo IS NULL
            RAISERROR('El egreso no existe.', 16, 1);
        IF @anulado IS NOT NULL
            RAISERROR('Ese egreso ya estaba cancelado.', 16, 1);

        DECLARE @devolucion INT = NULL;
        IF @metodo = 'EFECTIVO'
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
                            WHERE id = @turno AND closed_at IS NULL)
                RAISERROR('Ese egreso salio del cajon en un turno que ya se cerro. El corte ya se entrego y no se reescribe.', 16, 1);

            INSERT INTO dbo.cash_movements (datee, userId, typee, reference_id, reference, amount, note, closure_id, register_id)
            VALUES (GETDATE(), @user_id, 'EXPENSE', @expense_id,
                    LEFT(CONCAT(N'Cancelacion egreso: ', @cat), 100), @monto, LEFT(@reason, 200), @turno, @caja);
            SET @devolucion = SCOPE_IDENTITY();
        END

        UPDATE dbo.expenses
           SET voided_at = SYSDATETIME(), voided_by = @user_id, void_reason = @reason,
               void_cash_movement_id = @devolucion
         WHERE id = @expense_id;

        COMMIT TRAN;
        SELECT @expense_id AS expense_id, @devolucion AS void_cash_movement_id;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO
