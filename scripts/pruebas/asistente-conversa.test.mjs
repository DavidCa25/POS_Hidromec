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

test('socios, propinas, gastos y producción hablando', () => {
  const socios = [{ id: 1, nombre: 'Juan Pérez' }, { id: 2, nombre: 'Ana' }];
  const conceptos = [{ id: 1, nombre: 'Luz' }, { id: 2, nombre: 'Gasolina' }];
  const cat = prepararCatalogo([{ id: 6, nombre: 'Concha' }]);
  const l = (texto, modulos = new Set(['socios', 'propinas', 'hospitality'])) =>
    interprete.interpretar(texto, { catalogo: cat, personas: [], socios, conceptos, categorias: CATEGORIAS, modulos, ahora: HOY });
  const casos = [
    ['Juan retiró 500 de la caja', 'socio.movimiento', { socio: 1, tipo: 'RETIRO', monto: 500, metodo: 'EFECTIVO' }],
    ['Ana aportó 2,000', 'socio.movimiento', { socio: 2, tipo: 'APORTACION', monto: 2000 }],
    ['le pagué 1,000 a Juan por transferencia', 'socio.movimiento', { socio: 1, tipo: 'PAGO', monto: 1000, metodo: 'TRANSFERENCIA' }],
    ['la compra 45 la pagó Juan', 'socio.compra', { socio: 1, folio: 45 }],
    ['el gasto 12 es de Ana', 'socio.gasto', { socio: 2, folio: 12, pago: false }],
    ['liquida a los socios', 'socio.liquidar', {}],
    ['reparte las propinas', 'propinas.repartir', {}],
    ['cancela el gasto 12, era de otra sucursal', 'gasto.cancelar', { folio: 12 }],
    ['crea el concepto de gasto Papelería', 'gasto.concepto', { accion: 'crear', nombre: 'Papelería' }],
    ['desactiva el concepto gasolina', 'gasto.concepto', { accion: 'desactivar', concepto: 2 }],
    ['empieza la tanda de conchas', 'produccion.empezar', { producto: 6 }],
    ['salieron 48 conchas', 'produccion.terminar', { producto: 6, cantidad: 48 }],
    ['cancela la tanda de conchas', 'produccion.cancelar', { producto: 6 }],
  ];
  for (const [texto, intent, slots] of casos) {
    const r = l(texto);
    assert.equal(r.intent, intent, texto);
    for (const [k, v] of Object.entries(slots)) assert.equal(r.slots[k]?.valor, v, `${texto}: ${k}`);
  }
  /* Quien no es socio no es un movimiento de socio; sin la aplicación, tampoco. */
  assert.notEqual(l('el cajero sacó 300').intent, 'socio.movimiento');
  assert.equal(l('saqué 300 del cajón').intent, 'caja.salida');
  assert.notEqual(l('Juan retiró 500', new Set()).intent, 'socio.movimiento');
  assert.equal(l('pagué 300 de luz').intent, 'gasto.registrar');
  /* Cancelar sin motivo: lo pregunta y la respuesta entera es el motivo. */
  const sin = l('cancela el gasto 12');
  const resp = interprete.interpretar('lo capturé dos veces', { catalogo: cat, personas: [], socios, conceptos, modulos: new Set(), ahora: HOY,
    esperando: { intent: sin.intent, slots: sin.slots, falta: 'motivo' } });
  assert.equal(resp.intent, 'gasto.cancelar'); assert.equal(resp.slots.motivo.valor, 'lo capturé dos veces');
});

