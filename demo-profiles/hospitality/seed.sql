/* ============================================================
   SEMILLA DEMO - HOSPITALITY

   Lo MINIMO para ensenar lo que distingue a Hospitality de un mostrador
   normal: que un producto no baja su propia existencia, sino la de sus
   ingredientes, y que las opciones del cliente cambian esa cuenta.

   Un producto terminado, tres ingredientes y tres grupos de opciones:

     Tamano        Chico / Grande, cada uno con su receta.
     Tipo de leche Entera (sin efecto) / Avena (SUSTITUYE a la entera).
     Extras        Shot de espresso, hasta 3 unidades en total.

   Con eso se demuestra receta por tamano, sustitucion, extra con cantidad y
   el precio compuesto. Nada mas: una demo sirve para PROBAR Wybix, no para
   aparentar un negocio con meses de operacion.

   Todo idempotente: volver a correrla no duplica nada.
   ============================================================ */

SET NOCOUNT ON;
GO

/* ---------------------------------------------------- 1) EL MARCADOR
   Lo primero, por la misma razon que en Retail: si la semilla falla a la
   mitad, la base ya es reconocible como demo y el gestor puede rehacerla. */
MERGE dbo.database_metadata AS d
USING (VALUES ('is_demo', 'true'), ('demo_profile', 'hospitality'),
              ('demo_created_at', CONVERT(NVARCHAR(30), SYSDATETIME(), 126))) AS s(clave, valor)
   ON d.clave = s.clave
 WHEN MATCHED THEN UPDATE SET valor = s.valor
 WHEN NOT MATCHED THEN INSERT (clave, valor) VALUES (s.clave, s.valor);
GO

/* El identificador de ESTA demo. Se genera una sola vez y no se vuelve a
   tocar: volver a correr la semilla sobre la misma base conserva el que ya
   estaba, porque es lo que el gestor tiene anotado de su lado. Sin coincidencia
   entre los dos, la base no se puede restablecer ni eliminar desde el gestor.

   Lo genera SQL con NEWID() y no el gestor, para que una base sembrada a mano
   -las pruebas lo hacen- quede igual de completa que una creada desde la
   ventana. El gestor lo lee de vuelta despues de sembrar. */
IF NOT EXISTS (SELECT 1 FROM dbo.database_metadata WHERE clave = 'demo_instance_id')
    INSERT INTO dbo.database_metadata (clave, valor)
    VALUES ('demo_instance_id', CONVERT(NVARCHAR(36), NEWID()));
GO

/* ------------------------------------------- 2) NEGOCIO Y ADMINISTRADOR */
IF NOT EXISTS (SELECT 1 FROM dbo.users)
BEGIN
    EXEC dbo.sp_setup_inicial
        @usuario        = N'demo',
        @password       = N'demo1234',
        @business_name  = N'Demo Hospitality',
        @address        = N'Calle de Prueba 100',
        @phone          = N'0000000000',
        @business_profile = N'HOSPITALITY';
END
GO

IF EXISTS (SELECT 1 FROM dbo.registers WHERE id = 1)
    UPDATE dbo.registers SET code = N'C1', name = N'Caja 1', is_active = 1 WHERE id = 1;
ELSE
BEGIN
    SET IDENTITY_INSERT dbo.registers ON;
    INSERT INTO dbo.registers (id, code, name, is_active) VALUES (1, N'C1', N'Caja 1', 1);
    SET IDENTITY_INSERT dbo.registers OFF;
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.CAT_categories WHERE namee = N'Bebidas')
    INSERT INTO dbo.CAT_categories (namee) VALUES (N'Bebidas');
GO

/* ------------------------------------------------- 3) LOS INGREDIENTES
   `sellable = 0`: se consumen, no se venden sueltos. Es lo que hace que
   aparezcan en la receta y no en el menu. */
