/**
 * LAS CARAS DE WYBIX.
 *
 * EL PROBLEMA
 * -----------
 * Blobatar admite muchísimas combinaciones, pero Wybix usaba siempre la
 * misma semilla, así que siempre salía exactamente el mismo personaje. Con
 * el tiempo deja de leerse como una identidad y empieza a leerse como un
 * icono más.
 *
 * LO QUE NO SE PUEDE HACER
 * ------------------------
 * Sortear en cada render. Eso no es variedad: es parpadeo. La cara cambiaría
 * entre fotogramas, y un avatar de persona cambiaría cada vez que se abre la
 * pantalla —una persona no hace eso—.
 *
 * LA REGLA
 * --------
 *   APARIENCIA  = quién es. Sale de una semilla, y la semilla es estable.
 *   ESTADO      = cómo está. `idle`, `atencion`, `exito`, `error`.
 *
 * Son cosas distintas: la misma variante pasa por los cuatro estados sin
 * convertirse en otro personaje.
 *
 * DOS CLASES DE ESTABILIDAD
 * -------------------------
 *   · El avatar de una PERSONA se deriva de su id. Siempre el mismo, para
 *     siempre. Del id y no del nombre: los nombres se corrigen.
 *   · Wybix Guide toma una variante por SESIÓN. Estable mientras dura; al
 *     día siguiente puede ser otra, y esa es la gracia.
 */

/** Una apariencia: la forma la da la semilla, el color el tono. */
export interface VarianteMascota {
  id: string;
  semilla: string;
  hue: number;
  tone: number;
}

/**
 * LAS VARIANTES CURADAS.
 *
 * No es «cualquier combinación»: es una lista revisada. Una aleatoria sin
 * filtro da colores que no pegan con nada y contrastes que no se leen.
 *
 * El tono se mantiene entre 0.34 y 0.46 a propósito: por debajo, la figura
 * se oscurece y los ojos —que son casi negros— dejan de distinguirse; por
 * encima, se lava sobre superficie blanca. Y el matiz se queda en la familia
 * fría del cyan de Wybix, con dos vecinos —verde azulado y azul— que siguen
 * leyéndose como la misma marca.
 *
 * Lo que de verdad cambia entre variantes es la FORMA, que la decide la
 * semilla: silueta, proporción y colocación de los rasgos.
 */
export const VARIANTES: VarianteMascota[] = [
  { id: 'cyan',     semilla: 'wybix:mascota',   hue: 200, tone: 0.40 },
  { id: 'laguna',   semilla: 'wybix:laguna',    hue: 188, tone: 0.42 },
  { id: 'indigo',   semilla: 'wybix:indigo',    hue: 214, tone: 0.38 },
  { id: 'jade',     semilla: 'wybix:jade',      hue: 172, tone: 0.44 },
  { id: 'cobalto',  semilla: 'wybix:cobalto',   hue: 222, tone: 0.36 },
  { id: 'turquesa', semilla: 'wybix:turquesa',  hue: 180, tone: 0.46 },
];

/** La de siempre. La que sale si algo falla, para no quedarse sin cara. */
export const VARIANTE_BASE = VARIANTES[0];

/**
 * Un entero estable a partir de un texto.
 *
 * FNV-1a: corto, sin dependencias y bien repartido. Lo único que se le pide
 * es que el mismo texto dé siempre el mismo número, en esta máquina y en la
 * de al lado.
 */
export function huella(texto: string): number {
  let h = 0x811c9dc5;
  const s = String(texto ?? '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * El avatar de una persona.
 *
 * Del ID, no del nombre: un nombre se corrige —«Jose» pasa a «José»— y con
 * él cambiaría la cara de alguien que lleva dos años en el negocio.
 */
export function varianteDePersona(clase: string, id: number | string): VarianteMascota {
  const v = VARIANTES[huella(`${clase}:${id}`) % VARIANTES.length];
  /* La semilla lleva el id: dos personas que caigan en la misma variante
     siguen teniendo silueta propia. La variante da el color; el id, la forma. */
  return { ...v, id: `${v.id}:${clase}:${id}`, semilla: `${v.semilla}:${clase}:${id}` };
}

/**
 * La variante de Wybix Guide para ESTA sesión.
 *
 * Se calcula una vez al entrar y no cambia hasta la siguiente sesión. Si la
 * sesión no tiene identificador todavía, se usa la de siempre: es preferible
 * la cara conocida a una que cambie a mitad de pantalla.
 */
export function varianteDeSesion(idSesion: string | null | undefined): VarianteMascota {
  if (!idSesion) return VARIANTE_BASE;
  return VARIANTES[huella(`wybix:guide:${idSesion}`) % VARIANTES.length];
}
