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
CREATE OR ALTER PROCEDURE dbo.sp_register_purchase
    @user_id     INT,
    @supplier_id INT,
    @subtotal    DECIMAL(10,2),
    @tax_rate    DECIMAL(5,2),
    @tax_amount  DECIMAL(10,2),
    @total       DECIMAL(10,2),
    @PurchaseDetails  dbo.PurchaseDetailType READONLY,
    @PurchaseDetails2 dbo.PurchaseDetailType2 READONLY
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF (@supplier_id IS NULL)
    BEGIN
        RAISERROR('La compra requiere un proveedor.', 16, 1);
        RETURN;
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

        -- Cabecera: proveedor unico de la compra
        DECLARE @purchase_id INT;
        INSERT INTO purchase (datee, useer_id, total, tax_rate, tax_amount, supplier_id, balance, payment_status)
        VALUES (GETDATE(), @user_id, @total, @tax_rate, @tax_amount, @supplier_id, @total, 'PENDIENTE');
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
            -- Costo SIN IVA -> precio de venta CON IVA (0 si no es objeto de IVA)
            price = ROUND(
                      (u.unit_price / u.factor)
                      * (1 + CASE WHEN ISNULL(p.objeto_impuesto, '02') <> '02' THEN 0
                                  ELSE ISNULL(p.tasa_iva, @tax_rate) END)
                      * (1 + (u.profit_percent / 100.0)), 2)
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
