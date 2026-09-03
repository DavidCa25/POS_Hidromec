/* sp_register_sale
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   PASO 3: recrear los SPs
   ============================================================ */

/* -------------------- sp_register_sale -------------------- */
CREATE OR ALTER PROCEDURE [dbo].[sp_register_sale]
    @user_id INT,
    @payment_method NVARCHAR(50),
    @SaleDetails dbo.SaleDetailType READONLY,
    @customer_id    INT = NULL,
    @due_date       DATE = NULL,
    @register_id    INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @sale_id INT;
    DECLARE @total   DECIMAL(10,2);
    DECLARE @is_credit BIT;

    IF @register_id IS NULL
        SELECT TOP 1 @register_id = id FROM dbo.registers ORDER BY id;

    SET @is_credit =
      CASE WHEN @customer_id IS NOT NULL AND UPPER(@payment_method) = 'CREDITO' THEN 1 ELSE 0 END;

    BEGIN TRY
        BEGIN TRAN;

        /* 1) Normaliza detalles y valida stock */
        ;WITH req AS (
            SELECT product_id, SUM(quantity) AS qty
            FROM @SaleDetails
            GROUP BY product_id
        ),
        stk AS (
            SELECT p.id, p.stock, r.qty
            FROM products AS p WITH (UPDLOCK, HOLDLOCK)
            JOIN req AS r ON r.product_id = p.id
        )
        SELECT TOP 1 id AS product_id, stock, qty
        INTO #insuf
        FROM stk
        WHERE stock < qty;

        IF EXISTS (SELECT 1 FROM #insuf)
        BEGIN
            DECLARE @pid INT, @stk DECIMAL(12,2), @rq DECIMAL(12,2);
            SELECT @pid = product_id, @stk = stock, @rq = qty FROM #insuf;

            DECLARE @errmsg NVARCHAR(200) =
                CONCAT('No hay stock suficiente. ProductoId=', @pid,
                       ', Stock=', CONVERT(NVARCHAR(30), @stk),
                       ', Requerido=', CONVERT(NVARCHAR(30), @rq));
            RAISERROR(@errmsg, 16, 1);
            ROLLBACK TRAN;
            RETURN;
        END

        /* 2) Total */
        SELECT @total = SUM(quantity * unit_price) FROM @SaleDetails;

        /* 3) Insertar venta (con register_id) */
        INSERT INTO sales (datee, useer_id, total, payment_method, customer_id, paid_amount, balance, due_date, register_id)
        VALUES (
          GETDATE(), @user_id, @total, @payment_method,
          @customer_id,
          CASE WHEN @is_credit = 1 THEN 0 ELSE @total END,
          CASE WHEN @is_credit = 1 THEN @total ELSE 0 END,
          @due_date,
          @register_id
        );

        SET @sale_id = SCOPE_IDENTITY();

        /* 4) Detalles */
        INSERT INTO sale_detail (sale_id, product_id, quantity, unitary_price)
        SELECT @sale_id, product_id, quantity, unit_price
        FROM @SaleDetails;

        /* 5) Stock */
        UPDATE p
        SET p.stock = p.stock - r.qty
        FROM products p
        JOIN (
            SELECT product_id, SUM(quantity) AS qty
            FROM @SaleDetails
            GROUP BY product_id
        ) AS r ON r.product_id = p.id;

        /* 6) Movimiento inventario */
        INSERT INTO inventory_movements (product_id, typee, reference, quantity, datee, descriptionn)
        SELECT d.product_id, 'salida', CAST(@sale_id AS NVARCHAR(50)), d.quantity, GETDATE(), 'Venta'
        FROM @SaleDetails d;

        /* 7) Movimiento CAJA (solo EFECTIVO contado) - turno POR CAJA */
        IF @is_credit = 0 AND UPPER(@payment_method) = 'EFECTIVO'
        BEGIN
            DECLARE @closure_id_open INT;

            SELECT TOP(1) @closure_id_open = id
            FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
            WHERE register_id = @register_id
              AND closed_at IS NULL
            ORDER BY opened_at DESC, id DESC;

            IF @closure_id_open IS NULL
            BEGIN
                RAISERROR('No hay un turno abierto en esta caja para registrar la venta en efectivo.',16,1);
                ROLLBACK TRAN;
                RETURN;
            END

            INSERT INTO cash_movements
            (datee, userId, typee, reference_id, reference, amount, note, closure_id, register_id)
            VALUES
            (GETDATE(), @user_id, 'SALE', @sale_id, CONCAT('Venta ', @sale_id), @total, NULL, @closure_id_open, @register_id);
        END

        COMMIT TRAN;

        SELECT
            @sale_id        AS sale_id,
            @total          AS total,
            @payment_method AS payment_method,
            @is_credit      AS is_credit,
            @register_id    AS register_id;

    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO
