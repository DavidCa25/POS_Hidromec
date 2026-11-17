/**
 * ILUSTRACIÓN DE UN PRODUCTO SIN FOTO
 * ===================================
 *
 * Cuando un producto no tiene foto, en vez de una caja genérica se dibuja algo
 * que se le parece: una dona es una dona, un frappé es un frappé, un corte de
 * cabello son unas tijeras. Si el cliente sube su foto, la foto manda siempre.
 *
 * NO SE GUARDA NADA. Se calcula en el render a partir de datos que ya existen
 * (nombre, categoría, giro): cero bytes en la base y en la sincronización.
 *
 * DETERMINISTA. El color sale de un hash del id del producto, nunca de
 * Math.random(): el mismo producto se ve igual en todas las cajas.
 *
 * CÓMO SE ELIGE LA FORMA
 *   Cada forma declara sus palabras clave. Se busca en el NOMBRE y, si no hay
 *   nada, en la CATEGORÍA; gana la coincidencia MÁS LARGA (lo específico gana a
 *   lo general: «cambio de aceite» es taller, «aceite» es la botella). Si nada
 *   coincide, decide el giro (platillo, servicio del preset o caja).
 *   Lo preparado puede declarar su envase: con una medida (600 ml, 1 kg) o en
 *   un comercio, «refresco» es la botella; en un restaurante, el vaso.
 *
 * CATÁLOGO: más de 400 formas en cuatro familias (bebidas, comida, comercio,
 * servicios), armadas con constructores con parámetros (botella, vaso, taza,
 * plato, bolsa, costal, insignia…). Para agregar una: una línea en su sección.
 *
 * Un solo archivo sin dependencias: lo usa el componente wx-ilustracion y lo
 * prueba scripts/pruebas/ilustraciones.test.mjs con node directamente.
 */

/* ====================================================================== NÚCLEO */

/** Un trazo del dibujo, en un lienzo de 192×192. */
export type Trazo =
  | { t: 'r'; x: number; y: number; w: number; h: number; r?: number; f: string }
  | { t: 'c'; x: number; y: number; r: number; f: string }
  | { t: 'e'; x: number; y: number; rx: number; ry: number; f: string; rot?: number }
  | { t: 'p'; d: string; f: string }
  | { t: 'l'; d: string; s: string; w: number };

/** Colores del envase cuando la forma no los fija: salen del tono del producto. */
export interface Pal { f: string; o: string; s: string; c: string; h: number }

export type Dibujo = (k: Pal) => Trazo[];

/** Una forma del catálogo. */
export interface Forma {
  id: string;
  /** Palabras clave (se normalizan). Gana la coincidencia más larga. */
  claves: string[];
  dibujo: Dibujo;
  /** Tono del fondo, si la forma tiene un color natural (fruta, pan…). */
  tono?: number;
  /** Si el nombre trae una medida de envase (600 ml, 1 kg…), se dibuja esta otra forma. */
  empaque?: string;
  /** Familia, para la hoja de muestra y las pruebas. */
  familia?: string;
  /** Forma de respaldo (servicio, platillo, caja…): sus claves solo cuentan si nada específico coincide. */
  generica?: boolean;
}

/** Formas genéricas: «mantenimiento de minisplit» es clima, no mantenimiento. */
export const GENERICAS = new Set(['servicio', 'mantenimiento', 'platillo', 'caja_generica', 'herramienta', 'agua_fresca', 'fruta_picada', 'verdura_picada', 'membresia']);

export const R = (x: number, y: number, w: number, h: number, f: string, r = 0): Trazo => ({ t: 'r', x, y, w, h, r, f });
export const C = (x: number, y: number, r: number, f: string): Trazo => ({ t: 'c', x, y, r, f });
export const E = (x: number, y: number, rx: number, ry: number, f: string, rot = 0): Trazo => ({ t: 'e', x, y, rx, ry, f, rot });
export const P = (d: string, f: string): Trazo => ({ t: 'p', d, f });
export const L = (d: string, s: string, w = 4): Trazo => ({ t: 'l', d, s, w });

export const hsl = (h: number, s: number, l: number) => `hsl(${Math.round(((h % 360) + 360) % 360)} ${s}% ${l}%)`;

/* Paleta de la casa para lo que tiene color natural. */
export const BLANCO = '#ffffff';
export const NEGRO = 'hsl(215 20% 14%)';
export const DORADO = 'hsl(34 78% 56%)', DORADO_CLARO = 'hsl(38 85% 72%)', DORADO_OSCURO = 'hsl(28 60% 36%)';
export const CAFE = 'hsl(24 45% 28%)', CAFE_CLARO = 'hsl(28 45% 52%)', CAFE_LECHE = 'hsl(30 45% 64%)', CREMA = 'hsl(40 60% 88%)';
export const VERDE = 'hsl(122 45% 44%)', VERDE_CLARO = 'hsl(100 55% 62%)', VERDE_OSCURO = 'hsl(130 45% 28%)';
export const ROJO = 'hsl(4 72% 52%)', ROJO_OSCURO = 'hsl(352 60% 34%)', ROSA = 'hsl(340 75% 72%)', ROSA_FUERTE = 'hsl(330 70% 56%)';
export const AMARILLO = 'hsl(46 92% 58%)', AMARILLO_CLARO = 'hsl(52 95% 78%)', NARANJA = 'hsl(26 90% 56%)';
export const MORADO = 'hsl(275 50% 48%)', LILA = 'hsl(270 55% 75%)', AZUL = 'hsl(212 70% 52%)', AZUL_CLARO = 'hsl(200 75% 78%)', TURQUESA = 'hsl(178 60% 45%)';
export const GRIS = 'hsl(215 14% 40%)', GRIS_CLARO = 'hsl(215 16% 84%)', METAL = 'hsl(210 10% 70%)', METAL_OSCURO = 'hsl(210 10% 50%)';
export const PIEL = 'hsl(28 60% 70%)', VIDRIO = 'rgba(255,255,255,.55)', BRILLO = 'rgba(255,255,255,.38)';

/* ------------------------------------------------------------- texto */

/** Minúsculas, sin acentos ni signos, con un espacio a cada lado (para buscar palabras completas). */
export function normalizar(s: string | null | undefined): string {
  const t = String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return ` ${t} `;
}

/** Trae una medida de envase: 600 ml, 1 l, 45 g, 1 kg, 12 pzas, 4 rollos, o dice lata/botella/paquete. */
export function esEmpaquetado(n: string): boolean {
  return /\b\d+([.,]\d+)?\s?(ml|l|lt|lts|litro|litros|g|gr|grs|kg|oz|pza|pzas|piezas|rollos|pack|cc)\b/.test(n)
    || /\b(lata|botella|paquete|bolsa|caja|sobre|frasco|bote|six|pet|vidrio|tetrapak|garrafon)\b/.test(n);
}

/** Hash estable (FNV-1a): mismo resultado en el navegador y en node. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/* ====================================================================== CONSTRUCTORES */

/** Etiqueta blanca con una raya de color: el rótulo de los envases. */
export const etiqueta = (x: number, y: number, w: number, h: number, raya: string, fondo = BLANCO): Trazo[] =>
  [R(x, y, w, h, fondo, 5), R(x + 8, y + h / 2 - 3, w - 16, 6, raya, 3)];

/* ================================================================ ENVASES */

export interface OpBotella { liq?: string; tapa?: string; etq?: string | null; tipo?: 'pet' | 'vino' | 'cerveza' | 'licor' | 'salsa' | 'aceite' | 'garrafon' | 'gotero'; extra?: Trazo[] }
export function botella(k: Pal, o: OpBotella = {}): Trazo[] {
  const liq = o.liq ?? k.f, tapa = o.tapa ?? k.o, etq = o.etq === undefined ? k.s : o.etq;
  const t = o.tipo ?? 'pet';
  let b: Trazo[];
  if (t === 'vino') b = [R(88, 18, 16, 16, tapa, 3), P('M88 34h16v26q22 10 22 34v66q0 6-6 6H72q-6 0-6-6V94q0-24 22-34z', liq), ...(etq ? etiqueta(70, 104, 52, 38, etq) : [])];
  else if (t === 'cerveza') b = [R(87, 26, 18, 10, tapa, 2), P('M88 36h16v20q16 10 16 30v72q0 6-6 6H78q-6 0-6-6V86q0-20 16-30z', liq), ...(etq ? etiqueta(72, 104, 48, 34, etq) : [])];
  else if (t === 'licor') b = [R(84, 22, 24, 16, tapa, 4), R(86, 38, 20, 14, liq, 3), R(58, 52, 76, 110, liq, 14), ...(etq ? etiqueta(66, 92, 60, 42, etq) : [])];
  else if (t === 'salsa') b = [R(88, 26, 16, 14, tapa, 4), P('M88 40h16l8 30v86q0 6-6 6H86q-6 0-6-6V70z', liq), ...(etq ? etiqueta(80, 100, 32, 34, etq) : [])];
  else if (t === 'aceite') b = [R(86, 24, 20, 12, tapa, 4), P('M84 36h24l4 14q18 4 18 22v84q0 8-8 8H70q-8 0-8-8V72q0-18 18-22z', liq), ...(etq ? etiqueta(68, 96, 56, 40, etq) : [])];
  else if (t === 'garrafon') b = [R(84, 24, 24, 12, tapa, 4), P('M86 36h20v10q34 6 34 30v74q0 12-12 12H64q-12 0-12-12V76q0-24 34-30z', liq), R(52, 96, 88, 10, BRILLO), R(52, 124, 88, 10, BRILLO)];
  else if (t === 'gotero') b = [R(90, 30, 12, 30, tapa, 5), R(84, 58, 24, 12, tapa, 3), R(74, 70, 44, 90, liq, 10), ...(etq ? etiqueta(78, 98, 36, 34, etq) : [])];
  else b = [R(86, 24, 20, 14, tapa, 4), P('M84 38h24l12 26v92q0 8-8 8H80q-8 0-8-8V64z', liq), ...(etq ? etiqueta(72, 92, 48, 34, etq) : [])];
  return [...b, R(t === 'licor' ? 64 : 78, 66, 6, 80, BRILLO, 3), ...(o.extra ?? [])];
}

export function lata(k: Pal, o: { c?: string; raya?: string; alta?: boolean; extra?: Trazo[] } = {}): Trazo[] {
  const c = o.c ?? k.f, raya = o.raya ?? k.s;
  if (o.alta) return [R(68, 40, 56, 120, c, 10), E(96, 40, 28, 7, METAL), E(96, 40, 18, 4, GRIS_CLARO), R(68, 84, 56, 34, raya), R(74, 50, 6, 100, BRILLO, 3), ...(o.extra ?? [])];
  return [R(56, 82, 80, 70, c, 10), E(96, 82, 40, 12, METAL), E(96, 82, 30, 8, GRIS_CLARO), R(56, 104, 80, 26, BLANCO), R(74, 114, 44, 6, raya, 3), ...(o.extra ?? [])];
}

export function carton(k: Pal, o: { c?: string; raya?: string; dibujo?: Trazo[] } = {}): Trazo[] {
  const c = o.c ?? k.f;
  return [P('M68 58l28-24 28 24z', k.o), R(68, 56, 56, 106, c, 4), R(104, 30, 10, 14, k.o, 3), ...(o.dibujo ?? etiqueta(68, 84, 56, 46, o.raya ?? k.s))];
}

/** Bolsa de botana: borde dentado arriba y una ventana con el producto. */
export function bolsa(k: Pal, o: { c?: string; ventana?: Trazo[] } = {}): Trazo[] {
  const c = o.c ?? k.f;
  return [P('M54 40l10.5-7 10.5 7 10.5-7 10.5 7 10.5-7 10.5 7 10.5-7 10.5 7L142 160H50z', c), E(96, 104, 32, 28, BLANCO), ...(o.ventana ?? [E(92, 106, 16, 11, AMARILLO, -0.4), E(104, 98, 12, 8, AMARILLO, 0.5)])];
}

export function costal(k: Pal, o: { c?: string; grano?: string } = {}): Trazo[] {
  const c = o.c ?? k.f, g = o.grano;
  return [P('M62 50q34-10 68 0l8 104q-42 12-84 0z', c), L('M66 56q30-10 60 0', k.o, 6), R(70, 86, 52, 46, BLANCO, 6),
    ...(g ? [C(84, 104, 5, g), C(96, 100, 5, g), C(108, 106, 5, g), C(90, 116, 5, g), C(102, 118, 5, g)] : [R(78, 106, 36, 6, k.s, 3)])];
}

export function frasco(k: Pal, o: { c?: string; tapa?: string; etq?: string | null } = {}): Trazo[] {
  const c = o.c ?? k.f, tapa = o.tapa ?? k.o;
  return [R(68, 40, 56, 22, tapa, 6), R(62, 60, 68, 100, c, 16), ...(o.etq === null ? [] : etiqueta(72, 92, 48, 40, o.etq ?? k.s)), R(70, 70, 6, 76, BRILLO, 3)];
}

export function caja(k: Pal, o: { c?: string; banda?: string; dibujo?: Trazo[]; ancha?: boolean } = {}): Trazo[] {
  const c = o.c ?? k.f;
  if (o.ancha) return [R(36, 70, 120, 84, c, 8), R(36, 70, 120, 16, o.banda ?? k.o, 8), ...(o.dibujo ?? etiqueta(62, 100, 68, 36, k.s))];
  return [R(52, 52, 88, 108, c, 8), R(52, 52, 88, 18, o.banda ?? k.o, 8), ...(o.dibujo ?? etiqueta(68, 90, 56, 44, k.s))];
}

export function tubo(k: Pal, o: { c?: string; tapa?: string } = {}): Trazo[] {
  return [R(82, 140, 28, 22, o.tapa ?? k.o, 4), P('M62 34h68l-18 108H80z', o.c ?? k.f), ...etiqueta(76, 66, 40, 36, k.s)];
}

export function galon(k: Pal, o: { c?: string; tapa?: string } = {}): Trazo[] {
  const c = o.c ?? k.f;
  return [R(64, 30, 24, 14, o.tapa ?? k.o, 4), P('M58 44h70q12 0 12 12v96q0 8-8 8H60q-8 0-8-8V52q0-8 6-8z', c), L('M104 52h20q8 0 8 8v14', BLANCO, 8), ...etiqueta(62, 92, 56, 44, k.s)];
}

export function spray(k: Pal, o: { c?: string; gatillo?: string } = {}): Trazo[] {
  return [R(82, 28, 36, 18, o.gatillo ?? k.o, 5), R(114, 32, 22, 8, o.gatillo ?? k.o, 3), P('M98 46v12', BLANCO), R(66, 46, 64, 116, o.c ?? k.f, 14), ...etiqueta(74, 86, 48, 42, k.s)];
}

/** Sobre o empaque plano (sopas, polvos, semillas). */
export function sobre(k: Pal, o: { c?: string; dibujo?: Trazo[] } = {}): Trazo[] {
  return [R(56, 44, 80, 116, o.c ?? k.f, 6), L('M56 52h80M56 152h80', k.o, 4), ...(o.dibujo ?? etiqueta(66, 84, 60, 44, k.s))];
}

/* ================================================================ BEBIDAS */

export interface OpTaza { liq?: string; espuma?: string | null; arte?: 'corazon' | 'canela' | 'malvavisco' | 'bolsita' | 'hoja' | null; chica?: boolean; vapor?: boolean; color?: string }
export function taza(k: Pal, o: OpTaza = {}): Trazo[] {
  const liq = o.liq ?? CAFE, color = o.color ?? BLANCO;
  const s = o.chica ? 0.78 : 1, cx = 92;
  const w = 84 * s, x0 = cx - w / 2, top = 72 + (1 - s) * 30;
  const t: Trazo[] = [];
  if (o.vapor !== false) t.push(L(`M${cx - 16} ${top - 22}q-8-10 0-20M${cx} ${top - 24}q-8-10 0-20M${cx + 16} ${top - 22}q-8-10 0-20`, GRIS_CLARO, 4));
  t.push(E(cx, 150, 56 * s + 6, 10, GRIS_CLARO));
  t.push(P(`M${x0} ${top}h${w}l-8 ${66 * s}q-2 10-12 10H${x0 + 20}q-10 0-12-10z`, color));
  t.push(L(`M${x0 + w} ${top + 12}q22 0 20 20t-24 22`, color, 9));
  t.push(E(cx, top, w / 2 - 2, 9, liq));
  if (o.espuma) t.push(E(cx, top, w / 2 - 8, 6, o.espuma));
  if (o.arte === 'corazon') t.push(P(`M${cx} ${top + 4}c-10-6-10-12-4-12 2 0 4 2 4 4 0-2 2-4 4-4 6 0 6 6-4 12z`, CAFE_CLARO));
  if (o.arte === 'canela') t.push(C(cx - 8, top - 1, 2, CAFE_CLARO), C(cx + 6, top + 2, 2, CAFE_CLARO), C(cx + 12, top - 2, 2, CAFE_CLARO));
  if (o.arte === 'malvavisco') t.push(R(cx - 18, top - 8, 12, 10, BLANCO, 3), R(cx - 2, top - 10, 12, 10, 'hsl(340 70% 90%)', 3), R(cx + 12, top - 6, 10, 9, BLANCO, 3));
  if (o.arte === 'bolsita') t.push(L(`M${cx + 18} ${top - 2}q10-30 24-34`, GRIS, 2), R(cx + 36, top - 44, 16, 18, o.espuma ?? k.f, 2));
  if (o.arte === 'hoja') t.push(E(cx, top, 10, 4, VERDE_CLARO, 0.4));
  t.push(R(x0 + 14, top + 34 * s, w - 28, 8, o.color ? BLANCO : k.s, 4));
  return t;
}

export interface OpVaso { liq?: string; capas?: string[]; crema?: string | null; popote?: string | null; tapa?: 'domo' | 'plana' | null; rodaja?: string | null; hielo?: boolean; perlas?: string | null; chispas?: string | null; borde?: string | null; etq?: boolean; hojas?: boolean }
export function vaso(k: Pal, o: OpVaso = {}): Trazo[] {
  const liq = o.liq ?? k.f;
  const t: Trazo[] = [];
  if (o.popote !== null) t.push(R(102, 14, 8, 52, o.popote ?? k.o, 3));
  if (o.tapa === 'domo') t.push(P('M60 64q36-34 72 0z', 'rgba(255,255,255,.7)'));
  if (o.crema) t.push(P('M62 64q34-30 68 0z', o.crema), C(82, 54, 4, o.chispas ?? CAFE_CLARO), C(104, 50, 4, o.chispas ?? CAFE_CLARO), C(116, 58, 3, o.chispas ?? CAFE_CLARO));
  if (o.tapa === 'plana') t.push(R(56, 50, 80, 12, k.o, 6));
  t.push(P('M58 62h76l-10 96q-1 6-8 6H76q-7 0-8-6z', VIDRIO));
  if (o.borde) t.push(R(58, 62, 76, 8, o.borde, 3));
  const capas = o.capas ?? [liq];
  const alto = 86 / capas.length;
  capas.forEach((c, i) => {
    const y0 = 74 + i * alto, y1 = y0 + alto;
    const xi = (y: number) => 62 + ((y - 62) / 96) * 10;
    t.push(P(`M${xi(y0)} ${y0}H${192 - xi(y0)}L${192 - xi(y1)} ${y1}H${xi(y1)}z`, c));
  });
  if (o.hielo) t.push(R(72, 80, 16, 16, 'rgba(255,255,255,.5)', 3), R(98, 86, 16, 16, 'rgba(255,255,255,.45)', 3));
  if (o.perlas) for (const [x, y] of [[76, 150], [88, 154], [100, 150], [112, 154], [84, 142], [104, 142]]) t.push(C(x, y, 5, o.perlas));
  if (o.hojas) t.push(E(118, 70, 12, 6, VERDE, -0.6), E(108, 64, 10, 5, VERDE_CLARO, 0.5));
  if (o.etq) t.push(...etiqueta(70, 104, 52, 30, k.s));
  if (o.rodaja) t.push(C(130, 62, 16, o.rodaja), C(130, 62, 10, 'rgba(255,255,255,.45)'), L('M130 52v20M120 62h20', o.rodaja, 2));
  t.push(R(66, 78, 6, 70, BRILLO, 3));
  return t;
}

export function copa(k: Pal, o: { tipo?: 'vino' | 'martini' | 'margarita' | 'flauta' | 'coctel'; liq?: string; borde?: string | null; adorno?: Trazo[] } = {}): Trazo[] {
  const liq = o.liq ?? k.f, tipo = o.tipo ?? 'vino';
  const pie = [R(92, 98, 8, 48, GRIS_CLARO, 3), E(96, 150, 30, 8, GRIS_CLARO)];
  let t: Trazo[];
  if (tipo === 'martini') t = [P('M50 40h92L96 98z', VIDRIO), P('M60 48h72L96 90z', liq)];
  else if (tipo === 'margarita') t = [P('M48 44h96q-4 30-48 34-44-4-48-34z', VIDRIO), P('M56 50h80q-6 22-40 24-34-2-40-24z', liq), P('M82 80h28q-2 14-14 18-12-4-14-18z', VIDRIO)];
  else if (tipo === 'flauta') t = [P('M78 22h36q2 60-18 76-20-16-18-76z', VIDRIO), P('M82 40h28q0 44-14 54-14-10-14-54z', liq), C(92, 60, 2, BLANCO), C(100, 74, 2, BLANCO), C(94, 86, 2, BLANCO)];
  else if (tipo === 'coctel') t = [P('M60 40h72l-8 106q-1 8-8 8H76q-7 0-8-8z', VIDRIO), P('M63 58h66l-6 86q-1 6-6 6H75q-5 0-6-6z', liq)];
  else t = [P('M58 34h76q4 50-38 64-42-14-38-64z', VIDRIO), P('M62 56h68q-4 28-34 36-30-8-34-36z', liq)];
  if (o.borde) t.unshift(R(50, 40, 92, 6, o.borde, 3));
  return [...(tipo === 'coctel' ? [] : pie), ...t, ...(o.adorno ?? [])];
}

export function tarro(o: { liq?: string; espuma?: string; borde?: string | null; extra?: Trazo[] } = {}): Trazo[] {
  return [
    P('M58 52h66v100q0 10-10 10H68q-10 0-10-10z', o.liq ?? AMARILLO),
    L('M124 70h12q12 0 12 12v32q0 12-12 12h-12', 'hsl(46 40% 82%)', 8),
    ...(o.borde ? [R(56, 50, 70, 8, o.borde, 3)] : []),
    P('M54 40q14-14 28-2 14-14 28 0 14-12 18 4v16H54z', o.espuma ?? BLANCO),
    R(70, 70, 8, 70, BRILLO, 4), ...(o.extra ?? []),
  ];
}

export function vasoCorto(o: { liq?: string; hielo?: boolean; rodaja?: string | null; alto?: boolean; sal?: boolean } = {}): Trazo[] {
  if (o.alto) return [P('M74 50h44l-4 104H78z', VIDRIO), P('M76 70h40l-3 82H79z', o.liq ?? AMARILLO), ...(o.sal ? [R(72, 48, 48, 6, BLANCO, 3)] : []), ...(o.rodaja ? [C(122, 52, 14, o.rodaja), C(122, 52, 8, 'rgba(255,255,255,.4)')] : [])];
  return [P('M54 80h84l-6 72q-1 8-8 8H68q-7 0-8-8z', VIDRIO), P('M57 100h78l-4 50q-1 6-6 6H67q-5 0-6-6z', o.liq ?? DORADO),
    ...(o.hielo ? [R(70, 92, 22, 22, 'rgba(255,255,255,.55)', 4), R(98, 98, 22, 22, 'rgba(255,255,255,.5)', 4)] : []),
    ...(o.rodaja ? [C(132, 82, 16, o.rodaja), C(132, 82, 10, 'rgba(255,255,255,.4)')] : [])];
}

/* ================================================================ COMIDA */

/** Plato con algo encima. `honda` = plato hondo (caldos, pozole). */
export function plato(contenido: Trazo[], o: { honda?: boolean; cubiertos?: boolean; color?: string } = {}): Trazo[] {
  const base = o.honda
    ? [P('M40 96h112q-4 58-56 58T40 96z', o.color ?? BLANCO), E(96, 96, 56, 14, 'hsl(215 16% 92%)')]
    : [E(96, 120, 66, 30, o.color ?? BLANCO), E(96, 116, 50, 22, 'hsl(215 16% 94%)')];
  const cub = o.cubiertos ? [L('M24 82v52M18 82v16q0 8 6 8t6-8V82', METAL, 3), R(164, 80, 6, 56, METAL, 3)] : [];
  return [...cub, ...base, ...contenido];
}

/** Taco abierto con su relleno (colores de arriba hacia abajo). */
export function taco(relleno: string[], tortilla = AMARILLO_CLARO): Trazo[] {
  const t: Trazo[] = [P('M40 128q0-64 56-64t56 64z', tortilla)];
  relleno.forEach((c, i) => t.push(L(`M${52 + i * 2} ${112 - i * 6}q10-12 20 0t20 0 20 0 20 0 ${16 - i * 4} 0`, c, 9)));
  t.push(P('M40 128q0-64 56-64t56 64h-10q0-54-46-54t-46 54z', DORADO));
  return t;
}

/** Tostada o sope visto de lado, con capas. */
export function tostada(capas: string[], base = DORADO): Trazo[] {
  const t: Trazo[] = [E(96, 128, 62, 16, base)];
  capas.forEach((c, i) => t.push(E(96 + (i % 2 ? 4 : -4), 118 - i * 8, 52 - i * 8, 12, c)));
  return t;
}

/** Pan o bollo redondo visto de lado. */
export function bollo(c = DORADO, o: { brillo?: string; cortes?: number; semillas?: string | null } = {}): Trazo[] {
  const t: Trazo[] = [P('M40 140q0-72 56-72t56 72z', c), P('M40 140h112q0 10-10 10H50q-10 0-10-10z', DORADO_OSCURO)];
  for (let i = 0; i < (o.cortes ?? 0); i++) t.push(L(`M${66 + i * 22} ${96 - (i % 2) * 4}l14-14`, o.brillo ?? DORADO_CLARO, 5));
  if (o.semillas) for (const [x, y] of [[72, 100], [96, 88], [118, 100], [86, 112], [108, 114]]) t.push(E(x, y, 4, 2, o.semillas, 0.5));
  return t;
}

/** Rebanada triangular (pastel, pay, pizza, sandía). */
export function rebanada(capas: string[], cubierta: string, o: { adorno?: Trazo[] } = {}): Trazo[] {
  const t: Trazo[] = [P('M44 150l100-30v-36L44 112z', capas[0] ?? CREMA), P('M44 112l100-28-50-18L44 84z', cubierta)];
  capas.slice(1).forEach((c, i) => t.push(P(`M44 ${124 + i * 12}l100-26v8L44 ${132 + i * 12}z`, c)));
  return [...t, ...(o.adorno ?? [])];
}

/** Helado: cono o vaso con bolas de colores. */
export function helado(bolas: string[], o: { vaso?: boolean; adorno?: Trazo[] } = {}): Trazo[] {
  const base = o.vaso ? [P('M58 110h76l-10 50H68z', 'hsl(330 60% 80%)'), R(58, 104, 76, 10, 'hsl(330 60% 70%)', 3)]
    : [P('M68 102h56l-28 62z', DORADO), L('M76 110l34 34M116 110l-34 34', DORADO_OSCURO, 3)];
  const pos = bolas.length === 1 ? [[96, 88, 30]] : bolas.length === 2 ? [[80, 92, 24], [112, 92, 24]] : [[78, 94, 22], [114, 94, 22], [96, 66, 24]];
  return [...base, ...bolas.map((c, i) => C(pos[i][0], pos[i][1], pos[i][2], c)), ...(o.adorno ?? [])];
}

/** Dona con su glaseado y chispas. */
export function dona(glaseado: string | null, chispas: string[] = [], centro = 'var(--fondo-centro, #f3efe6)'): Trazo[] {
  const t: Trazo[] = [C(96, 98, 50, DORADO)];
  if (glaseado) t.push(P('M96 54c26 0 46 18 46 42 0 6-6 8-10 4s-8 4-14 2-6-8-12-6-8 6-14 4-8-6-14-4-10 6-14 0-10-2-10-8c0-20 20-34 42-34z', glaseado));
  t.push(C(96, 98, 18, centro));
  const pos = [[72, 72, 6, 4], [108, 66, -4, 6], [124, 84, -6, 2], [84, 64, 2, 6], [66, 88, 4, -4], [116, 76, 6, 2]];
  chispas.forEach((c, i) => { const [x, y, dx, dy] = pos[i % pos.length]; t.push(L(`M${x} ${y}l${dx} ${dy}`, c, 4)); });
  return t;
}

/** Ícono de servicio dentro de un círculo de color. */
export function insignia(k: Pal, glifo: Trazo[], o: { c?: string } = {}): Trazo[] {
  return [C(96, 100, 58, o.c ?? k.s), ...glifo];
}


/* ======================================================================
   CATÁLOGO · BEBIDAS (cafetería, frías, aguas frescas, bar, envasadas)
   ====================================================================== */
