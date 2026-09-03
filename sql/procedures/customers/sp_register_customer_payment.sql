/* sp_register_customer_payment
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_register_customer_payment
    @customer_id    INT,
    @sale_id        INT,
    @amount         DECIMAL(10,2),
    @user_id        INT,
    @payment_method NVARCHAR(50),     -- EFECTIVO / TARJETA / TRANSFERENCIA
    @note           NVARCHAR(255) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @currentBalance DECIMAL(10,2);
    DECLARE @paidAmount     DECIMAL(10,2);
    DECLARE @saleMethod     NVARCHAR(50);
    DECLARE @payment_id     INT;

    IF @amount <= 0
    BEGIN
        RAISERROR('El monto del abono debe ser mayor a 0.', 16, 1);
        RETURN;
    END

    BEGIN TRY
        BEGIN TRAN;

        -- 1) Traer la venta y bloquearla mientras se actualiza
        SELECT TOP 1
            @currentBalance = balance,
            @paidAmount     = paid_amount,
            @saleMethod     = payment_method
        FROM sales WITH (UPDLOCK, HOLDLOCK)
        WHERE id = @sale_id
          AND customer_id = @customer_id;

        IF @currentBalance IS NULL
        BEGIN
            RAISERROR('La venta indicada no existe o no pertenece al cliente.', 16, 1);
            ROLLBACK TRAN;
            RETURN;
        END

        IF UPPER(@saleMethod) <> 'CREDITO'
        BEGIN
            RAISERROR('Solo se pueden registrar abonos sobre ventas a crédito.', 16, 1);
            ROLLBACK TRAN;
            RETURN;
        END

        IF @currentBalance <= 0
        BEGIN
            RAISERROR('La venta ya está totalmente liquidada.', 16, 1);
            ROLLBACK TRAN;
            RETURN;
        END

        IF @amount > @currentBalance
        BEGIN
            RAISERROR('El monto del abono no puede ser mayor al saldo pendiente.', 16, 1);
            ROLLBACK TRAN;
            RETURN;
        END

        -- 2) Actualizar la venta
        UPDATE sales
        SET paid_amount = paid_amount + @amount,
            balance     = balance - @amount
        WHERE id = @sale_id;

        -- 3) Registrar el pago
        INSERT INTO customer_payments
        (
            customer_id,
            sale_id,
            datee,
            amount,
            user_id,
            payment_method,
            note
        )
        VALUES
        (
            @customer_id,
            @sale_id,
            SYSDATETIME(),
            @amount,
            @user_id,
            @payment_method,
            @note
        );

        SET @payment_id = SCOPE_IDENTITY();

        -- 4) Movimiento de caja
        INSERT INTO cash_movements
        (
            datee,
            userId,
            typee,
            reference_id,
            reference,
            amount,
            note
        )
        VALUES
        (
            SYSDATETIME(),
            @user_id,
            'PAYMENT',
            @payment_id,   -- puedes usar @sale_id si prefieres
            CONCAT('Abono venta ', @sale_id, ' cliente ', @customer_id),
            @amount,
            @note
        );

        COMMIT TRAN;

        -- 5) Regresar datos útiles
        SELECT
            @payment_id AS payment_id,
            @sale_id    AS sale_id,
            @customer_id AS customer_id,
            @amount     AS amount,
            (SELECT balance FROM sales WHERE id = @sale_id) AS new_balance;

    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END;
GO
