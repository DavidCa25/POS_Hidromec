/**
 * Wybix conversa: preguntas libres, referencias a la lista anterior,
 * correcciones, «¿por qué?», «¿cómo lo calculaste?», preferencias, el alta
 * hablada de un producto y la gráfica en el mensaje.
 *
 *     node --test scripts/pruebas/asistente-conversa.test.mjs
 *
 * Sin Electron y sin SQL Server: intérprete real, acciones de mentira.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { crearConversacion } = require('../../electron/asistente/conversacion.js');
const { crearInterprete, prepararCatalogo } = require('../../electron/asistente/lenguaje/interprete.js');
const { normalizar } = require('../../electron/asistente/lenguaje/normalizar.js');
const { preguntaLibre } = require('../../electron/asistente/lenguaje/pregunta.js');
const R = require('../../electron/asistente/lenguaje/referencias.js');

const HOY = new Date(2026, 10, 14, 12, 0, 0); // sábado 14 de noviembre de 2026
const n = (s) => normalizar(s).texto;
const CATALOGO = prepararCatalogo([{ id: 1, nombre: 'Concha' }, { id: 2, nombre: 'Café americano' }, { id: 3, nombre: 'Coca Cola 600 ml' },
                                   { id: 4, nombre: 'Coca Cola 2 L grande' }]);
const CATEGORIAS = [{ id: 10, nombre: 'Bebidas' }, { id: 11, nombre: 'Panadería' }];
const interprete = crearInterprete();
const leer = (texto, extra = {}) => interprete.interpretar(texto, { catalogo: CATALOGO, categorias: CATEGORIAS, modulos: new Set(), ahora: HOY, ...extra });

test('pregunta libre: qué medir, cómo agrupar y en qué orden, sin intent escrito', () => {
  const casos = [
    ['¿qué categoría deja más ganancia los domingos en la tarde?', { medida: 'ganancia', agrupar: 'categoria', orden: 'desc' }],
    ['¿a qué hora vendo menos?', { medida: 'ventas', agrupar: 'hora', orden: 'asc' }],
    ['top 3 clientes del mes', { agrupar: 'cliente', limite: 3 }],
    ['¿qué día de la semana vendo más?', { agrupar: 'diaSemana', orden: 'desc' }],
    ['cuántas piezas por categoría', { medida: 'piezas', agrupar: 'categoria' }],
    ['lo menos vendido del mes', { medida: 'piezas', agrupar: 'producto', orden: 'asc' }],
  ];
  for (const [frase, esperado] of casos) {
    const q = preguntaLibre(n(frase), { ahora: HOY });
    assert.ok(q, frase);
    for (const [k, v] of Object.entries(esperado)) assert.equal(q[k], v, `${frase} · ${k}`);
  }
  assert.equal(preguntaLibre(n('cuánto vendí hoy'), { ahora: HOY }), null, 'sin agrupar ni comparar no es pregunta libre');
  const c = preguntaLibre(n('octubre contra septiembre'), { ahora: HOY });
  assert.equal(c.comparar.tipo, 'periodos');
  assert.equal(c.comparar.a.rango.desde, '2026-10-01');
  assert.equal(c.comparar.b.rango.desde, '2026-09-01');
  assert.deepEqual(preguntaLibre(n('esta semana contra la pasada'), { ahora: HOY }).comparar, { tipo: 'periodos', a: { periodo: 'semana' }, b: { periodo: 'semana_pasada' } });
  assert.equal(preguntaLibre(n('cuánto vendí esta semana vs la semana pasada'), { ahora: HOY }).medida, 'ventas', '«cuánto vendí» es dinero, no piezas');
});

test('intérprete: la pregunta libre llega con sus filtros; si un intent ya contesta exactamente eso, se queda con él', () => {
  const a = leer('qué categoría deja más ganancia los domingos');
  assert.equal(a.intent, 'analisis.libre');
  assert.equal(a.slots.pregunta.valor.agrupar, 'categoria');
  assert.deepEqual(a.slots.filtros.valor.diasSemana, [0]);
  const b = leer('café contra concha este mes');
  assert.equal(b.intent, 'analisis.libre');
  assert.equal(b.slots.pregunta.valor.comparar.tipo, 'productos');
  assert.deepEqual([b.slots.producto.valor, b.slots.producto2.valor], [2, 1]);
  assert.notEqual(leer('gastos por categoría').intent, 'analisis.libre', 'los gastos no son ventas');
  assert.notEqual(leer('¿por qué se vende menos la concha?').intent, 'analisis.libre', '«por qué» es venta.comparar');
});

test('referencias: ordinales, «ese» y lo que no es referencia («esta semana»)', () => {
  assert.deepEqual(R.referencia(n('dime más del segundo')), { indice: 1, texto: 'del segundo' });
  assert.equal(R.referencia(n('¿y el último?')).indice, -1);
  assert.equal(R.referencia(n('¿cuánto deja ese?')).indice, 0);
  assert.equal(R.referencia(n('el número 3')).indice, 2);
  assert.equal(R.referencia(n('cuánto vendí esta semana')), null);
  assert.equal(R.referencia(n('ese mes')), null);
});

test('correcciones, «¿por qué?», «¿cómo lo calculaste?» y preferencias, por reglas', () => {
  assert.equal(R.correccion(n('no, me refería a la grande')), 'la grande');
  assert.equal(R.correccion(n('mejor de ayer')), 'de ayer');
  assert.equal(R.correccion(n('cuánto vendí')), null);
  for (const s of ['¿por qué?', '¿y eso?', '¿a qué se debe?']) assert.ok(R.porQue(n(s)), s);
  assert.ok(!R.porQue(n('¿por qué se vende menos la concha?')), 'una pregunta completa no es el «¿por qué?» suelto');
  for (const s of ['¿cómo lo calculaste?', '¿de dónde sale eso?', 'explícame el cálculo']) assert.ok(R.explica(n(s)), s);
  assert.deepEqual(R.preferencia(n('llámame Jesús')).cambios, { nombre: 'Jesus' });
  assert.equal(R.preferencia(n('dime cuánto vendí')), null, '«dime» + pregunta no es un nombre');
  assert.deepEqual(R.preferencia(n('no me des el resumen')).cambios, { resumen: false });
  assert.deepEqual(R.preferencia(n('sin gráficas')).cambios, { graficas: false });
  assert.deepEqual(R.preferencia(n('léeme las respuestas')).cambios, { hablar: true });
  assert.ok(R.preferencia(n('olvida mis preferencias')).olvidar);
});

test('intérprete: «¿por qué?» explica el número anterior; «no, la grande» corrige el producto de antes', () => {
  const a = leer('cuánto vendí esta semana');
  const p = leer('¿por qué?', { contexto: { intent: a.intent, slots: a.slots } });
  assert.equal(p.intent, 'venta.comparar');
  assert.equal(p.slots.periodo.valor, 'semana');
  const e = leer('cuántas Coca Cola 600 ml me quedan');
  assert.equal(e.slots.producto.valor, 3);
  const c = leer('no, me refería a la grande', { contexto: { intent: e.intent, slots: e.slots } });
  assert.equal(c.intent, e.intent);
  assert.equal(c.slots.producto.valor, 4, '«la grande» sobre «Coca» es la de 2 L');
  const d = leer('no, de ayer', { contexto: { intent: a.intent, slots: a.slots } });
  assert.equal(d.intent, a.intent); assert.equal(d.slots.periodo.valor, 'ayer');
  const nombre = leer('llámame Jesús');
  assert.equal(nombre.intent, 'sistema.preferencia');
  assert.equal(nombre.slots.preferencia.valor.cambios.nombre, 'Jesús', 'el nombre se guarda como se escribió');
});

/** Conversación con intérprete real y respuestas de mentira que traen lista, gráfica y explicación. */
function conversacion({ prefs = {} } = {}) {
  const respondidas = [];
  const conv = crearConversacion({
    interprete: () => interprete,
    datos: async () => ({ catalogo: CATALOGO, categorias: CATEGORIAS, personas: [], conceptos: [], modulos: new Set() }),
    store: { guardarMensaje: async () => {}, guardarFrase: async () => {}, preferencias: async () => prefs },
    listarHallazgos: async () => [],
    acciones: { responder: async (it, ctx) => {
      respondidas.push({ it, ctx });
      if (it.falta) return { autor: 'wybix', texto: `¿${it.falta}?`, esperando: { intent: it.intent, slots: it.slots, falta: it.falta } };
      if (it.intent === 'analisis.libre' || it.intent === 'venta.top') {
        return { autor: 'wybix', texto: 'Lo más vendido: Concha.', datos: [{ etiqueta: 'Concha', valor: '50' }, { etiqueta: 'Café americano', valor: '25' }],
                 grafica: { tipo: 'barras', puntos: [{ etiqueta: 'Concha', valor: 50 }, { etiqueta: 'Café americano', valor: 25 }] },
                 refs: [{ tipo: 'producto', id: 1, nombre: 'Concha' }, { tipo: 'producto', id: 2, nombre: 'Café americano' }],
                 explica: { lineas: ['Periodo: este mes.', 'Cómo: sumé las piezas.'] } };
      }
      return { autor: 'wybix', texto: `ok ${it.intent} ${JSON.stringify(Object.fromEntries(Object.entries(it.slots).map(([k, v]) => [k, v?.valor ?? null])))}` };
    } },
  });
  return { conv, respondidas };
}
const CTX = { userId: 7, usuario: 'jesus', puede: () => true };

