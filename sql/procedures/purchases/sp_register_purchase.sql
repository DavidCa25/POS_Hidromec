/* sp_register_purchase
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Registra una compra. Sigue siendo LA UNICA ruta de compra: los
-- ingredientes de Hospitality entran por aqui.
--
-- Transicion ADITIVA (SQL Server no permite ALTER TYPE): se aceptan
-- @PurchaseDetails (tipo v1, sin presentacion) y @PurchaseDetails2 (v2, con
-- presentation_id). quantity y unit_price van en la PRESENTACION capturada
-- (5 bolsas a $200); factor_to_base convierte a la unidad base del producto
-- (+5000 g). Sin presentacion el factor es 1 y todo queda como antes.
--
-- Costo: products.cost = costo por unidad BASE (unit_price / factor). Es el
-- "ultimo costo", la fuente instantanea de V1 (sin promedio ponderado).
--
-- FORMA DE PAGO (@payment_method). Una compra es un documento del proveedor;
-- el dinero es otra cosa:
--   CREDITO        queda a deber. balance = total, PENDIENTE. No toca la caja.
--   EFECTIVO       sale del cajon: exige turno abierto y deja el movimiento
--                  colgado de ESE turno, para que salga en el corte.
--   TARJETA        pagadas, pero el efectivo del cajon no se mueve: se
--   TRANSFERENCIA  registra el pago al proveedor y nada mas.
-- Asi el corte cuadra con lo que hay fisicamente en el cajon, y la cuenta por
-- pagar vive en purchase.balance / supplier_payments.
CREATE OR ALTER PROCEDURE dbo.sp_register_purchase
    @user_id     INT,
    @supplier_id INT,
    @subtotal    DECIMAL(10,2),
    @tax_rate    DECIMAL(5,2),
    @tax_amount  DECIMAL(10,2),
    @total       DECIMAL(10,2),
    @PurchaseDetails  dbo.PurchaseDetailType READONLY,
    @PurchaseDetails2 dbo.PurchaseDetailType2 READONLY,
    @payment_method NVARCHAR(20) = 'CREDITO',
    @register_id    INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF (@supplier_id IS NULL)
    BEGIN
        RAISERROR('La compra requiere un proveedor.', 16, 1);
        RETURN;
    END

    DECLARE @metodo NVARCHAR(20) = UPPER(LTRIM(RTRIM(ISNULL(@payment_method, 'CREDITO'))));
    IF @metodo NOT IN ('CREDITO', 'EFECTIVO', 'TARJETA', 'TRANSFERENCIA')
    BEGIN
        RAISERROR('Forma de pago no valida para una compra.', 16, 1);
        RETURN;
    END

    IF @register_id IS NULL
        SELECT TOP 1 @register_id = id FROM dbo.registers ORDER BY id;

    -- El efectivo sale del cajon: sin turno abierto no hay de donde sacarlo, y
    -- el movimiento quedaria fuera de todo corte.
    DECLARE @closure_id INT = NULL;
    IF @metodo = 'EFECTIVO'
    BEGIN
        SELECT TOP (1) @closure_id = id
        FROM dbo.cash_closures
        WHERE register_id = @register_id
          AND closed_at IS NULL
        ORDER BY opened_at DESC, id DESC;

        IF @closure_id IS NULL
        BEGIN
            RAISERROR('Para pagar una compra en efectivo hace falta un turno abierto en esta caja.', 16, 1);
            RETURN;
        END
    END

    DECLARE @rows TABLE (
        rn INT IDENTITY(1,1) NOT NULL,
        product_id INT NOT NULL,
        quantity DECIMAL(12,2) NOT NULL,
        unit_price DECIMAL(10,2) NOT NULL,
        profit_percent DECIMAL(5,2) NOT NULL,
        presentation_id INT NULL,
        factor DECIMAL(14,4) NULL
    );

    INSERT INTO @rows (product_id, quantity, unit_price, profit_percent, presentation_id, factor)
    SELECT product_id, quantity, unit_price,
           CASE WHEN ISNULL(profit_percent, 0) < 0 THEN 0 ELSE ISNULL(profit_percent, 0) END,
           NULL, 1
    FROM @PurchaseDetails
    UNION ALL
    SELECT product_id, quantity, unit_price,
           CASE WHEN ISNULL(profit_percent, 0) < 0 THEN 0 ELSE ISNULL(profit_percent, 0) END,
           presentation_id, CASE WHEN presentation_id IS NULL THEN 1 ELSE NULL END
    FROM @PurchaseDetails2;

    IF NOT EXISTS (SELECT 1 FROM @rows)
    BEGIN
        RAISERROR('La compra no tiene partidas.', 16, 1);
        RETURN;
    END

    -- Presentacion: debe existir y pertenecer al producto de la linea.
    UPDATE r SET factor = pp.factor_to_base
    FROM @rows r
    JOIN dbo.product_presentations pp ON pp.id = r.presentation_id AND pp.product_id = r.product_id;

    IF EXISTS (SELECT 1 FROM @rows WHERE factor IS NULL)
    BEGIN
        RAISERROR('Una presentacion de compra no corresponde al producto de la linea.', 16, 1);
        RETURN;
    END

    IF EXISTS (SELECT 1 FROM @rows r LEFT JOIN dbo.products p ON p.id = r.product_id WHERE p.id IS NULL)
    BEGIN
        RAISERROR('Un producto de la compra no existe.', 16, 1);
        RETURN;
    END

    BEGIN TRY
        BEGIN TRAN;

        DECLARE @saldo DECIMAL(10,2) = CASE WHEN @metodo = 'CREDITO' THEN @total ELSE 0 END;

        -- Cabecera: proveedor unico de la compra
        DECLARE @purchase_id INT;
        INSERT INTO purchase (datee, useer_id, total, tax_rate, tax_amount, supplier_id, balance, payment_status)
        VALUES (GETDATE(), @user_id, @total, @tax_rate, @tax_amount, @supplier_id, @saldo,
                CASE WHEN @metodo = 'CREDITO' THEN 'PENDIENTE' ELSE 'PAGADO' END);
        SET @purchase_id = SCOPE_IDENTITY();

        -- Mismo proveedor en la linea (compatibilidad con sp_get_purchases)
        INSERT INTO purchase_detail (
            puchase_id, product_id, supplier_id, quantity, unitary_price, profit_percent,
            presentation_id, factor_to_base
        )
        SELECT @purchase_id, product_id, @supplier_id, quantity, unit_price, profit_percent,
               presentation_id, factor
        FROM @rows
        ORDER BY rn;

        -- Costo y precio de venta: solo lineas con precio; si un producto
        -- viene varias veces, manda la ultima (como hacia el cursor).
        ;WITH ult AS (
            SELECT r.*, ROW_NUMBER() OVER (PARTITION BY r.product_id ORDER BY r.rn DESC) AS k
            FROM @rows r
            WHERE r.unit_price > 0
        )
        UPDATE p
        SET cost  = CAST(u.unit_price / u.factor AS DECIMAL(14,4)),
            -- El precio de venta solo tiene sentido en lo que se vende. Un
            -- ingrediente (sellable = 0) no se cobra en caja: escribirle un
            -- precio solo ensucia el inventario con "$0.30" por gramo.
            price = CASE WHEN p.sellable = 0 THEN p.price ELSE ROUND(
                      -- Costo SIN IVA -> precio de venta CON IVA (0 si no es objeto de IVA)
                      (u.unit_price / u.factor)
                      * (1 + CASE WHEN ISNULL(p.objeto_impuesto, '02') <> '02' THEN 0
                                  ELSE ISNULL(p.tasa_iva, @tax_rate) END)
                      * (1 + (u.profit_percent / 100.0)), 2) END
        FROM products p
        JOIN ult u ON u.product_id = p.id
        WHERE u.k = 1;

        -- Stock en unidad base
        UPDATE p
        SET stock = p.stock + s.qty
        FROM products p
        JOIN (SELECT product_id, SUM(quantity * factor) AS qty FROM @rows GROUP BY product_id) s
          ON s.product_id = p.id;

        INSERT INTO inventory_movements (
            product_id, typee, reference, quantity, datee, descriptionn, source, unit_cost
        )
        SELECT product_id, 'entrada', CAST(@purchase_id AS NVARCHAR(50)),
               quantity * factor, GETDATE(), 'Compra', 'PURCHASE',
               CASE WHEN unit_price > 0 THEN CAST(unit_price / factor AS DECIMAL(14,4)) ELSE NULL END
        FROM @rows
        ORDER BY rn;

        -- Pago. A credito no hay nada que registrar aqui: la deuda ya quedo
        -- en purchase.balance y se salda por sp_register_supplier_payment.
        DECLARE @payment_id INT = NULL, @cash_id INT = NULL;
        IF @metodo <> 'CREDITO'
        BEGIN
            INSERT INTO dbo.supplier_payments (
                supplier_id, purchase_id, datee, amount, payment_method, user_id, note
            )
            VALUES (@supplier_id, @purchase_id, GETDATE(), @total, @metodo, @user_id,
                    CONCAT('Pago de la compra ', @purchase_id));
            SET @payment_id = SCOPE_IDENTITY();

            -- Solo el efectivo mueve el cajon. Una transferencia o una tarjeta
            -- salen del banco: meterlas al corte descuadraria el arqueo.
            IF @metodo = 'EFECTIVO'
            BEGIN
                INSERT INTO dbo.cash_movements (
                    datee, userId, typee, reference_id, reference, amount, note,
                    closure_id, register_id
                )
                VALUES (GETDATE(), @user_id, 'SUPPLIER_PAYMENT', @payment_id,
                        CONCAT('Compra ', @purchase_id), -@total,
                        CONCAT('Compra ', @purchase_id, ' pagada en efectivo'),
                        @closure_id, @register_id);
                SET @cash_id = SCOPE_IDENTITY();

                UPDATE dbo.supplier_payments SET cash_movement_id = @cash_id WHERE id = @payment_id;
            END
        END

        COMMIT TRAN;
        SELECT @purchase_id AS purchase_id,
               @metodo      AS payment_method,
               @saldo       AS balance,
               @payment_id  AS payment_id,
               @cash_id     AS cash_movement_id,
               @closure_id  AS closure_id;
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