MERGE dbo.products AS d
USING (VALUES
        (N'DEMO-ING-CAFE',  N'Café en grano',   CAST(0 AS DECIMAL(10,2)), CAST(5000 AS DECIMAL(12,3)), N'g'),
        (N'DEMO-ING-LECHE', N'Leche entera',    CAST(0 AS DECIMAL(10,2)), CAST(20000 AS DECIMAL(12,3)), N'ml'),
        (N'DEMO-ING-AVENA', N'Leche de avena',  CAST(0 AS DECIMAL(10,2)), CAST(8000 AS DECIMAL(12,3)), N'ml')
      ) AS s(part_number, nombre, price, stock, uom)
   ON d.part_number = s.part_number
 WHEN MATCHED THEN
      UPDATE SET nombre = s.nombre, stock = s.stock, active = 1, sellable = 0, base_uom = s.uom
 WHEN NOT MATCHED THEN
      INSERT (part_number, nombre, price, stock, active, registrated_date,
              inventory_mode, sellable, base_uom)
      VALUES (s.part_number, s.nombre, s.price, s.stock, 1, GETDATE(),
              N'DIRECT', 0, s.uom);
GO

/* --------------------------------------------- 4) EL PRODUCTO TERMINADO
   `inventory_mode = RECIPE`: su existencia NO se descuenta. Lo que baja es
   lo que dice su receta. Esa es la demostracion. */
MERGE dbo.products AS d
USING (VALUES (N'DEMO-LATTE', N'Latte', CAST(55.00 AS DECIMAL(10,2)))) AS s(part_number, nombre, price)
   ON d.part_number = s.part_number
 WHEN MATCHED THEN
      UPDATE SET nombre = s.nombre, price = s.price, active = 1,
                 inventory_mode = N'RECIPE', sellable = 1
 WHEN NOT MATCHED THEN
      INSERT (part_number, nombre, price, stock, active, registrated_date, category_id,
              inventory_mode, sellable, base_uom)
      VALUES (s.part_number, s.nombre, s.price, 0, 1, GETDATE(),
              (SELECT TOP 1 id FROM dbo.CAT_categories WHERE namee = N'Bebidas'),
              N'RECIPE', 1, N'pza');
GO

/* ------------------------------------------------- 5) LOS TRES GRUPOS
   Con el MISMO procedimiento que usa la pantalla de administracion, para que
   la demo no pueda quedarse con una forma de datos que la aplicacion real no
   produce. */
DECLARE @latte INT = (SELECT id FROM dbo.products WHERE part_number = N'DEMO-LATTE');
DECLARE @leche INT = (SELECT id FROM dbo.products WHERE part_number = N'DEMO-ING-LECHE');
DECLARE @avena INT = (SELECT id FROM dbo.products WHERE part_number = N'DEMO-ING-AVENA');
DECLARE @cafe  INT = (SELECT id FROM dbo.products WHERE part_number = N'DEMO-ING-CAFE');

/* --- Tamano: obligatorio, uno solo, y cada opcion con su propia receta. */
DECLARE @gTam INT = (SELECT TOP 1 id FROM dbo.modifier_groups WHERE name = N'Tamaño' AND role = 'SIZE');
DECLARE @ops dbo.ModifierOptionType;
INSERT INTO @ops (id, name, price_delta, effect, ingredient_product_id, replaces_product_id, qty_base, qty_factor, active, sort_order)
VALUES (NULL, N'Chico',  0,  N'NONE', NULL, NULL, NULL, NULL, 1, 1),
       (NULL, N'Grande', 15, N'NONE', NULL, NULL, NULL, NULL, 1, 2);

IF @gTam IS NULL
BEGIN
    EXEC dbo.sp_save_modifier_group
        @group_id = NULL, @name = N'Tamaño', @role = N'SIZE',
        @min_select = 1, @max_select = 1, @required = 1, @active = 1,
        @sort_order = 1, @Options = @ops;
    SET @gTam = (SELECT TOP 1 id FROM dbo.modifier_groups WHERE name = N'Tamaño' AND role = 'SIZE');
END
GO

/* --- Tipo de leche: obligatorio, uno solo, con una SUSTITUCION. */
DECLARE @leche INT = (SELECT id FROM dbo.products WHERE part_number = N'DEMO-ING-LECHE');
DECLARE @avena INT = (SELECT id FROM dbo.products WHERE part_number = N'DEMO-ING-AVENA');
DECLARE @gLec INT = (SELECT TOP 1 id FROM dbo.modifier_groups WHERE name = N'Tipo de leche');
DECLARE @ops2 dbo.ModifierOptionType;
INSERT INTO @ops2 (id, name, price_delta, effect, ingredient_product_id, replaces_product_id, qty_base, qty_factor, active, sort_order)
VALUES (NULL, N'Entera', 0,  N'NONE',       NULL,   NULL,   NULL, NULL, 1, 1),
       (NULL, N'Avena',  10, N'SUBSTITUTE', @avena, @leche, NULL, NULL, 1, 2);