const CATALOGO_BEBIDAS: Forma[] = [];
{
  const F = (id: string, claves: string, dibujo: Dibujo, o: { tono?: number; empaque?: string } = {}) =>
    CATALOGO_BEBIDAS.push({ id, claves: claves.split('|'), dibujo, familia: 'bebidas', ...(GENERICAS.has(id) ? { generica: true } : {}), ...o });
  const BARRO = 'hsl(16 55% 48%)', AMBAR = 'hsl(32 80% 40%)', NEGRO_CAFE = 'hsl(20 50% 16%)';
  const limon = (x = 132, y = 60): Trazo[] => [C(x, y, 14, VERDE_CLARO), C(x, y, 9, 'hsl(80 60% 82%)'), L(`M${x} ${y - 9}v18M${x - 9} ${y}h18`, VERDE_CLARO, 2)];
  const naranjaRod = (x = 132, y = 60): Trazo[] => [C(x, y, 14, NARANJA), C(x, y, 9, 'hsl(36 95% 75%)')];
  const cereza = (x = 96, y = 40): Trazo[] => [L(`M${x} ${y}q4-14 12-18`, VERDE_OSCURO, 2), C(x, y, 7, ROJO)];

  /* --- café y calientes --- */
  F('cafe_americano', 'cafe|cafe americano|americano|cafe de grano|cafe del dia|cafe negro|cafe grande|cafe chico|refill de cafe', k => taza(k, { liq: CAFE }), { tono: 28, empaque: 'cafe_soluble' });
  F('espresso', 'espresso|expreso|espresso doble|ristretto|shot de cafe', k => taza(k, { liq: NEGRO_CAFE, chica: true, espuma: 'hsl(28 50% 40%)' }), { tono: 24 });
  F('capuchino', 'capuchino|cappuccino|capuccino', k => taza(k, { liq: CAFE, espuma: CREMA, arte: 'canela' }), { tono: 32 });
  F('latte', 'latte|cafe latte|cafe con leche|flat white|latte vainilla|latte caramelo|latte de avellana', k => taza(k, { liq: CAFE_LECHE, espuma: 'hsl(36 50% 82%)', arte: 'corazon' }), { tono: 34 });
  F('cortado', 'cortado|macchiato|machiato|piccolo', k => taza(k, { liq: CAFE, chica: true, espuma: CREMA, arte: 'corazon' }), { tono: 30 });
  F('mocha', 'moka|mocha|mocachino|cafe moka', k => taza(k, { liq: 'hsl(20 45% 30%)', espuma: CREMA, arte: 'canela', color: 'hsl(20 35% 32%)' }), { tono: 22 });
  F('chocolate_caliente', 'chocolate caliente|chocolate de agua|chocolate de leche caliente|chocolate abuelita|cocoa', k => taza(k, { liq: 'hsl(18 50% 30%)', arte: 'malvavisco' }), { tono: 18 });
  F('te', 'te|te negro|te de manzanilla|manzanilla|te de hierbabuena|te de canela|te de limon|te caliente|infusion', k => taza(k, { liq: 'hsl(36 75% 52%)', arte: 'bolsita', espuma: null }), { tono: 40 });
  F('te_verde', 'te verde|te blanco|te de jazmin', k => taza(k, { liq: 'hsl(75 50% 55%)', arte: 'bolsita' }), { tono: 80 });
  F('matcha', 'matcha|matcha latte|latte de matcha', k => taza(k, { liq: 'hsl(95 45% 55%)', espuma: 'hsl(95 40% 78%)', arte: 'hoja' }), { tono: 95 });
  F('chai', 'chai|chai latte|te chai|dirty chai', k => taza(k, { liq: 'hsl(30 50% 58%)', espuma: CREMA, arte: 'canela', color: 'hsl(30 30% 92%)' }), { tono: 30 });
  F('tisana', 'tisana|te de frutos rojos|te de jamaica caliente|te frutal|te rojo', k => taza(k, { liq: 'hsl(345 60% 52%)', arte: 'bolsita' }), { tono: 345 });
  F('atole', 'atole|atole de vainilla|atole de fresa|atole de arroz|atole de guayaba', k => taza(k, { liq: 'hsl(36 55% 80%)', color: BARRO }), { tono: 26 });
  F('champurrado', 'champurrado|atole de chocolate', k => taza(k, { liq: 'hsl(20 45% 34%)', color: BARRO, arte: 'canela' }), { tono: 20 });
  F('cafe_de_olla', 'cafe de olla|olla de cafe', k => taza(k, { liq: CAFE, color: BARRO, arte: 'canela', espuma: null }), { tono: 16 });
  F('cafe_con_leche_lechero', 'lechero|cafe lechero|cafe con leche condensada|bombon cafe', k => taza(k, { liq: 'hsl(32 45% 70%)', color: 'hsl(210 20% 96%)' }), { tono: 36 });

  /* --- frías: frappés, malteadas, smoothies --- */
  F('frappe_moka', 'frappe|frappe de moka|frappe moka|frappe de cafe|frappuccino|frapuccino|frappe mocha', k => vaso(k, { liq: 'hsl(25 45% 40%)', crema: CREMA, tapa: 'domo' }), { tono: 26 });
  F('frappe_caramelo', 'frappe de caramelo|frappe caramelo|caramel frappe|frappe de cajeta', k => vaso(k, { capas: ['hsl(32 70% 60%)', 'hsl(32 60% 48%)'], crema: CREMA, chispas: 'hsl(30 80% 42%)', tapa: 'domo' }), { tono: 34 });
  F('frappe_vainilla', 'frappe de vainilla|frappe vainilla|frappe de crema|frappe de horchata', k => vaso(k, { liq: 'hsl(45 60% 86%)', crema: BLANCO, chispas: CAFE_CLARO, tapa: 'domo' }), { tono: 44 });
  F('frappe_galleta', 'frappe de galleta|frappe oreo|frappe de oreo|cookies and cream|frappe cookies', k => vaso(k, { liq: 'hsl(220 8% 78%)', crema: BLANCO, chispas: NEGRO, tapa: 'domo' }), { tono: 220 });
  F('frappe_fresa', 'frappe de fresa|frappe fresa|fresa frappe|frappe de frutos rojos', k => vaso(k, { liq: ROSA, crema: BLANCO, chispas: ROJO, tapa: 'domo' }), { tono: 345 });
  F('frappe_matcha', 'frappe de matcha|matcha frappe|frappe de te verde', k => vaso(k, { liq: 'hsl(95 45% 60%)', crema: BLANCO, chispas: VERDE, tapa: 'domo' }), { tono: 95 });
  F('frappe_taro', 'taro|frappe de taro|frappe taro', k => vaso(k, { liq: LILA, crema: BLANCO, chispas: MORADO, tapa: 'domo' }), { tono: 270 });
  F('frappe_chocolate', 'frappe de chocolate|chocolate frio|chocolate frappe|frappe chocolate', k => vaso(k, { liq: 'hsl(20 45% 30%)', crema: CREMA, chispas: 'hsl(20 50% 20%)', tapa: 'domo' }), { tono: 20 });
  F('frappe_rompope', 'frappe de rompope|frappe rompope|rompope frappe|frappe de mazapan|frappe de nuez', k => vaso(k, { liq: 'hsl(48 80% 80%)', crema: BLANCO, chispas: DORADO, tapa: 'domo' }), { tono: 48 });
  F('cafe_helado', 'cafe helado|cafe frio|iced coffee|americano frio|americano helado', k => vaso(k, { liq: CAFE, hielo: true, popote: VERDE_OSCURO }), { tono: 28, empaque: 'cafe_frio_lata' });
  F('cold_brew', 'cold brew|nitro|cafe de extraccion en frio', k => vaso(k, { liq: NEGRO_CAFE, hielo: true, popote: NEGRO }), { tono: 22 });
  F('latte_frio', 'latte frio|latte helado|iced latte|latte en las rocas', k => vaso(k, { capas: ['hsl(36 50% 88%)', CAFE_LECHE, CAFE], hielo: true }), { tono: 34 });
  F('te_helado', 'te helado|te frio|iced tea|te negro frio', k => vaso(k, { liq: 'hsl(30 75% 48%)', hielo: true, rodaja: AMARILLO }), { tono: 34, empaque: 'te_embotellado' });
  F('bubble_tea', 'bubble tea|boba|te de tapioca|tapioca|te con perlas|perlas de tapioca', k => vaso(k, { liq: 'hsl(32 40% 76%)', perlas: NEGRO, tapa: 'plana', popote: ROSA_FUERTE }), { tono: 32 });
  F('bubble_taro', 'bubble tea de taro|taro con tapioca|boba de taro', k => vaso(k, { liq: LILA, perlas: NEGRO, tapa: 'plana', popote: MORADO }), { tono: 270 });
  F('malteada_chocolate', 'malteada|malteada de chocolate|batido de chocolate|milkshake', k => [...vaso(k, { liq: 'hsl(20 45% 35%)', crema: BLANCO, chispas: 'hsl(20 50% 25%)' }), ...cereza(96, 36)], { tono: 20 });
  F('malteada_fresa', 'malteada de fresa|batido de fresa', k => [...vaso(k, { liq: ROSA, crema: BLANCO, chispas: ROJO }), ...cereza(96, 36)], { tono: 345 });
  F('malteada_vainilla', 'malteada de vainilla|batido de vainilla', k => [...vaso(k, { liq: 'hsl(45 70% 88%)', crema: BLANCO, chispas: AMARILLO }), ...cereza(96, 36)], { tono: 48 });
  F('smoothie', 'smoothie|smoothie de fresa|smoothie de frutos rojos|smoothie de fresa platano', k => vaso(k, { capas: [ROSA_FUERTE, ROSA, AMARILLO_CLARO], popote: AMARILLO }), { tono: 340 });
  F('smoothie_verde', 'smoothie verde|licuado verde|green smoothie|detox', k => vaso(k, { liq: VERDE_CLARO, hojas: true, popote: VERDE_OSCURO }), { tono: 100 });
  F('smoothie_mango', 'smoothie de mango|frappe de mango|mangonada|chamoyada', k => vaso(k, { liq: NARANJA, borde: ROJO, popote: ROJO, crema: 'hsl(36 95% 65%)', chispas: ROJO }), { tono: 30 });
  F('licuado', 'licuado|licuado de platano|licuado de fresa|licuado de chocolate|licuado de avena|batido', k => vaso(k, { liq: 'hsl(48 70% 82%)', popote: AMARILLO }), { tono: 46 });
  F('raspado', 'raspado|granizado|frozen|frozen de fresa|slush|frapé de hielo|nieve raspada', k => vaso(k, { liq: 'hsl(200 80% 70%)', crema: 'hsl(330 80% 75%)', chispas: BLANCO, popote: null }), { tono: 200 });

  /* --- jugos y aguas frescas --- */
  F('jugo_naranja', 'jugo de naranja|jugo natural|jugo naranja|zumo de naranja|naranja exprimida', k => vaso(k, { liq: NARANJA, rodaja: NARANJA }), { tono: 32, empaque: 'jugo_carton' });
  F('jugo_verde', 'jugo verde|jugo de nopal|jugo de apio|jugo detox', k => vaso(k, { liq: VERDE, hojas: true }), { tono: 110 });
  F('jugo_zanahoria', 'jugo de zanahoria|jugo de betabel|jugo de zanahoria y naranja', k => vaso(k, { liq: 'hsl(20 90% 52%)', popote: VERDE }), { tono: 20 });
  F('jugo_toronja', 'jugo de toronja|jugo de pina|jugo de mandarina', k => vaso(k, { liq: 'hsl(350 70% 72%)', rodaja: ROSA }), { tono: 350 });
  F('limonada', 'limonada|limonada mineral|limonada natural|agua de limon|limonada de fresa', k => vaso(k, { liq: AMARILLO_CLARO, hielo: true, rodaja: 'hsl(80 60% 50%)' }), { tono: 70 });
  F('naranjada', 'naranjada|naranjada mineral', k => vaso(k, { liq: 'hsl(34 95% 68%)', hielo: true, rodaja: NARANJA }), { tono: 34 });
  F('agua_jamaica', 'agua de jamaica|jamaica|agua jamaica', k => vaso(k, { liq: ROJO_OSCURO, hielo: true }), { tono: 350 });
  F('agua_horchata', 'horchata|agua de horchata|horchata de coco', k => vaso(k, { liq: 'hsl(40 40% 93%)', hielo: true, popote: CAFE_CLARO }), { tono: 38 });
  F('agua_tamarindo', 'agua de tamarindo|tamarindo', k => vaso(k, { liq: 'hsl(25 50% 42%)', hielo: true }), { tono: 25 });
  F('agua_pepino', 'agua de pepino|agua de pepino con limon|agua de alfalfa', k => vaso(k, { liq: 'hsl(100 55% 75%)', hielo: true, rodaja: VERDE }), { tono: 100 });
  F('agua_sandia', 'agua de sandia|sandia natural', k => vaso(k, { liq: ROSA_FUERTE, hielo: true }), { tono: 345 });
  F('agua_pina', 'agua de pina|agua de pina colada', k => vaso(k, { liq: AMARILLO, hielo: true }), { tono: 50 });
  F('agua_melon', 'agua de melon|agua de papaya', k => vaso(k, { liq: 'hsl(28 85% 72%)', hielo: true }), { tono: 28 });
  F('agua_chia', 'agua de chia|limon con chia|agua de limon con chia', k => vaso(k, { liq: AMARILLO_CLARO, perlas: NEGRO }), { tono: 60 });
  F('agua_fresa', 'agua de fresa|fresa natural|agua de frutos rojos', k => vaso(k, { liq: 'hsl(350 75% 70%)', hielo: true }), { tono: 350 });
  F('agua_mango', 'agua de mango|agua de maracuya|agua de guayaba', k => vaso(k, { liq: 'hsl(40 95% 60%)', hielo: true }), { tono: 40 });
  F('agua_fresca', 'agua fresca|agua del dia|agua de sabor|aguas frescas|agua de temporada', k => vaso(k, { liq: k.s, hielo: true }));
  F('tejuino', 'tejuino|tepache|agua de cebada', k => vaso(k, { liq: 'hsl(36 60% 58%)', hielo: true, rodaja: AMARILLO }), { tono: 36 });
  F('soda_italiana', 'soda italiana|soda de sabor|italian soda', k => vaso(k, { capas: [BLANCO, ROSA, ROSA_FUERTE], hielo: true }), { tono: 330 });
  F('refresco_vaso', 'refresco|soda|gaseosa|refresco grande|refresco chico|refresco mediano|refresco de maquina|refill', k => vaso(k, { liq: CAFE, tapa: 'plana', popote: ROJO, etq: true }), { tono: 0, empaque: 'refresco_cola' });

  /* --- bar --- */
  F('cerveza', 'cerveza|cerveza clara|chela|cerveza de barril|tarro de cerveza|cerveza lager|cerveza nacional|cubeta de cerveza|cubetazo', () => tarro({ liq: AMARILLO }), { tono: 44, empaque: 'cerveza_botella' });
  F('cerveza_oscura', 'cerveza oscura|stout|porter|cerveza negra|cerveza ambar|bock', () => tarro({ liq: 'hsl(20 50% 26%)', espuma: CREMA }), { tono: 24 });
  F('cerveza_artesanal', 'cerveza artesanal|ipa|pale ale|cerveza de trigo|cerveza local', () => tarro({ liq: 'hsl(30 85% 52%)' }), { tono: 30 });
  F('michelada', 'michelada|cubana|michelada cubana|ojo rojo|clamato|michelada de tamarindo', () => tarro({ liq: ROJO_OSCURO, borde: ROJO, extra: limon(140, 44) }), { tono: 0 });
  F('chelada', 'chelada|cerveza preparada|cerveza con limon y sal', () => tarro({ liq: AMARILLO, borde: BLANCO, extra: limon(140, 44) }), { tono: 60 });
  F('vino_tinto', 'vino|vino tinto|copa de vino|vino de la casa|merlot|cabernet|malbec|tempranillo', k => copa(k, { liq: ROJO_OSCURO }), { tono: 350, empaque: 'botella_vino' });
  F('vino_blanco', 'vino blanco|chardonnay|sauvignon|copa de vino blanco', k => copa(k, { liq: 'hsl(52 70% 80%)' }), { tono: 52 });
  F('vino_rosado', 'vino rosado|rose|copa de rosado', k => copa(k, { liq: ROSA }), { tono: 340 });
  F('champana', 'champana|champagne|espumoso|vino espumoso|prosecco|cava|brindis', k => copa(k, { tipo: 'flauta', liq: 'hsl(48 80% 78%)' }), { tono: 48 });
  F('margarita', 'margarita|margarita de limon|margarita clasica|margarita frozen', k => copa(k, { tipo: 'margarita', liq: VERDE_CLARO, borde: BLANCO, adorno: limon(136, 40) }), { tono: 90 });
  F('margarita_fresa', 'margarita de fresa|margarita de mango|margarita de tamarindo|margarita de sabor', k => copa(k, { tipo: 'margarita', liq: ROSA_FUERTE, borde: ROJO, adorno: limon(136, 40) }), { tono: 340 });
  F('martini', 'martini|dry martini|appletini|copa martini', k => copa(k, { tipo: 'martini', liq: 'hsl(80 35% 86%)', adorno: [L('M110 30l-14 40', METAL, 2), C(104, 50, 6, VERDE)] }), { tono: 80 });
  F('cosmopolitan', 'cosmopolitan|cosmo|espresso martini', k => copa(k, { tipo: 'martini', liq: ROSA_FUERTE, adorno: [C(132, 42, 8, NARANJA)] }), { tono: 330 });
  F('mojito', 'mojito|mojito de fresa|mojito de maracuya', k => [...copa(k, { tipo: 'coctel', liq: 'hsl(95 40% 86%)' }), E(80, 90, 10, 5, VERDE, -0.4), E(110, 112, 10, 5, VERDE, 0.5), E(96, 132, 9, 4, VERDE_OSCURO), ...limon(132, 44)], { tono: 100 });
  F('pina_colada', 'pina colada|pinacolada|coco loco|coctel de coco', k => [...copa(k, { tipo: 'coctel', liq: CREMA }), P('M116 36l18-14 4 22z', AMARILLO), C(110, 40, 6, ROJO)], { tono: 50 });
  F('paloma', 'paloma|cantarito|cantaritos|charro negro|coctel de toronja', k => [...copa(k, { tipo: 'coctel', liq: ROSA }), ...naranjaRod(132, 44)], { tono: 350 });
  F('clericot', 'clericot|sangria|tinto de verano|sangria preparada', k => [...copa(k, { tipo: 'coctel', liq: ROJO_OSCURO }), C(84, 100, 9, NARANJA), C(108, 124, 8, VERDE_CLARO), C(96, 82, 6, ROJO)], { tono: 0 });
  F('cuba', 'cuba|cuba libre|ron con coca|ron con refresco|bacardi', k => [...copa(k, { tipo: 'coctel', liq: CAFE }), R(72, 74, 20, 20, 'rgba(255,255,255,.5)', 4), ...limon(132, 44)], { tono: 20 });
  F('gin_tonic', 'gin tonic|gin|ginebra|gin and tonic', k => [...copa(k, { tipo: 'vino', liq: 'hsl(180 35% 88%)' }), E(110, 66, 8, 4, VERDE, 0.3), ...limon(136, 40)], { tono: 180 });
  F('aperol', 'aperol|aperol spritz|spritz|negroni|campari', k => [...copa(k, { tipo: 'vino', liq: NARANJA }), ...naranjaRod(136, 40)], { tono: 26 });
  F('tequila', 'tequila|caballito|shot de tequila|tequila blanco|tequila reposado|tequila anejo|shot|shots', () => [...vasoCorto({ alto: true, liq: AMARILLO_CLARO, sal: true }), ...limon(130, 56)], { tono: 52, empaque: 'botella_tequila' });
  F('mezcal', 'mezcal|copita de mezcal|mezcal joven|raicilla|sotol|bacanora', () => [...vasoCorto({ alto: true, liq: 'hsl(200 30% 92%)' }), ...naranjaRod(126, 54)], { tono: 30 });
  F('whisky', 'whisky|whiskey|bourbon|escoces|whisky en las rocas|brandy|cognac', () => vasoCorto({ liq: DORADO, hielo: true }), { tono: 34, empaque: 'botella_licor' });
  F('ron', 'ron|ron blanco|ron anejo', () => vasoCorto({ liq: 'hsl(28 60% 50%)', hielo: true, rodaja: VERDE_CLARO }), { tono: 28 });
  F('vodka', 'vodka|vodka tonic|vodka con jugo|coctel desarmador', () => vasoCorto({ liq: 'hsl(200 35% 92%)', hielo: true, rodaja: NARANJA }), { tono: 200 });
  F('carajillo', 'carajillo|licor 43|cafe con licor|irish coffee', () => [...vasoCorto({ liq: CAFE, hielo: true }), E(96, 98, 36, 6, CREMA)], { tono: 26 });
  F('pulque', 'pulque|curado|pulque curado|curado de avena', () => vasoCorto({ alto: true, liq: 'hsl(40 40% 92%)' }), { tono: 40 });

  /* --- envasadas --- */
  F('agua_botella', 'agua|agua natural|agua embotellada|agua purificada|botella de agua|agua 600|agua 1 litro|agua simple', k => botella(k, { liq: AZUL_CLARO, tapa: AZUL, etq: AZUL }), { tono: 200 });
  F('garrafon', 'garrafon|garrafon de agua|agua 20 litros|recarga de garrafon|bidon', k => botella(k, { tipo: 'garrafon', liq: 'hsl(200 75% 82%)', tapa: AZUL }), { tono: 205 });
  F('agua_mineral', 'agua mineral|agua con gas|mineral|agua gasificada|topo chico', k => botella(k, { liq: 'hsl(140 40% 75%)', tapa: VERDE, etq: AMARILLO }), { tono: 140 });
  F('refresco_cola', 'refresco de cola|cola|refresco cola|refresco negro', k => botella(k, { liq: 'hsl(15 50% 22%)', tapa: ROJO, etq: ROJO }), { tono: 0 });
  F('refresco_naranja', 'refresco de naranja|soda de naranja|naranja refresco', k => botella(k, { liq: NARANJA, tapa: 'hsl(26 80% 40%)', etq: NARANJA }), { tono: 28 });
  F('refresco_limon', 'refresco de limon|refresco lima limon|soda de limon|refresco de lima', k => botella(k, { liq: 'hsl(80 60% 70%)', tapa: VERDE, etq: VERDE }), { tono: 85 });
  F('refresco_toronja', 'refresco de toronja|soda de toronja|refresco de toronja rosa', k => botella(k, { liq: ROSA, tapa: ROSA_FUERTE, etq: ROSA_FUERTE }), { tono: 340 });
  F('refresco_manzana', 'refresco de manzana|manzanita|sidral|soda de manzana', k => botella(k, { liq: 'hsl(36 80% 55%)', tapa: ROJO, etq: VERDE }), { tono: 10 });
  F('refresco_lata', 'refresco en lata|lata de refresco|soda en lata|refresco lata', k => lata(k, { c: ROJO, raya: ROJO, alta: true }), { tono: 0 });
  F('isotonica', 'bebida isotonica|isotonica|suero|electrolitos|bebida hidratante|bebida deportiva', k => botella(k, { liq: 'hsl(195 80% 60%)', tapa: AZUL, etq: NARANJA }), { tono: 195 });
  F('energizante', 'bebida energizante|energizante|energetica|bebida energetica|lata energetica', k => lata(k, { c: NEGRO, raya: VERDE_CLARO, alta: true }), { tono: 110 });
  F('jugo_carton', 'jugo|jugo en carton|nectar|jugo de manzana|jugo de durazno|jugo de mango|jugo de uva|jugo de pera|jugo de guayaba|bebida de fruta', k => carton(k, { c: NARANJA, dibujo: [C(96, 112, 18, 'hsl(36 95% 70%)'), C(96, 112, 12, NARANJA)] }), { tono: 30 });
  F('jugo_cajita', 'jugo chico|jugo en cajita|cajita de jugo|juguito', k => [R(68, 60, 56, 98, k.f, 6), L('M108 60l10-30', BLANCO, 4), ...etiqueta(72, 90, 48, 40, k.s)]);
  F('te_embotellado', 'te embotellado|te en botella|te verde embotellado', k => botella(k, { liq: 'hsl(34 75% 50%)', tapa: VERDE, etq: VERDE_CLARO }), { tono: 38 });
  F('cafe_frio_lata', 'cafe en lata|cafe frio en lata|cafe enlatado|bebida de cafe', k => lata(k, { c: CAFE, raya: CREMA, alta: true }), { tono: 26 });
  F('leche', 'leche|leche entera|leche 1 litro|leche de vaca|leche pasteurizada|leche ultrapasteurizada', k => carton(k, { c: BLANCO, dibujo: [R(68, 84, 56, 40, AZUL), P('M76 120q20-24 40 0z', BLANCO)] }), { tono: 210 });
  F('leche_deslactosada', 'leche deslactosada|leche light|leche descremada|leche semidescremada|leche sin lactosa', k => carton(k, { c: BLANCO, dibujo: [R(68, 84, 56, 40, VERDE), P('M76 120q20-24 40 0z', BLANCO)] }), { tono: 120 });
  F('leche_chocolate', 'leche con chocolate|leche chocolate|chocomilk|leche sabor chocolate', k => carton(k, { c: 'hsl(20 40% 36%)', dibujo: etiqueta(68, 84, 56, 46, 'hsl(20 50% 30%)') }), { tono: 20 });
  F('leche_fresa', 'leche de fresa|leche sabor fresa|leche con fresa|leche de vainilla', k => carton(k, { c: ROSA, dibujo: [C(96, 106, 12, ROJO), ...etiqueta(68, 124, 56, 26, ROSA_FUERTE)] }), { tono: 340 });
  F('leche_vegetal', 'leche de almendra|leche de avena|leche de soya|leche de coco|leche vegetal|bebida de almendra|bebida de avena|bebida de soya', k => carton(k, { c: CREMA, dibujo: [E(96, 104, 12, 16, CAFE_CLARO), ...etiqueta(68, 124, 56, 26, DORADO)] }), { tono: 36 });
  F('yogur_bebible', 'yogur bebible|yoghurt bebible|bebida lactea|yakult|probiotico|kefir|jocoque', k => botella(k, { liq: ROSA, tapa: BLANCO, etq: ROSA_FUERTE }), { tono: 330 });
  F('cerveza_botella', 'cerveza en botella|botella de cerveza|caguama|media|cerveza familiar|six de cerveza|cuarto de cerveza|cerveza 355', k => botella(k, { tipo: 'cerveza', liq: AMBAR, tapa: AMARILLO, etq: AMARILLO }), { tono: 40 });
  F('cerveza_lata', 'cerveza en lata|cerveza lata|lata de cerveza|lata cerveza|latón|laton', k => lata(k, { c: AMARILLO, raya: AZUL, alta: true }), { tono: 46 });
  F('botella_vino', 'botella de vino|vino en botella|vino tinto botella|vino 750', k => botella(k, { tipo: 'vino', liq: ROJO_OSCURO, tapa: ROJO, etq: CREMA }), { tono: 350 });
  F('botella_tequila', 'botella de tequila|tequila botella|tequila 750|tequila litro', k => botella(k, { tipo: 'licor', liq: 'hsl(48 60% 80%)', tapa: CAFE, etq: AMARILLO }), { tono: 50 });
  F('botella_licor', 'botella de licor|licor|ron botella|vodka botella|whisky botella|brandy botella|botella de ron|botella de whisky|anis|rompope', k => botella(k, { tipo: 'licor', liq: DORADO, tapa: NEGRO, etq: CREMA }), { tono: 32 });
}

/* ======================================================================
   CATÁLOGO · COMIDA (frutas, verduras, panadería, postres, platillos)
   ====================================================================== */