test('servicios hablando: órdenes, profesionales, horario, ausencias, catálogo, activos y giro', () => {
  const personas = prepararCatalogo([{ id: 1, nombre: 'Doña Mary', tipo: 'cliente' }, { id: 4, nombre: 'Laura López', tipo: 'profesional' }]);
  const cat = prepararCatalogo([{ id: 20, nombre: 'Cambio de aceite' }, { id: 21, nombre: 'Corte de cabello' }, { id: 22, nombre: 'Tinte' }, { id: 23, nombre: 'Balatas delanteras' }]);
  const ahora = new Date(2026, 10, 17, 10);
  const l = (texto, modulos = new Set(['servicios'])) => interprete.interpretar(texto, { catalogo: cat, personas, modulos, ahora });
  const casos = [
    ['abre una orden para doña mary: no prende la licuadora', 'orden.crear', { cliente: 1, reportado: 'No prende la licuadora' }],
    ['la orden 12 ya está lista', 'orden.estado', { folio: 12, estado: 'TERMINADA' }],
    ['entrega la orden 12', 'orden.estado', { folio: 12, estado: 'ENTREGADA' }],
    ['el cliente autorizó la orden 12 por teléfono', 'orden.autorizar', { folio: 12, via: 'TELEFONO' }],
    ['cancela la orden 12, ya no lo quiso', 'orden.cancelar', { folio: 12, motivo: 'Ya no lo quiso' }],
    ['el diagnóstico de la orden 12 es: falla el motor', 'orden.diagnostico', { folio: 12, diagnostico: 'Falla el motor' }],
    ['ponle 2 balatas delanteras a la orden 12', 'orden.linea', { folio: 12, producto: 23, cantidad: 2 }],
    ['el cambio de aceite de la orden 12 ya está hecho', 'orden.linea_cambiar', { folio: 12, producto: 20, estado: 'HECHA' }],
    ['el cambio de aceite de la orden 12 a 350', 'orden.linea_cambiar', { folio: 12, producto: 20, precio: 350 }],
    ['llegó doña mary a su cita', 'cita.orden', { cliente: 1 }],
    ['crea el servicio Corte de dama a 250 de 45 minutos', 'servicio.crear', { nombre: 'Corte de dama', precio: 250, duracion: 45 }],
    ['desactiva el servicio tinte', 'servicio.activar', { producto: 22, activo: false }],
    ['mi negocio es una barbería', 'servicio.giro', { preset: 'BELLEZA' }],
    ['registra el carro de doña mary: Nissan Versa 2018 placas ABC1234', 'activo.crear', { cliente: 1, clase: 'VEHICULO', identificador: 'ABC1234' }],
    ['da de alta a la estilista Paola Ruiz', 'profesional.alta', { nombre: 'Paola Ruiz', puesto: 'Estilista' }],
    ['desactiva a laura', 'profesional.activar', { profesional: 4, activo: false }],
    ['laura hace cortes de cabello', 'profesional.servicio', { profesional: 4, producto: 21, quitar: false }],
    ['laura ya no hace tintes', 'profesional.servicio', { profesional: 4, producto: 22, quitar: true }],
    ['laura trabaja de lunes a viernes de 9 a 6', 'profesional.horario', { profesional: 4, desde: '09:00', hasta: '18:00' }],
  ];
  for (const [texto, intent, slots] of casos) {
    const r = l(texto);
    assert.equal(r.intent, intent, texto);
    for (const [k, v] of Object.entries(slots)) assert.equal(r.slots[k]?.valor, v, `${texto}: ${k}`);
  }
  assert.deepEqual(l('laura trabaja de lunes a viernes de 9 a 6').slots.dias.valor, [2, 3, 4, 5, 6]);
  assert.deepEqual(l('laura sale de vacaciones del 1 al 15 de diciembre').slots.fechas.valor, { desde: '2026-12-01', hasta: '2026-12-15' });
  assert.deepEqual(l('laura no viene el viernes').slots.fechas.valor, { desde: '2026-11-20', hasta: '2026-11-20' });
  /* Sin Servicios encendido, nada de esto; quien no es profesional, tampoco. */
  assert.notEqual(l('la orden 12 ya está lista', new Set()).intent, 'orden.estado');
  assert.notEqual(l('pedro trabaja de lunes a viernes de 9 a 6').intent, 'profesional.horario');
});

