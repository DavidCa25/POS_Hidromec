/* ---------------------------------------------------------------------------
   BLOQUE DE ESQUEMA — snapshot de la receta efectiva.

   Todo ADITIVO y anulable. Ninguna venta historica cambia de significado: las
   columnas nuevas quedan en NULL para lo ya vendido, que es la verdad -de esas
   ventas no sabemos con que receta se prepararon- y no se inventa nada.

   QUE SE CONGELA Y DONDE
   ----------------------
   sale_detail.recipe_id / variant_option_id
       con QUE receta se preparo la linea. No es el historico completo: si
       manana editan `recipe_lines`, esa receta ya no dice lo mismo.

   sale_detail_modifiers.ingredient_product_id / replaces_product_id /
   qty_base_aplicado / qty_factor_aplicado
       que hizo FISICAMENTE cada modificador en el momento de la venta. Antes
       solo quedaba el nombre y el precio, asi que auditar "por que esta venta
       consumio leche de almendra" obligaba a mirar la definicion ACTUAL de la
       opcion, que pudo cambiar.

   El consumo REAL -que producto, cuanto, a que costo- ya estaba congelado en
   `inventory_movements`, ligado a la linea vendida. Por eso no se duplica aqui
   la cantidad efectiva de cada ingrediente: existiria dos veces y podrian
   discrepar. El reembolso sigue leyendo los movimientos, nunca recalculando.

   Idempotente: se puede reejecutar.
   --------------------------------------------------------------------------- */

IF COL_LENGTH(N'dbo.sale_detail', N'recipe_id') IS NULL
    ALTER TABLE dbo.sale_detail ADD recipe_id INT NULL;
GO

IF COL_LENGTH(N'dbo.sale_detail', N'variant_option_id') IS NULL
    ALTER TABLE dbo.sale_detail ADD variant_option_id INT NULL;
GO

IF COL_LENGTH(N'dbo.sale_detail_modifiers', N'ingredient_product_id') IS NULL
    ALTER TABLE dbo.sale_detail_modifiers ADD ingredient_product_id INT NULL;
GO

IF COL_LENGTH(N'dbo.sale_detail_modifiers', N'replaces_product_id') IS NULL
    ALTER TABLE dbo.sale_detail_modifiers ADD replaces_product_id INT NULL;
GO

IF COL_LENGTH(N'dbo.sale_detail_modifiers', N'qty_base_aplicado') IS NULL
    ALTER TABLE dbo.sale_detail_modifiers ADD qty_base_aplicado DECIMAL(14, 4) NULL;
GO

IF COL_LENGTH(N'dbo.sale_detail_modifiers', N'qty_factor_aplicado') IS NULL
    ALTER TABLE dbo.sale_detail_modifiers ADD qty_factor_aplicado DECIMAL(8, 4) NULL;
GO

/* Sin clave foranea a proposito: el snapshot tiene que sobrevivir aunque la
   receta o la opcion se borren manana. Una FK obligaria a conservarlas para
   siempre o a perder el historico, y las dos cosas son peores. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sale_detail_recipe' AND object_id = OBJECT_ID(N'dbo.sale_detail'))
CREATE NONCLUSTERED INDEX IX_sale_detail_recipe ON dbo.sale_detail (recipe_id) WHERE recipe_id IS NOT NULL;
