/**
 * Wybix, asistente operativo: motor, reglas, intérprete y conversación.
 *
 *     node --test scripts/pruebas/asistente.test.mjs
 *
 * Sin Electron y sin SQL Server: las reglas son puras (hechos → hallazgos) y
 * la conversación recibe sus dependencias. El banco de frases del intérprete
 * (scripts/asistente/casos.mjs) corre aquí también: si una frase deja de
 * entenderse, esta prueba falla.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { crearMotor, prioridad, umbralesDe } = require('../../electron/asistente/motor.js');
const core = require('../../electron/asistente/packs/core.js');
const hosp = require('../../electron/asistente/packs/hospitality.js');
const sistema = require('../../electron/asistente/packs/sistema.js');
const { crearConversacion } = require('../../electron/asistente/conversacion.js');
const { crearInterprete, prepararCatalogo } = require('../../electron/asistente/lenguaje/interprete.js');
const { normalizar } = require('../../electron/asistente/lenguaje/normalizar.js');

const AHORA = Date.parse('2026-11-14T12:00:00Z');
const regla = (pack, id) => pack.reglas.find((r) => r.id === id);
const correr = (pack, id, hechos, umbrales = {}, ctx = {}) => {
  const r = regla(pack, id);
  return r.evaluar(hechos, umbralesDe(r, umbrales), { ahora: AHORA, ...ctx });
};

// ------------------------------------------------------------------ motor
test('motor: cada sensor se lee una vez aunque lo pidan varias reglas, y una regla que falla no tumba a las demás', async () => {
  let lecturas = 0;
  const motor = crearMotor({
    sensores: { s: { leer: async () => { lecturas++; return [1, 2]; } } },
    packs: [{ id: 'p', reglas: [
      { id: 'a', dominio: 'inventario', sensores: ['s'], evaluar: ({ s }) => s.map((n) => ({ titulo: `a${n}`, detalle: '', entidad: { tipo: 'x', id: n } })) },
      { id: 'b', dominio: 'inventario', sensores: ['s'], evaluar: () => { throw new Error('boom'); } },
    ] }],
  });
  const r = await motor.evaluar({ tieneCapacidad: () => true });
  assert.equal(lecturas, 1);
  assert.equal(r.hallazgos.length, 2);
  assert.deepEqual(r.evaluadas, ['a']);
  assert.equal(r.errores[0].regla, 'b');
});

test('motor: «supera» esconde la regla débil en la misma entidad; la clave es regla+entidad+periodo', async () => {
  const motor = crearMotor({
    sensores: { s: { leer: async () => 1 } },
    packs: [{ id: 'p', reglas: [
      { id: 'fuerte', dominio: 'costos', severidad: 'critico', sensores: ['s'], supera: ['debil'], evaluar: () => [{ titulo: 'f', detalle: '', entidad: { tipo: 'producto', id: 7 } }] },
      { id: 'debil', dominio: 'costos', sensores: ['s'], evaluar: () => [{ titulo: 'd', detalle: '', entidad: { tipo: 'producto', id: 7 } }, { titulo: 'd2', detalle: '', entidad: { tipo: 'producto', id: 8 }, periodo: '2026-11' }] },
    ] }],
  });
  const r = await motor.evaluar({ tieneCapacidad: () => true });
  assert.deepEqual(r.hallazgos.map((h) => h.clave).sort(), ['debil|producto:8|2026-11', 'fuerte|producto:7|-']);
});

test('motor: un pack que pide una capacidad apagada no se evalúa; uno apagado en la config tampoco', async () => {
  const motor = crearMotor({
    sensores: { s: { leer: async () => 1 } },
    packs: [{ id: 'h', reglas: [{ id: 'h1', dominio: 'costos', requiere: { capacidades: ['hospitality'] }, sensores: ['s'], evaluar: () => [{ titulo: 't', detalle: '' }] }] },
            { id: 'c', reglas: [{ id: 'c1', dominio: 'costos', sensores: ['s'], evaluar: () => [{ titulo: 't', detalle: '' }] }] }],
  });
  assert.equal((await motor.evaluar({ tieneCapacidad: () => false })).hallazgos.length, 1);
  assert.equal((await motor.evaluar({ tieneCapacidad: () => true, config: { c1: { activa: false } } })).hallazgos.length, 1);
});

test('motor: prioridad sube con severidad e impacto y baja con la fatiga de descartes; umbrales siempre dentro de su rango', () => {
  assert.ok(prioridad({ severidad: 'critico' }) > prioridad({ severidad: 'aviso' }));
  assert.ok(prioridad({ severidad: 'aviso', impacto: 5000 }) > prioridad({ severidad: 'aviso' }));
  assert.ok(prioridad({ severidad: 'importante', fatiga: 0.6 }) < prioridad({ severidad: 'importante' }));
  assert.deepEqual(umbralesDe({ umbrales: { x: { def: 30, min: 0, max: 50 } } }, { x: 900 }), { x: 50 });
});

test('motor: una regla que pide un sensor inexistente es un error de arranque, no un silencio', () => {
  assert.throws(() => crearMotor({ sensores: {}, packs: [{ id: 'p', reglas: [{ id: 'x', sensores: ['nada'], evaluar: () => [] }] }] }), /sensor nada/);
});

// ------------------------------------------------------------------ reglas
test('core: precio por debajo del costo es crítico y supera al de poca ganancia', () => {
  const m = [{ id: 1, nombre: 'Dona', precio: 10, tasa: 0.16, base: 8.62, costo: 9, ganancia: -0.38, pctSobreCosto: -4.2, vendidos30: 120, modo: 'DIRECT' }];
  const [h] = correr(core, 'core.costos.precio_bajo_costo', { margenes: m });
  assert.match(h.titulo, /pérdida/);
  assert.ok(regla(core, 'core.costos.precio_bajo_costo').supera.includes('core.costos.margen_bajo'));
  assert.equal(correr(core, 'core.costos.margen_bajo', { margenes: m }).length, 0, 'ganancia negativa no es «poca ganancia»');
});

test('core: poca ganancia propone el precio que llega al mínimo, solo en lo que se vende', () => {
  const m = [
    { id: 1, nombre: 'Latte', precio: 45, tasa: 0.16, base: 38.79, costo: 33, ganancia: 5.79, pctSobreCosto: 17.5, vendidos30: 40, modo: 'RECIPE' },
    { id: 2, nombre: 'Sin vender', precio: 45, tasa: 0.16, base: 38.79, costo: 33, ganancia: 5.79, pctSobreCosto: 17.5, vendidos30: 0, modo: 'DIRECT' },
  ];
  const hs = correr(core, 'core.costos.margen_bajo', { margenes: m });
  assert.equal(hs.length, 1);
  assert.equal(hs[0].acciones[0].params.precio, Math.ceil(33 * 1.3 * 1.16));
});

test('core: «se acaba» dice qué ingrediente limita una receta; agotado supera a «se acaba»', () => {
  const r = [
    { id: 5, nombre: 'Latte', modo: 'RECIPE', uom: 'pza', stock: 8, promDiario: 6, dias: 1, limita: { nombre: 'Leche entera', stock: 2000, uom: 'ml' } },
    { id: 6, nombre: 'Coca', modo: 'DIRECT', uom: 'pza', stock: 0, promDiario: 4, dias: 0, sugerido: 120 },
  ];
  const [a] = correr(core, 'core.inventario.se_acaba', { reorden: r });
  assert.match(a.titulo, /Mañana te quedas sin Leche entera/);
  assert.equal(correr(core, 'core.inventario.agotado', { reorden: r }).length, 1);
  assert.ok(regla(core, 'core.inventario.agotado').supera.includes('core.inventario.se_acaba'));
});

test('core: lo que no se vende en 60 días va en UN solo hallazgo del mes, con el dinero parado', () => {
  const viejo = new Date(AHORA - 90 * 86400000).toISOString();
  const s = [{ id: 1, nombre: 'A', stock: 10, costo: 20, ultimaVenta: viejo }, { id: 2, nombre: 'B', stock: 5, costo: 10, ultimaVenta: new Date(AHORA).toISOString() },
             { id: 3, nombre: 'C', stock: 2, costo: 100, ultimaVenta: null, alta: viejo }];
  const [h] = correr(core, 'core.inventario.sin_movimiento', { sinMovimiento: s });
  assert.match(h.titulo, /^2 productos/);
  assert.match(h.detalle, /\$400\.00/);
  assert.equal(h.periodo, '2026-11');
});

test('core: compra más cara propone el precio que conserva la ganancia de antes', () => {
  const c = [{ id: 9, nombre: 'Leche', precio: 34.8, tasa: 0, vendible: true, costoAnterior: 24, costoUltima: 28, fecha: '2026-11-10T00:00:00Z' }];
  const [h] = correr(core, 'core.compras.costo_subio', { compras: c });
  assert.match(h.titulo, /17% más/);
  assert.equal(h.acciones[0].params.precio, Math.ceil(28 * (34.8 / 24)));
});

test('core: descuadres de caja solo avisan si se repiten', () => {
  const cortes = [{ fecha: '2026-11-10', diferencia: -50 }, { fecha: '2026-11-12', diferencia: -80 }, { fecha: '2026-11-13', diferencia: 5 }];
  const [h] = correr(core, 'core.caja.descuadres', { cortes });
  assert.match(h.detalle, /Faltaron \$130\.00/);
  assert.equal(correr(core, 'core.caja.descuadres', { cortes: cortes.slice(0, 1) }).length, 0);
});

test('hospitality: receta cara contra su precio, solo con todos sus ingredientes costeados', () => {
  const m = [{ id: 1, nombre: 'Frappé', modo: 'RECIPE', precio: 58, tasa: 0.16, base: 50, costo: 30, ganancia: 20, pctSobreCosto: 66.7, vendidos30: 12, ingredientesSinCosto: 0 },
             { id: 2, nombre: 'Malteada', modo: 'RECIPE', precio: 58, tasa: 0.16, base: 50, costo: 30, vendidos30: 12, ingredientesSinCosto: 2 }];
  const hs = correr(hosp, 'hosp.receta.costo_alto', { margenes: m });
  assert.equal(hs.length, 1);
  assert.match(hs[0].titulo, /60%/);
  assert.equal(correr(hosp, 'hosp.receta.sin_costo', { margenes: m })[0].evidencia[0].etiqueta, 'Malteada');
});

test('doctor: respaldo viejo, licencia vencida y disco lleno; todo bien no dice nada', () => {
  const viejo = new Date(AHORA - 5 * 86400000).toISOString();
  assert.match(correr(sistema, 'sistema.respaldo', { sistema: { respaldo: { activo: true, ultimo: viejo, estado: 'ok' } } })[0].titulo, /Sin respaldo/);
  assert.equal(correr(sistema, 'sistema.respaldo', { sistema: { respaldo: { activo: true, ultimo: new Date(AHORA).toISOString(), estado: 'ok' } } }).length, 0);
  assert.equal(correr(sistema, 'sistema.licencia', { sistema: { licencia: { modo: 'SALE_ONLY' } } })[0].severidad, 'critico');
  assert.equal(correr(sistema, 'sistema.disco', { sistema: { disco: { libreGB: 1.2 } } })[0].severidad, 'critico');
  assert.equal(correr(sistema, 'sistema.impresora', { sistema: { impresora: { configurada: true } } }).length, 0);
});

// -------------------------------------------------------------- lenguaje
test('normalizar: números con letra, media docena, acentos y dinero', () => {
  assert.equal(normalizar('Se cayeron SEIS donas').texto, 'se cayeron 6 donas');
  assert.equal(normalizar('media docena de conchas').texto, '6 de conchas');
  assert.equal(normalizar('ciento cincuenta y dos').texto, '152');
  assert.equal(normalizar('Cámbialo a $65').texto, 'cambialo a $65');
});

test('intérprete: el loop (frases apartadas, variaciones y casos detallados) cumple la meta, sin inventar nada', () => {
  let salida;
  try { salida = execFileSync(process.execPath, ['scripts/asistente/entrenar.mjs'], { encoding: 'utf8' }); }
  catch (e) { assert.fail(String(e.stdout || e.message).split('\n').filter((l) => /INVENTA|APARTADAS|VARIACIONES|CASOS|CASO /.test(l)).join('\n')); }
  assert.match(salida, /APARTADAS: .* inventados 0/);
});

// ---------------------------------------------------------- conversación
test('conversación: «merma de 6 donas» pregunta cuál y por qué, y termina en un plan con vista previa', async () => {
  const catalogo = prepararCatalogo([{ id: 1, nombre: 'Dona glaseada' }, { id: 2, nombre: 'Dona de chocolate' }]);
  const guardados = [];
  const respondidas = [];
  const conv = crearConversacion({
    interprete: (() => { const i = crearInterprete(); return () => i; })(),
    datos: async () => ({ catalogo, categorias: [], personas: [], conceptos: [], modulos: new Set(['hospitality']) }),
    store: { guardarMensaje: async (_u, m) => guardados.push(m), guardarFrase: async () => {}, porId: async () => null, marcar: async () => null },
    listarHallazgos: async () => [],
    acciones: { responder: async (it) => {
      respondidas.push(it);
      if (it.falta) return { autor: 'wybix', texto: '?', esperando: { intent: it.intent, slots: it.slots, falta: it.falta }, opciones: it.slots[it.falta]?.opciones };
      return { autor: 'wybix', texto: 'plan', plan: { id: 'p1', intent: it.intent, titulo: 't', vista: [] } };
    } },
  });
  const ctx = { userId: 1, puede: () => true };
  let r = await conv.procesar(ctx, { texto: 'registra merma de 6 donas' });
  assert.equal(r[1].esperando.falta, 'producto');
  r = await conv.procesar(ctx, { texto: 'la glaseada' });
  assert.equal(respondidas.at(-1).slots.producto.valor, 1);
  assert.equal(r[1].esperando.falta, 'motivo');
  r = await conv.procesar(ctx, { texto: 'Se cayó' });
  assert.equal(respondidas.at(-1).slots.motivo.valor, 'SE_CAYO');
  assert.equal(respondidas.at(-1).slots.cantidad.valor, 6);
  assert.equal(r[1].plan.intent, 'merma.registrar');
  assert.equal(guardados.length, 6, 'cada mensaje de la persona y de Wybix queda guardado');
});

test('conversación: lo que no se entiende no se inventa: ofrece opciones', async () => {
  const conv = crearConversacion({
    interprete: (() => { const i = crearInterprete(); return () => i; })(),
    datos: async () => ({ catalogo: [], categorias: [], personas: [], conceptos: [], modulos: new Set() }), listarHallazgos: async () => [],
    store: { guardarMensaje: async () => {}, guardarFrase: async () => {} },
    acciones: { responder: async () => { throw new Error('no debía llamarse'); } },
  });
  const r = await conv.procesar({ userId: 1, puede: () => true }, { texto: 'el perro de mi vecino' });
  assert.match(r[1].texto, /No te entendí/);
  assert.ok(r[1].opciones.length >= 1);
});

// ------------------------------------------- lo que hace que entienda más
const { lema, conceptos } = require('../../electron/asistente/lenguaje/lexico.js');
const { senalesDe } = require('../../electron/asistente/lenguaje/senales.js');
const { INTENTS } = require('../../electron/asistente/lenguaje/intents/index.js');
const { frases } = require('../../electron/asistente/lenguaje/corpus.js');

test('léxico: conjugaciones a la misma raíz y jerga al mismo concepto', () => {
  assert.equal(lema('cancelala'), lema('cancelar'));
  assert.equal(lema('pagaron'), lema('pagar'));
  for (const w of ['feria', 'lana', 'morralla', 'efectivo']) assert.ok(conceptos(w).includes('DINERO'), w);
  assert.ok(conceptos('cumpleaneros').includes('CUMPLE'));
});

test('señales: patrones precisos, nunca dentro de una marca de persona', () => {
  assert.ok(senalesDe('', ['la', '<num>', 'quiere', 'su', 'cuenta']).has('hosp.cuenta'));
  assert.ok(senalesDe('', ['cuanto', 'me', 'queda', 'de', 'cada', '<prod>']).has('consulta.ganancia'));
  /* «registra el pago a <proveedor>» no es alta de proveedor. */
  assert.ok(!senalesDe('', ['registra', 'el', 'pago', 'a', '<proveedor>']).has('proveedor.alta'));
});

