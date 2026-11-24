/**
 * CATÁLOGO DE PRUEBA · TIENDA DE ABARROTES: COMPRAR POR CAJA, VENDER SUELTO
 *
 * Lo que de verdad se vende por pieza en una tiendita mexicana y llega del
 * proveedor en caja, cartón, paquete, exhibidor o tira: la cerveza mediana del
 * cartón de 24, la barra de chocolate del exhibidor, el sobre de té de la caja
 * de 25, el cigarro de la cajetilla, el rollo del paquete de 4, el vaso y la
 * charola del paquete de 50, la pila del blíster, el pañal del paquete.
 *
 * Dos formas, las dos de Wybix:
 *
 *   PRESENTACIÓN  el producto es la pieza; se COMPRA en su presentación
 *                 (Cartón 24) y el inventario sube en piezas. Es lo común.
 *   SUELTO (0073) el paquete también se vende entero (la cajetilla, el paquete
 *                 de 4 rollos): son dos productos, y el suelto «cuelga» del
 *                 paquete. Vender sueltos sin piezas abre los paquetes justos.
 *
 * Cada renglón:
 *   [clave, nombre, categoría, precio de la pieza, presentación de compra,
 *    piezas por presentación, costo de la presentación (sin IVA), suelto]
 *   suelto: null, o { paquete: 'nombre del paquete', piezas, precioPaquete }
 *     (el paquete se compra en la presentación del renglón; la pieza sale de él)
 *
 * Lo usan:
 *   e2e/abarrotes.spec.js   (comprar por presentación y vender suelto)
 */
