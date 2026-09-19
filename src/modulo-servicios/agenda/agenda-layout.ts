import { horaDeFranja } from '../servicios.service';

/**
 * LA GEOMETRÍA DE UN DÍA, SIN PANTALLA.
 *
 * Colocar una cita en una columna es aritmética: minutos desde medianoche,
 * una ventana horaria que encuadra lo que hay ese día, y píxeles por hora.
 * Nada de eso depende de si se dibuja en el escritorio o en una tableta.
 *
 * Vive aquí porque hay DOS pantallas que lo necesitan —la agenda del
 * Backoffice y la de Touch— y copiarlo habría significado dos versiones de la
 * misma cuenta. El síntoma de que se separen no es un error: es una cita
 * dibujada media hora más abajo en una de las dos, que nadie nota hasta que
 * alguien llega tarde.
 *
 * El módulo es el mismo. Lo que cambia entre las dos es la ergonomía: en
 * Touch la hora mide más porque el dedo es más gordo que el cursor, y eso se
 * expresa pasando otro `altoHora`, no duplicando la función.
 */

/** Minutos desde medianoche de una hora ISO, en la zona del equipo. */
export function minutosDe(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Minutos desde medianoche de una franja de horario.
 *
 * Una franja es `TIME(0)` y llega como `"1970-01-01T09:00:00.000Z"`: por eso
 * pasa por `horaDeFranja`, que la lee en UTC. Leerla en la zona local
 * convertía las 09:00 de un horario en las 03:00.
 */
export function minutosDeFranja(hora: unknown): number {
  const [h, m] = horaDeFranja(hora).split(':');
  return Number(h) * 60 + Number(m);
}

export type Ventana = { desde: number; hasta: number };

/**
 * La ventana horaria que hay que enseñar.
 *
 * No son las 24 horas: un día con tres citas entre las 10 y las 14 dibujado
 * de 00:00 a 23:59 deja las citas comprimidas en una franja ilegible y el
 * resto en blanco. Se toma lo que de verdad ocupa el día —horarios, citas y
 * ausencias— y se le da una hora de margen por arriba y por abajo.
 */
export function ventanaDe(
  horarios: { starts_at: unknown; ends_at: unknown }[],
  citas: { starts_at: string; ends_at: string }[],
  ausencias: { starts_at: string; ends_at: string }[],
  porOmision: Ventana = { desde: 8 * 60, hasta: 20 * 60 },
): Ventana {
  const minutos: number[] = [];
  for (const h of horarios) minutos.push(minutosDeFranja(h.starts_at), minutosDeFranja(h.ends_at));
  for (const c of citas) minutos.push(minutosDe(c.starts_at), minutosDe(c.ends_at));
  for (const a of ausencias) minutos.push(minutosDe(a.starts_at), minutosDe(a.ends_at));
  if (!minutos.length) return porOmision;

  /* A la hora en punto hacia fuera: una ventana que empieza a las 9:47 pone
     las etiquetas en horas rotas y no hay forma de leer la rejilla. */
  const desde = Math.max(0, Math.floor((Math.min(...minutos) - 60) / 60) * 60);
  const hasta = Math.min(24 * 60, Math.ceil((Math.max(...minutos) + 60) / 60) * 60);
  return hasta > desde ? { desde, hasta } : porOmision;
}

/** La posición vertical de un minuto dentro de la ventana. */
export function aY(minutos: number, ventana: Ventana, altoHora: number): number {
  return ((minutos - ventana.desde) / 60) * altoHora;
}

export type BloqueCita<T> = {
  cita: T;
  top: number;
  alto: number;
  /** Si sigue prometiendo ese horario. Cancelada y no-llegó no lo prometen. */
  viva: boolean;
};

/** Si una cita sigue ocupando su hueco. */
export function citaEnPie(status: string): boolean {
  return status === 'AGENDADA' || status === 'CONFIRMADA';
}

/**
 * Los bloques de un día, ya colocados.
 *
 * `altoMinimo` es lo que hace falta para poder leer y tocar: en el escritorio
 * 22 px bastan, en una tableta no. Una cita cancelada se encoge a esa altura
 * mínima aunque durara dos horas: no borra el historial, pero deja de tapar
 * un hueco que ya está libre.
 */
export function bloquesDe<T extends { starts_at: string; ends_at: string; status: string }>(
  citas: T[],
  ventana: Ventana,
  altoHora: number,
  altoMinimo = 22,
): BloqueCita<T>[] {
  return citas.map(c => {
    const ini = minutosDe(c.starts_at);
    const fin = minutosDe(c.ends_at);
    const viva = citaEnPie(c.status);
    return {
      cita: c,
      top: aY(ini, ventana, altoHora),
      alto: viva
        ? Math.max(altoMinimo, ((fin - ini) / 60) * altoHora - 2)
        : altoMinimo + 2,
      viva,
    };
  });
}

/** Las horas en punto que hay que etiquetar en la ventana. */
export function horasDe(ventana: Ventana): number[] {
  const horas: number[] = [];
  for (let m = ventana.desde; m < ventana.hasta; m += 60) horas.push(m / 60);
  return horas;
}

/** `HH:MM` de unos minutos desde medianoche. */
export function comoHora(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
