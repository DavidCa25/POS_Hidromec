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
