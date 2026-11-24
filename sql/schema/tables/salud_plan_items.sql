/* salud_plan_items
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.salud_plan_items', 'U') IS NULL
BEGIN
CREATE TABLE dbo.salud_plan_items (
    id INT IDENTITY(1, 1) NOT NULL,
    plan_id INT NOT NULL,
    fase TINYINT NOT NULL CONSTRAINT DF_salud_plan_items_fase DEFAULT ((1)),
    diente TINYINT NULL,
    procedimiento NVARCHAR(160) COLLATE Modern_Spanish_CI_AS NOT NULL,
    product_id INT NULL,
    precio DECIMAL(10, 2) NOT NULL,
    estado NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_salud_plan_items_estado DEFAULT (N'PENDIENTE'),
    hecho_at DATETIME2(0) NULL,
    CONSTRAINT PK_salud_plan_items PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_salud_plan_items_estado', 'C') IS NULL
ALTER TABLE dbo.salud_plan_items WITH CHECK ADD CONSTRAINT CK_salud_plan_items_estado CHECK ([estado]=N'HECHO' OR [estado]=N'PENDIENTE');

IF OBJECT_ID(N'dbo.CK_salud_plan_items_precio', 'C') IS NULL
ALTER TABLE dbo.salud_plan_items WITH CHECK ADD CONSTRAINT CK_salud_plan_items_precio CHECK ([precio]>=(0));

IF OBJECT_ID(N'dbo.FK_salud_plan_items_plan', 'F') IS NULL
ALTER TABLE dbo.salud_plan_items WITH CHECK ADD CONSTRAINT FK_salud_plan_items_plan FOREIGN KEY (plan_id) REFERENCES dbo.salud_planes (id) ON DELETE CASCADE;

IF OBJECT_ID(N'dbo.FK_salud_plan_items_product', 'F') IS NULL
ALTER TABLE dbo.salud_plan_items WITH CHECK ADD CONSTRAINT FK_salud_plan_items_product FOREIGN KEY (product_id) REFERENCES dbo.products (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_salud_plan_items_plan' AND object_id = OBJECT_ID(N'dbo.salud_plan_items'))
CREATE NONCLUSTERED INDEX IX_salud_plan_items_plan ON dbo.salud_plan_items (plan_id, fase);