IF @gLec IS NULL
BEGIN
    EXEC dbo.sp_save_modifier_group
        @group_id = NULL, @name = N'Tipo de leche', @role = N'SUBSTITUTION',
        @min_select = 1, @max_select = 1, @required = 1, @active = 1,
        @sort_order = 2, @Options = @ops2;
END
GO

/* --- Extras: opcional, hasta 3 UNIDADES en total, y suma consumo.
   `max_select = 3` cuenta unidades: dos espressos y un extra mas, no tres
   nombres distintos con tres unidades cada uno. */
DECLARE @cafe INT = (SELECT id FROM dbo.products WHERE part_number = N'DEMO-ING-CAFE');
DECLARE @gExt INT = (SELECT TOP 1 id FROM dbo.modifier_groups WHERE name = N'Extras');
DECLARE @ops3 dbo.ModifierOptionType;
INSERT INTO @ops3 (id, name, price_delta, effect, ingredient_product_id, replaces_product_id, qty_base, qty_factor, active, sort_order)
VALUES (NULL, N'Shot de espresso', 15, N'ADD', @cafe, NULL, 9.000, NULL, 1, 1);

IF @gExt IS NULL
BEGIN
    EXEC dbo.sp_save_modifier_group
        @group_id = NULL, @name = N'Extras', @role = N'ADDON',
        @min_select = 0, @max_select = 3, @required = 0, @active = 1,
        @sort_order = 3, @Options = @ops3;
END
GO

/* ------------------------------------- 6) LOS GRUPOS, AL PRODUCTO */
DECLARE @latte INT = (SELECT id FROM dbo.products WHERE part_number = N'DEMO-LATTE');
/* Un arreglo JSON, que es lo que exige el procedimiento: '[3,1,7]'. */
DECLARE @ids NVARCHAR(MAX) = (
    SELECT '[' + STRING_AGG(CAST(id AS NVARCHAR(12)), ',') + ']'
      FROM dbo.modifier_groups
     WHERE name IN (N'Tamaño', N'Tipo de leche', N'Extras'));

IF @latte IS NOT NULL AND @ids IS NOT NULL
    EXEC dbo.sp_set_product_modifier_groups
        @product_id = @latte, @group_ids_json = @ids;
GO

/* --------------------------------------------- 7) UNA RECETA POR TAMANO
   Chico y Grande consumen cantidades distintas del MISMO ingrediente. Es lo
   que se ensena al vender uno y otro y mirar el inventario. */
DECLARE @latte INT = (SELECT id FROM dbo.products WHERE part_number = N'DEMO-LATTE');
DECLARE @cafe  INT = (SELECT id FROM dbo.products WHERE part_number = N'DEMO-ING-CAFE');
DECLARE @leche INT = (SELECT id FROM dbo.products WHERE part_number = N'DEMO-ING-LECHE');
DECLARE @chico INT = (SELECT TOP 1 o.id FROM dbo.modifier_options o
                        JOIN dbo.modifier_groups g ON g.id = o.group_id
                       WHERE g.role = 'SIZE' AND o.name = N'Chico');
DECLARE @grande INT = (SELECT TOP 1 o.id FROM dbo.modifier_options o
                         JOIN dbo.modifier_groups g ON g.id = o.group_id
                        WHERE g.role = 'SIZE' AND o.name = N'Grande');

DECLARE @rc dbo.RecipeLineType;
INSERT INTO @rc (ingredient_product_id, input_qty, input_uom, waste_pct, sort_order)
VALUES (@cafe, 18.000, N'g', 0, 1), (@leche, 200.000, N'ml', 0, 2);
EXEC dbo.sp_save_recipe @product_id = @latte, @variant_option_id = @chico,
                        @notes = N'Latte chico', @Lines = @rc;

DECLARE @rg dbo.RecipeLineType;
INSERT INTO @rg (ingredient_product_id, input_qty, input_uom, waste_pct, sort_order)
VALUES (@cafe, 24.000, N'g', 0, 1), (@leche, 360.000, N'ml', 0, 2);
EXEC dbo.sp_save_recipe @product_id = @latte, @variant_option_id = @grande,
                        @notes = N'Latte grande', @Lines = @rg;
GO
