/**
 * Socios y Propinas (0079).
 *
 *     node scripts/db/pruebas/socios.mjs [--conservar] [--hasta=10]
 *
 * QUE COMPRUEBA
 * -------------
 * El MISMO escenario con 2, 3, 4 ... hasta 10 socios (el maximo). Cada vuelta
 * vive en su propio dia (de hace 12 dias hacia hoy), asi que sus numeros no
 * se mezclan con los de la vuelta anterior y cada una se puede liquidar.
 *
 * En cada vuelta:
 *   · el ejemplo del documento (sandwich de $80, insumos $40: Leo $30 y
 *     David $10) con la regla C al 30 %, y despues A y B en ventas nuevas,
 *     sin tocar lo ya repartido (congelado);
 *   · un producto con un insumo de CADA socio, calculado aparte en JS;
 *   · reventa de cada socio, una categoria compartida entre todos, productos
 *     sin dueno, un producto con dueno propio 60/40 y un combo (sus
 *     componentes llegan como renglones con el precio prorrateado);
 *   · que cada renglon reparte EXACTAMENTE su ingreso, y una devolucion;
 *   · gastos de un socio, divididos, comunes (iguales, % fijo y por ventas) y
 *     uno que pago un socio de su bolsa;
 *   · anticipos: compra de contado con dinero del negocio y otra que pago un
 *     socio de su bolsa;
 *   · retiro en efectivo (sale del cajon) y aportacion;
 *   · que la suma de los resultados de todos es el dinero del negocio sin
 *     repartir, calculado aparte;
 *   · liquidar el dia: lo mismo que el resumen, y no se liquida dos veces.
 *
 * Despues: limites (1 y 11 socios, nombres, porcentajes), faltante de un
 * corte y Propinas (por quien atendio, por horas y partes iguales; comision;
 * pago desde el cajon).
 *
 * Corre sobre una restauracion del baseline, no sobre ninguna base de trabajo.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { restaurar, eliminar } from '../lib/temporal.mjs';
import { consultarTemporal } from '../lib/temporal-consulta.mjs';
import { limpiar } from './lib.mjs';

const BAK = join('installer', 'template.bak');
const DIR_MIG = join('electron', 'migrations');
const DB = 'Wybix_TmpSocios';
const CONSERVAR = process.argv.includes('--conservar');
const MAX = Number((process.argv.find(a => a.startsWith('--hasta=')) ?? '--hasta=10').split('=')[1]);

let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);
const todo = (sql) => {
  const r = consultarTemporal(DB, sql);
  if (!r.ok) throw new Error(limpiar(r.error));
  return r.sets;
};
const q = (sql) => { const s = todo(sql); return s.length ? s[0] : []; };
const uno = (sql) => q(sql)[0] ?? null;
const escalar = (sql) => { const f = uno(sql); return f ? f[Object.keys(f)[0]] : null; };
const falla = (sql, frag) => {
  const r = consultarTemporal(DB, sql);
  if (r.ok) return { ok: false, error: '(no fallo)' };
  const msg = limpiar(r.error);
  return { ok: frag ? msg.includes(frag) : true, error: msg };
};
const n = (v) => Number(v ?? 0);
const cerca = (a, b, tol = 0.0002) => Math.abs(n(a) - n(b)) <= tol;
const json = (v) => JSON.stringify(v).replace(/'/g, "''");
const p2 = (x) => String(x).padStart(2, '0');
const isoDia = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const HOY = new Date();
const diaDe = (atras) => { const d = new Date(HOY); d.setDate(d.getDate() - atras); return isoDia(d); };

/**
 * El reparto esperado de un renglon, calculado aparte (docs/socios.md 1.3).
 * vende: Map socio -> fraccion; costos: Map socio -> costo; k: pct_vende/100.
 */
function esperado(R, vende, costos, k) {
  const ctot = [...costos.values()].reduce((a, b) => a + b, 0);
  const P = R - ctot;
  const socios = new Set([...vende.keys(), ...costos.keys()]);
  const out = new Map();
  for (const s of socios) {
    const v = vende.get(s) ?? 0, c = costos.get(s) ?? 0;
    const a = ctot > 0 ? c / ctot : v;
    const g = P * (k * v + (1 - k) * a);
    out.set(s, { costo: c, ganancia: g, total: c + g, ingreso: R * v });
  }
  return out;
}