test('conversación: «dime más del segundo» es el segundo de la lista; la gráfica y el botón de «¿Cómo lo calculé?» salen; lo interno no', async () => {
  const { conv, respondidas } = conversacion();
  let r = await conv.procesar(CTX, { texto: 'qué es lo que más se vende' });
  const lista = r[1];
  assert.ok(lista.grafica, 'la gráfica sale al chat');
  assert.equal(lista.refs, undefined, 'las refs son internas');
  assert.equal(lista.explica, undefined, 'la explicación es interna');
  assert.ok(lista.opciones.some((o) => /calcul/.test(o.etiqueta)), 'ofrece «¿Cómo lo calculé?»');
  r = await conv.procesar(CTX, { texto: 'dime más del segundo' });
  assert.equal(respondidas.at(-1).it.intent, 'producto.info');
  assert.equal(respondidas.at(-1).it.slots.producto.valor, 2);
  r = await conv.procesar(CTX, { texto: '¿y el primero?' });
  assert.equal(respondidas.at(-1).it.slots.producto.valor, 1, 'la lista sigue viva después de preguntar por uno');
  r = await conv.procesar(CTX, { texto: '¿cómo lo calculaste?' });
  assert.match(r[1].texto, /^Lo saqué así: Periodo: este mes\. Cómo: sumé las piezas\./);
});