const CATALOGO_COMIDA: Forma[] = [];
{
  const F = (id: string, claves: string, dibujo: Dibujo, o: { tono?: number; empaque?: string; familia?: string } = {}) =>
    CATALOGO_COMIDA.push({ id, claves: claves.split('|'), dibujo, familia: o.familia ?? 'comida', ...(GENERICAS.has(id) ? { generica: true } : {}), ...o });
  const FR = (id: string, claves: string, dibujo: Dibujo, tono: number) => F(id, claves, dibujo, { tono, familia: 'frutas y verduras' });
  const PN = (id: string, claves: string, dibujo: Dibujo, tono = 34) => F(id, claves, dibujo, { tono, familia: 'panaderia y postres' });

  const hoja = (x: number, y: number, rot = -0.5, c = VERDE): Trazo => E(x, y, 14, 7, c, rot);
  const tallo = (x: number, y: number, c = CAFE): Trazo => R(x - 2, y, 5, 18, c, 2);
  const redonda = (c: string, o: { r?: number; x?: number; y?: number; hojaC?: string | null; brillo?: boolean } = {}): Trazo[] => {
    const r = o.r ?? 44, x = o.x ?? 96, y = o.y ?? 106;
    return [C(x, y, r, c), ...(o.brillo !== false ? [E(x - r * 0.4, y - r * 0.35, r * 0.18, r * 0.3, 'rgba(255,255,255,.35)', 0.5)] : []),
      ...(o.hojaC !== null ? [tallo(x, y - r - 12), hoja(x + 14, y - r - 6, -0.5, o.hojaC ?? VERDE)] : [])];
  };
  const mitad = (piel: string, pulpa: string, centro: string | null, o: { r?: number } = {}): Trazo[] => {
    const r = o.r ?? 46;
    return [C(96, 104, r, piel), C(96, 104, r - 7, pulpa), ...(centro ? [C(96, 104, r * 0.32, centro)] : [])];
  };
  const puntos = (c: string, lista: number[][], r = 2.5): Trazo[] => lista.map(([x, y]) => E(x, y, r, r * 1.5, c));
  const SEMILLAS = [[80, 92], [96, 84], [112, 92], [86, 110], [106, 112], [96, 126], [74, 116], [118, 116]];

  /* --- frutas --- */
  FR('manzana', 'manzana|manzana roja|manzanas|manzana red', () => [...redonda(ROJO, { r: 40 }), C(118, 106, 40, ROJO)], 0);
  FR('manzana_verde', 'manzana verde|manzana golden|manzana amarilla', () => [...redonda(VERDE_CLARO, { r: 40 }), C(118, 106, 40, VERDE_CLARO)], 90);
  FR('platano', 'platano|platanos|banana|platano tabasco|platano macho|guineo', () => [P('M40 80q20 80 112 52-8-12-20-10-62 6-80-46z', AMARILLO), P('M40 80q4-10 12-4 12 40 64 50', 'none'), L('M44 76l-4-10', CAFE, 5), L('M54 90q20 40 80 40', 'hsl(46 80% 48%)', 3)], 50);
  FR('naranja', 'naranja|naranjas|naranja valencia|naranja para jugo', () => [...redonda(NARANJA, { r: 44 }), ...puntos('hsl(26 80% 48%)', [[80, 100], [110, 96], [98, 122], [118, 118]], 1.5)], 30);
  FR('mandarina', 'mandarina|mandarinas|clementina', () => redonda('hsl(28 95% 58%)', { r: 38, y: 112 }), 28);
  FR('limon', 'limon|limones|lima|limon verde|limon con semilla|limon sin semilla', () => [E(96, 104, 46, 34, VERDE_CLARO), E(52, 104, 6, 6, VERDE), E(140, 104, 6, 6, VERDE), E(80, 92, 10, 6, 'rgba(255,255,255,.35)', 0.3)], 90);
  FR('limon_amarillo', 'limon amarillo|limon real|limon eureka', () => [E(96, 104, 46, 34, AMARILLO), E(52, 104, 6, 6, 'hsl(48 90% 45%)'), E(140, 104, 6, 6, 'hsl(48 90% 45%)')], 52);
  FR('toronja', 'toronja|toronjas|pomelo|toronja rosa', () => [...mitad('hsl(30 80% 60%)', ROSA, null), ...[0, 60, 120, 180, 240, 300].map(a => L(`M96 104l${Math.round(Math.cos(a * Math.PI / 180) * 36)} ${Math.round(Math.sin(a * Math.PI / 180) * 36)}`, 'hsl(350 60% 85%)', 2))], 350);
  FR('fresa', 'fresa|fresas|frutilla|fresa fresca', () => [P('M60 74q36-20 72 0 4 40-36 82-40-42-36-82z', ROJO), P('M70 72l12-14 8 10 6-14 6 14 8-10 12 14z', VERDE), ...puntos(AMARILLO_CLARO, [[80, 92], [96, 88], [112, 92], [88, 108], [104, 108], [96, 124]])], 355);
  FR('uvas', 'uva|uvas|uva verde|uva roja|uva sin semilla|racimo', () => [tallo(96, 36, VERDE_OSCURO), hoja(112, 44, -0.4), ...[[84, 66], [108, 66], [72, 88], [96, 88], [120, 88], [84, 110], [108, 110], [96, 132]].map(([x, y]) => C(x, y, 14, MORADO)), C(78, 84, 4, 'rgba(255,255,255,.4)')], 280);
  FR('sandia', 'sandia|sandias|rebanada de sandia|patilla', () => [P('M36 100h120a60 60 0 0 1-120 0z', VERDE), P('M44 100h104a52 52 0 0 1-104 0z', ROSA_FUERTE), ...puntos(NEGRO, [[72, 112], [96, 120], [120, 112], [84, 132], [108, 132]], 3)], 350);
  FR('melon', 'melon|melones|melon chino|cantaloupe|melon valenciano', () => [P('M36 100h120a60 60 0 0 1-120 0z', 'hsl(80 30% 70%)'), P('M44 100h104a52 52 0 0 1-104 0z', 'hsl(28 90% 66%)'), E(96, 104, 30, 8, 'hsl(36 70% 82%)')], 30);
  FR('pina', 'pina|pinas|anana|pina miel', () => [P('M96 22l-10 26-14-12 8 26-16-4 16 18h32l16-18-16 4 8-26-14 12z', VERDE), E(96, 112, 36, 48, AMARILLO), L('M70 92l52 52M70 124l40-40M80 148l40-40M70 108l48 48', 'hsl(40 80% 45%)', 3)], 48);
  FR('mango', 'mango|mangos|mango ataulfo|mango manila|mango petacon', () => [P('M60 80q30-40 70 0 20 40-10 70-50 10-60-30-6-30 0-40z', 'hsl(40 95% 55%)'), P('M120 70q10 20 0 50', 'none'), E(118, 92, 14, 26, 'hsl(10 80% 58%)', 0.4), tallo(92, 50, VERDE_OSCURO)], 40);
  FR('papaya', 'papaya|papayas|lechosa', () => [E(96, 104, 36, 56, VERDE_CLARO), E(96, 104, 30, 50, NARANJA), E(96, 108, 12, 28, 'hsl(20 70% 40%)'), ...puntos(NEGRO, [[92, 96], [100, 104], [94, 114], [100, 122]], 2)], 26);
  FR('pera', 'pera|peras|pera de agua|pera bosc', () => [C(96, 124, 36, 'hsl(70 60% 58%)'), C(96, 82, 22, 'hsl(70 60% 58%)'), tallo(96, 48), hoja(110, 54)], 70);
  FR('durazno', 'durazno|duraznos|melocoton|chabacano|nectarina', () => [C(96, 108, 42, 'hsl(22 90% 68%)'), E(110, 112, 22, 30, 'hsl(10 80% 62%)'), L('M96 68q-10 40 0 80', 'hsl(14 70% 58%)', 3), hoja(112, 62)], 22);
  FR('ciruela', 'ciruela|ciruelas|ciruela pasa', () => redonda('hsl(300 40% 38%)', { r: 38, y: 110 }), 300);
  FR('cereza', 'cereza|cerezas|guinda', () => [L('M72 120q10-60 30-80M120 116q-6-50-18-76', VERDE_OSCURO, 4), hoja(110, 40), C(72, 128, 22, ROJO_OSCURO), C(120, 124, 22, ROJO_OSCURO), C(66, 120, 5, 'rgba(255,255,255,.4)')], 350);
  FR('kiwi', 'kiwi|kiwis', () => [...mitad('hsl(36 40% 40%)', 'hsl(90 60% 50%)', 'hsl(70 60% 85%)'), ...puntos(NEGRO, [[96, 76], [118, 90], [122, 116], [96, 132], [72, 116], [72, 90]], 2)], 90);
  FR('coco', 'coco|cocos|agua de coco natural|coco partido', () => [C(96, 106, 48, 'hsl(25 45% 35%)'), C(96, 106, 40, BLANCO), C(96, 106, 30, 'hsl(200 40% 92%)')], 30);
  FR('aguacate', 'aguacate|aguacates|palta|aguacate hass', () => [P('M96 42q34 0 40 60 4 56-40 56t-40-56q6-60 40-60z', VERDE_OSCURO), P('M96 50q28 0 32 54 2 46-32 46t-32-46q4-54 32-54z', 'hsl(75 60% 70%)'), C(96, 116, 18, 'hsl(28 50% 40%)')], 80);
  FR('guayaba', 'guayaba|guayabas', () => [...mitad('hsl(70 55% 55%)', 'hsl(350 70% 75%)', null), ...puntos(CREMA, SEMILLAS, 2)], 70);
  FR('granada', 'granada|granadas', () => [C(96, 110, 44, ROJO_OSCURO), P('M84 60l6 10 6-14 6 14 6-10v16H84z', ROJO_OSCURO), ...puntos('hsl(350 80% 70%)', [[82, 104], [100, 100], [112, 112], [92, 120], [106, 126], [80, 122]], 4)], 350);
  FR('frambuesa', 'frambuesa|frambuesas|zarzamora|zarzamoras|mora|moras|frutos rojos|frutos del bosque', () => [...[[84, 90], [100, 86], [116, 92], [78, 108], [94, 104], [110, 106], [124, 110], [88, 122], [104, 124], [96, 138]].map(([x, y]) => C(x, y, 11, 'hsl(345 70% 48%)')), hoja(100, 70)], 345);
  FR('arandano', 'arandano|arandanos|blueberry|blueberries|mora azul', () => [...[[72, 100], [104, 92], [88, 124], [122, 120]].map(([x, y]) => C(x, y, 20, 'hsl(235 45% 45%)')), ...[[72, 92], [104, 84], [88, 116], [122, 112]].map(([x, y]) => C(x, y, 4, 'hsl(235 35% 30%)'))], 235);
  FR('higo', 'higo|higos|breva', () => [P('M96 50q40 40 34 72-8 34-34 34t-34-34q-6-32 34-72z', 'hsl(290 35% 38%)'), E(96, 118, 22, 26, 'hsl(350 60% 60%)')], 300);
  FR('tuna', 'tuna|tunas|xoconostle|pitahaya|pitaya|fruta del dragon', () => [E(96, 106, 36, 46, ROSA_FUERTE), E(96, 106, 28, 38, 'hsl(330 50% 95%)'), ...puntos(NEGRO, SEMILLAS, 1.8)], 330);
  FR('mamey', 'mamey|zapote|zapote negro|chicozapote', () => [P('M96 44q40 20 40 62t-40 52q-40-10-40-52t40-62z', 'hsl(24 40% 40%)'), P('M96 54q30 18 30 54t-30 42q-30-8-30-42t30-54z', 'hsl(16 85% 60%)'), E(96, 106, 10, 22, 'hsl(24 40% 25%)')], 16);
  FR('maracuya', 'maracuya|fruta de la pasion|granadilla', () => [...mitad('hsl(280 40% 40%)', AMARILLO, null), ...puntos(NEGRO, SEMILLAS, 3)], 50);
  FR('fruta_picada', 'fruta picada|coctel de frutas|fruta con chile|vaso de fruta|ensalada de frutas|fruta preparada|fruta de temporada|fruta', k => vaso(k, { capas: [ROJO, AMARILLO, 'hsl(100 55% 62%)', NARANJA], popote: null, chispas: null, crema: null }), 20);

  /* --- verduras --- */
  FR('jitomate', 'jitomate|tomate|jitomates|tomate saladet|tomate bola|tomate cherry', () => [C(96, 112, 44, ROJO), P('M96 68l-14-12 8 16-18 2 18 6-4 14 10-12 10 12-4-14 18-6-18-2 8-16z', VERDE), E(78, 100, 8, 14, 'rgba(255,255,255,.3)', 0.4)], 4);
  FR('tomate_verde', 'tomate verde|tomatillo|tomates verdes', () => [C(96, 112, 40, VERDE_CLARO), P('M60 92q36-60 72 0', 'hsl(60 40% 82%)'), E(80, 104, 7, 12, 'rgba(255,255,255,.3)', 0.4)], 90);
  FR('cebolla', 'cebolla|cebollas|cebolla blanca|cebolla morada|cebollin|cebolla cambray', () => [P('M96 40q50 40 40 80t-40 30q-30 10-40-30T96 40z', 'hsl(40 30% 92%)'), L('M96 44q-20 50 0 104M96 44q20 50 0 104', 'hsl(40 20% 80%)', 2), L('M96 40l-4-14M96 40l6-12', VERDE, 4)], 40);
  FR('ajo', 'ajo|ajos|cabeza de ajo|diente de ajo', () => [P('M96 48q44 44 36 82-6 24-36 24t-36-24q-8-38 36-82z', 'hsl(40 30% 94%)'), L('M80 70q-10 50 4 80M112 70q10 50-4 80M96 50v100', 'hsl(40 15% 80%)', 2)], 40);
  FR('zanahoria', 'zanahoria|zanahorias|zanahoria rallada', () => [P('M70 64q10-8 20 0l52 88q-4 6-10 2z', NARANJA), L('M78 80l10-4M90 100l10-4M104 122l10-4', 'hsl(24 80% 45%)', 3), P('M68 62l-14-26 18 18-2-30 12 30 10-26-2 30z', VERDE)], 26);
  FR('papa', 'papa|papas blancas|papa blanca|papa alpha|camote|papa cambray|batata|yuca', () => [E(96, 108, 52, 38, 'hsl(36 45% 62%)', 0.2), ...puntos('hsl(30 35% 45%)', [[72, 98], [104, 92], [118, 116], [90, 122]], 2)], 36);
  FR('chile', 'chile|chiles|chile jalapeno|jalapeno|chile serrano|serrano|chile poblano|chile habanero|chile de arbol|chile verde', () => [P('M60 70q10-14 22-6 60 40 70 92-4 6-10 2-40-30-82-88z', VERDE), P('M58 70q-6-14-16-16', 'none'), L('M62 66q-8-14-20-18', VERDE_OSCURO, 5)], 110);
  FR('pimiento', 'pimiento|pimientos|morron|pimiento morron|pimiento rojo|pimiento verde|pimiento amarillo', () => [P('M60 80q36-20 72 0 6 50-10 72-26 12-52 0-16-22-10-72z', ROJO), L('M96 58v-18', VERDE_OSCURO, 6), L('M96 82v76', 'hsl(4 60% 42%)', 2)], 4);
  FR('lechuga', 'lechuga|lechugas|lechuga romana|lechuga orejona|espinaca|espinacas|acelga|arugula|kale|col rizada', () => [C(96, 110, 46, VERDE_CLARO), C(76, 96, 24, VERDE), C(116, 96, 24, VERDE), C(96, 84, 22, VERDE_CLARO), L('M96 84v62', 'hsl(90 50% 80%)', 3)], 100);
  FR('brocoli', 'brocoli|brocolis|coliflor|romanesco', () => [R(88, 108, 16, 48, 'hsl(100 45% 55%)', 6), C(72, 92, 22, VERDE_OSCURO), C(96, 78, 24, VERDE), C(120, 92, 22, VERDE_OSCURO), C(96, 100, 20, VERDE)], 110);
  FR('elote_crudo', 'elote crudo|mazorca|maiz|elotes|maiz pozolero', () => [E(96, 104, 22, 54, AMARILLO), ...puntos('hsl(46 80% 48%)', [[90, 68], [102, 68], [90, 84], [102, 84], [90, 100], [102, 100], [90, 116], [102, 116], [90, 132], [102, 132]], 3), P('M74 150q-10-60 20-100 -6 50 2 104z', VERDE), P('M118 150q10-60-20-100 6 50-2 104z', VERDE_CLARO)], 48);
  FR('pepino', 'pepino|pepinos|pepino persa', () => [E(96, 104, 22, 58, VERDE_OSCURO, 0.6), E(96, 104, 16, 50, 'hsl(120 40% 40%)', 0.6), ...puntos(VERDE_CLARO, [[84, 84], [100, 100], [112, 120]], 2)], 120);
  FR('calabacita', 'calabacita|calabacitas|calabaza|zucchini|calabaza italiana|chayote', () => [E(96, 104, 20, 58, 'hsl(100 40% 45%)', -0.6), L('M70 70q20 30 50 70', VERDE_CLARO, 3), R(60, 48, 8, 16, VERDE_OSCURO, 2)], 100);
  FR('berenjena', 'berenjena|berenjenas', () => [P('M70 70q30-20 50 20 20 50-10 66-40 10-50-30-6-40 10-56z', MORADO), P('M64 66l-10-16 18 8 6-14 6 18z', VERDE)], 280);
  FR('champinon', 'champinon|champinones|hongo|hongos|setas|portobello|huitlacoche', () => [P('M44 100q4-46 52-46t52 46z', 'hsl(30 25% 80%)'), R(80, 98, 32, 52, 'hsl(36 30% 92%)', 10), E(76, 80, 8, 5, 'hsl(30 20% 70%)'), E(114, 86, 6, 4, 'hsl(30 20% 70%)')], 30);
  FR('cilantro', 'cilantro|perejil|hierbabuena|epazote|albahaca|hierbas|manojo|romero|menta', () => [L('M96 160V80M96 120l-24-24M96 104l22-26M96 140l26-18', VERDE_OSCURO, 3), ...[[72, 92], [118, 74], [122, 118], [96, 70], [76, 70], [110, 96]].map(([x, y]) => C(x, y, 12, VERDE))], 110);
  FR('nopal', 'nopal|nopales|nopalitos', () => [E(96, 104, 36, 56, VERDE, 0.1), ...puntos('hsl(90 50% 75%)', [[84, 80], [104, 76], [96, 100], [80, 116], [110, 118], [96, 136]], 2)], 110);
  FR('rabano', 'rabano|rabanos|betabel|remolacha|nabo', () => [C(96, 112, 32, ROSA_FUERTE), L('M96 144v16', ROSA_FUERTE, 3), P('M96 80l-20-36 16 14 4-24 4 24 16-14z', VERDE)], 340);
  FR('apio', 'apio|apios|poro|puerro|esparrago|esparragos', () => [R(80, 70, 10, 90, 'hsl(90 50% 62%)', 5), R(92, 64, 10, 96, 'hsl(90 50% 55%)', 5), R(104, 72, 10, 88, 'hsl(90 50% 62%)', 5), C(86, 64, 10, VERDE), C(100, 56, 12, VERDE), C(112, 66, 10, VERDE)], 90);
  FR('ejote', 'ejote|ejotes|chicharo|chicharos|habas|haba|edamame', () => [P('M48 120q40-60 96-60-30 30-96 60z', VERDE), ...[[76, 100], [96, 88], [116, 76]].map(([x, y]) => C(x, y, 7, VERDE_CLARO))], 110);
  FR('jengibre', 'jengibre|curcuma|raiz', () => [P('M50 110q10-30 40-20 10-24 30-10 30 0 20 30-20 30-60 20-70 0z', 'hsl(36 50% 62%)'), L('M70 104l6-8M104 96l8-6', 'hsl(36 40% 45%)', 3)], 36);
  FR('col', 'col|repollo|col morada|repollo morado', () => [C(96, 108, 46, 'hsl(120 35% 70%)'), L('M96 66q-30 40 0 84M96 66q30 40 0 84M60 100q36-10 72 0', 'hsl(120 30% 55%)', 3)], 120);
  FR('verdura_picada', 'verdura|verduras|verdura picada|pico de gallo|ensalada de verduras|verduras mixtas', k => plato([C(80, 112, 10, ROJO), C(104, 108, 10, VERDE), C(92, 124, 9, 'hsl(40 30% 92%)'), C(116, 122, 8, VERDE_CLARO), C(74, 128, 7, ROJO)], {}), 100);

  /* --- panadería --- */
  const concha = (cubierta: string) => () => [P('M40 124q0-62 56-62t56 62z', cubierta), P('M40 124h112q0 12-12 12H52q-12 0-12-12z', DORADO), L('M60 104q36-30 72 0M70 86q26-16 52 0M54 118q42-22 84 0', 'rgba(255,255,255,.5)', 5)];
  PN('concha', 'concha|conchas|concha de vainilla|pan dulce|concha blanca', concha('hsl(42 70% 88%)'));
  PN('concha_chocolate', 'concha de chocolate|concha chocolate|concha rellena', concha('hsl(20 45% 35%)'), 24);
  PN('cuerno', 'cuerno|croissant|cuernito|cuernos|croissant de mantequilla', () => [P('M36 120q30-70 60-62 30-8 60 62-20-10-30-6-14-30-30-30t-30 30q-10-4-30 6z', DORADO), L('M66 84l10 30M96 62v44M126 84l-10 30', DORADO_OSCURO, 3)]);
  PN('oreja', 'oreja|orejas|palmera|palmeras|hojaldre', () => [P('M96 140c-40-10-60-40-44-64 14-20 40-10 40 10 0-20 26-30 40-10 16 24-4 54-36 64z', DORADO), L('M96 136V82M70 90q10 16 26 20M122 90q-10 16-26 20', DORADO_CLARO, 4)]);
  PN('rol_canela', 'rol de canela|roles de canela|cinnamon roll|rollo de canela|caracol|caracoles', () => [C(96, 106, 48, DORADO), L('M96 106m-6 0a6 6 0 1 1 12 0a14 14 0 1 1-28 0a22 22 0 1 1 44 0a30 30 0 1 1-60 0', CAFE_CLARO, 5), P('M60 80q20-14 40-4t40 0', 'none'), L('M64 76q16-10 32 0t32 0', BLANCO, 5)], 30);
  PN('bisquet', 'bisquet|bisquets|biscuit|scone|panecillo', () => [R(52, 76, 88, 70, DORADO, 22), R(52, 76, 88, 26, 'hsl(28 70% 48%)', 18), R(52, 114, 88, 4, DORADO_CLARO)]);
  PN('panque', 'panque|panques|panque de nata|panque de platano|panque de nuez|pan de elote|budin|budín', () => [P('M44 96h104l-8 56H52z', DORADO), P('M44 96q8-30 52-30t52 30z', 'hsl(28 70% 48%)'), L('M70 82q26-12 52 0', DORADO_CLARO, 4)]);
  PN('muffin', 'muffin|muffins|mantecada|mantecadas|magdalena|magdalenas|panquecito|cupcake de vainilla', () => [P('M52 104h88l-10 52H62z', ROJO), L('M62 104l4 52M76 104l2 52M92 104v52M106 104l-2 52M120 104l-4 52', 'hsl(4 60% 42%)', 2), P('M46 106q0-56 50-56t50 56z', DORADO)], 10);
  PN('polvoron', 'polvoron|polvorones|galleta de nuez|mantecado|hojarasca|beso', () => [C(96, 110, 42, 'hsl(36 70% 70%)'), ...puntos(BLANCO, [[80, 96], [104, 92], [112, 114], [86, 120], [98, 106]], 3)], 38);
  PN('puerquito', 'puerquito|marranito|cochinito|cochito|cerdito de piloncillo', () => [E(96, 112, 54, 38, 'hsl(24 55% 40%)'), C(146, 106, 12, 'hsl(24 55% 40%)'), C(68, 96, 4, 'hsl(24 40% 25%)'), P('M60 82l-8-16 20 8z', 'hsl(24 55% 40%)')], 24);
  PN('dona', 'dona|donas|dona glaseada|donut|rosquilla', () => dona(ROSA_FUERTE, [BLANCO, AMARILLO, AZUL_CLARO, BLANCO, VERDE_CLARO, AMARILLO]), 330);
  PN('dona_chocolate', 'dona de chocolate|dona chocolate|dona con chocolate|dona de cafe', () => dona('hsl(20 45% 30%)', [BLANCO, ROSA, AMARILLO]), 24);
  PN('dona_fresa', 'dona de fresa|dona rosa|dona con chispas', () => dona(ROSA, [ROJO, BLANCO, AZUL_CLARO, AMARILLO, VERDE_CLARO, BLANCO]), 345);
  PN('dona_azucar', 'dona de azucar|dona espolvoreada|dona sencilla|dona natural|dona de canela', () => [...dona(null), ...puntos(BLANCO, [[70, 80], [110, 70], [124, 100], [84, 126], [110, 128], [70, 108]], 2.5)]);
  PN('dona_rellena', 'dona rellena|berlina|bola de berlin|dona de crema|dona de cajeta|dona de mermelada', () => [C(96, 104, 46, DORADO), E(96, 70, 32, 10, BLANCO), P('M120 104q14 0 14 10t-14 10z', ROJO), ...puntos(BLANCO, [[80, 96], [104, 120], [110, 92]], 2)]);
  PN('churro', 'churro|churros|churro relleno|churros con chocolate', () => [R(54, 50, 24, 104, DORADO, 10), R(84, 40, 24, 114, DORADO, 10), R(114, 56, 24, 98, DORADO, 10), L('M66 56v90M96 46v100M126 62v84', DORADO_OSCURO, 3), ...puntos(BLANCO, [[60, 70], [100, 64], [120, 90], [70, 120], [102, 128]], 2)]);
  PN('empanada', 'empanada|empanadas|empanada de pina|empanada de cajeta|empanada de carne|empanada de queso|empanada dulce|pay de queso individual', () => [P('M40 120q56-80 112 0z', DORADO), L('M44 120q52 8 104 0', DORADO_OSCURO, 6), L('M56 116l4 6M72 118l2 6M88 120v6M104 120v6M120 118l-2 6M136 116l-4 6', DORADO_CLARO, 3)]);
  PN('garibaldi', 'garibaldi|garibaldis|bollo con chochitos', () => [P('M54 120q0-56 42-56t42 56z', 'hsl(10 70% 55%)'), ...puntos(BLANCO, [[72, 96], [88, 84], [104, 86], [118, 100], [80, 108], [100, 104], [112, 112]], 3), R(54, 118, 84, 30, DORADO, 6)], 10);
  PN('bolillo', 'bolillo|bolillos|telera|teleras|pan blanco|birote|pan frances|pan salado|pambazo', () => [E(96, 110, 60, 32, DORADO), L('M80 94q16 4 32 0M70 104q26 6 52 0', DORADO_CLARO, 4)]);
  PN('baguette', 'baguette|baguettes|pan baguette|chapata|ciabatta|pan de ajo', () => [E(96, 104, 66, 20, DORADO, -0.6), L('M60 120l14-10M84 104l14-10M108 88l14-10', DORADO_CLARO, 4)]);
  PN('pan_caja', 'pan de caja|pan blanco de caja|pan integral|pan de molde|pan bimbo|pan tostado|pan multigrano|pan de centeno', () => [P('M48 150V92c0-40 96-40 96 0v58z', DORADO), P('M56 146V94c0-30 80-30 80 0v52z', CREMA)], 38);
  PN('pan_semillas', 'pan de semillas|pan de avena|pan artesanal|hogaza|pan de masa madre|pan rustico', () => bollo('hsl(28 60% 50%)', { cortes: 3, semillas: CREMA }), 30);
  PN('pan_muerto', 'pan de muerto|pan de muertos|pan de anis', () => [...bollo(DORADO), L('M66 100q30-26 60 0M96 76v40', 'hsl(28 60% 42%)', 7), C(96, 72, 8, 'hsl(28 60% 42%)'), ...puntos(BLANCO, [[74, 112], [116, 112], [96, 126]], 3)], 34);
  PN('rosca', 'rosca|rosca de reyes|rosca de pascua|pan de rosca', () => [E(96, 104, 64, 44, DORADO), E(96, 104, 30, 16, 'var(--fondo-centro, #f3efe6)'), R(60, 74, 16, 8, VERDE, 3), R(112, 72, 16, 8, ROJO, 3), R(130, 100, 14, 8, AMARILLO, 3), R(56, 112, 14, 8, ROJO, 3)], 36);
  PN('tortillas', 'tortilla|tortillas|tortillas de maiz|tortillas de harina|kilo de tortillas|tortillas a mano', () => [E(96, 132, 62, 14, 'hsl(48 60% 78%)'), E(96, 120, 62, 14, 'hsl(48 70% 84%)'), E(96, 108, 62, 14, 'hsl(48 60% 78%)'), E(96, 96, 62, 14, 'hsl(48 70% 86%)'), ...puntos('hsl(36 50% 60%)', [[76, 94], [104, 92], [118, 98]], 2)], 48);
  PN('galleta_chispas', 'galleta|galletas|galleta de chispas|cookie|cookies|galleta con chispas de chocolate|galleta grande', () => [C(96, 104, 52, DORADO), C(96, 104, 44, DORADO_CLARO), ...[[76, 88, 7], [110, 80, 6], [118, 112, 7], [84, 122, 6], [98, 102, 5]].map(([x, y, r]) => C(x, y, r, CAFE))]);
  PN('galleta_avena', 'galleta de avena|galletas de avena|galleta integral|galleta de jengibre|galleta de mantequilla', () => [C(96, 104, 50, 'hsl(32 50% 62%)'), ...puntos('hsl(36 50% 82%)', [[78, 90], [104, 86], [116, 108], [88, 120], [100, 104], [72, 110]], 4)], 32);
  PN('galleta_glaseada', 'galleta decorada|galleta glaseada|galleta de animalito|animalitos|galleta de fondant|galletas decoradas', () => [P('M96 50l14 30 32 4-24 22 6 32-28-16-28 16 6-32-24-22 32-4z', ROSA), L('M80 104q16 10 32 0', BLANCO, 4)], 340);

  /* --- postres --- */
  PN('pastel_chocolate', 'pastel|pastel de chocolate|rebanada de pastel|pastel chocolate|pastel de cumpleanos|torta de chocolate|chocolatisimo', () => rebanada(['hsl(20 45% 32%)', 'hsl(20 50% 22%)', 'hsl(20 45% 32%)'], 'hsl(20 40% 42%)', { adorno: [C(94, 70, 9, ROJO), R(93, 54, 3, 10, VERDE)] }), 22);
  PN('pastel_fresa', 'pastel de fresa|pastel de fresas con crema|pastel de vainilla|pastel blanco|pastel de crema', () => rebanada([CREMA, ROSA, CREMA], ROSA, { adorno: [P('M86 70q8-10 16 0 2 10-8 16-10-6-8-16z', ROJO)] }), 345);
  PN('tres_leches', 'tres leches|pastel de tres leches|pastel de rompope|pastel imposible|chocoflan', () => rebanada(['hsl(45 70% 85%)', 'hsl(45 60% 70%)', 'hsl(45 70% 85%)'], BLANCO, { adorno: [C(94, 70, 8, ROJO), C(108, 76, 6, AMARILLO)] }), 46);
  PN('cheesecake', 'cheesecake|pay de queso|pastel de queso|cheesecake de frutos rojos|tarta de queso', () => rebanada(['hsl(45 60% 90%)', DORADO], 'hsl(350 70% 52%)'), 48);
  PN('pastel_zanahoria', 'pastel de zanahoria|carrot cake|pastel de nuez|pastel de platano|pastel de manzana', () => rebanada(['hsl(28 60% 55%)', CREMA, 'hsl(28 60% 55%)'], CREMA, { adorno: [C(94, 68, 7, NARANJA), E(102, 62, 5, 2, VERDE)] }), 28);
  PN('selva_negra', 'selva negra|pastel selva negra|red velvet|terciopelo rojo', () => rebanada(['hsl(350 60% 42%)', CREMA, 'hsl(350 60% 42%)'], CREMA, { adorno: [C(94, 70, 9, ROJO_OSCURO)] }), 350);
  PN('pay_limon', 'pay de limon|pay|tarta de limon|pay de mango|pay de guayaba|pie', () => [P('M44 150l100-30-4-26L44 120z', DORADO), P('M44 120l96-26-46-24L44 96z', AMARILLO_CLARO), ...[[66, 92], [90, 84], [114, 80]].map(([x, y]) => C(x, y, 7, BLANCO))], 52);
  PN('pay_manzana', 'pay de manzana|apple pie|strudel|tarta de manzana|pay de nuez|pay de cereza', () => [P('M44 150l100-30-4-26L44 120z', DORADO), P('M44 120l96-26-46-24L44 96z', DORADO), L('M58 112l70-20M64 100l50-14M72 88l30-8M70 116l-6-16M96 108l-8-22M122 100l-10-20', DORADO_OSCURO, 4)], 30);
  PN('cupcake', 'cupcake|cupcakes|cup cake|pastelito|panquecito decorado', () => [P('M60 104h72l-8 52H68z', AZUL_CLARO), L('M70 104l4 52M86 104l2 52M106 104l-2 52M122 104l-4 52', 'hsl(200 60% 60%)', 2), C(74, 94, 20, ROSA), C(118, 94, 20, ROSA), C(96, 76, 24, ROSA), C(96, 52, 7, ROJO)], 330);
  PN('brownie', 'brownie|brownies|blondie|barra de chocolate casera', () => [R(46, 78, 100, 70, 'hsl(20 45% 26%)', 8), R(46, 78, 100, 14, 'hsl(20 40% 36%)', 8), L('M64 104l16 8M100 100l18 10M70 128l14 6', 'hsl(20 40% 40%)', 3), ...puntos(CREMA, [[90, 118], [120, 126]], 4)], 22);
  PN('flan', 'flan|flan napolitano|flan de vainilla|flan de cajeta|natilla|creme brulee', () => [E(96, 150, 58, 10, GRIS_CLARO), P('M54 146l10-60h64l10 60z', DORADO_CLARO), P('M64 86h64l-2 16H66z', CAFE_CLARO), E(96, 86, 32, 8, CAFE)], 40);
  PN('gelatina', 'gelatina|gelatinas|gelatina de leche|gelatina de agua|gelatina mosaico|jello', () => [P('M54 146l8-70q34-12 68 0l8 70z', 'hsl(345 70% 60%)'), P('M62 76q34-12 68 0l-2 12q-32-10-64 0z', 'hsl(345 70% 72%)'), ...[[80, 112], [104, 104], [96, 128], [116, 126]].map(([x, y]) => R(x, y, 12, 12, 'rgba(255,255,255,.55)', 3)), E(96, 148, 52, 6, GRIS_CLARO)], 345);
  PN('arroz_leche', 'arroz con leche|arroz con leche y canela|pudin|pudin de chia|budin de arroz|natillas', () => [P('M48 94h96q-4 56-48 56T48 94z', BLANCO), E(96, 94, 48, 12, CREMA), ...puntos(CAFE_CLARO, [[80, 92], [100, 96], [112, 90]], 2), L('M104 92l30-30', CAFE_CLARO, 5)], 40);
  PN('crepa', 'crepa|crepas|crepe|crepas dulces|crepa de nutella|crepa de cajeta|crepa de fresa', () => [P('M40 140l56-90 56 90z', DORADO_CLARO), P('M58 112l38-62 38 62z', DORADO), L('M66 120l60-4', 'hsl(20 45% 30%)', 6), C(80, 100, 6, ROJO), C(112, 102, 6, ROJO)], 36);
  PN('waffle', 'waffle|waffles|wafle|gofre|waffle belga', () => [C(96, 104, 52, DORADO), ...[-30, -10, 10, 30].flatMap(d => [L(`M${96 + d} 56v96`, DORADO_OSCURO, 3), L(`M48 ${104 + d}h96`, DORADO_OSCURO, 3)]), E(104, 90, 14, 8, BLANCO)], 36);
  PN('hotcakes', 'hot cakes|hotcakes|hot cake|pancake|pancakes|panqueques|hotcakes con miel', () => [E(96, 150, 60, 10, GRIS_CLARO), E(96, 138, 50, 12, DORADO), E(96, 124, 50, 12, DORADO_CLARO), E(96, 110, 50, 12, DORADO), E(96, 96, 50, 12, DORADO_CLARO), R(84, 80, 24, 14, CREMA, 3), P('M56 96q8 30 16 0q10 26 22 6', 'hsl(28 70% 40%)')]);
  PN('helado_cono', 'helado|helados|cono|cono de helado|nieve|nieve de garrafa|helado de vainilla|bola de helado|gelato', () => helado([CREMA, 'hsl(345 70% 80%)']), 340);
  PN('helado_chocolate', 'helado de chocolate|nieve de chocolate|helado doble|helado triple', () => helado(['hsl(20 45% 35%)', 'hsl(20 45% 45%)', 'hsl(20 45% 30%)']), 22);
  PN('helado_vaso', 'helado en vaso|vasito de helado|copa de helado|sundae|helado de yogurt|frozen yogurt|banana split', () => helado([ROSA, 'hsl(100 50% 75%)', CREMA], { vaso: true, adorno: [C(96, 40, 7, ROJO)] }), 330);
  PN('paleta_hielo', 'paleta|paletas|paleta de hielo|paleta helada|paleta de agua|paleta de leche|bolis|congelada|esquimal', () => [R(68, 34, 56, 100, ROSA_FUERTE, 26), R(68, 34, 56, 30, 'hsl(330 70% 70%)', 26), R(90, 130, 12, 32, DORADO_CLARO, 4), E(84, 60, 6, 14, 'rgba(255,255,255,.35)')], 330);
  PN('macaron', 'macaron|macarons|macaroon|merengue|merengues', () => [E(96, 84, 40, 18, ROSA), R(58, 92, 76, 12, CREMA, 6), E(96, 112, 40, 18, ROSA)], 330);
  PN('tiramisu', 'tiramisu|postre de cafe|carlota|carlota de limon|postre frio|mousse|mousse de chocolate', () => [R(52, 70, 88, 80, CREMA, 8), R(52, 70, 88, 16, 'hsl(20 40% 36%)', 8), R(52, 104, 88, 10, 'hsl(28 40% 52%)'), R(52, 130, 88, 10, 'hsl(28 40% 52%)')], 30);
  PN('fresas_crema', 'fresas con crema|fresas con chocolate|fresas cubiertas|duraznos con crema', () => [P('M48 94h96q-4 56-48 56T48 94z', BLANCO), E(96, 94, 48, 12, CREMA), P('M70 84q8-12 18 0 2 12-9 18-11-6-9-18z', ROJO), P('M98 80q8-12 18 0 2 12-9 18-11-6-9-18z', ROJO)], 350);
  PN('pastel_entero', 'pastel completo|pastel entero|pastel para fiesta|pastel personalizado|tarta|pastel de boda', () => [R(42, 96, 108, 56, ROSA, 10), R(42, 96, 108, 16, BLANCO, 8), L('M50 112q8 8 16 0t16 0 16 0 16 0 16 0 16 0', BLANCO, 4), R(66, 62, 60, 36, 'hsl(330 70% 80%)', 8), R(94, 40, 4, 22, AMARILLO, 2), E(96, 36, 4, 7, NARANJA)], 330);

  /* --- platillos --- */
  F('taco_pastor', 'taco|tacos|taco al pastor|tacos al pastor|pastor|orden de tacos|tacos de trompo|gringa', () => [...taco(['hsl(16 80% 50%)', 'hsl(30 60% 45%)', VERDE]), E(112, 76, 9, 6, AMARILLO, 0.3)], { tono: 20 });
  F('taco_asada', 'taco de asada|tacos de asada|tacos de bistec|taco de bistec|arrachera en taco|tacos de carne', () => taco(['hsl(20 40% 30%)', 'hsl(40 20% 92%)', VERDE]), { tono: 26 });
  F('taco_pollo', 'taco de pollo|tacos de pollo|taco de tinga|tinga|tacos de guisado|taco de guisado', () => taco(['hsl(36 60% 70%)', ROJO, 'hsl(100 55% 62%)']), { tono: 36 });
  F('taco_birria', 'birria|taco de birria|tacos de birria|quesabirria|tacos de barbacoa|barbacoa', () => [...taco(['hsl(8 60% 38%)', 'hsl(40 20% 92%)'], 'hsl(10 70% 50%)'), P('M120 150h40q-2 12-20 12t-20-12z', 'hsl(8 60% 40%)')], { tono: 10 });
  F('taco_pescado', 'taco de pescado|tacos de pescado|taco de camaron|tacos de camaron|taco gobernador|tacos baja', () => taco(['hsl(36 60% 60%)', 'hsl(120 40% 85%)', 'hsl(330 50% 60%)']), { tono: 200 });
  F('taco_carnitas', 'carnitas|taco de carnitas|tacos de carnitas|taco de suadero|suadero|taco de lengua|taco de tripa|taco de cabeza|campechano', () => taco(['hsl(30 50% 48%)', 'hsl(40 20% 92%)', VERDE]), { tono: 30 });
  F('tacos_dorados', 'tacos dorados|flautas|flauta|taquitos|tacos de papa|taco dorado|tacos ahogados', () => [E(96, 140, 64, 10, GRIS_CLARO), R(40, 92, 112, 22, DORADO, 11), R(40, 116, 112, 22, DORADO, 11), L('M52 96q40-14 88 0', BLANCO, 5), C(70, 94, 5, 'hsl(100 55% 62%)'), C(110, 96, 5, ROJO)], { tono: 40 });
  F('quesadilla', 'quesadilla|quesadillas|quesadilla de queso|quesadilla de flor|quesadilla de huitlacoche|sincronizada|sincronizadas', () => [P('M40 128q0-64 56-64t56 64z', 'hsl(48 70% 72%)'), L('M44 124q52 10 104 0', 'hsl(48 90% 65%)', 8), ...puntos(DORADO_OSCURO, [[70, 96], [104, 88], [122, 108], [84, 114]], 3)], { tono: 46 });
  F('burrito', 'burrito|burritos|burrito percheron|chimichanga|wrap mexicano', () => [R(40, 84, 112, 44, 'hsl(44 60% 80%)', 22), E(146, 106, 12, 22, 'hsl(44 50% 70%)'), C(150, 100, 5, 'hsl(20 40% 32%)'), C(146, 112, 5, ROJO), C(152, 108, 4, VERDE)], { tono: 44 });
  F('enchiladas_verdes', 'enchiladas|enchiladas verdes|entomatadas|enchiladas suizas|enchiladas de pollo', () => plato([R(52, 100, 88, 16, 'hsl(48 70% 72%)', 8), R(52, 118, 88, 16, 'hsl(48 70% 72%)', 8), P('M50 100q46-16 92 0v34q-46 10-92 0z', 'hsl(100 50% 48%)'), L('M60 108q36 8 72 0', BLANCO, 5), C(78, 98, 5, 'hsl(320 40% 70%)')]), { tono: 100 });
  F('enchiladas_rojas', 'enchiladas rojas|enchiladas potosinas|enfrijoladas|enmoladas|papadzules', () => plato([R(52, 100, 88, 16, 'hsl(48 70% 72%)', 8), R(52, 118, 88, 16, 'hsl(48 70% 72%)', 8), P('M50 100q46-16 92 0v34q-46 10-92 0z', ROJO), L('M60 108q36 8 72 0', BLANCO, 5)]), { tono: 4 });
  F('mole', 'mole|mole poblano|mole negro|pollo en mole|mole rojo|pipian|mole verde', () => plato([E(96, 116, 40, 18, 'hsl(10 50% 28%)'), E(90, 112, 18, 10, 'hsl(36 50% 70%)'), ...puntos(CREMA, [[80, 106], [104, 110], [96, 120], [114, 118]], 2)]), { tono: 12 });
  F('chilaquiles_verdes', 'chilaquiles|chilaquiles verdes|chilaquiles con pollo|chilaquiles con huevo', () => plato([...[[70, 112], [90, 104], [112, 110], [80, 124], [104, 124], [122, 120]].map(([x, y]) => P(`M${x - 12} ${y + 6}l12-18 12 18z`, DORADO)), E(96, 116, 44, 10, 'hsl(100 50% 48%)'), L('M70 110q26 8 52 0', BLANCO, 4), C(88, 104, 4, 'hsl(320 40% 70%)')]), { tono: 100 });
  F('chilaquiles_rojos', 'chilaquiles rojos|chilaquiles divorciados|chilaquiles con chorizo', () => plato([...[[70, 112], [90, 104], [112, 110], [80, 124], [104, 124], [122, 120]].map(([x, y]) => P(`M${x - 12} ${y + 6}l12-18 12 18z`, DORADO)), E(96, 116, 44, 10, ROJO), L('M70 110q26 8 52 0', BLANCO, 4)]), { tono: 4 });
  F('pozole', 'pozole|pozole rojo|pozole blanco|pozole verde|menudo|pancita|mondongo', () => plato([E(96, 96, 50, 11, ROJO), ...puntos(BLANCO, [[76, 94], [92, 98], [108, 94], [118, 98], [84, 100]], 3), E(110, 92, 8, 4, VERDE_CLARO)], { honda: true }), { tono: 0 });
  F('caldo', 'caldo|caldo de pollo|caldo de res|consome de res|consome de birria|caldo tlalpeno|cocido|puchero|sopa de verduras|caldo de mariscos|caldo de camaron', () => plato([E(96, 96, 50, 11, 'hsl(44 70% 62%)'), C(80, 94, 6, NARANJA), C(104, 96, 6, VERDE_CLARO), E(116, 92, 8, 4, 'hsl(36 50% 82%)')], { honda: true }), { tono: 44, empaque: 'consome' });
  F('sopa', 'sopa|sopas|sopa de tortilla|sopa azteca|sopa de fideo|sopa de lentejas|crema de|crema de elote|crema de champinones|sopa de frijol|sopa del dia', () => plato([E(96, 96, 50, 11, 'hsl(16 70% 50%)'), L('M76 92l14-4M98 96l14-6', DORADO, 4), C(110, 92, 5, 'hsl(40 30% 92%)')], { honda: true }), { tono: 16 });
  F('ramen', 'ramen|sopa ramen|sopa instantanea preparada|udon|pho|sopa de fideos', () => [...plato([E(96, 96, 50, 11, 'hsl(36 60% 60%)'), L('M70 96q8-6 16 0t16 0 16 0', 'hsl(48 80% 80%)', 3), E(110, 92, 9, 7, BLANCO), C(110, 92, 4, AMARILLO)], { honda: true }), L('M126 50l20 50M136 46l16 52', CAFE_CLARO, 3)], { tono: 0 });
  F('tamal', 'tamal|tamales|tamal verde|tamal rojo|tamal de rajas|tamal oaxaqueno|tamal de dulce|corunda|uchepo', () => [P('M48 140q0-40 48-96 48 56 48 96z', 'hsl(48 50% 72%)'), P('M66 136q0-30 30-70 30 40 30 70z', 'hsl(48 80% 82%)'), L('M96 52v84', 'hsl(48 40% 62%)', 2)], { tono: 48 });
  F('elote', 'elote|elote preparado|elote asado|elote con mayonesa|elote en vaso', () => [R(90, 136, 12, 26, 'hsl(48 50% 80%)', 3), E(96, 96, 24, 50, AMARILLO), L('M76 80q20 8 40 0M76 100q20 8 40 0M76 120q20 8 40 0', BLANCO, 5), ...puntos(ROJO, [[84, 86], [104, 106], [92, 116]], 2)], { tono: 48 });
  F('esquites', 'esquites|esquite|vaso de elote|chasca|trolelote', () => [P('M60 80h72l-10 76H70z', 'hsl(210 30% 92%)'), E(96, 80, 36, 10, AMARILLO), ...puntos(AMARILLO, [[80, 74], [96, 70], [112, 74], [88, 66], [104, 66]], 5), L('M118 70l20-30', 'hsl(0 0% 85%)', 4), C(96, 76, 4, ROJO)], { tono: 50 });
  F('sope', 'sope|sopes|huarache|huaraches|tlacoyo|tlacoyos|memela|picadita|gordita|gorditas|tlayuda|tlayudas', () => tostada(['hsl(20 40% 30%)', 'hsl(40 20% 94%)', 'hsl(100 55% 62%)'], 'hsl(40 60% 62%)'), { tono: 40 });
  F('tostada', 'tostada|tostadas|tostada de pollo|tostada de tinga|tostada de pata|tostadas raspadas', () => tostada(['hsl(20 40% 30%)', 'hsl(100 55% 62%)', 'hsl(40 20% 94%)', ROJO]), { tono: 40 });
  F('tostada_ceviche', 'tostada de ceviche|tostada de atun|tostada de camaron|tostada de marlin|tostada de pulpo', () => [...tostada(['hsl(40 30% 92%)', 'hsl(100 55% 62%)', ROJO]), E(110, 94, 14, 6, 'hsl(80 50% 60%)', 0.2)], { tono: 190 });
  F('chile_relleno', 'chile relleno|chiles rellenos|chile en nogada|chiles en nogada|rajas con crema', () => plato([P('M56 116q20-30 70-20 18 6 14 22-40 18-84-2z', 'hsl(36 70% 58%)'), L('M122 96l14-14', VERDE_OSCURO, 5), E(96, 128, 30, 6, ROJO)]), { tono: 100 });
  F('torta', 'torta|tortas|torta de milanesa|torta cubana|torta ahogada|torta de jamon|torta de pierna|guajolota|pambazo relleno|lonche', () => [P('M40 98q0-30 56-30t56 30z', DORADO), L('M42 106q12 8 24 0t24 0 24 0 24 0 24 0', VERDE, 8), R(42, 110, 108, 10, 'hsl(350 50% 70%)', 2), R(42, 120, 108, 8, AMARILLO, 2), P('M40 128h112q0 18-18 18H58q-18 0-18-18z', DORADO)], { tono: 36 });
  F('sandwich', 'sandwich|sandwiches|sandwich de jamon|club sandwich|sandwich club|panini|sandwich de pollo|emparedado|sandwich mixto|cuernito relleno', () => [P('M40 96l56-34 56 34z', DORADO_CLARO), L('M42 104q12 8 24 0t24 0 24 0 24 0 24 0', VERDE, 8), R(42, 108, 108, 10, 'hsl(350 60% 70%)', 2), R(42, 118, 108, 8, AMARILLO, 2), P('M40 128h112l-6 20H46z', DORADO)], { tono: 40 });
  F('wrap', 'wrap|wraps|wrap de pollo|tortilla rellena|rollito|rollo de pollo', () => [R(52, 60, 44, 96, 'hsl(44 60% 82%)', 22), R(96, 66, 44, 90, 'hsl(44 60% 78%)', 22), E(74, 62, 20, 8, VERDE), E(118, 68, 20, 8, ROJO)], { tono: 44 });
  F('hamburguesa', 'hamburguesa|hamburguesas|burger|hamburguesa sencilla|hamburguesa clasica|hamburguesa con queso|cheeseburger|hamburguesa con papas', () => [P('M44 96q0-50 52-50t52 50z', DORADO), C(76, 70, 3, CREMA), C(100, 62, 3, CREMA), C(118, 76, 3, CREMA), L('M42 104q14 10 27 0t27 0 27 0 27 0', VERDE, 9), R(42, 108, 108, 10, AMARILLO, 3), R(40, 118, 112, 16, CAFE, 8), P('M44 136h104q0 18-18 18H62q-18 0-18-18z', DORADO)], { tono: 34 });
  F('hamburguesa_doble', 'hamburguesa doble|doble carne|hamburguesa triple|burger doble|hamburguesa especial|hamburguesa hawaiana', () => [P('M44 86q0-46 52-46t52 46z', DORADO), L('M42 92q14 10 27 0t27 0 27 0 27 0', VERDE, 8), R(40, 96, 112, 14, CAFE, 7), R(42, 110, 108, 8, AMARILLO, 3), R(40, 118, 112, 14, CAFE, 7), R(42, 132, 108, 6, ROJO, 3), P('M44 138h104q0 16-18 16H62q-18 0-18-16z', DORADO)], { tono: 30 });
  F('hamburguesa_pollo', 'hamburguesa de pollo|chicken burger|hamburguesa crispy|sandwich de pollo crujiente', () => [P('M44 96q0-50 52-50t52 50z', DORADO), L('M42 104q14 10 27 0t27 0 27 0 27 0', VERDE, 9), P('M38 110q58-14 116 0l-4 22q-54 8-108 0z', 'hsl(36 75% 55%)'), P('M44 136h104q0 18-18 18H62q-18 0-18-18z', DORADO)], { tono: 38 });
  F('hotdog', 'hot dog|hotdog|hot dogs|jocho|jochos|perro caliente|banderilla|corn dog|salchicha con pan', () => [R(42, 80, 108, 44, DORADO, 22), R(36, 88, 120, 22, 'hsl(10 60% 50%)', 11), L('M50 92q8-8 16 0t16 0 16 0 16 0 16 0 16 0', AMARILLO, 4), R(42, 102, 108, 26, DORADO_CLARO, 13)], { tono: 14 });
  F('pizza_pepperoni', 'pizza|pizzas|rebanada de pizza|pizza de pepperoni|pepperoni|slice|pizza individual', () => [P('M96 160L40 50q56-24 112 0z', AMARILLO), P('M40 50q56-24 112 0l-6 12q-50-20-100 0z', DORADO), C(86, 76, 9, ROJO), C(110, 90, 8, ROJO), C(96, 118, 7, ROJO), C(74, 96, 6, ROJO)], { tono: 20 });
  F('pizza_hawaiana', 'pizza hawaiana|hawaiana|pizza de pina|pizza de jamon', () => [P('M96 160L40 50q56-24 112 0z', AMARILLO), P('M40 50q56-24 112 0l-6 12q-50-20-100 0z', DORADO), R(78, 72, 14, 10, 'hsl(48 90% 62%)', 2), R(106, 86, 14, 10, 'hsl(48 90% 62%)', 2), R(86, 110, 16, 12, ROSA, 3), R(70, 92, 14, 10, ROSA, 3)], { tono: 50 });
  F('pizza_vegetariana', 'pizza vegetariana|pizza de verduras|pizza mexicana|pizza margarita|pizza de champinones|pizza cuatro quesos|pizza de queso', () => [P('M96 160L40 50q56-24 112 0z', AMARILLO), P('M40 50q56-24 112 0l-6 12q-50-20-100 0z', DORADO), C(84, 76, 6, VERDE), C(110, 88, 6, ROJO), C(96, 112, 6, VERDE), E(76, 96, 8, 4, 'hsl(30 20% 70%)'), E(106, 72, 8, 4, NEGRO)], { tono: 100 });
  F('pizza_entera', 'pizza familiar|pizza grande|pizza mediana|pizza completa|pizza entera|pizza chica|charola de pizza', () => [C(96, 104, 58, DORADO), C(96, 104, 50, AMARILLO), L('M96 54v100M46 104h100M61 69l70 70M131 69l-70 70', DORADO, 3), ...[[78, 86], [114, 88], [80, 122], [112, 124], [96, 104]].map(([x, y]) => C(x, y, 7, ROJO))], { tono: 20 });
  F('alitas', 'alitas|alitas bbq|alitas buffalo|wings|alitas picantes|alitas de pollo|orden de alitas', () => [E(96, 140, 62, 10, GRIS_CLARO), ...[[70, 110, -0.4], [110, 102, 0.3], [92, 128, 0]].map(([x, y, r]) => E(x, y, 26, 14, 'hsl(14 75% 45%)', r)), R(128, 120, 10, 30, 'hsl(100 50% 70%)', 4)], { tono: 14 });
  F('boneless', 'boneless|boneless bbq|nuggets|nuggets de pollo|tiras de pollo|tenders|pollo empanizado|milanesa de pollo', () => [E(96, 140, 62, 10, GRIS_CLARO), ...[[68, 110], [100, 104], [124, 118], [86, 128], [114, 136]].map(([x, y]) => E(x, y, 18, 13, 'hsl(36 75% 55%)')), C(150, 130, 10, 'hsl(10 60% 50%)')], { tono: 36 });
  F('pollo', 'pollo|pollo asado|pollo rostizado|pierna de pollo|muslo|pechuga|pollo frito|pollo al carbon|medio pollo|pollo entero|pieza de pollo', () => [P('M88 120c-22 10-46-8-40-32s34-36 54-22 22 36 4 48z', 'hsl(30 75% 50%)'), R(96, 116, 14, 36, CREMA, 7), C(104, 156, 9, CREMA), C(116, 150, 9, CREMA), L('M66 84q10-12 24-10', DORADO_CLARO, 5)], { tono: 30 });
  F('carne', 'carne|carne asada|arrachera|filete|bistec|steak|sirloin|rib eye|ribeye|t bone|tbone|new york|corte de carne|cecina|tasajo', () => plato([P('M50 112c0-26 30-40 54-34s38 26 32 42-34 26-56 20-30-10-30-28z', 'hsl(8 55% 38%)'), P('M64 108c4-14 24-22 40-18s22 16 18 26-22 16-36 12-26-8-22-20z', 'hsl(10 60% 50%)'), L('M72 98l34 26M84 92l30 22', 'hsl(8 50% 28%)', 4)]), { tono: 10 });
  F('costillas', 'costillas|costilla|ribs|costillas bbq|chuleta|chuletas|chuleta de cerdo|lomo|pierna de cerdo', () => plato([R(52, 98, 88, 34, 'hsl(14 55% 38%)', 12), ...[66, 86, 106, 126].map(x => R(x, 90, 8, 50, CREMA, 4))]), { tono: 14 });
  F('pescado', 'pescado|mojarra|mojarra frita|filete de pescado|pescado frito|huachinango|tilapia|salmon|pescado empanizado|pescado a la talla|robalo|trucha', () => plato([P('M44 116q40-40 88 0-48 40-88 0z', 'hsl(36 70% 55%)'), P('M128 116l24-18v36z', 'hsl(36 70% 50%)'), C(62, 110, 5, BLANCO), C(62, 110, 2, NEGRO), C(140, 92, 8, VERDE_CLARO)]), { tono: 200 });
  F('camarones', 'camarones|camaron|camarones al mojo|camarones a la diabla|camarones empanizados|brochetas de camaron|camarones al ajillo|langostinos', () => plato([...[[76, 112], [100, 104], [118, 120]].map(([x, y]) => P(`M${x - 14} ${y}q14-22 28 0-8 12-14 8-6-10-14 0z`, 'hsl(14 85% 62%)')), C(140, 96, 8, VERDE_CLARO)]), { tono: 14 });
  F('coctel_camaron', 'coctel de camaron|coctel de mariscos|campechana|vuelve a la vida|coctel de pulpo|coctel', k => [...copa(k, { tipo: 'coctel', liq: 'hsl(8 70% 55%)' }), ...[[80, 70], [108, 66]].map(([x, y]) => P(`M${x - 12} ${y}q12-18 24 0-6 10-12 6-6-8-12 0z`, 'hsl(14 85% 66%)')), E(96, 96, 14, 6, 'hsl(80 50% 60%)')], { tono: 10 });
  F('aguachile', 'aguachile|aguachiles|ceviche|ceviches|ceviche de pescado|ceviche de camaron|leche de tigre|tiradito|callo de hacha', () => plato([E(96, 116, 46, 18, 'hsl(100 50% 55%)'), ...[[80, 112], [104, 108], [94, 122]].map(([x, y]) => P(`M${x - 10} ${y}q10-16 20 0-5 8-10 5-5-7-10 0z`, 'hsl(14 80% 70%)')), C(118, 112, 6, 'hsl(300 40% 55%)'), E(72, 120, 10, 4, 'hsl(120 30% 85%)')], { honda: true }), { tono: 100 });
  F('pulpo', 'pulpo|pulpo a las brasas|pulpo zarandeado|calamar|calamares', () => plato([C(96, 104, 22, 'hsl(330 50% 55%)'), L('M80 118q-10 14-24 12M90 124q-4 16-14 20M102 124q4 16 14 20M112 118q10 14 24 12', 'hsl(330 50% 55%)', 7)]), { tono: 330 });
  F('sushi', 'sushi|sushi roll|roll|rollo de sushi|maki|california roll|philadelphia roll|kushiage|empanizado roll', () => [E(96, 150, 60, 10, GRIS_CLARO), C(66, 112, 26, 'hsl(160 30% 18%)'), C(66, 112, 18, BLANCO), C(66, 112, 8, 'hsl(14 80% 62%)'), C(126, 112, 26, 'hsl(160 30% 18%)'), C(126, 112, 18, BLANCO), E(126, 112, 9, 6, 'hsl(80 50% 60%)')], { tono: 160 });
  F('nigiri', 'nigiri|sashimi|onigiri|temaki|poke|poke bowl|bowl|bowl de arroz', () => [E(96, 150, 60, 10, GRIS_CLARO), R(52, 96, 88, 34, BLANCO, 16), R(48, 82, 96, 22, 'hsl(14 80% 62%)', 11), L('M60 86l12 12M84 84l12 12M108 84l12 12', 'hsl(14 80% 80%)', 3), R(90, 82, 12, 48, 'hsl(160 30% 18%)', 2)], { tono: 14 });
  F('arroz_frito', 'arroz frito|arroz chino|chop suey|chow mein|yakimeshi|teppanyaki|comida china|arroz cantones', () => [P('M54 70h84l-10 86H64z', BLANCO), P('M54 70l10-22h64l10 22z', ROJO), E(96, 70, 40, 10, 'hsl(40 60% 75%)'), ...puntos(VERDE, [[84, 66], [104, 70]], 2), ...puntos(NARANJA, [[94, 64], [112, 66]], 2), L('M120 40l16 40M128 36l12 42', CAFE_CLARO, 3)], { tono: 0 });
  F('arroz', 'arroz|arroz rojo|arroz blanco|arroz a la mexicana|arroz verde|orden de arroz|guarnicion', () => plato([E(96, 112, 42, 18, 'hsl(16 70% 72%)'), ...puntos(BLANCO, [[76, 108], [92, 104], [108, 110], [118, 114], [84, 118], [100, 120]], 2), C(110, 104, 4, VERDE), C(80, 110, 4, NARANJA)]), { tono: 16, empaque: 'arroz_costal' });
  F('frijoles_plato', 'frijoles|frijoles refritos|frijoles charros|frijoles de la olla|frijoles puercos|orden de frijoles', () => plato([E(96, 112, 42, 18, 'hsl(20 40% 28%)'), E(90, 108, 14, 6, 'hsl(40 20% 92%)'), C(110, 108, 5, VERDE)]), { tono: 20, empaque: 'frijol' });
  F('pasta_plato', 'pasta|espagueti|spaghetti|espagueti a la bolonesa|fetuccini|fettuccine|alfredo|pasta alfredo|macarrones|mac and cheese|penne|ravioles|ravioli|pasta a la crema|carbonara', () => plato([E(96, 112, 42, 18, AMARILLO), L('M64 110q12-10 24 0t24 0 24 0M68 118q12-8 24 0t24 0 20 0', 'hsl(44 80% 62%)', 4), C(96, 104, 10, ROJO), C(84, 112, 6, ROJO), E(106, 108, 6, 3, VERDE)], { cubiertos: true }), { tono: 46, empaque: 'pasta_paquete' });
  F('lasana', 'lasana|lasagna|lasagna de carne|canelones|berenjenas a la parmesana', () => plato([R(58, 88, 76, 46, 'hsl(48 70% 72%)', 4), R(58, 96, 76, 6, ROJO), R(58, 110, 76, 6, ROJO), R(58, 124, 76, 6, ROJO), R(58, 86, 76, 8, 'hsl(36 80% 58%)', 4)]), { tono: 16 });
  F('ensalada', 'ensalada|ensaladas|ensalada cesar|ensalada mixta|ensalada verde|ensalada de pollo|ensalada griega|ensalada caprese', () => [P('M40 104h112q-6 52-56 52t-56-52z', BLANCO), C(74, 96, 16, VERDE_CLARO), C(100, 88, 18, VERDE), C(124, 98, 14, VERDE_CLARO), C(88, 100, 7, ROJO), C(116, 92, 6, ROJO), C(104, 104, 6, AMARILLO), R(40, 102, 112, 6, GRIS_CLARO, 3)], { tono: 100 });
  F('huevos', 'huevos|huevos estrellados|huevos al gusto|huevo frito|huevos rancheros|huevos divorciados|desayuno|desayuno completo|huevos con jamon', () => plato([E(78, 112, 26, 18, BLANCO), C(78, 110, 9, AMARILLO), E(116, 116, 24, 16, BLANCO), C(116, 114, 8, AMARILLO), L('M60 128q36 10 72 0', ROJO, 4)]), { tono: 48, empaque: 'huevo_carton' });
  F('huevos_revueltos', 'huevos revueltos|huevo revuelto|huevos a la mexicana|huevo con chorizo|machaca con huevo|omelette|omelet|tortilla de huevo|huevos con tocino', () => plato([P('M56 116q10-24 40-22t40 22q-6 20-40 20t-40-20z', AMARILLO), ...puntos(ROJO, [[80, 110], [104, 106], [96, 120]], 3), ...puntos(VERDE, [[90, 108], [112, 116]], 2)]), { tono: 50 });
  F('molletes', 'molletes|mollete|pan con frijol|bolillo con frijoles', () => plato([E(76, 112, 26, 16, DORADO), E(118, 112, 26, 16, DORADO), E(76, 108, 20, 10, 'hsl(20 40% 30%)'), E(118, 108, 20, 10, 'hsl(48 90% 70%)'), C(70, 104, 4, ROJO), C(124, 106, 4, VERDE)]), { tono: 34 });
  F('papas_francesa', 'papas a la francesa|papas fritas preparadas|orden de papas|papas gajo|papas curly|papas con queso|salchipapas|papas', k => [...[56, 70, 84, 98, 112, 126].map((x, i) => R(x, 36 + (i % 2) * 10, 10, 64, AMARILLO, 3)), P('M50 84h92l-10 76H60z', ROJO), ...etiqueta(70, 104, 52, 34, k.s)], { tono: 4, empaque: 'papas_bolsa' });
  F('aros_cebolla', 'aros de cebolla|onion rings|aros|dedos de queso|banderillas de queso', () => [E(96, 146, 60, 10, GRIS_CLARO), ...[[76, 104], [112, 98], [94, 128]].flatMap(([x, y]) => [C(x, y, 22, 'hsl(36 75% 55%)'), C(x, y, 11, 'var(--fondo-centro, #f3efe6)')])], { tono: 38 });
  F('nachos', 'nachos|nachos con queso|totopos con queso|nachos supremos|chilaquiles de bolsa', () => plato([...[[66, 110], [86, 98], [108, 104], [126, 116], [78, 124], [104, 126]].map(([x, y]) => P(`M${x - 14} ${y + 8}l14-22 14 22z`, AMARILLO)), P('M64 104q32 14 64 0 0 12-32 14t-32-14z', 'hsl(44 95% 58%)'), C(90, 106, 4, VERDE), C(112, 110, 4, ROJO)]), { tono: 46 });
  F('guacamole', 'guacamole|molcajete|salsa molcajeteada|salsa|salsa verde|salsa roja|salsas|queso fundido|chile con queso|frijoles con queso', () => [P('M44 100h104q-6 46-52 46T44 100z', 'hsl(215 10% 35%)'), R(56, 142, 14, 12, 'hsl(215 10% 30%)', 3), R(122, 142, 14, 12, 'hsl(215 10% 30%)', 3), E(96, 100, 52, 12, 'hsl(90 50% 55%)'), C(84, 96, 5, ROJO), C(106, 100, 5, BLANCO), P('M124 92l18-20 6 6z', DORADO)], { tono: 90 });
  F('palomitas', 'palomitas|palomitas de maiz|palomitas mantequilla|palomitas acarameladas|popcorn|palomitas de cine', () => [P('M58 82h76l-10 76H68z', BLANCO), L('M72 82l4 76M96 82v76M120 82l-4 76', ROJO, 8), ...[[66, 76], [84, 66], [104, 64], [124, 74], [76, 56], [96, 50], [116, 56]].map(([x, y]) => C(x, y, 12, 'hsl(48 90% 90%)'))], { tono: 4, empaque: 'palomitas_bolsa' });
  F('platillo', 'platillo|plato fuerte|comida corrida|menu del dia|comida del dia|especialidad de la casa|paquete de comida|orden|combo|comida', k => plato([C(84, 108, 16, k.f), C(110, 116, 14, VERDE_CLARO), C(100, 100, 8, AMARILLO), C(76, 124, 8, ROJO)], { cubiertos: true }));
}

