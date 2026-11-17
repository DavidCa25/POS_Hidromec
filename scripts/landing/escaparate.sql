/* ============================================================
   ESCAPARATE - una demo retail LLENA, solo para las capturas de la landing.

   Va ENCIMA de demo-profiles/retail/seed.sql (marcador is_demo, alta del
   negocio y caja). No se usa en la demo del gestor: aquella sale en cero a
   proposito. Esta existe para que las capturas muestren un negocio con
   catalogo, cuatro semanas de ventas, clientes y cortes.

   Nombres GENERICOS: ni negocio, ni marca, ni cliente reales. Los codigos de
   barras usan el prefijo 7509990, que no es de ningun fabricante.

   Las ventas se registran con sp_register_sale, el mismo camino que una
   venta de la caja (existencias, pagos, turno). Despues se les cambia la
   fecha. Nada usa NEWID ni RAND: con la misma base sale la misma demo.

     node scripts/landing/preparar.cjs
   ============================================================ */
SET NOCOUNT ON;
GO

/* ------------------------------------------------ 1) EL NEGOCIO */
UPDATE dbo.business_config SET business_name = N'Mini Súper La Esquina',
       address = N'Av. Principal 120, Centro', phone = N'5550001234';
GO

/* ------------------------------------------- 2) CATEGORIAS Y MARCAS */
MERGE dbo.CAT_categories AS d
USING (VALUES (N'Bebidas'), (N'Botanas'), (N'Abarrotes'), (N'Lácteos'), (N'Panadería'),
              (N'Dulces'), (N'Limpieza'), (N'Cuidado personal')) AS s(n)
   ON d.namee = s.n
 WHEN NOT MATCHED THEN INSERT (namee) VALUES (s.n);
MERGE dbo.CAT_brands AS d
USING (VALUES (N'Campo Claro'), (N'Sol de Mayo'), (N'Brisa'), (N'Doña Clara'), (N'Norteña'), (N'Valle Alto')) AS s(n)
   ON d.namee = s.n
 WHEN NOT MATCHED THEN INSERT (namee) VALUES (s.n);
GO

/* ------------------------------------------------------- 3) PRODUCTOS
   Los dos de la semilla retail se quedan inactivos: el catalogo es este. */
UPDATE dbo.products SET active = 0 WHERE part_number IN (N'DEMO-001', N'DEMO-002');

