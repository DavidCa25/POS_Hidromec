/**
 * ALERTAS CON WYBIX GUIDE.
 *
 * Wybix tiene cientos de `Swal.fire(...)` repartidos por las pantallas. En vez
 * de reescribirlos uno por uno, este módulo envuelve `Swal.fire` UNA vez al
 * arrancar y decide, por la forma de cada llamada, cómo se ve:
 *
 *   AVISO      Algo salió bien y no hay nada que decidir (éxito o información
 *              que se cierra sola). Sale en la esquina como aviso y NO detiene
 *              al cajero. Guide con cara de `exito` o `idle`.
 *   DECISIÓN   Todo lo demás: errores, advertencias, confirmaciones, preguntas
 *              con campo. Sigue siendo diálogo, con Guide asomándose por la
 *              orilla con su cara: `error`, `atencion`.
 *
 * Lo que NO cambia: el texto, los botones, el resultado que espera quien
 * llama (`isConfirmed`, `value`) y el orden en que se resuelve. Una llamada
 * que pide su propio `toast`, `iconHtml` o `customClass.icon` se respeta.
 *
 * GUIDE ES LA DE LA SESIÓN (CLAUDE.md, Wybix Guide 5 y 6): la misma variante
 * que el resto de la app; el estado cambia la cara, nunca el personaje. Las
 * caras se dibujan una vez por sesión, de forma asíncrona; mientras no estén
 * listas, la alerta sale con el ícono de siempre. Con mascota de marca (addon
 * de cliente) tampoco se dibuja Guide: el ícono de siempre.
 */
import Swal, { type SweetAlertOptions } from 'sweetalert2';
import { svgMascota, type EstadoMascota } from '../wx-mascota/wx-mascota.component';
import type { VarianteMascota } from '../wx-mascota/variantes';
import { ADDON } from '../marca/addon';

type Icono = 'success' | 'error' | 'warning' | 'info' | 'question';

const CARA: Record<Icono, EstadoMascota> = {
  success: 'exito',
  error: 'error',
  warning: 'atencion',
  question: 'atencion',
  info: 'idle',
};

/** Tamaño de Guide en un diálogo y en un aviso. */
const TAM_DIALOGO = 80;
const TAM_AVISO = 56;

let caras: Partial<Record<string, string>> = {};
let instalado = false;

async function dibujarCaras(v: VarianteMascota) {
  if (ADDON?.mascota) return;
  const nuevas: Record<string, string> = {};
  for (const estado of ['exito', 'error', 'atencion', 'idle'] as EstadoMascota[]) {
    for (const tam of [TAM_DIALOGO, TAM_AVISO]) {
      const svg = await svgMascota(estado, v, tam);
      if (svg) nuevas[`${estado}:${tam}`] = svg;
    }
  }
  caras = nuevas;
}

/** Un aviso es lo que ya se cerraba solo y no pide nada a nadie. */
export function esAviso(o: SweetAlertOptions): boolean {
  const icono = o.icon as Icono | undefined;
  if (icono !== 'success' && icono !== 'info') return false;
  if (o.toast || o.input || o.preConfirm || o.showCancelButton || o.showDenyButton) return false;
  if (typeof o.html === 'string' && /<(input|select|textarea|button)/i.test(o.html)) return false;
  return !!o.timer || o.showConfirmButton === false;
}

function unirClases(a: SweetAlertOptions['customClass'], b: Record<string, string>) {
  const base = (a && typeof a === 'object') ? { ...a } as Record<string, string> : {};
  for (const [k, v] of Object.entries(b)) base[k] = [base[k], v].filter(Boolean).join(' ');
  return base as SweetAlertOptions['customClass'];
}

/** `Swal.fire(titulo, texto, icono)` y `Swal.fire({...})` a la misma forma. */
function comoOpciones(args: unknown[]): SweetAlertOptions | null {
  const [a, b, c] = args;
  if (a && typeof a === 'object') return { ...(a as SweetAlertOptions) };
  if (typeof a === 'string') return { title: a, html: b as string | undefined, icon: c as Icono | undefined };
  return null;
}

export function vestir(o: SweetAlertOptions): SweetAlertOptions {
  if (o.toast || o.iconHtml) return o;
  const icono = o.icon as Icono | undefined;
  /* Sin ícono (formularios, «Guardando…», preguntas con campo): también es un
     diálogo con Guide, en reposo. SweetAlert pinta `iconHtml` aunque no haya
     `icon`, así que no se inventa un tipo que la llamada no pidió. */
  const estado: EstadoMascota = icono ? CARA[icono] : 'idle';

  if (esAviso(o)) {
    const cara = caras[`${estado}:${TAM_AVISO}`];
    const didOpen = o.didOpen;
    return {
      ...o,
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: o.timer ?? 3200,
      timerProgressBar: true,
      ...(cara ? { iconHtml: cara } : {}),
      customClass: unirClases(o.customClass, {
        popup: `wx-aviso wx-aviso--${icono}`,
        ...(cara ? { icon: 'wx-guide-cara' } : {}),
      }),
      didOpen: (el) => {
        /* Quien está leyendo no pierde el aviso: con el puntero encima se espera. */
        el.addEventListener('mouseenter', () => Swal.stopTimer());
        el.addEventListener('mouseleave', () => Swal.resumeTimer());
        didOpen?.(el);
      },
    };
  }

  const cara = caras[`${estado}:${TAM_DIALOGO}`];
  return {
    ...o,
    ...(cara ? { iconHtml: cara } : {}),
    ...(icono && o.confirmButtonText == null && !o.showCancelButton ? { confirmButtonText: 'Entendido' } : {}),
    /* El orden de los botones NO se toca: en caja se contesta con ← → y Enter,
       y voltearlos cambiaría a qué botón lleva cada flecha
       (e2e/entrada-y-quitar.spec.js lo vigila). */
    customClass: unirClases(o.customClass, {
      popup: `wx-alerta wx-alerta--${icono ?? 'simple'}`,
      ...(cara ? { icon: 'wx-guide-cara' } : {}),
    }),
  };
}

/**
 * Se llama una vez al arrancar, con la variante de Guide de esta sesión.
 * Volver a llamarla solo vuelve a dibujar las caras (otra sesión).
 */
export function instalarAlertasWybix(variante: VarianteMascota) {
  void dibujarCaras(variante);
  if (instalado) return;
  instalado = true;
  const original = Swal.fire.bind(Swal) as (...a: unknown[]) => ReturnType<typeof Swal.fire>;
  (Swal as unknown as { fire: (...a: unknown[]) => ReturnType<typeof Swal.fire> }).fire = (...args: unknown[]) => {
    const o = comoOpciones(args);
    return o ? original(vestir(o)) : original(...args);
  };
}
