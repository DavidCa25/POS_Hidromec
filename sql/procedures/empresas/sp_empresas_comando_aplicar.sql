/* sp_empresas_comando_aplicar
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ==================== sp_empresas_comando_aplicar (0080) ==================
   Aplica en ESTA empresa un cambio que pidio otra empresa del grupo desde
   su computadora (docs/multiempresa.md, Fase 3). La nube solo lo trajo:
   aqui se decide con las reglas de esta empresa.

   UNA SOLA VEZ. La nube entrega "al menos una vez"; si el comando ya se
   aplico (o se rechazo), se devuelve lo mismo sin tocar nada.

   PRODUCTO_PRECIO  { product_uuid, precio }
                    Un producto de la matriz (MultiSucursal) conserva su
                    candado: sin permiso de precios por sucursal, se rechaza.
   PRODUCTO_ALTA    { nombre, precio, codigo?, categoria? }
                    Sin inventario (inventory_mode NONE): se vende desde ya
                    y quien opera esta empresa decide despues si lleva
                    existencias. Respeta "esta sucursal no da de alta
                    productos" de MultiSucursal.

   Recordset: resultado (APLICADO | RECHAZADO), detalle, product_id.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_empresas_comando_aplicar
    @comando_id     UNIQUEIDENTIFIER,
    @tipo           NVARCHAR(30),
    @origen_empresa NVARCHAR(200),
    @origen_usuario NVARCHAR(50) = NULL,
    @payload        NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF EXISTS (SELECT 1 FROM dbo.empresas_comandos WHERE comando_id = @comando_id)
    BEGIN
        SELECT resultado, detalle, product_id FROM dbo.empresas_comandos WHERE comando_id = @comando_id;
        RETURN;
    END

    DECLARE @resultado NVARCHAR(10) = N'RECHAZADO', @detalle NVARCHAR(400) = NULL, @product_id INT = NULL;
    DECLARE @precio DECIMAL(10, 2) = NULL;   -- se lee dentro del TRY: el pedido puede no ser JSON
    DECLARE @reglas NVARCHAR(255) = (SELECT valor FROM dbo.database_metadata WHERE clave = N'multi_reglas');
    DECLARE @es_sucursal BIT = CASE WHEN EXISTS (SELECT 1 FROM dbo.database_metadata
                                                  WHERE clave = N'multi_version' AND valor <> N'') THEN 1 ELSE 0 END;

    BEGIN TRY
        IF ISJSON(@payload) = 1 AND LEFT(LTRIM(@payload), 1) = N'{'
            SET @precio = TRY_CONVERT(DECIMAL(10, 2), JSON_VALUE(@payload, '$.precio'));

        IF @precio IS NULL OR @precio < 0
            SET @detalle = N'El pedido no trae un precio válido.';

        ELSE IF @tipo = N'PRODUCTO_PRECIO'
        BEGIN
            DECLARE @uuid UNIQUEIDENTIFIER = TRY_CONVERT(UNIQUEIDENTIFIER, JSON_VALUE(@payload, '$.product_uuid'));
            DECLARE @corporativo BIT;
            SELECT @product_id = id, @corporativo = corporate FROM dbo.products WHERE uuid = @uuid AND ISNULL(active, 1) = 1;

            IF @product_id IS NULL
                SET @detalle = N'El producto ya no existe en esta empresa.';
            ELSE IF @corporativo = 1 AND ISNULL(TRY_CONVERT(BIT, JSON_VALUE(@reglas, '$.precios_sucursal')), 0) = 0
            BEGIN
                SET @detalle = N'Ese producto lo administra la matriz: su precio se cambia allá.';
                SET @product_id = NULL;
            END
            ELSE
            BEGIN
                UPDATE dbo.products SET price = @precio WHERE id = @product_id;
                SELECT @resultado = N'APLICADO', @detalle = CONCAT(N'Precio actualizado a $', FORMAT(@precio, 'N2', 'es-MX'), N'.');
            END
        END

        ELSE IF @tipo = N'PRODUCTO_ALTA'
        BEGIN
            DECLARE @nombre NVARCHAR(100) = LEFT(LTRIM(RTRIM(JSON_VALUE(@payload, '$.nombre'))), 100);
            DECLARE @codigo NVARCHAR(100) = NULLIF(LEFT(LTRIM(RTRIM(JSON_VALUE(@payload, '$.codigo'))), 100), N'');
            DECLARE @categoria NVARCHAR(100) = ISNULL(NULLIF(LEFT(LTRIM(RTRIM(JSON_VALUE(@payload, '$.categoria'))), 100), N''), N'General');

            IF @es_sucursal = 1 AND ISNULL(TRY_CONVERT(BIT, JSON_VALUE(@reglas, '$.productos_locales')), 1) = 0
                SET @detalle = N'En esta sucursal los productos los da de alta la matriz.';
            ELSE IF LEN(ISNULL(@nombre, N'')) < 2
                SET @detalle = N'El producto necesita un nombre.';
            ELSE IF EXISTS (SELECT 1 FROM dbo.products WHERE nombre = @nombre AND ISNULL(active, 1) = 1)
                SET @detalle = N'Ya hay un producto con ese nombre.';
            ELSE IF @codigo IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.products WHERE part_number = @codigo)
                SET @detalle = N'Ya hay un producto con ese código.';
            ELSE
            BEGIN
                BEGIN TRAN;
                    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_categories WHERE namee = @categoria)
                        INSERT INTO dbo.CAT_categories (namee) VALUES (@categoria);
                    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_brands WHERE namee = N'Genérica')
                        INSERT INTO dbo.CAT_brands (namee) VALUES (N'Genérica');

                    DECLARE @cat INT = (SELECT id FROM dbo.CAT_categories WHERE namee = @categoria);
                    DECLARE @marca INT = (SELECT id FROM dbo.CAT_brands WHERE namee = N'Genérica');
                    IF @codigo IS NULL SET @codigo = CONCAT(N'G-', UPPER(LEFT(REPLACE(CONVERT(NVARCHAR(36), @comando_id), N'-', N''), 8)));

                    DECLARE @alta TABLE (id DECIMAL(18, 0));
                    INSERT INTO @alta (id)
                    EXEC dbo.sp_add_product @brand = @marca, @part_number = @codigo, @name = @nombre, @price = @precio,
                         @stock = 0, @category = @cat, @inventory_mode = N'NONE';
                    SET @product_id = (SELECT TOP (1) CONVERT(INT, id) FROM @alta);
                COMMIT;
                IF @product_id IS NULL
                    SET @detalle = N'No se pudo dar de alta el producto.';
                ELSE
                    SELECT @resultado = N'APLICADO', @detalle = CONCAT(N'Producto dado de alta (', @codigo, N').');
            END
        END

        ELSE
            SET @detalle = N'Esta empresa no acepta ese tipo de cambio.';
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT @resultado = N'RECHAZADO', @product_id = NULL, @detalle = LEFT(ERROR_MESSAGE(), 400);
    END CATCH;

    INSERT INTO dbo.empresas_comandos (comando_id, tipo, origen_empresa, origen_usuario, payload, resultado, detalle, product_id)
    VALUES (@comando_id,
            CASE WHEN @tipo IN (N'PRODUCTO_ALTA', N'PRODUCTO_PRECIO') THEN @tipo ELSE N'PRODUCTO_ALTA' END,
            LEFT(ISNULL(@origen_empresa, N'Otra empresa'), 200), LEFT(@origen_usuario, 50), @payload,
            @resultado, @detalle, @product_id);

    SELECT @resultado AS resultado, @detalle AS detalle, @product_id AS product_id;
END;
GO