test('conversación: las preferencias llegan a las acciones; sin gráficas no hay gráfica; «léeme» marca el mensaje para leerlo', async () => {
  const { conv, respondidas } = conversacion({ prefs: { graficas: false, hablar: true, nombre: 'Jesús' } });
  const r = await conv.procesar(CTX, { texto: 'qué es lo que más se vende' });
  assert.equal(r[1].grafica, undefined);
  assert.equal(r[1].hablar, true);
  assert.equal(respondidas.at(-1).ctx.prefs.nombre, 'Jesús');
});

test('conversación: el alta de un producto pregunta costo y existencia, y «no sé» / «ninguno» los salta', async () => {
  const { conv, respondidas } = conversacion();
  let r = await conv.procesar(CTX, { texto: 'da de alta un producto Dona de chocolate a 18 en panadería' });
  assert.equal(r[1].esperando?.falta, 'costo');
  r = await conv.procesar(CTX, { texto: '7.50' });
  assert.equal(r[1].esperando?.falta, 'existencia');
  r = await conv.procesar(CTX, { texto: 'ninguno' });
  const ult = respondidas.at(-1).it;
  assert.equal(ult.intent, 'producto.crear'); assert.equal(ult.falta, null);
  assert.equal(ult.slots.costo.valor, 7.5);
  assert.equal(ult.slots.existencia.omitido, true);
  /* Y con «no sé» al costo. */
  r = await conv.procesar(CTX, { texto: 'nuevo producto Galleta de nuez a 12 en panadería' });
  r = await conv.procesar(CTX, { texto: 'no sé' });
  assert.equal(r[1].esperando?.falta, 'existencia');
  r = await conv.procesar(CTX, { texto: '20' });
  assert.equal(respondidas.at(-1).it.slots.costo.omitido, true);
  assert.equal(respondidas.at(-1).it.slots.existencia.valor, 20);
});

