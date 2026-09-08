/**
 * Utilidades minimas para las pruebas funcionales de SQL.
 *
 * Todas las pruebas corren contra una base TEMPORAL (Wybix_MigTest, que deja
 * `npm run db:test-migration -- --conservar`). `consultarTemporal` se niega a
 * tocar cualquier otra base, asi que una prueba no puede escribir en una base
 * de trabajo ni por error.
 */
import { consultarTemporal } from '../lib/temporal-consulta.mjs';

export const DB = process.env.WYBIX_TEST_DB || 'Wybix_MigTest';

let fallos = 0;
let pasos = 0;

export function q(sql) {
  const r = consultarTemporal(DB, sql);
  if (!r.ok) throw new Error(limpiar(r.error));
  return r.sets;
}

/** Ejecuta y devuelve el primer resultado (filas). */
export function rows(sql) {
  const s = q(sql);
  return s.length ? s[0] : [];
}

export function row(sql) {
  return rows(sql)[0] ?? null;
}

export function scalar(sql) {
  const r = row(sql);
  if (!r) return null;
  const k = Object.keys(r)[0];
  return r[k];
}

/** Ejecuta esperando un error cuyo mensaje contenga `frag`. */
export function fails(sql, frag) {
  const r = consultarTemporal(DB, sql);
  if (r.ok) return { ok: false, error: null };
  const msg = limpiar(r.error);
  return { ok: frag ? msg.includes(frag) : true, error: msg };
}

export function limpiar(msg) {
  // PowerShell parte el mensaje en lineas de ~120 caracteres y anade la
  // traza del script: se pega todo y se corta antes de la traza.
  let t = String(msg || '').replace(/\r?\n\s*/g, ' ');
  const i = t.indexOf('En C:');
  if (i > 0) t = t.slice(0, i);
  return t
    .replace(/Excepci.n al llamar a "\w+" con los argumentos "\d+": /g, '')
    .replace(/^\s*"|"\s*$/g, '')
    // PowerShell parte a mitad de frase y deja dos espacios donde habia uno:
    // "inventario \r\ndirecto" -> "inventario  directo". Sin colapsar, un
    // fragmento buscado con un solo espacio nunca coincide.
    .replace(/\s+/g, ' ')
    .trim();
}

export function check(cond, titulo, detalle) {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '\n            ' + detalle : ''}`); }
}

export function seccion(t) { console.log(`\n── ${t}`); }

export function resumen() {
  console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S) de ${pasos}` : `\nRESULTADO: OK (${pasos} comprobaciones)`);
  process.exit(fallos ? 1 : 0);
}

/** Numero con tolerancia decimal. */
export const cerca = (a, b, eps = 0.0001) => Math.abs(Number(a) - Number(b)) < eps;

/**
 * Datos base de un cafe de mostrador. Idempotente por part_number: se puede
 * correr varias veces sobre la misma base temporal.
 */
export function fixtureCafe() {
  q(`
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_categories WHERE namee = N'Bebidas') INSERT INTO dbo.CAT_categories (namee) VALUES (N'Bebidas');
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_categories WHERE namee = N'Ingredientes') INSERT INTO dbo.CAT_categories (namee) VALUES (N'Ingredientes');
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_brands WHERE namee = N'SIN MARCA') INSERT INTO dbo.CAT_brands (namee) VALUES (N'SIN MARCA');
    IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE usuario = N'tester')
      INSERT INTO dbo.users (usuario, password_hash, rol, active, creation_date)
      VALUES (N'tester', CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256', N'secret123'), 2), N'admin', 1, GETDATE());
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_suppliers WHERE nombre = N'Proveedor Test') INSERT INTO dbo.CAT_suppliers (nombre) VALUES (N'Proveedor Test');
  `);
  const cat = scalar(`SELECT id FROM dbo.CAT_categories WHERE namee = N'Bebidas'`);
  const catIng = scalar(`SELECT id FROM dbo.CAT_categories WHERE namee = N'Ingredientes'`);
  const brand = scalar(`SELECT id FROM dbo.CAT_brands WHERE namee = N'SIN MARCA'`);
  const userId = scalar(`SELECT id FROM dbo.users WHERE usuario = N'tester'`);
  const supplierId = scalar(`SELECT id FROM dbo.CAT_suppliers WHERE nombre = N'Proveedor Test'`);

  const prod = (part, name, opts) => {
    const existing = scalar(`SELECT id FROM dbo.products WHERE part_number = N'${part}'`);
    if (existing) return existing;
    const o = { price: 0, stock: 0, mode: 'DIRECT', sellable: 1, uom: 'pza', cost: 'NULL', category: catIng, decimal: 0, ...opts };
    return scalar(`
      EXEC dbo.sp_add_product @brand=${brand}, @part_number=N'${part}', @name=N'${name}', @price=${o.price},
        @stock=${o.stock}, @category=${o.category}, @inventory_mode='${o.mode}', @sellable=${o.sellable},
        @base_uom='${o.uom}', @allow_decimal_qty=${o.decimal}, @cost=${o.cost};`);
  };

  const ids = {
    userId, supplierId, cat, catIng, brand,
    cafe:   prod('ING-CAFE',  'Cafe molido',   { uom: 'g',   stock: 1000, cost: 0.30, sellable: 0, decimal: 1 }),
    leche:  prod('ING-LECHE', 'Leche entera',  { uom: 'ml',  stock: 5000, cost: 0.02, sellable: 0, decimal: 1 }),
    almendra: prod('ING-ALM', 'Leche de almendra', { uom: 'ml', stock: 2000, cost: 0.06, sellable: 0, decimal: 1 }),
    azucar: prod('ING-AZU',   'Azucar',        { uom: 'g',   stock: 500,  cost: 0.02, sellable: 0, decimal: 1 }),
    vaso:   prod('ING-VASO',  'Vaso 12oz',     { uom: 'pza', stock: 100,  cost: 1.50, sellable: 0 }),
    tapa:   prod('ING-TAPA',  'Tapa 12oz',     { uom: 'pza', stock: 100,  cost: 0.50, sellable: 0 }),
    latte:  prod('BEB-LATTE', 'Latte',         { mode: 'RECIPE', price: 55, category: cat }),
    americano: prod('BEB-AMER', 'Americano',   { mode: 'RECIPE', price: 35, category: cat }),
    coca:   prod('DIR-COCA',  'Coca Cola 600', { uom: 'pza', stock: 24, price: 20, cost: 12, category: cat }),
    servicio: prod('SRV-ENV', 'Servicio a domicilio', { mode: 'NONE', price: 30, category: cat }),
  };
  return ids;
}