test('fidelización hablada: puntos, membresía, rifas, cupones y configuración', () => {
  const personas = prepararCatalogo([{ id: 1, nombre: 'Doña Mary', tipo: 'cliente' }]);
  const l = (texto) => interprete.interpretar(texto, { catalogo: [], personas, modulos: new Set(), ahora: HOY });
  const casos = [
    ['ponle 100 puntos a doña mary porque se le cobró doble', 'puntos.ajustar', { cliente: 1, cantidad: 100, nota: 'se le cobró doble' }],
    ['quítale 50 puntos a doña mary', 'puntos.ajustar', { cliente: 1, cantidad: -50 }],
    ['cancela la membresía de doña mary', 'club.cancelar', { cliente: 1 }],
    ['cierra la rifa de navidad', 'rifa.cerrar', { textoRifa: 'navidad' }],
    ['sortea la rifa de navidad con 3 ganadores', 'rifa.sortear', { textoRifa: 'navidad', ganadores: 3 }],
    ['dale a doña mary un cupón de 10%', 'cupon.emitir', { cliente: 1, textoCupon: '10%', cantidad: 1 }],
    ['genera 20 cupones de 2x1', 'cupon.emitir', { textoCupon: '2x1', cantidad: 20 }],
    ['da 1 punto por cada 10 pesos', 'puntos.config', { puntos: 1, cadaMonto: 10 }],
    ['los puntos caducan a los 12 meses', 'puntos.config', { caducaMeses: 12 }],
    ['apaga los puntos', 'puntos.config', { activo: false }],
  ];
  for (const [texto, intent, slots] of casos) {
    const r = l(texto);
    assert.equal(r.intent, intent, texto);
    for (const [k, v] of Object.entries(slots)) assert.equal(r.slots[k]?.valor, v, `${texto}: ${k}`);
  }
  /* Un cliente que no existe no es un ajuste de puntos. */
  assert.notEqual(l('ponle 100 puntos a perenganito').intent, 'puntos.ajustar');
});

test('mesas, comandas, salón y estaciones hablando', () => {
  const personas = prepararCatalogo([{ id: 1, nombre: 'Doña Mary', tipo: 'cliente' }]);
  const cat = prepararCatalogo([{ id: 30, nombre: 'Taco al pastor' }, { id: 31, nombre: 'Coca Cola 600 ml' }, { id: 32, nombre: 'Agua de jamaica' }]);
  const estaciones = [{ id: 1, nombre: 'Barra' }, { id: 2, nombre: 'Cocina' }];
  const l = (texto, modulos = new Set(['hospitality'])) => interprete.interpretar(texto, { catalogo: cat, personas, estaciones, modulos, ahora: HOY });
  const casos = [
    ['abre la mesa 4 para 3', 'cuenta.abrir', { mesa: '4', personas: 3 }],
    ['abre una cuenta para llevar a nombre de Juan', 'cuenta.abrir', { etiqueta: 'Juan' }],
    ['la mesa 4 pidió la cuenta', 'cuenta.estado', { mesa: '4', estado: 'POR_COBRAR' }],
    ['la mesa 4 es de doña mary', 'cuenta.cliente', { mesa: '4', cliente: 1 }],
    ['libera la mesa 4', 'cuenta.liberar', { mesa: '4' }],
    ['la comanda 12 ya está lista', 'comanda.estado', { comanda: 12, estado: 'LISTA' }],
    ['cancela la comanda 12, se quemó', 'comanda.cancelar', { comanda: 12, motivo: 'Se quemó' }],
    ['reimprime la comanda 12', 'comanda.reimprimir', { comanda: 12 }],
    ['crea el área Terraza', 'salon.area', { nombre: 'Terraza' }],
    ['agrega la mesa 10 en la terraza para 4', 'salon.mesa', { nombre: '10', textoArea: 'terraza', capacidad: 4 }],
    ['crea la estación Postres', 'estacion.crear', { nombre: 'Postres' }],
    ['el agua de jamaica va a la barra', 'estacion.producto', { producto: 32, estacion: 1 }],
  ];
  for (const [texto, intent, slots] of casos) {
    const r = l(texto);
    assert.equal(r.intent, intent, texto);
    for (const [k, v] of Object.entries(slots)) assert.equal(r.slots[k]?.valor, v, `${texto}: ${k}`);
  }
  assert.deepEqual(l('la mesa 4 pide 2 tacos al pastor y una coca').slots.renglones.valor.map((x) => [x.productId, x.cantidad]), [[30, 2], [31, 1]]);
  assert.deepEqual(l('manda 3 aguas de jamaica a la mesa 4').slots.renglones.valor.map((x) => [x.productId, x.cantidad]), [[32, 3]]);
  /* «La concha va a subir» no es una estación; sin Hospitality, no hay mesas. */
  assert.notEqual(l('el agua de jamaica va a subir').intent, 'estacion.producto');
  assert.notEqual(l('abre la mesa 4', new Set()).intent, 'cuenta.abrir');
});