/* ======================================================================
   CATÁLOGO · COMERCIO (abarrotes, botanas, limpieza, cuidado personal,
   farmacia, papelería, ferretería, electrónica, mascotas, hogar)
   ====================================================================== */
const CATALOGO_COMERCIO: Forma[] = [];
{
  const F = (familia: string) => (id: string, claves: string, dibujo: Dibujo, tono?: number) =>
    CATALOGO_COMERCIO.push({ id, claves: claves.split('|'), dibujo, familia, ...(GENERICAS.has(id) ? { generica: true } : {}), ...(tono != null ? { tono } : {}) });
  const A = F('abarrotes'), D = F('dulces y botanas'), LI = F('limpieza'), CP = F('cuidado personal'), FA = F('farmacia');
  const PA = F('papeleria'), FE = F('ferreteria'), EL = F('electronica'), MA = F('mascotas'), HO = F('hogar y otros');
  const granos = (c: string): Trazo[] => [C(84, 104, 5, c), C(96, 100, 5, c), C(108, 106, 5, c), C(90, 116, 5, c), C(102, 118, 5, c)];

  /* --- abarrotes --- */
  A('arroz_costal', 'arroz blanco 1 kg|arroz super extra|arroz morelos|arroz integral|arroz 1 kg|arroz de grano largo', k => costal(k, { c: 'hsl(210 60% 55%)', grano: BLANCO }), 210);
  A('frijol', 'frijol|frijol negro|frijol pinto|frijol bayo|frijol peruano|frijol flor de mayo|frijol 1 kg', k => costal(k, { c: 'hsl(20 40% 40%)', grano: 'hsl(20 40% 25%)' }), 20);
  A('azucar', 'azucar|azucar estandar|azucar refinada|azucar morena|azucar mascabado|piloncillo|endulzante', k => costal(k, { c: 'hsl(200 70% 60%)', grano: 'hsl(200 30% 92%)' }), 200);
  A('sal', 'sal|sal de mesa|sal de grano|sal refinada|sal yodada|sal con ajo', k => [R(70, 48, 52, 112, 'hsl(210 60% 52%)', 8), E(96, 48, 26, 7, METAL), R(84, 38, 24, 12, BLANCO, 3), ...etiqueta(74, 92, 44, 40, BLANCO, 'hsl(210 50% 82%)')], 210);
  A('harina', 'harina|harina de trigo|harina de maiz|masa de maiz|harina para tortillas|maseca|fecula de maiz|maicena|harina preparada', k => costal(k, { c: 'hsl(40 40% 92%)', grano: null as unknown as string }), 40);
  A('avena', 'avena|avena en hojuelas|avena instantanea|granola|amaranto|cereal de avena|salvado', k => costal(k, { c: 'hsl(36 60% 58%)', grano: 'hsl(40 50% 82%)' }), 36);
  A('lenteja', 'lenteja|lentejas|garbanzo|garbanzos|alubia|alubias|haba seca|soya texturizada|semillas', k => costal(k, { c: 'hsl(90 30% 48%)', grano: 'hsl(36 60% 55%)' }), 90);
  A('pasta_paquete', 'pasta para sopa|sopa de pasta|fideo|fideos|codito|coditos|munequitas|estrellitas|letras|spaghetti paquete|espagueti paquete|pasta 200|pasta seca|macarron|tallarines', k => [R(64, 40, 64, 120, 'hsl(0 0% 100% / .7)', 6), ...[74, 86, 98, 110].map(x => R(x, 46, 6, 108, AMARILLO, 3)), ...etiqueta(66, 92, 60, 32, ROJO)], 46);
  A('aceite', 'aceite|aceite vegetal|aceite de oliva|aceite de canola|aceite de cocina|aceite comestible|aceite de girasol|aceite de maiz', k => botella(k, { tipo: 'aceite', liq: 'hsl(48 90% 58%)', tapa: VERDE, etq: VERDE }), 48);
  A('vinagre', 'vinagre|vinagre blanco|vinagre de manzana|jugo sazonador|salsa inglesa|salsa de soya|soya', k => botella(k, { tipo: 'salsa', liq: 'hsl(36 50% 75%)', tapa: CAFE, etq: CREMA }), 36);
  A('salsa_picante', 'salsa picante|salsa valentina|salsa botanera|salsa huichol|chile liquido|salsa habanero|salsa embotellada|salsa de botella', k => botella(k, { tipo: 'salsa', liq: 'hsl(8 75% 45%)', tapa: AMARILLO, etq: AMARILLO }), 8);
  A('catsup', 'catsup|ketchup|salsa de tomate|salsa catsup|bbq|salsa bbq|aderezo|aderezo ranch|aderezo cesar', k => botella(k, { tipo: 'salsa', liq: ROJO, tapa: VERDE, etq: BLANCO }), 4);
  A('mostaza', 'mostaza|mostaza amarilla|salsa de mostaza|miel mostaza', k => botella(k, { tipo: 'salsa', liq: AMARILLO, tapa: ROJO, etq: BLANCO }), 50);
  A('mayonesa', 'mayonesa|mayonesa con limon|mayonesa light|crema de mayonesa', k => frasco(k, { c: 'hsl(48 80% 92%)', tapa: AZUL }), 52);
  A('mermelada', 'mermelada|mermelada de fresa|mermelada de zarzamora|mermelada de durazno|mermelada de pina|jalea|ate|ate de membrillo|ate de guayaba', k => frasco(k, { c: 'hsl(350 70% 45%)', tapa: 'hsl(0 0% 96%)', etq: ROSA }), 350);
  A('miel', 'miel|miel de abeja|miel de maple|jarabe de maple|miel de agave|jarabe de agave', k => [...frasco(k, { c: 'hsl(40 95% 55%)', tapa: 'hsl(30 60% 40%)', etq: null }), P('M80 96l8-6h10l4 6-4 6H88z', 'hsl(40 90% 75%)'), P('M100 112l8-6h10l4 6-4 6h-10z', 'hsl(40 90% 75%)')], 42);
  A('cajeta', 'cajeta|dulce de leche|leche quemada|crema de cacahuate|nutella|crema de avellana|untable', k => frasco(k, { c: 'hsl(26 60% 42%)', tapa: ROJO, etq: CREMA }), 26);
  A('cafe_soluble', 'cafe soluble|cafe instantaneo|nescafe|cafe en polvo|cafe de frasco', k => frasco(k, { c: 'hsl(20 40% 28%)', tapa: ROJO, etq: CREMA }), 22);
  A('cafe_molido', 'cafe molido|cafe en grano 1 kg|cafe de grano molido|cafe tostado|bolsa de cafe|cafe chiapas|cafe veracruz', k => [P('M62 50h68l6 110H56z', 'hsl(20 40% 26%)'), R(62, 42, 68, 14, 'hsl(20 40% 20%)', 3), E(96, 104, 14, 20, 'hsl(28 50% 50%)', 0.3), L('M90 90q8 14 0 28', 'hsl(20 40% 26%)', 3)], 24);
  A('te_caja', 'te en caja|te en sobres|caja de te|te de manzanilla caja|sobres de te|infusiones', k => caja(k, { c: 'hsl(110 40% 50%)', dibujo: [E(96, 110, 16, 10, VERDE_CLARO, -0.4), E(110, 100, 12, 7, VERDE, 0.4)] }), 110);
  A('chocolate_mesa', 'chocolate de mesa|tableta de chocolate|chocolate en tablilla|chocolate en polvo|cocoa en polvo|chocolate para beber', k => [...[0, 1, 2].map(i => C(70 + i * 26, 104, 22, i % 2 ? 'hsl(20 40% 30%)' : 'hsl(20 45% 36%)')), ...[0, 1, 2].map(i => L(`M${70 + i * 26} 86v36M${52 + i * 26} 104h36`, 'hsl(20 40% 24%)', 2))], 22);
  A('cereal', 'cereal|cereales|hojuelas de maiz|corn flakes|cereal de chocolate|cereal integral|zucaritas|cereal de colores', k => caja(k, { c: k.f, dibujo: [P('M70 116q26 30 52 0z', BLANCO), E(96, 112, 22, 6, 'hsl(200 50% 92%)'), ...[[84, 104], [96, 100], [108, 104]].map(([x, y]) => E(x, y, 6, 4, DORADO, 0.4))] }));
  A('galletas_paquete', 'galletas en paquete|paquete de galletas|galletas marias|galletas saladas|galletas de animalitos|galletas surtidas|galletas habaneras|galletas integrales|galletas rellenas|emperador', k => [R(44, 76, 104, 56, k.f, 10), ...[0, 1, 2, 3].map(i => C(64 + i * 22, 104, 18, DORADO_CLARO)), ...etiqueta(56, 116, 80, 18, k.s)]);
  A('sopa_instantanea', 'sopa instantanea|maruchan|sopa de vaso|sopa nissin|ramen instantaneo|sopa maruchan', k => [P('M58 60h76l-10 98H68z', 'hsl(0 0% 98%)'), R(54, 52, 84, 12, ROJO, 4), ...etiqueta(66, 96, 60, 30, ROJO), L('M78 120q8-6 16 0t16 0', AMARILLO, 3)], 4);
  A('atun', 'atun|atun en agua|atun en aceite|atun en lata|lata de atun|atun aleta amarilla', k => lata(k, { c: 'hsl(210 60% 50%)', raya: 'hsl(210 60% 50%)', extra: [P('M84 117q12-10 24 0-12 10-24 0z', 'hsl(210 50% 70%)')] }), 210);
  A('sardina', 'sardina|sardinas|sardinas en tomate|lata de sardinas|ostiones ahumados|anchoas', k => [R(40, 84, 112, 52, METAL, 26), R(46, 90, 100, 40, ROJO, 20), P('M70 110q20-16 40 0-20 16-40 0z', BLANCO), P('M108 110l12-8v16z', BLANCO)], 4);
  A('chiles_lata', 'chiles en lata|chiles en vinagre|chiles jalapenos en lata|rajas en lata|chipotles|chiles chipotle|lata de chiles', k => lata(k, { c: VERDE, raya: VERDE, extra: [P('M80 117q14-12 32 0-16 8-32 0z', 'hsl(110 50% 40%)')] }), 110);
  A('frijoles_lata', 'frijoles en lata|frijoles refritos en lata|frijoles bayos refritos|frijoles enteros|lata de frijoles', k => lata(k, { c: 'hsl(20 40% 35%)', raya: 'hsl(20 40% 35%)', extra: granos('hsl(20 40% 25%)').map(t => ({ ...t, y: (t as { y: number }).y + 13 }) as Trazo) }), 20);
  A('elote_lata', 'elote en lata|granos de elote|maiz dulce|elote dorado|chicharos en lata|verduras en lata|champinones en lata|duraznos en almibar|pina en almibar|coctel de frutas en lata', k => lata(k, { c: AMARILLO, raya: VERDE, extra: granos(AMARILLO).map(t => ({ ...t, y: (t as { y: number }).y + 13 }) as Trazo) }), 50);
  A('leche_condensada', 'leche condensada|leche evaporada|lechera|media crema|crema en lata|leche en polvo|formula infantil|nido', k => lata(k, { c: 'hsl(210 70% 50%)', raya: AZUL, extra: [P('M86 117q10-8 20 0', 'none')] }), 210);
  A('gelatina_polvo', 'gelatina en polvo|polvo para gelatina|sobre de gelatina|flan en polvo|polvo para hornear|levadura|bicarbonato|grenetina|refresco en polvo|polvo para agua|tang', k => sobre(k, { c: k.f, dibujo: [P('M74 120l6-30q16-6 32 0l6 30z', 'hsl(345 70% 60%)'), ...etiqueta(66, 128, 60, 20, k.s)] }));
  A('harina_hotcakes', 'harina para hot cakes|harina para pastel|harina para hotcakes|mezcla para pastel|harina preparada para hot cakes', k => caja(k, { c: 'hsl(45 90% 55%)', dibujo: [E(96, 120, 30, 8, DORADO), E(96, 112, 30, 8, DORADO_CLARO), E(96, 104, 30, 8, DORADO)] }), 46);
  A('consome', 'consome de pollo|consome en polvo|caldo de pollo en polvo|cubitos|consomate|knorr|sazonador|caldo de tomate', k => caja(k, { c: 'hsl(48 90% 55%)', ancha: true, dibujo: [R(62, 100, 28, 28, BLANCO, 4), R(98, 100, 28, 28, BLANCO, 4), C(76, 114, 6, VERDE), C(112, 114, 6, NARANJA)] }), 48);
  A('especias', 'especias|pimienta|oregano|comino|canela|canela en raja|clavo de olor|laurel|paprika|ajo en polvo|condimento|sazonador en polvo|chile en polvo|tajin|chile piquin', k => [R(76, 40, 40, 22, ROJO, 6), R(70, 60, 52, 98, 'hsl(0 0% 96%)', 10), R(74, 96, 44, 54, 'hsl(16 70% 48%)', 6), ...etiqueta(74, 72, 44, 22, ROJO)], 16);
  A('pan_molido', 'pan molido|empanizador|harina para empanizar|tostadas molidas', k => [P('M62 50h68l6 110H56z', 'hsl(36 60% 55%)'), ...etiqueta(66, 92, 60, 40, k.s)], 36);
  A('tortillas_paquete', 'tortillas de harina paquete|tortillas en paquete|paquete de tortillas|tortillinas|tortillas de harina 10|tortillas integrales', k => [P('M44 120q0-14 52-14t52 14v20q0 10-52 10T44 140z', 'hsl(0 0% 100% / .75)'), E(96, 118, 50, 12, 'hsl(48 70% 82%)'), E(96, 126, 50, 12, 'hsl(48 60% 76%)'), ...etiqueta(70, 132, 52, 14, ROJO)], 48);
  A('tostadas_paquete', 'tostadas en paquete|paquete de tostadas|tostadas horneadas|totopos en bolsa|tostadas charras', k => [R(46, 60, 100, 96, 'hsl(0 0% 100% / .7)', 10), C(96, 108, 40, DORADO), C(96, 108, 32, 'hsl(40 80% 66%)'), ...etiqueta(66, 132, 60, 18, ROJO)], 40);
  A('huevo_carton', 'huevo|huevo blanco|huevo rojo|cartera de huevo|kilo de huevo|huevos 12|huevo 18 piezas|huevo 30 piezas|tapa de huevo', () => [R(40, 104, 112, 44, GRIS_CLARO, 10), E(64, 100, 14, 18, CREMA), E(96, 96, 14, 18, 'hsl(30 60% 82%)'), E(128, 100, 14, 18, CREMA), R(40, 118, 112, 30, 'hsl(215 16% 74%)', 10)], 36);
  A('queso', 'queso|queso panela|queso fresco|queso manchego|queso chihuahua|queso cotija|queso amarillo|queso crema|queso para fundir|queso gouda|queso cheddar|queso de cabra', () => [P('M40 132h110V98L40 70z', 'hsl(48 90% 70%)'), P('M40 70l110 28-30-28z', 'hsl(48 90% 82%)'), C(70, 110, 7, 'hsl(44 80% 60%)'), C(110, 118, 5, 'hsl(44 80% 60%)'), C(130, 108, 4, 'hsl(44 80% 60%)')], 48);
  A('queso_oaxaca', 'queso oaxaca|quesillo|queso de hebra|bola de queso|mozzarella', () => [C(96, 104, 46, 'hsl(48 50% 94%)'), L('M60 90q36-24 72 0M56 106q40-24 80 0M62 122q34-22 68 0', 'hsl(48 30% 80%)', 4), P('M126 70q14-10 20 6', 'hsl(48 50% 94%)')], 48);
  A('jamon', 'jamon|jamon de pavo|jamon de pierna|jamon virginia|salami|pepperoni rebanado|mortadela|carnes frias|pechuga de pavo|queso de puerco', () => [C(96, 112, 46, 'hsl(350 60% 78%)'), C(96, 112, 38, 'hsl(350 70% 84%)'), C(88, 104, 6, 'hsl(350 50% 92%)'), C(108, 120, 4, 'hsl(350 50% 92%)'), C(96, 70, 40, 'hsl(350 60% 72%)'), C(96, 70, 32, 'hsl(350 70% 82%)')], 350);
  A('salchicha', 'salchicha|salchichas|salchicha de pavo|salchicha viena|salchichon|frankfurt', () => [...[0, 1, 2].map(i => R(48, 72 + i * 24, 96, 20, 'hsl(10 60% 62%)', 10)), L('M60 76h70M60 100h70M60 124h70', 'hsl(10 50% 72%)', 2)], 10);
  A('chorizo', 'chorizo|chorizos|longaniza|chistorra|chorizo de pavo|chorizo verde|moronga', () => [P('M40 110q20-40 56-20 36 20 56-20', 'none'), L('M40 112q22-40 56-20t56-20', 'hsl(4 60% 42%)', 26), L('M68 96l6 10M96 104l6-10M124 92l6 10', 'hsl(4 50% 58%)', 3), L('M38 114l-8 8M154 72l8-8', CAFE, 3)], 4);
  A('tocino', 'tocino|tocineta|bacon|panceta|chicharron de cerdo', () => [L('M40 80q20-14 40 0t40 0 30 0', 'hsl(4 60% 52%)', 18), L('M40 80q20-14 40 0t40 0 30 0', 'hsl(20 60% 85%)', 5), L('M40 120q20-14 40 0t40 0 30 0', 'hsl(4 60% 52%)', 18), L('M40 120q20-14 40 0t40 0 30 0', 'hsl(20 60% 85%)', 5)], 4);
  A('mantequilla', 'mantequilla|margarina|mantequilla sin sal|barra de mantequilla|manteca|manteca vegetal', () => [P('M40 110l26-30h86l-26 30z', 'hsl(48 90% 82%)'), R(40, 110, 86, 34, 'hsl(48 90% 72%)', 2), P('M126 110l26-30v34l-26 30z', 'hsl(48 80% 62%)')], 50);
  A('crema', 'crema|crema acida|crema agria|crema de rancho|crema entera|crema para batir|vasito de crema|jocoque seco', k => [P('M58 66h76l-8 90H66z', BLANCO), R(54, 58, 84, 14, k.f, 5), ...etiqueta(66, 96, 60, 34, k.s)]);
  A('yogur', 'yogur|yoghurt|yogurt|yogur natural|yogur griego|yogurt de fresa|petit suisse|danonino|vaso de yogurt', k => [P('M60 70h72l-8 86H68z', 'hsl(330 60% 90%)'), R(56, 62, 80, 14, 'hsl(330 60% 70%)', 5), C(96, 112, 14, ROSA_FUERTE), C(90, 108, 4, 'rgba(255,255,255,.5)')], 330);
  A('pure_tomate', 'pure de tomate|salsa para pasta|salsa de tomate en caja|tomate rojo en cubos|salsa para espagueti|pasta de tomate', k => [R(64, 46, 64, 112, ROJO, 6), R(64, 46, 64, 12, 'hsl(4 60% 40%)', 6), C(96, 104, 18, 'hsl(4 80% 60%)'), P('M90 86l6-6 6 6z', VERDE)], 4);
  A('pan_caja_bolsa', 'pan de caja bolsa|bolsa de pan|pan rebanado|pan para sandwich|bollos para hamburguesa|medias noches|pan para hot dog', k => [R(44, 66, 104, 90, 'hsl(0 0% 100% / .7)', 26), R(52, 74, 88, 76, DORADO, 22), R(58, 82, 76, 62, CREMA, 16), R(44, 130, 104, 12, ROJO)], 36);
  A('semillas_bolsa', 'cacahuates|cacahuate|cacahuate salado|cacahuates japoneses|pepitas|semillas de girasol|nueces|nuez|almendras|pistaches|mix de nueces|arandanos secos|pasas|frutos secos', k => bolsa(k, { c: 'hsl(30 60% 50%)', ventana: [E(84, 104, 10, 14, 'hsl(32 60% 70%)', 0.4), E(104, 100, 10, 14, 'hsl(32 60% 70%)', -0.4), E(96, 116, 10, 14, 'hsl(32 60% 70%)', 0.2)] }), 30);

  /* --- dulces y botanas --- */
  D('papas_bolsa', 'papas fritas|papitas|papas de bolsa|papas sabritas|papas sal|papas adobadas|papas con chile|papas fuego|chips|papas onduladas', k => bolsa(k, { c: k.f }));
  D('chicharron_harina', 'chicharron|chicharrones|chicharron de harina|duros|durito|rueditas|churritos|cheetos|frituras|frituras de maiz|botana', k => bolsa(k, { c: 'hsl(16 80% 52%)', ventana: [R(78, 92, 36, 12, 'hsl(30 80% 62%)', 6), R(84, 108, 30, 12, 'hsl(30 80% 62%)', 6), C(104, 104, 6, 'hsl(16 80% 52%)')] }), 16);
  D('totopos_bolsa', 'totopos|tortilla chips|nachos de bolsa|doritos|tostitos|totopos con chile', k => bolsa(k, { c: 'hsl(4 70% 50%)', ventana: [P('M78 112l12-20 12 20z', DORADO), P('M96 106l12-20 12 20z', 'hsl(36 85% 58%)')] }), 4);
  D('palomitas_bolsa', 'palomitas de microondas|bolsa de palomitas|palomitas para microondas', k => [R(56, 50, 80, 110, BLANCO, 6), R(56, 50, 80, 22, ROJO, 6), ...[[76, 104], [96, 96], [116, 104], [86, 120], [106, 120]].map(([x, y]) => C(x, y, 10, 'hsl(48 90% 88%)'))], 4);
  D('chocolate_barra', 'chocolate|chocolates|barra de chocolate|chocolate con leche|chocolate amargo|chocolate blanco|tableta|snickers|carlos v|kit kat|chocolate con almendras', () => [R(48, 60, 96, 92, 'hsl(20 45% 30%)', 6), ...[0, 1, 2].flatMap(i => [0, 1].map(j => R(56 + j * 44, 66 + i * 28, 36, 22, 'hsl(20 45% 38%)', 3))), P('M48 110l96-40v82H48z', ROJO)], 20);
  D('bombones', 'bombones|caja de chocolates|chocolates finos|trufas|bombon|ferrero|chocolates rellenos', k => [R(42, 78, 108, 70, k.f, 10), ...[[64, 102], [96, 102], [128, 102], [64, 128], [96, 128], [128, 128]].map(([x, y]) => C(x, y, 11, 'hsl(20 45% 32%)')), L('M42 92h108', k.o, 6)]);
  D('paleta_dulce', 'paleta de caramelo|paleta de dulce|chupa chups|tutsi pop|paleta enchilada|vero mango|paleta de chile|caramelo macizo', () => [R(92, 104, 8, 58, BLANCO, 3), C(96, 76, 34, ROSA_FUERTE), L('M96 76m-24 0a24 24 0 1 1 48 0a16 16 0 1 1-32 0a8 8 0 1 1 16 0', 'hsl(330 80% 85%)', 4)], 330);
  D('chicle', 'chicle|chicles|goma de mascar|trident|clorets|chicle bomba|bubbaloo', k => [R(48, 76, 96, 52, k.f, 8), ...[0, 1, 2, 3].map(i => R(54 + i * 22, 84, 18, 36, BLANCO, 4))]);
  D('gomitas', 'gomitas|gomita|panditas|ositos de goma|lombrices|gusanitos de goma|gomitas enchiladas|dulces de goma|mangos enchilados', () => [...[[70, 92, ROJO], [98, 84, VERDE_CLARO], [124, 96, AMARILLO], [80, 124, NARANJA], [110, 124, MORADO]].map(([x, y, c]) => [C(x as number, (y as number) - 12, 9, c as string), E(x as number, (y as number) + 4, 13, 15, c as string)]).flat()], 340);
  D('malvaviscos', 'malvaviscos|malvavisco|bombones de azucar|marshmallow|nubes', () => [...[[70, 96, BLANCO], [100, 88, 'hsl(340 80% 88%)'], [126, 104, BLANCO], [84, 124, 'hsl(340 80% 88%)'], [114, 128, BLANCO]].map(([x, y, c]) => R((x as number) - 16, (y as number) - 14, 32, 28, c as string, 10))], 340);
  D('mazapan', 'mazapan|mazapanes|mazapan de cacahuate|dulce de cacahuate|palanqueta|palanquetas|alegria|alegrias|obleas|cocada|cocadas|dulces tipicos|dulce tipico', () => [C(96, 106, 46, 'hsl(36 60% 72%)'), C(96, 106, 38, 'hsl(36 50% 80%)'), ...[[80, 96], [104, 92], [112, 114], [86, 120]].map(([x, y]) => C(x, y, 3, 'hsl(30 40% 60%)')), P('M50 100l-14-14v40z', ROJO), P('M142 100l14-14v40z', ROJO)], 36);
  D('tamarindo', 'tamarindo dulce|pulparindo|dulce de tamarindo|chamoy|salsa chamoy|miguelito|lucas|polvo enchilado|dulces enchilados', k => [R(52, 64, 88, 76, 'hsl(25 50% 40%)', 30), ...[[76, 92], [100, 88], [116, 104], [86, 116]].map(([x, y]) => C(x, y, 5, 'hsl(4 70% 50%)'))], 25);
  D('caramelo', 'dulce|dulces|caramelo|caramelos|bolsa de dulces|dulce suelto|dulces surtidos|chiclosos|glorias|duvalin|dulces de piñata', k => [P('M60 100L32 76v48z', k.o), P('M132 100l28-24v48z', k.o), E(96, 100, 42, 32, k.f), L('M80 88q16-14 32 0', 'rgba(255,255,255,.75)', 6)]);
  D('nieve_vaso', 'nieve en vaso|vaso de nieve|helado de vasito|cono de nieve|bolita de nieve', () => helado([ROSA], { vaso: true }), 340);

  /* --- limpieza --- */
  LI('detergente_polvo', 'detergente|detergente en polvo|jabon en polvo|ariel|roma|foca|detergente 1 kg|jabon para ropa', k => [R(48, 50, 96, 110, k.f, 8), R(48, 50, 96, 20, k.o, 8), C(96, 112, 26, BLANCO), L('M80 112q16-14 32 0', AZUL_CLARO, 4), ...[[82, 98], [110, 102], [100, 126]].map(([x, y]) => C(x, y, 5, AZUL_CLARO))]);
  LI('detergente_liquido', 'detergente liquido|jabon liquido para ropa|detergente para ropa liquido|persil|mas color', k => galon(k, { c: 'hsl(210 70% 50%)' }), 210);
  LI('cloro', 'cloro|blanqueador|clorox|cloralex|hipoclorito|cloro 1 litro|cloro gel', k => galon(k, { c: 'hsl(0 0% 98%)', tapa: AZUL }), 200);
  LI('suavizante', 'suavizante|suavitel|downy|suavizante de telas|fabuloso|pinol|limpiador de pisos|limpiador multiusos|aromatizante de piso|desinfectante liquido|limpiador|limpiador liquido', k => galon(k, { c: 'hsl(280 55% 65%)' }), 280);
  LI('lavatrastes', 'lavatrastes|jabon lavatrastes|lavaplatos|axion|salvo|jabon para trastes|jabon para platos|jabon liquido de trastes', k => [R(84, 30, 24, 16, k.o, 4), R(88, 22, 8, 10, k.o, 2), P('M68 46h56l6 108q0 8-8 8H70q-8 0-8-8z', 'hsl(110 55% 50%)'), ...etiqueta(70, 90, 52, 36, BLANCO), C(96, 108, 7, 'hsl(110 55% 50%)')], 110);
  LI('aerosol', 'aerosol|desinfectante en aerosol|lysol|aromatizante|aromatizante ambiental|insecticida|raid|baygon|repelente|aerosol de limpieza|glade|desodorante ambiental', k => [R(78, 26, 36, 14, k.o, 4), R(86, 18, 20, 10, k.o, 3), R(68, 40, 56, 120, k.f, 14), ...etiqueta(70, 82, 52, 44, k.s), L('M128 30l16-8M130 38l18 0M128 46l16 8', GRIS_CLARO, 3)]);
  LI('esponja', 'esponja|esponjas|fibra|fibras|fibra verde|esponja para trastes|scotch brite|estropajo|zacate|fibra metalica', () => [R(44, 70, 104, 56, AMARILLO, 10), R(44, 112, 104, 26, VERDE, 8), ...[[64, 86], [90, 92], [116, 84], [128, 100]].map(([x, y]) => C(x, y, 4, 'hsl(46 80% 72%)'))], 50);
  LI('escoba_producto', 'escoba|escobas|escoba de plastico|escobeta|cepillo de piso|recogedor|jalador|jalador de agua|mechudo', k => [L('M120 30L90 104', CAFE_CLARO, 7), P('M76 100l34 12-14 46-46-18z', k.f), L('M66 132l30 12M60 146l30 12', k.o, 3)]);
  LI('trapeador', 'trapeador|trapeadores|mop|mopa|cabeza de trapeador|trapo|trapos|franela|jerga|paño', () => [L('M96 28v86', CAFE_CLARO, 7), R(70, 108, 52, 12, AZUL, 4), ...[0, 1, 2, 3, 4, 5].map(i => L(`M${72 + i * 9} 120q-4 20 2 38`, 'hsl(200 30% 92%)', 6))], 200);
  LI('cubeta', 'cubeta|cubetas|balde|tina|tina de plastico|bote de basura|cesto de basura|contenedor', k => [P('M50 74h92l-10 84H60z', k.f), E(96, 74, 46, 10, k.o), L('M52 76q44-60 88 0', GRIS, 4), R(56, 96, 80, 8, 'rgba(255,255,255,.3)')]);
  LI('bolsas_basura', 'bolsas para basura|bolsa de basura|bolsas negras|rollo de bolsas|bolsa jumbo|bolsas de plastico|bolsas para desperdicio', () => [P('M60 160q-10-60 20-90l-8-24 16 10 8-18 8 18 16-10-8 24q30 30 20 90z', NEGRO), L('M80 70q16 6 32 0', GRIS, 4), L('M74 100q10 30 6 56', 'hsl(215 10% 30%)', 3)], 215);
  LI('guantes', 'guantes|guantes de latex|guantes de hule|guantes de limpieza|guantes de nitrilo|guantes desechables|guantes de trabajo', () => [P('M60 160v-56q0-10 8-10V58q0-8 7-8t7 8v34-44q0-8 8-8t8 8v44-40q0-8 8-8t8 8v44-30q0-8 7-8t7 8v66q0 30-20 50z', 'hsl(48 90% 58%)'), R(56, 148, 64, 14, 'hsl(48 80% 48%)', 4)], 50);
  LI('papel_higienico', 'papel higienico|papel de bano|rollo de papel|papel sanitario|paquete de papel|papel higienico 4 rollos|papel higienico 12 rollos|petalo|regio', () => [C(74, 80, 22, BLANCO), C(74, 80, 7, 'hsl(200 30% 85%)'), C(118, 80, 22, BLANCO), C(118, 80, 7, 'hsl(200 30% 85%)'), C(74, 126, 22, BLANCO), C(74, 126, 7, 'hsl(200 30% 85%)'), C(118, 126, 22, BLANCO), C(118, 126, 7, 'hsl(200 30% 85%)'), R(50, 97, 92, 12, AZUL, 4)], 200);
  LI('servilletas', 'servilletas|servilleta|panuelos|panuelos desechables|kleenex|toallas de papel|toalla de cocina|papel de cocina|rollo de cocina|toallas interdobladas', k => [R(46, 92, 100, 58, k.f, 6), P('M70 92q4-30 26-30t26 30z', BLANCO), L('M80 76q16-8 32 0', 'hsl(200 30% 88%)', 3)]);
  LI('jabon_barra_ropa', 'jabon de barra|jabon zote|jabon para lavar|jabon de lavanderia|jabon de pasta|jabon neutro para ropa|jabon de coco', () => [R(42, 80, 108, 58, 'hsl(330 70% 72%)', 18), R(52, 88, 88, 42, 'hsl(330 70% 80%)', 12), E(96, 109, 24, 9, BLANCO)], 330);

  /* --- cuidado personal --- */
  CP('shampoo', 'shampoo|champu|shampoo anticaspa|shampoo para cabello|acondicionador|crema para peinar|enjuague para cabello|tratamiento capilar en botella|keratina en botella', k => [R(80, 26, 32, 18, k.o, 6), P('M64 44h64q8 0 8 10v100q0 8-8 8H64q-8 0-8-8V54q0-10 8-10z', k.f), ...etiqueta(64, 88, 64, 42, k.s)]);
  CP('jabon_tocador', 'jabon|jabon de tocador|jabon corporal|jabon de baño|jabon antibacterial de barra|jabon dove|jabon palmolive|jabon escudo', () => [R(46, 80, 100, 62, 'hsl(195 70% 70%)', 22), R(56, 88, 80, 46, 'hsl(195 70% 80%)', 16), E(96, 111, 22, 9, BLANCO), C(132, 66, 8, BLANCO), C(146, 54, 5, BLANCO), C(124, 50, 4, BLANCO)], 195);
  CP('jabon_liquido', 'jabon liquido|jabon de manos|jabon liquido para manos|gel antibacterial|antibacterial|gel desinfectante|sanitizante de manos', k => [R(90, 24, 10, 26, k.o, 3), R(90, 24, 34, 8, k.o, 3), R(80, 48, 32, 14, k.o, 4), R(64, 60, 64, 100, 'hsl(330 60% 75%)', 16), ...etiqueta(70, 96, 52, 34, BLANCO)], 330);
  CP('pasta_dental', 'pasta dental|crema dental|dentifrico|colgate|pasta de dientes|pasta para dientes', () => [R(36, 82, 100, 40, BLANCO, 8), R(36, 82, 100, 14, ROJO, 8), R(134, 92, 18, 22, AZUL, 4), L('M48 108h60', AZUL, 4), P('M44 126h86l-10 16H54z', 'hsl(200 30% 90%)')], 4);
  CP('cepillo_dental', 'cepillo dental|cepillo de dientes|cepillos dentales|cepillo interdental', () => [R(40, 100, 112, 14, 'hsl(200 70% 55%)', 7), R(44, 70, 30, 30, BLANCO, 4), ...[0, 1, 2, 3].map(i => R(48 + i * 7, 70, 4, 30, 'hsl(200 70% 82%)', 2))], 200);
  CP('hilo_dental', 'hilo dental|enjuague bucal|listerine|enjuague|colutorio|blanqueador dental', () => [R(78, 30, 36, 20, AZUL, 6), P('M64 50h64l6 104q0 8-8 8H66q-8 0-8-8z', 'hsl(160 60% 55%)'), ...etiqueta(68, 92, 56, 36, BLANCO)], 160);
  CP('desodorante', 'desodorante|antitranspirante|desodorante en barra|desodorante roll on|desodorante en aerosol|rexona|axe|speed stick|old spice', k => [R(76, 30, 40, 22, k.o, 8), R(70, 50, 52, 110, k.f, 12), ...etiqueta(72, 88, 48, 40, k.s)]);
  CP('crema_corporal', 'crema corporal|crema hidratante|crema para manos|crema para cara|crema facial|nivea|vaselina|crema de concha nacar|lubriderm|locion corporal', k => [R(46, 96, 100, 52, k.f, 10), E(96, 96, 50, 12, k.o), R(46, 74, 100, 26, k.o, 10), ...etiqueta(62, 112, 68, 22, k.s)]);
  CP('bloqueador', 'bloqueador|bloqueador solar|protector solar|filtro solar|bronceador|crema solar|spf', () => [R(82, 136, 28, 24, NARANJA, 4), P('M62 34h68l-18 104H80z', AMARILLO), C(96, 76, 16, NARANJA), L('M96 52v-8M74 62l-6-6M118 62l6-6', NARANJA, 3)], 46);
  CP('rastrillo', 'rastrillo|rastrillos|navaja de afeitar|maquina de afeitar|gillette|espuma de afeitar|gel de afeitar|after shave', () => [R(90, 70, 12, 90, 'hsl(200 70% 50%)', 6), R(60, 42, 72, 30, 'hsl(200 70% 50%)', 8), R(64, 48, 64, 8, METAL, 2), R(64, 60, 64, 6, METAL, 2)], 200);
  CP('toallas_femeninas', 'toallas femeninas|toalla femenina|toallas sanitarias|protectores diarios|tampones|kotex|saba|always|copa menstrual', k => [R(46, 60, 100, 96, 'hsl(300 50% 75%)', 10), E(96, 108, 22, 32, BLANCO), E(96, 108, 12, 22, 'hsl(300 50% 90%)'), R(46, 60, 100, 16, 'hsl(300 50% 62%)', 8)], 300);
  CP('panales', 'panales|panal|panales para bebe|panal etapa|huggies|kleenbebe|absorsec|panal desechable|panales para adulto|calzon desechable', () => [P('M48 64h96v30q0 40-48 56-48-16-48-56z', BLANCO), R(48, 64, 96, 14, 'hsl(200 70% 70%)', 4), C(76, 104, 6, 'hsl(48 90% 70%)'), C(116, 104, 6, 'hsl(48 90% 70%)')], 200);
  CP('toallitas', 'toallitas|toallitas humedas|toallitas para bebe|toallas humedas|toallitas desmaquillantes|toallitas antibacteriales', () => [R(42, 82, 108, 62, 'hsl(200 60% 78%)', 14), R(72, 74, 48, 22, 'hsl(200 60% 60%)', 8), P('M82 74q14-20 28 0', BLANCO)], 200);
  CP('perfume', 'perfume|perfumes|loción|locion|colonia|fragancia|eau de toilette|body mist|splash', () => [R(84, 28, 24, 22, DORADO, 4), R(90, 48, 12, 10, METAL, 2), R(56, 58, 80, 96, 'hsl(300 40% 80%)', 18), R(56, 58, 80, 96, 'rgba(255,255,255,.25)', 18), R(76, 92, 40, 26, BLANCO, 4)], 300);
  CP('gel_cabello', 'gel|gel para cabello|gel fijador|cera para cabello|pomada para cabello|spray para cabello|mousse para cabello|ego|moco de gorila', k => [R(52, 82, 88, 70, k.f, 14), R(48, 66, 96, 22, k.o, 10), ...etiqueta(64, 104, 64, 30, k.s)]);
  CP('algodon', 'algodon|algodones|cotonetes|hisopos|bolitas de algodon|discos desmaquillantes', () => [R(56, 60, 80, 96, 'hsl(200 50% 85%)', 10), ...[[76, 92], [100, 88], [116, 108], [84, 118], [104, 128]].map(([x, y]) => C(x, y, 14, BLANCO))], 200);
  CP('labial', 'labial|labiales|lapiz labial|brillo labial|maquillaje|base de maquillaje|rimel|mascara de pestanas|delineador|sombras|rubor|polvo compacto|corrector de ojeras|esmalte de unas|quitaesmalte|acetona', () => [R(80, 96, 32, 62, 'hsl(330 30% 30%)', 4), R(84, 80, 24, 20, DORADO, 3), P('M84 80V54q12-16 24-6v30z', ROSA_FUERTE)], 330);
  CP('tinte_cabello', 'tinte|tinte para cabello|tinte de cabello|decolorante|agua oxigenada para cabello|peroxido|coloracion|tinte permanente|retoque de raiz', k => [R(52, 46, 88, 112, k.f, 8), C(96, 92, 26, 'hsl(28 50% 40%)'), P('M72 92q24-50 48 0', 'hsl(28 50% 30%)'), ...etiqueta(62, 126, 68, 22, k.s)]);

  /* --- farmacia --- */
  FA('pastillas', 'pastillas|tabletas|medicamento|medicina|paracetamol|ibuprofeno|aspirina|naproxeno|analgesico|antibiotico|amoxicilina|antigripal|omeprazol|loratadina|antihistaminico|diclofenaco|metformina|losartan|medicamento generico|caja de medicamento', k => [R(46, 66, 100, 76, 'hsl(200 30% 92%)', 10), ...[[66, 90], [96, 90], [126, 90], [66, 120], [96, 120], [126, 120]].map(([x, y]) => E(x, y, 11, 9, BLANCO)), L('M58 104h76', 'hsl(200 20% 80%)', 2)], 200);
  FA('capsulas', 'capsulas|capsula|vitaminas|vitamina c|multivitaminico|suplemento|omega 3|complejo b|hierro|calcio|colageno|probioticos|frasco de pastillas', k => [...frasco(k, { c: 'hsl(36 80% 58%)', tapa: BLANCO, etq: null }), R(70, 92, 52, 40, BLANCO, 5), ...[[84, 112, ROJO], [108, 112, AMARILLO]].map(([x, y, c]) => E(x as number, y as number, 10, 6, c as string, 0.5))], 36);
  FA('jarabe', 'jarabe|jarabe para la tos|suspension oral|antiacido liquido|melox|pepto|ambroxol|jarabe infantil', k => [R(80, 28, 32, 18, BLANCO, 4), P('M70 46h52l6 12v94q0 8-8 8H72q-8 0-8-8V58z', 'hsl(24 70% 42%)'), ...etiqueta(66, 88, 60, 40, k.s), R(118, 108, 26, 12, 'hsl(0 0% 100% / .8)', 3)], 24);
  FA('suero_oral', 'suero oral|electrolitos orales|vida suero oral|electrolit|suero en botella|suero de sabor|suerox', k => [R(84, 22, 24, 14, k.o, 4), P('M70 36h52v14q8 6 8 16v86q0 8-8 8H70q-8 0-8-8V66q0-10 8-16z', 'hsl(330 60% 70%)'), ...etiqueta(66, 96, 60, 36, BLANCO), L('M88 114h16M96 106v16', ROJO, 4)], 330);
  FA('gotas', 'gotas|gotas para ojos|gotas oftalmicas|lagrimas artificiales|gotas para oido|gotas nasales|spray nasal|aceite esencial|gotero', k => botella(k, { tipo: 'gotero', liq: 'hsl(200 60% 70%)', tapa: BLANCO, etq: AZUL }), 200);
  FA('pomada', 'pomada|unguento|gel para dolor|crema antibiotica|crema para rozaduras|pomada de la campana|vick|vaporub|crema para hongos|desitin|bepanthen', k => [R(36, 84, 100, 34, 'hsl(200 60% 92%)', 8), P('M136 92h12v18h-12z', ROJO), R(36, 84, 30, 34, AZUL, 8), L('M84 100h12M90 94v12', ROJO, 4)], 200);
  FA('vendas', 'vendas|venda|venda elastica|gasas|gasa|cinta microporosa|cinta medica|micropore|esparadrapo|curitas|curita|banditas|apositos|parches', () => [R(40, 76, 112, 48, 'hsl(28 60% 75%)', 24), R(76, 82, 40, 36, BLANCO, 8), ...[[86, 92], [98, 92], [86, 106], [98, 106], [110, 98]].map(([x, y]) => C(x, y, 2, 'hsl(28 40% 70%)'))], 28);
  FA('termometro', 'termometro|termometro digital|baumanometro|oximetro|glucometro|tiras reactivas|nebulizador|aparato de presion', () => [R(84, 30, 24, 108, BLANCO, 12), R(90, 70, 12, 64, ROJO, 6), C(96, 140, 18, ROJO), L('M108 50h8M108 66h8M108 82h8M108 98h8', GRIS, 2)], 0);
  FA('cubrebocas', 'cubrebocas|cubreboca|mascarilla|tapabocas|cubrebocas kn95|n95|caretas', () => [L('M50 84q-22 16 0 40M142 84q22 16 0 40', 'hsl(200 30% 80%)', 4), P('M50 80q46-12 92 0v48q-46 16-92 0z', 'hsl(200 70% 85%)'), L('M56 96h80M56 110h80', 'hsl(200 50% 72%)', 3)], 200);
  FA('alcohol', 'alcohol|alcohol etilico|alcohol de caña|alcohol desnaturalizado|agua oxigenada|isodine|antiseptico|merthiolate|alcohol 70|alcohol en gel', k => botella(k, { liq: 'hsl(200 50% 92%)', tapa: AZUL, etq: AZUL }), 200);
  FA('inhalador', 'inhalador|salbutamol|ventolin|broncodilatador|aerocamara|spray para asma', () => [R(76, 40, 34, 84, 'hsl(200 70% 55%)', 10), P('M76 118h56q8 0 8 8v14q0 8-8 8H76z', 'hsl(200 70% 45%)'), R(84, 30, 18, 14, METAL, 3)], 200);
  FA('jeringa', 'jeringa|jeringas|aguja|insulina|inyeccion|aplicacion de inyeccion|vacuna aplicada', () => [R(44, 92, 88, 22, 'hsl(200 50% 92%)', 4), R(52, 96, 50, 14, 'hsl(200 60% 70%)', 2), R(132, 98, 12, 10, METAL, 2), L('M144 103h16', METAL, 2), R(28, 88, 10, 30, GRIS_CLARO, 2), R(36, 99, 16, 8, GRIS_CLARO, 2)], 200);
  FA('prueba', 'prueba de embarazo|prueba rapida|prueba covid|prueba de antigeno|preservativos|condones|lubricante|anticonceptivo', k => [R(52, 70, 88, 70, k.f, 10), R(70, 92, 52, 26, BLANCO, 6), C(86, 105, 5, k.o), C(106, 105, 5, k.o)]);

  /* --- papelería --- */
  PA('cuaderno', 'cuaderno|cuadernos|cuaderno profesional|cuaderno forma francesa|cuaderno de cuadro|cuaderno de raya|libreta|libretas|block|bitacora|agenda', k => [R(52, 40, 88, 120, k.f, 6), ...[54, 72, 90, 108, 126, 144].map(y => C(52, y, 5, METAL)), ...etiqueta(72, 64, 52, 26, k.s)]);
  PA('libro', 'libro|libros|libro de texto|novela|revista|revistas|enciclopedia|libro para colorear|diccionario|cuento', k => [R(52, 46, 86, 112, k.f, 6), R(52, 46, 14, 112, k.o, 6), R(76, 66, 50, 8, BLANCO, 4), R(76, 82, 36, 6, k.s, 3), R(52, 146, 86, 12, BLANCO, 2)]);
  PA('lapiz', 'lapiz|lapices|lapiz del 2|portaminas|lapicero|lapiz adhesivo de colores', () => [R(90, 44, 12, 96, AMARILLO, 2), P('M90 140h12l-6 22z', 'hsl(36 60% 70%)'), P('M94 154h4l-2 8z', NEGRO), R(90, 34, 12, 12, ROSA, 3), R(90, 44, 12, 6, METAL)], 50);
  PA('pluma', 'pluma|plumas|boligrafo|boligrafos|pluma azul|pluma negra|pluma roja|bic|pluma de gel|marcatextos|resaltador', () => [R(88, 30, 16, 110, 'hsl(210 70% 50%)', 6), P('M88 140h16l-8 20z', 'hsl(210 30% 85%)'), R(104, 40, 5, 40, 'hsl(210 70% 40%)', 2), R(88, 30, 16, 20, 'hsl(210 70% 40%)', 6)], 210);
  PA('borrador', 'borrador|goma|goma de borrar|sacapuntas|corrector|liquid paper|cinta correctora', () => [R(48, 84, 96, 42, ROSA, 8), R(48, 84, 42, 42, 'hsl(200 70% 60%)', 8), R(84, 84, 6, 42, 'hsl(200 70% 60%)')], 340);
  PA('regla', 'regla|reglas|escuadra|transportador|juego de geometria|compas', () => [R(36, 82, 120, 34, 'hsl(48 90% 70%)', 4), ...Array.from({ length: 12 }, (_, i) => L(`M${44 + i * 10} 82v${i % 2 ? 8 : 14}`, 'hsl(30 40% 40%)', 2))], 50);
  PA('tijeras_escolares', 'tijeras|tijeras escolares|tijeras de papel|tijeras punta roma|cutter|cuter|navaja de papeleria|exacto', () => [C(70, 136, 18, ROJO), C(70, 136, 9, 'var(--fondo-centro, #f3efe6)'), C(122, 136, 18, ROJO), C(122, 136, 9, 'var(--fondo-centro, #f3efe6)'), P('M78 122l46-88 6 4-40 92z', METAL), P('M114 122L68 34l-6 4 40 92z', GRIS_CLARO)], 4);
  PA('pegamento', 'pegamento|resistol|lapiz adhesivo|pegamento en barra|pritt|silicon liquido|pegamento blanco|kola loka|cola blanca|diamantina|foami', () => [R(76, 40, 40, 22, ROJO, 6), R(70, 60, 52, 98, 'hsl(48 90% 60%)', 10), ...etiqueta(74, 92, 44, 36, ROJO)], 50);
  PA('colores', 'colores|lapices de colores|crayolas|crayones|plumones|marcadores|marcadores de colores|acuarelas|pinturas|gises|plumones de colores', () => [...[ROJO, NARANJA, AMARILLO, VERDE, AZUL, MORADO].map((c, i) => [R(48 + i * 16, 54, 12, 88, c, 2), P(`M${48 + i * 16} 54l6-16 6 16z`, c)]).flat(), R(42, 110, 108, 44, 'hsl(200 60% 55%)', 6)], 200);
  PA('hojas', 'hojas|hojas blancas|paquete de hojas|papel bond|hojas de color|resma|papel carta|papel oficio|hojas de maquina|cartulina|cartulinas|papel crepe|papel china|papel lustre', () => [R(54, 50, 84, 108, 'hsl(200 30% 96%)', 4), R(48, 56, 84, 108, BLANCO, 4), L('M60 80h60M60 96h60M60 112h44', 'hsl(200 30% 85%)', 3)], 200);
  PA('folder', 'folder|folders|carpeta|carpetas|sobre manila|sobre|sobres|archivero|protector de hojas|mica para hojas|clip|clips|grapas|broches', k => [P('M44 66h40l8 10h56v80H44z', k.f), R(44, 84, 104, 72, k.s, 4)]);
  PA('cinta_adhesiva', 'cinta adhesiva|diurex|cinta transparente|cinta canela|cinta de empaque|masking tape|cinta doble cara', () => [C(96, 104, 46, 'hsl(36 60% 70%)'), C(96, 104, 26, 'var(--fondo-centro, #f3efe6)'), P('M140 116h20v10h-24z', 'hsl(36 60% 70%)')], 36);
  PA('calculadora', 'calculadora|calculadora cientifica|calculadora basica', () => [R(54, 34, 84, 128, 'hsl(215 15% 30%)', 10), R(64, 44, 64, 28, 'hsl(100 30% 75%)', 4), ...[0, 1, 2].flatMap(r => [0, 1, 2].map(c => R(66 + c * 22, 84 + r * 24, 16, 16, 'hsl(215 15% 55%)', 3)))], 215);
  PA('mochila', 'mochila|mochilas|backpack|lonchera|loncheras|estuche|lapicera|cartera escolar', k => [R(56, 50, 80, 110, k.f, 22), L('M78 52q18-24 36 0', k.o, 6), R(68, 104, 56, 40, k.o, 10), R(92, 116, 8, 6, METAL, 2)]);
  PA('engrapadora', 'engrapadora|engrapadoras|perforadora|sacagrapas|grapadora', () => [R(40, 118, 112, 18, NEGRO, 6), P('M44 116q0-20 20-24h80q8 2 8 12v12z', ROJO), R(60, 100, 80, 4, METAL)], 4);

  /* --- ferretería --- */
  FE('martillo', 'martillo|martillos|marro|mazo', () => [L('M60 140l52-52', CAFE_CLARO, 12), P('M98 58l26-14 18 18-14 26z', METAL), P('M98 58l-12-4 8 22z', METAL_OSCURO)], 30);
  FE('desarmador', 'desarmador|desarmadores|destornillador|desarmador de cruz|desarmador plano|juego de desarmadores|llave allen', () => [R(84, 30, 24, 60, 'hsl(48 90% 55%)', 10), R(92, 90, 8, 56, METAL, 2), P('M92 146h8l-4 14z', METAL_OSCURO), L('M90 42v36M102 42v36', 'hsl(48 80% 42%)', 2)], 50);
  FE('llave_inglesa', 'llave inglesa|llave de tuercas|llave perica|llaves|juego de llaves|llave stillson|llave de tubo|llave de cruz', () => [L('M62 138l58-58', METAL, 16), P('M110 50q22-6 34 12l-16 4-4 12-12 4-4 16q-18-12-12-34z', METAL), C(60, 140, 12, METAL_OSCURO), C(60, 140, 5, BLANCO)], 210);
  FE('pinzas', 'pinzas|pinza|pinzas de presion|pinzas de corte|alicate|pinzas de electricista|pinzas mecanicas', () => [L('M70 150l20-60M122 150l-20-60', ROJO, 12), P('M88 92l8-56 8 56z', METAL), L('M96 92l-10-50M96 92l10-50', METAL_OSCURO, 6), C(96, 94, 6, METAL_OSCURO)], 4);
  FE('taladro', 'taladro|taladros|rotomartillo|atornillador|taladro inalambrico|esmeriladora|pulidora|sierra electrica|caladora|broca|brocas', () => [R(52, 64, 80, 40, 'hsl(48 90% 52%)', 12), R(132, 76, 16, 14, NEGRO, 3), R(148, 80, 14, 6, METAL, 2), P('M72 104h28l6 52H66z', NEGRO), R(66, 148, 46, 14, 'hsl(48 90% 52%)', 4)], 50);
  FE('tornillos', 'tornillos|tornillo|pijas|taquetes|tuercas|rondanas|birlos|anclas|clavos|clavo|clavos de acero|grapas industriales|remaches', () => [...[[70, 70], [110, 64], [86, 104], [124, 100]].map(([x, y]) => [R(x - 10, y - 8, 20, 8, METAL_OSCURO, 2), R(x - 3, y, 6, 34, METAL, 1), L(`M${x - 3} ${y + 8}l6 4M${x - 3} ${y + 16}l6 4M${x - 3} ${y + 24}l6 4`, METAL_OSCURO, 1.5)]).flat()], 210);
  FE('cinta_metrica', 'cinta metrica|flexometro|metro|cinta de medir|nivel|nivel de burbuja|escuadra de carpintero', () => [R(44, 60, 76, 76, 'hsl(48 90% 55%)', 14), C(82, 98, 20, NEGRO), C(82, 98, 8, 'hsl(48 90% 55%)'), R(120, 120, 44, 12, 'hsl(48 90% 70%)', 2), L('M128 120v6M136 120v6M144 120v6M152 120v6', NEGRO, 1.5)], 50);
  FE('foco', 'foco|focos|foco led|lampara|lamparas|bombilla|foco ahorrador|tira led|reflector|spot', () => [C(96, 78, 38, AMARILLO), C(96, 78, 26, AMARILLO_CLARO), R(80, 110, 32, 10, METAL, 2), R(82, 122, 28, 8, GRIS_CLARO, 2), R(84, 132, 24, 8, METAL, 3), L('M96 26v-6M60 42l-6-6M132 42l6-6', AMARILLO, 4)], 50);
  FE('extension', 'extension|extension electrica|multicontacto|regleta|enchufe|clavija|contacto|apagador|toma corriente|socket', () => [R(36, 92, 120, 36, BLANCO, 8), ...[60, 96, 132].map(x => [L(`M${x - 5} 104v10M${x + 5} 104v10`, NEGRO, 3)]).flat(), L('M36 110q-20 0-20 20t20 20', NEGRO, 4)], 210);
  FE('cable', 'cable|cable electrico|cable calibre|alambre|rollo de cable|cable de cobre|cable duplex|alambre recocido', () => [C(96, 104, 48, ROJO), C(96, 104, 36, 'hsl(4 60% 42%)'), C(96, 104, 16, 'var(--fondo-centro, #f3efe6)'), L('M140 120q20 10 16 36', ROJO, 6)], 4);
  FE('candado', 'candado|candados|chapa|chapas|cerradura|cerrojo|pasador|bisagra|bisagras|chapa de puerta', () => [L('M70 92V70q0-26 26-26t26 26v22', METAL, 10), R(56, 90, 80, 66, 'hsl(48 80% 50%)', 12), C(96, 116, 8, 'hsl(48 60% 30%)'), R(92, 118, 8, 20, 'hsl(48 60% 30%)', 3)], 48);
  FE('brocha', 'brocha|brochas|pincel|pinceles|rodillo para pintar|rodillo|charola para pintar', () => [R(88, 30, 16, 60, CAFE_CLARO, 6), R(80, 88, 32, 16, METAL, 2), P('M76 104h40l4 50H72z', 'hsl(36 50% 70%)'), P('M72 140h48l-2 14H74z', AZUL)], 210);
  FE('pintura', 'pintura|pintura vinilica|pintura de aceite|esmalte|impermeabilizante|sellador|thinner|aguarras|barniz|cubeta de pintura|galon de pintura|pintura en aerosol', k => [P('M50 70h92v80q0 10-10 10H60q-10 0-10-10z', METAL), E(96, 70, 46, 10, GRIS_CLARO), L('M50 72q46-60 92 0', GRIS, 3), R(50, 96, 92, 38, k.f), P('M96 70q-10 20 0 30', k.f)]);
  FE('cinta_aislar', 'cinta de aislar|cinta aislante|silicon|silicon en tubo|pistola de silicon|sellador acrilico|resanador|pasta para resanar', () => [C(96, 104, 44, NEGRO), C(96, 104, 22, 'var(--fondo-centro, #f3efe6)'), C(96, 104, 30, 'hsl(215 10% 25%)'), C(96, 104, 22, 'var(--fondo-centro, #f3efe6)')], 215);
  FE('lija', 'lija|lijas|papel de lija|lija de agua|disco de corte|disco de lija', () => [R(48, 56, 96, 96, 'hsl(28 50% 60%)', 4), ...Array.from({ length: 24 }, (_, i) => C(58 + (i % 6) * 15, 66 + Math.floor(i / 6) * 22, 2, 'hsl(28 40% 40%)'))], 28);
  FE('pilas', 'pila|pilas|baterias|pila aa|pila aaa|pila 9v|pilas recargables|pila de reloj|bateria alcalina|duracell|energizer', () => [R(56, 50, 34, 104, NEGRO, 6), R(66, 40, 14, 12, METAL, 2), R(56, 50, 34, 30, 'hsl(36 90% 55%)', 6), R(102, 50, 34, 104, NEGRO, 6), R(112, 40, 14, 12, METAL, 2), R(102, 50, 34, 30, 'hsl(36 90% 55%)', 6)], 36);
  FE('linterna', 'linterna|linternas|lampara de mano|lampara de mano led|lampara recargable|lampara de mineria', () => [R(54, 84, 72, 34, NEGRO, 8), P('M126 78h20l8-10v66l-8-10h-20z', GRIS), E(156, 101, 4, 30, AMARILLO_CLARO), L('M78 92v18', 'hsl(48 90% 55%)', 6)], 50);
  FE('manguera', 'manguera|mangueras|manguera de jardin|regadera|aspersor|pistola de riego|tubo pvc|tubo de cobre|codo pvc|cople|conexiones', () => [C(96, 104, 46, VERDE), C(96, 104, 34, 'hsl(120 40% 35%)'), C(96, 104, 22, VERDE), C(96, 104, 12, 'var(--fondo-centro, #f3efe6)'), R(134, 132, 28, 12, AMARILLO, 3)], 120);
  FE('serrucho', 'serrucho|segueta|sierra|arco de segueta|hacha|machete|pala|pico|zapapico|carretilla', () => [P('M40 120l90-60 10 14-90 60z', METAL), ...Array.from({ length: 10 }, (_, i) => P(`M${46 + i * 9} ${136 - i * 6}l6 4 2-7z`, METAL_OSCURO)), R(130, 50, 28, 40, ROJO, 8)], 4);
  FE('herramienta', 'herramienta|herramientas|caja de herramientas|kit de herramientas|ferreteria|tlapaleria|material electrico|refaccion|refacciones', k => [R(40, 84, 112, 68, k.f, 8), R(40, 84, 112, 16, k.o, 8), L('M76 84q0-20 20-20t20 20', GRIS, 6), R(88, 104, 16, 10, METAL, 2)]);

  /* --- electrónica y accesorios --- */
  EL('cargador', 'cargador|cargadores|cargador de celular|cargador rapido|eliminador|adaptador de corriente|cargador para auto', () => [R(56, 54, 46, 34, BLANCO, 8), R(66, 40, 8, 16, METAL, 2), R(84, 40, 8, 16, METAL, 2), L('M80 88q0 40 30 40t30 30', BLANCO, 7), R(126, 140, 28, 18, BLANCO, 5)], 210);
  EL('cable_usb', 'cable usb|cable tipo c|cable lightning|cable para iphone|cable micro usb|cable hdmi|cable de datos|cable auxiliar', () => [L('M50 60q60 0 50 50t50 50', 'hsl(215 15% 30%)', 7), R(36, 50, 26, 20, METAL, 4), R(136, 150, 26, 18, METAL, 4)], 215);
  EL('audifonos', 'audifonos|audifono|auriculares|headphones|diadema|audifonos de diadema|manos libres', () => [L('M52 118q0-70 44-70t44 70', 'hsl(215 15% 30%)', 8), R(40, 108, 28, 46, 'hsl(215 15% 30%)', 10), R(124, 108, 28, 46, 'hsl(215 15% 30%)', 10)], 215);
  EL('audifonos_bt', 'audifonos bluetooth|audifonos inalambricos|earbuds|airpods|chicharitos|audifonos tws', () => [R(56, 82, 80, 70, BLANCO, 26), L('M56 104h80', 'hsl(215 15% 85%)', 3), C(96, 128, 4, VERDE), C(76, 70, 10, BLANCO), C(116, 70, 10, BLANCO)], 215);
  EL('bocina', 'bocina|bocinas|bocina bluetooth|bafle|parlante|radio|grabadora', () => [R(52, 46, 88, 112, 'hsl(215 15% 26%)', 14), C(96, 118, 26, 'hsl(215 15% 40%)'), C(96, 118, 12, 'hsl(215 15% 20%)'), C(96, 72, 12, 'hsl(215 15% 40%)')], 215);
  EL('funda_celular', 'funda|fundas|funda de celular|case|protector de celular|mica|micas|mica de cristal|cristal templado|protector de pantalla', k => [R(62, 30, 68, 132, k.f, 16), R(72, 40, 24, 30, 'hsl(215 15% 26%)', 8), C(80, 50, 6, 'hsl(215 15% 40%)'), C(80, 62, 4, 'hsl(215 15% 40%)')]);
  EL('memoria_usb', 'memoria usb|usb|memoria|memoria micro sd|tarjeta de memoria|disco duro|disco externo|pendrive', () => [R(64, 60, 64, 96, 'hsl(215 15% 30%)', 10), R(76, 32, 40, 30, METAL, 3), R(84, 40, 8, 8, 'hsl(215 15% 30%)'), R(100, 40, 8, 8, 'hsl(215 15% 30%)'), C(96, 128, 6, AZUL)], 215);
  EL('recarga', 'recarga|recargas|tiempo aire|recarga telcel|recarga movistar|recarga at&t|paquete de datos|chip|chip telcel|sim|tarjeta sim|pago de servicios|pago de luz|pago de agua', k => [R(52, 40, 88, 120, k.f, 12), R(68, 56, 56, 40, METAL, 6), L('M76 66h40M76 76h40M76 86h40M96 56v40', GRIS, 2), R(64, 116, 64, 10, 'rgba(255,255,255,.5)', 5)]);
  EL('celular_producto', 'celular|celulares|smartphone|telefono celular|telefono|iphone|android|telefono inteligente', () => [R(64, 32, 64, 128, 'hsl(215 14% 18%)', 12), R(70, 44, 52, 100, 'hsl(200 70% 55%)', 4), R(84, 36, 24, 4, GRIS, 2), C(96, 152, 4, GRIS)], 210);
  EL('tablet', 'tablet|tableta electronica|ipad|lector de libros|kindle', () => [R(46, 40, 100, 124, 'hsl(215 14% 18%)', 12), R(54, 50, 84, 104, 'hsl(260 50% 62%)', 4), C(96, 158, 3, GRIS)], 260);
  EL('control', 'control|control remoto|control universal|control de tv|gamepad|control de videojuego|joystick', () => [P('M48 90q0-16 20-16h56q20 0 20 16l8 40q2 16-14 16-10 0-18-14H74q-8 14-18 14-16 0-14-16z', 'hsl(215 15% 30%)'), L('M66 98h20M76 88v20', 'hsl(215 15% 70%)', 4), C(118, 92, 5, ROJO), C(128, 104, 5, VERDE), C(108, 104, 5, AZUL)], 215);

  /* --- mascotas --- */
  MA('croquetas_perro', 'croquetas|croquetas para perro|alimento para perro|comida para perro|dog chow|pedigree|alimento canino|croquetas de cachorro', k => [P('M54 44h84l8 116H46z', k.f), R(54, 36, 84, 14, k.o, 3), C(96, 112, 26, BLANCO), E(96, 120, 14, 12, CAFE), ...[[80, 102], [90, 92], [102, 92], [112, 102]].map(([x, y]) => C(x, y, 5, CAFE))]);
  MA('croquetas_gato', 'croquetas para gato|alimento para gato|comida para gato|whiskas|cat chow|alimento felino|sobre para gato|lata para gato|pate', k => [P('M54 44h84l8 116H46z', 'hsl(280 45% 55%)'), R(54, 36, 84, 14, 'hsl(280 45% 40%)', 3), C(96, 112, 24, BLANCO), P('M80 100l4-14 8 10h8l8-10 4 14z', 'hsl(30 60% 55%)'), C(96, 114, 14, 'hsl(30 60% 55%)')], 280);
  MA('arena_gato', 'arena para gato|arena sanitaria|arena|tapete sanitario|tapete entrenador|bolsas para popo|pañales para perro', k => [R(46, 66, 100, 90, 'hsl(200 50% 60%)', 8), R(46, 66, 100, 18, 'hsl(200 50% 45%)', 8), ...Array.from({ length: 9 }, (_, i) => C(64 + (i % 3) * 32, 104 + Math.floor(i / 3) * 16, 4, 'hsl(36 40% 85%)'))], 200);
  MA('hueso', 'hueso|huesos|premios para perro|juguete para perro|juguete para gato|pelota para perro|mordedera|snacks para mascota|carnaza|dentastix', () => [R(62, 90, 68, 24, CREMA, 8), C(58, 88, 14, CREMA), C(58, 116, 14, CREMA), C(134, 88, 14, CREMA), C(134, 116, 14, CREMA)], 40);
  MA('correa', 'correa|correas|collar|collares|pechera|arnes|placa para mascota|cadena para perro', k => [C(96, 96, 40, k.f), C(96, 96, 30, 'var(--fondo-centro, #f3efe6)'), R(88, 128, 16, 24, METAL, 4), C(96, 156, 8, AMARILLO)]);
  MA('plato_mascota', 'plato para perro|plato para mascota|comedero|bebedero|traste para perro|plato para gato|cama para perro|cama para mascota|transportadora|jaula', k => [P('M44 108h104l-12 40H56z', k.f), E(96, 108, 52, 12, k.o), E(96, 106, 40, 7, CAFE_CLARO), P('M86 136l4-10 6 6 6-6 4 10z', BLANCO)]);
  MA('peces', 'alimento para peces|pecera|peces|pez|acuario|filtro para pecera|alpiste|alimento para aves|semillas para pajaro|jaula para pajaro', () => [R(46, 60, 100, 92, 'hsl(200 75% 80%)', 18), P('M70 104q22-20 40 0-18 20-40 0z', NARANJA), P('M108 104l14-10v20z', NARANJA), C(80, 100, 3, NEGRO), C(120, 78, 4, BLANCO), C(128, 70, 3, BLANCO), R(46, 136, 100, 16, 'hsl(36 50% 70%)', 6)], 200);

  /* --- hogar y otros --- */
  HO('vela', 'vela|velas|veladora|veladoras|cirio|vela aromatica|vela de cumpleanos', () => [R(70, 70, 52, 90, 'hsl(40 60% 92%)', 6), L('M96 70v-10', NEGRO, 3), P('M96 30q14 16 0 30-14-14 0-30z', NARANJA), P('M96 40q6 8 0 16-6-8 0-16z', AMARILLO)], 40);
  HO('cerillos', 'cerillos|fosforos|encendedor|encendedores|mechero|lighter|cerilla', () => [R(60, 76, 72, 80, ROJO, 6), R(66, 84, 60, 18, 'hsl(20 40% 40%)', 3), L('M110 76V40', 'hsl(40 60% 80%)', 5), C(110, 36, 7, ROJO)], 4);
  HO('carbon', 'carbon|carbon vegetal|bolsa de carbon|lena|briquetas|asador|parrilla', () => [P('M54 44h84l8 116H46z', 'hsl(215 10% 30%)'), ...[[80, 112], [104, 104], [96, 126], [114, 124], [76, 132]].map(([x, y]) => P(`M${x - 10} ${y}l6-10h10l6 10-6 10h-10z`, NEGRO)), P('M90 70q10 14 0 26-10-12 0-26z', NARANJA)], 20);
  HO('hielo', 'hielo|bolsa de hielo|hielo en cubos|hielo frappe|cubitos de hielo|hielo 5 kg', () => [P('M56 46h80l8 112H48z', 'hsl(200 70% 85%)'), ...[[76, 96], [104, 92], [88, 120], [114, 122]].map(([x, y]) => R(x - 12, y - 12, 24, 24, 'hsl(200 80% 96%)', 5)), R(56, 46, 80, 12, AZUL, 3)], 200);
  HO('gas', 'gas|tanque de gas|cilindro de gas|gas lp|recarga de gas|gas butano|tanque estacionario', () => [R(56, 56, 80, 104, 'hsl(4 60% 52%)', 30), R(78, 36, 36, 24, METAL, 6), R(86, 28, 20, 10, METAL_OSCURO, 3), R(56, 96, 80, 10, 'hsl(4 50% 40%)')], 4);
  HO('desechables', 'desechables|platos desechables|vasos desechables|cucharas desechables|tenedores desechables|popotes|charolas desechables|contenedores desechables|unicel|papel aluminio|plastico autoadherible|bolsas ziploc', () => [E(70, 128, 34, 10, BLANCO), E(70, 120, 34, 10, 'hsl(200 20% 96%)'), P('M108 60h40l-6 92h-28z', 'hsl(200 30% 92%)'), L('M116 76h24M116 90h24', 'hsl(200 30% 85%)', 2)], 200);
  HO('bolsa_mandado', 'bolsa|bolsa de mandado|bolsa ecologica|bolsa reutilizable|bolsa de tela|bolsa de regalo|envoltura|papel para regalo|mono para regalo|tarjeta de regalo|gift card', k => [L('M74 66q0-26 22-26t22 26', k.o, 6), P('M54 66h84l-8 94H62z', k.f), R(78, 98, 36, 26, 'rgba(255,255,255,.5)', 6)]);
  HO('flores', 'flores|ramo|ramo de flores|rosas|rosa|arreglo floral|girasoles|tulipanes|flor|corona funebre', () => [L('M96 160V96M96 120l-22-18M96 130l22-18', VERDE, 4), ...[[72, 76, ROSA_FUERTE], [96, 64, ROJO], [120, 76, ROSA_FUERTE], [84, 92, ROJO], [110, 92, ROSA]].map(([x, y, c]) => C(x as number, y as number, 14, c as string)), P('M72 160l24-50 24 50z', 'hsl(150 40% 80%)')], 340);
  HO('planta', 'planta|plantas|maceta|macetas|suculenta|cactus|tierra para plantas|abono|fertilizante|semillas para sembrar|vivero', () => [P('M64 112h64l-8 46H72z', 'hsl(16 55% 50%)'), R(60, 106, 72, 12, 'hsl(16 55% 42%)', 3), E(84, 82, 14, 28, VERDE, -0.5), E(108, 82, 14, 28, VERDE, 0.5), E(96, 70, 12, 30, VERDE_CLARO)], 16);
  HO('globo', 'globo|globos|globo metalico|articulos de fiesta|pinata|piñata|vela de numero|serpentina|confeti|decoracion de fiesta', () => [E(80, 78, 26, 32, ROJO), E(114, 70, 24, 30, AZUL), L('M80 110q6 20-4 50M114 100q-4 30 6 60', GRIS, 2), E(72, 66, 6, 10, 'rgba(255,255,255,.4)', 0.4)], 4);
  HO('periodico', 'periodico|periodicos|diario|revista semanal|boletos|loteria|boleto|melate|cupones', () => [R(44, 52, 104, 104, 'hsl(40 20% 94%)', 4), R(54, 62, 84, 14, NEGRO, 2), R(54, 84, 40, 30, GRIS_CLARO, 2), L('M100 86h38M100 98h38M100 110h38M54 124h84M54 136h84', GRIS, 3)], 40);
  HO('ropa', 'ropa|playera|playeras|camisa|camisas|blusa|pantalon|calcetines|calcetas|ropa interior|uniforme|uniformes|sudadera|chamarra|gorra|gorras|sombrero', k => [P('M68 44l-28 22 14 22 12-8v76h60V80l12 8 14-22-28-22q-10 12-28 12t-28-12z', k.f), P('M80 44q16 12 32 0', k.o)]);
  HO('calzado', 'zapatos|zapato|tenis|sandalias|huaraches de piel|botas|chanclas|pantuflas|calzado|zapatillas', k => [P('M36 136v-30q0-10 10-10h30l20 18h40q20 2 20 22H36z', k.f), R(36, 136, 120, 12, BLANCO, 4), L('M80 108l6 6M90 104l6 6', BLANCO, 3)]);
  HO('juguete', 'juguete|juguetes|pelota|balon|muneca|carrito de juguete|peluche|rompecabezas|lego|trompo|yoyo|loteria mexicana|juego de mesa', () => [C(96, 104, 48, ROJO), P('M96 56a48 48 0 0 1 0 96', AMARILLO), P('M56 82h80', 'none'), L('M52 90q44 20 88 0', BLANCO, 6), L('M52 118q44 -20 88 0', BLANCO, 6)], 4);
  HO('cigarro', 'cigarros|cigarro|cajetilla|tabaco|vape|vaporizador|encendedor de cocina', k => [R(58, 56, 76, 100, k.f, 6), R(58, 56, 76, 30, BLANCO, 6), R(70, 40, 10, 22, 'hsl(30 50% 70%)', 2), R(84, 36, 10, 26, 'hsl(30 50% 70%)', 2)]);
  HO('caja_generica', 'producto|articulo|mercancia|varios|otros|miscelaneo|caja', k => caja(k));
}

