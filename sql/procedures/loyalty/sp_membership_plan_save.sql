SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_membership_plan_save (0063) =====================
   Alta o cambio de un plan del Club.

   El precio NO vive aquí: es el del producto de cobro, que se vende como
   cualquier otro (corte, factura, estado de resultados). Ese producto debe
   ser "sin inventario" y no puede ser el producto de cobro de otro plan.
   @products_json: los productos que se pueden dar, como [12, 15, 31].
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_membership_plan_save
    @id              INT = NULL,
    @name            NVARCHAR(80),
    @sale_product_id INT,
    @period_days     INT = 30,
    @daily_limit     INT = 1,
    @grace_days      INT = 0,
    @active          BIT = 1,
    @products_json   NVARCHAR(MAX) = N'[]'
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET @name = NULLIF(LTRIM(RTRIM(@name)), N'');
    IF @name IS NULL THROW 51000, 'Ponle nombre al plan.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @sale_product_id AND active = 1)
        THROW 51000, 'Elige el producto con el que se cobra la membresia.', 1;
    IF EXISTS (SELECT 1 FROM dbo.products WHERE id = @sale_product_id AND inventory_mode <> 'NONE')
        THROW 51000, 'El producto de la membresia debe ser sin inventario.', 1;
    IF EXISTS (SELECT 1 FROM dbo.membership_plans WHERE sale_product_id = @sale_product_id AND id <> ISNULL(@id, -1))
        THROW 51000, 'Ese producto ya cobra otro plan.', 1;

    DECLARE @prods TABLE (product_id INT PRIMARY KEY);
    INSERT INTO @prods (product_id)
    SELECT DISTINCT TRY_CONVERT(INT, value) FROM OPENJSON(ISNULL(@products_json, N'[]'))
     WHERE TRY_CONVERT(INT, value) IN (SELECT id FROM dbo.products WHERE active = 1);
    IF NOT EXISTS (SELECT 1 FROM @prods) THROW 51000, 'Elige al menos un producto que se pueda dar con el plan.', 1;
    IF EXISTS (SELECT 1 FROM @prods WHERE product_id = @sale_product_id)
        THROW 51000, 'El producto de cobro no puede ser parte del beneficio.', 1;

    BEGIN TRAN;
    IF @id IS NULL
    BEGIN
        INSERT INTO dbo.membership_plans (name, sale_product_id, period_days, daily_limit, grace_days, active)
        VALUES (@name, @sale_product_id, @period_days, @daily_limit, @grace_days, @active);
        SET @id = SCOPE_IDENTITY();
    END
    ELSE
    BEGIN
        UPDATE dbo.membership_plans
           SET name = @name, sale_product_id = @sale_product_id, period_days = @period_days, daily_limit = @daily_limit,
               grace_days = @grace_days, active = @active, updated_at = SYSDATETIME()
         WHERE id = @id;
        IF @@ROWCOUNT = 0 THROW 51000, 'Ese plan no existe.', 1;
    END

    DELETE FROM dbo.membership_plan_products WHERE plan_id = @id AND product_id NOT IN (SELECT product_id FROM @prods);
    INSERT INTO dbo.membership_plan_products (plan_id, product_id)
    SELECT @id, product_id FROM @prods WHERE product_id NOT IN (SELECT product_id FROM dbo.membership_plan_products WHERE plan_id = @id);
    /* Que la nube se entere aunque solo cambien los productos. */
    UPDATE dbo.membership_plans SET updated_at = SYSDATETIME() WHERE id = @id;
    COMMIT TRAN;

    SELECT @id AS id;
END;
GO
