SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_loyalty_stamp_card_save (0064) =====================
   Alta o cambio de una tarjeta de sellos. `@products_json` = [id, id, ...]:
   los productos que sellan. `@reward_product_id` NULL = al llenarla se regala
   cualquiera de esos productos.
   ============================================================================ */
CREATE OR ALTER PROCEDURE dbo.sp_loyalty_stamp_card_save
    @id INT = NULL,
    @name NVARCHAR(80),
    @stamps_required INT,
    @reward_product_id INT = NULL,
    @active BIT = 1,
    @products_json NVARCHAR(MAX) = N'[]'
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET @name = LTRIM(RTRIM(ISNULL(@name, N'')));
    IF @name = N'' THROW 51000, 'Ponle nombre a la tarjeta.', 1;
    IF ISNULL(@stamps_required, 0) NOT BETWEEN 2 AND 100 THROW 51000, 'Los sellos para llenarla van de 2 a 100.', 1;

    DECLARE @prods TABLE (product_id INT PRIMARY KEY);
    INSERT INTO @prods SELECT DISTINCT TRY_CONVERT(INT, value) FROM OPENJSON(ISNULL(@products_json, N'[]'))
     WHERE TRY_CONVERT(INT, value) IS NOT NULL;
    DELETE p FROM @prods p WHERE NOT EXISTS (SELECT 1 FROM dbo.products x WHERE x.id = p.product_id);
    IF NOT EXISTS (SELECT 1 FROM @prods) THROW 51000, 'Elige al menos un producto que selle la tarjeta.', 1;
    IF @reward_product_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @reward_product_id)
        THROW 51000, 'El producto de regalo no existe.', 1;

    BEGIN TRAN;
    IF @id IS NULL
    BEGIN
        INSERT INTO dbo.loyalty_stamp_cards (name, stamps_required, reward_product_id, active)
        VALUES (@name, @stamps_required, @reward_product_id, ISNULL(@active, 1));
        SET @id = SCOPE_IDENTITY();
    END
    ELSE
    BEGIN
        UPDATE dbo.loyalty_stamp_cards
           SET name = @name, stamps_required = @stamps_required, reward_product_id = @reward_product_id,
               active = ISNULL(@active, 1), origin = N'LOCAL', updated_at = SYSDATETIME()
         WHERE id = @id;
        IF @@ROWCOUNT = 0 THROW 51000, 'La tarjeta no existe.', 1;
    END
    DELETE FROM dbo.loyalty_stamp_card_products WHERE card_id = @id AND product_id NOT IN (SELECT product_id FROM @prods);
    INSERT INTO dbo.loyalty_stamp_card_products (card_id, product_id)
    SELECT @id, p.product_id FROM @prods p
     WHERE NOT EXISTS (SELECT 1 FROM dbo.loyalty_stamp_card_products x WHERE x.card_id = @id AND x.product_id = p.product_id);
    COMMIT;

    SELECT @id AS id;
END;
GO