test('configuración hablada: usuarios, cajas, aplicaciones, giro, respaldos, asistencia y propinas', () => {
  const usuarios = [{ id: 2, nombre: 'pedro' }, { id: 3, nombre: 'ana' }];
  const l = (texto, modulos = new Set(['asistencia', 'propinas'])) => interprete.interpretar(texto, { catalogo: [], personas: [], usuarios, modulos, ahora: HOY });
  const casos = [
    ['desactiva al usuario pedro', 'usuario.activar', { usuario: 2, activo: false }],
    ['haz encargado a pedro', 'usuario.rol', { usuario: 2, rol: 'supervisor' }],
    ['pedro ahora es cajero', 'usuario.rol', { usuario: 2, rol: 'cajero' }],
    ['dale a pedro permiso de devoluciones', 'usuario.permiso', { usuario: 2, permisoTexto: 'devoluciones', quitar: false }],
    ['quítale a pedro el permiso de ver costos', 'usuario.permiso', { usuario: 2, quitar: true }],
    ['agrega la caja 3', 'caja.alta', { nombre: 'Caja 3' }],
    ['desactiva la caja 2', 'caja.activar', { cajaTexto: '2', activo: false }],
    ['enciende servicios', 'modulo.activar', { modulo: 'servicios', activo: true }],
    ['activa propinas repartidas por horas', 'modulo.activar', { modulo: 'propinas', reparto: 'HORAS' }],
    ['el giro es panadería', 'negocio.giro', { giro: 'panaderia' }],
    ['haz un respaldo ahora', 'respaldo.ahora', {}],
    ['respalda todos los días a las 11 de la noche', 'respaldo.config', { hora: '23:00', activo: true }],
    ['checa mi entrada', 'asistencia.marcar', { tipo: 'ENTRADA' }],
    ['salgo a comer', 'asistencia.marcar', { tipo: 'INICIO_DESCANSO' }],
    ['checa mi salida', 'asistencia.marcar', { tipo: 'SALIDA' }],
    ['el horario de pedro es de lunes a viernes de 9 a 6 con 30 minutos de comida', 'asistencia.horario', { usuario: 2, desde: '09:00', hasta: '18:00', descanso: 30 }],
    ['corrige la entrada de pedro de ayer a las 9', 'asistencia.corregir', { usuario: 2, cual: 'entrada', dia: 'ayer', hora: '09:00' }],
    ['no marques los retardos', 'asistencia.reglas', { regla: 'marcaRetardos', valor: false }],
    ['que tengan que checar antes de vender', 'asistencia.reglas', { regla: 'entradaParaVender', valor: true }],
    ['las propinas se reparten por horas', 'propinas.config', { reparto: 'HORAS' }],
  ];
  for (const [texto, intent, slots] of casos) {
    const r = l(texto);
    assert.equal(r.intent, intent, texto);
    for (const [k, v] of Object.entries(slots)) assert.equal(r.slots[k]?.valor, v, `${texto}: ${k}`);
  }
  /* Quien no es usuario no se desactiva; sin Asistencia, no se checa. */
  assert.notEqual(l('desactiva a juan').intent, 'usuario.activar');
  assert.notEqual(l('checa mi entrada', new Set()).intent, 'asistencia.marcar');
});