export const ABARROTES = [
  // ----------------------------------------------------------- cerveza
  ['ABA-CERV-CLARA', 'Cerveza clara mediana 355 ml', 'Cerveza', 20, 'Cartón 24', 24, 360, null],
  ['ABA-CERV-OSCURA', 'Cerveza oscura mediana 355 ml', 'Cerveza', 22, 'Cartón 24', 24, 396, null],
  ['ABA-CERV-LATA', 'Cerveza clara lata 473 ml', 'Cerveza', 25, 'Caja 24', 24, 456, null],
  ['ABA-CAGUAMA', 'Caguama clara 1.2 L', 'Cerveza', 48, 'Caja 12', 12, 456, null],
  ['ABA-CERV-MEDIA', 'Cerveza media 210 ml', 'Cerveza', 13, 'Cartón 24', 24, 228, null],
  // ----------------------------------------------------------- bebidas
  ['ABA-REF-600', 'Refresco de cola 600 ml', 'Bebidas', 20, 'Paquete 12', 12, 180, null],
  ['ABA-REF-2L', 'Refresco de cola 2 L', 'Bebidas', 38, 'Paquete 8', 8, 248, null],
  ['ABA-REF-LATA', 'Refresco de toronja lata 355 ml', 'Bebidas', 16, 'Paquete 12', 12, 144, null],
  ['ABA-AGUA-600', 'Agua natural 600 ml', 'Bebidas', 12, 'Paquete 24', 24, 168, null],
  ['ABA-JUGO-250', 'Jugo de manzana 250 ml', 'Bebidas', 12, 'Caja 27', 27, 216, null],
  ['ABA-ENERG', 'Bebida energética lata 473 ml', 'Bebidas', 32, 'Caja 24', 24, 600, null],
  ['ABA-LECHE-1L', 'Leche entera 1 L', 'Bebidas', 29, 'Caja 12', 12, 288, null],
  ['ABA-YOG-BEB', 'Yogur bebible 220 g', 'Bebidas', 14, 'Paquete 6', 6, 66, null],
  // ------------------------------------------------- dulces y botanas
  ['ABA-CHOC-BARRA', 'Chocolate con leche barra 40 g', 'Dulces', 18, 'Exhibidor 24', 24, 312, null],
  ['ABA-CHOC-CACAH', 'Chocolate con cacahuate 49 g', 'Dulces', 20, 'Exhibidor 20', 20, 300, null],
  ['ABA-CHOC-BLANCO', 'Chocolate blanco barra 40 g', 'Dulces', 18, 'Exhibidor 24', 24, 312, null],
  ['ABA-MAZAPAN', 'Mazapán de cacahuate', 'Dulces', 6, 'Caja 30', 30, 120, null],
  ['ABA-PALETA', 'Paleta de caramelo', 'Dulces', 3, 'Bolsa 50', 50, 95, null],
  ['ABA-CHICLE', 'Chicle de menta pieza', 'Dulces', 1, 'Bolsa 100', 100, 60, null],
  ['ABA-TAMARINDO', 'Dulce de tamarindo pieza', 'Dulces', 2, 'Bolsa 50', 50, 65, null],
  ['ABA-GOMITAS', 'Gomitas bolsa chica 50 g', 'Dulces', 12, 'Caja 12', 12, 102, null],
  ['ABA-PALANQUETA', 'Palanqueta de cacahuate', 'Dulces', 8, 'Bolsa 20', 20, 110, null],
  ['ABA-GALL-PAQ', 'Galletas de chocolate paquete individual', 'Botanas', 12, 'Caja 12', 12, 102, null],
  ['ABA-PASTELITO', 'Pastelito relleno de fresa', 'Botanas', 18, 'Caja 12', 12, 156, null],
  ['ABA-PAPAS-45', 'Papas fritas sal 45 g', 'Botanas', 20, 'Paquete 6', 6, 90, null],
  ['ABA-CACAH-JAP', 'Cacahuate japonés 40 g', 'Botanas', 12, 'Tira 12', 12, 96, null],
  ['ABA-PALETA-HIELO', 'Paleta helada de limón', 'Dulces', 10, 'Caja 24', 24, 168, null],
  // -------------------------------------------------- tés y cafés
  ['ABA-TE-MANZ', 'Té de manzanilla sobre', 'Tés y café', 3, 'Caja 25', 25, 45, null],
  ['ABA-TE-CANELA', 'Té de canela sobre', 'Tés y café', 3, 'Caja 25', 25, 45, null],
  ['ABA-TE-LIMON', 'Té de limón sobre', 'Tés y café', 3, 'Caja 25', 25, 45, null],
  ['ABA-TE-HIERBA', 'Té de hierbabuena sobre', 'Tés y café', 3, 'Caja 25', 25, 45, null],
  ['ABA-CAFE-SOBRE', 'Café soluble sobre 1.6 g', 'Tés y café', 4, 'Tira 20', 20, 56, null],
  ['ABA-SOPA', 'Sopa instantánea vaso 64 g', 'Abarrotes', 16, 'Caja 12', 12, 132, null],
  ['ABA-ATUN', 'Atún en agua lata 140 g', 'Abarrotes', 24, 'Caja 24', 24, 432, null],
  ['ABA-HUEVO', 'Huevo blanco pieza', 'Abarrotes', 3, 'Caja 30', 30, 66, null],
  ['ABA-SAL-SOBRE', 'Consomé de pollo cubo', 'Abarrotes', 2, 'Caja 24', 24, 30, null],
  // ------------------------------------------------- cigarros y fuego
  ['ABA-CIG-ROJO', 'Cigarro rojo suelto', 'Cigarros', 6, 'Cartón 10', 10, 800, { paquete: 'Cajetilla cigarro rojo 20', piezas: 20, precioPaquete: 95 }],
  ['ABA-CIG-MENTA', 'Cigarro mentolado suelto', 'Cigarros', 6, 'Cartón 10', 10, 820, { paquete: 'Cajetilla cigarro mentolado 20', piezas: 20, precioPaquete: 98 }],
  ['ABA-CIG-LIGHT', 'Cigarro ligero suelto', 'Cigarros', 6, 'Cartón 10', 10, 800, { paquete: 'Cajetilla cigarro ligero 20', piezas: 20, precioPaquete: 95 }],
  ['ABA-ENCENDEDOR', 'Encendedor desechable', 'Cigarros', 15, 'Exhibidor 50', 50, 400, null],
  ['ABA-CERILLOS', 'Cerillos caja chica', 'Cigarros', 3, 'Paquete 10', 10, 18, null],
  // ------------------------------------------------------ desechables
  ['ABA-VASO-8', 'Vaso desechable #8 suelto', 'Desechables', 1, 'Bulto 20', 20, 600, { paquete: 'Vasos desechables #8 paquete 50', piezas: 50, precioPaquete: 38 }],
  ['ABA-PLATO', 'Plato desechable #9 suelto', 'Desechables', 2, 'Bulto 20', 20, 700, { paquete: 'Platos desechables #9 paquete 50', piezas: 50, precioPaquete: 45 }],
  ['ABA-CHAROLA', 'Charola de unicel #66 suelta', 'Desechables', 3, 'Bulto 10', 10, 1000, { paquete: 'Charolas de unicel #66 paquete 125', piezas: 125, precioPaquete: 210 }],
  ['ABA-CUCHARA', 'Cuchara desechable suelta', 'Desechables', 1, 'Bulto 20', 20, 520, { paquete: 'Cucharas desechables paquete 50', piezas: 50, precioPaquete: 35 }],
  ['ABA-POPOTE', 'Popote suelto', 'Desechables', 1, 'Bulto 10', 10, 300, { paquete: 'Popotes paquete 100', piezas: 100, precioPaquete: 35 }],
  ['ABA-BOLSA', 'Bolsa camiseta chica', 'Desechables', 1, 'Paquete 100', 100, 45, null],
  // ------------------------------------------------ higiene y hogar
  ['ABA-PAPEL-ROLLO', 'Papel higiénico rollo suelto', 'Higiene', 10, 'Bulto 12', 12, 336, { paquete: 'Papel higiénico paquete 4 rollos', piezas: 4, precioPaquete: 36 }],
  ['ABA-PAPEL6-ROLLO', 'Papel higiénico jumbo rollo suelto', 'Higiene', 12, 'Bulto 8', 8, 384, { paquete: 'Papel higiénico jumbo paquete 6 rollos', piezas: 6, precioPaquete: 58 }],
  ['ABA-PANAL', 'Pañal etapa 4 suelto', 'Higiene', 7, 'Bulto 4', 4, 680, { paquete: 'Pañales etapa 4 paquete 40', piezas: 40, precioPaquete: 245 }],
  ['ABA-TOALLA-FEM', 'Toalla femenina suelta', 'Higiene', 5, 'Caja 24', 24, 576, { paquete: 'Toallas femeninas paquete 10', piezas: 10, precioPaquete: 38 }],
  ['ABA-SHAMPOO-SOB', 'Shampoo sobre 10 ml', 'Higiene', 4, 'Tira 12', 12, 30, null],
  ['ABA-RASTRILLO', 'Rastrillo desechable suelto', 'Higiene', 12, 'Caja 12', 12, 360, { paquete: 'Rastrillos desechables paquete 3', piezas: 3, precioPaquete: 38 }],
  ['ABA-JABON', 'Jabón de tocador 150 g', 'Higiene', 22, 'Caja 12', 12, 204, null],
  ['ABA-PASTA-SOB', 'Pasta dental sobre 22 ml', 'Higiene', 8, 'Tira 12', 12, 60, null],
  ['ABA-DETERG-250', 'Detergente en polvo bolsa 250 g', 'Limpieza', 14, 'Caja 24', 24, 264, null],
  ['ABA-CLORO-500', 'Cloro 500 ml', 'Limpieza', 12, 'Caja 15', 15, 135, null],
  ['ABA-SUAV-SOB', 'Suavizante sobre 80 ml', 'Limpieza', 5, 'Tira 12', 12, 42, null],
  ['ABA-VELADORA', 'Veladora de vaso', 'Hogar', 22, 'Caja 12', 12, 192, null],
  ['ABA-PILA-AA', 'Pila AA suelta', 'Hogar', 15, 'Caja 12', 12, 384, { paquete: 'Pilas AA blíster 4', piezas: 4, precioPaquete: 52 }],
  ['ABA-ASPIRINA', 'Ácido acetilsalicílico sobre 2 tabletas', 'Farmacia', 5, 'Caja 50', 50, 150, null],
  ['ABA-ANTIACIDO', 'Antiácido sobre efervescente', 'Farmacia', 8, 'Caja 50', 50, 260, null],
];

