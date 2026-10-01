/* sp_supplier_payment_apply
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ------------------------------------------------------------------------
   PAGAR A UN PROVEEDOR: la UNICA logica que escribe el pago y su salida del
   cajon.

   Antes habia tres caminos para el mismo acto:
     · Proveedores -> sp_register_supplier_payment (SUPPLIER_PAYMENT);
     · Compra de contado -> su propia copia dentro de sp_register_purchase;
     · Venta, "salida de efectivo para un proveedor" -> un WITHDRAW mas un
       INSERT escrito en JavaScript, fuera de todo procedure.
   El mismo pago quedaba con tipos distintos segun por donde entrara, y el
   tercero ni siquiera era una transaccion: si el INSERT fallaba, el dinero
   ya habia salido del cajon sin quedar abonado al proveedor.

   Este procedure NO abre transaccion: corre DENTRO de la de quien lo llama
   (sp_register_supplier_payment y sp_register_purchase), para que el pago, la
   salida del cajon y lo demas que haga el llamador se confirmen o se
   deshagan juntos. Por eso exige @@TRANCOUNT > 0.

   No toca purchase.balance: eso es del llamador (una compra de contado nace
   ya saldada; un abono a una compra a credito la va saldando).

   Solo el EFECTIVO sale del cajon. Una transferencia, una tarjeta o un cheque
   salen del banco.
   ------------------------------------------------------------------------ */
CREATE OR ALTER PROCEDURE dbo.sp_supplier_payment_apply
    @user_id        INT,
    @supplier_id    INT,
    @purchase_id    INT = NULL,
    @amount         DECIMAL(10,2),
    @payment_method NVARCHAR(50),
    @note           NVARCHAR(255) = NULL,
    @register_id    INT = NULL,      -- ya resuelta por el llamador (sp_resolve_cash_register)
    @reference      NVARCHAR(100) = NULL,
    @payment_id     INT OUTPUT,
    @cash_id        INT OUTPUT,
    @closure_id     INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET @payment_id = NULL;
    SET @cash_id = NULL;
    SET @closure_id = NULL;

    IF @@TRANCOUNT = 0
    BEGIN
        RAISERROR('sp_supplier_payment_apply debe correr dentro de una transaccion.', 16, 1);
        RETURN;
    END

    DECLARE @metodo NVARCHAR(50) = UPPER(LTRIM(RTRIM(ISNULL(@payment_method, 'EFECTIVO'))));

    IF @amount IS NULL OR @amount <= 0
    BEGIN
        RAISERROR('El monto del pago debe ser mayor a cero.', 16, 1);
        RETURN;
    END
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_suppliers WHERE id = @supplier_id)
    BEGIN
        RAISERROR('El proveedor no existe.', 16, 1);
        RETURN;
    END

    IF @metodo = 'EFECTIVO'
    BEGIN
        IF @register_id IS NULL
        BEGIN
            RAISERROR('No se pudo determinar la caja de la que sale el efectivo.', 16, 1);
            RETURN;
        END
        SELECT TOP (1) @closure_id = id
          FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
         WHERE register_id = @register_id
           AND closed_at IS NULL
         ORDER BY opened_at DESC, id DESC;
        IF @closure_id IS NULL
        BEGIN
            RAISERROR('Para pagar en efectivo hace falta un turno abierto en esta caja.', 16, 1);
            RETURN;
        END
    END

    INSERT INTO dbo.supplier_payments (supplier_id, purchase_id, datee, amount, payment_method, user_id, note)
    VALUES (@supplier_id, @purchase_id, GETDATE(), @amount, @metodo, @user_id, @note);
    SET @payment_id = SCOPE_IDENTITY();

    IF @metodo = 'EFECTIVO'
    BEGIN
        INSERT INTO dbo.cash_movements (datee, userId, typee, reference_id, reference, amount, note, closure_id, register_id)
        VALUES (GETDATE(), @user_id, 'SUPPLIER_PAYMENT', @payment_id,
                ISNULL(@reference, CONCAT('Pago prov. ', @supplier_id,
                       CASE WHEN @purchase_id IS NOT NULL THEN CONCAT(' compra ', @purchase_id) ELSE '' END)),
                -@amount, @note, @closure_id, @register_id);
        SET @cash_id = SCOPE_IDENTITY();

        UPDATE dbo.supplier_payments SET cash_movement_id = @cash_id WHERE id = @payment_id;
    END
END
GO