test('recetas, fórmulas, presentaciones, grupos de opciones, dueño y reportes de conteo', () => {
  const cat = prepararCatalogo([{ id: 40, nombre: 'Hamburguesa sencilla' }, { id: 41, nombre: 'Carne molida' }, { id: 42, nombre: 'Pan de hamburguesa' },
    { id: 43, nombre: 'Queso amarillo' }, { id: 44, nombre: 'Concha' }, { id: 45, nombre: 'Harina' }, { id: 46, nombre: 'Azúcar' },
    { id: 47, nombre: 'Coca Cola 600 ml' }, { id: 48, nombre: 'Latte' }]);
  const socios = [{ id: 1, nombre: 'Juan Pérez' }, { id: 2, nombre: 'Ana' }];
  const l = (texto) => interprete.interpretar(texto, { catalogo: cat, personas: [], socios, modulos: new Set(['socios']), ahora: HOY });
  const r1 = l('la hamburguesa sencilla lleva 150 gramos de carne molida, 1 pan de hamburguesa y 2 rebanadas de queso amarillo');
  assert.equal(r1.intent, 'receta.guardar'); assert.equal(r1.slots.producto.valor, 40);
  assert.deepEqual(r1.slots.lineas.valor.map((x) => [x.productId, x.cantidad, x.unidad]), [[41, 150, 'g'], [42, 1, null], [43, 2, 'pza']]);
  const r2 = l('la fórmula de las conchas: 1 kilo de harina y 200 gramos de azúcar, rinde 20');
  assert.equal(r2.intent, 'formula.guardar'); assert.equal(r2.slots.rinde.valor, 20);
  assert.deepEqual(r2.slots.lineas.valor.map((x) => [x.productId, x.cantidad, x.unidad]), [[45, 1, 'kg'], [46, 200, 'g']]);
  const casos = [
    ['quítale el queso amarillo a la receta de la hamburguesa sencilla', 'receta.guardar', { producto: 40, quitarIngrediente: 43 }],
    ['borra la receta de la hamburguesa sencilla', 'receta.borrar', { producto: 40 }],
    ['borra la fórmula de las conchas', 'formula.quitar', { producto: 44 }],
    ['la coca también se vende en caja de 24', 'presentacion.guardar', { producto: 47, nombre: 'Caja de 24', factor: 24 }],
    ['borra la presentación caja de 24 de la coca', 'presentacion.borrar', { producto: 47, presentacion: 'caja de 24' }],
    ['crea el grupo Tamaño con chico, mediano +5 y grande +10', 'opciones.crear', { nombre: 'Tamaño', rol: 'SIZE' }],
    ['el latte lleva el grupo tamaño', 'opciones.producto', { producto: 48, grupo: 'tamano' }],
    ['quítale el grupo tamaño al latte', 'opciones.producto', { producto: 48, quitar: true }],
    ['borra el grupo tamaño', 'opciones.borrar', { grupo: 'tamano' }],
    ['aplica el conteo de la coca', 'inventario.reporte', { producto: 47, accion: 'APLICAR' }],
    ['ya revisé el inventario', 'inventario.revisado', {}],
  ];
  for (const [texto, intent, slots] of casos) {
    const r = l(texto);
    assert.equal(r.intent, intent, texto);
    for (const [k, v] of Object.entries(slots)) assert.equal(r.slots[k]?.valor, v, `${texto}: ${k}`);
  }
  assert.deepEqual(l('crea el grupo Tamaño con chico, mediano +5 y grande +10').slots.opciones.valor.map((o) => o.precio), [0, 5, 10]);
  assert.deepEqual(l('las conchas son de juan y ana').slots.socios.valor, [1, 2]);
  /* «La concha es de chocolate» no es de un socio. */
  assert.notEqual(l('la concha es de chocolate').intent, 'producto.dueno');
});