MERGE dbo.products AS d
USING (VALUES
 (N'BEB-001', N'Refresco cola 600 ml',         N'Bebidas',  N'Brisa',       22.00,  13.50, 96,  N'7509990000017'),
 (N'BEB-002', N'Refresco cola 2 L',            N'Bebidas',  N'Brisa',       42.00,  28.00, 40,  N'7509990000024'),
 (N'BEB-003', N'Agua natural 1 L',             N'Bebidas',  N'Valle Alto',  14.00,   7.20, 120, N'7509990000031'),
 (N'BEB-004', N'Agua mineral 600 ml',          N'Bebidas',  N'Valle Alto',  19.00,  10.40, 60,  N'7509990000048'),
 (N'BEB-005', N'Jugo de naranja 1 L',          N'Bebidas',  N'Campo Claro', 36.00,  22.00, 28,  N'7509990000055'),
 (N'BEB-006', N'Bebida isotónica 500 ml',      N'Bebidas',  N'Brisa',       24.00,  15.00, 34,  N'7509990000062'),
 (N'BEB-007', N'Café frío lata 250 ml',        N'Bebidas',  N'Sol de Mayo', 28.00,  17.50, 6,   N'7509990000079'),
 (N'BOT-001', N'Papas fritas sal 45 g',        N'Botanas',  N'Norteña',     19.00,  11.00, 72,  N'7509990000086'),
 (N'BOT-002', N'Papas fritas chile 45 g',      N'Botanas',  N'Norteña',     19.00,  11.00, 58,  N'7509990000093'),
 (N'BOT-003', N'Cacahuate japonés 100 g',      N'Botanas',  N'Norteña',     24.00,  13.00, 30,  N'7509990000109'),
 (N'BOT-004', N'Totopos 200 g',                N'Botanas',  N'Campo Claro', 32.00,  19.00, 25,  N'7509990000116'),
 (N'BOT-005', N'Palomitas mantequilla 90 g',   N'Botanas',  N'Norteña',     21.00,  12.00, 4,   N'7509990000123'),
 (N'ABA-001', N'Arroz 1 kg',                   N'Abarrotes',N'Campo Claro', 34.00,  23.00, 45,  N'7509990000130'),
 (N'ABA-002', N'Frijol negro 1 kg',            N'Abarrotes',N'Campo Claro', 42.00,  29.00, 38,  N'7509990000147'),
 (N'ABA-003', N'Aceite vegetal 1 L',           N'Abarrotes',N'Doña Clara',  48.00,  34.00, 30,  N'7509990000154'),
 (N'ABA-004', N'Azúcar estándar 1 kg',         N'Abarrotes',N'Doña Clara',  32.00,  22.50, 50,  N'7509990000161'),
 (N'ABA-005', N'Sal de mesa 1 kg',             N'Abarrotes',N'Doña Clara',  14.00,   7.00, 40,  N'7509990000178'),
 (N'ABA-006', N'Pasta para sopa 200 g',        N'Abarrotes',N'Sol de Mayo',  9.50,   5.10, 110, N'7509990000185'),
 (N'ABA-007', N'Atún en agua 140 g',           N'Abarrotes',N'Sol de Mayo', 26.00,  16.80, 64,  N'7509990000192'),
 (N'ABA-008', N'Café soluble 100 g',           N'Abarrotes',N'Sol de Mayo', 78.00,  52.00, 18,  N'7509990000208'),
 (N'ABA-009', N'Galletas marías 170 g',        N'Abarrotes',N'Doña Clara',  18.00,  10.50, 48,  N'7509990000215'),
 (N'ABA-010', N'Harina de trigo 1 kg',         N'Abarrotes',N'Campo Claro', 26.00,  17.00, 3,   N'7509990000222'),
 (N'LAC-001', N'Leche entera 1 L',             N'Lácteos',  N'Valle Alto',  28.00,  21.50, 80,  N'7509990000239'),
 (N'LAC-002', N'Leche deslactosada 1 L',       N'Lácteos',  N'Valle Alto',  30.00,  23.00, 46,  N'7509990000246'),
 (N'LAC-003', N'Yogur fresa 1 kg',             N'Lácteos',  N'Valle Alto',  44.00,  30.00, 22,  N'7509990000253'),
 (N'LAC-004', N'Queso panela 400 g',           N'Lácteos',  N'Campo Claro', 72.00,  50.00, 14,  N'7509990000260'),
 (N'LAC-005', N'Crema 250 ml',                 N'Lácteos',  N'Campo Claro', 27.00,  18.00, 2,   N'7509990000277'),
 (N'LAC-006', N'Huevo blanco 12 pzas',         N'Lácteos',  N'Campo Claro', 46.00,  34.00, 36,  N'7509990000284'),
 (N'PAN-001', N'Pan de caja blanco 680 g',     N'Panadería',N'Doña Clara',  48.00,  33.00, 24,  N'7509990000291'),
 (N'PAN-002', N'Tortillas de harina 10 pzas',  N'Panadería',N'Doña Clara',  29.00,  18.00, 30,  N'7509990000307'),
 (N'PAN-003', N'Pan dulce surtido 4 pzas',     N'Panadería',N'Doña Clara',  38.00,  22.00, 16,  N'7509990000314'),
 (N'DUL-001', N'Chocolate con leche 40 g',     N'Dulces',   N'Sol de Mayo', 17.00,   9.50, 70,  N'7509990000321'),
 (N'DUL-002', N'Gomitas frutales 100 g',       N'Dulces',   N'Sol de Mayo', 16.00,   8.40, 54,  N'7509990000338'),
 (N'DUL-003', N'Paleta de caramelo',           N'Dulces',   N'Sol de Mayo',  5.00,   2.10, 150, N'7509990000345'),
 (N'DUL-004', N'Chicles menta 10 pzas',        N'Dulces',   N'Sol de Mayo', 12.00,   6.00, 88,  N'7509990000352'),
 (N'LIM-001', N'Detergente en polvo 1 kg',     N'Limpieza', N'Brisa',       52.00,  36.00, 26,  N'7509990000369'),
 (N'LIM-002', N'Jabón para trastes 750 ml',    N'Limpieza', N'Brisa',       38.00,  25.00, 30,  N'7509990000376'),
 (N'LIM-003', N'Cloro 1 L',                    N'Limpieza', N'Brisa',       22.00,  13.00, 40,  N'7509990000383'),
 (N'LIM-004', N'Papel higiénico 4 rollos',     N'Limpieza', N'Brisa',       44.00,  30.00, 32,  N'7509990000390'),
 (N'LIM-005', N'Servilletas 200 pzas',         N'Limpieza', N'Brisa',       26.00,  15.50, 28,  N'7509990000406'),
 (N'CUI-001', N'Jabón de tocador 150 g',       N'Cuidado personal', N'Valle Alto', 21.00, 12.50, 44, N'7509990000413'),
 (N'CUI-002', N'Shampoo 400 ml',               N'Cuidado personal', N'Valle Alto', 64.00, 42.00, 18, N'7509990000420'),
 (N'CUI-003', N'Pasta dental 100 ml',          N'Cuidado personal', N'Valle Alto', 36.00, 22.00, 26, N'7509990000437'),
 (N'CUI-004', N'Desodorante 150 ml',           N'Cuidado personal', N'Valle Alto', 58.00, 38.00, 5,  N'7509990000444')
) AS s(pn, nombre, cat, marca, price, cost, stock, bar)
   ON d.part_number = s.pn
 WHEN MATCHED THEN UPDATE SET nombre = s.nombre, price = s.price, cost = s.cost, stock = s.stock, bar_code = s.bar, active = 1,
      category_id = (SELECT TOP 1 id FROM dbo.CAT_categories WHERE namee = s.cat),
      brand_id = (SELECT TOP 1 id FROM dbo.CAT_brands WHERE namee = s.marca)
 WHEN NOT MATCHED THEN
      INSERT (part_number, nombre, price, cost, stock, bar_code, active, registrated_date, category_id, brand_id,
              inventory_mode, sellable, base_uom, objeto_impuesto, tasa_iva)
      VALUES (s.pn, s.nombre, s.price, s.cost, s.stock, s.bar, 1, DATEADD(DAY, -60, GETDATE()),
              (SELECT TOP 1 id FROM dbo.CAT_categories WHERE namee = s.cat),
              (SELECT TOP 1 id FROM dbo.CAT_brands WHERE namee = s.marca),
              N'DIRECT', 1, N'pza', N'02', 0.16);
