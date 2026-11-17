'use strict';
/**
 * PREGUNTAS LIBRES: la forma de una pregunta de ventas, sin intent escrito.
 *
 * Una pregunta de ventas tiene tres piezas, y cualquier combinación vale:
 *
 *   qué medir     ventas · piezas · ganancia · tickets · ticket promedio
 *   cómo agrupar  producto · categoría · hora · día de la semana · día ·
 *                 cajero · forma de pago · cliente
 *   qué orden     lo que más (por omisión) · lo que menos · top N
 *
 * más los filtros de siempre (lenguaje/filtros.js) y el periodo. Y una
 * cuarta forma: COMPARAR dos cosas («café contra concha», «octubre contra
 * septiembre», «esta semana contra la pasada»).
 *
 *   «¿qué categoría deja más ganancia los domingos en la tarde?»
 *     → { medida: 'ganancia', agrupar: 'categoria', orden: 'desc' }
 *   «¿a qué hora vendo menos?»       → { medida: 'ventas', agrupar: 'hora', orden: 'asc' }
 *   «top 3 clientes del mes»         → { agrupar: 'cliente', limite: 3 }
 *   «octubre contra septiembre»      → { comparar: { tipo: 'periodos', … } }
 *
 * Devuelve null si la frase no tiene forma de pregunta de ventas agrupada o
 * comparada: el resto lo contestan los intents de siempre.
 */
const { rangoDicho } = require('./filtros');
const ex = require('./extractores');

/**
 * Un lado de una comparación como periodo: { rango } si se dijeron fechas
 * («octubre», «del 1 al 15»), { periodo } si se dijo una clave («esta
 * semana», «la pasada», «ayer»). «La pasada» hereda la unidad del otro lado.
 */
function ladoPeriodo(txt, otro = '', ahora = new Date()) {
  const r = rangoDicho(txt, ahora) || rangoDicho(`en ${txt}`, ahora);
  if (r) return { rango: r.rango };
  const unidad = /semana/.test(otro) ? 'semana' : /mes/.test(otro) ? 'mes' : '';
  const s = /\b(?:la|el) (?:pasad[ao]|anterior)\b/.test(txt) && !/semana|mes/.test(txt) ? `${txt} ${unidad} pasada` : txt;
  if (!ex.diceperiodo(s)) return null;
  return { periodo: ex.periodo(s) };
}

const AGRUPAR = [
  ['cliente', /\btop \d{1,2} clientes\b/],
  ['producto', /\btop \d{1,2} productos\b/],
  ['categoria', /\btop \d{1,2} categorias\b/],
  ['categoria', /\b(?:por categorias?|(?:que|cual|cuales) categorias?|en que categoria|categorias? (?:que|con) mas|categorias? (?:que|con) menos|de cada categoria)\b/],
  ['hora', /\b(?:por hora|por horas|a que hora|(?:que|cual|cuales) horas?|en que horario|horario (?:que|con) mas|horas? (?:que|con) (?:mas|menos)|hora pico|horas pico)\b/],
  ['diaSemana', /\b(?:(?:que|cual|cuales) dias? de la semana|por dia de la semana|(?:que|cual) dia (?:vendo|se vende|vendemos|entra|hay) (?:mas|menos)|(?:que|cual) es (?:el|mi) (?:mejor|peor) dia|en que dia (?:vendo|se vende|vendemos))\b/],
  ['dia', /\b(?:dia por dia|por dia|cada dia|diario|por fecha)\b/],
  ['cajero', /\b(?:por cajer[oa]s?|(?:que|cual) cajer[oa]|quien (?:vendio|vende|cobro|cobra) (?:mas|menos)|por vendedor(?:es|a)?|(?:que|cual) vendedor(?:a)?|por empleados?|(?:que|cual) empleado)\b/],
  ['metodo', /\b(?:por forma de pago|(?:que|cual) forma de pago|por metodo de pago|con que (?:me )?pagan (?:mas|menos)|como me pagan)\b/],
  ['cliente', /\b(?:por clientes?|(?:que|cual|cuales) clientes?|mejores clientes|quien me compra (?:mas|menos)|clientes? que (?:mas|menos) (?:compran?|gastan?))\b/],
  ['producto', /\b(?:por productos?|(?:que|cual|cuales) productos? (?:se )?(?:vend[eoi]\w*|deja\w*|da\w*) (?:mas|menos)|que (?:es lo que )?(?:se )?vend[eo] (?:mas|menos)|que vendemos (?:mas|menos)|lo (?:mas|menos) vendido|lo que (?:mas|menos) se vende|que (?:me )?deja (?:mas|menos)|que (?:me )?da (?:mas|menos) ganancia|(?:que|cual) (?:es|son) (?:el|los) (?:mas|menos) vendidos?)\b/],
];