test('menú en línea y plataformas hablados', () => {
  const cat = prepararCatalogo([{ id: 44, nombre: 'Concha' }, { id: 48, nombre: 'Latte' }]);
  const l = (texto, modulos = new Set(['hospitality'])) => interprete.interpretar(texto, { catalogo: cat, personas: [], modulos, ahora: HOY });
  const casos = [
    ['acepta el pedido en línea 12', 'pedido.aceptar', { pedido: 12 }],
    ['acepta el pedido de Juan', 'pedido.aceptar', { clienteTexto: 'juan' }],
    ['rechaza el pedido 12, no hay gas', 'pedido.rechazar', { pedido: 12, motivo: 'no hay gas' }],
    ['activa el menú en línea', 'menu.config', { campo: 'activo', valor: true }],
    ['ya no recibas pedidos en línea', 'menu.config', { campo: 'recibePedidos', valor: false }],
    ['el tiempo de entrega es de 30 minutos', 'menu.config', { campo: 'minutos', valor: 30 }],
    ['la frase del menú es El mejor pan del barrio', 'menu.diseno', { campo: 'frase', valor: 'El mejor pan del barrio' }],
    ['oculta la concha del menú en línea', 'menu.producto', { producto: 44, campo: 'oculto', valor: true }],
    ['destaca el latte en el menú', 'menu.producto', { producto: 48, campo: 'destacado', valor: true }],
    ['la descripción del latte en el menú es Café con leche espumosa', 'menu.producto', { producto: 48, campo: 'descripcion', valor: 'Café con leche espumosa' }],
    ['quita la foto de la concha del menú', 'menu.foto_quitar', { producto: 44 }],
    ['confirma la liquidación de Rappi', 'plataforma.confirmar', { plataforma: 'RAPPI' }],
    ['cancela la liquidación de Rappi, venía mal', 'plataforma.cancelar', { plataforma: 'RAPPI', motivo: 'venía mal' }],
    ['llegó el depósito de Rappi por 4,500', 'plataforma.deposito', { plataforma: 'RAPPI', importe: 4500 }],
    ['el pedido A123x de Rappi es la venta 456', 'plataforma.emparejar', { plataforma: 'RAPPI', pedido: 'A123x', venta: 456 }],
  ];
  for (const [texto, intent, slots] of casos) {
    const r = l(texto);
    assert.equal(r.intent, intent, texto);
    for (const [k, v] of Object.entries(slots)) assert.equal(r.slots[k]?.valor, v, `${texto}: ${k}`);
  }
  assert.notEqual(l('oculta la concha del menú en línea', new Set()).intent, 'menu.producto');
  /* Un color que no es #rrggbb no se manda. */
  assert.notEqual(l('el color del menú es rojo').intent, 'menu.diseno');
});

