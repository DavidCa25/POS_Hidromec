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
-- Update 0049: es la PUERTA UNICA para pagar a un proveedor desde cualquier
--              pantalla (Proveedores y "salida de efectivo" en Venta). La
--              escritura del pago y de su salida del cajon vive en
--              sp_supplier_payment_apply, que tambien usa la compra de
--              contado. La caja ya no cae a "la primera": la decide
--              sp_resolve_cash_register, igual que el resto del dinero.
-- =============================================
CREATE OR ALTER PROCEDURE dbo.sp_register_supplier_payment
  @user_id        INT,
  @supplier_id    INT,
  @purchase_id    INT = NULL,
  @amount         DECIMAL(10,2),
  @payment_method NVARCHAR(50),
  @note           NVARCHAR(255) = NULL,
  @register_id    INT = NULL,
  @machine_id     NVARCHAR(64) = NULL,
  @machine_name   NVARCHAR(120) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  DECLARE @currentBalance DECIMAL(10,2);
  DECLARE @payment_id INT, @cash_id INT, @closure_id INT;
  DECLARE @metodo NVARCHAR(50) = UPPER(LTRIM(RTRIM(ISNULL(@payment_method, 'EFECTIVO'))));
  DECLARE @caja INT;

  BEGIN TRY
    BEGIN TRAN;

    /* Solo el efectivo necesita caja; lo demas no pasa por el cajon. */
    IF @metodo = 'EFECTIVO'
    BEGIN
      EXEC dbo.sp_resolve_cash_register
          @register_id = @register_id, @machine_id = @machine_id,
          @machine_name = @machine_name, @user_id = @user_id,
          @resolved = @caja OUTPUT;
      IF @caja IS NULL
        RAISERROR('No se pudo determinar la caja de la que sale el efectivo. Abre el turno en esta caja e intenta de nuevo.', 16, 1);
    END

    IF @purchase_id IS NOT NULL
    BEGIN
      SELECT @currentBalance = balance
      FROM dbo.purchase WITH (UPDLOCK, HOLDLOCK)
      WHERE id = @purchase_id
        AND supplier_id = @supplier_id;

      IF @currentBalance IS NULL
        RAISERROR('La compra no existe o no pertenece al proveedor.', 16, 1);

      IF @amount > @currentBalance
        RAISERROR('El pago no puede ser mayor al saldo de la compra.', 16, 1);
    END

    EXEC dbo.sp_supplier_payment_apply
        @user_id = @user_id, @supplier_id = @supplier_id, @purchase_id = @purchase_id,
        @amount = @amount, @payment_method = @metodo, @note = @note,
        @register_id = @caja,
        @payment_id = @payment_id OUTPUT, @cash_id = @cash_id OUTPUT, @closure_id = @closure_id OUTPUT;

    IF @purchase_id IS NOT NULL
    BEGIN
      UPDATE dbo.purchase
      SET balance = balance - @amount,
          payment_status = CASE
                             WHEN balance - @amount <= 0 THEN 'PAGADO'
                             ELSE 'PARCIAL'
                           END
      WHERE id = @purchase_id;
    END

    COMMIT TRAN;

    SELECT @payment_id AS payment_id, @cash_id AS cash_movement_id,
           @closure_id AS closure_id, @caja AS register_id;
  END TRY
  BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRAN;
    DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
    RAISERROR(@msg, 16, 1);
  END CATCH
END
GO
