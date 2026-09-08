/* ============================================================
   0002 — hospitality domain

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0002_hospitality-domain.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0002_hospitality-domain.sql ========== */
/* 0002 — hospitality domain
 *
 * Modelo de dominio de Wybix Core / Hospitality V1. Principios (ADR-005):
 *   - los ingredientes SIGUEN SIENDO products: no hay otro inventario;
 *   - una receta es de UN nivel (un ingrediente nunca es otra receta);
 *   - la APP declara que se vendio; SQL decide que stock se descuenta;
 *   - las unidades se convierten al CONFIGURAR/COMPRAR, nunca al vender:
 *     recipe_lines guarda qty_base en la unidad base del ingrediente.
 *
 * Todo lo que toca tablas existentes es ADITIVO con defaults que dejan a
 * Retail exactamente igual: inventory_mode=DIRECT, sellable=1, base_uom=pza.
 * Cada paso comprueba su existencia (idempotente).
 */

/* ------------------------------------------------------------------ uoms */
IF OBJECT_ID(N'dbo.uoms', 'U') IS NULL
BEGIN
CREATE TABLE dbo.uoms (
    code NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL,
    name NVARCHAR(50) COLLATE Modern_Spanish_CI_AS NOT NULL,
    dimension NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL,
    factor_to_base DECIMAL(18, 6) NOT NULL,
    is_base BIT NOT NULL CONSTRAINT DF_uoms_is_base DEFAULT ((0)),
    sort_order INT NOT NULL CONSTRAINT DF_uoms_sort_order DEFAULT ((0)),
    CONSTRAINT PK_uoms PRIMARY KEY CLUSTERED (code),
    CONSTRAINT CK_uoms_dimension CHECK ([dimension]='LENGTH' OR [dimension]='VOLUME' OR [dimension]='WEIGHT' OR [dimension]='COUNT'),
    CONSTRAINT CK_uoms_factor CHECK ([factor_to_base]>(0))
);
END;
GO

/* Seed de unidades. Unidad base por dimension: pza, g, ml, cm. */
MERGE dbo.uoms AS t
USING (VALUES
    (N'pza', N'Pieza',       N'COUNT',  1,          1, 10),
    (N'g',   N'Gramo',       N'WEIGHT', 1,          1, 20),
    (N'kg',  N'Kilogramo',   N'WEIGHT', 1000,       0, 21),
    (N'mg',  N'Miligramo',   N'WEIGHT', 0.001,      0, 22),
    (N'oz',  N'Onza',        N'WEIGHT', 28.349523,  0, 23),
    (N'lb',  N'Libra',       N'WEIGHT', 453.59237,  0, 24),
    (N'ml',  N'Mililitro',   N'VOLUME', 1,          1, 30),
    (N'L',   N'Litro',       N'VOLUME', 1000,       0, 31),
    (N'cl',  N'Centilitro',  N'VOLUME', 10,         0, 32),
    (N'cm',  N'Centimetro',  N'LENGTH', 1,          1, 40),
    (N'm',   N'Metro',       N'LENGTH', 100,        0, 41),
    (N'mm',  N'Milimetro',   N'LENGTH', 0.1,        0, 42),
    (N'in',  N'Pulgada',     N'LENGTH', 2.54,       0, 43),
    (N'ft',  N'Pie',         N'LENGTH', 30.48,      0, 44)
) AS s (code, name, dimension, factor_to_base, is_base, sort_order)
ON t.code = s.code
WHEN NOT MATCHED THEN
    INSERT (code, name, dimension, factor_to_base, is_base, sort_order)
    VALUES (s.code, s.name, s.dimension, s.factor_to_base, s.is_base, s.sort_order);
GO

/* -------------------------------------------------------------- products */
IF COL_LENGTH('dbo.products', 'inventory_mode') IS NULL
    ALTER TABLE dbo.products ADD inventory_mode NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL
        CONSTRAINT DF_products_inventory_mode DEFAULT ('DIRECT');
GO
IF COL_LENGTH('dbo.products', 'sellable') IS NULL
    ALTER TABLE dbo.products ADD sellable BIT NOT NULL CONSTRAINT DF_products_sellable DEFAULT ((1));
GO
IF COL_LENGTH('dbo.products', 'base_uom') IS NULL
    ALTER TABLE dbo.products ADD base_uom NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL
        CONSTRAINT DF_products_base_uom DEFAULT ('pza');
GO
IF COL_LENGTH('dbo.products', 'allow_decimal_qty') IS NULL
    ALTER TABLE dbo.products ADD allow_decimal_qty BIT NOT NULL CONSTRAINT DF_products_allow_decimal_qty DEFAULT ((0));
GO
IF COL_LENGTH('dbo.products', 'image_version') IS NULL
    ALTER TABLE dbo.products ADD image_version INT NOT NULL CONSTRAINT DF_products_image_version DEFAULT ((0));
GO
/* cost pasa de DECIMAL(10,2) a DECIMAL(14,4): el costo por unidad BASE de un
 * ingrediente (por gramo, por mililitro) no cabe en dos decimales. */
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID('dbo.products') AND c.name = 'cost' AND (c.precision <> 14 OR c.scale <> 4))
    ALTER TABLE dbo.products ALTER COLUMN cost DECIMAL(14, 4) NULL;
GO
IF OBJECT_ID(N'dbo.CK_products_inventory_mode', 'C') IS NULL
    ALTER TABLE dbo.products WITH CHECK ADD CONSTRAINT CK_products_inventory_mode
        CHECK ([inventory_mode]='NONE' OR [inventory_mode]='RECIPE' OR [inventory_mode]='DIRECT');
GO
IF OBJECT_ID(N'dbo.FK_products_base_uom', 'F') IS NULL
    ALTER TABLE dbo.products WITH CHECK ADD CONSTRAINT FK_products_base_uom FOREIGN KEY (base_uom) REFERENCES dbo.uoms (code);
GO

/* -------------------------------------------------------- product_images */
IF OBJECT_ID(N'dbo.product_images', 'U') IS NULL
BEGIN
CREATE TABLE dbo.product_images (
    product_id INT NOT NULL,
    thumb VARBINARY(MAX) NOT NULL,
    mime NVARCHAR(30) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_product_images_mime DEFAULT ('image/jpeg'),
    width INT NOT NULL,
    height INT NOT NULL,
    version INT NOT NULL CONSTRAINT DF_product_images_version DEFAULT ((1)),
    updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_product_images_updated_at DEFAULT (sysdatetime()),
    CONSTRAINT PK_product_images PRIMARY KEY CLUSTERED (product_id),
    CONSTRAINT CK_product_images_size CHECK (datalength([thumb])<=(65536))
);
END;
GO
IF OBJECT_ID(N'dbo.FK_product_images_product', 'F') IS NULL
    ALTER TABLE dbo.product_images WITH CHECK ADD CONSTRAINT FK_product_images_product FOREIGN KEY (product_id) REFERENCES dbo.products (id);
GO

/* ------------------------------------------------------- modifier_groups */
IF OBJECT_ID(N'dbo.modifier_groups', 'U') IS NULL
BEGIN
CREATE TABLE dbo.modifier_groups (
    id INT IDENTITY(1, 1) NOT NULL,
    name NVARCHAR(80) COLLATE Modern_Spanish_CI_AS NOT NULL,
    role NVARCHAR(15) COLLATE Modern_Spanish_CI_AS NOT NULL,
    min_select INT NOT NULL CONSTRAINT DF_modifier_groups_min_select DEFAULT ((0)),
    max_select INT NOT NULL CONSTRAINT DF_modifier_groups_max_select DEFAULT ((1)),
    required BIT NOT NULL CONSTRAINT DF_modifier_groups_required DEFAULT ((0)),
    active BIT NOT NULL CONSTRAINT DF_modifier_groups_active DEFAULT ((1)),
    sort_order INT NOT NULL CONSTRAINT DF_modifier_groups_sort_order DEFAULT ((0)),
    CONSTRAINT PK_modifier_groups PRIMARY KEY CLUSTERED (id),
    CONSTRAINT CK_modifier_groups_role CHECK ([role]='NOTE' OR [role]='SUBSTITUTION' OR [role]='ADDON' OR [role]='SIZE'),
    CONSTRAINT CK_modifier_groups_select CHECK ([min_select]>=(0) AND [max_select]>=(1) AND [min_select]<=[max_select])
);
END;
GO