test('corpus: al menos 2,000 frases completas por giro, sin frases repetidas entre intents', () => {
  const todas = frases();
  const giro = (m) => todas.filter((f) => { const mo = INTENTS.find((i) => i.id === f.intent).modulo; return !mo || mo === m || (mo !== 'hospitality' && mo !== 'servicios'); }).length;
  assert.ok(giro('retail') >= 2000, `retail ${giro('retail')}`);
  assert.ok(giro('hospitality') >= 2000, `hospitality ${giro('hospitality')}`);
  assert.ok(giro('servicios') >= 2000, `servicios ${giro('servicios')}`);
  /* Los de regla (los apodos) no los decide el clasificador: no llevan frases. */
  for (const i of INTENTS.filter((x) => !x.soloRegla)) assert.ok(todas.some((f) => f.intent === i.id), `${i.id} sin frases`);
});

test('intérprete: la persona dicha decide el tipo («me debe» un cliente, «le debo» a un proveedor)', () => {
  const it = crearInterprete();
  const personas = prepararCatalogo([{ id: 1, nombre: 'Doña Mary', tipo: 'cliente' }, { id: 2, nombre: 'Bimbo', tipo: 'proveedor' }]);
  const o = { catalogo: [], personas, modulos: new Set() };
  const a = it.interpretar('cuanto me debe doña mary', o);
  assert.equal(a.intent, 'cliente.deuda'); assert.equal(a.slots.cliente.valor, 1);
  const b = it.interpretar('cuanto le debo a bimbo', o);
  assert.equal(b.intent, 'proveedor.deuda'); assert.equal(b.slots.proveedor.valor, 2);
  const c = it.interpretar('doña mary abono 200 en efectivo', o);
  assert.equal(c.intent, 'cliente.abono'); assert.equal(c.slots.monto.valor, 200); assert.equal(c.slots.metodo.valor, 'EFECTIVO');
});