/* ======================================================================
   CATÁLOGO · SERVICIOS (belleza y barbería, taller automotriz, reparación
   de electrónicos, mantenimiento, salud, educación, gimnasio y otros)
   Cada servicio es una insignia: círculo de color con su herramienta.
   ====================================================================== */
const CATALOGO_SERVICIOS: Forma[] = [];
{
  const S = (familia: string) => (id: string, claves: string, glifo: Dibujo, tono?: number) =>
    CATALOGO_SERVICIOS.push({ id, claves: claves.split('|'), dibujo: k => insignia(k, glifo(k)), familia, ...(tono != null ? { tono } : {}), ...(GENERICAS.has(id) ? { generica: true } : {}) });
  const BE = S('belleza y barberia'), TA = S('taller automotriz'), EL = S('reparacion de electronicos'), MA = S('mantenimiento');
  const SA = S('salud'), ED = S('educacion y deporte'), OT = S('otros servicios');
  const W = BLANCO, OSC = 'hsl(215 20% 22%)';
  const tijeras = (c = W): Trazo[] => [C(76, 134, 14, c), C(76, 134, 7, OSC), C(116, 134, 14, c), C(116, 134, 7, OSC), P('M82 122l36-70 5 3-31 74z', c), P('M110 122L74 52l-5 3 31 74z', c), C(96, 92, 4, OSC)];
  const peine = (x = 72, y = 60, c = W): Trazo[] => [R(x, y, 16, 80, c, 4), ...Array.from({ length: 7 }, (_, i) => R(x + 16, y + 6 + i * 10, 14, 4, c, 2))];

  /* --- belleza y barbería --- */
  BE('corte_cabello', 'corte|corte de cabello|corte de pelo|corte caballero|corte dama|corte nino|corte infantil|corte clasico|corte moderno|fade|degradado|desvanecido|casquete|corte con maquina|corte con tijera|servicio de corte', () => tijeras(), 200);
  BE('barba', 'barba|arreglo de barba|perfilado de barba|afeitado|rasurado|afeitado clasico|toalla caliente|bigote|corte y barba|ritual de barba', () => [R(62, 100, 52, 16, W, 8), P('M110 100h28q6 0 6 6v4q0 6-6 6h-28z', METAL), L('M114 112h28', OSC, 2), C(72, 108, 4, OSC), P('M60 72q36-22 72 0', 'none'), L('M64 74q32-20 64 0', W, 6)], 30);
  BE('maquina_cortar', 'maquina|corte a maquina|rapado|rapado completo|delineado|diseno en cabello|grabado|line up|contorno', () => [R(76, 52, 40, 92, W, 12), R(76, 52, 40, 14, METAL, 4), ...Array.from({ length: 5 }, (_, i) => R(80 + i * 7, 44, 4, 10, METAL, 1)), C(96, 104, 8, 'hsl(4 70% 55%)')], 210);
  BE('peinado', 'peinado|peinados|peinado de fiesta|recogido|trenzas|trenza|ondas|planchado de cabello|secado|brushing|cepillado|blower', () => [...peine(58, 56), P('M110 70q30 10 30 40t-30 40', 'none'), L('M112 64q28 14 24 46t-28 40', W, 8)], 330);
  BE('tinte_servicio', 'tinte|tinte de cabello|aplicacion de tinte|color|coloracion|mechas|rayitos|luces|balayage|babylights|decoloracion|matiz|matizado|retoque de tinte|color fantasia', () => [P('M60 108h72q-4 34-36 34t-36-34z', W), E(96, 108, 36, 8, 'hsl(320 60% 55%)'), R(112, 50, 8, 56, W, 3), P('M108 50h16l-2 14h-12z', 'hsl(320 60% 55%)')], 320);
  BE('alaciado', 'alaciado|alaciado permanente|keratina|botox capilar|tratamiento capilar|hidratacion capilar|nanoplastia|cirugia capilar|permanente|ondulado permanente|tratamiento de cabello', () => [R(56, 70, 80, 18, W, 8), R(56, 96, 80, 18, METAL, 8), R(130, 72, 16, 40, W, 6), L('M68 130q8 20 0 30M84 130q8 20 0 30M100 130q8 20 0 30', W, 4)], 30);
  BE('lavado_cabello', 'lavado de cabello|lavado|lavado y secado|shampoo y peinado|masaje capilar', () => [C(96, 96, 30, W), ...[[70, 70], [120, 72], [84, 56], [110, 54], [62, 100], [130, 100]].map(([x, y]) => C(x, y, 8, 'rgba(255,255,255,.7)')), L('M76 136q20 14 40 0', W, 6)], 200);
  BE('unas', 'unas|manicure|pedicure|manicura|pedicura|unas acrilicas|acrilico|gelish|esmaltado|esmaltado permanente|unas de gel|polygel|retiro de acrilico|nail art|decoracion de unas|uñas', () => [R(84, 40, 24, 46, OSC, 6), R(80, 82, 32, 10, W, 3), R(62, 90, 68, 70, 'hsl(330 70% 60%)', 18), R(72, 102, 10, 46, 'rgba(255,255,255,.35)', 5)], 330);
  BE('pestanas', 'pestanas|extension de pestanas|lifting de pestanas|rizado de pestanas|pestanas pelo a pelo|enchinado|tinte de pestanas', () => [P('M52 104q44-40 88 0', 'none'), L('M52 104q44-40 88 0', W, 6), ...[60, 72, 84, 96, 108, 120, 132].map((x, i) => L(`M${x} ${100 - Math.abs(i - 3) * -2 - 16 + Math.abs(i - 3) * 4}l${(i - 3) * 3} -16`, W, 3)), E(96, 112, 20, 10, W)], 300);
  BE('cejas', 'cejas|diseno de cejas|depilacion de cejas|laminado de cejas|microblading|microshading|henna|planchado de cejas|depilacion con hilo', () => [L('M50 100q30-30 64-14', W, 10), L('M120 90q14 4 22 14', W, 6), E(92, 128, 22, 10, W), C(92, 128, 6, OSC)], 30);
  BE('depilacion', 'depilacion|depilacion con cera|cera|depilacion laser|depilacion de axilas|depilacion de piernas|depilacion de bigote|bikini|depilacion completa', () => [R(60, 60, 72, 26, W, 6), P('M70 86h52l-4 70H74z', 'hsl(40 80% 65%)'), L('M96 86v-40', W, 5), E(96, 42, 12, 8, W)], 40);
  BE('facial', 'facial|limpieza facial|tratamiento facial|hidrafacial|peeling|dermapen|mascarilla facial|exfoliacion|limpieza profunda|radiofrecuencia|microdermoabrasion', () => [E(96, 100, 34, 44, W), C(82, 92, 6, 'hsl(140 50% 70%)'), C(110, 92, 6, 'hsl(140 50% 70%)'), L('M84 120q12 8 24 0', 'hsl(140 50% 60%)', 4), E(70, 70, 10, 6, 'hsl(140 50% 70%)', 0.4)], 140);
  BE('maquillaje_servicio', 'maquillaje profesional|maquillaje de fiesta|maquillaje de novia|maquillaje social|maquillaje artistico|automaquillaje|maquillaje de noche', () => [R(62, 98, 22, 56, OSC, 6), R(64, 70, 18, 30, 'hsl(340 70% 60%)', 8), P('M64 70q9-18 18 0z', 'hsl(340 70% 60%)'), R(110, 104, 14, 50, CAFE_CLARO, 6), P('M104 104q13-60 26 0z', W), R(104, 98, 26, 8, METAL, 2)], 340);
  BE('masaje', 'masaje|masajes|masaje relajante|masaje descontracturante|masaje terapeutico|masaje de piedras|piedras calientes|reflexologia|drenaje linfatico|masaje reductivo|masaje deportivo|spa|dia de spa|aromaterapia|sauna|vapor', () => [E(96, 142, 46, 11, OSC), E(96, 124, 36, 10, 'hsl(215 15% 45%)'), E(96, 108, 28, 9, OSC), E(102, 66, 28, 12, VERDE_CLARO, -0.6), L('M88 82q16-14 30-28', W, 3)], 150);
  BE('novia', 'paquete de novia|peinado y maquillaje|paquete xv anos|quinceañera|paquete de belleza|dia de novia', () => [P('M96 50l12 26 28 4-20 20 4 28-24-14-24 14 4-28-20-20 28-4z', W), C(96, 92, 8, 'hsl(330 70% 70%)')], 330);
  BE('tatuaje', 'tatuaje|tatuajes|tattoo|piercing|perforacion|perforaciones|arete|micropigmentacion|retoque de tatuaje', () => [R(60, 88, 64, 22, W, 8), R(124, 94, 24, 10, METAL, 3), L('M148 99h14', OSC, 2), R(44, 92, 18, 14, OSC, 4), C(76, 99, 4, OSC)], 0);

  /* --- taller automotriz --- */
  TA('afinacion', 'afinacion|afinacion mayor|afinacion menor|servicio de motor|mantenimiento preventivo|servicio de mantenimiento|servicio automotriz|bujias|bujia|cambio de bujias|carburador|inyectores|limpieza de inyectores', () => [L('M62 138l58-58', W, 14), P('M110 50q22-6 34 12l-16 4-4 12-12 4-4 16q-18-12-12-34z', W), C(60, 140, 11, W), C(60, 140, 5, OSC)], 210);
  TA('cambio_aceite', 'cambio de aceite|aceite y filtro|aceite de motor|filtro de aceite|lubricacion|engrase|cambio de filtro|aceite sintetico', () => [P('M60 66h56l20 20v62q0 8-8 8H60q-8 0-8-8V74q0-8 8-8z', W), R(110, 48, 18, 22, W, 3), P('M96 92q12 16 0 26-12-10 0-26z', 'hsl(40 90% 50%)')], 40);
  TA('frenos', 'frenos|balatas|cambio de balatas|rectificado de discos|discos de freno|liquido de frenos|ajuste de frenos|tambores', () => [C(96, 104, 46, W), C(96, 104, 30, OSC), C(96, 104, 10, W), P('M128 66q26 20 22 56l-14-4q2-28-16-40z', 'hsl(4 70% 55%)')], 4);
  TA('llantas', 'llanta|llantas|neumatico|neumaticos|ponchadura|ponchaduras|reparacion de llanta|vulcanizadora|parche de llanta|cambio de llanta|rin|rines|valvula|aire para llantas', () => [C(96, 104, 52, OSC), C(96, 104, 32, METAL), C(96, 104, 12, W), L('M96 72v64M64 104h64M74 82l44 44M118 82l-44 44', W, 3)], 215);
  TA('alineacion', 'alineacion|balanceo|alineacion y balanceo|alineacion 3d|rotacion de llantas|suspension|amortiguadores|terminales|rotulas|horquillas|direccion hidraulica', () => [C(66, 120, 22, OSC), C(126, 120, 22, OSC), C(66, 120, 8, W), C(126, 120, 8, W), L('M66 120h60', W, 5), L('M44 70h104M96 58v24', 'hsl(48 90% 60%)', 5)], 48);
  TA('bateria_auto', 'bateria|acumulador|bateria de auto|cambio de bateria|carga de bateria|paso de corriente|alternador|marcha|motor de arranque', () => [R(52, 70, 88, 70, W, 8), R(64, 58, 16, 14, OSC, 3), R(112, 58, 16, 14, OSC, 3), L('M66 100h12M72 94v12M114 100h12', OSC, 4)], 210);
  TA('lavado_auto', 'lavado de auto|lavado de carro|autolavado|lavado exterior|lavado interior|lavado completo|lavado de motor|encerado|pulido|detallado|detallado automotriz|aspirado|lavado de tapiceria|lavado de vestiduras|polish', () => [P('M40 128v-18q0-8 8-10l16-22q6-8 14-8h36q10 0 16 8l16 22q10 2 10 10v18z', W), P('M74 82h18v18H66zM100 82h18l10 18h-28z', 'hsl(200 70% 75%)'), C(66, 130, 12, OSC), C(126, 130, 12, OSC), ...[[60, 54, 8], [138, 48, 10], [150, 70, 5], [44, 70, 5]].map(([x, y, r]) => C(x, y, r, 'rgba(255,255,255,.75)'))], 200);
  TA('hojalateria', 'hojalateria|pintura automotriz|hojalateria y pintura|enderezado|pintura de auto|reparacion de golpes|sacar golpes|pulido de faros|restauracion de faros', () => [R(56, 60, 56, 70, W, 8), P('M112 74l30-14v52l-30-14z', W), R(76, 130, 16, 20, OSC, 4), ...[[150, 66], [156, 86], [150, 104]].map(([x, y]) => C(x, y, 4, 'rgba(255,255,255,.8)'))], 4);
  TA('electrico_auto', 'electrico automotriz|sistema electrico|luces de auto|faros|cambio de focos|stereo|instalacion de stereo|alarma|alarmas|polarizado|cristales de auto|parabrisas', () => [P('M106 40L64 108h28l-8 52 46-72H100z', 'hsl(48 90% 60%)'), P('M106 40L64 108h12l30-62z', W)], 48);
  TA('aire_auto', 'aire acondicionado automotriz|carga de gas|recarga de aire|clima de auto|compresor|radiador|anticongelante|sistema de enfriamiento|termostato|bomba de agua|mangueras de radiador', () => [L('M96 52v104M52 78l88 52M52 130l88-52', W, 7), C(96, 104, 10, OSC)], 195);
  TA('escaneo', 'escaneo|escaner|diagnostico|diagnostico por computadora|check engine|luz de motor|revision general|revision|verificacion|pre verificacion|inspeccion', () => [R(58, 52, 76, 100, W, 10), R(66, 62, 60, 40, 'hsl(140 50% 55%)', 4), L('M70 84l10-10 10 14 12-18 14 12', W, 3), C(80, 124, 6, OSC), C(112, 124, 6, OSC)], 140);
  TA('clutch', 'clutch|embrague|transmision|caja de velocidades|cambio de clutch|suspension trasera|mofle|escape|catalizador|motor|ajuste de motor|reparacion de motor|juntas|empaques', () => [C(96, 104, 44, W), ...[0, 45, 90, 135, 180, 225, 270, 315].map(a => R(96 + Math.cos(a * Math.PI / 180) * 44 - 7, 104 + Math.sin(a * Math.PI / 180) * 44 - 7, 14, 14, W, 3)), C(96, 104, 18, OSC)], 210);
  TA('grua', 'grua|servicio de grua|arrastre|auxilio vial|mecanico a domicilio|corralon', () => [R(44, 92, 76, 40, W, 6), R(120, 104, 32, 28, W, 6), L('M64 92l40-40 20 0', W, 5), L('M124 52v20', W, 3), C(66, 136, 12, OSC), C(130, 136, 12, OSC)], 30);

  /* --- reparación de electrónicos --- */
  EL('reparacion_celular', 'reparacion de celular|reparacion de celulares|celular|cambio de pantalla|pantalla|display|cambio de display|centro de carga|cambio de centro de carga|cambio de bateria de celular|bateria de celular|liberacion|desbloqueo|cuenta google|flasheo|software de celular|celular mojado', () => [R(66, 34, 60, 124, OSC, 12), R(72, 46, 48, 96, 'hsl(200 70% 60%)', 4), L('M82 70l28 28M110 70l-12 12', W, 3), R(84, 38, 24, 4, W, 2)], 200);
  EL('reparacion_laptop', 'laptop|computadora|reparacion de computadora|reparacion de laptop|formateo|formateo de pc|instalacion de windows|windows|virus|eliminacion de virus|limpieza de computadora|mantenimiento de pc|cambio de disco|ssd|memoria ram|teclado de laptop|bisagra de laptop|respaldo de informacion|recuperacion de datos', () => [R(52, 54, 88, 62, OSC, 8), R(58, 60, 76, 50, 'hsl(260 50% 62%)', 3), P('M40 120h112l-8 16H48z', W), R(84, 120, 24, 4, OSC, 2)], 260);
  EL('reparacion_tv', 'television|tv|pantalla de tv|reparacion de tv|reparacion de pantalla de tv|consola|xbox|playstation|nintendo|reparacion de consola|control de consola|proyector|reparacion de electrodomesticos|microondas|licuadora|plancha', () => [R(42, 52, 108, 72, OSC, 8), R(48, 58, 96, 60, 'hsl(30 80% 60%)', 3), R(88, 124, 16, 16, W), R(70, 140, 52, 8, W, 4)], 30);
  EL('reparacion_impresora', 'impresora|reparacion de impresora|cartuchos|recarga de cartuchos|tinta|toner|recarga de toner|sistema de tinta continua', () => [R(48, 78, 96, 50, W, 8), R(64, 54, 64, 28, 'hsl(200 30% 92%)', 3), R(64, 120, 64, 30, 'hsl(200 30% 96%)', 3), C(126, 94, 5, 'hsl(140 60% 50%)'), L('M74 132h44M74 140h30', GRIS, 2)], 200);
  EL('soporte_tecnico', 'soporte tecnico|soporte|redes|instalacion de red|internet|wifi|router|modem|camaras de seguridad|cctv|instalacion de camaras|configuracion|asesoria tecnica|programacion|pagina web|desarrollo web', () => [L('M60 90q36-30 72 0M72 106q24-18 48 0M84 122q12-8 24 0', W, 7), C(96, 138, 7, W)], 210);

  /* --- mantenimiento --- */
  MA('plomeria', 'plomeria|plomero|fuga|fugas|reparacion de fuga|destape|destape de drenaje|drenaje|tuberia|tuberias|tinaco|limpieza de tinaco|cisterna|boiler|calentador|instalacion de calentador|llave de agua|mezcladora|wc|taza de bano|lavabo', () => [P('M96 44q36 48 36 72a36 36 0 0 1-72 0q0-24 36-72z', 'hsl(200 80% 70%)'), E(82, 116, 7, 12, 'rgba(255,255,255,.5)', 0.3)], 200);
  MA('electricidad', 'electricista|electricidad|instalacion electrica|cableado|corto circuito|contactos|apagadores|centro de carga electrico|pastillas electricas|lamparas instalacion|instalacion de lamparas|tierra fisica|medidor', () => [P('M106 40L62 110h30l-10 50 48-74h-32z', 'hsl(48 95% 60%)')], 48);
  MA('clima', 'aire acondicionado|minisplit|clima|instalacion de clima|mantenimiento de clima|recarga de gas refrigerante|refrigeracion|refrigerador|reparacion de refrigerador|congelador|camara fria|enfriador|ventilador', () => [L('M96 50v108M50 77l92 54M50 131l92-54', W, 7), L('M84 58l12 12 12-12M84 150l12-12 12 12', W, 4)], 195);
  MA('lavadora_servicio', 'lavadora|reparacion de lavadora|secadora|reparacion de secadora|centro de lavado|lavavajillas|estufa|reparacion de estufa|horno|campana', () => [R(58, 44, 76, 112, W, 10), R(58, 44, 76, 18, 'hsl(215 15% 82%)', 8), C(96, 108, 28, 'hsl(200 50% 70%)'), C(96, 108, 18, 'hsl(200 70% 85%)'), C(118, 53, 4, OSC)], 200);
  MA('limpieza_servicio', 'limpieza|servicio de limpieza|limpieza de casa|limpieza de oficina|limpieza profunda de casa|aseo|aseo domestico|limpieza de alfombras|lavado de salas|lavado de colchones|limpieza de vidrios|limpieza post obra', () => [L('M124 34L92 108', CAFE_CLARO, 7), P('M76 102l36 14-14 46-48-18z', W), ...[[126, 116], [138, 102], [140, 130]].map(([x, y]) => C(x, y, 5, 'rgba(255,255,255,.8)'))], 280);
  MA('fumigacion', 'fumigacion|fumigar|control de plagas|exterminio|cucarachas|termitas|chinches|ratas|desinsectacion|sanitizacion|sanitizar', () => [R(60, 70, 40, 80, W, 10), R(70, 52, 20, 20, W, 4), L('M90 60h40l14 10', W, 5), ...[[150, 60], [158, 76], [148, 88]].map(([x, y]) => C(x, y, 4, 'rgba(255,255,255,.7)'))], 140);
  MA('pintura_servicio', 'pintura|pintor|pintar casa|pintura de interiores|pintura de fachada|impermeabilizacion|impermeabilizar|resane|resanes|tirol|yeso|tablaroca|plafon', () => [R(48, 50, 80, 30, W, 10), L('M128 64h12v28H92v22', W, 6), R(86, 114, 12, 42, CAFE_CLARO, 5)], 30);
  MA('cerrajeria', 'cerrajeria|cerrajero|apertura de puertas|apertura de autos|duplicado de llaves|copia de llaves|cambio de chapa|cambio de combinacion|chapa|chapas|llaves|llave|cajas fuertes', () => [L('M72 92V72q0-24 24-24t24 24v20', W, 9), R(58, 90, 76, 62, W, 10), C(96, 114, 7, OSC), R(92, 116, 8, 18, OSC, 3)], 48);
  MA('jardineria', 'jardineria|jardinero|poda|poda de arboles|corte de pasto|pasto|pasto sintetico|mantenimiento de jardin|riego|sistema de riego|paisajismo|plantas de ornato', () => [P('M54 144q-6-74 86-92 6 84-86 92z', W), L('M58 140q28-42 76-80', 'hsl(120 40% 50%)', 4), L('M88 104l-4-20M104 90l14 4', 'hsl(120 40% 50%)', 3)], 120);
  MA('carpinteria', 'carpinteria|carpintero|muebles|reparacion de muebles|closets|cocinas integrales|puertas de madera|barniz de muebles|tapiceria|retapizado|ebanisteria', () => [P('M40 120l90-60 10 14-90 60z', W), ...Array.from({ length: 9 }, (_, i) => P(`M${46 + i * 9} ${136 - i * 6}l6 4 2-7z`, 'hsl(215 15% 70%)')), R(130, 50, 26, 38, CAFE_CLARO, 8)], 30);
  MA('albanileria', 'albanileria|albanil|construccion|obra|remodelacion|remodelaciones|piso|colocacion de piso|azulejo|loseta|barda|bardas|firme|colado|losa|mamposteria', () => [...[0, 1, 2].flatMap(r => [0, 1, 2].map(c => R(48 + c * 34 + (r % 2) * 16, 64 + r * 26, 30, 22, r % 2 ? 'hsl(10 50% 60%)' : W, 3))), P('M120 140l30-30 8 8-30 30z', METAL)], 10);
  MA('herreria', 'herreria|herrero|soldadura|soldador|puertas de herreria|zaguan|protecciones|rejas|portones|estructuras metalicas|canceleria|aluminio|vidrios|vidrieria|cristales|ventanas|espejos', () => [R(52, 46, 88, 112, 'none' as string, 0), ...[60, 82, 104, 126].map(x => R(x, 50, 8, 108, W, 3)), R(52, 60, 88, 8, W, 3), R(52, 132, 88, 8, W, 3), ...[[64, 54], [86, 54], [108, 54], [130, 54]].map(([x, y]) => P(`M${x - 6} ${y}l6-14 6 14z`, W))], 215);
  MA('mantenimiento', 'mantenimiento|mantenimiento general|reparacion|reparaciones|reparacion general|servicio tecnico|tecnico|instalacion|instalaciones|servicio a domicilio|mano de obra|visita tecnica|diagnostico a domicilio|chamba|handyman', () => [L('M62 138l58-58', W, 12), P('M110 50q22-6 34 12l-16 4-4 12-12 4-4 16q-18-12-12-34z', W), L('M60 60l72 72', 'hsl(48 90% 60%)', 10), R(52, 52, 18, 18, 'hsl(48 90% 60%)', 4)], 48);
  MA('gas_servicio', 'gas natural|instalacion de gas|fuga de gas|tuberia de gas|conexion de gas|regulador de gas|estufa de gas', () => [P('M96 40q34 34 34 64a34 34 0 0 1-68 0q0-30 34-64z', 'hsl(210 80% 62%)'), P('M96 74q18 18 18 34a18 18 0 0 1-36 0q0-16 18-34z', 'hsl(200 90% 80%)')], 210);

  /* --- salud --- */
  SA('consulta', 'consulta|consulta medica|consulta general|medico|medico general|doctor|revision medica|certificado medico|valoracion|chequeo|chequeo general|consulta pediatrica|pediatra|ginecologia|ginecologo|especialista|consulta de especialidad|telemedicina', () => [R(84, 56, 24, 88, W, 4), R(52, 88, 88, 24, W, 4)], 0);
  SA('dental', 'dental|dentista|odontologia|limpieza dental|resina|resinas|extraccion|extraccion dental|muela|endodoncia|ortodoncia|brackets|blanqueamiento|blanqueamiento dental|corona dental|protesis dental|implante dental|placa dental|guarda', () => [P('M64 54q32-14 64 0 14 20 4 50-6 34-14 54-10 4-14-20-4-18-8 0-6 24-14 20-8-20-14-54-10-30 4-50z', W)], 195);
  SA('laboratorio', 'laboratorio|analisis|analisis clinicos|examen de sangre|biometria|quimica sanguinea|examen general de orina|prueba de glucosa|perfil tiroideo|toma de muestra|antidoping|estudios de laboratorio|rayos x|ultrasonido|radiografia|tomografia', () => [R(86, 40, 20, 18, W, 3), P('M86 56h20v28l26 50q4 12-10 12H70q-14 0-10-12l26-50z', W), P('M74 120h44l8 14q2 8-6 8H72q-8 0-6-8z', 'hsl(340 70% 60%)')], 340);
  SA('fisioterapia', 'fisioterapia|terapia fisica|rehabilitacion|terapia de lenguaje|terapia ocupacional|quiropractico|osteopatia|acupuntura|electroterapia|ultrasonido terapeutico|vendaje neuromuscular', () => [C(96, 56, 12, W), L('M96 70v40M96 110l-18 36M96 110l18 36M70 84h52', W, 9)], 160);
  SA('nutricion', 'nutricion|nutriologo|nutriologa|plan de alimentacion|dieta|consulta de nutricion|control de peso|medicion corporal|bioimpedancia', () => [C(84, 112, 34, 'hsl(4 70% 58%)'), C(110, 112, 34, 'hsl(4 70% 58%)'), R(94, 56, 5, 24, CAFE, 2), E(114, 64, 14, 7, VERDE, -0.5), E(78, 100, 7, 12, 'rgba(255,255,255,.35)', 0.4)], 4);
  SA('psicologia', 'psicologia|psicologo|psicologa|terapia|terapia psicologica|terapia de pareja|terapia familiar|terapia infantil|coaching|orientacion|tanatologia|sesion de terapia', () => [P('M60 110q-8-50 36-56 46 0 40 46-4 18-14 26v20H76v-16q-14-8-16-20z', W), P('M90 80q10-10 20 0t-10 20q-10 6-10 12', 'none'), L('M88 82q10-12 22-2', 'hsl(270 50% 60%)', 4)], 270);
  SA('optica', 'optica|lentes|examen de la vista|examen visual|graduacion|lentes de contacto|armazon|armazones|micas para lentes|optometrista|anteojos', () => [C(68, 104, 24, W), C(124, 104, 24, W), C(68, 104, 16, 'hsl(200 60% 75%)'), C(124, 104, 16, 'hsl(200 60% 75%)'), L('M92 102q4-6 8 0M44 98l-10-10M148 98l10-10', W, 4)], 200);
  SA('veterinaria', 'veterinaria|veterinario|consulta veterinaria|vacuna|vacunas|vacuna antirrabica|desparasitacion|esterilizacion|castracion|estetica canina|bano canino|corte canino|bano de perro|pension canina|guarderia canina|hospital veterinario|mascota|paseo de perros|entrenamiento canino', () => [E(96, 120, 28, 24, W), E(64, 86, 11, 15, W, -0.3), E(84, 70, 11, 15, W, -0.1), E(108, 70, 11, 15, W, 0.1), E(128, 86, 11, 15, W, 0.3)], 30);
  SA('enfermeria', 'enfermeria|enfermera|aplicacion de inyecciones|inyecciones|curaciones|curacion|toma de presion|presion arterial|suero|aplicacion de suero|cuidado de enfermos|cuidador|retiro de puntos|sutura', () => [R(44, 92, 88, 22, W, 4), R(52, 96, 50, 14, 'hsl(200 60% 70%)', 2), R(132, 98, 12, 10, W, 2), L('M144 103h16', W, 2), R(28, 88, 10, 30, W, 2)], 200);
  SA('estetica_medica', 'botox|toxina botulinica|rellenos|acido hialuronico|bichectomia|lipo|liposuccion|hilos tensores|mesoterapia|plasma|tratamiento corporal|cavitacion|reductivo|reafirmante', () => [R(72, 60, 48, 76, W, 10), R(86, 44, 20, 18, W, 4), P('M86 136h20l-10 22z', W), C(96, 100, 12, 'hsl(330 70% 70%)')], 330);

  /* --- educación y deporte --- */
  ED('clase', 'clase|clases|curso|cursos|taller|taller de|asesoria|asesorias|regularizacion|tutoria|tutorias|clases particulares|clase muestra|inscripcion|colegiatura|mensualidad escolar|curso de verano|diplomado|capacitacion', () => [R(52, 52, 86, 106, W, 6), R(52, 52, 14, 106, 'hsl(215 15% 82%)', 6), R(76, 72, 50, 8, 'hsl(260 50% 60%)', 4), R(76, 88, 36, 6, 'hsl(260 50% 75%)', 3)], 260);
  ED('idiomas', 'ingles|clases de ingles|idiomas|frances|aleman|italiano|chino|japones|lengua de senas|toefl|examen de idioma|conversacion', () => [R(46, 54, 66, 50, W, 12), P('M60 104l-6 18 20-18z', W), R(80, 82, 66, 50, 'hsl(48 90% 60%)', 12), P('M132 132l6 18-20-18z', 'hsl(48 90% 60%)'), L('M62 72h34M62 86h24M96 100h34M96 114h24', 'hsl(215 15% 60%)', 3)], 48);
  ED('musica', 'musica|clases de musica|guitarra|clases de guitarra|piano|clases de piano|canto|clases de canto|bateria musical|violin|bajo|ukulele|solfeo|produccion musical', () => [R(108, 46, 8, 82, W, 3), L('M116 46q24 8 24 30', W, 8), E(96, 130, 22, 16, W, -0.4)], 280);
  ED('baile', 'baile|clases de baile|danza|ballet|zumba|clases de salsa|bachata|hip hop|danza arabe|jazz|ritmos latinos|baile de xv', () => [C(104, 50, 11, W), L('M104 62l-8 40 18 18v34M96 102l-22 34M100 74l24 14M100 76l-26-8', W, 8)], 330);
  ED('gimnasio', 'gimnasio|gym|membresia|mensualidad|mensualidad gimnasio|visita|visita gimnasio|inscripcion gimnasio|entrenamiento|entrenador personal|entrenamiento personal|pesas|crossfit|funcional|boxeo|box|kickboxing|muay thai|artes marciales|karate|taekwondo|jiu jitsu', () => [R(56, 94, 80, 12, W, 6), R(40, 72, 20, 56, W, 6), R(28, 82, 14, 36, 'hsl(215 15% 82%)', 5), R(132, 72, 20, 56, W, 6), R(150, 82, 14, 36, 'hsl(215 15% 82%)', 5)], 10);
  ED('yoga', 'yoga|pilates|meditacion|stretching|estiramiento|barre|yoga prenatal|mindfulness|clase de yoga|reformer', () => [C(96, 54, 11, W), L('M96 66v34M72 84l24-8 24 8M96 100l-30 26h60z', W, 8)], 160);
  ED('natacion', 'natacion|clases de natacion|alberca|matronatacion|aquafitness|nado libre|clases de nado', () => [C(70, 72, 12, W), L('M82 80l30-6-16 30', W, 8), L('M40 120q14-10 28 0t28 0 28 0 28 0M40 142q14-10 28 0t28 0 28 0 28 0', W, 6)], 200);
  ED('deporte', 'futbol|cancha|renta de cancha|liga|torneo|inscripcion a torneo|basquetbol|voleibol|clases de tenis|padel|squash|ciclismo|spinning|escuela de futbol|arbitraje|partido', () => [C(96, 104, 46, W), P('M96 82l16 12-6 18h-20l-6-18z', OSC), L('M96 82V60M112 94l20-8M106 112l12 18M86 112l-12 18M80 94l-20-8', OSC, 3)], 120);

  /* --- otros servicios --- */
  OT('lavanderia', 'lavanderia|lavado de ropa|lavado por kilo|kilo de ropa|ropa por kilo|lavado y secado de ropa|planchado|planchado de ropa|tintoreria|lavado en seco|edredones|lavado de edredon|lavado de tenis|lavado de cortinas|autoservicio de lavanderia', () => [P('M68 44l-28 22 14 22 12-8v76h60V80l12 8 14-22-28-22q-10 12-28 12t-28-12z', W), P('M80 44q16 12 32 0', 'hsl(200 40% 80%)'), L('M96 64v88', 'hsl(200 40% 80%)', 2)], 200);
  OT('costura', 'costura|arreglo de ropa|ajuste de ropa|bastilla|dobladillo|cambio de cierre|cierre|sastreria|sastre|confeccion|bordado|bordados|reparacion de ropa|ajustes', () => [R(90, 40, 12, 96, W, 4), C(96, 48, 3, OSC), L('M96 136q-30 10-30 30', W, 3), C(126, 110, 22, 'hsl(4 70% 58%)'), L('M110 100q16 6 32 0M108 116q18 6 36 0', 'hsl(4 60% 75%)', 2)], 4);
  OT('zapateria', 'reparacion de calzado|zapateria|zapatero|reparacion de zapatos|suelas|tacones|boleado|bolear|lustrado|grasa de zapatos|tinte de zapatos|reparacion de bolsas', () => [P('M36 132v-28q0-10 10-10h30l20 18h40q20 2 20 20H36z', W), R(36, 132, 120, 12, 'hsl(215 15% 82%)', 4), L('M76 106l6 6M88 102l6 6', OSC, 3)], 30);
  OT('relojeria', 'relojeria|relojero|reparacion de reloj|cambio de pila de reloj|pila de reloj|extension de reloj|ajuste de extension|joyeria|reparacion de joyas|grabado de joyas|soldadura de oro', () => [R(82, 34, 28, 30, W, 6), R(82, 144, 28, 30, W, 6), C(96, 104, 40, W), C(96, 104, 32, 'hsl(48 90% 90%)'), L('M96 104V82M96 104l16 10', OSC, 5)], 48);
  OT('fotografia', 'fotografia|fotografo|sesion de fotos|sesion fotografica|fotos|fotos infantiles|fotos para titulo|fotos tamano infantil|fotos para pasaporte|video|filmacion|edicion de video|dron|fotos de evento|cabina de fotos', () => [R(44, 66, 104, 74, W, 12), R(72, 52, 36, 18, W, 5), C(96, 102, 26, OSC), C(96, 102, 16, 'hsl(210 30% 45%)'), C(90, 96, 5, 'rgba(255,255,255,.6)')], 210);
  OT('impresion', 'impresion|impresiones|copias|fotocopias|copias a color|impresion a color|escaneo de documentos|engargolado|enmicado|plotter|lona|lonas|vinil|tarjetas de presentacion|volantes|playeras estampadas|sublimacion|serigrafia|tazas personalizadas|imprenta', () => [R(48, 78, 96, 50, W, 8), R(64, 54, 64, 28, 'hsl(200 30% 92%)', 3), R(64, 120, 64, 34, BLANCO, 3), L('M74 132h44M74 142h30', 'hsl(215 15% 70%)', 2), C(126, 94, 5, 'hsl(140 60% 50%)')], 200);
  OT('tramites', 'tramites|gestoria|tramite|llenado de formatos|curp|rfc|acta de nacimiento|impresion de actas|declaracion|declaracion anual|contabilidad|contador|asesoria fiscal|facturacion|nomina|abogado|asesoria legal|notaria|poder notarial|seguro|seguros', () => [R(56, 44, 80, 108, W, 6), L('M68 66h56M68 80h56M68 94h40', 'hsl(215 15% 70%)', 3), C(112, 128, 14, 'hsl(4 70% 58%)'), P('M104 140l-4 16 12-6 12 6-4-16z', 'hsl(4 70% 58%)')], 210);
  OT('envios', 'envio|envios|paqueteria|mensajeria|flete|fletes|mudanza|mudanzas|entrega a domicilio|servicio a domicilio de entrega|delivery|repartidor|guia de envio|empaque|embalaje', () => [P('M50 70l46-22 46 22-46 22z', 'hsl(36 80% 75%)'), P('M50 70v62l46 24V92z', 'hsl(36 70% 62%)'), P('M142 70v62l-46 24V92z', 'hsl(30 60% 48%)'), L('M74 58l46 22v22', W, 6)], 36);
  OT('renta', 'renta|rentas|renta por hora|alquiler|renta de equipo|renta de sillas|renta de mesas|renta de lonas|renta de brincolin|renta de salon|renta de mobiliario|reservacion|reserva|hora|tiempo|hora adicional|hora extra|apartado', () => [C(96, 104, 48, W), C(96, 104, 40, 'hsl(200 60% 92%)'), L('M96 104V76M96 104l20 12', OSC, 6), C(96, 104, 5, OSC)], 200);
  OT('eventos', 'evento|eventos|banquete|banquetes|taquiza|catering|mesa de dulces|decoracion|decoracion de eventos|animacion|animador|payaso|dj|sonido|iluminacion|show|mariachi|grupo musical|fiesta infantil|salon de fiestas|organizacion de eventos', () => [P('M96 40l12 26 28 4-20 20 4 28-24-14-24 14 4-28-20-20 28-4z', W), ...[[48, 60], [146, 56], [56, 140], [140, 140]].map(([x, y]) => C(x, y, 5, 'rgba(255,255,255,.8)'))], 330);
  OT('hospedaje', 'hospedaje|hotel|habitacion|cuarto|noche|noche de hotel|hostal|cabana|renta vacacional|airbnb|estancia|motel|suite|habitacion doble|habitacion sencilla', () => [R(40, 100, 112, 32, W, 8), R(40, 72, 34, 30, W, 8), R(80, 82, 70, 20, 'hsl(200 50% 85%)', 8), R(40, 130, 10, 22, W, 3), R(142, 130, 10, 22, W, 3)], 200);
  OT('estacionamiento', 'estacionamiento|pension|pension de autos|boleto de estacionamiento|valet|valet parking|parquimetro|cajon de estacionamiento', () => [R(56, 48, 80, 104, W, 14), P('M80 70h26q18 0 18 18t-18 18H92v26H80z', 'hsl(210 70% 52%)'), P('M92 82h12q6 0 6 6t-6 6H92z', W)], 210);
  OT('transporte', 'transporte|viaje|viajes|taxi|uber|traslado|traslados|transporte escolar|transporte de personal|tour|tours|excursion|boleto de autobus|pasaje|chofer|renta de autos', () => [R(44, 60, 104, 74, W, 14), R(52, 70, 40, 26, 'hsl(200 60% 75%)', 4), R(100, 70, 40, 26, 'hsl(200 60% 75%)', 4), C(70, 138, 12, OSC), C(122, 138, 12, OSC), R(52, 110, 16, 8, 'hsl(48 90% 60%)', 3), R(124, 110, 16, 8, 'hsl(48 90% 60%)', 3)], 48);
  OT('reparacion_bicicleta', 'bicicleta|reparacion de bicicleta|taller de bicicletas|ajuste de bicicleta|cambio de camara|ponchadura de bicicleta|motocicleta|reparacion de moto|servicio de moto|scooter', () => [C(62, 124, 26, 'none' as string), L('M62 124m-26 0a26 26 0 1 0 52 0a26 26 0 1 0-52 0M130 124m-26 0a26 26 0 1 0 52 0a26 26 0 1 0-52 0', W, 6), L('M62 124l26-40h34l8 40M88 84l-8-14h-14M96 124l26-40', W, 5)], 120);
  OT('cuidado_ninos', 'guarderia|estancia infantil|cuidado de ninos|ninera|babysitter|ludoteca|clases para ninos|estimulacion temprana|curso infantil', () => [C(96, 60, 16, W), P('M66 152q0-56 30-56t30 56z', W), C(90, 58, 2.5, OSC), C(102, 58, 2.5, OSC), L('M90 66q6 4 12 0', OSC, 2)], 330);
  OT('membresia', 'membresia anual|suscripcion|plan mensual|plan anual|paquete de sesiones|paquete de clases|bono|tarjeta de lealtad|cupon|vale|certificado de regalo|tarjeta prepagada', () => [R(40, 66, 112, 72, W, 12), R(40, 82, 112, 14, 'hsl(48 90% 60%)'), R(54, 108, 40, 8, 'hsl(215 15% 75%)', 4), C(130, 116, 10, 'hsl(4 70% 58%)')], 48);
  OT('servicio', 'servicio|servicios|servicio general|servicio especial|paquete|paquete basico|paquete premium|paquete completo|consulta inicial|cita|anticipo|deposito|abono|pago parcial|honorarios', () => [P('M96 38l18 38 42 5-31 29 8 42-37-21-37 21 8-42-31-29 42-5z', W)], 48);
}

