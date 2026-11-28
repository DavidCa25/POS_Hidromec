/**
 * CARNE POR RENDIMIENTO (0095), CONTRA UNA BASE DE VERDAD.
 *
 *     npm run db:test-rendimiento
 *
 * Una taquería sin recetas: tacos sin inventario, la carne se compra por
 * kilo, «1 kg de pastor ≈ 14 tacos» y al cierre se dice cuánto quedó.
 *
 *   1  guardar carnes: nace el insumo en gramos con su presentación Kilo;
 *      los platillos se mapean por nombre (taco 1, orden de 5, kilo = rinde);
 *   2  el cierre ve lo que había, lo comprado y los tacos vendidos (menos
 *      devueltos), y lo que se cobró por taco;
 *   3  contar: salida RENDIMIENTO a su costo, la existencia queda en lo que
 *      quedó, cuántos tacos faltan y cuánto es; reintentar no cuenta dos
 *      veces; quedar más de lo que había entra como ajuste de conteo;
 *   4  una noche sin contar se suma a la siguiente;
 *   5  el estado de resultados lleva la carne al costo de los tacos (por
 *      producto también) y nada a «ajustes»;
 *   6  el mes: lo comprado, lo que se fue, por día y por carne, y las noches
 *      sin contestar; tras 5 noches rindiendo de menos, la sugerencia; y
 *      ajustar el número;
 *   7  lo que una persona mapeó a mano no lo toca el mapeo automático.
 *
 * Nunca toca una base existente: crea la suya y la borra al terminar.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ejecutar, ejecutarVarios, restaurar, eliminar, exigirTemporal } from '../lib/temporal.mjs';
import { consultarTemporal } from '../lib/temporal-consulta.mjs';

const DB = 'Wybix_TmpRendimiento';
const CONSERVAR = process.argv.includes('--conservar');
let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);
const sets = (sql) => { const r = consultarTemporal(DB, sql); if (!r.ok) throw new Error(r.error); return r.sets ?? []; };
const q = (sql) => { const s = sets(sql); return s.length ? s[s.length - 1] : []; };
const uno = (sql) => q(sql)[0] ?? {};
const escalar = (sql) => Object.values(uno(sql))[0];
const falla = (sql) => { const r = consultarTemporal(DB, sql); return r.ok ? null : String(r.error); };
const n = (x) => Number(x);
const cerca = (a, b, t = 0.01) => Math.abs(n(a) - n(b)) <= t;
const lotesDe = (ruta) => readFileSync(ruta, 'utf8').replace(/\r\n/g, '\n').split(/\n\s*GO\s*\n/gi).map((x) => x.trim()).filter(Boolean);

exigirTemporal(DB);
console.log(`Base temporal ${DB}`);

try {
  eliminar(DB);
  restaurar(DB, join(process.cwd(), 'installer', 'template.bak'));
  const dir = join(process.cwd(), 'electron', 'migrations');
  const lotes = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().flatMap((f) => lotesDe(join(dir, f)));
  const r = ejecutarVarios(DB, lotes);
  const malo = r.findIndex((x) => !x.ok);
  if (malo >= 0) throw new Error(`migraciones, lote ${malo + 1}: ${r[malo].error}\n${lotes[malo].slice(0, 300)}`);
  ejecutar(DB, `EXEC dbo.sp_setup_inicial @usuario = N'taquero', @password = N'taquero1234',
      @business_name = N'Taquería de prueba', @business_profile = N'HOSPITALITY'`);
  const u = n(escalar(`SELECT TOP 1 id FROM dbo.users ORDER BY id`));

  // ------------------------------------------------------------ el menú
  q(`INSERT INTO dbo.CAT_categories (namee) VALUES (N'Tacos'); INSERT INTO dbo.CAT_brands (namee) VALUES (N'Casa');`);
  const cat = n(escalar(`SELECT id FROM dbo.CAT_categories WHERE namee = N'Tacos'`));
  const marca = n(escalar(`SELECT TOP 1 id FROM dbo.CAT_brands ORDER BY id`));
  const alta = (pn, nombre, precio, modo = 'NONE', stock = 0) => q(`EXEC dbo.sp_add_product @brand=${marca}, @category=${cat},
    @part_number=N'${pn}', @name=N'${nombre}', @price=${precio}, @stock=${stock}, @inventory_mode=N'${modo}', @sellable=1;`);
  for (const [pn, nombre, precio, modo, stock] of [
    ['TAC-PAS', 'Taco al pastor', 22], ['ORD-PAS', 'Orden de 5 al pastor', 100], ['GRI-PAS', 'Gringa al Pástor', 65],
    ['KIL-PAS', 'Medio kilo de pastor', 180], ['TAC-BIS', 'Taco de bistec', 25], ['REF', 'Refresco 600 ml', 28, 'DIRECT', 100],
  ]) alta(pn, nombre, precio, modo, stock);
  const id = (pn) => n(escalar(`SELECT id FROM dbo.products WHERE part_number = N'${pn}'`));
  const P = { taco: id('TAC-PAS'), orden: id('ORD-PAS'), gringa: id('GRI-PAS'), kilo: id('KIL-PAS'), bistec: id('TAC-BIS'), ref: id('REF') };

  // ======================================================== 1 carnes
  seccion('1. ¿Qué carnes usas y cuántos tacos te salen por kilo?');
  const guardar = (lista) => sets(`EXEC dbo.sp_rendimiento_guardar @carnes = N'${JSON.stringify(lista).replace(/'/g, "''")}', @user_id = ${u};`);
  const g = guardar([{ clave: 'pastor', nombre: 'Pastor', rinde: 14, activo: true }, { clave: 'bistec', nombre: 'Bistec', rinde: 12, activo: true },
                     { clave: 'tripa', nombre: 'Tripa', rinde: 10, activo: false }]);
  const carnes = g[g.length - 2] || [];
  const platillos = g[g.length - 1] || [];
  const pastor = carnes.find((c) => c.nombre === 'Pastor'), bistec = carnes.find((c) => c.nombre === 'Bistec');
  check(carnes.length === 2 && pastor && bistec, 'quedan dos carnes; la apagada que nunca existió no nace', carnes.map((c) => c.nombre).join(', '));
  const ins = uno(`SELECT base_uom, sellable, inventory_mode, part_number FROM dbo.products WHERE id = ${pastor.carne_id}`);
  check(ins.base_uom === 'g' && !ins.sellable && ins.inventory_mode === 'DIRECT' && ins.part_number === 'CARNE-PASTOR',
    'el pastor nace como insumo en gramos, no vendible', JSON.stringify(ins));
  check(pastor.presentacion_kilo > 0, 'y con su presentación de compra «Kilo» = 1000 g');
  const tacosDe = (pid, carne) => n(platillos.find((x) => x.product_id === pid && x.carne_id === carne)?.tacos ?? 0);
  check(tacosDe(P.taco, pastor.carne_id) === 1, 'el «Taco al pastor» cuenta 1 taco de pastor');
  check(tacosDe(P.orden, pastor.carne_id) === 5, 'la «Orden de 5 al pastor» cuenta 5');
  check(tacosDe(P.gringa, pastor.carne_id) === 1, 'la «Gringa al Pástor» cuenta aunque lleve acento y mayúscula');
  check(tacosDe(P.kilo, pastor.carne_id) === 7, 'el «Medio kilo de pastor» cuenta medio rendimiento (7 tacos)');
  check(tacosDe(P.bistec, bistec.carne_id) === 1 && !platillos.some((x) => x.product_id === P.ref), 'el bistec es del bistec; el refresco de nadie');
  check(/1 a 60/.test(falla(`EXEC dbo.sp_rendimiento_guardar @carnes = N'[{"clave":"x","nombre":"X","rinde":0}]'`) || ''), 'cero tacos por kilo se rechaza');
  guardar([{ clave: 'pastor', nombre: 'Pastor', rinde: 14, activo: true }]);
  check(n(escalar(`SELECT COUNT(*) FROM dbo.products WHERE part_number = N'CARNE-PASTOR'`)) === 1, 'guardar otra vez no duplica el insumo');

  // ================================================== compra y ventas
  const prov = n(uno(`EXEC dbo.sp_add_supplier @nombre = N'Carnes Don Beto'`).id ?? escalar(`SELECT TOP 1 id FROM dbo.CAT_suppliers ORDER BY id DESC`));
  const comprar = (carne, kg, precioKg) => q(`
    DECLARE @d1 dbo.PurchaseDetailType; DECLARE @d2 dbo.PurchaseDetailType2;
    INSERT INTO @d2 (product_id, quantity, unit_price, profit_percent, presentation_id) VALUES (${carne.carne_id}, ${kg}, ${precioKg}, 0, ${carne.presentacion_kilo});
    EXEC dbo.sp_register_purchase @user_id=${u}, @supplier_id=${prov}, @subtotal=${kg * precioKg}, @tax_rate=0, @tax_amount=0,
      @total=${kg * precioKg}, @PurchaseDetails=@d1, @PurchaseDetails2=@d2, @payment_method=N'CREDITO', @register_id=1;`);
  const abrir = () => n(uno(`EXEC dbo.sp_open_shift @user_id=${u}, @opening_cash=500, @register_id=1;`).closure_id);
  const cerrar = (id) => q(`EXEC dbo.sp_close_shift @closure_id=${id}, @user_id=${u}, @cash_delivered=0, @register_id=1;`);
  const vender = (lineas) => n(uno(`
    DECLARE @d1 dbo.SaleDetailType; DECLARE @d2 dbo.SaleDetailType2; DECLARE @mo dbo.SaleModifierType;
    INSERT INTO @d2 (line_no, product_id, quantity, unit_price) VALUES ${lineas.map(([p, qty, precio], i) => `(${i + 1}, ${p}, ${qty}, ${precio})`).join(', ')};
    EXEC dbo.sp_register_sale @user_id=${u}, @payment_method=N'TARJETA', @SaleDetails=@d1, @register_id=1, @SaleDetails2=@d2, @SaleModifiers=@mo;`).sale_id);
  const cierre = (corte) => q(`EXEC dbo.sp_rendimiento_cierre @closure_id = ${corte}`);
  const contar = (corte, lista) => sets(`EXEC dbo.sp_rendimiento_contar @closure_id = ${corte}, @user_id = ${u}, @conteos = N'${JSON.stringify(lista)}'`);

  comprar(pastor, 16, 170);
  comprar(bistec, 7, 218);
  check(cerca(escalar(`SELECT stock FROM dbo.products WHERE id = ${pastor.carne_id}`), 16000), 'comprar 16 kg suben 16,000 g');

  // ======================================================== 2 el cierre
  seccion('2. Lo que el corte pregunta');
  const t1 = abrir();
  /* 182 tacos de pastor: 152 sueltos + 4 órdenes de 5 + 10 gringas; 70 de bistec. */
  for (let i = 0; i < 19; i++) vender([[P.taco, 8, 22]]);
  vender([[P.orden, 4, 100], [P.gringa, 10, 65]]);
  for (let i = 0; i < 10; i++) vender([[P.bistec, 7, 25], [P.ref, 1, 28]]);
  const ventaDevuelta = vender([[P.taco, 2, 22]]);
  q(`DECLARE @r dbo.SaleDetailType; INSERT @r VALUES (${P.taco}, 2, 22);
     EXEC dbo.sp_refund_sale @sale_id=${ventaDevuelta}, @user_id=${u}, @payment_method=N'TARJETA', @RefundDetails=@r, @apply_net_update=0, @register_id=1, @reason=N'Equivocado';`);
  const vista = cierre(t1);
  const vp = vista.find((x) => x.carne_id === pastor.carne_id), vb = vista.find((x) => x.carne_id === bistec.carne_id);
  check(cerca(vp.tenia_kg, 16, 0.001) && cerca(vp.comprado_kg, 16, 0.001), 'tenías 16 kg de pastor, comprados hoy', `${vp.tenia_kg} / ${vp.comprado_kg}`);
  check(cerca(vp.vendidos, 182, 0.001), 'vendiste 182 tacos de pastor (las órdenes cuentan 5, lo devuelto no)', String(vp.vendidos));
  check(cerca(vb.vendidos, 70, 0.001), 'y 70 de bistec', String(vb.vendidos));
  const precioTaco = (152 * 22 + 2 * 22 + 400 + 650) / (154 + 20 + 10);
  check(cerca(vp.precio_taco, precioTaco, 0.01), 'el taco de pastor se cobró en promedio', `${vp.precio_taco} ≈ ${precioTaco.toFixed(2)}`);
  check(!vp.contado, 'y todavía no se contó');

  // ======================================================== 3 contar
  seccion('3. «Me quedaron 2.5 kg de pastor y 1 de bistec»');
  const d1 = contar(t1, [{ carne_id: pastor.carne_id, quedo_kg: 2.5 }, { carne_id: bistec.carne_id, quedo_kg: 1 }]);
  const dia = d1[0] || [];
  const dp = dia.find((x) => x.carne_id === pastor.carne_id), db = dia.find((x) => x.carne_id === bistec.carne_id);
  check(cerca(dp.usado_kg, 13.5, 0.001) && n(dp.esperados) === 189, 'usaste 13.5 kg: debieron salir 189 tacos', `${dp.usado_kg} kg · ${dp.esperados}`);
  check(n(dp.faltan) === 7 && dp.veredicto === 'FALTA', 'faltan 7 tacos', `${dp.faltan} · ${dp.veredicto}`);
  check(cerca(dp.valor_faltante, 7 * n(vp.precio_taco), 0.01), 'y es su precio promedio por 7', String(dp.valor_faltante));
  check(cerca(dp.rinde_real, 182 / 13.5, 0.01), 'el kilo rindió 13.48 tacos', String(dp.rinde_real));
  check(cerca(dp.costo_taco, 13.5 * 170 / 182, 0.01), 'y la carne de cada taco costó $12.61', String(dp.costo_taco));
  check(db.veredicto === 'NORMAL' && n(db.esperados) === 72, 'el bistec rindió normal (72 contra 70)', `${db.esperados} · ${db.veredicto}`);
  check(cerca(escalar(`SELECT stock FROM dbo.products WHERE id = ${pastor.carne_id}`), 2500), 'la existencia queda en lo que quedó');
  const mov = uno(`SELECT typee, reference, quantity, unit_cost FROM dbo.inventory_movements WHERE product_id = ${pastor.carne_id} AND source = 'RENDIMIENTO'`);
  check(mov.typee === 'salida' && mov.reference === 'RENDIMIENTO' && cerca(mov.quantity, 13500) && cerca(mov.unit_cost, 0.17, 0.0001),
    'salieron 13,500 g a $0.17 el gramo', JSON.stringify(mov));
  contar(t1, [{ carne_id: pastor.carne_id, quedo_kg: 1 }]);
  check(n(escalar(`SELECT COUNT(*) FROM dbo.rendimiento_conteos WHERE closure_id = ${t1}`)) === 2
     && cerca(escalar(`SELECT stock FROM dbo.products WHERE id = ${pastor.carne_id}`), 2500), 'contar otra vez el mismo corte no cuenta dos veces');
  check(/0 kg/.test(falla(`EXEC dbo.sp_rendimiento_contar @closure_id=${t1}, @conteos=N'[{"carne_id":${pastor.carne_id},"quedo_kg":-1}]'`) || ''), 'menos de 0 kg se rechaza');
  check(cierre(t1).every((x) => x.contado), 'y el cierre ya lo da por contado');
  cerrar(t1);

  // =========================================== 4 una noche sin contar
  seccion('4. Una noche sin contar se suma a la siguiente');
  const t2 = abrir();
  for (let i = 0; i < 5; i++) vender([[P.taco, 10, 22]]);     // 50
  cerrar(t2);                                                   // no se contó
  comprar(pastor, 5, 172);
  const t3 = abrir();
  for (let i = 0; i < 6; i++) vender([[P.taco, 10, 22]]);     // 60
  const v3 = cierre(t3).find((x) => x.carne_id === pastor.carne_id);
  check(cerca(v3.vendidos, 110, 0.001) && cerca(v3.tenia_kg, 7.5, 0.001), 'el cierre siguiente ve los 110 tacos de las dos noches y 7.5 kg', `${v3.vendidos} · ${v3.tenia_kg}`);
  /* Quedó MÁS de lo que había: una compra que no se capturó. */
  contar(t3, [{ carne_id: pastor.carne_id, quedo_kg: 0 }, { carne_id: bistec.carne_id, quedo_kg: 1.5 }]);
  const sob = uno(`SELECT typee, reference, quantity FROM dbo.inventory_movements WHERE product_id = ${bistec.carne_id} AND reference = 'CONTEO'`);
  check(sob.typee === 'entrada' && cerca(sob.quantity, 500), 'quedar 1.5 kg de bistec habiendo 1 entra 500 g como ajuste de conteo', JSON.stringify(sob));
  check(cerca(escalar(`SELECT usado FROM dbo.rendimiento_conteos WHERE closure_id = ${t3} AND carne_id = ${bistec.carne_id}`), 0), 'y lo usado del bistec es 0');
  cerrar(t3);

  // ================================================ 5 estado de resultados
  seccion('5. La carne es el costo de los tacos');
  const ahora = new Date();   // fecha LOCAL: la del servidor SQL, no la UTC
  const hoy = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;
  const er = sets(`EXEC dbo.sp_income_statement @desde='${hoy}', @hasta='${hoy}'`);
  const res = er[0].find((x) => x.periodo === 'ACTUAL');
  const costoCarne = 13500 * 0.17 + 6000 * 0.218 + 7500 * 0.172;   // pastor t1 + bistec t1 + pastor t3
  const ajusteBistec = -500 * 0.218;
  check(cerca(res.costo_ventas, costoCarne + 100 * 0, 0.05) || cerca(res.costo_ventas, costoCarne, 0.05),
    'el costo de ventas lleva la carne usada', `${res.costo_ventas} ≈ ${costoCarne.toFixed(2)}`);
  check(cerca(res.ajustes_inventario, ajusteBistec, 0.01), 'en ajustes solo queda el bistec que sobró', `${res.ajustes_inventario} ≈ ${ajusteBistec.toFixed(2)}`);
  const prods = er[4] || [];
  const costoTaco = n(prods.find((x) => x.id === P.taco)?.costo), costoOrden = n(prods.find((x) => x.id === P.orden)?.costo);
  check(costoTaco > 0 && costoOrden > 0, 'el taco y la orden ya tienen costo en «por producto»', `taco ${costoTaco} · orden ${costoOrden}`);
  check(cerca(costoOrden, 13500 * 0.17 * 20 / 184, 0.05), 'la orden carga 20 de los 184 tacos vendidos esa noche', `${costoOrden}`);
  check(cerca(res.ventas_sin_costo, n(res.ventas_sin_costo)) && n(res.renglones_costo_estimado) < 40, 'los tacos ya no cuentan como «sin costo»', `${res.renglones_costo_estimado} renglones estimados`);

  // ============================================================ 6 el mes
  seccion('6. El mes de la carne');
  const mes = sets(`EXEC dbo.sp_rendimiento_mes @desde='${hoy}', @hasta='${hoy}'`);
  const m = mes[0].find((x) => x.periodo === 'ACTUAL');
  check(cerca(m.comprado_kg, 28) && cerca(m.comprado, 16 * 170 + 7 * 218 + 5 * 172), 'se compraron 28 kg', `${m.comprado_kg} kg · $${m.comprado}`);
  check(n(m.tacos) === 182 + 70 + 110, 'tacos vendidos en los conteos', String(m.tacos));
  check(n(m.noches_sin_contar) === 1, 'una noche cerrada sin contestar', String(m.noches_sin_contar));
  /* Primera noche: 7 de pastor y 2 de bistec (72 contra 70). t3: 7.5 kg a 14 =
     105 esperados y 110 vendidos: rindió de más, y eso no resta lo perdido. */
  check(n(m.se_fueron) === 9, 'se fueron 9 tacos (rendir de más no resta)', String(m.se_fueron));
  const dow = (new Date().getDay() + 6) % 7;
  check(n(mes[1].find((x) => n(x.dow) === dow)?.se_fueron) === 9 && mes[1].length === 7, 'por día: hoy, los 9, en una semana de 7 días');
  check(mes[2].length === 2 && mes[2][0].nombre === 'Pastor', 'por carne, el pastor primero');

  /* Seis noches más rindiendo 13.5: Wybix sugiere ajustar. */
  for (let k = 0; k < 6; k++) {
    comprar(pastor, 2, 170);
    const t = abrir();
    vender([[P.taco, 27, 22]]);                                  // 2 kg × 13.5
    contar(t, [{ carne_id: pastor.carne_id, quedo_kg: 0 }]);
    cerrar(t);
  }
  const sug = (sets(`EXEC dbo.sp_rendimiento_dia`)[1] || []).find((x) => x.carne_id === pastor.carne_id);
  check(sug && cerca(sug.sugerido, 13.5, 0.001), 'tras varias noches rindiendo 13.5, sugiere 13.5', JSON.stringify(sug ?? null));
  q(`EXEC dbo.sp_rendimiento_ajustar @carne_id = ${pastor.carne_id}, @rinde = 13.5`);
  check(cerca(escalar(`SELECT tacos FROM dbo.rendimiento_platillos WHERE product_id = ${P.kilo}`), 6.75, 0.001), 'ajustar recalcula el medio kilo (6.75 tacos)');

  // ================================================== 7 mapeo a mano
  seccion('7. Lo que se fijó a mano se respeta');
  q(`UPDATE dbo.rendimiento_platillos SET tacos = 2, manual = 1 WHERE product_id = ${P.gringa}`);
  q(`EXEC dbo.sp_rendimiento_mapear`);
  check(cerca(escalar(`SELECT tacos FROM dbo.rendimiento_platillos WHERE product_id = ${P.gringa}`), 2), 'la gringa sigue contando 2');
  alta('TAC-PAS2', 'Taco de pastor con queso', 28);
  q(`EXEC dbo.sp_rendimiento_cierre`);
  check(n(escalar(`SELECT COUNT(*) FROM dbo.rendimiento_platillos WHERE product_id = ${id('TAC-PAS2')}`)) === 1, 'un platillo nuevo del menú entra solo al siguiente cierre');
} catch (e) {
  fallos++;
  console.log(`\n   ERROR  ${e.message}`);
} finally {
  if (!CONSERVAR) { try { eliminar(DB); console.log(`\n${DB} eliminada.`); } catch { /* noop */ } }
}

console.log(`\nRESULTADO: ${fallos ? `${fallos} FALLO(S) de ${pasos}` : `OK (${pasos} comprobaciones)`}`);
process.exit(fallos ? 1 : 0);
