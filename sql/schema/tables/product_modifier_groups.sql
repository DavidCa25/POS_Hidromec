/* product_modifier_groups
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.product_modifier_groups', 'U') IS NULL
BEGIN
CREATE TABLE dbo.product_modifier_groups (
    product_id INT NOT NULL,
    group_id INT NOT NULL,
    sort_order INT NOT NULL CONSTRAINT DF_product_modifier_groups_sort_order DEFAULT ((0)),
    CONSTRAINT PK_product_modifier_groups PRIMARY KEY CLUSTERED (product_id, group_id)
);
END;

IF OBJECT_ID(N'dbo.FK_product_modifier_groups_group', 'F') IS NULL
ALTER TABLE dbo.product_modifier_groups WITH CHECK ADD CONSTRAINT FK_product_modifier_groups_group FOREIGN KEY (group_id) REFERENCES dbo.modifier_groups (id);

IF OBJECT_ID(N'dbo.FK_product_modifier_groups_product', 'F') IS NULL
ALTER TABLE dbo.product_modifier_groups WITH CHECK ADD CONSTRAINT FK_product_modifier_groups_product FOREIGN KEY (product_id) REFERENCES dbo.products (id);