/* ======================================================================
   MOTOR · de un producto a su ilustración
   ====================================================================== */
export type Giro = 'RETAIL' | 'HOSPITALITY' | 'SERVICES';

export interface Ilustracion {
  forma: string;
  familia: string;
  /** Tono base del fondo (0–359). */
  tono: number;
  fondoArriba: string;
  fondoAbajo: string;
  trazos: Trazo[];
}

export interface DatosProducto {
  id?: number | null;
  nombre: string;
  categoria?: string | null;
  giro?: Giro | null;
  /** Preset de servicios (TALLER_AUTOMOTRIZ, BELLEZA, …), si aplica. */
  preset?: string | null;
  /** NONE = servicio sin inventario; decide el respaldo. */
  inventario?: string | null;
}

/** Todas las formas, en orden de familia. */
export const CATALOGO: Forma[] = [...CATALOGO_BEBIDAS, ...CATALOGO_COMIDA, ...CATALOGO_COMERCIO, ...CATALOGO_SERVICIOS];
export const FORMAS: string[] = CATALOGO.map(f => f.id);
const POR_ID = new Map(CATALOGO.map(f => [f.id, f] as const));

/** Cada palabra clave normalizada, de la más larga a la más corta: gana lo más específico. */
const CLAVES: { c: string; f: Forma }[] = CATALOGO
  .flatMap(f => f.claves.map(c => ({ c: normalizar(c), f })))
  .filter(x => x.c.trim() !== '')
  .sort((a, b) => b.c.length - a.c.length);