GO

/* ------------------------------------------------------- 4) CLIENTES */
MERGE dbo.customers AS d
USING (VALUES
 (N'CLI-001', N'Ana Martínez',      N'5550001001', 1500),
 (N'CLI-002', N'Carlos Herrera',    N'5550001002', 0),
 (N'CLI-003', N'Lucía Ramírez',     N'5550001003', 800),
 (N'CLI-004', N'Jorge Medina',      N'5550001004', 0),
 (N'CLI-005', N'Sofía Navarro',     N'5550001005', 1200),
 (N'CLI-006', N'Miguel Ortega',     N'5550001006', 0),
 (N'CLI-007', N'Fernanda Ruiz',     N'5550001007', 0),
 (N'CLI-008', N'Restaurante El Patio', N'5550001008', 5000),
 (N'CLI-009', N'Daniel Castro',     N'5550001009', 0),
 (N'CLI-010', N'Paola Vega',        N'5550001010', 600)
) AS s(code, nombre, tel, limite)
   ON d.code = s.code
 WHEN NOT MATCHED THEN INSERT (code, customerName, phone, credit_limit, terms_days, active)
      VALUES (s.code, s.nombre, s.tel, s.limite, CASE WHEN s.limite > 0 THEN 15 ELSE 0 END, 1);
GO

/* Las existencias de la lista se guardan y se restituyen al final: vender
   cuatro semanas no debe dejar el catalogo en cero ni frenar una venta. */
IF OBJECT_ID('tempdb..#deseado') IS NOT NULL DROP TABLE #deseado;
SELECT part_number, stock, price, cost INTO #deseado FROM dbo.products WHERE part_number LIKE N'[A-Z][A-Z][A-Z]-0%';
IF NOT EXISTS (SELECT 1 FROM dbo.sales)
    UPDATE dbo.products SET stock = 999 WHERE part_number LIKE N'[A-Z][A-Z][A-Z]-0%';
