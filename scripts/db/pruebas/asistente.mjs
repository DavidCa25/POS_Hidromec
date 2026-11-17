/**
 * EL ASISTENTE CONTRA SQL DE VERDAD: la migración 0082 y los números del
 * análisis con ventas conocidas.
 *
 *     node scripts/db/pruebas/asistente.mjs [--conservar]
 *
 * 1. MIGRACIÓN. Restaura installer/template.bak (que ya trae la 0082: una
 *    instalación nueva no aplica nada) y la regresa al estado de una caja que
 *    viene de la 0081 (sin las tablas del asistente ni el registro de la 0082).
 *    Luego la migra con electron/migrationsRunner.js, el MISMO código que corre
 *    la app al arrancar, con el driver de la app:
 *      · con la 0082: se aplica sola, queda registrada y crea las tablas con
 *        sus restricciones;
 *      · otra vez: nada pendiente; reejecutar el archivo a mano tampoco truena.
 *
 * 2. ANÁLISIS. Siembra ocho semanas de ventas con totales hechos a mano y
 *    compara lo que contesta electron/asistente/analitica contra esas cuentas:
 *    filtros (días, horas, forma de pago, categoría, cajero), ganancia por
 *    producto, «¿por qué?», pronóstico, cuándo se acaba y «hoy contra sus
 *    iguales». El reloj se fija (lunes 16/nov/2026, 3 pm): la prueba no
 *    depende del día en que se corra.
 *
 * Solo escribe en la base temporal Wybix_TmpAsistente, que borra al final.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { restaurar, eliminar } from '../lib/temporal.mjs';
import { SERVIDOR } from '../lib/sql.mjs';

const require = createRequire(import.meta.url);
const sql = require('mssql/msnodesqlv8');
const { runMigrations } = require('../../../electron/migrationsRunner.js');
const { crearAnalitica } = require('../../../electron/asistente/analitica/index.js');
const { crearAcciones } = require('../../../electron/asistente/acciones/index.js');

const DB = 'Wybix_TmpAsistente';
const BAK = join('installer', 'template.bak');
const DIR_MIG = join('electron', 'migrations');
const CONSERVAR = process.argv.includes('--conservar');

let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);
const cerca = (a, b, tol = 0.01) => Math.abs(Number(a) - b) < tol;
const n2 = (x) => Number(x).toFixed(2);

/* La migración, a mano, partida por GO: igual que el runner. */
const lotes = (ruta) => readFileSync(ruta, 'utf8').replace(/\r\n/g, '\n').split(/\n\s*GO\s*\n/gi).map((s) => s.trim()).filter(Boolean);

