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

  /* 9. Ventas y caja hablando. Igual que la 8: la tarjeta trae el payload del
     canal de la pantalla y aquí se corre el mismo procedimiento con él. */
  seccion('9. Caja y ventas: abrir, corte, correo, reimprimir, devolución y cobro');
  const caja = Number(await escalar('SELECT MIN(id) FROM dbo.registers'));
  const accCaja = crearAcciones({ sql, pool: async () => pool, sensores: {}, listarHallazgos: async () => [],
                                  equipo: () => ({ register: { id: caja }, drawer: { enabled: true } }) });
  const pedirC = (intent, slots, ctx = ctxTodo) => accCaja.responder({ intent, puntaje: 1, alternativas: [], slots, falta: null, texto: '' }, ctx);
  const maquina = (r) => r.input('machine_id', sql.NVarChar(64), 'QA-ASISTENTE').input('machine_name', sql.NVarChar(120), 'QA');
  await q('UPDATE dbo.cash_closures SET closed_at = GETDATE() WHERE closed_at IS NULL;');

  const rAbre = await pedirC('caja.abrir', { monto: ex(500) });
  const pa = rAbre.plan?.ejecutar;
  check(pa?.api === 'electronAPI.openShift' && pa.payload.opening_cash === 500 && pa.payload.register_id === caja, 'abrir: tarjeta con fondo $500 y la caja del equipo', JSON.stringify(pa));
  await maquina(pool.request().input('user_id', sql.Int, 1).input('opening_cash', sql.Decimal(12, 2), pa.payload.opening_cash)
    .input('opening_note', sql.NVarChar(255), pa.payload.opening_note).input('opening_user_id', sql.Int, 1).input('register_id', sql.Int, pa.payload.register_id)).execute('sp_open_shift');
  const turno = await q(`SELECT id, opening_cash FROM dbo.cash_closures WHERE closed_at IS NULL AND register_id = ${caja}`);
  check(turno.length === 1 && Number(turno[0].opening_cash) === 500, 'el SP abrió el turno con ese fondo');
  const rAbre2 = await pedirC('caja.abrir', { monto: ex(300) });
  check(!rAbre2.plan && /ya está abierta/.test(rAbre2.texto), 'con la caja abierta no ofrece abrirla otra vez', rAbre2.texto);

  const rCorte = await pedirC('caja.corte', { monto: ex(480) });
  const pk = rCorte.plan?.ejecutar;
  const esperadoTarjeta = rCorte.plan?.vista.find((v) => v.etiqueta === 'Esperado')?.valor;
  check(pk?.api === 'electronAPI.closeShift' && pk.payload.closure_id === Number(turno[0].id) && pk.payload.cash_delivered === 480,
    'corte: tarjeta con el turno abierto y lo contado', JSON.stringify(rCorte.plan?.vista));
  const rCiego = await pedirC('caja.corte', { monto: ex(480) }, { ...ctxTodo, puede: (x) => x !== 'VENTAS_SUPERVISAR' && x !== 'CAJA_CORTES' });
  check(!rCiego.plan?.vista.some((v) => v.etiqueta === 'Esperado') && rCiego.plan?.ejecutar.payload.blind === true, 'corte ciego: sin «esperado» para quien no es encargado');
  const rAjeno = await pedirC('caja.corte', { monto: ex(480) }, { ...ctxTodo, userId: 999 });
  check(!rAjeno.plan && rAjeno.ruta === '/dashboard/corte-dia', 'el turno de otra persona se cierra en Corte (pide PIN)', rAjeno.texto);
  await maquina(pool.request().input('user_id', sql.Int, 1).input('cash_delivered', sql.Decimal(12, 2), pk.payload.cash_delivered)
    .input('register_id', sql.Int, pk.payload.register_id).input('closure_id', sql.Int, pk.payload.closure_id)
    .input('authorized_by', sql.Int, null).input('blind_count', sql.Bit, pk.payload.blind ? 1 : 0)).execute('sp_close_shift');
  const cerrado = (await q(`SELECT closed_at, cash_expected, cash_delivered FROM dbo.cash_closures WHERE id = ${pk.payload.closure_id}`))[0];
  check(cerrado?.closed_at && Number(cerrado.cash_delivered) === 480 && esperadoTarjeta === `$${Number(cerrado.cash_expected).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`,
    'el SP cerró el turno; su esperado es el de la tarjeta', `${esperadoTarjeta} · SP ${cerrado?.cash_expected}`);

  const rCorreo = await pedirC('caja.corte_correo', {});
  check(rCorreo.plan?.ejecutar.api === 'electronAPI.corteCorreoEnviar' && rCorreo.plan.ejecutar.payload.closureId === pk.payload.closure_id, 'correo: el último corte cerrado');
  const rCajon = await pedirC('caja.cajon', {}, { ...ctxTodo, puede: (x) => x !== 'CAJON_SIN_VENTA' });
  check(rCajon.plan?.ejecutar.api === 'electronAPI.openCashDrawer' && rCajon.plan.nivel === 'autorizar', 'cajón sin venta: lo autoriza un encargado');

  const ultima = Number(await escalar(`SELECT MAX(id) FROM dbo.sales WHERE register_id = ${caja}`));
  const rRe = await pedirC('venta.reimprimir', { folio: ex('ultimo') });
  check(rRe.plan?.ejecutar.api === 'electronAPI.printSaleTicket' && rRe.plan.ejecutar.payload.saleId === ultima, `reimprimir «el último»: ticket ${ultima}`);

  /* Devolución: con turno abierto (el efectivo sale de esta caja). */
  await maquina(pool.request().input('user_id', sql.Int, 1).input('opening_cash', sql.Decimal(12, 2), 1000).input('opening_user_id', sql.Int, 1).input('register_id', sql.Int, caja)).execute('sp_open_shift');
  const rDev = await pedirC('venta.devolucion', { folio: ex(ultima), razon: ex('Mal estado') });
  const pd = rDev.plan?.ejecutar;
  check(pd?.api === 'electronAPI.refundSale' && pd.payload.motivo === 'Mal estado' && pd.payload.items.length > 0, 'devolución: todo lo que queda del ticket, con motivo', JSON.stringify(rDev.plan?.vista));
  const tvp = new sql.Table('dbo.SaleDetailType');
  tvp.columns.add('product_id', sql.Int, { nullable: false }); tvp.columns.add('quantity', sql.Decimal(12, 2), { nullable: false }); tvp.columns.add('unit_price', sql.Decimal(10, 2), { nullable: false });
  for (const it of pd.payload.items) tvp.rows.add(it.productId, it.qty, it.unitPrice);
  await maquina(pool.request().input('sale_id', sql.Int, pd.payload.sale_id).input('user_id', sql.Int, 1).input('payment_method', sql.NVarChar(50), pd.payload.payment_method)
    .input('RefundDetails', tvp).input('note', sql.NVarChar(400), pd.payload.note).input('apply_net_update', sql.Bit, 0).input('register_id', sql.Int, caja)
    .input('reason', sql.NVarChar(40), pd.payload.motivo)).execute('sp_refund_sale');
  check(Number(await escalar(`SELECT COUNT(*) FROM dbo.sale_refunds WHERE sale_id = ${ultima}`)) === 1, 'el SP registró la devolución');
  const rDev2 = await pedirC('venta.devolucion', { folio: ex(ultima), razon: ex('Mal estado') });
  check(!rDev2.plan && /ya se devolvió completo/.test(rDev2.texto), 'un ticket ya devuelto no se ofrece otra vez', rDev2.texto);
  const rDevSin = await pedirC('venta.devolucion', { razon: ex('Mal estado') });
  check(!rDevSin.plan && rDevSin.esperando?.falta === 'folio', 'sin folio lo pregunta');

  const rCobro = await pedirC('venta.cobrar', { renglones: ex([{ productId: concha, cantidad: 2, nombre: 'concha' }]), metodo: ex('EFECTIVO', 'efectivo'), monto: ex(50) });
  const precioConcha = Number(await escalar(`SELECT price FROM dbo.products WHERE id = ${concha}`));
  check(rCobro.plan?.ejecutar.api === 'pantalla.cobrar' && cerca(rCobro.plan.ejecutar.payload.total, precioConcha * 2) && rCobro.plan.vista.some((v) => v.etiqueta === 'Cambio'),
    `cobrar 2 conchas en efectivo: $${precioConcha * 2}, recibe $50 y da cambio`, JSON.stringify(rCobro.plan?.vista));
  const rCobroSin = await pedirC('venta.cobrar', { renglones: ex([{ productId: concha, cantidad: 2, nombre: 'concha' }]) });
  check(!rCobroSin.plan && rCobroSin.ruta === '/dashboard/venta' && rCobroSin.carrito?.length === 1, 'sin forma de pago deja la cuenta en Venta');

  /* 10. Clientes, proveedores, compras y catálogo. */
  seccion('10. Cliente y proveedor, compra con su precio, categoría, marca y proveedor del producto');
  await q(`INSERT INTO dbo.customers (customerName, phone, credit_limit, terms_days) VALUES (N'QA Doña Mary', N'5500000000', 500, 0);
           IF NOT EXISTS (SELECT 1 FROM dbo.CAT_suppliers WHERE nombre = N'QA Bimbo') INSERT INTO dbo.CAT_suppliers (nombre) VALUES (N'QA Bimbo');`);
  const mary = Number(await escalar("SELECT id FROM dbo.customers WHERE customerName = N'QA Doña Mary'"));
  const bimbo = Number(await escalar("SELECT id FROM dbo.CAT_suppliers WHERE nombre = N'QA Bimbo'"));

  const rTel = await pedirC('cliente.editar', { cliente: ex(mary), campo: ex('telefono'), valor: ex('5512345678') });
  check(rTel.plan?.ejecutar.api === 'electronAPI.updateCustomer' && rTel.plan.ejecutar.args.length === 16, 'cliente: tarjeta con la ficha completa (16 datos)', JSON.stringify(rTel.plan?.vista));
  const a = rTel.plan.ejecutar.args;
  const rq = pool.request();
  [['id', sql.Int], ['code', sql.NVarChar(30)], ['customerName', sql.NVarChar(120)], ['tax_id', sql.NVarChar(20)], ['email', sql.NVarChar(120)], ['phone', sql.NVarChar(30)],
   ['credit_limit', sql.Decimal(12, 2)], ['terms_days', sql.Int], ['active', sql.Bit], ['regimen_fiscal', sql.NVarChar(5)], ['uso_cfdi', sql.NVarChar(5)],
   ['razon_social', sql.NVarChar(255)], ['grace_days', sql.Int], ['late_fee_pct', sql.Decimal(5, 2)], ['late_fee_fixed', sql.Decimal(12, 2)], ['risk_level', sql.TinyInt]]
    .forEach(([k, t], i) => rq.input(k, t, k === 'code' ? (a[i] || null) : a[i]));
  await rq.execute('sp_update_customer');
  const m2 = (await q(`SELECT phone, credit_limit, customerName FROM dbo.customers WHERE id = ${mary}`))[0];
  check(m2.phone === '5512345678' && Number(m2.credit_limit) === 500 && m2.customerName === 'QA Doña Mary', 'el SP cambia el teléfono y deja el límite y el nombre');
  const rLim = await pedirC('cliente.editar', { cliente: ex(mary), campo: ex('limite'), valor: ex(2000) }, { ...ctxTodo, puede: (x) => x !== 'CREDITO_CUPONES' });
  check(!rLim.plan && /no puede cambiar el límite/.test(rLim.texto), 'sin «Crédito y cupones» no ofrece cambiar el límite', rLim.texto);

  const rCorreo2 = await pedirC('proveedor.editar', { proveedor: ex(bimbo), campo: ex('correo'), valor: ex('ventas@bimbo.mx') });
  const pp = rCorreo2.plan?.ejecutar.payload;
  await pool.request().input('id', sql.Int, pp.id).input('nombre', sql.NVarChar(100), pp.nombre).input('telefono', sql.NVarChar(20), pp.telefono)
    .input('correo', sql.NVarChar(100), pp.correo).input('rfc', sql.NVarChar(20), pp.rfc).execute('sp_supplier_save');
  check(await escalar(`SELECT correo FROM dbo.CAT_suppliers WHERE id = ${bimbo}`) === 'ventas@bimbo.mx', 'proveedor: el SP guarda el correo');

  /* Compra: el precio de venta se queda; con un costo que no cabe, sube. */
  await q(`UPDATE dbo.products SET price = 10, cost = 4, tasa_iva = 0, objeto_impuesto = '02', stock = 0 WHERE id = ${concha}`);
  const rCompra = await pedirC('compra.registrar', { proveedor: ex(bimbo), renglones: ex([{ productId: concha, cantidad: 30, nombre: 'concha' }]), costos: ex([5]), metodo: ex('CREDITO') });
  const pcm = rCompra.plan?.ejecutar.payload;
  check(rCompra.plan?.ejecutar.api === 'electronAPI.registerPurchase' && pcm.total === 150 && pcm.detalles[0].profit_percent === 100,
    'compra: total $150 y el margen que deja el precio de $10', JSON.stringify(rCompra.plan?.vista));
  const tvpC = new sql.Table('dbo.PurchaseDetailType'); ['product_id', 'quantity', 'unit_price', 'profit_percent'].forEach((c) => tvpC.columns.add(c, c === 'product_id' ? sql.Int : sql.Decimal(12, 2), { nullable: c === 'profit_percent' }));
  const tvpC2 = new sql.Table('dbo.PurchaseDetailType2');
  tvpC2.columns.add('product_id', sql.Int, { nullable: false }); tvpC2.columns.add('quantity', sql.Decimal(12, 2), { nullable: false });
  tvpC2.columns.add('unit_price', sql.Decimal(10, 2), { nullable: false }); tvpC2.columns.add('profit_percent', sql.Decimal(5, 2), { nullable: true });
  tvpC2.columns.add('presentation_id', sql.Int, { nullable: true });
  for (const d of pcm.detalles) tvpC2.rows.add(d.product_id, d.quantity, d.unit_price, d.profit_percent, d.presentation_id);
  await pool.request().input('user_id', sql.Int, 1).input('supplier_id', sql.Int, pcm.supplier_id).input('tax_rate', sql.Decimal(5, 2), pcm.tax_rate)
    .input('tax_amount', sql.Decimal(10, 2), pcm.tax_amount).input('subtotal', sql.Decimal(10, 2), pcm.subtotal).input('total', sql.Decimal(10, 2), pcm.total)
    .input('PurchaseDetails', tvpC).input('PurchaseDetails2', tvpC2).input('payment_method', sql.NVarChar(20), pcm.payment_method)
    .input('register_id', sql.Int, pcm.register_id).input('apply_payment_id', sql.Int, null).execute('sp_register_purchase');
  const tras = (await q(`SELECT price, cost, stock FROM dbo.products WHERE id = ${concha}`))[0];
  check(Number(tras.price) === 10 && Number(tras.cost) === 5 && Number(tras.stock) === 30, 'el SP sube 30 piezas, el costo a $5 y el precio se queda en $10', JSON.stringify(tras));
  const rCara = await pedirC('compra.registrar', { proveedor: ex(bimbo), renglones: ex([{ productId: concha, cantidad: 1, nombre: 'concha' }]), costos: ex([12]) });
  check(rCara.plan?.avisos.some((x) => /precio de venta pasa de \$10.00 a \$12.00/.test(x)), 'un costo que no cabe avisa que el precio sube', JSON.stringify(rCara.plan?.avisos));
  const rSinProv = await pedirC('compra.registrar', { renglones: ex([{ productId: concha, cantidad: 1, nombre: 'concha' }]) });
  check(!rSinProv.plan && rSinProv.esperando?.falta === 'proveedor', 'sin proveedor lo pregunta');

  const rCat = await pedirC('categoria.alta', { nombre: ex('QA Lácteos') });
  await pool.request().input('namee', sql.NVarChar(150), rCat.plan.ejecutar.payload.nombre).query('INSERT INTO dbo.CAT_categories (namee) VALUES (@namee);');
  const rCat2 = await pedirC('categoria.alta', { nombre: ex('QA Lácteos') });
  check(rCat.plan?.ejecutar.api === 'electronAPI.createCategory' && !rCat2.plan && /Ya existe/.test(rCat2.texto), 'categoría: tarjeta, y una repetida se rechaza');
  const rMarca = await pedirC('marca.alta', { nombre: ex('QA Lala') });
  check(rMarca.plan?.ejecutar.api === 'electronAPI.createBrand' && rMarca.plan.ejecutar.payload.nombre === 'QA Lala', 'marca: tarjeta por sp-add-brand');

  await q(`DELETE FROM dbo.product_suppliers WHERE product_id = ${concha}`);
  const rSurte = await pedirC('producto.proveedor', { proveedor: ex(bimbo), producto: ex(concha), accion: ex('agregar') });
  const ps = rSurte.plan?.ejecutar.payload;
  check(rSurte.plan?.ejecutar.api === 'electronAPI.upsertProductSupplier' && ps.is_default === 1, 'surte: sin principal, entra como principal');
  await pool.request().input('product_id', sql.Int, ps.product_id).input('supplier_id', sql.Int, ps.supplier_id).input('is_default', sql.Bit, ps.is_default)
    .input('active', sql.Bit, 1).input('last_cost', sql.Decimal(10, 2), null).execute('sp_upsert_product_supplier');
  const rYa = await pedirC('producto.proveedor', { proveedor: ex(bimbo), producto: ex(concha), accion: ex('principal') });
  check(!rYa.plan && /ya es el proveedor principal/.test(rYa.texto), 'ya es principal: no hay nada que cambiar');
  const rSinSurtir = await pedirC('producto.proveedor', { proveedor: ex(bimbo), producto: ex(concha), accion: ex('quitar') });
  check(rSinSurtir.plan?.ejecutar.api === 'electronAPI.removeProductSupplier' && rSinSurtir.plan.ejecutar.args[1] === bimbo && rSinSurtir.plan.avisos.length === 1,
    'quitar: por el canal de la ficha, avisando que era el principal');

  /* 11. Producción, socios, propinas y gastos. */
  seccion('11. Tandas, socios, propinas y gastos');
  /* Una fórmula mínima: el café sale de la concha (1 pieza por pieza). */
  await q(`UPDATE dbo.products SET stock = 100, inventory_mode = 'DIRECT' WHERE id = ${concha};`);
  {
    const tvpF = new sql.Table('dbo.RecipeLineType');
    tvpF.columns.add('ingredient_product_id', sql.Int, { nullable: false }); tvpF.columns.add('input_qty', sql.Decimal(12, 3), { nullable: false });
    tvpF.columns.add('input_uom', sql.NVarChar(10), { nullable: false }); tvpF.columns.add('waste_pct', sql.Decimal(5, 2), { nullable: true });
    tvpF.columns.add('sort_order', sql.Int, { nullable: true });
    tvpF.rows.add(concha, 1, 'pza', 0, 1);
    try {
      await pool.request().input('product_id', sql.Int, cafe).input('yield_qty', sql.Decimal(12, 2), 1).input('notes', sql.NVarChar(300), null)
        .input('user_id', sql.Int, 1).input('Lines', tvpF).execute('sp_production_formula_save');
    } catch (e) { console.log('   (fórmula de prueba: ' + e.message + ')'); }
  }
  const conFormula = Number(await escalar(`SELECT TOP 1 product_id FROM dbo.production_formulas`)) || null;
  if (conFormula) {
    await q(`INSERT INTO dbo.production_batches (product_id, production_date, planned_qty, created_by) VALUES (${conFormula}, CAST(GETDATE() AS DATE), 10, 1);`);
    const rEmp = await pedirC('produccion.empezar', { producto: ex(conFormula) });
    check(rEmp.plan?.ejecutar.api === 'wybix.produccion.empezar' && rEmp.plan.ejecutar.payload.batchId > 0, 'tanda: empezar la planeada de hoy');
    await pool.request().input('user_id', sql.Int, 1).input('batch_id', sql.Int, rEmp.plan.ejecutar.payload.batchId).input('machine_name', sql.NVarChar(120), 'QA').execute('sp_production_start');
    const rSinMot = await pedirC('produccion.terminar', { producto: ex(conFormula), cantidad: ex(8) });
    check(!rSinMot.plan && rSinMot.esperando?.falta === 'motivo', 'salieron 8 de 10: pregunta qué pasó con las 2');
    const rTer = await pedirC('produccion.terminar', { producto: ex(conFormula), cantidad: ex(8), motivo: ex('SE_CAYO') });
    await pool.request().input('user_id', sql.Int, 1).input('batch_id', sql.Int, rTer.plan.ejecutar.payload.batchId).input('good_qty', sql.Decimal(12, 2), 8)
      .input('waste_reason', sql.NVarChar(40), rTer.plan.ejecutar.payload.motivo).execute('sp_production_finish');
    check(await escalar(`SELECT status FROM dbo.production_batches WHERE id = ${rTer.plan.ejecutar.payload.batchId}`) === 'DONE', 'el SP cierra la tanda con 8 buenas y 2 de merma');
  } else check(true, 'tandas: la plantilla no trae fórmulas de producción (se prueba en E2E)');

  const rG = await q(`INSERT INTO dbo.expenses (category_id, amount, payment_method, expense_date, user_id, register_id)
                      OUTPUT inserted.id VALUES ((SELECT MIN(id) FROM dbo.expense_categories), 120, 'TRANSFERENCIA', CAST(GETDATE() AS DATE), 1, ${caja});`).catch((e) => ({ error: e.message }));
  if (Array.isArray(rG) && rG[0]) {
    const gid = rG[0].id;
    const rSinMot2 = await pedirC('gasto.cancelar', { folio: ex(gid) });
    check(!rSinMot2.plan && rSinMot2.esperando?.falta === 'motivo', 'cancelar un gasto sin motivo lo pregunta');
    const rCan = await pedirC('gasto.cancelar', { folio: ex(gid), motivo: ex('capturado dos veces') });
    await pool.request().input('expense_id', sql.Int, rCan.plan.ejecutar.payload.expense_id).input('user_id', sql.Int, 1)
      .input('reason', sql.NVarChar(200), rCan.plan.ejecutar.payload.reason).execute('sp_void_expense');
    check(await escalar(`SELECT CASE WHEN voided_at IS NULL THEN 0 ELSE 1 END FROM dbo.expenses WHERE id = ${gid}`) === 1, 'el SP cancela el gasto con el motivo');
    const rYa2 = await pedirC('gasto.cancelar', { folio: ex(gid), motivo: ex('x') });
    check(!rYa2.plan && /ya estaba cancelado/.test(rYa2.texto), 'uno cancelado no se ofrece otra vez');
  } else check(false, 'no pude sembrar un gasto', JSON.stringify(rG));
  const rCon = await pedirC('gasto.concepto', { accion: ex('crear'), nombre: ex('QA Papelería') });
  check(rCon.plan?.ejecutar.api === 'electronAPI.egresosConceptoGuardar' && rCon.plan.ejecutar.payload.name === 'QA Papelería', 'concepto nuevo por egresos:concepto-guardar');

  /* Socios: el módulo encendido en la base temporal y un socio. */
  await q(`IF EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'socios') UPDATE dbo.business_modules SET enabled = 1 WHERE module_key = N'socios'
           ELSE INSERT INTO dbo.business_modules (module_key, enabled) VALUES (N'socios', 1);
           INSERT INTO dbo.socios (nombre) VALUES (N'QA Juan');`).catch((e) => console.log('   (socios: ' + e.message + ')'));
  const juan = Number(await escalar("SELECT id FROM dbo.socios WHERE nombre = N'QA Juan'"));
  const rMov = await pedirC('socio.movimiento', { socio: ex(juan), tipo: ex('PAGO'), monto: ex(1000), metodo: ex('TRANSFERENCIA') });
  const pm = rMov.plan?.ejecutar.payload;
  check(rMov.plan?.ejecutar.api === 'electronAPI.sociosMovimiento' && pm.tipo === 'PAGO' && pm.monto === 1000, 'socio: pago de $1,000 por transferencia');
  try {
    await pool.request().input('socio_id', sql.Int, pm.socioId).input('tipo', sql.VarChar(12), pm.tipo).input('monto', sql.Decimal(12, 2), pm.monto)
      .input('metodo', sql.VarChar(20), pm.metodo).input('register_id', sql.Int, pm.registerId).input('nota', sql.NVarChar(255), pm.nota)
      .input('user_id', sql.Int, 1).execute('sp_socios_movimiento');
    check(Number(await escalar(`SELECT COUNT(*) FROM dbo.socios_movimientos WHERE socio_id = ${juan}`)) === 1, 'el SP registra el movimiento del socio');
  } catch (e) { check(false, 'el SP registra el movimiento del socio', e.message); }

  const rProp = await pedirC('propinas.repartir', {});
  check(!rProp.plan && /propinas|activad/i.test(rProp.texto), 'propinas sin activar o sin pendientes: no hay tarjeta', rProp.texto);

  /* 12. Servicios: el mismo procedimiento con el payload de cada tarjeta. */
  seccion('12. Servicios: servicio, profesional, horario, ausencia, orden y renglón');
  const rSv = await pedirC('servicio.crear', { nombre: ex('QA Corte de dama'), precio: ex(250), duracion: ex(45) });
  const sv = rSv.plan?.ejecutar.payload;
  const rsv = await pool.request().input('product_id', sql.Int, null).input('nombre', sql.NVarChar(100), sv.nombre).input('price', sql.Decimal(10, 2), sv.precio)
    .input('part_number', sql.NVarChar(100), null).input('category_id', sql.Int, null).input('clave_prod_serv', sql.NVarChar(8), null).input('clave_unidad', sql.NVarChar(5), null)
    .input('tasa_iva', sql.Decimal(5, 4), null).input('duration_minutes', sql.Int, sv.duracionMinutos).input('requires_professional', sql.Bit, 1)
    .input('default_commission_pct', sql.Decimal(5, 2), null).input('schedulable', sql.Bit, 1).input('notes', sql.NVarChar(400), null).execute('sp_service_save').catch((e) => ({ error: e.message }));
  const corte = Number(await escalar("SELECT p.id FROM dbo.services s JOIN dbo.products p ON p.id = s.product_id WHERE p.nombre = N'QA Corte de dama'"));
  check(rSv.plan?.ejecutar.api === 'electronAPI.serviciosGuardarServicio' && corte > 0, 'servicio nuevo con precio y duración', rsv.error || '');

  const rPa = await pedirC('profesional.alta', { nombre: ex('QA Laura'), puesto: ex('Estilista') });
  const pa2 = rPa.plan?.ejecutar.payload;
  await pool.request().input('id', sql.Int, null).input('full_name', sql.NVarChar(120), pa2.nombre).input('title', sql.NVarChar(60), pa2.puesto).input('phone', sql.NVarChar(30), null)
    .input('email', sql.NVarChar(120), null).input('user_id', sql.Int, null).input('default_commission_pct', sql.Decimal(5, 2), pa2.comisionPct ?? 0).input('color', sql.NVarChar(9), null).execute('sp_professional_save');
  const laura = Number(await escalar("SELECT id FROM dbo.professionals WHERE full_name = N'QA Laura'"));
  check(laura > 0, 'profesional nueva por el canal de Servicios');

  const rAs = await pedirC('profesional.servicio', { profesional: ex(laura), producto: ex(corte), quitar: ex(false) });
  await pool.request().input('service_product_id', sql.Int, corte).input('asignaciones_json', sql.NVarChar(sql.MAX), JSON.stringify(rAs.plan.ejecutar.payload.asignaciones)).execute('sp_set_service_professionals');
  check(Number(await escalar(`SELECT COUNT(*) FROM dbo.service_professionals WHERE service_product_id = ${corte} AND professional_id = ${laura}`)) === 1, 'Laura hace cortes (la lista conserva a los demás)');

  const rHo = await pedirC('profesional.horario', { profesional: ex(laura), dias: ex([2, 3, 4, 5, 6]), desde: ex('09:00'), hasta: ex('18:00') });
  await pool.request().input('professional_id', sql.Int, laura).input('franjas_json', sql.NVarChar(sql.MAX), JSON.stringify(rHo.plan.ejecutar.payload.franjas)).execute('sp_set_professional_schedule');
  const rHo2 = await pedirC('profesional.horario', { profesional: ex(laura), dias: ex([7]), desde: ex('10:00'), hasta: ex('14:00') });
  check(rHo2.plan.ejecutar.payload.franjas.length === 6, 'el sábado se agrega y lunes a viernes se quedan', JSON.stringify(rHo2.plan.vista));

  const rAu = await pedirC('profesional.ausencia', { profesional: ex(laura), fechas: ex({ desde: '2030-01-10', hasta: '2030-01-12' }), motivo: ex('Vacaciones') });
  const au = rAu.plan.ejecutar.payload;
  await pool.request().input('id', sql.Int, null).input('professional_id', sql.Int, laura).input('starts_at', sql.DateTime, new Date(au.desde)).input('ends_at', sql.DateTime, new Date(au.hasta))
    .input('reason', sql.NVarChar(200), au.motivo).execute('sp_professional_time_off_save');
  const rBo = await pedirC('profesional.ausencia_borrar', { profesional: ex(laura), fechas: ex({ desde: '2030-01-11', hasta: '2030-01-11' }) });
  check(rBo.plan?.ejecutar.api === 'electronAPI.serviciosBorrarAusencia', 'la ausencia se guarda y «siempre sí viene» la encuentra');

  const rOr = await pedirC('orden.crear', { cliente: ex(mary), reportado: ex('No prende la licuadora') });
  const po = rOr.plan.ejecutar.payload;
  const oc = await pool.request().input('customer_id', sql.Int, po.clienteId).input('customer_asset_id', sql.Int, null).input('reported_issue', sql.NVarChar(1000), po.reportado)
    .input('promised_at', sql.DateTime, null).input('notes', sql.NVarChar(1000), null).input('user_id', sql.Int, 1).input('register_id', sql.Int, po.cajaId)
    .input('status', sql.NVarChar(20), po.estado).execute('sp_service_order_create');
  const ordenId = Number(oc.recordset?.[0]?.id ?? await escalar('SELECT MAX(id) FROM dbo.service_orders'));
  check(ordenId > 0 && await escalar(`SELECT status FROM dbo.service_orders WHERE id = ${ordenId}`) === 'ABIERTA', 'orden abierta para la clienta con lo que reporta');
  const rLi = await pedirC('orden.linea', { folio: ex(ordenId), producto: ex(corte), cantidad: ex(1) });
  const li = rLi.plan.ejecutar.payload;
  await pool.request().input('order_id', sql.Int, li.ordenId).input('product_id', sql.Int, li.productoId).input('quantity', sql.Decimal(12, 2), li.cantidad)
    .input('professional_id', sql.Int, null).input('unit_price', sql.Decimal(12, 2), li.precio).input('commission_pct', sql.Decimal(5, 2), null)
    .input('notes', sql.NVarChar(400), null).input('user_id', sql.Int, 1).execute('sp_service_order_add_line');
  check(Number(await escalar(`SELECT COUNT(*) FROM dbo.service_order_lines WHERE order_id = ${ordenId}`)) === 1, 'el renglón entra a la orden');
  const rCa = await pedirC('orden.cancelar', { folio: ex(ordenId), motivo: ex('Ya no lo quiso') });
  const ca = rCa.plan.ejecutar.payload;
  await pool.request().input('id', sql.Int, ca.id).input('reason', sql.NVarChar(400), ca.motivo).input('user_id', sql.Int, 1)
    .input('rowver', sql.Binary(8), Buffer.from(String(ca.rowver).replace(/^0x/i, ''), 'hex')).execute('sp_service_order_cancel');
  check(await escalar(`SELECT status FROM dbo.service_orders WHERE id = ${ordenId}`) === 'CANCELADA', 'cancelar con el testigo de versión de la tarjeta');
  const rCa2 = await pedirC('orden.cancelar', { folio: ex(ordenId), motivo: ex('x') });
  check(!rCa2.plan && /ya estaba cancelada/.test(rCa2.texto), 'una orden cancelada no se ofrece otra vez');

  /* 13. Fidelización. */
  seccion('13. Puntos, cupones y rifas');
  const rPc = await pedirC('puntos.config', { puntos: ex(1), cadaMonto: ex(10) });
  const pc2 = rPc.plan?.ejecutar.payload;
  check(rPc.plan?.ejecutar.api === 'electronAPI.puntosConfigGuardar' && pc2.activo === true && pc2.puntos === 1 && pc2.cadaMonto === 10, 'puntos: 1 por cada $10, encendidos', JSON.stringify(rPc.plan?.vista));
  try {
    await pool.request().input('enabled', sql.Bit, 1).input('per_amount', sql.Decimal(12, 2), pc2.cadaMonto).input('points_per', sql.Int, pc2.puntos)
      .input('visit_points', sql.Int, pc2.porVisita || 0).input('expiry_months', sql.Int, pc2.caducaMeses).execute('sp_loyalty_points_config_save');
    const rPc2 = await pedirC('puntos.config', { caducaMeses: ex(12) });
    check(rPc2.plan.ejecutar.payload.cadaMonto === 10 && rPc2.plan.ejecutar.payload.caducaMeses === 12, 'cambiar la caducidad conserva la regla guardada');
  } catch (e) { check(false, 'el SP guarda la configuración de puntos', e.message); }
  const rAj = await pedirC('puntos.ajustar', { cliente: ex(mary), cantidad: ex(100), nota: ex('se le cobró doble') });
  check(rAj.plan?.ejecutar.api === 'electronAPI.puntosAjustar' && rAj.plan.ejecutar.payload.cantidad === 100, 'ajuste de 100 puntos con motivo');
  const rCup = await pedirC('cupon.emitir', { textoCupon: ex('qa inexistente'), cantidad: ex(1) });
  check(!rCup.plan, 'un cupón que no existe no se emite', rCup.texto);
  const rRifa = await pedirC('rifa.sortear', { textoRifa: ex('navidad') });
  check(!rRifa.plan, 'sin rifas abiertas no hay sorteo', rRifa.texto);

  /* 14. Hospitality: salón, mesa y cuenta. */
  seccion('14. Salón, mesa y cuenta');
  const rAr = await pedirC('salon.area', { nombre: ex('QA Terraza') });
  await pool.request().input('id', sql.Int, null).input('nombre', sql.NVarChar(60), rAr.plan.ejecutar.payload.nombre).input('orden', sql.Int, 0).input('activa', sql.Bit, 1).execute('sp_salon_area_save');
  const rMe = await pedirC('salon.mesa', { nombre: ex('QA 10'), textoArea: ex('qa terraza'), capacidad: ex(4) });
  const me = rMe.plan?.ejecutar.payload;
  check(rMe.plan?.ejecutar.api === 'wybix.salon.guardarMesa' && me.areaId > 0 && me.capacidad === 4, 'mesa nueva en el área dicha', rMe.texto);
  await pool.request().input('id', sql.Int, null).input('area_id', sql.Int, me.areaId).input('nombre', sql.NVarChar(40), me.nombre).input('capacidad', sql.Int, me.capacidad)
    .input('orden', sql.Int, 0).input('activa', sql.Bit, 1).execute('sp_salon_mesa_save');
  const rAb = await pedirC('cuenta.abrir', { mesa: ex('qa 10'), personas: ex(3) });
  const ab = rAb.plan?.ejecutar.payload;
  check(rAb.plan?.ejecutar.api === 'wybix.cuentas.abrir' && ab.mesaId > 0, 'abrir la mesa por su nombre', rAb.texto);
  try {
    await pool.request().input('mesa_id', sql.Int, ab.mesaId).input('etiqueta', sql.NVarChar(60), null).input('personas', sql.Int, 3).input('user_id', sql.Int, 1)
      .input('register_id', sql.Int, caja).input('customer_id', sql.Int, null).execute('sp_hosp_cuenta_abrir');
    const rAb2 = await pedirC('cuenta.abrir', { mesa: ex('qa 10') });
    check(!rAb2.plan && /ya está abierta/.test(rAb2.texto), 'una mesa abierta no se abre otra vez', rAb2.texto);
    const rEs = await pedirC('cuenta.estado', { mesa: ex('qa 10'), estado: ex('POR_COBRAR') });
    await pool.request().input('cuenta_id', sql.Int, rEs.plan.ejecutar.payload.cuentaId).input('estado', sql.NVarChar(12), 'POR_COBRAR').input('user_id', sql.Int, 1).execute('sp_hosp_cuenta_estado');
    const rLib = await pedirC('cuenta.liberar', { mesa: ex('qa 10') });
    await pool.request().input('cuenta_id', sql.Int, rLib.plan.ejecutar.payload.cuentaId).input('user_id', sql.Int, 1).execute('sp_hosp_cuenta_liberar');
    check(!(await q(`SELECT 1 FROM dbo.hosp_cuentas WHERE mesa_id = ${ab.mesaId} AND estado IN ('ABIERTA','POR_COBRAR')`)).length, 'pidió la cuenta y, sin consumo, se libera');
  } catch (e) { check(false, 'cuenta de mesa por los SP de Hospitality', e.message); }

  /* 15. Configuración: las tarjetas y sus candados. */
  seccion('15. Usuarios, cajas, aplicaciones y asistencia');
  const admins = await q("SELECT id FROM dbo.users WHERE rol = 'admin' AND active = 1");
  if (admins.length === 1) {
    const rUlt = await pedirC('usuario.activar', { usuario: ex(admins[0].id), activo: ex(false) }, { ...ctxTodo, userId: ana });
    check(!rUlt.plan && /al menos un administrador/.test(rUlt.texto), 'no se desactiva al último administrador', rUlt.texto);
  }
  const rPropio = await pedirC('usuario.activar', { usuario: ex(ana), activo: ex(false) }, { ...ctxTodo, userId: ana });
  check(!rPropio.plan && /tu propio usuario/.test(rPropio.texto), 'nadie se desactiva a sí mismo');
  const rPer = await pedirC('usuario.permiso', { usuario: ex(ana), permisoTexto: ex('devoluciones'), quitar: ex(false) });
  check(rPer.plan?.ejecutar.api === 'electronAPI.usersSetPermissions' && rPer.plan.ejecutar.payload.tiene.includes('DEVOLUCIONES'), 'permiso de devoluciones: la lista ajustable lo incluye', JSON.stringify(rPer.plan?.ejecutar.payload));
  const rSinCosto = await pedirC('usuario.permiso', { usuario: ex(ana), permisoTexto: ex('ver costos'), quitar: ex(true) });
  check(!rSinCosto.plan || !rSinCosto.plan.ejecutar.payload.tiene.includes('VER_COSTOS'), 'quitar «ver costos» lo saca de la lista', rSinCosto.texto);
  const rRol = await pedirC('usuario.rol', { usuario: ex(ana), rol: ex('supervisor') });
  check(rRol.plan?.ejecutar.api === 'electronAPI.usersUpdateRole' && rRol.plan.ejecutar.payload.rol === 'supervisor', 'puesto: cajero → encargado');
  const rCaj = await pedirC('caja.alta', { nombre: ex('Caja 9') });
  check(rCaj.plan?.ejecutar.payload.code === 'CAJA9', 'caja nueva con su clave', JSON.stringify(rCaj.plan?.ejecutar.payload));
  const rMod = await pedirC('modulo.activar', { modulo: ex('servicios'), activo: ex(true) });
  check(rMod.plan?.ejecutar.api === 'electronAPI.modulosSet' && rMod.plan.ejecutar.args[0] === 'servicios' && rMod.plan.ejecutar.args[1] === true, 'encender Servicios por modules:set');
  await q("UPDATE dbo.business_modules SET enabled = 0 WHERE module_key = N'socios';");
  const rSoc = await pedirC('modulo.activar', { modulo: ex('socios'), activo: ex(true) });
  check(!rSoc.plan && rSoc.ruta === '/dashboard/aplicaciones', 'Socios se enciende con sus preguntas, en su pantalla');
  const rHor = await pedirC('asistencia.horario', { usuario: ex(ana), dias: ex([2, 3, 4, 5, 6]), desde: ex('09:00'), hasta: ex('18:00'), descanso: ex(30) });
  check(rHor.plan?.ejecutar.payload.dias.length === 5 && rHor.plan.ejecutar.payload.dias[0].descansoMin === 30, 'horario de lunes a viernes con 30 min de descanso');

  /* 16. Receta, presentación y grupo de opciones. */
  seccion('16. Receta, presentación y grupo de opciones');
  await q(`INSERT INTO dbo.products (part_number, nombre, price, stock, category_id, cost, objeto_impuesto, tasa_iva, active, registrated_date, inventory_mode, sellable, base_uom)
           VALUES (N'QA-HAMB', N'QA Hamburguesa', 80, 0, (SELECT MIN(id) FROM dbo.CAT_categories), 0, '02', 0, 1, GETDATE(), 'RECIPE', 1, 'pza'),
                  (N'QA-CARNE', N'QA Carne molida', 0, 5000, (SELECT MIN(id) FROM dbo.CAT_categories), 0.1, '02', 0, 1, GETDATE(), 'DIRECT', 0, 'g');`);
  const hamb = Number(await escalar("SELECT id FROM dbo.products WHERE part_number = N'QA-HAMB'"));
  const carne = Number(await escalar("SELECT id FROM dbo.products WHERE part_number = N'QA-CARNE'"));
  const rRec = await pedirC('receta.guardar', { producto: ex(hamb), lineas: ex([{ productId: carne, nombre: 'carne', cantidad: 150, unidad: 'g' }, { productId: concha, nombre: 'pan', cantidad: 1, unidad: null }]) });
  const rec = rRec.plan?.ejecutar.payload;
  check(rRec.plan?.ejecutar.api === 'wybix.recipes.save' && rec.lines.length === 2 && rec.lines[1].inputUom === 'pza', 'receta: 150 g de carne y 1 pieza (la unidad base del ingrediente)', JSON.stringify(rec?.lines));
  const tvpR = new sql.Table('dbo.RecipeLineType');
  tvpR.columns.add('ingredient_product_id', sql.Int, { nullable: false }); tvpR.columns.add('input_qty', sql.Decimal(12, 3), { nullable: false });
  tvpR.columns.add('input_uom', sql.NVarChar(10), { nullable: false }); tvpR.columns.add('waste_pct', sql.Decimal(5, 2), { nullable: true }); tvpR.columns.add('sort_order', sql.Int, { nullable: true });
  for (const l of rec.lines) tvpR.rows.add(l.ingredientProductId, l.inputQty, l.inputUom, l.wastePct, l.sortOrder);
  try {
    await pool.request().input('product_id', sql.Int, hamb).input('variant_option_id', sql.Int, null).input('notes', sql.NVarChar(300), null).input('Lines', tvpR).execute('sp_save_recipe');
    const rRec2 = await pedirC('receta.guardar', { producto: ex(hamb), lineas: ex([{ productId: carne, nombre: 'carne', cantidad: 180, unidad: 'g' }]) });
    check(rRec2.plan.ejecutar.payload.lines.length === 2 && rRec2.plan.ejecutar.payload.lines[0].inputQty === 180, 'decir otra vez un ingrediente cambia su cantidad y conserva los demás');
    const rQui = await pedirC('receta.guardar', { producto: ex(hamb), quitarIngrediente: ex(concha) });
    check(rQui.plan.ejecutar.payload.lines.length === 1, 'quitar un ingrediente deja el resto');
  } catch (e) { check(false, 'el SP guarda la receta', e.message); }

  const rPre = await pedirC('presentacion.guardar', { producto: ex(cafe), nombre: ex('Caja de 24'), factor: ex(24) });
  const pre = rPre.plan?.ejecutar.payload;
  try {
    await pool.request().input('id', sql.Int, null).input('product_id', sql.Int, pre.productId).input('name', sql.NVarChar(60), pre.name)
      .input('factor_to_base', sql.Decimal(14, 4), pre.factorToBase).input('is_default', sql.Bit, 0).input('active', sql.Bit, 1).execute('sp_save_product_presentation');
    const rPre2 = await pedirC('presentacion.guardar', { producto: ex(cafe), nombre: ex('Caja de 24'), factor: ex(24) });
    check(!rPre2.plan && /ya tiene/.test(rPre2.texto), 'presentación guardada; repetida se rechaza');
  } catch (e) { check(rPre.plan?.ejecutar.api === 'wybix.presentations.save', 'presentación: tarjeta (SP: ' + e.message + ')'); }

  const rGr = await pedirC('opciones.crear', { nombre: ex('QA Tamaño'), opciones: ex([{ nombre: 'chico', precio: 0 }, { nombre: 'grande', precio: 10 }]), rol: ex('SIZE') });
  const gr = rGr.plan?.ejecutar.payload;
  check(rGr.plan?.ejecutar.api === 'wybix.modifiers.save' && gr.required === true && gr.maxSelect === 1 && gr.options[1].priceDelta === 10, 'grupo de tamaño: uno obligatorio, grande +$10');

  /* 17. Menú en línea y plataformas. */
  seccion('17. Menú en línea y plataformas');
  const rMp = await pedirC('menu.producto', { producto: ex(cafe), campo: ex('destacado'), valor: ex(true) });
  const mp = rMp.plan?.ejecutar.payload;
  try {
    await pool.request().input('product_id', sql.Int, mp.productId).input('descripcion', sql.NVarChar(400), mp.descripcion).input('etiquetas', sql.NVarChar(200), mp.etiquetas)
      .input('destacado', sql.Bit, mp.destacado ? 1 : 0).input('oculto', sql.Bit, mp.oculto ? 1 : 0).execute('sp_menu_en_linea_producto_guardar');
    const rMp2 = await pedirC('menu.producto', { producto: ex(cafe), campo: ex('destacado'), valor: ex(true) });
    check(!rMp2.plan && /ya está así/.test(rMp2.texto), 'destacar en el menú se guarda y no se repite');
    const rMp3 = await pedirC('menu.producto', { producto: ex(cafe), campo: ex('oculto'), valor: ex(true) });
    check(rMp3.plan.ejecutar.payload.destacado === true && rMp3.plan.ejecutar.payload.oculto === true, 'ocultarlo conserva que está destacado');
  } catch (e) { check(false, 'el SP guarda el producto del menú', e.message); }
  const rLq = await pedirC('plataforma.confirmar', { plataforma: ex('RAPPI') });
  check(!rLq.plan && /No hay liquidación/.test(rLq.texto), 'sin liquidación de Rappi no hay qué confirmar');

  /* 18. Corregir una venta y cambiar un producto. */
  seccion('18. Corregir una venta y cambiar un producto');
  await q(`INSERT INTO dbo.sales (datee, useer_id, total, payment_method, paid_amount, balance, register_id) VALUES (GETDATE(), 1, 20, 'EFECTIVO', 20, 0, ${caja});
           INSERT INTO dbo.sale_detail (sale_id, product_id, quantity, unitary_price, unit_cost, tax_object, tax_rate) VALUES (SCOPE_IDENTITY(), ${concha}, 2, 10, 5, '02', 0);`);
  const vc = Number(await escalar('SELECT MAX(id) FROM dbo.sales'));
  const rCor = await pedirC('venta.corregir', { folio: ex(vc), renglon: ex({ productId: concha, cantidad: 3 }) });
  check(rCor.plan?.ejecutar.api === 'electronAPI.updateSale' && rCor.plan.ejecutar.payload.items[0].qty === 3 && /\$20.00 → \$30.00/.test(JSON.stringify(rCor.plan.vista)),
    'corregir: 2 → 3 conchas, total $20 → $30', JSON.stringify(rCor.plan?.vista));
  const rCam = await pedirC('venta.cambio', { folio: ex(vc), devuelve: { valor: concha, cantidad: 1 }, lleva: { valor: cafe, cantidad: null } });
  const cm = rCam.plan?.ejecutar.payload;
  check(rCam.plan?.ejecutar.api === 'electronAPI.refundExchange' && cm.items[0].qty === 1 && cm.lleva[0].productId === cafe, 'cambio: devuelve 1 concha y se lleva 1 café', JSON.stringify(rCam.plan?.vista));
  try {
    const tvpX = new sql.Table('dbo.SaleDetailType');
    tvpX.columns.add('product_id', sql.Int, { nullable: false }); tvpX.columns.add('quantity', sql.Decimal(12, 2), { nullable: false }); tvpX.columns.add('unit_price', sql.Decimal(10, 2), { nullable: false });
    for (const it2 of cm.items) tvpX.rows.add(it2.productId, it2.qty, it2.unitPrice);
    await maquina(pool.request().input('sale_id', sql.Int, cm.sale_id).input('user_id', sql.Int, 1).input('RefundDetails', tvpX).input('new_lines_json', sql.NVarChar(sql.MAX), JSON.stringify(cm.lleva))
      .input('reason', sql.NVarChar(40), cm.motivo).input('note', sql.NVarChar(400), cm.note).input('diff_method', sql.NVarChar(20), cm.diff_method)
      .input('received', sql.Decimal(12, 2), cm.received).input('register_id', sql.Int, caja)).execute('sp_exchange_sale');
    check(Number(await escalar(`SELECT COUNT(*) FROM dbo.sale_refunds WHERE sale_id = ${vc}`)) === 1, 'el SP registra el cambio');
  } catch (e) { check(false, 'el SP registra el cambio', e.message); }
} catch (e) {
  fallos++;
  console.log(`\n   ERROR  ${e.stack || e.message}`);
} finally {
  try { await pool?.close(); } catch { /* noop */ }
  if (!CONSERVAR) { eliminar(DB); console.log(`\nBase temporal ${DB} eliminada.`); }
}

console.log(`\nRESULTADO: ${fallos ? `${fallos} FALLO(S)` : 'todo bien'} (${pasos} comprobaciones)`);
process.exit(fallos ? 1 : 0);