UPDATE dbo.customers SET credit_limit = 50000, terms_days = 30 WHERE code = N'CLI-008';
GO

/* ------------------------------------- 5) CUATRO SEMANAS DE VENTAS
   Un turno por dia en la Caja 1. Cada venta pasa por sp_register_sale y
   despues se le pone su fecha y hora. Los dias pasados se cierran con
   sp_close_shift; HOY se queda abierto para que Corte muestre un turno vivo.
   Idempotente: si ya hay ventas, no hace nada. */
IF NOT EXISTS (SELECT 1 FROM dbo.sales)
BEGIN
    DECLARE @u INT = (SELECT TOP 1 id FROM dbo.users ORDER BY id);
    DECLARE @hoy DATE = CAST(GETDATE() AS DATE);
    DECLARE @dias INT = 27, @d INT, @dia DATE, @n INT, @i INT, @lineas INT, @l INT;
    DECLARE @closure INT, @sale INT, @h INT, @m INT, @k INT, @pid INT, @qty INT, @pm NVARCHAR(20), @cli INT;
    DECLARE @cuando DATETIME2(0), @apertura DATETIME2(0), @cierre DATETIME2(0), @esperado DECIMAL(12,2);
    DECLARE @prods TABLE (rn INT IDENTITY(1,1), id INT, price DECIMAL(10,2), peso INT);
    INSERT @prods (id, price, peso)
      SELECT id, price, CASE WHEN part_number IN (N'BEB-001', N'BEB-003', N'LAC-001', N'PAN-002', N'BOT-001', N'DUL-003', N'LAC-006') THEN 3 ELSE 1 END
      FROM dbo.products WHERE part_number LIKE N'[A-Z][A-Z][A-Z]-0%' AND active = 1 ORDER BY part_number;
    DECLARE @np INT = (SELECT COUNT(*) FROM @prods);
    /* Una tabla "pesada" para que los productos de diario salgan mas. */
    DECLARE @bolsa TABLE (rn INT IDENTITY(1,1), id INT, price DECIMAL(10,2));
    INSERT @bolsa (id, price) SELECT p.id, p.price FROM @prods p CROSS APPLY (VALUES (1),(2),(3)) v(x) WHERE v.x <= p.peso ORDER BY p.rn, v.x;
    DECLARE @nb INT = (SELECT COUNT(*) FROM @bolsa);

    SET @d = @dias;
    WHILE @d >= 0
    BEGIN
        SET @dia = DATEADD(DAY, -@d, @hoy);
        SET @apertura = DATEADD(MINUTE, 8 * 60 + 30, CAST(@dia AS DATETIME2(0)));
        EXEC dbo.sp_open_shift @user_id = @u, @opening_cash = 500, @register_id = 1;
        SET @closure = (SELECT TOP 1 id FROM dbo.cash_closures WHERE closed_at IS NULL AND register_id = 1 ORDER BY id DESC);
        UPDATE dbo.cash_closures SET opened_at = @apertura, create_date = @dia WHERE id = @closure;
        UPDATE dbo.cash_movements SET datee = @apertura WHERE typee = 'OPENING' AND reference_id = @closure;

        /* Fines de semana venden mas; la semana mas reciente un poco mas. */
        SET @n = 16 + ABS(CHECKSUM(@d * 7919)) % 9
               + CASE WHEN DATEPART(WEEKDAY, @dia) IN (1, 7) THEN 8 ELSE 0 END
               + CASE WHEN @d < 7 THEN 4 ELSE 0 END;
        IF @d = 0 SET @n = 14;
        SET @i = 0;
        WHILE @i < @n
        BEGIN
            DECLARE @det dbo.SaleDetailType, @det2 dbo.SaleDetailType2, @mods dbo.SaleModifierType;
            DELETE FROM @det2;
            SET @lineas = 1 + ABS(CHECKSUM(@d, @i, 11)) % 4;
            SET @l = 1;
            WHILE @l <= @lineas
            BEGIN
                SET @k = 1 + ABS(CHECKSUM(@d, @i, @l, 3)) % @nb;
                SET @pid = (SELECT id FROM @bolsa WHERE rn = @k);
                SET @qty = 1 + CASE WHEN ABS(CHECKSUM(@d, @i, @l, 5)) % 5 = 0 THEN 1 ELSE 0 END;
                IF NOT EXISTS (SELECT 1 FROM @det2 WHERE product_id = @pid)
                    INSERT @det2 (line_no, product_id, quantity, unit_price)
                    SELECT @l, @pid, @qty, price FROM @bolsa WHERE rn = @k;
                SET @l += 1;
            END

            SET @k = ABS(CHECKSUM(@d, @i, 17)) % 20;
            SET @pm = CASE WHEN @k < 12 THEN N'EFECTIVO' WHEN @k < 18 THEN N'TARJETA' WHEN @k < 19 THEN N'TRANSFERENCIA' ELSE N'CREDITO' END;
            SET @cli = CASE WHEN @pm = N'CREDITO' THEN (SELECT TOP 1 id FROM dbo.customers WHERE code = N'CLI-008')
                            WHEN @k IN (3, 9) THEN (SELECT id FROM dbo.customers WHERE code = N'CLI-00' + CAST(1 + ABS(CHECKSUM(@d, @i)) % 9 AS NVARCHAR(1)))
                            ELSE NULL END;

            EXEC dbo.sp_register_sale @user_id = @u, @payment_method = @pm, @SaleDetails = @det,
                 @customer_id = @cli, @due_date = NULL, @register_id = 1,
                 @SaleDetails2 = @det2, @SaleModifiers = @mods;
            SET @sale = (SELECT MAX(id) FROM dbo.sales);

            /* De 9:00 a 20:59, repartidas en el dia. */
            SET @h = 9 + (@i * 12) / @n;
            SET @m = ABS(CHECKSUM(@d, @i, 23)) % 60;
            IF @d = 0 SET @h = 9 + (@i * 4) / @n;  -- hoy: la manana, hasta "ahora"
            SET @cuando = DATEADD(MINUTE, @h * 60 + @m, CAST(@dia AS DATETIME2(0)));
            UPDATE dbo.sales SET datee = @cuando, due_date = CASE WHEN @pm = N'CREDITO' THEN DATEADD(DAY, 15, @dia) ELSE due_date END WHERE id = @sale;
            UPDATE dbo.cash_movements SET datee = @cuando WHERE closure_id = @closure AND reference_id = @sale AND typee <> 'OPENING';
            SET @i += 1;
        END

        IF @d > 0
        BEGIN
            SET @esperado = 500 + ISNULL((SELECT SUM(p.amount) FROM dbo.sale_payments p JOIN dbo.sales s ON s.id = p.sale_id
                                          WHERE s.closure_id = @closure AND p.payment_method = N'EFECTIVO'), 0);
            EXEC dbo.sp_close_shift @user_id = @u, @cash_delivered = @esperado, @closure_id = @closure,
                 @closure_date = @dia, @register_id = 1, @cash_left = 500;
            SET @cierre = DATEADD(MINUTE, 21 * 60 + 10, CAST(@dia AS DATETIME2(0)));
            UPDATE dbo.cash_closures SET closed_at = @cierre WHERE id = @closure;
            /* La bitacora de seguridad tambien con la hora del cierre, no la de la siembra. */
            UPDATE dbo.security_events SET datee = @cierre WHERE id = (SELECT MAX(id) FROM dbo.security_events WHERE event_type = N'SHIFT_CLOSED');
            UPDATE dbo.cash_movements SET datee = @cierre WHERE closure_id = @closure AND datee > @cierre;
        END
        SET @d -= 1;
    END
