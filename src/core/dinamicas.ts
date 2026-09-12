/*
 * La regla del cronometro, en un solo sitio.
 *
 * QUIEN DECIDE DE VERDAD
 * ----------------------
 * En una partida REAL decide SQL (`sp_dynamic_play`), siempre. La caja manda
 * cuando paro, nunca si gano. Estas funciones NO participan en esa decision:
 * lo unico que hacen en modo LIVE es contar y dar formato.
 *
 * El espejo `aciertaTiming` existe solo para la VISTA PREVIA, donde no hay
 * intento que jugar ni premio que entregar y por tanto no hay nada que SQL
 * pueda decidir. Se mantiene aqui, junto a la cuantizacion, para que las dos
 * mitades de la promesa -"lo que ves es lo que se juzga"- vivan pegadas: si
 * alguien cambia una, tropieza con la otra.
 *
 * La regla en SQL es `ROUND(@input_value * 100, 0) = ROUND(@objetivo * 100, 0)`
 * sobre DECIMAL, que es aritmetica exacta. Aqui se compara el MISMO entero.
 */

/**
 * Milisegundos a centesimas enteras.
 *
 * Un solo redondeo, y de aqui sale todo: lo que se pinta y lo que se envia.
 * Guardar segundos en coma flotante y redondear dos veces es como la pantalla
 * acaba diciendo 10.00 mientras el servidor juzga 9.99.
 */
export function centesimasDe(milisegundos: number): number {
  return Math.round(milisegundos / 10);
}

/** Las centesimas tal y como se leen: siempre dos decimales. */
export function textoCentesimas(centesimas: number): string {
  return (centesimas / 100).toFixed(2);
}

/** Los segundos que viajan a SQL: exactamente lo que se mostro. */
export function segundosDe(centesimas: number): number {
  return centesimas / 100;
}

/** El objetivo, con los mismos dos decimales que el cronometro. */
export function objetivoEnCentesimas(objetivoSegundos: number | null | undefined): number | null {
  const n = Number(objetivoSegundos);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

/**
 * ESPEJO de la regla de SQL, solo para la vista previa.
 *
 * No se usa nunca para conceder un premio: en una partida real ni siquiera se
 * llama. Comparar enteros -no segundos- es lo que garantiza que la vista
 * previa se comporte igual que la partida de verdad.
 */
export function aciertaTiming(centesimas: number, objetivoSegundos: number | null | undefined): boolean {
  const objetivo = objetivoEnCentesimas(objetivoSegundos);
  return objetivo !== null && centesimas === objetivo;
}