const MEDIDA = [
  ['promedio', /\b(?:ticket promedio|promedio por (?:ticket|cliente|venta)|cuanto gasta (?:cada|un) cliente)\b/],
  ['ganancia', /\b(?:ganancias?|gane|gano|ganamos|ganar|utilidad(?:es)?|me deja|deja (?:mas|menos)|dejan|margen(?:es)?|rentables?|da (?:mas|menos) ganancia)\b/],
  ['tickets', /\b(?:cuantos tickets|cuantas ventas (?:hice|hicimos|hubo)|cuantos clientes|(?:mas|menos) tickets|numero de (?:ventas|tickets|clientes))\b/],
  ['piezas', /\b(?:piezas|unidades|cuant(?:os|as) (?:[a-z]+ )?vend[ie]|lo (?:mas|menos) vendido|que (?:es lo que )?(?:se )?vend[eo] (?:mas|menos)|que vendemos (?:mas|menos)|lo que (?:mas|menos) se vende|(?:mas|menos) vendidos?)\b/],
];

const ASC = /\b(?:menos|peor|peores|mas bajo|mas baja|mas flojo|mas floja|flojos?|flojas?)\b/;
const COMPARAR = /\s(?:contra|vs|versus|comparado con|frente a)\s/;
const COMPARA_VERBO = /^(?:compara(?:me|r)?|comparacion de|diferencia entre)\s+/;

/** ¿Cuántos? «top 5», «los 3 más», «5 productos». */
function limiteDe(norm) {
  const m = norm.match(/\btop (\d{1,2})\b/) || norm.match(/\blos (\d{1,2}) (?:mas|menos|mejores|peores|primeros)\b/)
    || norm.match(/\b(\d{1,2}) (?:productos|categorias|clientes|cajeros|horas|dias)\b/);
  const n = m ? Number(m[1]) : null;
  return n && n >= 1 && n <= 50 ? n : null;
}

/**
 * @param norm  texto normalizado
 * @param o { ahora, productos: número de productos que se nombraron }
 * @returns { medida, agrupar, orden, limite, comparar } | null
 */
function preguntaLibre(norm, { ahora = new Date(), productos = 0 } = {}) {
  const t = ` ${norm} `;

  /* COMPARAR: dos lados. Si los dos son periodos, se comparan periodos; si se
     nombraron dos productos, productos. */
  if (COMPARAR.test(t) || COMPARA_VERBO.test(norm)) {
    const cuerpo = norm.replace(COMPARA_VERBO, '');
    const [izq, der] = cuerpo.split(/\s(?:contra|vs|versus|comparado con|frente a|con|y)\s/);
    if (izq && der) {
      const a = ladoPeriodo(izq, der, ahora);
      const b = ladoPeriodo(der, izq, ahora);
      const medida = (MEDIDA.find(([, re]) => re.test(t)) || ['ventas'])[0];
      if (a && b) return { medida, agrupar: null, orden: 'desc', limite: null, comparar: { tipo: 'periodos', a, b } };
      if (productos >= 2) return { medida, agrupar: null, orden: 'desc', limite: null, comparar: { tipo: 'productos' } };
    }
  }

  const agrupar = (AGRUPAR.find(([, re]) => re.test(t)) || [null])[0];
  if (!agrupar) return null;
  let medida = (MEDIDA.find(([, re]) => re.test(t)) || [null])[0];
  if (!medida) medida = agrupar === 'producto' ? 'piezas' : 'ventas';
  /* «¿qué día vendo más?» con «cuántos tickets» → tickets; «ganancia por hora» → ganancia. */
  return { medida, agrupar, orden: ASC.test(t) ? 'asc' : 'desc', limite: limiteDe(norm), comparar: null };
}

module.exports = { preguntaLibre, limiteDe, ladoPeriodo };