test('cambio de producto, corregir venta, venta suelta, tickets, activos, WhatsApp, aprobaciones e impuestos', () => {
  const personas = prepararCatalogo([{ id: 1, nombre: 'Doña Mary', tipo: 'cliente' }]);
  const cat = prepararCatalogo([{ id: 3, nombre: 'Coca Cola 600 ml' }, { id: 4, nombre: 'Pepsi 600 ml' }, { id: 6, nombre: 'Concha' },
    { id: 7, nombre: 'Cigarro suelto' }, { id: 8, nombre: 'Cajetilla de cigarros' }]);
  const l = (texto) => interprete.interpretar(texto, { catalogo: cat, personas, modulos: new Set(['servicios']), ahora: HOY });
  const casos = [
    ['cambia la coca del ticket 120 por una pepsi', 'venta.cambio', { folio: 120, devuelve: 3, lleva: 4 }],
    ['el cigarro suelto sale de la cajetilla de 20', 'venta.suelta', { producto: 7, padre: 8, piezas: 20 }],
    ['manda el ticket 120 a Juan@Correo.com', 'ticket.correo', { folio: 120, correo: 'juan@correo.com' }],
    ['imprime el corte', 'ticket.imprimir', { documento: 'closure' }],
    ['imprime la devolución 5', 'ticket.imprimir', { documento: 'refund', folio: 5 }],
    ['quita el logo del ticket', 'ticket.logo_quitar', {}],
    ['da de baja el carro de doña mary', 'activo.baja', { cliente: 1 }],
    ['avisa por WhatsApp cuando el pedido esté listo', 'whatsapp.config', { campo: 'pedidoListo', valor: true }],
    ['ya no avises por whatsapp de las membresías', 'whatsapp.config', { campo: 'membresia', valor: false }],
    ['apaga las aprobaciones', 'aprobaciones.politica', { activas: false }],
    ['crea el impuesto Hospedaje 3%', 'impuesto.crear', { nombre: 'Hospedaje', clase: 'LOCAL', tasa: 0.03 }],
    ['crea el impuesto IEPS por cuota de 1.64 por litro', 'impuesto.crear', { factor: 'Cuota', cuota: 1.64, unidad: 'litro' }],
  ];
  for (const [texto, intent, slots] of casos) {
    const r = l(texto);
    assert.equal(r.intent, intent, texto);
    for (const [k, v] of Object.entries(slots)) assert.equal(r.slots[k]?.valor, v, `${texto}: ${k}`);
  }
  const c = l('corrige la venta 120: eran 3 conchas');
  assert.equal(c.intent, 'venta.corregir'); assert.deepEqual(c.slots.renglon.valor, { productId: 6, cantidad: 3 });
});

test('empresas, sucursales y pantallas de Local Host', () => {
  const usuarios = [{ id: 2, nombre: 'pedro' }];
  const l = (texto) => interprete.interpretar(texto, { catalogo: [], personas: [], usuarios, modulos: new Set(), ahora: new Date(2026, 10, 17) });
  const casos = [
    ['crea la empresa Panadería Centro, giro panadería', 'empresa.crear', { nombre: 'Panadería Centro', giro: 'panaderia' }],
    ['sal del grupo de empresas', 'empresa.salir_grupo', {}],
    ['crea la sucursal Centro', 'sucursal.crear', { nombre: 'Centro', tipo: 'BRANCH' }],
    ['crea el evento Feria de mayo del 1 al 5 de mayo', 'sucursal.crear', { nombre: 'Feria de mayo', tipo: 'EVENT', desde: '2027-05-01', hasta: '2027-05-05' }],
    ['enciende Wybix Local Host', 'localhost.activar', { activo: true }],
    ['renombra la tablet Mesa 1 a Terraza', 'localhost.renombrar', { dispositivo: 'mesa 1', nombre: 'Terraza' }],
    ['desconecta la tablet Terraza', 'localhost.revocar', { dispositivo: 'terraza' }],
    ['la tablet Terraza ahora es de mesero', 'localhost.funcion', { dispositivo: 'terraza', superficie: 'WAITER' }],
    ['quítale el acceso a Pedro en las tablets', 'localhost.acceso_revocar', { usuario: 2 }],
  ];
  for (const [texto, intent, slots] of casos) {
    const r = l(texto);
    assert.equal(r.intent, intent, texto);
    for (const [k, v] of Object.entries(slots)) assert.equal(r.slots[k]?.valor, v, `${texto}: ${k}`);
  }
});

