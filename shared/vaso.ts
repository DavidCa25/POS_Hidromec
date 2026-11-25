/**
 * EL VASO DE UNA RECETA: de las líneas de la receta a un dibujo.
 *
 * Sin Angular y sin DOM, para que se pruebe en node
 * (scripts/pruebas/vaso.test.mjs) y lo use cualquier pantalla: Recetas por
 * tamaño, los mini vasos de Modificadores y la tira para comparar tamaños.
 *
 * EL DIBUJO NO CAPTURA NADA. Sale de lo que ya está en la receta (cantidad,
 * unidad, dimensión) y solo explica. La receta se guarda igual que siempre.
 *
 * QUÉ ES CADA INGREDIENTE
 *   liquido   se sirve como capa: todo lo de VOLUMEN, y lo de PESO que se vierte
 *             (jarabe, salsa, leche condensada, pulpa)
 *   hielo     sube el nivel y se ve como cubos
 *   crema     un domo encima (crema batida, chantilly, espuma)
 *   topping   trocitos encima (chispas, galleta, canela, granola)
 *
 * EL TAMAÑO DEL VASO sale del nombre de la variante («Chico 12 oz»,
 * «Grande 500 ml»). Si no lo dice, se escala por su lugar entre las variantes:
 * nunca se inventan mililitros que el negocio no escribió.
 */

export type Dimension = 'COUNT' | 'WEIGHT' | 'VOLUME' | 'LENGTH';
export type Clase = 'liquido' | 'hielo' | 'crema' | 'topping';

export interface IngredienteVaso {
  nombre: string;
  /** Cantidad en la unidad base de su dimensión: ml, g, pza o cm. */
  cantidad: number;
  dimension: Dimension;
  mermaPct?: number;
}

export interface Capa { nombre: string; y: number; h: number; color: string; merma: number }
export interface Cubo { x: number; y: number }
export interface Trocito { x: number; y: number; giro: number; color: string }

export interface DibujoVaso {
  /** Contorno del vaso (viewBox 0 0 300 420). */
  vaso: string;
  brillo: string;
  popote: string | null;
  capas: Capa[];
  cubos: Cubo[];
  domo: string | null;
  trocitos: Trocito[];
  /** Mililitros que ocupa lo servido (líquidos + hielo). */
  ocupado: number;
  capacidad: number;
  desborda: boolean;
  /** Nivel de lo servido, de 0 a 1, para los mini vasos. */
  lleno: number;
}

const sinAcentos = (s: string) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/* ------------------------------------------------------------ clases */

const RX_HIELO = /\bhielo\b/;
const RX_CREMA = /\b(crema batida|chantilly|crema chantilly|espuma|whipped|nata montada|crema para batir)\b/;
const RX_SE_VIERTE = /\b(jarabe|sirope|salsa|leche|crema|concentrado|pulpa|jugo|zumo|agua|cafe|espresso|te|chai|matcha|cocoa liquida|caramelo liquido|miel|licor|vino|cerveza|refresco|yogur|yogurt|nieve|helado|base)\b/;

export function claseDe(nombre: string, dimension: Dimension): Clase {
  const n = sinAcentos(nombre);
  if (RX_HIELO.test(n)) return 'hielo';
  if (RX_CREMA.test(n)) return 'crema';
  if (dimension === 'VOLUME') return 'liquido';
  if (dimension === 'WEIGHT' && RX_SE_VIERTE.test(n)) return 'liquido';
  return 'topping';
}

/* ----------------------------------------------------------- colores */

const COLORES: [RegExp, string][] = [
  [/\bhielo\b/, '#DDEFF5'],
  [/\b(espresso|cafe|americano|cold brew)\b/, '#4B2E1F'],
  [/\b(moka|mocha|chocolate|cacao|cocoa|nutella)\b/, '#6B3A22'],
  [/\b(caramelo|cajeta|dulce de leche)\b/, '#C07A2C'],
  [/\b(vainilla)\b/, '#E9C98A'],
  [/\b(avellana)\b/, '#A8703F'],
  [/\b(fresa|frambuesa|frutos rojos|cereza|jamaica)\b/, '#E0587A'],
  [/\b(mango|maracuya|naranja|durazno)\b/, '#F2A93B'],
  [/\b(limon|lima)\b/, '#D7E36B'],
  [/\b(matcha|te verde|menta|hierbabuena|pepino)\b/, '#7DB65A'],
  [/\b(taro|mora|uva|blueberry|arandano)\b/, '#9C7BC4'],
  [/\b(chai|canela|horchata)\b/, '#C89B6D'],
  [/\b(almendra|avena|coco|soya)\b/, '#E4CBA4'],
  [/\b(leche|crema|yogur|yogurt|nata|helado)\b/, '#F3EEE4'],
  [/\b(agua|soda|mineral|tonica)\b/, '#D6ECF3'],
  [/\b(galleta|oreo)\b/, '#3B2A22'],
  [/\b(chispas|granillo)\b/, '#3B2416'],
  [/\b(azucar|sal)\b/, '#F7F4EC'],
  [/\b(miel|jarabe)\b/, '#D79A2B'],
  /* Panadería: la pieza y lo que lleva la masa. */
  [/\b(donas?|conchas?|pan|panes|rol|roles|cuernos?|bolillos?|teleras?|empanadas?|bisquets?|panques?|pastel|muffins?|churros?|galletas?)\b/, '#D99A55'],
  [/\b(harina|maicena|fecula)\b/, '#F4EBDD'],
  [/\b(huevos?|yema)\b/, '#F6B94A'],
  [/\b(mantequilla|margarina|manteca)\b/, '#F7DC86'],
  [/\b(aceite)\b/, '#F1C84B'],
  [/\b(levadura|polvo para hornear|bicarbonato)\b/, '#C7A16E'],
];

