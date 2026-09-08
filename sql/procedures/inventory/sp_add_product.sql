/* sp_add_product
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:      <Daniela Luna>
-- Create date: <04/08/2025>
-- Description: <SP para agregar productos>
-- Update:      + bar_code y campos fiscales SAT (opcionales)
-- Update:      + inventory_mode (DIRECT|RECIPE|NONE), sellable, base_uom,
--                allow_decimal_qty, cost. Los defaults reproducen Retail.
--                Devuelve el id creado.
-- =============================================
CREATE OR ALTER PROCEDURE [dbo].[sp_add_product]
    @brand INT,
    @part_number NVARCHAR(100),
    @name NVARCHAR(100),
    @price DECIMAL(10,2),
    @stock DECIMAL(12,2),
    @category INT,
    @bar_code NVARCHAR(100) = NULL,
    @clave_prod_serv NVARCHAR(8) = NULL,
    @clave_unidad NVARCHAR(5) = NULL,
    @objeto_impuesto NVARCHAR(2) = '02',
    @tasa_iva DECIMAL(5,4) = 0.16,
    @inventory_mode NVARCHAR(10) = 'DIRECT',
    @sellable BIT = 1,
    @base_uom NVARCHAR(10) = 'pza',
    @allow_decimal_qty BIT = 0,
    @cost DECIMAL(14,4) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SET @inventory_mode = UPPER(ISNULL(@inventory_mode, 'DIRECT'));
    SET @base_uom = ISNULL(@base_uom, 'pza');

    IF @inventory_mode NOT IN ('DIRECT', 'RECIPE', 'NONE')
    BEGIN
        RAISERROR('inventory_mode invalido: DIRECT, RECIPE o NONE.', 16, 1);
        RETURN;
    END

    IF NOT EXISTS (SELECT 1 FROM dbo.uoms WHERE code = @base_uom AND is_base = 1)
    BEGIN
        RAISERROR('La unidad base debe ser una unidad base (pza, g, ml, cm).', 16, 1);
        RETURN;
    END

    IF EXISTS (SELECT 1 FROM products WHERE part_number = @part_number)
    BEGIN
        RAISERROR('Ya existe un producto con ese número de parte.', 16, 1);
        RETURN;
    END;

    -- Si mandan bar_code no vacio, valida que no lo tenga otro producto
    IF @bar_code IS NOT NULL AND LTRIM(RTRIM(@bar_code)) <> ''
    BEGIN
        IF EXISTS (SELECT 1 FROM products WHERE bar_code = @bar_code)
        BEGIN
            RAISERROR('Ese codigo de barras ya esta asignado a otro producto.', 16, 1);
            RETURN;
        END
    END

    -- Una receta no tiene stock propio: lo tienen sus ingredientes.
    IF @inventory_mode = 'RECIPE' SET @stock = 0;

    INSERT INTO products (
        part_number, nombre, price, stock, category_id, brand_id,
        bar_code, clave_prod_serv, clave_unidad, objeto_impuesto, tasa_iva,
        inventory_mode, sellable, base_uom, allow_decimal_qty, cost,
        active, registrated_date
    )
    VALUES (
        @part_number,
        @name,
        @price,
        ISNULL(@stock, 0),
        @category,
        @brand,
        CASE WHEN @bar_code IS NULL OR LTRIM(RTRIM(@bar_code)) = '' THEN NULL ELSE @bar_code END,
        @clave_prod_serv,
        @clave_unidad,
        ISNULL(@objeto_impuesto, '02'),
        ISNULL(@tasa_iva, 0.16),
        @inventory_mode,
        ISNULL(@sellable, 1),
        @base_uom,
        ISNULL(@allow_decimal_qty, 0),
        @cost,
        1,
        GETDATE()
    );

    SELECT SCOPE_IDENTITY() AS id;
END;
GO
