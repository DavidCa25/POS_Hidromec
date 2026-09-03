/* sp_register_purchase
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_register_purchase
    @user_id     INT,
    @supplier_id INT,
    @subtotal    DECIMAL(10,2),
    @tax_rate    DECIMAL(5,2),
    @tax_amount  DECIMAL(10,2),
    @total       DECIMAL(10,2),
    @PurchaseDetails dbo.PurchaseDetailType READONLY
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @purchase_id    INT;
    DECLARE @product_id     INT;
    DECLARE @quantity       DECIMAL(12,2);
    DECLARE @unit_price     DECIMAL(10,2);
    DECLARE @profit_percent DECIMAL(5,2);
    DECLARE @tasa_venta     DECIMAL(6,4);
    DECLARE @obj            NVARCHAR(4);
    DECLARE @new_price      DECIMAL(10,2);

    IF (@supplier_id IS NULL)
    BEGIN
        RAISERROR('La compra requiere un proveedor.', 16, 1);
        RETURN;
    END

    BEGIN TRY
        BEGIN TRAN;

        -- Cabecera: proveedor unico de la compra
        INSERT INTO purchase (datee, useer_id, total, tax_rate, tax_amount, supplier_id, balance, payment_status)
        VALUES (GETDATE(), @user_id, @total, @tax_rate, @tax_amount, @supplier_id, @total, 'PENDIENTE');
        SET @purchase_id = SCOPE_IDENTITY();

        DECLARE purchase_cursor CURSOR LOCAL FAST_FORWARD FOR
            SELECT product_id, quantity, unit_price, profit_percent
            FROM @PurchaseDetails;

        OPEN purchase_cursor;
        FETCH NEXT FROM purchase_cursor
          INTO @product_id, @quantity, @unit_price, @profit_percent;

        WHILE @@FETCH_STATUS = 0
        BEGIN
            IF (@profit_percent IS NULL) SET @profit_percent = 0;
            IF (@profit_percent < 0)     SET @profit_percent = 0;

            -- Mismo proveedor en la linea (compatibilidad con sp_get_purchases)
            INSERT INTO purchase_detail (
                puchase_id, product_id, supplier_id, quantity, unitary_price, profit_percent
            )
            VALUES (
                @purchase_id, @product_id, @supplier_id, @quantity, @unit_price, @profit_percent
            );

            IF (@unit_price > 0)
            BEGIN
                -- Tasa de venta = tasa del producto (0 si no es objeto de IVA)
                SELECT @tasa_venta = ISNULL(tasa_iva, @tax_rate),
                       @obj        = ISNULL(objeto_impuesto, '02')
                FROM products WHERE id = @product_id;

                IF (@tasa_venta IS NULL) SET @tasa_venta = @tax_rate;
                IF (@obj <> '02')        SET @tasa_venta = 0;

                -- Costo SIN IVA -> precio de venta CON IVA
                SET @new_price =
                    ROUND(@unit_price * (1 + @tasa_venta) * (1 + (@profit_percent / 100.0)), 2);

                UPDATE products
                SET cost  = @unit_price,
                    price = @new_price,
                    stock = stock + @quantity
                WHERE id = @product_id;
            END
            ELSE
            BEGIN
                UPDATE products
                SET stock = stock + @quantity
                WHERE id = @product_id;
            END

            INSERT INTO inventory_movements (
                product_id, typee, reference, quantity, datee, descriptionn
            ) VALUES (
                @product_id, 'entrada', CAST(@purchase_id AS NVARCHAR(50)),
                @quantity, GETDATE(), 'Compra'
            );

            FETCH NEXT FROM purchase_cursor
              INTO @product_id, @quantity, @unit_price, @profit_percent;
        END;

        CLOSE purchase_cursor;
        DEALLOCATE purchase_cursor;

        COMMIT TRAN;
        SELECT @purchase_id AS purchase_id;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @ErrMsg NVARCHAR(4000) = ERROR_MESSAGE();
        DECLARE @ErrSev INT = ERROR_SEVERITY();
        DECLARE @ErrSta INT = ERROR_STATE();
        RAISERROR(@ErrMsg, @ErrSev, @ErrSta);
    END CATCH
END
GO
