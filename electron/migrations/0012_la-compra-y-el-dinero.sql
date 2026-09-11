/* 0012_la-compra-y-el-dinero.sql
 * ---------------------------------------------------------------------------
 * La compra: se ve completa, no inventa precios y dice como se pago.
 *
 * QUE PASABA
 * ----------
 * 1. TABLA DE COMPRAS EN BLANCO. `sp_get_purchases` devolvia dos columnas
 *    llamadas `nombre` -el producto y el proveedor-. Un recordset no puede
 *    tener dos columnas con el mismo nombre: el driver se queda con una y la
 *    otra desaparece. La pantalla pedia `product_name` y `supplier_name`, que
 *    no existian, y pintaba las dos celdas vacias.
 *
 * 2. PRECIO DE VENTA A LOS INGREDIENTES. La compra recalcula el precio de
 *    venta a partir del costo. Correcto para lo que se vende; absurdo para un
 *    insumo: comprar leche en cajas de 1 L dejaba la leche a "$0.06" -el
 *    mililitro- en el inventario. Un ingrediente no se cobra en caja.
 *
 * 3. LA COMPRA NO DECIA COMO SE PAGO. Toda compra nacia PENDIENTE. Pagarla en
 *    efectivo obligaba a ir a Venta, hacer una salida de efectivo y escribir a
 *    mano de que compra era; nada las ataba. Y `sp_register_supplier_payment`
 *    restaba de la caja SIEMPRE, tambien por transferencia o cheque: el arqueo
 *    salia corto por dinero que nunca estuvo en el cajon.
 *
 * QUE CAMBIA
 * ----------
 * `sp_get_purchases`   cada columna con su nombre; el proveedor desde la
 *                      cabecera, con respaldo en la linea para las compras
 *                      anteriores a "una compra, un proveedor" -que tienen
 *                      `purchase.supplier_id` en NULL y sin el respaldo salen
 *                      todas sin proveedor-; LEFT JOIN para que una compra sin
 *                      partidas o con un producto dado de baja siga
 *                      apareciendo; ademas presentacion, cantidad en unidad
 *                      base y saldo.
 *
 * `sp_register_purchase`  no toca `price` cuando sellable = 0, y acepta
 *                      @payment_method (CREDITO | EFECTIVO | TARJETA |
 *                      TRANSFERENCIA) con @register_id. Solo el EFECTIVO
 *                      mueve el cajon, y para eso exige turno abierto: el
 *                      movimiento nace colgado de ese turno y aparece en el
 *                      corte. Lo demas queda como cuenta por pagar del
 *                      proveedor (purchase.balance / supplier_payments).
 *
 * `sp_register_supplier_payment`  el movimiento de caja solo se crea en
 *                      efectivo, y lleva closure_id y register_id.
 *
 * El costo (products.cost = unit_price / factor_to_base, sin IVA) no cambia:
 * ya era correcto. Lo que estaba mal era la pantalla, que prometia otro
 * numero.
 * ---------------------------------------------------------------------------
 */

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Compras con su detalle, una fila por partida.
--
-- Devolvia DOS columnas llamadas `nombre` -el producto y el proveedor-. Un
-- recordset no puede tener dos columnas con el mismo nombre: el driver se
-- queda con una y la otra se pierde, asi que la tabla de compras mostraba
-- ambas en blanco. Cada columna sale ya con el nombre que espera la pantalla.
--
-- El proveedor se lee de la CABECERA, que es donde manda desde que una compra
-- es de un solo proveedor. Las compras ANTERIORES a esa regla tienen
-- `purchase.supplier_id` en NULL y el proveedor solo en la linea: por eso el
-- COALESCE. Sin el, todo el historial viejo sale sin proveedor.
--
-- Y las uniones son LEFT: una compra sin partidas, o cuyo producto se dio de
-- baja, tiene que seguir apareciendo.
CREATE OR ALTER PROCEDURE sp_get_purchases
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        p.id                AS purchase_id,
        p.datee,
        p.datee             AS date_iso,
        u.usuario           AS user_name,
        p.total,
        p.tax_rate,
        p.tax_amount,
        p.balance,
        p.payment_status,
        COALESCE(p.supplier_id, pd.supplier_id) AS supplier_id,
        prov.nombre         AS supplier_name,

        pd.id               AS purchase_detail_id,
        pd.product_id,
        pr.nombre           AS product_name,
        pr.part_number,
        pd.quantity,
        pd.unitary_price,
        pd.subtotal,
        pd.profit_percent,

        -- En que se compro y cuanto entro al inventario, en unidad base.
        pd.presentation_id,
        pp.name             AS presentation_name,
        pd.factor_to_base,
        pd.base_quantity,
        pr.base_uom
    FROM dbo.purchase p
    INNER JOIN dbo.users u             ON u.id  = p.useer_id
    LEFT  JOIN dbo.purchase_detail pd   ON pd.puchase_id = p.id
    LEFT  JOIN dbo.CAT_suppliers prov   ON prov.id = COALESCE(p.supplier_id, pd.supplier_id)
    LEFT  JOIN dbo.products pr          ON pr.id = pd.product_id
    LEFT  JOIN dbo.product_presentations pp ON pp.id = pd.presentation_id
    ORDER BY p.datee DESC, p.id DESC, pd.id ASC;
END;
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