test('intérprete: el contexto completa la frase corta («¿y ayer?», «¿y de las conchas?»)', () => {
  const it = crearInterprete();
  const catalogo = prepararCatalogo([{ id: 1, nombre: 'Concha' }, { id: 2, nombre: 'Croissant' }]);
  const o = { catalogo, modulos: new Set() };
  const a = it.interpretar('cuanto vendi hoy', o);
  const b = it.interpretar('y ayer?', { ...o, contexto: { intent: a.intent, slots: a.slots } });
  assert.equal(b.intent, 'consulta.hoy'); assert.equal(b.slots.periodo.valor, 'ayer');
  const c = it.interpretar('cuantos croissants quedan', o);
  const d = it.interpretar('y de las conchas', { ...o, contexto: { intent: c.intent, slots: c.slots } });
  assert.equal(d.intent, 'consulta.existencia'); assert.equal(d.slots.producto.valor, 1);
});

test('intérprete: un módulo apagado no se ofrece (sin Servicios no hay citas)', () => {
  const it = crearInterprete();
  const r = it.interpretar('que citas tengo hoy', { catalogo: [], modulos: new Set() });
  assert.notEqual(r.intent, 'cita.lista');
  assert.equal(it.interpretar('que citas tengo hoy', { catalogo: [], modulos: new Set(['servicios']) }).intent, 'cita.lista');
});

