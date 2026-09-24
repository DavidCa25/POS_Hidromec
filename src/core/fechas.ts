/**
 * EL DIA DE HOY, DONDE ESTA LA CAJA.
 *
 * `new Date().toISOString().slice(0, 10)` NO es la fecha de hoy: es la fecha
 * de hoy en Londres. En Mexico (UTC-6) las dos coinciden hasta las 18:00 y a
 * partir de ahi el sistema empieza a decir que es manana.
 *
 * Eso no es una curiosidad de husos horarios. Un negocio que cierra a las 20:00
 * pasa sus ultimas dos horas de trabajo -las de mas venta en muchos giros-
 * abriendo la agenda en el dia equivocado, con el corte y las comisiones
 * contando en otro dia. Se descubrio porque la prueba de la agenda empezo a
 * fallar por la tarde y a pasar por la manana.
 *
 * DONDE SE USA Y DONDE NO
 * -----------------------
 * Esto es para responder «que dia es AQUI y AHORA». NO es para una fecha que
 * viene de la base: esa ya llega como un instante concreto y pasarla por aqui
 * la moveria un dia. Si el dato salio de SQL, se deja como esta.
 */

/** `YYYY-MM-DD` de una fecha, leida en la zona horaria de esta maquina. */
export function fechaLocal(d: Date = new Date()): string {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** El dia de hoy, aqui. */
export function hoyLocal(): string {
  return fechaLocal();
}

/**
 * El dia que cae `dias` despues (o antes) de un `YYYY-MM-DD`.
 *
 * Se ancla al mediodia a proposito: sumarle un dia a una medianoche cae dentro
 * del cambio de horario de verano en los paises que aun lo aplican, y el
 * resultado es el mismo dia otra vez o dos dias despues. Al mediodia no hay
 * salto que alcance.
 */
export function moverDias(dia: string, dias: number): string {
  const d = new Date(`${dia}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return fechaLocal(d);
}