try {
  console.log(`\nSOCIOS Y PROPINAS   (${DB}, de 2 a ${MAX} socios)`);
  if (!existsSync(BAK)) {
    console.log(`   ----   falta ${BAK}: es un artefacto derivado (npm run db:baseline).`);
    process.exit(0);
  }
  restaurar(DB, BAK);
  const aplicadas = new Set(q('SELECT filename FROM dbo.schema_migrations;').map(r => r.filename));
  for (const f of readdirSync(DIR_MIG, { withFileTypes: true })
      .filter(d => d.isFile() && d.name.toLowerCase().endsWith('.sql'))
      .map(d => d.name).sort((a, b) => a.localeCompare(b, 'en'))
      .filter(f => !aplicadas.has(f))) {
    // MISMA regla que electron/migrationsRunner.js.
    for (const lote of readFileSync(join(DIR_MIG, f), 'utf8')
        .replace(/\r\n/g, '\n').split(/\n\s*GO\s*\n/gi)) {
      if (lote.trim()) q(lote);
    }
    q(`INSERT INTO dbo.schema_migrations (filename) VALUES (N'${f}');`);
  }

  // ------------------------------------------------------------- base comun
  const USER = n(escalar(`INSERT INTO dbo.users (usuario, password_hash, rol, active)
    VALUES (N'qa.socios', N'x', N'admin', 1); SELECT CAST(SCOPE_IDENTITY() AS INT) AS id;`));
  const BRAND = n(escalar(`INSERT INTO dbo.CAT_brands (namee) VALUES (N'QA'); SELECT CAST(SCOPE_IDENTITY() AS INT);`));
  const PROV = n(escalar(`INSERT INTO dbo.CAT_suppliers (nombre) VALUES (N'Proveedor QA'); SELECT CAST(SCOPE_IDENTITY() AS INT);`));
  const GASTO = n(escalar(`SELECT TOP 1 id FROM dbo.expense_categories WHERE kind = 'GENERAL' AND active = 1 ORDER BY id;`));
  q(`EXEC dbo.sp_open_shift @user_id=${USER}, @opening_cash=5000, @register_id=1;`);

  const categoria = (nombre) => n(escalar(`INSERT INTO dbo.CAT_categories (namee) VALUES (N'${nombre}');
    SELECT CAST(SCOPE_IDENTITY() AS INT);`));
  const alta = (o) => n(escalar(`
    EXEC dbo.sp_add_product @brand=${BRAND}, @part_number=N'${o.pn}', @name=N'${o.name}',
      @price=${o.price ?? 0}, @stock=${o.stock ?? 0}, @category=${o.cat},
      @inventory_mode='${o.mode ?? 'DIRECT'}', @sellable=${o.sellable ?? 1},
      @base_uom='pza', @allow_decimal_qty=0, @cost=${o.cost ?? 'NULL'};`));
  const receta = (prod, lineas) => q(`
    DECLARE @l dbo.RecipeLineType;
    INSERT INTO @l (ingredient_product_id, input_qty, input_uom, waste_pct, sort_order) VALUES
      ${lineas.map((l, i) => `(${l.ing}, ${l.qty}, 'pza', 0, ${i + 1})`).join(', ')};
    EXEC dbo.sp_save_recipe @product_id=${prod}, @variant_option_id=NULL, @Lines=@l;`);
  /** Venta por el mismo procedimiento que la caja. Devuelve el id. */
  const vender = (lineas, user = USER) => n(uno(`
    DECLARE @d1 dbo.SaleDetailType; DECLARE @d2 dbo.SaleDetailType2; DECLARE @mo dbo.SaleModifierType;
    INSERT INTO @d2 (line_no, product_id, quantity, unit_price) VALUES
      ${lineas.map((l, i) => `(${i + 1}, ${l.p}, ${l.q}, ${l.precio})`).join(', ')};
    EXEC dbo.sp_register_sale @user_id=${user}, @payment_method=N'EFECTIVO', @SaleDetails=@d1,
      @register_id=1, @SaleDetails2=@d2, @SaleModifiers=@mo;`).sale_id);
  const repartoDe = (sale) => q(`
    SELECT x.sale_detail_id, d.product_id, d.quantity * d.unitary_price AS r, x.socio_id, x.ingreso, x.costo, x.ganancia, x.total
      FROM dbo.socios_reparto x JOIN dbo.sale_detail d ON d.id = x.sale_detail_id
     WHERE x.sale_id = ${sale} AND x.origen = 'VENTA';`);
  const limpiarSocios = () => q(`
    DELETE FROM dbo.socios_liquidacion_lineas; DELETE FROM dbo.socios_liquidaciones;
    DELETE FROM dbo.socios_reparto; DELETE FROM dbo.socios_gasto_lineas; DELETE FROM dbo.socios_gasto;
    DELETE FROM dbo.socios_compra; DELETE FROM dbo.socios_movimientos; DELETE FROM dbo.socios_duenos;
    DELETE FROM dbo.socios_config; DELETE FROM dbo.socios;`);

  // ===================================================================
  for (let N = 2; N <= MAX; N++) {
    const DIA = diaDe(14 - N);
    seccion(`${N} SOCIOS   (dia ${DIA})`);
    limpiarSocios();

    // Categorias: una por socio, una compartida entre todos, una sin dueno.
    const cat = Array.from({ length: N }, (_, i) => categoria(`R${N} Socio ${i + 1}`));
    const catComp = categoria(`R${N} Compartida`);
    const catLibre = categoria(`R${N} Libre`);
    const claves = Array.from({ length: N }, (_, i) => `s${i + 1}`);
    const nombres = claves.map((_, i) => i === 0 ? `David ${N}` : i === 1 ? `Leo ${N}` : `Socio ${i + 1} R${N}`);
    const pctIgual = Math.floor(10000 / N) / 100;
    const compartida = claves.map((c, i) => ({ socio: c, pct: i === 0 ? +(100 - pctIgual * (N - 1)).toFixed(2) : pctIgual }));
    const config = (o = {}) => ({
      regla: 'C', pctVende: 30, gastoRegla: 'IGUALES', faltanteRegla: 'VENTAS', sinDueno: null,
      liquidacion: 'SEMANAL', diaCierre: 7, inicio: DIA,
      socios: claves.map((c, i) => ({ clave: c, id: o.ids?.[i], nombre: nombres[i], userId: null,
        pctFijo: i === 0 ? 100 - 10 * (N - 1) : 10, activo: true })),
      categorias: [
        ...cat.map((id, i) => ({ categoriaId: id, duenos: [{ socio: claves[i], pct: 100 }] })),
        { categoriaId: catComp, duenos: compartida },
      ],
      ...o,
    });
    const guardar = (o = {}, activar = 0) => todo(`EXEC dbo.sp_socios_config_guardar @json=N'${json(config(o))}', @activar=${activar}, @user_id=${USER};`);
    const sets = guardar({}, 1);
    const socios = sets[1];
    const S = claves.map((_, i) => n(socios.find(s => s.nombre === nombres[i])?.id));
    check(S.every(id => id > 0) && socios.filter(s => s.activo).length === N,
      `activar crea los ${N} socios y enciende el modulo`,
      `modulo ${escalar(`SELECT enabled FROM dbo.business_modules WHERE module_key = N'socios'`)}`);
    const ids = S;

    // Insumos: uno por socio (cuesta 5k), y el pan de Leo y el jamon de David.
    const ing = cat.map((c, i) => alta({ pn: `R${N}-ING${i + 1}`, name: `Insumo ${i + 1} R${N}`, cat: c, cost: 5 * (i + 1), stock: 10000, sellable: 0 }));
    const pan = alta({ pn: `R${N}-PAN`, name: `Pan R${N}`, cat: cat[1], cost: 30, stock: 10000, sellable: 0 });
    const jamon = alta({ pn: `R${N}-JAMON`, name: `Jamon R${N}`, cat: cat[0], cost: 10, stock: 10000, sellable: 0 });

    const sandwich = alta({ pn: `R${N}-SAND`, name: `Sandwich R${N}`, cat: cat[0], price: 80, mode: 'RECIPE' });
    receta(sandwich, [{ ing: pan, qty: 1 }, { ing: jamon, qty: 1 }]);
    const precioMix = 20 * N + 7;
    const mix = alta({ pn: `R${N}-MIX`, name: `Mix R${N}`, cat: cat[N - 1], price: precioMix, mode: 'RECIPE' });
    receta(mix, ing.map(i => ({ ing: i, qty: 1 })));
    const rev = cat.map((c, i) => alta({ pn: `R${N}-REV${i + 1}`, name: `Reventa ${i + 1} R${N}`, cat: c, price: 10, cost: 4, stock: 500 }));
    const comp = alta({ pn: `R${N}-COMP`, name: `Compartido R${N}`, cat: catComp, price: 15, cost: 6, stock: 500 });
    const libre = alta({ pn: `R${N}-LIBRE`, name: `Libre R${N}`, cat: catLibre, price: 5, cost: 2, stock: 500 });
    const propio = alta({ pn: `R${N}-PROPIO`, name: `Propio R${N}`, cat: cat[0], price: 20, cost: 8, stock: 500 });
    const frappe = alta({ pn: `R${N}-FRAPPE`, name: `Frappe R${N}`, cat: cat[1], price: 60, cost: 12, stock: 500 });

    const res = todo(`EXEC dbo.sp_socios_producto_dueno @product_id=${propio},
      @duenos=N'${json([{ socioId: S[0], pct: 60 }, { socioId: S[1], pct: 40 }])}';`)[0];
    check(res.length === 2 && res.every(r => r.origen === 'PRODUCTO') && cerca(res.find(r => n(r.socio_id) === S[0])?.pct, 60),
      'un producto con dueno propio 60/40 gana sobre su categoria');
    const sinDueno = q(`EXEC dbo.sp_socios_producto_dueno @product_id=${libre}, @guardar=0;`);
    check(sinDueno.length === N && sinDueno.every(r => r.origen === 'SIN_DUENO'),
      'un producto sin dueno queda en partes iguales', `${sinDueno.length} socios`);

    // Lo que se espera de cada producto, aparte.
    const share = (pares) => new Map(pares);
    const vendeDe = new Map([
      [sandwich, share([[S[0], 1]])], [mix, share([[S[N - 1], 1]])],
      ...rev.map((p, i) => [p, share([[S[i], 1]])]),
      [comp, share(compartida.map((c, i) => [S[i], c.pct / 100]))],
      [libre, share(S.map(s => [s, 1 / N]))],
      [propio, share([[S[0], 0.6], [S[1], 0.4]])],
      [frappe, share([[S[1], 1]])],
    ]);
    const costoUnit = new Map([
      [sandwich, share([[S[1], 30], [S[0], 10]])],
      [mix, share(S.map((s, i) => [s, 5 * (i + 1)]))],
      ...rev.map((p) => [p, null]), [comp, null], [libre, null], [propio, null], [frappe, null],
    ]);
    const costoProducto = new Map([...rev.map(p => [p, 4]), [comp, 6], [libre, 2], [propio, 8], [frappe, 12]]);
    const esperadoLinea = (prod, qty, precio, k) => {
      const R = qty * precio;
      const v = vendeDe.get(prod);
      let c = costoUnit.get(prod);
      if (c) c = new Map([...c].map(([s, x]) => [s, x * qty]));
      else c = new Map([...v].map(([s, f]) => [s, costoProducto.get(prod) * qty * f]));
      return esperado(R, v, c, k);
    };
    const revisar = (sale, k, titulo) => {
      const filas = repartoDe(sale);
      const porLinea = new Map();
      for (const f of filas) {
        const l = porLinea.get(n(f.sale_detail_id)) ?? { prod: n(f.product_id), r: n(f.r), filas: [] };
        l.filas.push(f); porLinea.set(n(f.sale_detail_id), l);
      }
      const det = q(`SELECT id, product_id, quantity, unitary_price FROM dbo.sale_detail WHERE sale_id = ${sale};`);
      let bien = porLinea.size === det.length, exacto = true, peor = '';
      for (const d of det) {
        const l = porLinea.get(n(d.id));
        if (!l) { bien = false; peor = `renglon ${d.id} sin reparto`; continue; }
        const suma = l.filas.reduce((a, f) => a + n(f.total), 0);
        if (Math.abs(suma - l.r) > 0.00005) { exacto = false; peor = `renglon ${d.id}: ${suma} de ${l.r}`; }
        const e = esperadoLinea(n(d.product_id), n(d.quantity), n(d.unitary_price), k);
        for (const [s, x] of e) {
          const f = l.filas.find(y => n(y.socio_id) === s);
          if (!f && Math.abs(x.total) < 0.0001) continue;
          if (!f || !cerca(f.costo, x.costo) || !cerca(f.total, x.total, 0.0006)) {
            bien = false; peor = `renglon ${d.id} socio ${s}: ${f ? `${n(f.costo)}+${n(f.ganancia)}` : 'falta'} vs ${x.costo.toFixed(4)}+${x.ganancia.toFixed(4)}`;
          }
        }
      }
      check(exacto, `${titulo}: cada renglon reparte exactamente su ingreso`, peor);
      check(bien, `${titulo}: lo de cada socio es lo calculado aparte`, peor);
      return filas;
    };
    const fechar = (sale) => q(`UPDATE dbo.sales SET datee = DATEADD(DAY, DATEDIFF(DAY, datee, '${DIA}'), datee) WHERE id = ${sale};`);

    // ---------------------------------------------------------- ventas
    const v1 = vender([{ p: sandwich, q: 1, precio: 80 }]);
    const v2 = vender([{ p: mix, q: 2, precio: precioMix }]);
    const v3 = vender([...rev.map(p => ({ p, q: 1, precio: 10 })), { p: comp, q: 3, precio: 15 },
      { p: libre, q: 2, precio: 5 }, { p: propio, q: 1, precio: 20 }]);
    const v4 = vender([{ p: sandwich, q: 1, precio: 68.57 }, { p: frappe, q: 1, precio: 51.43 }]);
    [v1, v2, v3, v4].forEach(fechar);
    q(`EXEC dbo.sp_socios_asignar;`);

    const f1 = revisar(v1, 0.3, 'C 30 %');
    const david = f1.find(f => n(f.socio_id) === S[0]), leo = f1.find(f => n(f.socio_id) === S[1]);
    check(cerca(david?.total, 29) && cerca(leo?.total, 51) && cerca(david?.costo, 10) && cerca(leo?.costo, 30),
      'el ejemplo del documento: David $29 (10 + 19), Leo $51 (30 + 21)', `${n(david?.total)} / ${n(leo?.total)}`);
    revisar(v2, 0.3, `insumo de cada uno de los ${N}`);
    revisar(v3, 0.3, 'reventa, compartido, sin dueno y dueno propio');
    revisar(v4, 0.3, 'combo sandwich + frappe');

    // A y B: ventas nuevas; lo de antes no se mueve.
    const antes = JSON.stringify(repartoDe(v1).map(f => [f.socio_id, f.costo, f.ganancia]));
    guardar({ ids, regla: 'A' });
    const va = vender([{ p: sandwich, q: 1, precio: 80 }]); fechar(va);
    q(`EXEC dbo.sp_socios_asignar @sale_id=${va};`);
    const fa = revisar(va, 1, 'A quien vende');
    check(cerca(fa.find(f => n(f.socio_id) === S[0])?.total, 50) && cerca(fa.find(f => n(f.socio_id) === S[1])?.total, 30),
      'A: David $50, Leo recupera sus $30');
    guardar({ ids, regla: 'B' });
    const vb = vender([{ p: sandwich, q: 1, precio: 80 }]); fechar(vb);
    q(`EXEC dbo.sp_socios_asignar @sale_id=${vb};`);
    const fb = revisar(vb, 0, 'B quien aporta');
    check(cerca(fb.find(f => n(f.socio_id) === S[0])?.total, 20) && cerca(fb.find(f => n(f.socio_id) === S[1])?.total, 60),
      'B: David $20, Leo $60');
    check(JSON.stringify(repartoDe(v1).map(f => [f.socio_id, f.costo, f.ganancia])) === antes,
      'cambiar la regla no reescribe lo ya repartido');
    guardar({ ids });

    // ------------------------------------------------------ devolucion
    q(`DECLARE @r dbo.SaleDetailType; INSERT @r VALUES (${comp}, 1, 15);
       EXEC dbo.sp_refund_sale @sale_id=${v3}, @user_id=${USER}, @payment_method=N'EFECTIVO', @RefundDetails=@r,
            @apply_net_update=0, @register_id=1, @reason=N'Prueba';`);
    q(`UPDATE dbo.sale_refunds SET datee = DATEADD(DAY, DATEDIFF(DAY, datee, '${DIA}'), datee) WHERE sale_id = ${v3};`);
    q(`EXEC dbo.sp_socios_asignar;`);
    const dev = q(`SELECT x.socio_id, x.total, x.costo FROM dbo.socios_reparto x WHERE x.origen = 'DEVOLUCION' AND x.sale_id = ${v3};`);
    const devComp = esperadoLinea(comp, 3, 15, 0.3);
    check(cerca(dev.reduce((a, f) => a + n(f.total), 0), -15, 0.00005)
          && dev.every(f => cerca(f.total, -devComp.get(n(f.socio_id)).total / 3, 0.0006)),
      'la devolucion de 1 de 3 reparte -$15 como la venta original', `${dev.length} socios`);

    // ----------------------------------------------------------- gastos
    const gasto = (monto, metodo = 'TRANSFERENCIA') => n(uno(`EXEC dbo.sp_register_expense @user_id=${USER}, @category_id=${GASTO},
      @amount=${monto}, @payment_method='${metodo}', @expense_date='${metodo === 'EFECTIVO' ? isoDia(HOY) : DIA}', @note=N'R${N}', @register_id=1;`).expense_id);
    const e1 = gasto(100), e2 = gasto(200), e3 = gasto(300), e4 = gasto(90);
    q(`EXEC dbo.sp_socios_gasto_guardar @expense_id=${e1}, @modo='SOCIOS', @lineas=N'${json([{ socioId: S[0], pct: 100 }])}';`);
    q(`EXEC dbo.sp_socios_gasto_guardar @expense_id=${e2}, @modo='SOCIOS', @lineas=N'${json([{ socioId: S[0], pct: 50 }, { socioId: S[1], pct: 50 }])}';`);
    q(`EXEC dbo.sp_socios_gasto_guardar @expense_id=${e4}, @modo='COMUN', @pagado_por=${S[1]};`);
    let f = falla(`EXEC dbo.sp_socios_gasto_guardar @expense_id=${e2}, @modo='SOCIOS', @lineas=N'${json([{ socioId: S[0], pct: 70 }])}';`, '100');
    check(f.ok, 'un gasto dividido que no suma 100 % se rechaza', f.error);
    const eEf = gasto(50, 'EFECTIVO');
    f = falla(`EXEC dbo.sp_socios_gasto_guardar @expense_id=${eEf}, @modo='COMUN', @pagado_por=${S[0]};`, 'negocio');
    check(f.ok, 'un gasto en efectivo no lo pago nadie de su bolsa', f.error);
    q(`EXEC dbo.sp_void_expense @expense_id=${eEf}, @user_id=${USER}, @reason=N'Prueba';`);

    // ---------------------------------------------------------- compras
    const comprar = (prod, qty, precio, pago) => n(uno(`
      DECLARE @d1 dbo.PurchaseDetailType; DECLARE @d2 dbo.PurchaseDetailType2;
      INSERT INTO @d2 (product_id, quantity, unit_price, profit_percent, presentation_id) VALUES (${prod}, ${qty}, ${precio}, 0, NULL);
      EXEC dbo.sp_register_purchase @user_id=${USER}, @supplier_id=${PROV}, @subtotal=${qty * precio}, @tax_rate=0,
        @tax_amount=0, @total=${qty * precio}, @PurchaseDetails=@d1, @PurchaseDetails2=@d2,
        @payment_method=N'${pago}', @register_id=1;`).purchase_id);
    const c1 = comprar(pan, 10, 30, 'EFECTIVO');          // la paga el negocio: anticipo de Leo
    const c2 = comprar(jamon, 5, 10, 'TRANSFERENCIA');    // la paga David de su bolsa
    q(`EXEC dbo.sp_socios_compra_guardar @purchase_id=${c2}, @pagado_por=${S[0]};`);
    f = falla(`EXEC dbo.sp_socios_compra_guardar @purchase_id=${c1}, @pagado_por=${S[1]};`, 'negocio');
    check(f.ok, 'una compra pagada del cajon no la pago nadie de su bolsa', f.error);
    q(`UPDATE dbo.purchase SET datee = '${DIA} 10:00' WHERE id IN (${c1}, ${c2});
       UPDATE dbo.supplier_payments SET datee = '${DIA} 10:00' WHERE purchase_id IN (${c1}, ${c2});`);

    // ------------------------------------------------- retiro y aportacion
    const cajaAntes = n(escalar(`SELECT SUM(amount) FROM dbo.cash_movements WHERE register_id = 1 AND closure_id = (SELECT TOP 1 id FROM dbo.cash_closures WHERE closed_at IS NULL)`));
    q(`EXEC dbo.sp_socios_movimiento @socio_id=${S[0]}, @tipo='RETIRO', @monto=40, @metodo='EFECTIVO', @register_id=1, @user_id=${USER};`);
    q(`EXEC dbo.sp_socios_movimiento @socio_id=${S[N - 1]}, @tipo='APORTACION', @monto=25, @metodo='TRANSFERENCIA', @user_id=${USER};`);
    const cajaDespues = n(escalar(`SELECT SUM(amount) FROM dbo.cash_movements WHERE register_id = 1 AND closure_id = (SELECT TOP 1 id FROM dbo.cash_closures WHERE closed_at IS NULL)`));
    check(cerca(cajaAntes - cajaDespues, 40, 0.001), 'el retiro en efectivo sale del cajon; la aportacion por transferencia no lo toca');
    q(`UPDATE dbo.socios_movimientos SET fecha = '${DIA} 18:00';`);

    // ---------------------------------------------------------- resumen
    const resumen = () => q(`EXEC dbo.sp_socios_resumen @desde='${DIA}', @hasta='${DIA}';`);
    let r = resumen();
    const de = (s) => r.find(x => n(x.socio_id) === s) ?? {};
    const comun = 300 + 90;
    const gEsp = (i) => (i === 0 ? 100 + 100 : i === 1 ? 100 : 0) + comun / N;
    check(S.every((s, i) => cerca(de(s).gastos, gEsp(i), 0.011)),
      'gastos IGUALES: el suyo, la mitad del dividido y 1/N de los comunes',
      S.map(s => n(de(s).gastos)).join(' / '));
    check(cerca(de(S[1]).aportaciones, N === 2 ? 115 : 90, 0.001) && cerca(de(S[N - 1]).aportaciones, N === 2 ? 115 : 25, 0.001),
      'el gasto que pago Leo de su bolsa y la aportacion cuentan como aportaciones');
    check(cerca(de(S[1]).anticipos, 300, 0.011) && S.every((s, i) => i === 1 || cerca(de(s).anticipos, 0, 0.011)),
      'la compra de contado con dinero del negocio es anticipo de Leo; la de la bolsa de David no',
      S.map(s => n(de(s).anticipos)).join(' / '));
    check(cerca(de(S[0]).retiros, 40, 0.001), 'el retiro de David');

    // La suma de resultados es el dinero del negocio sin repartir.
    const neto = n(escalar(`
      SELECT (SELECT SUM(d.quantity * d.unitary_price) FROM dbo.sale_detail d JOIN dbo.sales s ON s.id = d.sale_id
               WHERE CAST(s.datee AS DATE) = '${DIA}')
           - (SELECT ISNULL(SUM(rd.quantity * rd.unitary_price), 0) FROM dbo.sale_refund_detail rd JOIN dbo.sale_refunds x ON x.id = rd.refund_id
               WHERE CAST(x.datee AS DATE) = '${DIA}')
           - (SELECT ISNULL(SUM(e.amount), 0) FROM dbo.expenses e LEFT JOIN dbo.socios_gasto g ON g.expense_id = e.id
               WHERE e.voided_at IS NULL AND e.expense_date = '${DIA}' AND g.pagado_por_socio_id IS NULL)
           - (SELECT ISNULL(SUM(sp.amount), 0) FROM dbo.supplier_payments sp
               WHERE CAST(sp.datee AS DATE) = '${DIA}' AND NOT EXISTS (SELECT 1 FROM dbo.socios_compra c WHERE c.purchase_id = sp.purchase_id))
           - (SELECT ISNULL(SUM(CASE WHEN tipo = 'APORTACION' THEN -monto ELSE monto END), 0) FROM dbo.socios_movimientos
               WHERE CAST(fecha AS DATE) = '${DIA}') AS neto;`));
    const sumaRes = r.reduce((a, x) => a + n(x.resultado), 0);
    check(Math.abs(sumaRes - neto) <= 0.01 * N, 'la suma de los resultados de todos es el dinero del negocio sin repartir',
      `${sumaRes.toFixed(2)} vs ${neto.toFixed(2)}`);

    // Gastos comunes con % fijo y por ventas.
    guardar({ ids, gastoRegla: 'FIJO' });
    r = resumen();
    const fijo = (i) => (i === 0 ? 100 - 10 * (N - 1) : 10) / 100;
    check(S.every((s, i) => cerca(de(s).gastos, gEsp(i) - comun / N + comun * fijo(i), 0.011)),
      'gastos FIJO: los comunes por el % de cada socio', S.map(s => n(de(s).gastos)).join(' / '));
    guardar({ ids, gastoRegla: 'VENTAS' });
    r = resumen();
    const vtot = r.reduce((a, x) => a + n(x.vendido), 0);
    check(S.every((s, i) => cerca(de(s).gastos, gEsp(i) - comun / N + comun * n(de(s).vendido) / vtot, 0.02)),
      'gastos VENTAS: los comunes por lo que vendio cada uno', S.map(s => n(de(s).gastos)).join(' / '));
    f = falla(`EXEC dbo.sp_socios_config_guardar @json=N'${json(config({ ids, gastoRegla: 'FIJO',
      socios: claves.map((c, i) => ({ clave: c, id: ids[i], nombre: nombres[i], pctFijo: 5, activo: true })) }))}';`, 'sumar 100');
    check(f.ok, 'con % fijo, los porcentajes deben sumar 100', f.error);
    guardar({ ids });
    r = resumen();

    // ---------------------------------------------------------- liquidar
    const liq = todo(`EXEC dbo.sp_socios_liquidar @hasta='${DIA}', @user_id=${USER};`);
    const lineas = liq[1] ?? [];
    check(lineas.length === N && S.every(s => {
      const l = lineas.find(x => n(x.socio_id) === s), x = de(s);
      return l && cerca(l.resultado, x.resultado, 0.001) && cerca(l.saldo_final, x.resultado, 0.001);
    }), 'liquidar el dia deja lo mismo que el resumen y el saldo de cada socio');
    f = falla(`EXEC dbo.sp_socios_liquidar @hasta='${DIA}', @user_id=${USER};`, 'liquidado');
    check(f.ok, 'el mismo periodo no se liquida dos veces', f.error);
    f = falla(`EXEC dbo.sp_socios_liquidar @hasta='${isoDia(HOY)}', @user_id=${USER};`, 'terminaron');
    check(f.ok, 'hoy no se liquida: el dia no ha terminado', f.error);
    const vTarde = vender([{ p: sandwich, q: 1, precio: 80 }]); fechar(vTarde);
    q(`EXEC dbo.sp_socios_asignar;`);
    const despues = todo(`EXEC dbo.sp_socios_liquidacion @id=${n(liq[0]?.[0]?.id)};`)[1];
    check(JSON.stringify(despues.map(l => l.resultado)) === JSON.stringify(lineas.map(l => l.resultado)),
      'una venta tardia del dia liquidado no cambia la liquidacion cerrada');
  }

  // ===================================================================
  seccion('LIMITES');
  const cfg = (k, extra = {}) => ({
    regla: 'C', pctVende: 30, gastoRegla: 'IGUALES', faltanteRegla: 'VENTAS', sinDueno: null,
    liquidacion: 'MENSUAL', inicio: isoDia(HOY), categorias: [],
    socios: Array.from({ length: k }, (_, i) => ({ clave: `x${i}`, nombre: `Limite ${i}`, activo: true })), ...extra,
  });
  q(`DELETE FROM dbo.socios_liquidacion_lineas; DELETE FROM dbo.socios_liquidaciones; DELETE FROM dbo.socios_reparto;
     DELETE FROM dbo.socios_gasto_lineas; DELETE FROM dbo.socios_gasto; DELETE FROM dbo.socios_compra;
     DELETE FROM dbo.socios_movimientos; DELETE FROM dbo.socios_duenos; DELETE FROM dbo.socios_config; DELETE FROM dbo.socios;`);
  let f = falla(`EXEC dbo.sp_socios_config_guardar @json=N'${json(cfg(1))}', @activar=1;`, 'al menos 2');
  check(f.ok, 'con 1 socio no se activa', f.error);
  f = falla(`EXEC dbo.sp_socios_config_guardar @json=N'${json(cfg(11))}', @activar=1;`, '10 socios');
  check(f.ok, 'con 11 socios no se activa: el maximo es 10', f.error);
  f = falla(`EXEC dbo.sp_socios_config_guardar @json=N'${json(cfg(2, { socios: [{ clave: 'a', nombre: 'Igual' }, { clave: 'b', nombre: 'Igual' }] }))}', @activar=1;`, 'llamarse igual');
  check(f.ok, 'dos socios no se llaman igual', f.error);
  const catX = n(escalar(`SELECT TOP 1 id FROM dbo.CAT_categories ORDER BY id;`));
  f = falla(`EXEC dbo.sp_socios_config_guardar @json=N'${json(cfg(2, { categorias: [{ categoriaId: catX, duenos: [{ socio: 'x0', pct: 60 }] }] }))}', @activar=1;`, '100');
  check(f.ok, 'una categoria que no suma 100 % se rechaza', f.error);
  f = falla(`EXEC dbo.sp_socios_config_guardar @json=N'${json(cfg(2, { regla: 'Z' }))}', @activar=1;`, 'ganancia');
  check(f.ok, 'una regla que no es A, B ni C se rechaza', f.error);
  const diez = todo(`EXEC dbo.sp_socios_config_guardar @json=N'${json(cfg(10))}', @activar=1;`)[1];
  check(diez.filter(s => s.activo).length === 10, 'con 10 socios si');
  const desact = cfg(10); desact.socios = desact.socios.map((s, i) => ({ ...s, id: n(diez.find(d => d.nombre === s.nombre)?.id), activo: i < 9 }));
  desact.socios.push({ clave: 'nuevo', nombre: 'Limite nuevo', activo: true });
  const once = todo(`EXEC dbo.sp_socios_config_guardar @json=N'${json(desact)}';`)[1];
  check(once.filter(s => s.activo).length === 10 && once.length === 11,
    'desactivar uno deja meter otro: 10 activos, el inactivo se queda');

  // ===================================================================
  seccion('FALTANTE DE UN CORTE');
  {
    const k3 = cfg(3); k3.socios = once.filter(s => s.activo).slice(0, 3).map((s, i) => ({ clave: `x${i}`, id: n(s.id), nombre: s.nombre, activo: true }));
    // Solo 3 activos: el resto se apaga.
    const resto = once.filter(s => s.activo).slice(3).map((s) => ({ clave: `z${s.id}`, id: n(s.id), nombre: s.nombre, activo: false }));
    k3.socios.push(...resto);
    k3.faltanteRegla = 'IGUALES';
    todo(`EXEC dbo.sp_socios_config_guardar @json=N'${json(k3)}';`);
    const turno = n(escalar(`SELECT TOP 1 id FROM dbo.cash_closures WHERE closed_at IS NULL ORDER BY id DESC;`));
    q(`UPDATE dbo.cash_closures SET closed_at = SYSDATETIME(), cash_expected = 1000, cash_delivered = 970, difference = -30 WHERE id = ${turno};`);
    const r = q(`EXEC dbo.sp_socios_resumen @desde='${isoDia(HOY)}', @hasta='${isoDia(HOY)}';`).filter(x => x.activo);
    check(r.length === 3 && r.every(x => cerca(x.faltantes, 10, 0.011)), 'un faltante de $30 con 3 socios: $10 a cada uno',
      r.map(x => n(x.faltantes)).join(' / '));
    q(`EXEC dbo.sp_open_shift @user_id=${USER}, @opening_cash=1000, @register_id=1;`);
  }

  // ===================================================================
  seccion('PROPINAS');
  {
    const mesero = (u) => n(escalar(`INSERT INTO dbo.users (usuario, password_hash, rol, active)
      VALUES (N'${u}', N'x', N'cajero', 1); SELECT CAST(SCOPE_IDENTITY() AS INT);`));
    const W1 = mesero('mesero.uno'), W2 = mesero('mesero.dos');
    const prod = n(escalar(`SELECT TOP 1 id FROM dbo.products WHERE sellable = 1 AND inventory_mode = 'DIRECT' AND stock > 10 ORDER BY id DESC;`));
    let f = falla(`EXEC dbo.sp_propina_registrar @sale_id=1, @monto=10, @metodo='EFECTIVO';`, 'activado');
    check(f.ok, 'sin activar no se registra propina', f.error);
    f = falla(`EXEC dbo.sp_propinas_config_guardar @reparto='HORAS', @sugeridas='10,15,20,25,30', @activar=1;`, '1 a 4');
    check(f.ok, 'mas de 4 porcentajes sugeridos se rechazan', f.error);
    const c = uno(`EXEC dbo.sp_propinas_config_guardar @reparto='ATENDIO', @sugeridas='15,10,20', @comision_pct=3, @comision_a='PROPINA', @activar=1, @user_id=${USER};`);
    check(c?.activo === true && c?.sugeridas === '10,15,20', 'activar guarda la configuracion y ordena los %');

    const s1 = vender([{ p: prod, q: 2, precio: 100 }], W1);
    const s2 = vender([{ p: prod, q: 1, precio: 150 }], W2);
    const caja0 = n(escalar(`SELECT SUM(amount) FROM dbo.cash_movements WHERE closure_id = (SELECT TOP 1 id FROM dbo.cash_closures WHERE closed_at IS NULL AND register_id = 1)`));
    q(`EXEC dbo.sp_propina_registrar @sale_id=${s1}, @monto=20, @metodo='EFECTIVO', @user_id=${W1};`);
    q(`EXEC dbo.sp_propina_registrar @sale_id=${s2}, @monto=30, @metodo='TARJETA', @user_id=${W2};`);
    const caja1 = n(escalar(`SELECT SUM(amount) FROM dbo.cash_movements WHERE closure_id = (SELECT TOP 1 id FROM dbo.cash_closures WHERE closed_at IS NULL AND register_id = 1)`));
    check(cerca(caja1 - caja0, 20, 0.001), 'la propina en efectivo entra al cajon; la de tarjeta no');
    f = falla(`EXEC dbo.sp_propina_registrar @sale_id=${s1}, @monto=5, @metodo='EFECTIVO';`, 'ya tiene');
    check(f.ok, 'una venta tiene una sola propina', f.error);
    f = falla(`EXEC dbo.sp_propina_registrar @sale_id=${vender([{ p: prod, q: 1, precio: 10 }], W1)}, @monto=50, @metodo='TARJETA';`, 'mayor que la cuenta');
    check(f.ok, 'la propina no es mayor que la cuenta', f.error);
    check(n(escalar(`SELECT COUNT(*) FROM dbo.socios_reparto WHERE sale_id IN (${s1}, ${s2})`)) === 0
          || n(escalar(`SELECT SUM(total) FROM dbo.socios_reparto WHERE sale_id IN (${s1}, ${s2})`)) <= 350.0001,
      'la propina no entra al reparto de socios');

    // Seis horas de ventana: W1 trabajo 6 h, W2 2 h.
    q(`UPDATE dbo.propinas SET fecha = DATEADD(HOUR, -6, SYSDATETIME());
       INSERT INTO dbo.asistencia_jornadas (user_id, dia, entrada_en, salida_en, estado)
       VALUES (${W1}, CAST(DATEADD(HOUR, -7, SYSDATETIME()) AS DATE), DATEADD(HOUR, -7, SYSDATETIME()), NULL, 'ABIERTA'),
              (${W2}, CAST(DATEADD(HOUR, -3, SYSDATETIME()) AS DATE), DATEADD(HOUR, -3, SYSDATETIME()), DATEADD(HOUR, -1, SYSDATETIME()), 'CERRADA');`);
    const ver = () => { const s = todo(`EXEC dbo.sp_propinas_repartir @register_id=1, @confirmar=0;`); return { h: s[0][0], l: s[1] }; };
    const de = (x, u) => n(x.l.find(l => n(l.user_id) === u)?.monto);
    let x = ver();
    check(cerca(x.h.total, 50, 0.001) && cerca(x.h.comision, 0.9, 0.001) && cerca(x.h.neto, 49.1, 0.001),
      'comision de 3 % a la propina de tarjeta: 50 - 0.90 = 49.10');
    check(cerca(de(x, W1), 20, 0.001) && cerca(de(x, W2), 29.1, 0.001), 'ATENDIO: 20 a quien cobro en efectivo, 29.10 al de tarjeta');
    q(`EXEC dbo.sp_propinas_config_guardar @reparto='HORAS', @sugeridas='10,15,20', @comision_pct=3, @comision_a='PROPINA';`);
    x = ver();
    /* La ventana corre hasta AHORA: W1 sigue trabajando y sus horas crecen
       con lo que tarda la prueba. Se comprueba la proporcion, no un numero. */
    const hs = (u) => n(x.l.find(l => n(l.user_id) === u)?.horas);
    check(cerca(de(x, W1) + de(x, W2), 49.1, 0.001) && cerca(hs(W2), 2, 0.01) && hs(W1) >= 6 && hs(W1) < 6.5
          && cerca(de(x, W1), 49.1 * hs(W1) / (hs(W1) + hs(W2)), 0.011),
      'HORAS: 6 h y 2 h se reparten por horas', `${hs(W1)} h ${de(x, W1)} / ${hs(W2)} h ${de(x, W2)}`);
    q(`EXEC dbo.sp_propinas_config_guardar @reparto='IGUALES', @sugeridas='10,15,20', @comision_pct=3, @comision_a='NEGOCIO';`);
    x = ver();
    check(cerca(x.h.neto, 50, 0.001) && cerca(de(x, W1), 25, 0.001) && cerca(de(x, W2), 25, 0.001),
      'IGUALES y la comision la absorbe el negocio: 25 y 25');
    const caja2 = n(escalar(`SELECT SUM(amount) FROM dbo.cash_movements WHERE closure_id = (SELECT TOP 1 id FROM dbo.cash_closures WHERE closed_at IS NULL AND register_id = 1)`));
    const pago = todo(`EXEC dbo.sp_propinas_repartir @register_id=1, @user_id=${USER}, @confirmar=1;`);
    const caja3 = n(escalar(`SELECT SUM(amount) FROM dbo.cash_movements WHERE closure_id = (SELECT TOP 1 id FROM dbo.cash_closures WHERE closed_at IS NULL AND register_id = 1)`));
    check(n(pago[0][0]?.reparto_id) > 0 && cerca(caja2 - caja3, 50, 0.001)
          && n(escalar(`SELECT COUNT(*) FROM dbo.cash_movements WHERE typee = 'TIP_PAYOUT'`)) === 2,
      'pagar el reparto saca del cajon una salida por persona');
    check(n(escalar(`SELECT COUNT(*) FROM dbo.propinas WHERE reparto_id IS NULL`)) === 0, 'y las propinas quedan repartidas');
    f = falla(`EXEC dbo.sp_propinas_repartir @register_id=1, @user_id=${USER}, @confirmar=1;`, 'pendientes');
    check(f.ok, 'sin propinas pendientes no hay nada que pagar', f.error);
  }
} catch (e) {
  fallos++;
  console.log(`\n   FALLA  ${e.message}`);
} finally {
  if (!CONSERVAR) try { eliminar(DB); } catch { /* noop */ }
}

console.log(`\nRESULTADO: ${fallos ? `${fallos} FALLO(S) de ${pasos}` : `OK (${pasos} comprobaciones)`}`);
process.exit(fallos ? 1 : 0);