test('acciones: cada intent tiene respuesta y los archivos no traen caracteres de control', () => {
  const { crearAcciones } = require('../../electron/asistente/acciones/index.js');
  const sqlFalso = { Int: 1, Date: 1, DateTime2: 1, NVarChar: () => 1, Decimal: () => 1 };
  assert.doesNotThrow(() => crearAcciones({ sql: sqlFalso, pool: async () => ({}), sensores: {}, listarHallazgos: async () => [] }));
  const fs = require('node:fs'), path = require('node:path');
  const recorrer = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? recorrer(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of recorrer('electron/asistente')) {
    assert.ok(!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(fs.readFileSync(f, 'utf8')), `${f} tiene un carácter de control (¿un \b mal escapado?)`);
  }
});

// ------------------------------------------------ analítica y lo que se agregó
const { filtros: filtrosDe } = require('../../electron/asistente/lenguaje/filtros.js');
const { compilar } = require('../../electron/asistente/analitica/cubo.js');
const { explicar } = require('../../electron/asistente/analitica/explicar.js');
const { pronosticoDia, agotamiento, rellenar } = require('../../electron/asistente/analitica/pronostico.js');
const { simularPrecio } = require('../../electron/asistente/analitica/simular.js');
const { rangoFechas } = require('../../electron/asistente/analitica/periodos.js');
const { apodo } = require('../../electron/asistente/lenguaje/apodos.js');
const { partir } = require('../../electron/asistente/lenguaje/compuesto.js');
const voz = require('../../electron/asistente/acciones/voz.js');
const HOY = new Date(2026, 10, 14, 12, 0, 0); // sábado 14 de noviembre de 2026, hora local

