/**
 * La ruleta nunca acaba siendo un circulo vacio.
 *
 *     node scripts/pruebas/customer-display-ruleta.mjs
 *
 * EL FALLO QUE ESTA PRUEBA IMPIDE
 * -------------------------------
 * `jgDibujarRueda` se llamaba en UN solo sitio: dentro de la rama de la
 * fase LISTA. Los sectores y las etiquetas existian entonces unicamente
 * como efecto secundario de que ESA ventana hubiera pintado esa fase.
 *
 * La pantalla del cliente y la vista previa son documentos independientes,
 * y el estado se emite a las dos. La que se abriera -o se recargara- a
 * mitad de partida recibia GIRANDO o RESULTADO sobre un disco que nadie
 * habia dibujado: fondo sin sectores, sin etiquetas, circulo vacio. Por
 * eso el fallo aparecia unas veces si y otras no.
 *
 * Aqui se carga el HTML de verdad en un DOM, se ejecuta su logica de
 * pintado y se comprueba que la rueda esta construida en READY, SPINNING
 * y RESULT, incluso entrando directamente por la ultima.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const VISTA = join('electron', 'customer-display', 'customer.html');

let ok = 0;
const fallos = [];
const check = (cond, titulo, detalle) => {
  if (cond) { ok++; console.log(`   ok     ${titulo}`); }
  else { fallos.push(titulo); console.log(`   FALLA  ${titulo}${detalle ? `\n            ${detalle}` : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

const vista = readFileSync(VISTA, 'utf8');

/* ------------------------------------------------------------------
   Un DOM minimo.

   No se usa jsdom porque el proyecto no lo trae y esta prueba tiene que
   correr en cualquier caja. Lo que hace falta del navegador es poco y
   muy concreto: elementos con id, clases, hijos y estilos. Cualquier
   cosa que el HTML use y no este aqui saldria como error, no como falso
   verde.
   ------------------------------------------------------------------ */
