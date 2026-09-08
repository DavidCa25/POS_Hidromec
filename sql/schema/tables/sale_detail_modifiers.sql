/* sale_detail_modifiers
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
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

IF OBJECT_ID(N'dbo.FK_sale_detail_modifiers_detail', 'F') IS NULL
ALTER TABLE dbo.sale_detail_modifiers WITH CHECK ADD CONSTRAINT FK_sale_detail_modifiers_detail FOREIGN KEY (sale_detail_id) REFERENCES dbo.sale_detail (id) ON DELETE CASCADE;

IF OBJECT_ID(N'dbo.FK_sale_detail_modifiers_option', 'F') IS NULL
ALTER TABLE dbo.sale_detail_modifiers WITH CHECK ADD CONSTRAINT FK_sale_detail_modifiers_option FOREIGN KEY (modifier_option_id) REFERENCES dbo.modifier_options (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sale_detail_modifiers_detail' AND object_id = OBJECT_ID(N'dbo.sale_detail_modifiers'))
CREATE NONCLUSTERED INDEX IX_sale_detail_modifiers_detail ON dbo.sale_detail_modifiers (sale_detail_id);