export function colorDe(nombre: string): string {
  const n = sinAcentos(nombre);
  for (const [rx, c] of COLORES) if (rx.test(n)) return c;
  /* Sin pista: un tono estable por nombre, ni muy oscuro ni lavado. */
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 45% 62%)`;
}

/* ---------------------------------------------------------- capacidad */

/** Mililitros que dice el nombre de una variante, o null si no los dice. */
export function capacidadDeNombre(nombre: string): number | null {
  const n = sinAcentos(nombre).replace(',', '.');
  const oz = n.match(/(\d+(?:\.\d+)?)\s*(?:oz|onzas?)\b/);
  if (oz) return Math.round(Number(oz[1]) * 29.5735);
  const ml = n.match(/(\d+(?:\.\d+)?)\s*ml\b/);
  if (ml) return Math.round(Number(ml[1]));
  const l = n.match(/(\d+(?:\.\d+)?)\s*(?:l|lt|litros?)\b/);
  if (l) return Math.round(Number(l[1]) * 1000);
  return null;
}

/**
 * La capacidad de cada variante: la que dice su nombre o, si ninguna lo dice,
 * una escala por su lugar (la primera, chica; la última, grande) alrededor de
 * lo que de verdad lleva la receta.
 */
export function capacidades(variantes: string[], servidoBase: number): number[] {
  const leidas = variantes.map(capacidadDeNombre);
  if (leidas.every(x => x != null)) return leidas as number[];
  const base = Math.max(250, Math.round(servidoBase * 1.15 / 10) * 10);
  const n = variantes.length;
  return variantes.map((_, i) => leidas[i] ?? Math.round(base * (n <= 1 ? 1 : 0.8 + (0.45 * i) / (n - 1))));
}

/** Lo que ocupa lo servido: líquidos más el hielo (0.9 ml por g). */
export function servido(lineas: IngredienteVaso[]): number {
  return lineas.reduce((a, l) => {
    const c = claseDe(l.nombre, l.dimension);
    if (c === 'liquido') return a + l.cantidad;
    if (c === 'hielo') return a + l.cantidad * (l.dimension === 'COUNT' ? 25 : 0.9);
    return a;
  }, 0);
}

/* ------------------------------------------------------------- dibujo */

const SUELO = 390;

function geometria(capacidad: number) {
  const ml = Math.min(1200, Math.max(120, capacidad));
  const h = 150 + Math.min(ml, 800) * 0.27;
  const wt = 140 + Math.min(ml, 800) * 0.12;
  return { h, wt, wb: wt * 0.72, top: SUELO - h };
}

export function dibujarVaso(lineas: IngredienteVaso[], capacidad: number, opciones: { popote?: boolean } = {}): DibujoVaso {
  const cap = Math.max(1, capacidad);
  const g = geometria(cap);
  const util = g.h - 12;
  const anchoEn = (y: number) => g.wb + (g.wt - g.wb) * ((SUELO - y) / g.h);
  const vaso = `M${r(150 - g.wt / 2)} ${r(g.top)} L${r(150 + g.wt / 2)} ${r(g.top)} L${r(150 + g.wb / 2)} ${SUELO} L${r(150 - g.wb / 2)} ${SUELO} Z`;

  const liquidos = lineas.filter(l => claseDe(l.nombre, l.dimension) === 'liquido' && l.cantidad > 0);
  const hielo = lineas.filter(l => claseDe(l.nombre, l.dimension) === 'hielo').reduce((a, l) => a + l.cantidad * (l.dimension === 'COUNT' ? 25 : 0.9), 0);
  const ocupado = servido(lineas);

  /* Las capas, de abajo hacia arriba en el orden de la receta. El hielo no es
     capa: desplaza, así que empuja todo hacia arriba. */
  const elevar = Math.min(util, (hielo / cap) * util);
  let y = SUELO;
  const capas: Capa[] = liquidos.map(l => {
    const h = (l.cantidad / cap) * util;
    y -= h;
    return { nombre: l.nombre, y: r(y - elevar), h: r(h), color: colorDe(l.nombre), merma: l.mermaPct ?? 0 };
  });
  if (capas.length && hielo) capas[0] = { ...capas[0], y: capas[0].y, h: r(capas[0].h + elevar) };
  const nivel = Math.max(g.top + 4, y - elevar);

  const cubos: Cubo[] = [];
  const n = Math.min(12, Math.round(hielo / 36));
  for (let i = 0; i < n; i++) {
    const fila = Math.floor(i / 3), col = i % 3;
    const yy = SUELO - 38 - fila * 36 - (col === 1 ? 10 : 0);
    if (yy < g.top + 8) break;
    const w = anchoEn(yy) - 44;
    cubos.push({ x: r(150 - w / 2 + (col * w) / 2 - 15 + (fila % 2 ? 6 : -6)), y: r(yy) });
  }

  const crema = lineas.filter(l => claseDe(l.nombre, l.dimension) === 'crema').reduce((a, l) => a + l.cantidad, 0);
  const rx = anchoEn(nivel) / 2 - 4, ry = crema ? Math.min(46, 10 + crema * 0.9) : 0;
  const domo = crema
    ? `M${r(150 - rx)} ${r(nivel)} Q${r(150 - rx)} ${r(nivel - ry * 1.4)} 150 ${r(nivel - ry * 1.5)} Q${r(150 + rx)} ${r(nivel - ry * 1.4)} ${r(150 + rx)} ${r(nivel)} Z`
    : null;

  const trocitos: Trocito[] = [];
  for (const l of lineas.filter(x => claseDe(x.nombre, x.dimension) === 'topping' && x.cantidad > 0)) {
    const cuantos = Math.min(18, Math.max(3, Math.round(l.dimension === 'COUNT' ? l.cantidad * 3 : l.cantidad * 1.5)));
    const color = colorDe(l.nombre);
    for (let i = 0; i < cuantos; i++) {
      const lado = (i % 2 ? 1 : -1) * (((i * 53) % 100) / 100);
      const cx = 150 + lado * rx * 0.8;
      const alto = ry ? ry * (0.25 + 0.95 * (1 - Math.abs(cx - 150) / Math.max(1, rx))) : 2;
      trocitos.push({ x: r(cx), y: r(nivel - alto - (trocitos.length % 3)), giro: (i * 47 + trocitos.length * 13) % 180, color });
    }
  }

  return {
    vaso,
    brillo: `M${r(150 - g.wt / 2 + 14)} ${r(g.top + 18)} L${r(150 - g.wb / 2 + 12)} ${SUELO - 18}`,
    popote: opciones.popote === false ? null : `M${r(168)} ${r(nivel - ry - 6)} L${r(150 + g.wt / 2 + 24)} ${r(g.top - 44)}`,
    capas, cubos, domo, trocitos,
    ocupado: Math.round(ocupado),
    capacidad: Math.round(cap),
    desborda: ocupado > cap * 1.001,
    lleno: Math.min(1, ocupado / cap),
  };
}

/** El contorno y el nivel de un mini vaso (viewBox 0 0 36 46), para tiras y modificadores. */
export function miniVaso(capacidad: number, lleno: number, maxCapacidad: number): { contorno: string; nivel: string } {
  const k = Math.max(0.55, Math.min(1, capacidad / Math.max(1, maxCapacidad)));
  const ht = 40 * k, wt = 28 * (0.75 + 0.25 * k), wb = wt * 0.72, base = 44, ox = 18;
  const f = Math.max(0, Math.min(1, lleno));
  const hy = base - ht * f, wy = wb + (wt - wb) * f;
  return {
    contorno: `M${r(ox - wt / 2)} ${r(base - ht)} L${r(ox + wt / 2)} ${r(base - ht)} L${r(ox + wb / 2)} ${base} L${r(ox - wb / 2)} ${base} Z`,
    nivel: f ? `M${r(ox - wy / 2)} ${r(hy)} L${r(ox + wy / 2)} ${r(hy)} L${r(ox + wb / 2)} ${base} L${r(ox - wb / 2)} ${base} Z` : '',
  };
}

function r(n: number): number { return Math.round(n * 10) / 10; }