const RESPALDO_SERVICIO: Record<string, string> = {
  TALLER_AUTOMOTRIZ: 'afinacion', BELLEZA: 'corte_cabello', REPARACION_ELECTRONICA: 'reparacion_celular', MANTENIMIENTO: 'mantenimiento', OTRO: 'servicio',
};

/** El texto con una variante en singular, para que «frappés» encuentre «frappe». */
function variantes(texto: string): string[] {
  const sing = texto.replace(/\b([a-z]{3,})(es|s)\b/g, (m, raiz, suf) => (suf === 'es' && /[^aeiou]$/.test(raiz) ? raiz : raiz + (suf === 'es' ? 'e' : '')));
  return sing === texto ? [texto] : [texto, sing];
}

/**
 * La forma de la clave más larga que aparece en el texto. Si dos formas
 * comparten esa misma clave («celular», «pintura», «chapa»), decide el
 * contexto: en un negocio de servicios gana el servicio; si no, el producto.
 */
function buscar(texto: string, prefiereServicio: boolean): Forma | null {
  if (texto.trim() === '') return null;
  const vs = variantes(texto);
  let empatadas: Forma[] = [];
  /* Primero lo específico; las formas genéricas solo si nada más coincide. */
  for (const generica of [false, true]) {
    let largo = -1;
    for (const { c, f } of CLAVES) {
      if (!!f.generica !== generica) continue;
      if (largo >= 0 && c.length < largo) break;
      if (vs.some(v => v.includes(c))) { largo = c.length; if (!empatadas.includes(f)) empatadas.push(f); }
    }
    if (empatadas.length) break;
  }
  if (!empatadas.length) return null;
  const deServicio = (f: Forma) => CATALOGO_SERVICIOS.includes(f);
  return empatadas.find(f => deServicio(f) === prefiereServicio) ?? empatadas[0];
}