END
GO

/* ------------------------------------------------------ 6) COMPRAS
   Dos proveedores (inventados; el primero es el del ticket de prueba
   scripts/pruebas/compras-documentos/tickets/mayorista.png, para que al
   subirlo Wybix lo reconozca por RFC) y ocho compras en cuatro semanas,
   con sp_register_purchase. El precio, el costo y las existencias que la
   compra recalcula se restituyen abajo con #deseado. */
MERGE dbo.CAT_suppliers AS d
USING (VALUES (N'Mayorista del Bajío', N'MBA0512153K9', N'Ventas mostrador', N'5550002001'),
              (N'Distribuidora Refresquera del Centro', N'DRC9807224A1', N'Ruta 14', N'5550002002')) AS s(nombre, rfc, contacto, tel)
   ON d.rfc = s.rfc
 WHEN NOT MATCHED THEN INSERT (nombre, rfc, contacto, telefono, activo) VALUES (s.nombre, s.rfc, s.contacto, s.tel, 1);
GO

IF NOT EXISTS (SELECT 1 FROM dbo.purchase)
BEGIN
    DECLARE @u INT = (SELECT TOP 1 id FROM dbo.users ORDER BY id);
    DECLARE @may INT = (SELECT id FROM dbo.CAT_suppliers WHERE rfc = N'MBA0512153K9');
    DECLARE @ref INT = (SELECT id FROM dbo.CAT_suppliers WHERE rfc = N'DRC9807224A1');
    DECLARE @plan TABLE (n INT, dias INT, prov INT, metodo NVARCHAR(20), pns NVARCHAR(400), qty INT);
    INSERT @plan VALUES
      (1, 26, @may, N'TRANSFERENCIA', N'ABA-001,ABA-002,ABA-003,ABA-007,LIM-001,LIM-004', 12),
      (2, 24, @ref, N'TRANSFERENCIA', N'BEB-001,BEB-002,BEB-003,BEB-004', 24),
      (3, 19, @may, N'TRANSFERENCIA', N'ABA-004,ABA-005,ABA-006,ABA-009,DUL-001,DUL-003', 20),
      (4, 17, @ref, N'TRANSFERENCIA', N'BEB-001,BEB-005,BEB-006', 24),
      (5, 12, @may, N'CREDITO',       N'LAC-001,LAC-002,LAC-006,PAN-001,PAN-002', 18),
      (6, 10, @ref, N'TRANSFERENCIA', N'BEB-001,BEB-003,BEB-007', 24),
      (7, 5,  @may, N'CREDITO',       N'BOT-001,BOT-002,BOT-003,CUI-001,CUI-003', 15),
      (8, 3,  @ref, N'TARJETA',       N'BEB-001,BEB-002,BEB-004', 24);
    DECLARE @n INT = 1, @dias INT, @prov INT, @met NVARCHAR(20), @pns NVARCHAR(400), @qty INT, @sub DECIMAL(10,2), @pid INT, @cuando DATETIME;
    WHILE @n <= 8
    BEGIN
        SELECT @dias = dias, @prov = prov, @met = metodo, @pns = pns, @qty = qty FROM @plan WHERE n = @n;
        DECLARE @d1 dbo.PurchaseDetailType, @d2 dbo.PurchaseDetailType2;
        DELETE FROM @d2;
        INSERT @d2 (product_id, quantity, unit_price, profit_percent, presentation_id)
          SELECT p.id, @qty, CAST(p.cost AS DECIMAL(10,2)), 0, NULL
          FROM STRING_SPLIT(@pns, N',') s JOIN dbo.products p ON p.part_number = s.value;
        SET @sub = (SELECT SUM(quantity * unit_price) FROM @d2);
        EXEC dbo.sp_register_purchase @user_id = @u, @supplier_id = @prov, @subtotal = @sub, @tax_rate = 0.16,
             @tax_amount = 0, @total = @sub, @PurchaseDetails = @d1, @PurchaseDetails2 = @d2,
             @payment_method = @met, @register_id = 1;
        SET @pid = (SELECT MAX(id) FROM dbo.purchase);
        SET @cuando = DATEADD(MINUTE, 10 * 60 + 15 * @n, CAST(DATEADD(DAY, -@dias, CAST(GETDATE() AS DATE)) AS DATETIME));
        UPDATE dbo.purchase SET datee = @cuando WHERE id = @pid;
        UPDATE dbo.inventory_movements SET datee = @cuando WHERE reference = CAST(@pid AS NVARCHAR(50)) AND typee = 'entrada';
        SET @n += 1;
    END
END
GO

/* Las existencias vuelven a las de la lista: Inventario muestra los bajos a
   proposito (cinco productos) y no al azar. */
UPDATE p SET stock = d.stock, price = d.price, cost = d.cost FROM dbo.products p JOIN #deseado d ON d.part_number = p.part_number;
DROP TABLE #deseado;
GO
