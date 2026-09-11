/* modifier_options
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
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
    CONSTRAINT PK_modifier_options PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_modifier_options_effect', 'C') IS NULL
ALTER TABLE dbo.modifier_options WITH CHECK ADD CONSTRAINT CK_modifier_options_effect CHECK ([effect]='NONE' OR [effect]='ADD' AND [ingredient_product_id] IS NOT NULL AND [qty_base]>(0) OR [effect]='REMOVE' AND [replaces_product_id] IS NOT NULL OR [effect]='SUBSTITUTE' AND [ingredient_product_id] IS NOT NULL AND [replaces_product_id] IS NOT NULL OR [effect]='SCALE' AND [qty_factor]>(0));

IF OBJECT_ID(N'dbo.FK_modifier_options_group', 'F') IS NULL
ALTER TABLE dbo.modifier_options WITH CHECK ADD CONSTRAINT FK_modifier_options_group FOREIGN KEY (group_id) REFERENCES dbo.modifier_groups (id);

IF OBJECT_ID(N'dbo.FK_modifier_options_ingredient', 'F') IS NULL
ALTER TABLE dbo.modifier_options WITH CHECK ADD CONSTRAINT FK_modifier_options_ingredient FOREIGN KEY (ingredient_product_id) REFERENCES dbo.products (id);

IF OBJECT_ID(N'dbo.FK_modifier_options_replaces', 'F') IS NULL
ALTER TABLE dbo.modifier_options WITH CHECK ADD CONSTRAINT FK_modifier_options_replaces FOREIGN KEY (replaces_product_id) REFERENCES dbo.products (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_modifier_options_group' AND object_id = OBJECT_ID(N'dbo.modifier_options'))
CREATE NONCLUSTERED INDEX IX_modifier_options_group ON dbo.modifier_options (group_id, sort_order);