test('editar la ficha hablando: costo, código, SKU, nombre, IVA, impuestos y baja; por nombre o por código de barras', () => {
  const cat = prepararCatalogo([{ id: 1, nombre: 'Concha', bar_code: '7501000111111', part_number: 'PAN-CON' },
    { id: 3, nombre: 'Coca Cola 600 ml', bar_code: '7501055300846' }, { id: 5, nombre: 'Papas Sabritas 45 g' }]);
  const l = (texto) => interprete.interpretar(texto, { catalogo: cat, categorias: CATEGORIAS, modulos: new Set(), ahora: HOY });
  const casos = [
    ['cambia el costo de la concha a 8', 'producto.editar', 1, 'costo', 8],
    ['el costo de la concha es 8', 'producto.editar', 1, 'costo', 8],
    ['cambia el costo del 7501055300846 a 9.50', 'producto.editar', 3, 'costo', 9.5],
    ['ponle el codigo de barras 7501234567890 a la concha', 'producto.editar', 1, 'codigo_barras', '7501234567890'],
    ['cambia el código de barras de la concha a 7501234567890', 'producto.editar', 1, 'codigo_barras', '7501234567890'],
    ['quítale el código de barras a la concha', 'producto.editar', 1, 'codigo_barras', ''],
    ['cambia el sku de la concha a PAN-001', 'producto.editar', 1, 'sku', 'PAN-001'],
    ['renombra la concha a Concha de vainilla', 'producto.editar', 1, 'nombre', 'Concha de vainilla'],
    ['ponle iva 16 a la coca', 'producto.editar', 3, 'iva', 0.16],
    ['la coca va sin IVA', 'producto.editar', 3, 'iva', 0],
    ['ponle IEPS 8% a las papas', 'producto.impuesto', 5],
    ['quítale el IEPS a las papas', 'producto.impuesto', 5],
    ['da de baja la concha', 'producto.baja', 1],
    ['desactiva el 7501055300846', 'producto.baja', 3],
    ['actualiza el producto con código de barras 7501055300846 a 25 pesos', 'producto.precio', 3],
    ['ponle 25 pesos al 7501055300846', 'producto.precio', 3],
  ];
  for (const [texto, intent, prod, campo, valor] of casos) {
    const r = l(texto);
    assert.equal(r.intent, intent, texto);
    assert.equal(r.slots.producto?.valor, prod, `${texto}: producto`);
    if (campo) { assert.equal(r.slots.campo.valor, campo, `${texto}: campo`); assert.equal(r.slots.valor.valor, valor, `${texto}: valor`); }
  }
  /* Una pregunta no es una orden, y una merma no es una baja del catálogo. */
  assert.notEqual(l('cuál es el costo de la concha').intent, 'producto.editar');
  assert.equal(l('dar de baja 5 conchas por caducidad').intent, 'merma.registrar');
  /* Sin valor: pregunta el que falta, con el campo en la pregunta. */
  const sinValor = l('cambia el costo de la concha');
  assert.equal(sinValor.falta, 'valor');
  const respuesta = interprete.interpretar('7.5', { catalogo: cat, categorias: CATEGORIAS, modulos: new Set(), ahora: HOY,
    esperando: { intent: sinValor.intent, slots: sinValor.slots, falta: 'valor' } });
  assert.equal(respuesta.slots.valor.valor, 7.5); assert.equal(respuesta.falta, null);
  /* Un código de barras repetido en dos productos: pregunta cuál. */
  const dup = prepararCatalogo([{ id: 1, nombre: 'Concha', bar_code: '7855745585855' }, { id: 2, nombre: 'Bolillo', bar_code: '7855745585855' }]);
  const rd = interprete.interpretar('cambia el costo del 7855745585855 a 5', { catalogo: dup, categorias: [], modulos: new Set(), ahora: HOY });
  assert.equal(rd.falta, 'producto'); assert.equal(rd.slots.producto.opciones.length, 2);
});

