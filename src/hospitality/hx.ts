/*
 * Lo que comparten las tres pantallas de la operacion (Mesas, Cocina y
 * Salon y estaciones) para que se lean como UNA herramienta: el color de cada
 * estacion, el icono de cada area y como se nombra un destino.
 */

/**
 * El color de una estacion, por su id: estable entre pantallas y entre
 * sesiones. Barra es del mismo color en la configuracion, en las pestanas de
 * la cocina y en la etiqueta de cada comanda. Cinco tonos del sistema; el
 * rojo queda fuera porque en cocina significa «atrasada».
 */
export function colorEstacion(id: number | null | undefined): string {
  if (id == null) return 'hx-c-nada';
  return `hx-c${Math.abs(Number(id)) % 5}`;
}

/** Un icono que se parece al area. Si el nombre no dice nada, un sillon. */
export function iconoDeArea(nombre: string | null | undefined): string {
  const n = String(nombre ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/terraza|jardin|patio|exterior|afuera|banqueta/.test(n)) return 'ph-tree';
  if (/barra|\bbar\b|mostrador|caf/.test(n)) return 'ph-coffee';
  if (/privad|vip|reservad/.test(n)) return 'ph-door';
  if (/piso|planta|alta|mezzanine|segundo/.test(n)) return 'ph-stairs';
  if (/lounge|sala|sofa/.test(n)) return 'ph-couch';
  return 'ph-armchair';
}

/** «3» se lee como «Mesa 3»; «T2», «Barra» o «Ana» se quedan como estan. */
export function nombreDeMesa(nombre: string | null | undefined): string {
  const n = String(nombre ?? '').trim();
  return /^\d+$/.test(n) ? `Mesa ${n}` : n;
}

/** El siguiente nombre de mesa de un area, siguiendo su propio patron. */
export function siguienteNombre(nombres: string[]): string {
  let prefijo = '';
  let max = 0;
  for (const x of nombres) {
    const m = /^(.*?)(\d+)$/.exec(x.trim());
    if (m && Number(m[2]) >= max) { max = Number(m[2]); prefijo = m[1]; }
  }
  return `${prefijo}${max + 1}`;
}