test('multisucursal y pago de servicios hablados', () => {
  const cat = prepararCatalogo([{ id: 3, nombre: 'Coca Cola 600 ml' }]);
  const usuarios = [{ id: 2, nombre: 'pedro' }];
  const l = (texto) => interprete.interpretar(texto, { catalogo: cat, personas: [], usuarios, modulos: new Set(), ahora: HOY });
  const casos = [
    ['publica el catálogo a las sucursales', 'multi.publicar', {}],
    ['trae el catálogo de la matriz', 'multi.recibir', {}],
    ['que las sucursales puedan cambiar sus precios', 'multi.reglas', { regla: 'precios_sucursal', valor: true }],
    ['en la sucursal Centro la coca cuesta 18', 'multi.excepcion', { sucursalTexto: 'centro', producto: 3, precio: 18 }],
    ['en la sucursal Centro no se vende la coca', 'multi.excepcion', { producto: 3, disponible: false }],
    ['recibe el traspaso de la matriz', 'multi.recibir_traspaso', {}],
    ['cancela el traspaso a Centro', 'multi.cancelar_traspaso', { sucursalTexto: 'centro' }],
    ['pedro puede entrar a todas las sucursales', 'multi.alcance', { usuario: 2, todas: true }],
    ['desconecta el pago de servicios', 'servicios_pago.desconectar', {}],
  ];
  for (const [texto, intent, slots] of casos) {
    const r = l(texto);
    assert.equal(r.intent, intent, texto);
    for (const [k, v] of Object.entries(slots)) assert.equal(r.slots[k]?.valor, v, `${texto}: ${k}`);
  }
  assert.deepEqual(l('manda 20 cocas a la sucursal Centro').slots.renglones.valor.map((x) => [x.productId, x.cantidad]), [[3, 20]]);
});

test('datos del negocio hablados', () => {
  const l = (texto) => interprete.interpretar(texto, { catalogo: [], personas: [], modulos: new Set(), ahora: HOY });
  const a = l('el teléfono del negocio es 55 1234 5678');
  assert.equal(a.intent, 'negocio.datos'); assert.equal(a.slots.campo.valor, 'phone'); assert.equal(a.slots.valor.valor, '5512345678');
  const b = l('el pie del ticket dice: ¡Gracias por su compra!');
  assert.equal(b.intent, 'negocio.datos'); assert.equal(b.slots.campo.valor, 'ticket_footer'); assert.equal(b.slots.valor.valor, 'Gracias por su compra');
  const c = l('el rfc del negocio es xaxx010101000');
  assert.equal(c.slots.valor.valor, 'XAXX010101000');
});

test('fidelización: crear cupones, rifas, tarjetas de sellos, planes del Club y campañas', () => {
  const cat = prepararCatalogo([{ id: 9, nombre: 'Café americano' }]);
  const l = (texto) => interprete.interpretar(texto, { catalogo: cat, personas: [], modulos: new Set(), ahora: HOY });
  const casos = [
    ['crea el cupón 10% de descuento, vale 30 días', 'cupon.definir', { tipo: 'PERCENT', pct: 10, dias: 30 }],
    ['crea el cupón $50 de descuento', 'cupon.definir', { tipo: 'AMOUNT', monto: 50 }],
    ['crea el cupón café americano gratis', 'cupon.definir', { tipo: 'FREE_PRODUCT', producto: 9 }],
    ['crea la rifa Navidad, premio una canasta, cierra el 24 de diciembre, 2 ganadores', 'rifa.crear', { nombre: 'Navidad', premio: 'una canasta', ganadores: 2 }],
    ['abre la rifa navidad', 'rifa.abrir', { textoRifa: 'navidad' }],
    ['crea la tarjeta de sellos del café americano: 9 sellos y el 10 gratis', 'sellos.crear', { producto: 9, sellos: 9 }],
    ['crea el plan Café diario: 1 café americano al día por 300 al mes', 'club.plan', { nombre: 'Café diario', producto: 9, limite: 1, precio: 300, dias: 30 }],
    ['cada compra de más de 200 da un cupón de 10%', 'campana.crear', { resultado: 'COUPON', minimo: 200 }],
    ['por cada 100 pesos un boleto de la rifa navidad', 'campana.crear', { resultado: 'RAFFLE', porCada: 100 }],
    ['genera 20 cupones de 2x1', 'cupon.emitir', { cantidad: 20 }],
  ];
  for (const [texto, intent, slots] of casos) {
    const r = l(texto);
    assert.equal(r.intent, intent, texto);
    for (const [k, v] of Object.entries(slots)) assert.equal(r.slots[k]?.valor, v, `${texto}: ${k}`);
  }
});