test('ventas y caja hablando: abrir, corte con lo contado, cajón, correo, reimprimir, devolución y cobro', () => {
  const cat = prepararCatalogo([{ id: 1, nombre: 'Concha' }, { id: 3, nombre: 'Coca Cola 600 ml', bar_code: '7501055300846' }]);
  const l = (texto, esperando) => interprete.interpretar(texto, { catalogo: cat, categorias: CATEGORIAS, modulos: new Set(), ahora: HOY, esperando });
  const casos = [
    ['abre la caja con 500', 'caja.abrir', { monto: 500 }],
    ['abrir turno con $1,000 de fondo', 'caja.abrir', { monto: 1000 }],
    ['haz el corte, conté 3250', 'caja.corte', { monto: 3250 }],
    ['cierra la caja, hay $2,800', 'caja.corte', { monto: 2800 }],
    ['abre el cajón', 'caja.cajon', {}],
    ['manda el corte por correo', 'caja.corte_correo', {}],
    ['reimprime el ticket 1234', 'venta.reimprimir', { folio: 1234 }],
    ['vuelve a imprimir el último ticket', 'venta.reimprimir', { folio: 'ultimo' }],
    ['devuelve el ticket 120, venía en mal estado', 'venta.devolucion', { folio: 120, razon: 'Mal estado' }],
    ['cóbrale 2 cocas en efectivo', 'venta.cobrar', { metodo: 'EFECTIVO' }],
    ['cobra 3 conchas con tarjeta', 'venta.cobrar', { metodo: 'TARJETA' }],
    /* En un cobro el número de piezas no es dinero; lo recibido se dice aparte. */
    ['cóbrale 2 cocas en efectivo, me dio 50', 'venta.cobrar', { metodo: 'EFECTIVO', monto: 50 }],
  ];
  for (const [texto, intent, slots] of casos) {
    const r = l(texto);
    assert.equal(r.intent, intent, texto);
    for (const [k, v] of Object.entries(slots)) assert.equal(r.slots[k]?.valor, v, `${texto}: ${k}`);
  }
  /* El cobro lleva sus renglones; cuánto hay en caja sigue siendo consulta. */
  assert.deepEqual(l('cóbrale 2 cocas en efectivo').slots.renglones.valor.map((x) => [x.productId, x.cantidad]), [[3, 2]]);
  assert.equal(l('cuánto hay en el cajón').intent, 'caja.efectivo');
  assert.equal(l('quién abrió la caja').intent, 'caja.turno');
  /* Devolución sin motivo: lo pregunta, y la respuesta con un botón lo llena. */
  const sinMotivo = l('devuelve el ticket 120');
  assert.equal(sinMotivo.falta, 'razon');
  const resp = l('No lo quiso', { intent: sinMotivo.intent, slots: sinMotivo.slots, falta: 'razon' });
  assert.equal(resp.slots.razon.valor, 'No lo quiso'); assert.equal(resp.falta, null);
  /* Corte sin lo contado: lo pregunta. */
  assert.equal(l('haz el corte').falta, 'monto');
});