test('filtros: días, horas, forma de pago, categoría, cajero y fechas se combinan; «el sábado» es fecha, no filtro', () => {
  const o = { categorias: [{ id: 7, nombre: 'Bebidas' }], usuarios: [{ id: 3, nombre: 'Ana' }], ahora: HOY };
  const f = filtrosDe(normalizar('cuanto vendi de bebidas los sabados y domingos despues de las 6 con tarjeta').texto, o).valor;
  assert.deepEqual(f.diasSemana, [0, 6]);
  assert.equal(f.horaDesde, 18);
  assert.equal(f.metodo, 'TARJETA');
  assert.equal(f.categoria.id, 7);
  assert.equal(filtrosDe(normalizar('lo que cobro ana').texto, o).valor.cajero.id, 3);
  assert.deepEqual(filtrosDe('entre las 2 y las 4', o).valor, { horaDesde: 14, horaHasta: 16 });
  assert.deepEqual(filtrosDe('entre semana', o).valor.diasSemana, [1, 2, 3, 4, 5]);
  const oct = filtrosDe('cuanto vendi en octubre', o).valor.rango;
  assert.equal(oct.desde, '2026-10-01'); assert.equal(oct.hasta, '2026-11-01');
  const dic = filtrosDe('cuanto vendi en diciembre', o).valor.rango;
  assert.equal(dic.desde, '2025-12-01', 'un mes que no ha llegado es del año pasado');
  assert.equal(filtrosDe('del 1 al 15 de octubre', o).valor.rango.hasta, '2026-10-16');
  assert.equal(filtrosDe('cuanto voy a vender el sabado', o), null);
});

test('cubo: los valores van como parámetros, se elige el nivel (venta o renglón) y nada inválido se concatena', () => {
  const tipos = { NVarChar: (n) => `NV${n}`, VarChar: (n) => `V${n}` };
  const r = rangoFechas('semana', HOY);
  const a = compilar({ filtros: { desde: r.desde, hasta: r.hasta, diasSemana: [6], horaDesde: 18, metodo: 'tarjeta' } }, tipos);
  assert.equal(a.linea, false, 'sin producto ni categoría basta con dbo.sales');
  assert.match(a.texto, /% 7\) IN \(6\)/);
  assert.match(a.texto, /DATEPART\(HOUR, s\.datee\) >= 18/);
  assert.deepEqual(a.entradas.map((e) => e[0]), ['desde', 'hasta', 'metodo']);
  const b = compilar({ filtros: { desde: r.desde, hasta: r.hasta, categorias: [3, 'x', -1] }, agrupar: 'producto', limite: 10 }, tipos);
  assert.equal(b.linea, true);
  assert.match(b.texto, /p\.category_id IN \(3\)/, 'solo enteros válidos');
  assert.match(b.texto, /GROUP BY p\.id, p\.nombre/);
  assert.throws(() => compilar({ filtros: { desde: r.desde, hasta: r.hasta, metodo: "X'; DROP TABLE sales;--" } }, tipos), /Forma de pago/);
  assert.throws(() => compilar({ filtros: { desde: "2026-01-01'; --", hasta: r.hasta } }, tipos), /rango de fechas/);
  assert.throws(() => compilar({ filtros: { desde: r.desde, hasta: r.hasta }, agrupar: 'contraseña' }, tipos));
});

test('«¿por qué?»: separa menos clientes de menos gasto y encuentra dónde se concentró', () => {
  const x = explicar({
    total: { ahora: { ventas: 8000, tickets: 160 }, antes: { ventas: 10000, tickets: 200 } },
    dimensiones: {
      producto: { ahora: [{ clave: 1, nombre: 'Concha', ventas: 1000 }, { clave: 2, nombre: 'Latte', ventas: 3000 }, { clave: 3, nombre: 'Dona', ventas: 2000 }, { clave: 4, nombre: 'Café', ventas: 2000 }],
                  antes: [{ clave: 1, nombre: 'Concha', ventas: 2800 }, { clave: 2, nombre: 'Latte', ventas: 3100 }, { clave: 3, nombre: 'Dona', ventas: 2100 }, { clave: 4, nombre: 'Café', ventas: 2000 }] },
      metodo: { ahora: [{ clave: 'EFECTIVO', nombre: 'EFECTIVO', ventas: 4000 }, { clave: 'TARJETA', nombre: 'TARJETA', ventas: 4000 }],
                antes: [{ clave: 'EFECTIVO', nombre: 'EFECTIVO', ventas: 5000 }, { clave: 'TARJETA', nombre: 'TARJETA', ventas: 5000 }] },
    },
  });
  assert.equal(x.pct, -20);
  assert.equal(Math.round(x.porTickets), -2000, '40 tickets menos × $50');
  assert.equal(Math.round(x.porPromedio), 0, 'cada cliente gastó lo mismo');
  assert.equal(x.causas[0].dimension, 'producto');
  assert.equal(x.causas[0].miembros[0].nombre, 'Concha');
  assert.ok(!x.causas.some((c) => c.dimension === 'metodo'), 'con 2 formas de pago no se «concentra» nada');
});

