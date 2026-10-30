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

/**
 * La hora de pared de esta maquina como texto SIN zona: `2026-10-01T20:00:00`.
 *
 * Es lo que hay que mandar a una columna de hora local (casi toda la base, ver
 * `fechaSql`). `toISOString()` manda la hora de Londres: una venta de las
 * 20:00 quedaba guardada a las 02:00 del dia siguiente.
 */
export function horaParedLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${fechaLocal(d)}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const CON_ZONA = /(Z|[+-]\d{2}:?\d{2})$/;

/**
 * Un valor de fecha que viene de SQL, como Date cuyas partes UTC son la hora
 * de pared que guardo la base. Se formatea con `timeZone: 'UTC'` (ver
 * `zonaDeSql` y el pipe `fechaSql`).
 *
 * `mssql` ya entrega asi un DATETIME o un DATE. Un texto sin zona (`FOR JSON`)
 * se lee igual; un `YYYY-MM-DD` es esa medianoche. Un texto CON zona es un
 * instante de verdad (la nube) y se respeta.
 */
export function fechaDeSql(valor: unknown): Date | null {
  if (valor == null || valor === '') return null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor;
  const t = String(valor);
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(t) ? t + 'T00:00:00Z' : CON_ZONA.test(t) ? t : t + 'Z');
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Con que zona formatear ese valor: 'UTC' para hora de pared, nada para un instante con zona. */
export function zonaDeSql(valor: unknown): 'UTC' | undefined {
  return typeof valor === 'string' && CON_ZONA.test(valor) ? undefined : 'UTC';
}