/**
 * UN PRODUCTO, MUCHAS PRESENTACIONES (0089): la pieza se vende sola y en
 * varios paquetes, cada uno a su precio, y el inventario se lleva en piezas.
 * El rollo de papel en paquete de 4, 6, 12 y 18; la lata en six, doce y caja;
 * el huevo en docena, media reja y reja; el pañal en paquete de 10, 20 y 40.
 *
 * Cada renglón:
 *   [clave, nombre, categoría, precio de la pieza,
 *    [presentación de compra, piezas, costo sin IVA],
 *    [[presentación de venta, piezas, precio], …]]
 */
export const PRESENTACIONES = [
  ['ABA-MP-PAPEL', 'Papel higiénico rollo doble hoja', 'Higiene', 10, ['Bulto 48', 48, 336],
    [['Paquete 4', 4, 36], ['Paquete 6', 6, 52], ['Paquete 12', 12, 98], ['Paquete 18', 18, 150]]],
  ['ABA-MP-REFRESCO', 'Refresco de cola lata 355 ml', 'Bebidas', 16, ['Caja 24', 24, 288],
    [['Six 6', 6, 90], ['Doce 12', 12, 175], ['Caja 24 completa', 24, 340]]],
  ['ABA-MP-CERVEZA', 'Cerveza clara lata 355 ml', 'Cerveza', 22, ['Caja 24', 24, 444],
    [['Six 6', 6, 135], ['Doce 12', 12, 265], ['Caja 24 completa', 24, 525]]],
  ['ABA-MP-HUEVO', 'Huevo rojo pieza', 'Abarrotes', 3.5, ['Caja 360', 360, 900],
    [['Docena', 12, 40], ['Media reja 15', 15, 50], ['Reja 30', 30, 95]]],
  ['ABA-MP-AGUA', 'Agua natural 1 L botella', 'Bebidas', 14, ['Paquete 12', 12, 120],
    [['Six 6', 6, 78], ['Paquete 12 completo', 12, 150]]],
  ['ABA-MP-PANAL', 'Pañal etapa 3 pieza', 'Higiene', 7, ['Bulto 160', 160, 800],
    [['Paquete 10', 10, 65], ['Paquete 20', 20, 125], ['Paquete 40', 40, 240]]],
  ['ABA-MP-PILA', 'Pila AAA', 'Hogar', 14, ['Caja 48', 48, 384],
    [['Blíster 2', 2, 26], ['Blíster 4', 4, 50]]],
  ['ABA-MP-VASO', 'Vaso desechable #10', 'Desechables', 1, ['Bulto 1000', 1000, 450],
    [['Paquete 25', 25, 22], ['Paquete 50', 50, 40], ['Paquete 100', 100, 75]]],
];