test('pronóstico: mismos días de la semana, con más peso a lo reciente; un cierre no cuenta como cero; cuándo se acaba', () => {
  const filas = [];
  for (let i = 56; i >= 1; i--) {
    const d = new Date(2026, 10, 14 - i);
    const dia = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    filas.push({ dia, valor: d.getDay() === 6 ? 1000 : d.getDay() === 0 ? 0 : 400 });
  }
  const serie = rellenar(filas, '2026-09-19', '2026-11-14');
  const sab = pronosticoDia(serie, '2026-11-14');
  assert.equal(Math.round(sab.estimado), 1000); assert.equal(sab.confianza, 'buena');
  assert.equal(pronosticoDia(serie, '2026-11-15').confianza, 'ninguna', 'los domingos no abre: no se inventa una venta');
  const ag = agotamiento(9, serie.slice(-28).map((x) => ({ ...x, valor: x.dow === 6 ? 4 : x.dow === 0 ? 0 : 1 })), '2026-11-14');
  assert.equal(ag.dias, 6, 'de 9: sábado 4, lunes a viernes 1 cada uno; el viernes se acaba');
  assert.equal(agotamiento(5, serie.map((x) => ({ ...x, valor: 0 })), '2026-11-14').sinVenta, true);
});

test('«¿y si…?»: ganancia con el precio nuevo y punto de equilibrio, sin inventar cuántos clientes se van', () => {
  const x = simularPrecio({ precio: 11.6, nuevo: 13.92, costo: 6, tasa: 0.16, piezas: 300 });
  assert.equal(Math.round(x.porPieza * 100) / 100, 4);
  assert.equal(Math.round(x.porPiezaNueva * 100) / 100, 6);
  assert.equal(Math.round(x.diferencia), 600);
  assert.equal(Math.round(x.equilibrio), 200, 'con 200 piezas a $13.92 gana lo mismo que con 300 a $11.60');
  assert.equal(x.saltoGrande, true, 'un 20 % se nota');
  assert.equal(simularPrecio({ precio: 10, nuevo: 11, costo: 5, tasa: 0, piezas: 10 }).saltoGrande, false);
  assert.equal(simularPrecio({ precio: 11.6, nuevo: 6, costo: 6, tasa: 0.16, piezas: 300 }).perdida, true);
});

test('apodos: enseñar y olvidar con las formas de un mostrador; una frase normal no es un apodo', () => {
  assert.deepEqual(apodo('a la coca de 600 dile la roja'), { alias: 'roja', objetivo: 'la coca de 600' });
  assert.deepEqual(apodo('cuando diga la grande es el latte grande'), { alias: 'grande', objetivo: 'el latte grande' });
  assert.deepEqual(apodo('le decimos la guera a dona mary'), { alias: 'guera', objetivo: 'dona mary' });
  assert.deepEqual(apodo('olvida la roja'), { alias: 'roja', borrar: true });
  assert.equal(apodo('cuanto vendi hoy'), null);
  assert.equal(apodo('registra merma de 6 donas'), null);
});

test('intérprete: un apodo del catálogo se entiende como el producto; y la regla de enseñar arma el intent', () => {
  const it = crearInterprete();
  const base = prepararCatalogo([{ id: 1, nombre: 'Coca Cola 600 ml' }, { id: 2, nombre: 'Coca Cola 2 L' }]);
  const catalogo = [...base, { ...prepararCatalogo([{ id: 1, nombre: 'roja' }])[0], nombre: 'Coca Cola 600 ml' }];
  const r = it.interpretar('cuantas rojas quedan', { catalogo, modulos: new Set() });
  assert.equal(r.intent, 'consulta.existencia'); assert.equal(r.slots.producto.valor, 1);
  const e = it.interpretar('a la coca de 600 dile la roja', { catalogo: base, modulos: new Set() });
  assert.equal(e.intent, 'sistema.alias'); assert.equal(e.slots.alias.valor, 'roja');
  assert.deepEqual(e.slots.objetivo.valor, { tipo: 'producto', id: 1 });
});

test('intérprete: los filtros llegan como dato y el contexto los suma («¿y en tarjeta?» después de «los sábados»)', () => {
  const it = crearInterprete();
  const o = { catalogo: [], modulos: new Set(), ahora: HOY };
  const a = it.interpretar('cuanto vendi los sabados', o);
  assert.equal(a.intent, 'consulta.hoy'); assert.deepEqual(a.slots.filtros.valor.diasSemana, [6]);
  const b = it.interpretar('y en tarjeta?', { ...o, contexto: { intent: a.intent, slots: a.slots } });
  assert.equal(b.intent, 'consulta.hoy');
  assert.deepEqual(b.slots.filtros.valor, { diasSemana: [6], metodo: 'TARJETA' });
});

