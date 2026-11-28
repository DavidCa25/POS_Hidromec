/* 0095 · Carne por rendimiento
 *
 * Una taquería no pesa 70 g por taco: sabe cuántos kilos compró y cuánto le
 * quedó al cerrar. Con eso y un número a ojo («1 kg de pastor ≈ 14 tacos»)
 * Wybix calcula cuánto rindió cada kilo y cuánta carne se fue sin cobrarse.
 * Sin recetas.
 *
 *   rendimiento_carnes     el insumo (products, en gramos) que se lleva por
 *                          rendimiento y cuántos tacos rinde un kilo.
 *   rendimiento_platillos  qué platillo vendido cuenta tacos de qué carne y
 *                          cuántos (la «Orden de 5» cuenta 5). Lo llena
 *                          sp_rendimiento_mapear por el nombre; `manual` = lo
 *                          fijó una persona y el mapeo no lo toca.
 *   rendimiento_conteos    cada «¿cuánta carne te quedó?» del corte: lo que
 *                          había, lo que quedó, lo que se usó (salida de
 *                          inventario RENDIMIENTO, a su costo) y los tacos
 *                          vendidos desde el conteo anterior.
 *
 * El costo de la carne usada lo reparte sp_income_statement entre los tacos
 * vendidos de ese periodo: sale como costo de ventas, no como ajuste.
 */
IF OBJECT_ID(N'dbo.rendimiento_carnes', 'U') IS NULL
BEGIN
CREATE TABLE dbo.rendimiento_carnes (
    product_id INT NOT NULL,
    rinde DECIMAL(6, 2) NOT NULL,
    activo BIT NOT NULL CONSTRAINT DF_rendimiento_carnes_activo DEFAULT ((1)),
    desde DATETIME2(3) NOT NULL CONSTRAINT DF_rendimiento_carnes_desde DEFAULT (sysdatetime()),
    actualizado DATETIME2(0) NOT NULL CONSTRAINT DF_rendimiento_carnes_actualizado DEFAULT (sysdatetime()),
    CONSTRAINT PK_rendimiento_carnes PRIMARY KEY CLUSTERED (product_id)
);
END;

IF OBJECT_ID(N'dbo.FK_rendimiento_carnes_product', 'F') IS NULL
ALTER TABLE dbo.rendimiento_carnes WITH CHECK ADD CONSTRAINT FK_rendimiento_carnes_product FOREIGN KEY (product_id) REFERENCES dbo.products (id);

IF OBJECT_ID(N'dbo.CK_rendimiento_carnes_rinde', 'C') IS NULL
ALTER TABLE dbo.rendimiento_carnes WITH CHECK ADD CONSTRAINT CK_rendimiento_carnes_rinde CHECK ([rinde] >= 1 AND [rinde] <= 60);

IF OBJECT_ID(N'dbo.rendimiento_platillos', 'U') IS NULL
BEGIN
CREATE TABLE dbo.rendimiento_platillos (
    product_id INT NOT NULL,
    carne_id INT NOT NULL,
    tacos DECIMAL(6, 2) NOT NULL,
    manual BIT NOT NULL CONSTRAINT DF_rendimiento_platillos_manual DEFAULT ((0)),
    CONSTRAINT PK_rendimiento_platillos PRIMARY KEY CLUSTERED (product_id, carne_id)
);
END;

IF OBJECT_ID(N'dbo.FK_rendimiento_platillos_product', 'F') IS NULL
ALTER TABLE dbo.rendimiento_platillos WITH CHECK ADD CONSTRAINT FK_rendimiento_platillos_product FOREIGN KEY (product_id) REFERENCES dbo.products (id);

IF OBJECT_ID(N'dbo.FK_rendimiento_platillos_carne', 'F') IS NULL
ALTER TABLE dbo.rendimiento_platillos WITH CHECK ADD CONSTRAINT FK_rendimiento_platillos_carne FOREIGN KEY (carne_id) REFERENCES dbo.rendimiento_carnes (product_id);

IF OBJECT_ID(N'dbo.CK_rendimiento_platillos_tacos', 'C') IS NULL
ALTER TABLE dbo.rendimiento_platillos WITH CHECK ADD CONSTRAINT CK_rendimiento_platillos_tacos CHECK ([tacos] > 0 AND [tacos] <= 100);

IF OBJECT_ID(N'dbo.rendimiento_conteos', 'U') IS NULL
BEGIN
CREATE TABLE dbo.rendimiento_conteos (
    id INT IDENTITY(1, 1) NOT NULL,
    carne_id INT NOT NULL,
    closure_id INT NULL,
    desde DATETIME2(3) NOT NULL,
    contado_en DATETIME2(3) NOT NULL CONSTRAINT DF_rendimiento_conteos_contado_en DEFAULT (sysdatetime()),
    tenia DECIMAL(12, 2) NOT NULL,
    quedo DECIMAL(12, 2) NOT NULL,
    usado DECIMAL(12, 2) NOT NULL,
    vendidos DECIMAL(12, 2) NOT NULL,
    rinde DECIMAL(6, 2) NOT NULL,
    costo_g DECIMAL(14, 4) NOT NULL,
    precio_taco DECIMAL(10, 2) NULL,
    user_id INT NULL,
    CONSTRAINT PK_rendimiento_conteos PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_rendimiento_conteos_carne', 'F') IS NULL
ALTER TABLE dbo.rendimiento_conteos WITH CHECK ADD CONSTRAINT FK_rendimiento_conteos_carne FOREIGN KEY (carne_id) REFERENCES dbo.rendimiento_carnes (product_id);

IF OBJECT_ID(N'dbo.FK_rendimiento_conteos_closure', 'F') IS NULL
ALTER TABLE dbo.rendimiento_conteos WITH CHECK ADD CONSTRAINT FK_rendimiento_conteos_closure FOREIGN KEY (closure_id) REFERENCES dbo.cash_closures (id);

/* Un conteo por carne y por corte: reintentar el cierre no cuenta dos veces. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_rendimiento_conteos_corte' AND object_id = OBJECT_ID(N'dbo.rendimiento_conteos'))
CREATE UNIQUE NONCLUSTERED INDEX UX_rendimiento_conteos_corte ON dbo.rendimiento_conteos (carne_id, closure_id) WHERE closure_id IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_rendimiento_conteos_fecha' AND object_id = OBJECT_ID(N'dbo.rendimiento_conteos'))
CREATE NONCLUSTERED INDEX IX_rendimiento_conteos_fecha ON dbo.rendimiento_conteos (contado_en, carne_id);
GO