test('clientes, proveedores, compras y catálogo hablando', () => {
  const personas = prepararCatalogo([{ id: 1, nombre: 'Doña Mary', tipo: 'cliente' }, { id: 2, nombre: 'Bimbo', tipo: 'proveedor' },
    { id: 3, nombre: 'Coca-Cola FEMSA', tipo: 'proveedor' }]);
  const cat = prepararCatalogo([{ id: 5, nombre: 'Coca Cola 600 ml' }, { id: 6, nombre: 'Concha' }, { id: 7, nombre: 'Sabritas 45 g' }]);
  const l = (texto) => interprete.interpretar(texto, { catalogo: cat, personas, categorias: CATEGORIAS, modulos: new Set(), ahora: HOY });
  const casos = [
    ['cambia el teléfono de doña mary a 55 1234 5678', 'cliente.editar', { cliente: 1, campo: 'telefono', valor: '5512345678' }],
    ['ponle límite de crédito de 2000 a doña mary', 'cliente.editar', { cliente: 1, campo: 'limite', valor: 2000 }],
    ['dale 30 días de crédito a doña mary', 'cliente.editar', { cliente: 1, campo: 'dias', valor: 30 }],
    ['el correo de bimbo es Ventas@Bimbo.mx', 'proveedor.editar', { proveedor: 2, campo: 'correo', valor: 'ventas@bimbo.mx' }],
    ['cambia el rfc de bimbo a BIM011108DJ5', 'proveedor.editar', { proveedor: 2, campo: 'rfc', valor: 'BIM011108DJ5' }],
    ['compré 24 cocas a 12 a coca-cola', 'compra.registrar', { proveedor: 3 }],
    ['crea la categoría Lácteos', 'categoria.alta', { nombre: 'Lácteos' }],
    ['agrega la marca Lala', 'marca.alta', { nombre: 'Lala' }],
    ['Bimbo me surte las conchas', 'producto.proveedor', { proveedor: 2, producto: 6, accion: 'agregar' }],
    ['el proveedor principal de la concha es Bimbo', 'producto.proveedor', { proveedor: 2, producto: 6, accion: 'principal' }],
    ['bimbo ya no me surte las conchas', 'producto.proveedor', { proveedor: 2, producto: 6, accion: 'quitar' }],
  ];
  for (const [texto, intent, slots] of casos) {
    const r = l(texto);
    assert.equal(r.intent, intent, texto);
    for (const [k, v] of Object.entries(slots)) assert.equal(r.slots[k]?.valor, v, `${texto}: ${k}`);
  }
  /* En una compra «a 12» es el costo y «Coca-Cola» el proveedor, no cocas. */
  const c = l('llegó el pedido de bimbo: 30 conchas a 6 pesos y 10 sabritas a 14 en efectivo');
  assert.deepEqual(c.slots.renglones.valor.map((x) => [x.productId, x.cantidad]), [[6, 30], [7, 10]]);
  assert.deepEqual(c.slots.costos.valor, [6, 14]);
  assert.equal(c.slots.metodo.valor, 'EFECTIVO');
  assert.deepEqual(l('compré 24 cocas a 12 a coca-cola').slots.renglones.valor.map((x) => [x.productId, x.cantidad]), [[5, 24]]);
  /* Preguntas no son órdenes. */
  assert.equal(l('quién me surte las conchas').intent, 'proveedor.quien');
  assert.equal(l('cuál es el teléfono de doña mary').intent, 'cliente.info');
  assert.equal(l('cambia el teléfono de doña mary').falta, 'valor');
});