/** La forma que le toca a un producto (id del catálogo). */
export function formaDe(p: DatosProducto): string {
  const prefiereServicio = p.giro === 'SERVICES' || p.inventario === 'NONE';
  for (const fuente of [p.nombre, p.categoria]) {
    const texto = normalizar(fuente);
    const f = buscar(texto, prefiereServicio);
    if (!f) continue;
    /* Lo preparado tiene su envase: «Refresco 600 ml» o un refresco en una tienda es la botella. */
    if (f.empaque && (esEmpaquetado(texto) || p.giro === 'RETAIL') && POR_ID.has(f.empaque)) return f.empaque;
    return f.id;
  }
  if (prefiereServicio) return RESPALDO_SERVICIO[p.preset ?? ''] ?? 'servicio';
  if (p.giro === 'HOSPITALITY') return 'platillo';
  return 'caja_generica';
}

/** La ilustración completa de un producto. */
export function ilustracionDe(p: DatosProducto): Ilustracion {
  const id = formaDe(p);
  const forma = POR_ID.get(id) ?? POR_ID.get('caja_generica')!;
  const semilla = p.id != null ? `id:${p.id}` : `n:${normalizar(p.nombre)}`;
  const h = hash(semilla);
  /* Con color natural (fruta, pan) el fondo se queda en su tono; el envase sí recorre el círculo. */
  const tono = forma.tono != null ? (forma.tono + (h % 24) - 12 + 360) % 360 : (h * 47) % 360;
  const acento = (h * 47) % 360;
  const k: Pal = { f: hsl(acento, 66, 52), o: hsl(acento, 55, 32), s: hsl(acento, 70, 80), c: BLANCO, h: acento };
  return {
    forma: forma.id,
    familia: forma.familia ?? '',
    tono,
    fondoArriba: hsl(tono, 75, 95),
    fondoAbajo: hsl(tono + 30, 62, 86),
    trazos: [E(96, 166, 48, 8, 'rgba(15,23,42,.10)'), ...forma.dibujo(k)],
  };
}
