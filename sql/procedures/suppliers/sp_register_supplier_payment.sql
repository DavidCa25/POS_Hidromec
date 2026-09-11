/* sp_register_supplier_payment
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<David Casillas>
-- Create date: <07-12-2025>
-- Description:	<Registrar pago a proveedores>
-- Update:      Solo el EFECTIVO mueve el cajon. Antes, pagar por
--              transferencia o con cheque tambien restaba de la caja: el
--              arqueo salia corto por dinero que nunca estuvo ahi. Y el
--              movimiento nacia sin closure_id ni register_id, asi que en
--              multicaja podia acabar en el corte de otra.
-- =============================================
CREATE OR ALTER PROCEDURE dbo.sp_register_supplier_payment
  @user_id        INT,
  @supplier_id    INT,
  @purchase_id    INT = NULL,
  @amount         DECIMAL(10,2),
  @payment_method NVARCHAR(50),
  @note           NVARCHAR(255) = NULL,
  @register_id    INT = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  DECLARE @currentBalance DECIMAL(10,2);
  DECLARE @payment_id INT, @cash_id INT = NULL;
  DECLARE @metodo NVARCHAR(50) = UPPER(LTRIM(RTRIM(ISNULL(@payment_method, 'EFECTIVO'))));
  DECLARE @closure_id INT = NULL;

  IF @register_id IS NULL
      SELECT TOP 1 @register_id = id FROM dbo.registers ORDER BY id;

  IF @metodo = 'EFECTIVO'
  BEGIN
    SELECT TOP (1) @closure_id = id
    FROM dbo.cash_closures
    WHERE register_id = @register_id
      AND closed_at IS NULL
    ORDER BY opened_at DESC, id DESC;

    IF @closure_id IS NULL
    BEGIN
      RAISERROR('Para pagar en efectivo hace falta un turno abierto en esta caja.',16,1);
      RETURN;
    END
  END

  BEGIN TRY
    BEGIN TRAN;

    IF @purchase_id IS NOT NULL
    BEGIN
      SELECT @currentBalance = balance
      FROM purchase WITH (UPDLOCK, HOLDLOCK)
      WHERE id = @purchase_id
        AND supplier_id = @supplier_id;

      IF @currentBalance IS NULL
      BEGIN
        RAISERROR('La compra no existe o no pertenece al proveedor.',16,1);
        ROLLBACK TRAN;
        RETURN;
      END

      IF @amount > @currentBalance
      BEGIN
        RAISERROR('El pago no puede ser mayor al saldo de la compra.',16,1);
        ROLLBACK TRAN;
        RETURN;
      END
    END

    -- 1) Registrar pago a proveedor
    INSERT INTO supplier_payments(
      supplier_id, purchase_id, amount, payment_method, user_id, note
    )
    VALUES(
      @supplier_id, @purchase_id, @amount, @metodo, @user_id, @note
    );

    SET @payment_id = SCOPE_IDENTITY();

    -- 2) Movimiento de CAJA (salida). SOLO en efectivo: un cheque o una
    --    transferencia salen del banco, no del cajon.
    IF @metodo = 'EFECTIVO'
    BEGIN
      INSERT INTO cash_movements(
        datee, userId, typee, reference_id, reference, amount, note,
        closure_id, register_id
      )
      VALUES(
        GETDATE(),
        @user_id,
        'SUPPLIER_PAYMENT',
        @payment_id,
        CONCAT('Pago prov. ', @supplier_id,
               CASE WHEN @purchase_id IS NOT NULL
                    THEN CONCAT(' compra ', @purchase_id)
                    ELSE ''
               END),
        -@amount,
        @note,
        @closure_id,
        @register_id
      );

      SET @cash_id = SCOPE_IDENTITY();

      UPDATE supplier_payments
        SET cash_movement_id = @cash_id
      WHERE id = @payment_id;
    END

    -- 3) Actualizar saldo de la compra (si aplica)
    IF @purchase_id IS NOT NULL
    BEGIN
      UPDATE purchase
      SET balance = balance - @amount,
          payment_status = CASE
                             WHEN balance - @amount <= 0 THEN 'PAGADO'
                             ELSE 'PARCIAL'
                           END
      WHERE id = @purchase_id;
    END

    COMMIT TRAN;

    SELECT @payment_id AS payment_id, @cash_id AS cash_movement_id;
  END TRY
  BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRAN;
    DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
    RAISERROR(@msg, 16, 1);
  END CATCH
END
GO
