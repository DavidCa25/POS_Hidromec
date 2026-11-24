/* salud_productos
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.salud_productos', 'U') IS NULL
BEGIN
CREATE TABLE dbo.salud_productos (
    product_id INT NOT NULL,
    fraccion TINYINT NULL,
    es_antibiotico BIT NOT NULL CONSTRAINT DF_salud_prod_atb DEFAULT ((0)),
    sustancia_activa NVARCHAR(160) COLLATE Modern_Spanish_CI_AS NULL,
    presentacion NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL,
    registro_sanitario NVARCHAR(40) COLLATE Modern_Spanish_CI_AS NULL,
    refrigeracion BIT NOT NULL CONSTRAINT DF_salud_prod_frio DEFAULT ((0)),
    precio_maximo DECIMAL(10, 2) NULL,
    controla_lotes BIT NOT NULL CONSTRAINT DF_salud_prod_lotes DEFAULT ((1)),
    requiere_receta AS (CONVERT([bit],case when [es_antibiotico]=(1) OR [fraccion]>=(1) AND [fraccion]<=(4) then (1) else (0) end)) PERSISTED,
    es_controlado AS (CONVERT([bit],case when [fraccion]>=(1) AND [fraccion]<=(3) then (1) else (0) end)) PERSISTED,
    updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_salud_prod_upd DEFAULT (sysdatetime()),
    updated_by INT NULL,
    CONSTRAINT PK_salud_productos PRIMARY KEY CLUSTERED (product_id)
);
END;

IF OBJECT_ID(N'dbo.CK_salud_productos_fraccion', 'C') IS NULL
ALTER TABLE dbo.salud_productos WITH CHECK ADD CONSTRAINT CK_salud_productos_fraccion CHECK ([fraccion] IS NULL OR [fraccion]>=(1) AND [fraccion]<=(6));

IF OBJECT_ID(N'dbo.CK_salud_productos_pmax', 'C') IS NULL
ALTER TABLE dbo.salud_productos WITH CHECK ADD CONSTRAINT CK_salud_productos_pmax CHECK ([precio_maximo] IS NULL OR [precio_maximo]>=(0));

IF OBJECT_ID(N'dbo.FK_salud_productos_product', 'F') IS NULL
ALTER TABLE dbo.salud_productos WITH CHECK ADD CONSTRAINT FK_salud_productos_product FOREIGN KEY (product_id) REFERENCES dbo.products (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_salud_productos_receta' AND object_id = OBJECT_ID(N'dbo.salud_productos'))
CREATE NONCLUSTERED INDEX IX_salud_productos_receta ON dbo.salud_productos (requiere_receta) INCLUDE (es_antibiotico, es_controlado);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_salud_productos_sustancia' AND object_id = OBJECT_ID(N'dbo.salud_productos'))
CREATE NONCLUSTERED INDEX IX_salud_productos_sustancia ON dbo.salud_productos (sustancia_activa);