function crearDom() {
  const porId = new Map();

  class Elemento {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this.children = [];
      this.style = {};
      this.dataset = {};
      this._clases = new Set();
      this._texto = '';
      this.disabled = false;
    }
    get className() { return [...this._clases].join(' '); }
    set className(v) { this._clases = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get classList() {
      const s = this._clases;
      return {
        add: (...c) => c.forEach(x => s.add(x)),
        remove: (...c) => c.forEach(x => s.delete(x)),
        contains: (c) => s.has(c),
        toggle: (c, on) => (on === undefined ? (s.has(c) ? s.delete(c) : s.add(c)) : (on ? s.add(c) : s.delete(c))),
      };
    }
    get textContent() { return this._texto; }
    set textContent(v) { this._texto = String(v == null ? '' : v); this.children = []; }
    get innerHTML() { return this._html || ''; }
    set innerHTML(v) { this._html = String(v); this.children = []; }
    appendChild(c) { this.children.push(c); this._html = undefined; return c; }
    addEventListener() { /* la prueba llama a las funciones directamente */ }
  }

  const doc = {
    body: new Elemento('body'),
    createElement: (t) => new Elemento(t),
    getElementById: (id) => porId.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  // Los ids que el script toca. Si el HTML deja de usar alguno, la
  // prueba lo nota porque el elemento se queda sin escribir.
  for (const id of [
    'jgRaiz', 'jgDisco', 'jgRueda', 'jgBoton', 'jgBotonTxt', 'jgReto',
    'jgObjetivo', 'jgCrono', 'jgTitular', 'jgGana', 'jgNota', 'jgPremios', 'jgCodigo',
    'jgPie', 'jgMarca', 'jgClock', 'idleBiz', 'idleClock', 'idleKicker',
    'idleTitulo', 'idleTambien', 'idleSub', 'idleMensaje', 'idleMarca',
    'idleInicial', 'saleBiz', 'saleClock', 'saleItems', 'saleModo',
    'coClock', 'coTotal', 'coPaid', 'coPaidLabel', 'coPaidBox', 'coChange',
    'coChangeBox', 'prTitle', 'prList', 'drBig', 'drMsg', 'drPremio',
    'drCode', 'drBiz', 'dinres',
  ]) porId.set(id, new Elemento('div'));

  return { doc, Elemento };
}

/** Ejecuta el <script> del HTML y devuelve las funciones que expone. */
function cargarVista() {
  const { doc } = crearDom();
  const cuerpo = vista.slice(vista.indexOf('<script>') + 8, vista.lastIndexOf('</script>'));

  const ventana = {
    customerAPI: { getBusiness: async () => ({}), onState: () => {}, enviar: () => {} },
    location: { search: '' },
  };
  const ctx = {
    document: doc,
    window: ventana,
    URLSearchParams: URLSearchParams,
    setInterval: () => 0,
    setTimeout: () => 0,
    clearTimeout: () => {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    performance: { now: () => 0 },
    console,
  };

  // Se devuelve lo que la prueba necesita tocar. Declarar las funciones
  // aqui obliga a que sigan existiendo con ese nombre.
  const fn = new Function(
    'document', 'window', 'location', 'URLSearchParams', 'setInterval', 'setTimeout',
    'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame',
    'performance', 'console',
    cuerpo + '\n;return { jgPintar: jgPintar, jgDibujarRueda: jgDibujarRueda, Dinamica: Dinamica };'
  );
  const apiVista = fn(
    ctx.document, ctx.window, ventana.location, ctx.URLSearchParams, ctx.setInterval, ctx.setTimeout,
    ctx.clearTimeout, ctx.requestAnimationFrame, ctx.cancelAnimationFrame,
    ctx.performance, ctx.console,
  );
  return { doc, ...apiVista };
}

const SECTORES = ['Café gratis', 'Sigue participando', 'Cambio de aceite', '5 boletos', 'Filtro', 'Nada'];

/** Como esta la rueda ahora mismo. */
function estadoRueda(doc) {
  const d = doc.getElementById('jgDisco');
  const fondo = d.style.background || '';
  return {
    sectores: (fondo.match(/deg/g) || []).length / 2,
    dibujada: fondo.startsWith('conic-gradient('),
    etiquetas: d.children.length,
    giro: d.style.transform || '',
    visible: doc.getElementById('jgRaiz')._clases.has('jg--rueda'),
  };
}

// ===================================================================
seccion('1. La rueda existe en las tres fases, entrando por el principio');

{
  const { doc, jgPintar } = cargarVista();

  jgPintar({ tipo: 'WHEEL', fase: 'LISTA', sectores: SECTORES, premios: ['Café gratis'], reto: 'Prueba tu suerte' });
  let r = estadoRueda(doc);
  check(r.dibujada && r.sectores === 6, 'READY dibuja los seis sectores');
  check(r.visible, 'y la rueda esta visible en READY');

  jgPintar({ tipo: 'WHEEL', fase: 'GIRANDO', sectores: SECTORES, ganadorIndice: 2 });
  r = estadoRueda(doc);
  check(r.dibujada && r.sectores === 6, 'SPINNING conserva los sectores');
  check(r.visible, 'y la rueda sigue visible en SPINNING');

  jgPintar({ tipo: 'WHEEL', fase: 'RESULTADO', sectores: SECTORES, ganadorIndice: 2, gano: true, premioGanado: 'Cambio de aceite', codigo: 'RW-000123' });
  r = estadoRueda(doc);
  check(r.dibujada && r.sectores === 6, 'RESULT conserva los sectores',
    'este era el fallo: la rueda se quedaba en un circulo vacio');
  check(r.visible, 'y la rueda SIGUE visible en RESULT',
    'el cambio de fase altera el estado visual, no la existencia del dibujo');
}

// ===================================================================
seccion('2. Una ventana que entra a mitad de partida tambien la ve');

/*
 * Esto es lo que pasaba de verdad: la vista previa se abria despues de
 * LISTA, o la pantalla del cliente se recargaba, y el primer estado que
 * recibia era GIRANDO o RESULTADO.
 */
for (const fase of ['GIRANDO', 'RESULTADO']) {
  const { doc, jgPintar } = cargarVista();
  jgPintar({
    tipo: 'WHEEL', fase, sectores: SECTORES, ganadorIndice: 4,
    gano: true, premioGanado: 'Filtro',
  });
  const r = estadoRueda(doc);
  check(r.dibujada && r.sectores === 6, `entrando directo en ${fase} la rueda se construye`,
    'sin haber pintado LISTA nunca en esta ventana');
  check(r.visible, `y en ${fase} esta visible`);
}

// ===================================================================
seccion('3. La aguja y el sector resaltado dicen lo mismo');

/*
 * Dibujar la rueda arreglo el circulo vacio, pero dejaba un residuo del
 * mismo fallo: la ventana que no vio el giro pintaba el resaltado en un
 * sector y la aguja senalaba otro. Para el cliente eso es tan confuso
 * como no ver nada.
 */
{
  // La ventana que SI vio girar: la rueda se queda donde freno.
  const { doc, jgPintar } = cargarVista();
  jgPintar({ tipo: 'WHEEL', fase: 'LISTA', sectores: SECTORES, premios: [] });
  jgPintar({ tipo: 'WHEEL', fase: 'GIRANDO', sectores: SECTORES, ganadorIndice: 1 });
  const disco = doc.getElementById('jgDisco');
  const traselGiro = disco.dataset.giro;
  check(Number(traselGiro) > 1700, 'girar acumula cinco vueltas mas el ajuste');

  jgPintar({ tipo: 'WHEEL', fase: 'RESULTADO', sectores: SECTORES, ganadorIndice: 1, gano: false });
  check(disco.dataset.giro === traselGiro,
    'y al llegar el resultado NO se la vuelve a mover',
    'devolverla de golpe borraria el giro que el cliente acaba de ver');
}

{
  // La ventana que NO lo vio: hay que colocarla, o la aguja miente.
  const { doc, jgPintar } = cargarVista();
  jgPintar({ tipo: 'WHEEL', fase: 'RESULTADO', sectores: SECTORES, ganadorIndice: 4, gano: false });
  const disco = doc.getElementById('jgDisco');
  const paso = 360 / SECTORES.length;
  const esperado = 360 - (4 * paso + paso / 2);
  check(Number(disco.dataset.giro) === esperado,
    'entrando directa en RESULT, la rueda se coloca en el sector ganador',
    'sin esto la aguja senala un sector y el resaltado esta en otro');
  check(disco.dataset.ganador === '4', 'y queda anotado cual es');
}

// ===================================================================
seccion('4. El sector ganador se enfatiza, los demas retroceden');

{
  const { doc, jgPintar } = cargarVista();
  jgPintar({ tipo: 'WHEEL', fase: 'LISTA', sectores: SECTORES, premios: [] });
  const rueda = doc.getElementById('jgRueda');
  check(!rueda._clases.has('jg-rueda--enfasis'), 'antes de girar no hay ningun sector destacado');

  jgPintar({ tipo: 'WHEEL', fase: 'RESULTADO', sectores: SECTORES, ganadorIndice: 3, gano: true, premioGanado: '5 boletos' });
  check(rueda._clases.has('jg-rueda--enfasis'), 'al terminar se marca el enfasis');

  const disco = doc.getElementById('jgDisco');
  const ganadores = disco.children.filter(c => c._clases.has('es-ganador'));
  check(ganadores.length === 1, 'y exactamente un sector queda como ganador');
}

// ===================================================================
seccion('5. Dentro del sector solo va lo que se lee de verdad');

{
  const { doc, jgPintar } = cargarVista();
  const disco = () => doc.getElementById('jgDisco');
  const etiquetas = () => disco().children.map(c => c.children[0].textContent);

  jgPintar({ tipo: 'WHEEL', fase: 'LISTA', sectores: ['Café', 'Aceite', 'Filtro', 'Boletos'], premios: [] });
  check(disco().children.length === 4, 'con nombres cortos, cada sector lleva el suyo');

  /* Un nombre largo NO se recorta con puntos suspensivos: se deriva a su
     primera palabra, que es una presentacion, no un truncado. El nombre
     completo sigue en la lista de al lado y en el resultado. */
  jgPintar({
    tipo: 'WHEEL', fase: 'LISTA',
    sectores: ['Cambio de aceite completo', 'Café', 'Filtro', 'Nada'], premios: [],
  });
  check(etiquetas().includes('Cambio'), 'un nombre largo se deriva a su primera palabra');
  check(etiquetas().every(t => !t.includes('…') && !t.includes('...')),
    'y nunca aparece recortado con puntos suspensivos');

  /* El riesgo de derivar: dos premios distintos diciendo lo mismo. */
  jgPintar({
    tipo: 'WHEEL', fase: 'LISTA',
    sectores: ['Cambio de aceite', 'Cambio de filtro', 'Café', 'Nada'], premios: [],
  });
  check(disco().children.length === 0,
    'si dos sectores derivarian a la misma palabra, la rueda va solo con color',
    'ver la rueda parar en "Cambio" sin saber en cual de los dos es peor que no leer nada');
  check((disco().style.background || '').startsWith('conic-gradient('),
    'pero los sectores siguen dibujados');

  /* Con muchos sectores no cabe ni una palabra corta. */
  jgPintar({
    tipo: 'WHEEL', fase: 'LISTA',
    sectores: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'], premios: [],
  });
  check(disco().children.length === 0, 'con diez sectores manda el color, no el texto');
}

// ===================================================================
seccion('6. La intencion se separa de su origen');

{
  const { doc, Dinamica } = cargarVista();
  check(typeof Dinamica.comenzar === 'function'
     && typeof Dinamica.parar === 'function'
     && typeof Dinamica.girar === 'function',
    'las tres acciones son invocables sin pasar por el boton',
    'manana el origen puede ser un pulsador fisico en la pared');
}

// ===================================================================
seccion('7. El cronometro es una sola frase, no un numero suelto');

{
  const { doc, jgPintar } = cargarVista();
  jgPintar({ tipo: 'TIMING', fase: 'LISTA', objetivo: 10, premios: ['Café americano'] });
  check(/detenlo/i.test(doc.getElementById('jgReto').textContent),
    'READY dice que hay que detenerlo');
  check(doc.getElementById('jgObjetivo').textContent === '10.00',
    'y el objetivo va justo debajo, como parte de la misma frase');
  check(doc.getElementById('jgBotonTxt').textContent === 'EMPEZAR', 'el boton dice EMPEZAR');

  jgPintar({ tipo: 'TIMING', fase: 'JUGANDO', objetivo: 10 });
  check(doc.getElementById('jgBotonTxt').textContent === 'PARAR',
    'y el MISMO boton pasa a PARAR',
    'no son dos botones distintos: es un objeto en otro estado');
}

// ===================================================================
seccion('8. Perder no promete nada que nadie haya prometido');

{
  const { doc, jgPintar } = cargarVista();
  jgPintar({ tipo: 'TIMING', fase: 'RESULTADO', gano: false });
  check(/esta vez no/i.test(doc.getElementById('jgReto').textContent),
    'la derrota se dice sin rodeos');
  check(!/pr[oó]xima/i.test(doc.getElementById('jgPie').textContent),
    'y no se invita a volver a intentarlo',
    'el modelo no dice si la campana permite otro intento: no se inventa');
}

// ===================================================================
seccion('9. El cronometro dice en que numero se quedo');

/*
 * Quien acaba de soltar el boton quiere saber donde paro. Un veredicto
 * sin el numero deja al cliente sin entender por cuanto fallo, y ese dato
 * lo tiene la pantalla delante: no ensenarlo era esconderselo.
 */
{
  const { doc, jgPintar } = cargarVista();
  const t = (id) => doc.getElementById(id).textContent;
  const h = (id) => doc.getElementById(id).innerHTML;

  jgPintar({ tipo: 'TIMING', fase: 'RESULTADO', objetivo: 10, centesimas: 987, gano: false });
  check(/paraste en/i.test(t('jgReto')), 'al perder, encabeza con donde paro');
  check(t('jgCrono') === '9.87', 'y ese numero es el protagonista');
  check(doc.getElementById('jgRaiz')._clases.has('jg--crono'),
    'se ensena en grande, no escondido en una nota al pie');
  check(/10\.00/.test(h('jgNota')), 'con el objetivo debajo, para comparar de un golpe');

  jgPintar({
    tipo: 'TIMING', fase: 'RESULTADO', objetivo: 10, centesimas: 1000,
    gano: true, premioGanado: 'Café americano', codigo: 'RW-1',
  });
  check(/ganaste/i.test(t('jgReto')), 'al ganar manda el premio');
  check(t('jgTitular') === 'Café americano', 'que pasa a ser el titular');
  check(/10\.00/.test(h('jgNota')), 'y el numero sigue estando, como linea secundaria');

  /* La ruleta no tiene numero que ensenar: no debe inventarse uno. */
  jgPintar({ tipo: 'WHEEL', fase: 'RESULTADO', sectores: SECTORES, ganadorIndice: 0, gano: false });
  check(!doc.getElementById('jgRaiz')._clases.has('jg--crono'),
    'la ruleta no ensena cronometro');
}

console.log(`\nRESULTADO: ${fallos.length ? `${fallos.length} FALLO(S) de ${ok + fallos.length}` : `OK (${ok} comprobaciones)`}`);
process.exit(fallos.length ? 1 : 0);