let pool;
try {
  console.log(`\nASISTENTE   (${DB})`);
  restaurar(DB, BAK);
  pool = await new sql.ConnectionPool({ server: SERVIDOR, database: DB, options: { trustedConnection: true, trustServerCertificate: true } }).connect();
  const q = async (texto) => (await pool.request().query(texto)).recordset || [];
  const escalar = async (texto) => { const f = (await q(texto))[0]; return f ? f[Object.keys(f)[0]] : null; };
  const existe = async (tabla) => Number(await escalar(`SELECT CASE WHEN OBJECT_ID(N'dbo.${tabla}', N'U') IS NULL THEN 0 ELSE 1 END AS x;`)) === 1;

  // ============================================================ 1
  seccion('1. Migración 0082 con el runner de la app');
  const tablas = ['asistente_hallazgos', 'asistente_descartes', 'asistente_planes', 'asistente_bitacora', 'asistente_mensajes', 'asistente_frases', 'asistente_alias', 'asistente_config'];
  const nuevas = await runMigrations({ pool, sql, migrationsDir: DIR_MIG });
  check(nuevas.applied.length === 0 && await existe('asistente_alias'), 'una instalación nueva ya trae la 0082: nada que aplicar');
  /* Una caja que viene de la 0081: ni las tablas ni el registro. */
  await q(`${tablas.map((x) => `DROP TABLE dbo.${x};`).join(' ')} DELETE FROM dbo.schema_migrations WHERE filename = N'0082_asistente.sql';`);
  check(!(await existe('asistente_alias')), 'una caja en la 0081 no tiene dbo.asistente_alias');

  const r1 = await runMigrations({ pool, sql, migrationsDir: DIR_MIG });
  check(r1.applied.length === 1 && r1.applied[0] === '0082_asistente.sql', 'al actualizar se aplica sola la 0082', r1.applied.join(', '));
  const faltan = [];
  for (const t of tablas) if (!(await existe(t))) faltan.push(t);
  check(!faltan.length, 'crea las 8 tablas del asistente', faltan.length ? `faltan: ${faltan.join(', ')}` : '');
  check(Number(await escalar(`SELECT COUNT(*) FROM dbo.schema_migrations WHERE filename = N'0082_asistente.sql';`)) === 1, 'queda registrada en schema_migrations');

  const r2 = await runMigrations({ pool, sql, migrationsDir: DIR_MIG });
  check(r2.applied.length === 0, 'al volver a arrancar no queda nada pendiente');
  let reaplica = null;
  try { for (const l of lotes(join(DIR_MIG, '0082_asistente.sql'))) await pool.request().batch(l); } catch (e) { reaplica = e.message; }
  check(!reaplica, 'reejecutar el archivo a mano no truena', reaplica || '');

  await q(`INSERT INTO dbo.asistente_alias (alias, tipo, ref_id) VALUES (N'roja', 'producto', 1);`);
  const dup = await pool.request().query(`INSERT INTO dbo.asistente_alias (alias, tipo, ref_id) VALUES (N'roja', 'cliente', 2);`).then(() => null, (e) => e.message);
  check(!!dup && /UX_asistente_alias_alias|duplicate|duplicad/i.test(dup), 'un apodo no puede apuntar a dos cosas (UNIQUE)');
  const tipo = await pool.request().query(`INSERT INTO dbo.asistente_alias (alias, tipo, ref_id) VALUES (N'x', 'mesa', 2);`).then(() => null, (e) => e.message);
  check(!!tipo && /CK_asistente_alias_tipo/i.test(tipo), 'tipo fuera de la lista se rechaza (CHECK)');
  await q('DELETE FROM dbo.asistente_alias;');

  // ============================================================ 2
  seccion('2. Ventas sembradas');
  /*  Lunes 16/nov/2026 3 pm. Ocho semanas atrás:
        sábados   10:00  1 café   $30  EFECTIVO  ana
                  19:00  5 conchas $50 TARJETA   beto
                  (el 14/nov, además, 20:00 10 conchas $100 TARJETA beto)
        lunes     12:00  2 cafés  $60  EFECTIVO  ana
        hoy       11:00  1 café   $30  EFECTIVO  ana
      Concha $10 (costo $4), café $30 (costo $10); exentos: base = venta. */
  const AHORA = new Date(2026, 10, 16, 15, 0, 0);
  await q(`INSERT INTO dbo.users (usuario, password_hash, rol, active, creation_date) VALUES (N'qa_ana', N'x', N'cajero', 1, GETDATE()), (N'qa_beto', N'x', N'cajero', 1, GETDATE());
           INSERT INTO dbo.CAT_categories (namee) VALUES (N'QA Panadería'), (N'QA Bebidas');`);
  const ana = Number(await escalar(`SELECT id FROM dbo.users WHERE usuario = N'qa_ana';`));
  const beto = Number(await escalar(`SELECT id FROM dbo.users WHERE usuario = N'qa_beto';`));
  const pan = Number(await escalar(`SELECT id FROM dbo.CAT_categories WHERE namee = N'QA Panadería';`));
  const beb = Number(await escalar(`SELECT id FROM dbo.CAT_categories WHERE namee = N'QA Bebidas';`));
  const prod = async (pn, nombre, precio, costo, cat) => {
    await q(`INSERT INTO dbo.products (part_number, nombre, price, stock, category_id, cost, objeto_impuesto, tasa_iva, active, registrated_date, inventory_mode)
             VALUES (N'${pn}', N'${nombre}', ${precio}, 20, ${cat}, ${costo}, '01', 0, 1, GETDATE(), 'DIRECT');`);
    return Number(await escalar(`SELECT id FROM dbo.products WHERE part_number = N'${pn}';`));
  };
  const concha = await prod('QA-CONCHA', 'QA Concha', 10, 4, pan);
  const cafe = await prod('QA-CAFE', 'QA Café', 30, 10, beb);
  const venta = async (fecha, usuario, metodo, p, cant, precio, costo) => {
    await q(`INSERT INTO dbo.sales (datee, useer_id, total, payment_method, paid_amount, balance) VALUES ('${fecha}', ${usuario}, ${cant * precio}, '${metodo}', ${cant * precio}, 0);
             INSERT INTO dbo.sale_detail (sale_id, product_id, quantity, unitary_price, unit_cost, tax_object, tax_rate) VALUES (SCOPE_IDENTITY(), ${p}, ${cant}, ${precio}, ${costo}, '01', 0);`);
  };
  const dia = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  for (let s = 1; s <= 8; s++) {
    const sab = new Date(2026, 10, 16 - 2 - 7 * (s - 1));
    const lun = new Date(2026, 10, 16 - 7 * s);
    await venta(`${dia(sab)}T10:00:00`, ana, 'EFECTIVO', cafe, 1, 30, 10);
    await venta(`${dia(sab)}T19:00:00`, beto, 'TARJETA', concha, 5, 10, 4);
    await venta(`${dia(lun)}T12:00:00`, ana, 'EFECTIVO', cafe, 2, 30, 10);
  }
  await venta('2026-11-14T20:00:00', beto, 'TARJETA', concha, 10, 10, 4);
  await venta('2026-11-16T11:00:00', ana, 'EFECTIVO', cafe, 1, 30, 10);
  check(Number(await escalar('SELECT COUNT(*) FROM dbo.sales;')) === 26, '26 tickets sembrados');

  const consultar = async (texto, entradas = []) => {
    const req = pool.request();
    for (const [n, t, v] of entradas) req.input(n, t, v);
    return (await req.query(texto)).recordset || [];
  };
  const A = crearAnalitica({ q: consultar, sql });
  const rango = { desde: '2026-09-21T00:00:00', hasta: '2026-11-17T00:00:00' };

  // ============================================================ 3
  seccion('3. El cubo: filtros combinados');
  let x = await A.cubo.consultar({ filtros: rango });
  check(x.ventas === 1250 && x.tickets === 26, 'todo el periodo: $1,250 en 26 tickets', `${x.ventas} / ${x.tickets}`);
  x = await A.cubo.consultar({ filtros: { ...rango, diasSemana: [6], horaDesde: 18 } });
  check(x.ventas === 500 && x.tickets === 9, 'sábados después de las 6: $500 en 9 tickets', `${x.ventas} / ${x.tickets}`);
  x = await A.cubo.consultar({ filtros: { ...rango, metodo: 'EFECTIVO' } });
  check(x.ventas === 750, 'en efectivo: $750', x.ventas);
  x = await A.cubo.consultar({ filtros: { ...rango, metodo: 'TARJETA', diasSemana: [1] } });
  check(x.ventas === 0 && x.tickets === 0, 'con tarjeta los lunes: nada', `${x.ventas} / ${x.tickets}`);
  x = await A.cubo.consultar({ filtros: { ...rango, categorias: [beb] } });
  check(x.ventas === 750 && x.piezas === 25, 'categoría Bebidas: $750, 25 piezas', `${x.ventas} / ${x.piezas}`);
  x = await A.cubo.consultar({ filtros: { ...rango, cajero: beto } });
  check(x.ventas === 500, 'lo que cobró beto: $500', x.ventas);
  const porProd = await A.cubo.consultar({ filtros: rango, agrupar: 'producto', medidas: ['ganancia'], orden: 'ganancia' });
  const fc = porProd.find((f) => f.clave === concha), ff = porProd.find((f) => f.clave === cafe);
  check(fc && fc.piezas === 50 && fc.ventas === 500 && fc.costo === 200 && fc.ganancia === 300, 'concha: 50 piezas, $500, costo $200, ganancia $300',
    fc && `${fc.piezas} / ${fc.ventas} / ${fc.costo} / ${fc.ganancia}`);
  check(ff && ff.piezas === 25 && ff.ganancia === 500, 'café: 25 piezas, ganancia $500', ff && `${ff.piezas} / ${ff.ganancia}`);
  check(porProd[0]?.clave === cafe, 'ordenado por ganancia, el café va primero');
  const porHora = await A.cubo.consultar({ filtros: rango, agrupar: 'hora', orden: 'clave' });
  check(porHora.map((f) => `${f.clave}:${f.ventas}`).join(' ') === '10:240 11:30 12:480 19:400 20:100', 'por hora', porHora.map((f) => `${f.clave}:${f.ventas}`).join(' '));
  const porDia = await A.cubo.consultar({ filtros: rango, agrupar: 'diaSemana', orden: 'clave' });
  check(porDia.map((f) => `${f.clave}:${f.ventas}`).join(' ') === '1:510 6:740', 'por día de la semana (1 lunes, 6 sábado)', porDia.map((f) => `${f.clave}:${f.ventas}`).join(' '));

  // ============================================================ 4
  seccion('4. ¿Por qué? (últimos 7 días contra los 7 anteriores)');
  const pq = await A.porQue('semana', {}, AHORA);
  check(pq.ahora.ventas === 210 && pq.antes.ventas === 140, '$210 contra $140', `${pq.ahora.ventas} / ${pq.antes.ventas}`);
  check(pq.delta === 70 && pq.pct === 50, '+$70, +50%', `${pq.delta} / ${pq.pct}%`);
  check(cerca(pq.porTickets + pq.porPromedio, pq.delta), 'clientes + gasto por cliente suman el cambio', `${n2(pq.porTickets)} + ${n2(pq.porPromedio)}`);
  const cProd = pq.causas.find((c) => c.dimension === 'producto');
  check(cProd && cProd.miembros[0]?.nombre === 'QA Concha' && cProd.miembros[0].delta === 100, 'la causa por producto es la concha (+$100)',
    cProd && `${cProd.miembros[0]?.nombre} ${cProd.miembros[0]?.delta}`);
  check(!pq.causas.some((c) => c.miembros.some((m) => m.nombre === 'QA Café')), 'el café (que bajó) no sale como causa de la subida');

  // ============================================================ 5
  seccion('5. Pronóstico y cuándo se acaba');
  /* Tendencia: últimas 4 semanas $660 contra $560 → 1 + (660/560 − 1)/2. */
  const t = 1 + (660 / 560 - 1) / 2;
  const sab = await A.pronostico('2026-11-21', {}, AHORA);
  check(sab.semanas === 8 && cerca(sab.tendencia, t, 1e-6), 'sábado: 8 semanas, tendencia +8.9%', `${sab.semanas} / ${sab.tendencia}`);
  check(cerca(sab.estimado, ((80 * 28 + 180 * 8) / 36) * t), 'sábado: promedio ponderado × tendencia', `${n2(sab.estimado)} vs ${n2(((80 * 28 + 180 * 8) / 36) * t)}`);
  const lun = await A.pronostico('2026-11-23', {}, AHORA);
  check(cerca(lun.estimado, 60 * t), 'lunes: $60 × tendencia', n2(lun.estimado));
  const mar = await A.pronostico('2026-11-17', {}, AHORA);
  check(mar.estimado === 0 && mar.confianza === 'ninguna', 'martes (nunca abre): sin pronóstico', mar.confianza);
  const pzas = await A.pronostico('2026-11-21', { productos: [concha] }, AHORA);
  /* Las conchas tienen su propia tendencia: 30 piezas contra 20 → +25%, topada en +20%. */
  check(pzas.medida === 'piezas' && pzas.tendencia === 1.2 && cerca(pzas.estimado, ((5 * 28 + 15 * 8) / 36) * 1.2), 'con producto pronostica piezas (tendencia topada en +20%)',
    `${pzas.medida} ${n2(pzas.estimado)} · ×${pzas.tendencia}`);
  /* Concha, 4 semanas: 5+5+5+15 = 30 los sábados → 7.5 por sábado. 20 piezas: 12.5 · 5 · −2.5 → el 3er sábado. */
  const ag = await A.cuandoSeAcaba(concha, 20, AHORA);
  check(ag.fecha === '2026-12-05' && ag.dias === 19, 'con 20 conchas se acaba el sábado 5/dic', `${ag.fecha} (${ag.dias} días)`);
  const ag0 = await A.cuandoSeAcaba(cafe, 0, AHORA);
  check(ag0.dias === 0, 'sin existencia: se acabó hoy');

  // ============================================================ 6
  seccion('6. Hoy contra sus iguales');
  const hi = await A.hoyContraSusIguales(AHORA);
  check(hi && hi.hoy === 30 && hi.lugar === 9 && hi.de === 9 && hi.promedio === 60 && hi.peor, 'hoy $30: el peor de 9 lunes (promedio $60)', hi && JSON.stringify(hi));

  // ============================================================ 7
  seccion('7. La respuesta en palabras (acciones)');
  const acciones = crearAcciones({ sql, pool: async () => pool, sensores: {}, listarHallazgos: async () => [] });
  const filtros = { valor: { diasSemana: [6], horaDesde: 18, rango: { desde: '2026-09-21', hasta: '2026-11-17', nombre: 'Del 21 de septiembre al 16 de noviembre', de: 'del periodo' } }, texto: 'sábados después de las 6', confianza: 'exacto' };
  const r = await acciones.responder({ intent: 'consulta.hoy', puntaje: 1, alternativas: [], slots: { filtros }, falta: null, texto: 'cuanto vendi los sabados despues de las 6' },
    { userId: 1, usuario: 'qa', puede: () => true });
  check(/\$500/.test(r.texto) && /sábado/.test(r.texto), '«cuánto vendí los sábados después de las 6» → $500', r.texto.slice(0, 140));
  const rTop = await acciones.responder({ intent: 'venta.top', puntaje: 1, alternativas: [], slots: { filtros: { ...filtros, valor: { rango: filtros.valor.rango } } }, falta: null, texto: 'que es lo que mas vendo' },
    { userId: 1, usuario: 'qa', puede: () => true });
  check(/QA Concha/.test(rTop.texto), 'lo más vendido (en piezas) es la concha', rTop.texto.slice(0, 140));

  /* 8. Editar la ficha hablando. La tarjeta trae el antes → después y el
     payload del MISMO canal que la pantalla; aquí se ejecuta el mismo SP con
     ese payload para probar que el canal lo acepta. */
  seccion('8. Editar un producto: costo, código, IVA, impuesto y baja');
  const ctxTodo = { userId: 1, usuario: 'qa', puede: () => true };
  const pedir = (intent, slots) => acciones.responder({ intent, puntaje: 1, alternativas: [], slots, falta: null, texto: '' }, ctxTodo);
  const ex = (v, texto = String(v)) => ({ valor: v, texto, confianza: 'exacto' });
  await q(`UPDATE dbo.products SET bar_code = N'7501000111111' WHERE id = ${concha}; UPDATE dbo.products SET bar_code = N'7501000222222' WHERE id = ${cafe};`);
  const ejecutarFicha = async (p) => {
    const r = pool.request();
    for (const [k, t, v] of [['product_id', sql.Int, p.product_id], ['nombre', sql.NVarChar(100), p.nombre], ['precio', sql.Decimal(10, 2), p.precio],
      ['stock', sql.Decimal(10, 2), p.stock], ['numero_parte', sql.NVarChar(100), p.numero_parte], ['bar_code', sql.NVarChar(100), p.bar_code],
      ['tasa_iva', sql.Decimal(5, 4), p.tasa_iva], ['cost', sql.Decimal(14, 4), p.cost ?? null]]) r.input(k, t, v);
    await r.execute('sp_update_product');
  };
  const rCosto = await pedir('producto.editar', { producto: ex(concha, 'QA Concha'), campo: ex('costo'), valor: ex(5) });
  const pc = rCosto.plan;
  check(pc?.ejecutar?.api === 'electronAPI.actualizarProducto' && pc.vista[0].valor === '$4.00 → $5.00' && pc.ejecutar.payload.cost === 5,
    'costo: tarjeta $4.00 → $5.00 por el canal de la ficha', JSON.stringify(pc?.vista));
  check(/Ganancia/.test(pc.vista[1]?.etiqueta || ''), 'y muestra cómo queda la ganancia');
  await ejecutarFicha(pc.ejecutar.payload);
  check(Number(await escalar(`SELECT cost FROM dbo.products WHERE id = ${concha}`)) === 5 && Number(await escalar(`SELECT price FROM dbo.products WHERE id = ${concha}`)) === 10,
    'el SP con ese payload cambia el costo y deja el precio igual');
  const sinCostos = await acciones.responder({ intent: 'producto.editar', puntaje: 1, alternativas: [], falta: null, texto: '',
    slots: { producto: ex(concha), campo: ex('costo'), valor: ex(6) } }, { ...ctxTodo, puede: (x) => x !== 'VER_COSTOS' });
  check(!sinCostos.plan && /no puede cambiar el costo./.test(sinCostos.texto), 'sin permiso de ver costos no se ofrece cambiarlo', sinCostos.texto);

  const rCod = await pedir('producto.editar', { producto: ex(concha), campo: ex('codigo_barras'), valor: ex('7501000222222') });
  check(!rCod.plan && /QA Café/.test(rCod.texto), 'un código de barras que ya tiene otro producto se rechaza antes de la tarjeta', rCod.texto);
  const rCod2 = await pedir('producto.editar', { producto: ex(concha), campo: ex('codigo_barras'), valor: ex('7501000333333') });
  await ejecutarFicha(rCod2.plan.ejecutar.payload);
  check(await escalar(`SELECT bar_code FROM dbo.products WHERE id = ${concha}`) === '7501000333333', 'código nuevo guardado');
  const ivaAntes = await escalar(`SELECT tasa_iva FROM dbo.products WHERE id = ${cafe}`);
  const rIva = await pedir('producto.editar', { producto: ex(cafe), campo: ex('iva'), valor: ex(0.08) });
  check(/→ 8%$/.test(rIva.plan?.vista[0].valor || '') && rIva.plan.ejecutar.payload.tasa_iva === 0.08, `IVA: ${ivaAntes} → 8%`, JSON.stringify(rIva.plan?.vista));
  const rNom = await pedir('producto.editar', { producto: ex(concha), campo: ex('nombre'), valor: ex('QA Concha de vainilla') });
  await ejecutarFicha(rNom.plan.ejecutar.payload);
  check(await escalar(`SELECT nombre FROM dbo.products WHERE id = ${concha}`) === 'QA Concha de vainilla'
    && await escalar(`SELECT bar_code FROM dbo.products WHERE id = ${concha}`) === '7501000333333'
    && Number(await escalar(`SELECT cost FROM dbo.products WHERE id = ${concha}`)) === 5,
    'renombrar no toca el código ni el costo');

  const rImp = await pedir('producto.impuesto', { producto: ex(cafe), impuesto: { valor: { texto: 'ieps 8%', quitar: false }, texto: 'ieps 8%', confianza: 'exacto' } });
  const iepsId = Number(await escalar(`SELECT id FROM dbo.CAT_impuestos WHERE clave = 'IEPS_ALIMENTOS'`));
  check(rImp.plan?.ejecutar?.api === 'electronAPI.productoImpuestosGuardar' && rImp.plan.ejecutar.payload.impuestos.some((x) => x.id === iepsId),
    'IEPS 8%: la tarjeta guarda la lista con el IEPS de alimentos', JSON.stringify(rImp.plan?.ejecutar?.payload));
  await q(`EXEC dbo.sp_producto_impuestos_guardar @product_id = ${cafe}, @impuestos = N'${JSON.stringify(rImp.plan.ejecutar.payload.impuestos)}';`);
  const rQuita = await pedir('producto.impuesto', { producto: ex(cafe), impuesto: { valor: { texto: 'ieps', quitar: true }, texto: 'ieps', confianza: 'exacto' } });
  check(rQuita.plan && rQuita.plan.ejecutar.payload.impuestos.length === 0, 'quitar el IEPS deja la lista vacía', JSON.stringify(rQuita.plan?.ejecutar?.payload));

  const rBaja = await pedir('producto.baja', { producto: ex(cafe) });
  check(rBaja.plan?.ejecutar?.api === 'electronAPI.darDeBajaProducto' && rBaja.plan.ejecutar.args[0] === cafe, 'baja: por el canal de la ficha con el id');
} catch (e) {
  fallos++;
  console.log(`\n   ERROR  ${e.stack || e.message}`);
} finally {
  try { await pool?.close(); } catch { /* noop */ }
  if (!CONSERVAR) { eliminar(DB); console.log(`\nBase temporal ${DB} eliminada.`); }
}

console.log(`\nRESULTADO: ${fallos ? `${fallos} FALLO(S)` : 'todo bien'} (${pasos} comprobaciones)`);
process.exit(fallos ? 1 : 0);