test('frases compuestas: se parten solo donde empieza otra orden', () => {
  assert.deepEqual(partir('registra $500 de luz y dime cuánto me queda en caja'), ['registra $500 de luz', 'dime cuánto me queda en caja']);
  assert.deepEqual(partir('3 cocas y 2 sabritas'), ['3 cocas y 2 sabritas']);
  assert.deepEqual(partir('cuánto vendí hoy y ayer'), ['cuánto vendí hoy y ayer']);
  assert.deepEqual(partir('qué me falta comprar y cuánto le debo a Bimbo'), ['qué me falta comprar', 'cuánto le debo a Bimbo']);
});

/** Una conversación con acciones de mentira: lo que se respondió, en orden. */
function conversacionDePrueba({ catalogo = [], personas = [], aprender = null } = {}) {
  const respondidas = [];
  const conv = crearConversacion({
    interprete: (() => { const i = crearInterprete(); return () => i; })(),
    datos: async () => ({ catalogo, categorias: [], personas, conceptos: [{ id: 1, nombre: 'Luz' }], modulos: new Set() }),
    store: { guardarMensaje: async () => {}, guardarFrase: async () => {} }, listarHallazgos: async () => [], aprender,
    acciones: { responder: async (it) => {
      respondidas.push(it);
      if (it.falta) return { autor: 'wybix', texto: '?', esperando: { intent: it.intent, slots: it.slots, falta: it.falta } };
      return { autor: 'wybix', texto: `ok ${it.intent}` };
    } },
  });
  return { conv, respondidas };
}

test('conversación: una frase compuesta se contesta por partes, en orden', async () => {
  const { conv, respondidas } = conversacionDePrueba();
  const r = await conv.procesar({ userId: 1, puede: () => true }, { texto: 'pague 850 de luz en efectivo y dime cuanto hay en caja' });
  assert.deepEqual(respondidas.map((x) => x.intent), ['gasto.registrar', 'caja.efectivo']);
  assert.equal(r.length, 3, 'la frase de la persona y las dos respuestas');
});

test('conversación: si preguntó «¿cuál?» y la persona eligió, aprende el apodo y lo dice', async () => {
  const aprendidos = [];
  const catalogo = prepararCatalogo([{ id: 1, nombre: 'Huevo blanco kilo' }, { id: 2, nombre: 'Huevo rojo kilo' }]);
  const { conv } = conversacionDePrueba({ catalogo, aprender: async (x) => { aprendidos.push(x); return { alias: x.alias }; } });
  const ctx = { userId: 1, puede: () => true };
  let r = await conv.procesar(ctx, { texto: 'cuanto huevo me queda' });
  assert.equal(r[1].esperando.falta, 'producto');
  r = await conv.procesar(ctx, { texto: 'el blanco' });
  assert.deepEqual(aprendidos, [{ alias: 'huevo', tipo: 'producto', refId: 1 }]);
  assert.match(r[1].texto, /«huevo» es Huevo blanco kilo/);
});

test('voz: la misma conversación dice lo mismo (sin azar) y cambia de un turno a otro', () => {
  const a = voz.di('listo', { userId: 1, turno: 3 }, { titulo: 'x' });
  assert.equal(voz.di('listo', { userId: 1, turno: 3 }, { titulo: 'x' }), a);
  const variantes = new Set(Array.from({ length: 12 }, (_, t) => voz.di('listo', { userId: 1, turno: t }, { titulo: 'x' })));
  assert.ok(variantes.size >= 2);
  assert.equal(voz.nombreDe('juan.perez'), 'Juan');
  assert.equal(voz.nombreDe('admin'), null);
});