/* ------------------------------------------------------ modifier_options */
IF OBJECT_ID(N'dbo.modifier_options', 'U') IS NULL
BEGIN
CREATE TABLE dbo.modifier_options (
    id INT IDENTITY(1, 1) NOT NULL,
    group_id INT NOT NULL,
    name NVARCHAR(80) COLLATE Modern_Spanish_CI_AS NOT NULL,
    price_delta DECIMAL(10, 2) NOT NULL CONSTRAINT DF_modifier_options_price_delta DEFAULT ((0)),
    effect NVARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_modifier_options_effect DEFAULT ('NONE'),
    ingredient_product_id INT NULL,
    replaces_product_id INT NULL,
    qty_base DECIMAL(14, 4) NULL,
    qty_factor DECIMAL(8, 4) NULL,
    active BIT NOT NULL CONSTRAINT DF_modifier_options_active DEFAULT ((1)),
    sort_order INT NOT NULL CONSTRAINT DF_modifier_options_sort_order DEFAULT ((0)),
    CONSTRAINT PK_modifier_options PRIMARY KEY CLUSTERED (id),
    CONSTRAINT CK_modifier_options_effect CHECK (
        ([effect]='NONE')
        OR ([effect]='ADD' AND [ingredient_product_id] IS NOT NULL AND [qty_base]>(0))
        OR ([effect]='REMOVE' AND [replaces_product_id] IS NOT NULL)
        OR ([effect]='SUBSTITUTE' AND [ingredient_product_id] IS NOT NULL AND [replaces_product_id] IS NOT NULL)
        OR ([effect]='SCALE' AND [qty_factor]>(0)))
);
END;
GO
IF OBJECT_ID(N'dbo.FK_modifier_options_group', 'F') IS NULL
    ALTER TABLE dbo.modifier_options WITH CHECK ADD CONSTRAINT FK_modifier_options_group FOREIGN KEY (group_id) REFERENCES dbo.modifier_groups (id);
GO
IF OBJECT_ID(N'dbo.FK_modifier_options_ingredient', 'F') IS NULL
    ALTER TABLE dbo.modifier_options WITH CHECK ADD CONSTRAINT FK_modifier_options_ingredient FOREIGN KEY (ingredient_product_id) REFERENCES dbo.products (id);
