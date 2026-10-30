/* membership_plan_products
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.membership_plan_products', 'U') IS NULL
BEGIN
CREATE TABLE dbo.membership_plan_products (
    plan_id INT NOT NULL,
    product_id INT NOT NULL,
    CONSTRAINT PK_membership_plan_products PRIMARY KEY CLUSTERED (plan_id, product_id)
);
END;

IF OBJECT_ID(N'dbo.FK_membership_plan_products_plan', 'F') IS NULL
ALTER TABLE dbo.membership_plan_products WITH CHECK ADD CONSTRAINT FK_membership_plan_products_plan FOREIGN KEY (plan_id) REFERENCES dbo.membership_plans (id);

IF OBJECT_ID(N'dbo.FK_membership_plan_products_product', 'F') IS NULL
ALTER TABLE dbo.membership_plan_products WITH CHECK ADD CONSTRAINT FK_membership_plan_products_product FOREIGN KEY (product_id) REFERENCES dbo.products (id);