/** Lo que sale del catálogo: cuántos productos, cuántos sueltos de paquete. */
export const RESUMEN = {
  productos: ABARROTES.length + PRESENTACIONES.length,
  sueltosDePaquete: ABARROTES.filter((r) => r[7]).length,
  conVariasPresentaciones: PRESENTACIONES.length,
  presentacionesDeVenta: PRESENTACIONES.reduce((a, r) => a + r[5].length, 0),
};

/**
 * SQL que deja la tienda en una base de PRUEBA (idempotente: ABA-…):
 *   · cada pieza, sin existencia, con su presentación de compra predeterminada
 *   · cada paquete de los sueltos (ABA-…-PAQ), comprado en la presentación del
 *     renglón y ligado a su suelto en venta_suelta
 *   · el proveedor «Abarrotera del Centro», predeterminado de todos
 * Las existencias llegan con la COMPRA de la prueba, no con este SQL.
 */
export function sqlSembrar() {
  const q = (s) => String(s).replace(/'/g, "''");
  const filas = [];
  for (const [pn, nombre, cat, precio, pres, factor, costoPres, suelto] of ABARROTES) {
    if (suelto) {
      /* La pieza cuelga del paquete: se compra el PAQUETE, por presentación. */
      filas.push(`(N'${pn}-PAQ', N'${q(suelto.paquete)}', N'${q(cat)}', ${suelto.precioPaquete}, N'${q(pres)}', ${factor}, ${costoPres / factor}, NULL, 0)`);
      filas.push(`(N'${pn}', N'${q(nombre)}', N'${q(cat)}', ${precio}, NULL, NULL, ${costoPres / factor / suelto.piezas}, N'${pn}-PAQ', ${suelto.piezas})`);
    } else {
      filas.push(`(N'${pn}', N'${q(nombre)}', N'${q(cat)}', ${precio}, N'${q(pres)}', ${factor}, ${costoPres / factor}, NULL, 0)`);
    }
  }
  for (const [pn, nombre, cat, precio, [pres, factor, costoPres]] of PRESENTACIONES) {
    filas.push(`(N'${pn}', N'${q(nombre)}', N'${q(cat)}', ${precio}, N'${q(pres)}', ${factor}, ${costoPres / factor}, NULL, 0)`);
  }
  const ventas = PRESENTACIONES.flatMap(([pn, , , , , vs]) => vs.map(([n, f, precio]) => `(N'${pn}', N'${q(n)}', ${f}, ${precio})`));
  const cats = [...new Set([...ABARROTES, ...PRESENTACIONES].map((r) => r[2]))];
  return `
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_brands WHERE namee = N'Abarrotes') INSERT INTO dbo.CAT_brands (namee) VALUES (N'Abarrotes');
    ${cats.map((c) => `IF NOT EXISTS (SELECT 1 FROM dbo.CAT_categories WHERE namee = N'${q(c)}') INSERT INTO dbo.CAT_categories (namee) VALUES (N'${q(c)}');`).join('\n')}
    DECLARE @b INT = (SELECT id FROM dbo.CAT_brands WHERE namee = N'Abarrotes');
    DECLARE @f TABLE (pn NVARCHAR(40), nombre NVARCHAR(100), cat NVARCHAR(100), price DECIMAL(10,2), pres NVARCHAR(60), factor INT, cost DECIMAL(14,4), padre NVARCHAR(40), piezas INT);
    INSERT INTO @f VALUES ${filas.join(',\n')};
    INSERT INTO dbo.products (part_number, nombre, price, stock, active, sellable, inventory_mode, category_id, brand_id, cost, objeto_impuesto, tasa_iva, registrated_date, bar_code, base_uom)
      SELECT f.pn, f.nombre, f.price, 0, 1, 1, 'DIRECT', c.id, @b, f.cost, '02', 0.16, GETDATE(), NULL, 'pza'
        FROM @f f JOIN dbo.CAT_categories c ON c.namee = f.cat
       WHERE NOT EXISTS (SELECT 1 FROM dbo.products p WHERE p.part_number = f.pn);
    UPDATE p SET p.price = f.price, p.cost = f.cost, p.stock = 0, p.active = 1, p.base_uom = 'pza'
      FROM dbo.products p JOIN @f f ON f.pn = p.part_number;

    INSERT INTO dbo.product_presentations (product_id, name, factor_to_base, is_default, active)
      SELECT p.id, f.pres, f.factor, 1, 1 FROM @f f JOIN dbo.products p ON p.part_number = f.pn
       WHERE f.pres IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.product_presentations x WHERE x.product_id = p.id AND x.name = f.pres);

    /* Las presentaciones que se VENDEN (0089): sin código, con su precio. */
    DECLARE @v TABLE (pn NVARCHAR(40), nombre NVARCHAR(60), factor INT, precio DECIMAL(10,2));
    INSERT INTO @v VALUES ${ventas.join(',\n')};
    INSERT INTO dbo.product_presentations (product_id, name, factor_to_base, is_default, active, sale_price)
      SELECT p.id, v.nombre, v.factor, 0, 1, v.precio FROM @v v JOIN dbo.products p ON p.part_number = v.pn
       WHERE NOT EXISTS (SELECT 1 FROM dbo.product_presentations x WHERE x.product_id = p.id AND x.name = v.nombre);
    UPDATE x SET x.sale_price = v.precio, x.active = 1
      FROM dbo.product_presentations x JOIN dbo.products p ON p.id = x.product_id JOIN @v v ON v.pn = p.part_number AND v.nombre = x.name;

    IF NOT EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'venta-suelta')
      EXEC dbo.sp_set_business_module @module_key = N'venta-suelta', @enabled = 1;
    ELSE UPDATE dbo.business_modules SET enabled = 1 WHERE module_key = N'venta-suelta';
    MERGE dbo.venta_suelta AS t
    USING (SELECT s.id AS product_id, pq.id AS parent_product_id, f.piezas
             FROM @f f JOIN dbo.products s ON s.part_number = f.pn JOIN dbo.products pq ON pq.part_number = f.padre
            WHERE f.padre IS NOT NULL) AS x
       ON t.product_id = x.product_id
     WHEN MATCHED THEN UPDATE SET parent_product_id = x.parent_product_id, piezas = x.piezas
     WHEN NOT MATCHED THEN INSERT (product_id, parent_product_id, piezas) VALUES (x.product_id, x.parent_product_id, x.piezas);

    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_suppliers WHERE nombre = N'Abarrotera del Centro')
      INSERT INTO dbo.CAT_suppliers (nombre, telefono, activo) VALUES (N'Abarrotera del Centro', N'3339876543', 1);
    DECLARE @s INT = (SELECT id FROM dbo.CAT_suppliers WHERE nombre = N'Abarrotera del Centro');
    INSERT INTO dbo.product_suppliers (product_id, supplier_id, is_default, active)
      SELECT p.id, @s, 1, 1 FROM @f f JOIN dbo.products p ON p.part_number = f.pn
       WHERE f.pres IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.product_suppliers x WHERE x.product_id = p.id);

    SELECT p.id, p.part_number, p.nombre, CAST(p.price AS FLOAT) AS price,
           pp.id AS presentation_id, pp.name AS presentation, CAST(pp.factor_to_base AS FLOAT) AS factor, @s AS supplier_id
      FROM @f f JOIN dbo.products p ON p.part_number = f.pn
      LEFT JOIN dbo.product_presentations pp ON pp.product_id = p.id AND pp.name = f.pres;`;
}