GO
IF OBJECT_ID(N'dbo.FK_modifier_options_replaces', 'F') IS NULL
    ALTER TABLE dbo.modifier_options WITH CHECK ADD CONSTRAINT FK_modifier_options_replaces FOREIGN KEY (replaces_product_id) REFERENCES dbo.products (id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_modifier_options_group' AND object_id = OBJECT_ID(N'dbo.modifier_options'))
    CREATE NONCLUSTERED INDEX IX_modifier_options_group ON dbo.modifier_options (group_id, sort_order);
GO

/* ------------------------------------------------ product_modifier_groups */
IF OBJECT_ID(N'dbo.product_modifier_groups', 'U') IS NULL
BEGIN
CREATE TABLE dbo.product_modifier_groups (
    product_id INT NOT NULL,
    group_id INT NOT NULL,
    sort_order INT NOT NULL CONSTRAINT DF_product_modifier_groups_sort_order DEFAULT ((0)),
    CONSTRAINT PK_product_modifier_groups PRIMARY KEY CLUSTERED (product_id, group_id)
);
END;
GO
IF OBJECT_ID(N'dbo.FK_product_modifier_groups_product', 'F') IS NULL
    ALTER TABLE dbo.product_modifier_groups WITH CHECK ADD CONSTRAINT FK_product_modifier_groups_product FOREIGN KEY (product_id) REFERENCES dbo.products (id);
GO
IF OBJECT_ID(N'dbo.FK_product_modifier_groups_group', 'F') IS NULL
    ALTER TABLE dbo.product_modifier_groups WITH CHECK ADD CONSTRAINT FK_product_modifier_groups_group FOREIGN KEY (group_id) REFERENCES dbo.modifier_groups (id);
GO

/* --------------------------------------------------------------- recipes */
IF OBJECT_ID(N'dbo.recipes', 'U') IS NULL
BEGIN
CREATE TABLE dbo.recipes (
    id INT IDENTITY(1, 1) NOT NULL,
    product_id INT NOT NULL,
    variant_option_id INT NULL,
    active BIT NOT NULL CONSTRAINT DF_recipes_active DEFAULT ((1)),
    notes NVARCHAR(300) COLLATE Modern_Spanish_CI_AS NULL,
    updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_recipes_updated_at DEFAULT (sysdatetime()),
    CONSTRAINT PK_recipes PRIMARY KEY CLUSTERED (id)
);
END;
GO
IF OBJECT_ID(N'dbo.FK_recipes_product', 'F') IS NULL
    ALTER TABLE dbo.recipes WITH CHECK ADD CONSTRAINT FK_recipes_product FOREIGN KEY (product_id) REFERENCES dbo.products (id);
GO
IF OBJECT_ID(N'dbo.FK_recipes_variant_option', 'F') IS NULL
    ALTER TABLE dbo.recipes WITH CHECK ADD CONSTRAINT FK_recipes_variant_option FOREIGN KEY (variant_option_id) REFERENCES dbo.modifier_options (id);
GO
/* Una receta base (NULL) y como maximo una por variante. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_recipes_product_variant' AND object_id = OBJECT_ID(N'dbo.recipes'))
    CREATE UNIQUE NONCLUSTERED INDEX UX_recipes_product_variant ON dbo.recipes (product_id, variant_option_id);
GO

/* ---------------------------------------------------------- recipe_lines */
IF OBJECT_ID(N'dbo.recipe_lines', 'U') IS NULL
BEGIN
CREATE TABLE dbo.recipe_lines (
    id INT IDENTITY(1, 1) NOT NULL,
    recipe_id INT NOT NULL,
    ingredient_product_id INT NOT NULL,
    qty_base DECIMAL(14, 4) NOT NULL,
    input_qty DECIMAL(12, 3) NOT NULL,
    input_uom NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL,
    waste_pct DECIMAL(5, 2) NOT NULL CONSTRAINT DF_recipe_lines_waste_pct DEFAULT ((0)),
    sort_order INT NOT NULL CONSTRAINT DF_recipe_lines_sort_order DEFAULT ((0)),
    CONSTRAINT PK_recipe_lines PRIMARY KEY CLUSTERED (id),
    CONSTRAINT CK_recipe_lines_qty CHECK ([qty_base]>(0) AND [input_qty]>(0)),
    CONSTRAINT CK_recipe_lines_waste CHECK ([waste_pct]>=(0) AND [waste_pct]<=(100))
);
END;
GO
IF OBJECT_ID(N'dbo.FK_recipe_lines_recipe', 'F') IS NULL
    ALTER TABLE dbo.recipe_lines WITH CHECK ADD CONSTRAINT FK_recipe_lines_recipe FOREIGN KEY (recipe_id) REFERENCES dbo.recipes (id) ON DELETE CASCADE;
GO
IF OBJECT_ID(N'dbo.FK_recipe_lines_ingredient', 'F') IS NULL
    ALTER TABLE dbo.recipe_lines WITH CHECK ADD CONSTRAINT FK_recipe_lines_ingredient FOREIGN KEY (ingredient_product_id) REFERENCES dbo.products (id);
GO
IF OBJECT_ID(N'dbo.FK_recipe_lines_uom', 'F') IS NULL
    ALTER TABLE dbo.recipe_lines WITH CHECK ADD CONSTRAINT FK_recipe_lines_uom FOREIGN KEY (input_uom) REFERENCES dbo.uoms (code);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_recipe_lines_recipe_ingredient' AND object_id = OBJECT_ID(N'dbo.recipe_lines'))
    CREATE UNIQUE NONCLUSTERED INDEX UX_recipe_lines_recipe_ingredient ON dbo.recipe_lines (recipe_id, ingredient_product_id);
GO

/* ------------------------------------------------- product_presentations */
IF OBJECT_ID(N'dbo.product_presentations', 'U') IS NULL
BEGIN
CREATE TABLE dbo.product_presentations (
    id INT IDENTITY(1, 1) NOT NULL,
    product_id INT NOT NULL,
    name NVARCHAR(60) COLLATE Modern_Spanish_CI_AS NOT NULL,
    factor_to_base DECIMAL(14, 4) NOT NULL,
    is_default BIT NOT NULL CONSTRAINT DF_product_presentations_is_default DEFAULT ((0)),
    active BIT NOT NULL CONSTRAINT DF_product_presentations_active DEFAULT ((1)),
    CONSTRAINT PK_product_presentations PRIMARY KEY CLUSTERED (id),
    CONSTRAINT CK_product_presentations_factor CHECK ([factor_to_base]>(0))
);
END;
GO
IF OBJECT_ID(N'dbo.FK_product_presentations_product', 'F') IS NULL
    ALTER TABLE dbo.product_presentations WITH CHECK ADD CONSTRAINT FK_product_presentations_product FOREIGN KEY (product_id) REFERENCES dbo.products (id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_product_presentations_product' AND object_id = OBJECT_ID(N'dbo.product_presentations'))
    CREATE NONCLUSTERED INDEX IX_product_presentations_product ON dbo.product_presentations (product_id);
GO

/* ------------------------------------------------------- purchase_detail */
IF COL_LENGTH('dbo.purchase_detail', 'presentation_id') IS NULL
    ALTER TABLE dbo.purchase_detail ADD presentation_id INT NULL;
GO
IF COL_LENGTH('dbo.purchase_detail', 'factor_to_base') IS NULL
    ALTER TABLE dbo.purchase_detail ADD factor_to_base DECIMAL(14, 4) NOT NULL CONSTRAINT DF_purchase_detail_factor_to_base DEFAULT ((1));
GO
IF COL_LENGTH('dbo.purchase_detail', 'base_quantity') IS NULL
    ALTER TABLE dbo.purchase_detail ADD base_quantity AS ([quantity]*[factor_to_base]);
GO
IF OBJECT_ID(N'dbo.FK_purchase_detail_presentation', 'F') IS NULL
    ALTER TABLE dbo.purchase_detail WITH CHECK ADD CONSTRAINT FK_purchase_detail_presentation FOREIGN KEY (presentation_id) REFERENCES dbo.product_presentations (id);
GO

/* ----------------------------------------------------------------- sales */
IF COL_LENGTH('dbo.sales', 'service_mode') IS NULL
    ALTER TABLE dbo.sales ADD service_mode NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NULL;
GO
IF OBJECT_ID(N'dbo.CK_sales_service_mode', 'C') IS NULL
    ALTER TABLE dbo.sales WITH CHECK ADD CONSTRAINT CK_sales_service_mode
        CHECK ([service_mode] IS NULL OR [service_mode]='TAKEAWAY' OR [service_mode]='DINE_IN');
GO

/* ----------------------------------------------------------- sale_detail */
/* unit_cost: costo de UNA unidad vendida de esa linea en el momento de la
 * venta (DIRECT: costo del producto; RECIPE: suma de ingredientes de una
 * unidad, con modificadores y merma). line_cost = quantity * unit_cost. */
IF COL_LENGTH('dbo.sale_detail', 'unit_cost') IS NULL
    ALTER TABLE dbo.sale_detail ADD unit_cost DECIMAL(14, 4) NULL;
GO
IF COL_LENGTH('dbo.sale_detail', 'line_cost') IS NULL
    ALTER TABLE dbo.sale_detail ADD line_cost AS ([quantity]*[unit_cost]);
GO
IF COL_LENGTH('dbo.sale_detail', 'inventory_mode') IS NULL
    ALTER TABLE dbo.sale_detail ADD inventory_mode NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NULL;
GO
IF COL_LENGTH('dbo.sale_detail', 'note') IS NULL
    ALTER TABLE dbo.sale_detail ADD note NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL;
GO

/* ------------------------------------------------- sale_detail_modifiers */
IF OBJECT_ID(N'dbo.sale_detail_modifiers', 'U') IS NULL
BEGIN
CREATE TABLE dbo.sale_detail_modifiers (
    id INT IDENTITY(1, 1) NOT NULL,
    sale_detail_id INT NOT NULL,
    modifier_option_id INT NOT NULL,
    group_name NVARCHAR(80) COLLATE Modern_Spanish_CI_AS NOT NULL,
    option_name NVARCHAR(80) COLLATE Modern_Spanish_CI_AS NOT NULL,
    price_delta DECIMAL(10, 2) NOT NULL CONSTRAINT DF_sale_detail_modifiers_price_delta DEFAULT ((0)),
    quantity INT NOT NULL CONSTRAINT DF_sale_detail_modifiers_quantity DEFAULT ((1)),
    effect NVARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL,
    CONSTRAINT PK_sale_detail_modifiers PRIMARY KEY CLUSTERED (id)
);
END;
GO
IF OBJECT_ID(N'dbo.FK_sale_detail_modifiers_detail', 'F') IS NULL
    ALTER TABLE dbo.sale_detail_modifiers WITH CHECK ADD CONSTRAINT FK_sale_detail_modifiers_detail FOREIGN KEY (sale_detail_id) REFERENCES dbo.sale_detail (id);
GO
IF OBJECT_ID(N'dbo.FK_sale_detail_modifiers_option', 'F') IS NULL
    ALTER TABLE dbo.sale_detail_modifiers WITH CHECK ADD CONSTRAINT FK_sale_detail_modifiers_option FOREIGN KEY (modifier_option_id) REFERENCES dbo.modifier_options (id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sale_detail_modifiers_detail' AND object_id = OBJECT_ID(N'dbo.sale_detail_modifiers'))
    CREATE NONCLUSTERED INDEX IX_sale_detail_modifiers_detail ON dbo.sale_detail_modifiers (sale_detail_id);
GO

/* --------------------------------------------------- inventory_movements */
/* typee (entrada/salida) se conserva; source dice POR QUE se movio y
 * sale_detail_id liga el movimiento a la linea vendida (auditoria y
 * devoluciones: una devolucion repone lo que ESA venta consumio). */
IF COL_LENGTH('dbo.inventory_movements', 'source') IS NULL
    ALTER TABLE dbo.inventory_movements ADD source NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NULL;
GO
IF COL_LENGTH('dbo.inventory_movements', 'sale_detail_id') IS NULL
    ALTER TABLE dbo.inventory_movements ADD sale_detail_id INT NULL;
GO
IF COL_LENGTH('dbo.inventory_movements', 'unit_cost') IS NULL
    ALTER TABLE dbo.inventory_movements ADD unit_cost DECIMAL(14, 4) NULL;
GO
IF OBJECT_ID(N'dbo.FK_inventory_movements_sale_detail', 'F') IS NULL
    ALTER TABLE dbo.inventory_movements WITH CHECK ADD CONSTRAINT FK_inventory_movements_sale_detail FOREIGN KEY (sale_detail_id) REFERENCES dbo.sale_detail (id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_inventory_movements_sale_detail' AND object_id = OBJECT_ID(N'dbo.inventory_movements'))
    CREATE NONCLUSTERED INDEX IX_inventory_movements_sale_detail ON dbo.inventory_movements (sale_detail_id) WHERE ([sale_detail_id] IS NOT NULL);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_inventory_movements_product_date' AND object_id = OBJECT_ID(N'dbo.inventory_movements'))
    CREATE NONCLUSTERED INDEX IX_inventory_movements_product_date ON dbo.inventory_movements (product_id, datee);
GO

/* ---------- ModifierOptionType (USER_TABLE_TYPE) ---------- */
/* ModifierOptionType
 * Tipo de tabla. SQL Server no conserva el texto original de un tipo, asi
 * que este DDL se reconstruye desde sys.columns. Es equivalente, no literal.
 * Un tipo NO admite CREATE OR ALTER: se comprueba antes de crearlo.
 *
 * Opciones de un grupo de modificadores (alta/edicion en bloque). id NULL =
 * opcion nueva. Las opciones que ya existan y no vengan se desactivan, no se
 * borran: sale_detail_modifiers las referencia historicamente.
 */
IF TYPE_ID(N'dbo.ModifierOptionType') IS NULL
BEGIN
  CREATE TYPE dbo.ModifierOptionType AS TABLE (
    id INT NULL,
    name NVARCHAR(80) NOT NULL,
    price_delta DECIMAL(10, 2) NULL,
    effect NVARCHAR(12) NOT NULL,
    ingredient_product_id INT NULL,
    replaces_product_id INT NULL,
    qty_base DECIMAL(14, 4) NULL,
    qty_factor DECIMAL(8, 4) NULL,
    active BIT NULL,
    sort_order INT NULL
  );
END;

/* ---------- PurchaseDetailType2 (USER_TABLE_TYPE) ---------- */
/* PurchaseDetailType2
 * Tipo de tabla. SQL Server no conserva el texto original de un tipo, asi
 * que este DDL se reconstruye desde sys.columns. Es equivalente, no literal.
 * Un tipo NO admite CREATE OR ALTER: se comprueba antes de crearlo.
 *
 * Version 2 del detalle de compra: anade presentation_id. quantity y
 * unit_price se expresan en la PRESENTACION capturada (5 bolsas a $200); el
 * procedure convierte a unidad base con factor_to_base.
 */
IF TYPE_ID(N'dbo.PurchaseDetailType2') IS NULL
BEGIN
  CREATE TYPE dbo.PurchaseDetailType2 AS TABLE (
    product_id INT NOT NULL,
    quantity DECIMAL(12, 2) NOT NULL,
    unit_price DECIMAL(10, 2) NOT NULL,
    profit_percent DECIMAL(5, 2) NULL,
    presentation_id INT NULL
  );
END;

/* ---------- RecipeLineType (USER_TABLE_TYPE) ---------- */
/* RecipeLineType
 * Tipo de tabla. SQL Server no conserva el texto original de un tipo, asi
 * que este DDL se reconstruye desde sys.columns. Es equivalente, no literal.
 * Un tipo NO admite CREATE OR ALTER: se comprueba antes de crearlo.
 *
 * Lineas de receta tal como las captura el Backoffice: cantidad en la unidad
 * que eligio el usuario. sp_save_recipe la convierte a la unidad base.
 */
IF TYPE_ID(N'dbo.RecipeLineType') IS NULL
BEGIN
  CREATE TYPE dbo.RecipeLineType AS TABLE (
    ingredient_product_id INT NOT NULL,
    input_qty DECIMAL(12, 3) NOT NULL,
    input_uom NVARCHAR(10) NOT NULL,
    waste_pct DECIMAL(5, 2) NULL,
    sort_order INT NULL
  );
END;

/* ---------- sp_add_product (SQL_STORED_PROCEDURE) ---------- */
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

/* ---------- sp_delete_modifier_group (SQL_STORED_PROCEDURE) ---------- */
/* sp_delete_modifier_group
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Si alguna venta uso una opcion del grupo (o una receta por variante lo
-- referencia), el grupo se DESACTIVA; si no, se borra por completo.
CREATE OR ALTER PROCEDURE dbo.sp_delete_modifier_group
    @group_id INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.modifier_groups WHERE id = @group_id)
    BEGIN RAISERROR('El grupo no existe.', 16, 1); RETURN; END

    BEGIN TRY
        BEGIN TRAN;
        IF EXISTS (SELECT 1 FROM dbo.sale_detail_modifiers m JOIN dbo.modifier_options o ON o.id = m.modifier_option_id WHERE o.group_id = @group_id)
           OR EXISTS (SELECT 1 FROM dbo.recipes r JOIN dbo.modifier_options o ON o.id = r.variant_option_id WHERE o.group_id = @group_id)
        BEGIN
            UPDATE dbo.modifier_groups SET active = 0 WHERE id = @group_id;
            UPDATE dbo.modifier_options SET active = 0 WHERE group_id = @group_id;
            DELETE FROM dbo.product_modifier_groups WHERE group_id = @group_id;
            COMMIT TRAN;
            SELECT @group_id AS group_id, 'DEACTIVATED' AS result;
            RETURN;
        END

        DELETE FROM dbo.product_modifier_groups WHERE group_id = @group_id;
        DELETE FROM dbo.modifier_options WHERE group_id = @group_id;
        DELETE FROM dbo.modifier_groups WHERE id = @group_id;
        COMMIT TRAN;
        SELECT @group_id AS group_id, 'DELETED' AS result;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO

/* ---------- sp_delete_product_presentation (SQL_STORED_PROCEDURE) ---------- */
/* sp_delete_product_presentation
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Si alguna compra la uso, se desactiva (el historial la referencia);
-- si no, se borra.
CREATE OR ALTER PROCEDURE dbo.sp_delete_product_presentation
    @id INT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.product_presentations WHERE id = @id)
    BEGIN RAISERROR('La presentacion no existe.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM dbo.purchase_detail WHERE presentation_id = @id)
    BEGIN
        UPDATE dbo.product_presentations SET active = 0, is_default = 0 WHERE id = @id;
        SELECT @id AS id, 'DEACTIVATED' AS result;
        RETURN;
    END
    DELETE FROM dbo.product_presentations WHERE id = @id;
    SELECT @id AS id, 'DELETED' AS result;
END
GO

/* ---------- sp_delete_recipe (SQL_STORED_PROCEDURE) ---------- */
/* sp_delete_recipe
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Elimina una receta (base o de variante). Las ventas pasadas no dependen
-- de ella: sus consumos quedaron en inventory_movements.
CREATE OR ALTER PROCEDURE dbo.sp_delete_recipe
    @recipe_id INT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.recipes WHERE id = @recipe_id)
    BEGIN RAISERROR('La receta no existe.', 16, 1); RETURN; END
    DELETE FROM dbo.recipe_lines WHERE recipe_id = @recipe_id;
    DELETE FROM dbo.recipes WHERE id = @recipe_id;
    SELECT @recipe_id AS recipe_id;
END
GO

/* ---------- sp_get_active_products (SQL_STORED_PROCEDURE) ---------- */
/* sp_get_active_products
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<Daniela Luna>
-- Create date: <04/08/2025>
-- Description:	<Productos activos para venta, inventario y compras>
-- Update:      + inventory_mode, sellable, base_uom, allow_decimal_qty,
--                image_version, has_modifiers, cost, category_id (Core).
--              Devuelve TODOS los activos, ingredientes incluidos; las
--              pantallas de venta filtran sellable = 1.
-- =============================================

CREATE OR ALTER PROCEDURE [dbo].[sp_get_active_products]
AS
BEGIN
    SELECT
        p.id,
        p.part_number,
        p.nombre AS product_name,
        p.price,
        p.stock,
        c.namee AS category_name,
        m.namee AS brand_name,
        p.bar_code AS bar_code,
        ds.supplier_name AS default_supplier_name,
        p.category_id,
        p.brand_id,
        p.cost,
        p.clave_prod_serv,
        p.clave_unidad,
        p.objeto_impuesto,
        p.tasa_iva,
        p.inventory_mode,
        p.sellable,
        p.base_uom,
        p.allow_decimal_qty,
        p.image_version,
        CASE WHEN EXISTS (
            SELECT 1 FROM dbo.product_modifier_groups pmg
            JOIN dbo.modifier_groups g ON g.id = pmg.group_id AND g.active = 1
            WHERE pmg.product_id = p.id) THEN 1 ELSE 0 END AS has_modifiers
    FROM products p
    INNER JOIN CAT_categories c ON p.category_id = c.id
    INNER JOIN CAT_brands m ON p.brand_id = m.id
    OUTER APPLY (
      SELECT TOP 1 s.nombre AS supplier_name
      FROM dbo.product_suppliers ps
      INNER JOIN dbo.CAT_suppliers s ON s.id = ps.supplier_id
      WHERE ps.product_id = p.id AND ps.active = 1 AND ps.is_default = 1
    ) ds
    WHERE p.active = 1
    ORDER BY p.id ASC
END;
GO

/* ---------- sp_get_ingredients (SQL_STORED_PROCEDURE) ---------- */
/* sp_get_ingredients
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Productos que pueden usarse como ingrediente de una receta: activos y con
-- inventario DIRECT (una receta nunca consume otra receta: un solo nivel).
CREATE OR ALTER PROCEDURE dbo.sp_get_ingredients
    @search NVARCHAR(100) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        p.id,
        p.nombre        AS product_name,
        p.part_number,
        p.base_uom,
        u.dimension,
        p.stock,
        p.cost,
        p.sellable,
        p.category_id,
        c.namee         AS category_name
    FROM dbo.products p
    JOIN dbo.uoms u ON u.code = p.base_uom
    LEFT JOIN dbo.CAT_categories c ON c.id = p.category_id
    WHERE p.active = 1
      AND p.inventory_mode = 'DIRECT'
      AND (@search IS NULL OR LTRIM(RTRIM(@search)) = ''
           OR p.nombre LIKE '%' + @search + '%'
           OR p.part_number LIKE '%' + @search + '%')
    ORDER BY p.nombre;
END
GO

/* ---------- sp_get_modifier_groups (SQL_STORED_PROCEDURE) ---------- */
/* sp_get_modifier_groups
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Grupos de modificadores con sus opciones. Sin @product_id: todos los
-- grupos (catalogo del Backoffice). Con @product_id: solo los ligados al
-- producto, en el orden del producto. Dos resultados: grupos y opciones.
CREATE OR ALTER PROCEDURE dbo.sp_get_modifier_groups
    @product_id INT = NULL,
    @only_active BIT = 0
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        g.id, g.name, g.role, g.min_select, g.max_select, g.required, g.active,
        ISNULL(pmg.sort_order, g.sort_order) AS sort_order,
        ( SELECT COUNT(*) FROM dbo.product_modifier_groups x WHERE x.group_id = g.id ) AS products_count
    FROM dbo.modifier_groups g
    LEFT JOIN dbo.product_modifier_groups pmg ON pmg.group_id = g.id AND pmg.product_id = @product_id
    WHERE (@product_id IS NULL OR pmg.product_id IS NOT NULL)
      AND (@only_active = 0 OR g.active = 1)
    ORDER BY ISNULL(pmg.sort_order, g.sort_order), g.name;

    SELECT
        o.id, o.group_id, o.name, o.price_delta, o.effect,
        o.ingredient_product_id, i.nombre AS ingredient_name, i.base_uom AS ingredient_uom,
        o.replaces_product_id,   r.nombre AS replaces_name,
        o.qty_base, o.qty_factor, o.active, o.sort_order
    FROM dbo.modifier_options o
    JOIN dbo.modifier_groups g ON g.id = o.group_id
    LEFT JOIN dbo.product_modifier_groups pmg ON pmg.group_id = g.id AND pmg.product_id = @product_id
    LEFT JOIN dbo.products i ON i.id = o.ingredient_product_id
    LEFT JOIN dbo.products r ON r.id = o.replaces_product_id
    WHERE (@product_id IS NULL OR pmg.product_id IS NOT NULL)
      AND (@only_active = 0 OR (g.active = 1 AND o.active = 1))
    ORDER BY o.group_id, o.sort_order, o.id;
END
GO

/* ---------- sp_get_product_presentations (SQL_STORED_PROCEDURE) ---------- */
/* sp_get_product_presentations
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Presentaciones de compra de un producto (caja, bolsa, kg...). Sin
-- @product_id devuelve las de todos los productos (para Compras).
CREATE OR ALTER PROCEDURE dbo.sp_get_product_presentations
    @product_id INT = NULL,
    @only_active BIT = 1
AS
BEGIN
    SET NOCOUNT ON;
    SELECT pp.id, pp.product_id, pp.name, pp.factor_to_base, pp.is_default, pp.active,
           p.base_uom
    FROM dbo.product_presentations pp
    JOIN dbo.products p ON p.id = pp.product_id
    WHERE (@product_id IS NULL OR pp.product_id = @product_id)
      AND (@only_active = 0 OR pp.active = 1)
    ORDER BY pp.product_id, pp.is_default DESC, pp.name;
END
GO

/* ---------- sp_get_product_thumbs (SQL_STORED_PROCEDURE) ---------- */
/* sp_get_product_thumbs
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Miniaturas para la cache local de una caja. @ids_json: '[1,5,9]' con los
-- productos cuya version local no coincide; NULL devuelve todas.
CREATE OR ALTER PROCEDURE dbo.sp_get_product_thumbs
    @ids_json NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @ids_json IS NOT NULL AND ISJSON(@ids_json) = 0
    BEGIN RAISERROR('ids_json debe ser un arreglo JSON.', 16, 1); RETURN; END

    SELECT i.product_id, i.version, i.mime, i.width, i.height, i.thumb
    FROM dbo.product_images i
    WHERE @ids_json IS NULL
       OR i.product_id IN (SELECT CAST([value] AS INT) FROM OPENJSON(@ids_json));
END
GO

/* ---------- sp_get_recipe (SQL_STORED_PROCEDURE) ---------- */
/* sp_get_recipe
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Receta de un producto. Con @variant_option_id se busca la receta de esa
-- variante (tamano); si no existe se devuelve la base con is_fallback = 1.
-- Dos resultados: cabecera y lineas (con costo por linea al costo actual).
CREATE OR ALTER PROCEDURE dbo.sp_get_recipe
    @product_id        INT,
    @variant_option_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @recipe_id INT = NULL, @is_fallback BIT = 0;

    IF @variant_option_id IS NOT NULL
        SELECT @recipe_id = id FROM dbo.recipes
        WHERE product_id = @product_id AND variant_option_id = @variant_option_id;

    IF @recipe_id IS NULL
    BEGIN
        SELECT @recipe_id = id FROM dbo.recipes
        WHERE product_id = @product_id AND variant_option_id IS NULL;
        IF @variant_option_id IS NOT NULL AND @recipe_id IS NOT NULL SET @is_fallback = 1;
    END

    SELECT
        r.id            AS recipe_id,
        r.product_id,
        r.variant_option_id,
        @variant_option_id AS requested_variant_option_id,
        @is_fallback    AS is_fallback,
        r.active,
        r.notes,
        r.updated_at,
        p.nombre        AS product_name,
        p.inventory_mode,
        ( SELECT ISNULL(SUM(l.qty_base * ISNULL(i.cost, 0) * (1 + l.waste_pct / 100.0)), 0)
            FROM dbo.recipe_lines l JOIN dbo.products i ON i.id = l.ingredient_product_id
           WHERE l.recipe_id = r.id ) AS unit_cost
    FROM dbo.recipes r
    JOIN dbo.products p ON p.id = r.product_id
    WHERE r.id = @recipe_id;

    SELECT
        l.id            AS recipe_line_id,
        l.recipe_id,
        l.ingredient_product_id,
        i.nombre        AS ingredient_name,
        i.base_uom,
        u.dimension,
        l.qty_base,
        l.input_qty,
        l.input_uom,
        l.waste_pct,
        l.sort_order,
        i.stock         AS ingredient_stock,
        i.cost          AS ingredient_cost,
        l.qty_base * ISNULL(i.cost, 0) * (1 + l.waste_pct / 100.0) AS line_cost
    FROM dbo.recipe_lines l
    JOIN dbo.products i ON i.id = l.ingredient_product_id
    JOIN dbo.uoms u ON u.code = i.base_uom
    WHERE l.recipe_id = @recipe_id
    ORDER BY l.sort_order, l.id;
END
GO

/* ---------- sp_get_uoms (SQL_STORED_PROCEDURE) ---------- */
/* sp_get_uoms
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Unidades de medida: COUNT (pza), WEIGHT (g), VOLUME (ml), LENGTH (cm) con
-- sus presentaciones (kg, L, m...). factor_to_base = cuantas unidades base
-- hay en una de estas.
CREATE OR ALTER PROCEDURE dbo.sp_get_uoms
AS
BEGIN
    SET NOCOUNT ON;
    SELECT code, name, dimension, factor_to_base, is_base, sort_order
    FROM dbo.uoms
    ORDER BY sort_order, code;
END
GO

/* ---------- sp_register_purchase (SQL_STORED_PROCEDURE) ---------- */
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

/* ---------- sp_save_modifier_group (SQL_STORED_PROCEDURE) ---------- */
/* sp_save_modifier_group
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Crea o actualiza un grupo con sus opciones. Las opciones existentes que no
-- vengan en @Options se DESACTIVAN (no se borran): las ventas pasadas las
-- referencian en sale_detail_modifiers.
--
-- Semantica explicita, sin heuristicas por nombre:
--   role    SIZE | ADDON | SUBSTITUTION | NOTE
--   effect  NONE | ADD (ingrediente+qty_base) | REMOVE (replaces)
--           | SUBSTITUTE (replaces -> ingrediente, misma cantidad salvo qty_base)
--           | SCALE (qty_factor sobre la receta base)
CREATE OR ALTER PROCEDURE dbo.sp_save_modifier_group
    @group_id   INT = NULL,
    @name       NVARCHAR(80),
    @role       NVARCHAR(15),
    @min_select INT = 0,
    @max_select INT = 1,
    @required   BIT = 0,
    @active     BIT = 1,
    @sort_order INT = 0,
    @Options    dbo.ModifierOptionType READONLY
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @name = LTRIM(RTRIM(ISNULL(@name, '')));
    SET @role = UPPER(LTRIM(RTRIM(ISNULL(@role, ''))));
    IF @name = '' BEGIN RAISERROR('El grupo necesita un nombre.', 16, 1); RETURN; END
    IF @role NOT IN ('SIZE', 'ADDON', 'SUBSTITUTION', 'NOTE')
    BEGIN RAISERROR('role invalido: SIZE, ADDON, SUBSTITUTION o NOTE.', 16, 1); RETURN; END
    IF @min_select < 0 OR @max_select < 1 OR @min_select > @max_select
    BEGIN RAISERROR('min_select/max_select invalidos.', 16, 1); RETURN; END

    IF EXISTS (SELECT 1 FROM @Options WHERE LTRIM(RTRIM(ISNULL(name, ''))) = '')
    BEGIN RAISERROR('Cada opcion necesita un nombre.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM @Options WHERE UPPER(effect) NOT IN ('NONE', 'ADD', 'REMOVE', 'SUBSTITUTE', 'SCALE'))
    BEGIN RAISERROR('effect invalido: NONE, ADD, REMOVE, SUBSTITUTE o SCALE.', 16, 1); RETURN; END
    IF @role = 'NOTE' AND EXISTS (SELECT 1 FROM @Options WHERE UPPER(effect) <> 'NONE')
    BEGIN RAISERROR('Las opciones de un grupo NOTE no afectan inventario (effect NONE).', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM @Options WHERE UPPER(effect) = 'ADD' AND (ingredient_product_id IS NULL OR ISNULL(qty_base, 0) <= 0))
    BEGIN RAISERROR('Una opcion ADD necesita ingrediente y cantidad en unidad base.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM @Options WHERE UPPER(effect) = 'REMOVE' AND replaces_product_id IS NULL)
    BEGIN RAISERROR('Una opcion REMOVE necesita el ingrediente que retira.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM @Options WHERE UPPER(effect) = 'SUBSTITUTE' AND (ingredient_product_id IS NULL OR replaces_product_id IS NULL))
    BEGIN RAISERROR('Una opcion SUBSTITUTE necesita el ingrediente que retira y el que pone.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM @Options WHERE UPPER(effect) = 'SCALE' AND ISNULL(qty_factor, 0) <= 0)
    BEGIN RAISERROR('Una opcion SCALE necesita un factor mayor a cero.', 16, 1); RETURN; END
    IF EXISTS (
        SELECT 1 FROM @Options o
        LEFT JOIN dbo.products i ON i.id = o.ingredient_product_id
        WHERE o.ingredient_product_id IS NOT NULL AND (i.id IS NULL OR i.inventory_mode <> 'DIRECT'))
    BEGIN RAISERROR('El ingrediente de una opcion debe ser un producto con inventario directo.', 16, 1); RETURN; END
    IF EXISTS (
        SELECT 1 FROM @Options o
        LEFT JOIN dbo.products r ON r.id = o.replaces_product_id
        WHERE o.replaces_product_id IS NOT NULL AND r.id IS NULL)
    BEGIN RAISERROR('El ingrediente a sustituir no existe.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM @Options WHERE id IS NOT NULL AND @group_id IS NOT NULL AND id NOT IN (SELECT id FROM dbo.modifier_options WHERE group_id = @group_id))
    BEGIN RAISERROR('Una opcion no pertenece a este grupo.', 16, 1); RETURN; END

    BEGIN TRY
        BEGIN TRAN;

        IF @group_id IS NULL OR NOT EXISTS (SELECT 1 FROM dbo.modifier_groups WHERE id = @group_id)
        BEGIN
            INSERT INTO dbo.modifier_groups (name, role, min_select, max_select, required, active, sort_order)
            VALUES (@name, @role, @min_select, @max_select, @required, @active, @sort_order);
            SET @group_id = SCOPE_IDENTITY();
        END
        ELSE
        BEGIN
            UPDATE dbo.modifier_groups
               SET name = @name, role = @role, min_select = @min_select, max_select = @max_select,
                   required = @required, active = @active, sort_order = @sort_order
             WHERE id = @group_id;
        END

        -- Desactivar las que ya no vienen
        UPDATE o SET active = 0
        FROM dbo.modifier_options o
        WHERE o.group_id = @group_id
          AND o.id NOT IN (SELECT id FROM @Options WHERE id IS NOT NULL);

        -- Actualizar existentes
        UPDATE o
           SET name = LTRIM(RTRIM(n.name)),
               price_delta = ISNULL(n.price_delta, 0),
               effect = UPPER(n.effect),
               ingredient_product_id = n.ingredient_product_id,
               replaces_product_id = n.replaces_product_id,
               qty_base = n.qty_base,
               qty_factor = n.qty_factor,
               active = ISNULL(n.active, 1),
               sort_order = ISNULL(n.sort_order, o.sort_order)
        FROM dbo.modifier_options o
        JOIN @Options n ON n.id = o.id
        WHERE o.group_id = @group_id;

        -- Insertar nuevas
        INSERT INTO dbo.modifier_options
            (group_id, name, price_delta, effect, ingredient_product_id, replaces_product_id, qty_base, qty_factor, active, sort_order)
        SELECT @group_id, LTRIM(RTRIM(n.name)), ISNULL(n.price_delta, 0), UPPER(n.effect),
               n.ingredient_product_id, n.replaces_product_id, n.qty_base, n.qty_factor, ISNULL(n.active, 1),
               ISNULL(n.sort_order, 100 + ROW_NUMBER() OVER (ORDER BY (SELECT NULL)))
        FROM @Options n
        WHERE n.id IS NULL;

        COMMIT TRAN;

        SELECT @group_id AS group_id;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO

/* ---------- sp_save_product_presentation (SQL_STORED_PROCEDURE) ---------- */
/* sp_save_product_presentation
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Crea o actualiza una presentacion de compra. factor_to_base = cuantas
-- unidades BASE del producto trae una presentacion (Bolsa 1 kg de cafe en
-- gramos: 1000; Caja de 12 refrescos: 12).
CREATE OR ALTER PROCEDURE dbo.sp_save_product_presentation
    @id             INT = NULL,
    @product_id     INT,
    @name           NVARCHAR(60),
    @factor_to_base DECIMAL(14, 4),
    @is_default     BIT = 0,
    @active         BIT = 1
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @name = LTRIM(RTRIM(ISNULL(@name, '')));
    IF @name = '' BEGIN RAISERROR('La presentacion necesita un nombre.', 16, 1); RETURN; END
    IF ISNULL(@factor_to_base, 0) <= 0 BEGIN RAISERROR('El contenido por presentacion debe ser mayor a cero.', 16, 1); RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id)
    BEGIN RAISERROR('El producto no existe.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM dbo.product_presentations WHERE product_id = @product_id AND name = @name AND (@id IS NULL OR id <> @id))
    BEGIN RAISERROR('Ya existe una presentacion con ese nombre para este producto.', 16, 1); RETURN; END

    BEGIN TRY
        BEGIN TRAN;
        IF @id IS NULL OR NOT EXISTS (SELECT 1 FROM dbo.product_presentations WHERE id = @id AND product_id = @product_id)
        BEGIN
            INSERT INTO dbo.product_presentations (product_id, name, factor_to_base, is_default, active)
            VALUES (@product_id, @name, @factor_to_base, @is_default, @active);
            SET @id = SCOPE_IDENTITY();
        END
        ELSE
        BEGIN
            UPDATE dbo.product_presentations
               SET name = @name, factor_to_base = @factor_to_base, is_default = @is_default, active = @active
             WHERE id = @id;
        END
        IF @is_default = 1
            UPDATE dbo.product_presentations SET is_default = 0 WHERE product_id = @product_id AND id <> @id;
        COMMIT TRAN;
        SELECT @id AS id;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO

/* ---------- sp_save_recipe (SQL_STORED_PROCEDURE) ---------- */
/* sp_save_recipe
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Guarda (crea o reemplaza) la receta de un producto RECIPE, base o por
-- variante. Convierte cada linea a la unidad BASE del ingrediente AQUI, al
-- configurar, para que la venta nunca convierta unidades.
--
-- Garantias de un solo nivel / sin ciclos: el ingrediente debe ser DIRECT
-- (nunca RECIPE) y distinto del producto. sp_update_product impide despues
-- convertir a RECIPE un producto que ya es ingrediente.
CREATE OR ALTER PROCEDURE dbo.sp_save_recipe
    @product_id        INT,
    @variant_option_id INT = NULL,
    @notes             NVARCHAR(300) = NULL,
    @Lines             dbo.RecipeLineType READONLY
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @mode NVARCHAR(10);
    SELECT @mode = inventory_mode FROM dbo.products WHERE id = @product_id AND active = 1;
    IF @mode IS NULL
    BEGIN RAISERROR('El producto no existe o esta inactivo.', 16, 1); RETURN; END
    IF @mode <> 'RECIPE'
    BEGIN RAISERROR('Solo un producto de tipo RECETA puede tener receta.', 16, 1); RETURN; END

    IF @variant_option_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM dbo.modifier_options o
        JOIN dbo.modifier_groups g ON g.id = o.group_id
        JOIN dbo.product_modifier_groups pmg ON pmg.group_id = g.id AND pmg.product_id = @product_id
        WHERE o.id = @variant_option_id AND g.role = 'SIZE')
    BEGIN RAISERROR('La variante no pertenece a un grupo de tamano de este producto.', 16, 1); RETURN; END

    IF NOT EXISTS (SELECT 1 FROM @Lines)
    BEGIN RAISERROR('La receta necesita al menos un ingrediente.', 16, 1); RETURN; END

    IF EXISTS (SELECT 1 FROM @Lines WHERE input_qty IS NULL OR input_qty <= 0)
    BEGIN RAISERROR('Cada ingrediente necesita una cantidad mayor a cero.', 16, 1); RETURN; END

    IF EXISTS (SELECT ingredient_product_id FROM @Lines GROUP BY ingredient_product_id HAVING COUNT(*) > 1)
    BEGIN RAISERROR('Hay un ingrediente repetido en la receta.', 16, 1); RETURN; END

    IF EXISTS (SELECT 1 FROM @Lines WHERE ingredient_product_id = @product_id)
    BEGIN RAISERROR('Un producto no puede ser ingrediente de si mismo.', 16, 1); RETURN; END

    IF EXISTS (
        SELECT 1 FROM @Lines l
        LEFT JOIN dbo.products i ON i.id = l.ingredient_product_id AND i.active = 1
        WHERE i.id IS NULL OR i.inventory_mode <> 'DIRECT')
    BEGIN RAISERROR('Cada ingrediente debe ser un producto activo con inventario directo (no una receta).', 16, 1); RETURN; END

    IF EXISTS (
        SELECT 1 FROM @Lines l
        JOIN dbo.products i ON i.id = l.ingredient_product_id
        JOIN dbo.uoms ub ON ub.code = i.base_uom
        LEFT JOIN dbo.uoms ui ON ui.code = l.input_uom
        WHERE ui.code IS NULL OR ui.dimension <> ub.dimension)
    BEGIN RAISERROR('La unidad de una linea no corresponde a la unidad base del ingrediente (peso, volumen, longitud o piezas).', 16, 1); RETURN; END

    IF EXISTS (SELECT 1 FROM @Lines WHERE waste_pct IS NOT NULL AND (waste_pct < 0 OR waste_pct > 100))
    BEGIN RAISERROR('La merma debe estar entre 0 y 100 por ciento.', 16, 1); RETURN; END

    BEGIN TRY
        BEGIN TRAN;

        DECLARE @recipe_id INT;
        SELECT @recipe_id = id FROM dbo.recipes WITH (UPDLOCK, HOLDLOCK)
        WHERE product_id = @product_id
          AND ((@variant_option_id IS NULL AND variant_option_id IS NULL) OR variant_option_id = @variant_option_id);

        IF @recipe_id IS NULL
        BEGIN
            INSERT INTO dbo.recipes (product_id, variant_option_id, notes) VALUES (@product_id, @variant_option_id, @notes);
            SET @recipe_id = SCOPE_IDENTITY();
        END
        ELSE
        BEGIN
            UPDATE dbo.recipes SET notes = @notes, active = 1, updated_at = SYSDATETIME() WHERE id = @recipe_id;
            DELETE FROM dbo.recipe_lines WHERE recipe_id = @recipe_id;
        END

        INSERT INTO dbo.recipe_lines (recipe_id, ingredient_product_id, qty_base, input_qty, input_uom, waste_pct, sort_order)
        SELECT
            @recipe_id,
            l.ingredient_product_id,
            CAST(l.input_qty * ui.factor_to_base / ub.factor_to_base AS DECIMAL(14, 4)),
            l.input_qty,
            l.input_uom,
            ISNULL(l.waste_pct, 0),
            ISNULL(l.sort_order, ROW_NUMBER() OVER (ORDER BY (SELECT NULL)))
        FROM @Lines l
        JOIN dbo.products i ON i.id = l.ingredient_product_id
        JOIN dbo.uoms ub ON ub.code = i.base_uom
        JOIN dbo.uoms ui ON ui.code = l.input_uom;

        IF EXISTS (SELECT 1 FROM dbo.recipe_lines WHERE recipe_id = @recipe_id AND qty_base <= 0)
        BEGIN
            RAISERROR('Una cantidad es demasiado pequena para la unidad base (queda en cero).', 16, 1);
            ROLLBACK TRAN; RETURN;
        END

        COMMIT TRAN;
        SELECT @recipe_id AS recipe_id;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO

/* ---------- sp_set_product_image (SQL_STORED_PROCEDURE) ---------- */
/* sp_set_product_image
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Guarda (o quita, con @thumb NULL) la miniatura de un producto. La miniatura
-- vive en SQL para que TODAS las cajas de la sucursal la vean, viaje en el
-- respaldo y funcione sin red; cada caja la cachea en disco por version.
-- La app la reduce antes (<= 64 KB, ver CK_product_images_size).
CREATE OR ALTER PROCEDURE dbo.sp_set_product_image
    @product_id INT,
    @thumb      VARBINARY(MAX) = NULL,
    @mime       NVARCHAR(30) = 'image/jpeg',
    @width      INT = 0,
    @height     INT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id)
    BEGIN RAISERROR('El producto no existe.', 16, 1); RETURN; END
    IF @thumb IS NOT NULL AND DATALENGTH(@thumb) > 65536
    BEGIN RAISERROR('La miniatura supera 64 KB. Reduce la imagen antes de guardarla.', 16, 1); RETURN; END

    BEGIN TRY
        BEGIN TRAN;
        DECLARE @version INT;
        UPDATE dbo.products SET image_version = image_version + 1, @version = image_version + 1 WHERE id = @product_id;

        IF @thumb IS NULL
        BEGIN
            DELETE FROM dbo.product_images WHERE product_id = @product_id;
        END
        ELSE IF EXISTS (SELECT 1 FROM dbo.product_images WHERE product_id = @product_id)
        BEGIN
            UPDATE dbo.product_images
               SET thumb = @thumb, mime = ISNULL(@mime, 'image/jpeg'), width = ISNULL(@width, 0), height = ISNULL(@height, 0),
                   version = @version, updated_at = SYSDATETIME()
             WHERE product_id = @product_id;
        END
        ELSE
        BEGIN
            INSERT INTO dbo.product_images (product_id, thumb, mime, width, height, version)
            VALUES (@product_id, @thumb, ISNULL(@mime, 'image/jpeg'), ISNULL(@width, 0), ISNULL(@height, 0), @version);
        END
        COMMIT TRAN;
        SELECT @product_id AS product_id, @version AS image_version, CASE WHEN @thumb IS NULL THEN 0 ELSE 1 END AS has_image;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO

/* ---------- sp_set_product_modifier_groups (SQL_STORED_PROCEDURE) ---------- */
/* sp_set_product_modifier_groups
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Reemplaza los grupos ligados a un producto, en el orden dado.
-- @group_ids_json: arreglo JSON de ids, p. ej. '[3,1,7]'.
CREATE OR ALTER PROCEDURE dbo.sp_set_product_modifier_groups
    @product_id     INT,
    @group_ids_json NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id)
    BEGIN RAISERROR('El producto no existe.', 16, 1); RETURN; END
    IF @group_ids_json IS NULL OR ISJSON(@group_ids_json) = 0
    BEGIN RAISERROR('group_ids_json debe ser un arreglo JSON.', 16, 1); RETURN; END

    DECLARE @ids TABLE (group_id INT NOT NULL, sort_order INT NOT NULL);
    INSERT INTO @ids (group_id, sort_order)
    SELECT CAST([value] AS INT), CAST([key] AS INT) FROM OPENJSON(@group_ids_json);

    IF EXISTS (SELECT 1 FROM @ids i LEFT JOIN dbo.modifier_groups g ON g.id = i.group_id WHERE g.id IS NULL)
    BEGIN RAISERROR('Un grupo no existe.', 16, 1); RETURN; END

    -- Quitar un grupo SIZE que tenga recetas por variante dejaria recetas
    -- huerfanas: se exige borrarlas primero.
    IF EXISTS (
        SELECT 1 FROM dbo.recipes r
        JOIN dbo.modifier_options o ON o.id = r.variant_option_id
        WHERE r.product_id = @product_id AND o.group_id NOT IN (SELECT group_id FROM @ids))
    BEGIN RAISERROR('Este producto tiene recetas por tamano de un grupo que se intenta quitar. Elimina esas recetas primero.', 16, 1); RETURN; END

    BEGIN TRY
        BEGIN TRAN;
        DELETE FROM dbo.product_modifier_groups WHERE product_id = @product_id;
        INSERT INTO dbo.product_modifier_groups (product_id, group_id, sort_order)
        SELECT @product_id, group_id, sort_order FROM @ids;
        COMMIT TRAN;
        SELECT @product_id AS product_id, (SELECT COUNT(*) FROM @ids) AS groups_count;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO

/* ---------- sp_update_product (SQL_STORED_PROCEDURE) ---------- */
/* sp_update_product
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Update: + campos fiscales SAT (opcionales)
-- Conserva la logica original de bar_code.
-- Update: + inventory_mode, sellable, base_uom, allow_decimal_qty, cost.
--   NULL conserva el valor actual. Guardas de un solo nivel: un producto que
--   ya es ingrediente no puede volverse RECIPE; una RECIPE con recetas no
--   puede dejar de serlo sin borrarlas; la unidad base no cambia de
--   dimension mientras haya recetas que consuman el producto.
-- =============================================
CREATE OR ALTER PROCEDURE [dbo].[sp_update_product]
    @product_id INT,
    @nombre NVARCHAR(100),
    @precio DECIMAL(10,2),
    @stock DECIMAL(10,2),
    @numero_parte NVARCHAR(100),
    @bar_code NVARCHAR(100) = NULL,
    @clave_prod_serv NVARCHAR(8) = NULL,
    @clave_unidad NVARCHAR(5) = NULL,
    @objeto_impuesto NVARCHAR(2) = NULL,
    @tasa_iva DECIMAL(5,4) = NULL,
    @inventory_mode NVARCHAR(10) = NULL,
    @sellable BIT = NULL,
    @base_uom NVARCHAR(10) = NULL,
    @allow_decimal_qty BIT = NULL,
    @cost DECIMAL(14,4) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @modo_actual NVARCHAR(10), @uom_actual NVARCHAR(10);
    SELECT @modo_actual = inventory_mode, @uom_actual = base_uom FROM products WHERE id = @product_id;
    IF @modo_actual IS NULL
    BEGIN
        RAISERROR('El producto no existe.', 16, 1);
        RETURN;
    END

    IF @inventory_mode IS NOT NULL
    BEGIN
        SET @inventory_mode = UPPER(@inventory_mode);
        IF @inventory_mode NOT IN ('DIRECT', 'RECIPE', 'NONE')
        BEGIN
            RAISERROR('inventory_mode invalido: DIRECT, RECIPE o NONE.', 16, 1);
            RETURN;
        END
        IF @inventory_mode <> @modo_actual
        BEGIN
            IF @inventory_mode = 'RECIPE' AND (
                   EXISTS (SELECT 1 FROM dbo.recipe_lines WHERE ingredient_product_id = @product_id)
                OR EXISTS (SELECT 1 FROM dbo.modifier_options WHERE ingredient_product_id = @product_id OR replaces_product_id = @product_id))
            BEGIN
                RAISERROR('Este producto es ingrediente de una receta o modificador: no puede convertirse en receta.', 16, 1);
                RETURN;
            END
            IF @modo_actual = 'RECIPE' AND EXISTS (SELECT 1 FROM dbo.recipes WHERE product_id = @product_id)
            BEGIN
                RAISERROR('Este producto tiene recetas. Eliminalas antes de cambiar su tipo de inventario.', 16, 1);
                RETURN;
            END
            IF @modo_actual <> 'DIRECT' AND @inventory_mode = 'DIRECT' AND EXISTS (SELECT 1 FROM dbo.recipes WHERE product_id = @product_id)
            BEGIN
                RAISERROR('Este producto tiene recetas. Eliminalas antes de cambiar su tipo de inventario.', 16, 1);
                RETURN;
            END
        END
    END

    IF @base_uom IS NOT NULL AND @base_uom <> @uom_actual
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.uoms WHERE code = @base_uom AND is_base = 1)
        BEGIN
            RAISERROR('La unidad base debe ser una unidad base (pza, g, ml, cm).', 16, 1);
            RETURN;
        END
        IF EXISTS (SELECT 1 FROM dbo.recipe_lines WHERE ingredient_product_id = @product_id)
           OR EXISTS (SELECT 1 FROM dbo.modifier_options WHERE ingredient_product_id = @product_id OR replaces_product_id = @product_id)
        BEGIN
            RAISERROR('Este producto ya se usa en recetas o modificadores: su unidad base no puede cambiar.', 16, 1);
            RETURN;
        END
    END

    -- Si mandan un bar_code no vacio, valida que no lo tenga otro producto
    IF @bar_code IS NOT NULL AND LTRIM(RTRIM(@bar_code)) <> ''
    BEGIN
        IF EXISTS (
            SELECT 1 FROM products
            WHERE bar_code = @bar_code AND id <> @product_id
        )
        BEGIN
            RAISERROR('Ese codigo de barras ya esta asignado a otro producto.', 16, 1);
            RETURN;
        END
    END

    UPDATE products
    SET nombre = @nombre,
        price = @precio,
        stock = CASE WHEN ISNULL(@inventory_mode, inventory_mode) = 'RECIPE' THEN 0 ELSE @stock END,
        part_number = @numero_parte,
        bar_code = CASE
                     WHEN @bar_code IS NULL THEN bar_code           -- no lo tocan: conserva
                     WHEN LTRIM(RTRIM(@bar_code)) = '' THEN NULL     -- vacio: lo limpia
                     ELSE @bar_code
                   END,
        -- Campos fiscales: si mandan NULL, conservan el valor actual
        clave_prod_serv = ISNULL(@clave_prod_serv, clave_prod_serv),
        clave_unidad    = ISNULL(@clave_unidad, clave_unidad),
        objeto_impuesto = ISNULL(@objeto_impuesto, objeto_impuesto),
        tasa_iva        = ISNULL(@tasa_iva, tasa_iva),
        inventory_mode    = ISNULL(@inventory_mode, inventory_mode),
        sellable          = ISNULL(@sellable, sellable),
        base_uom          = ISNULL(@base_uom, base_uom),
        allow_decimal_qty = ISNULL(@allow_decimal_qty, allow_decimal_qty),
        cost              = ISNULL(@cost, cost)
    WHERE id = @product_id;
END;
GO
