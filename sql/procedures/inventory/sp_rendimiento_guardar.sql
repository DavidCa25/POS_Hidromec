/* sp_rendimiento_guardar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0095 · «¿QUÉ CARNES USAS Y CUÁNTOS TACOS TE SALEN POR KILO?»

   @carnes: [{"clave":"pastor","nombre":"Pastor","rinde":14,"activo":true}, …]

   Una carne que todavía no existe nace como insumo de verdad, por el mismo
   alta que Inventario (sp_add_product): en GRAMOS, no vendible, con su
   presentación de compra «Kilo» = 1000 g y clave CARNE-<CLAVE>. Así Compras,
   Inventario y el kárdex la ven como cualquier otro insumo.

   Apagar una carne no borra nada: deja de preguntarse al cierre. Volver a
   encenderla conserva su historia.

   Al final se recalcula qué platillo cuenta tacos de qué carne y se devuelve
   la configuración (sp_rendimiento_config). */
CREATE OR ALTER PROCEDURE dbo.sp_rendimiento_guardar
    @carnes NVARCHAR(MAX),
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF ISJSON(@carnes) <> 1 THROW 51000, 'La lista de carnes no es válida.', 1;

    DECLARE @l TABLE (n INT IDENTITY(1, 1), clave NVARCHAR(40), nombre NVARCHAR(100), rinde DECIMAL(6, 2), activo BIT);
    INSERT INTO @l (clave, nombre, rinde, activo)
    SELECT UPPER(LTRIM(RTRIM(clave))), LTRIM(RTRIM(nombre)), rinde, ISNULL(activo, 1)
      FROM OPENJSON(@carnes) WITH (clave NVARCHAR(40), nombre NVARCHAR(100), rinde DECIMAL(6, 2), activo BIT);

    IF EXISTS (SELECT 1 FROM @l WHERE ISNULL(clave, N'') = N'' OR ISNULL(nombre, N'') = N'')
        THROW 51000, 'Cada carne necesita su nombre.', 1;
    IF EXISTS (SELECT 1 FROM @l WHERE activo = 1 AND (rinde IS NULL OR rinde < 1 OR rinde > 60))
        THROW 51000, 'Los tacos por kilo van de 1 a 60.', 1;
    IF EXISTS (SELECT clave FROM @l GROUP BY clave HAVING COUNT(*) > 1)
        THROW 51000, 'Una carne viene dos veces.', 1;

    BEGIN TRAN;

    DECLARE @cat INT = (SELECT TOP 1 id FROM dbo.CAT_categories WHERE namee = N'Carnes' ORDER BY id);
    DECLARE @marca INT = (SELECT TOP 1 id FROM dbo.CAT_brands ORDER BY id);
    DECLARE @salida TABLE (id DECIMAL(18, 0));

    DECLARE @i INT = 1, @n INT = (SELECT COUNT(*) FROM @l);
    WHILE @i <= @n
    BEGIN
        DECLARE @clave NVARCHAR(40), @nombre NVARCHAR(100), @rinde DECIMAL(6, 2), @activo BIT, @pn NVARCHAR(100), @pid INT;
        SELECT @clave = clave, @nombre = nombre, @rinde = rinde, @activo = activo FROM @l WHERE n = @i;
        SET @pn = N'CARNE-' + @clave;
        SET @pid = (SELECT id FROM dbo.products WHERE part_number = @pn);

        IF @pid IS NULL AND @activo = 1
        BEGIN
            IF @cat IS NULL
            BEGIN
                INSERT INTO dbo.CAT_categories (namee) VALUES (N'Carnes');
                SET @cat = SCOPE_IDENTITY();
            END;
            IF @marca IS NULL
            BEGIN
                INSERT INTO dbo.CAT_brands (namee) VALUES (N'Casa');
                SET @marca = SCOPE_IDENTITY();
            END;
            DELETE FROM @salida;
            INSERT INTO @salida (id)
            EXEC dbo.sp_add_product @brand = @marca, @part_number = @pn, @name = @nombre, @price = 0, @stock = 0,
                 @category = @cat, @objeto_impuesto = '02', @tasa_iva = 0, @inventory_mode = 'DIRECT',
                 @sellable = 0, @base_uom = 'g', @allow_decimal_qty = 1;
            SET @pid = (SELECT id FROM dbo.products WHERE part_number = @pn);
            DELETE FROM @salida;
            INSERT INTO @salida (id)
            EXEC dbo.sp_save_product_presentation @product_id = @pid, @name = N'Kilo', @factor_to_base = 1000, @is_default = 1;
        END;

        IF @pid IS NOT NULL
        BEGIN
            IF EXISTS (SELECT 1 FROM dbo.rendimiento_carnes WHERE product_id = @pid)
                UPDATE dbo.rendimiento_carnes
                   SET rinde = ISNULL(@rinde, rinde), activo = @activo, actualizado = SYSDATETIME()
                 WHERE product_id = @pid;
            ELSE IF @activo = 1
                INSERT INTO dbo.rendimiento_carnes (product_id, rinde, activo) VALUES (@pid, @rinde, 1);
        END;
        SET @i += 1;
    END;

    EXEC dbo.sp_rendimiento_mapear;
    COMMIT;

    EXEC dbo.sp_rendimiento_config;
END;
GO