test('la voz se baja verificada: hash fijo, sin restos si falla, .tar.gz al final', { skip: process.platform !== 'win32' && 'usa el tar.exe de Windows' }, async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const crypto = require('node:crypto');
  const { descargarVoz } = require('../../electron/asistente/voz-descarga.js');
  const tar = path.join(process.env.SystemRoot || 'C:\Windows', 'System32', 'tar.exe');

  /* Un «modelo» chiquito con la forma del de verdad, empacado en .zip. */
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'wxvoz-'));
  const fuente = path.join(raiz, 'fuente', 'modelo-prueba');
  fs.mkdirSync(path.join(fuente, 'am'), { recursive: true });
  fs.mkdirSync(path.join(fuente, 'conf'), { recursive: true });
  fs.writeFileSync(path.join(fuente, 'am', 'final.mdl'), 'x'.repeat(5000));
  fs.writeFileSync(path.join(fuente, 'conf', 'model.conf'), '--sample-frequency=16000');
  const zip = path.join(raiz, 'modelo.zip');
  execFileSync(tar, ['-a', '-cf', zip, '-C', path.join(raiz, 'fuente'), 'modelo-prueba']);
  const bytes = fs.readFileSync(zip);
  const modelo = { url: 'https://ejemplo.invalid/modelo.zip', carpeta: 'modelo-prueba', bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  /* fetch falso: entrega el zip en trozos, o lo que se le pida. */
  const servir = (b) => async () => ({ ok: true, status: 200, body: (async function* () { for (let i = 0; i < b.length; i += 100) yield b.subarray(i, i + 100); })() });
  const quedo = (c) => fs.readdirSync(c).sort();

  try {
    const malo = path.join(raiz, 'malo');
    const alterado = Buffer.from(bytes); alterado[alterado.length - 10] ^= 0xff;
    await assert.rejects(descargarVoz({ carpeta: malo, fetch: servir(alterado), modelo }), /no es el esperado/);
    assert.deepEqual(quedo(malo), [], 'un archivo alterado no deja nada');

    const corto = path.join(raiz, 'corto');
    await assert.rejects(descargarVoz({ carpeta: corto, fetch: servir(bytes.subarray(0, bytes.length - 50)), modelo }), /se cortó/);
    assert.deepEqual(quedo(corto), []);

    const grande = path.join(raiz, 'grande');
    await assert.rejects(descargarVoz({ carpeta: grande, fetch: servir(Buffer.concat([bytes, Buffer.alloc(10)])), modelo }), /más grande/);
    assert.deepEqual(quedo(grande), []);

    await assert.rejects(descargarVoz({ carpeta: path.join(raiz, 'sinred'), fetch: async () => { throw new Error('ECONNREFUSED'); }, modelo }), /internet/);

    const bueno = path.join(raiz, 'bueno');
    const avances = [];
    const ruta = await descargarVoz({ carpeta: bueno, fetch: servir(bytes), modelo, avance: (p, e) => avances.push([p, e]) });
    assert.equal(ruta, path.join(bueno, 'modelo.tar.gz'));
    assert.deepEqual(quedo(bueno), ['modelo.tar.gz'], 'sin .part ni carpetas temporales');
    assert.deepEqual(avances.at(-1), [100, 'listo']);
    assert.ok(avances.every(([p], i) => i === 0 || p >= avances[i - 1][0]), 'el avance nunca retrocede');
    /* Lo que quedó es un .tar.gz con la carpeta del modelo, que es lo que lee vosk-browser. */
    const lista = execFileSync(tar, ['-tzf', ruta], { encoding: 'utf8' });
    assert.match(lista, /modelo-prueba\/am\/final\.mdl/);
    assert.match(lista, /modelo-prueba\/conf\/model\.conf/);
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('la voz de Wybix (Piper) se instala verificada: tres archivos con hash, sin restos si uno falla', { skip: process.platform !== 'win32' && 'usa el tar.exe de Windows' }, async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const crypto = require('node:crypto');
  const piper = require('../../electron/asistente/voz-piper.js');
  const tar = path.join(process.env.SystemRoot || 'C:\Windows', 'System32', 'tar.exe');
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'wxhabla-'));
  try {
    /* Un «programa» con la forma del de verdad: piper/piper.exe y espeak-ng-data. */
    const fuente = path.join(raiz, 'fuente', 'piper');
    fs.mkdirSync(path.join(fuente, 'espeak-ng-data'), { recursive: true });
    fs.writeFileSync(path.join(fuente, 'piper.exe'), 'MZ falso');
    fs.writeFileSync(path.join(fuente, 'espeak-ng-data', 'phontab'), 'x');
    const zip = path.join(raiz, 'motor.zip');
    execFileSync(tar, ['-a', '-cf', zip, '-C', path.join(raiz, 'fuente'), 'piper']);
    const datos = { motor: fs.readFileSync(zip), voz: Buffer.from('onnx'.repeat(500)), config: Buffer.from('{"audio":{}}') };
    const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
    const archivos = Object.fromEntries(Object.entries(datos).map(([k, b]) => [k, { url: `https://ejemplo.invalid/${k}`, bytes: b.length, sha256: sha(b) }]));
    const servir = (cambios = {}) => async (url) => {
      const k = url.split('/').pop();
      const b = cambios[k] || datos[k];
      return { ok: true, status: 200, body: (async function* () { for (let i = 0; i < b.length; i += 200) yield b.subarray(i, i + 200); })() };
    };
    const quedo = (c) => (fs.existsSync(c) ? fs.readdirSync(c).sort() : []);

    const mala = path.join(raiz, 'mala');
    const voz2 = Buffer.from(datos.voz); voz2[3] ^= 1;
    await assert.rejects(piper.descargarHabla({ carpeta: mala, fetch: servir({ voz: voz2 }), archivos }), /no es el esperado/);
    assert.deepEqual(quedo(mala), [], 'una voz alterada no deja nada (ni el programa ya bajado)');
    assert.equal(piper.instalada(mala), false);
    await assert.rejects(piper.hablar({ carpeta: mala, texto: 'hola' }), /no está instalada/);

    const buena = path.join(raiz, 'buena');
    const avances = [];
    await piper.descargarHabla({ carpeta: buena, fetch: servir(), archivos, avance: (p, e) => avances.push([p, e]) });
    assert.deepEqual(quedo(buena), ['piper', 'voz.onnx', 'voz.onnx.json'], 'sin .part ni carpetas temporales');
    assert.ok(piper.instalada(buena));
    assert.ok(fs.existsSync(path.join(buena, 'piper', 'espeak-ng-data', 'phontab')));
    assert.deepEqual(avances.at(-1), [100, 'listo']);
    assert.ok(avances.every(([p], i) => i === 0 || p >= avances[i - 1][0]), 'el avance nunca retrocede');
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});
