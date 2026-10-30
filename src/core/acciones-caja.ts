/**
 * LO QUE TODA CAJA TIENE QUE OFRECER, SEA RETAIL O TOUCH.
 *
 * Retail y Touch son dos disenos de la misma caja: Retail para teclado y
 * raton (con atajos F1, F7...), Touch para el dedo (botones grandes, sin
 * atajos). Lo que cambia es la forma; lo que se puede HACER, no. Ya paso
 * varias veces que algo se agrego a una y faltaba en la otra (la devolucion
 * directa solo estaba en Touch; Checar llego a una antes que a la otra).
 *
 * Esta lista es el contrato. Cada accion se marca en las DOS plantillas con
 * `data-caja="<id>"` en el elemento que la ofrece (boton o componente), y
 * `scripts/pruebas/caja-paridad.mjs` falla si una pantalla no la tiene.
 *
 * Para agregar algo del dia a dia a la caja: una entrada aqui y su
 * `data-caja` en venta.html Y en touch-pos.html. Los atajos de teclado no van
 * aqui: son de Retail.
 */
export interface AccionCaja {
  id: string;
  /** Para que sirve, en palabras de quien atiende. */
  para: string;
}

export const ACCIONES_CAJA: AccionCaja[] = [
  { id: 'cliente', para: 'Elegir o cambiar el cliente de la venta.' },
  { id: 'club', para: 'Membresía del Club y beneficio de hoy del cliente.' },
  { id: 'promociones', para: 'Promociones, combos y precios por canal aplicados a la venta.' },
  { id: 'cupon', para: 'Canjear un cupón en la venta.' },
  { id: 'devolucion', para: 'Encontrar una venta y devolver o cambiar, con su motivo.' },
  { id: 'cajon', para: 'Abrir el cajón sin venta (con su autorización).' },
  { id: 'salida', para: 'Salida de efectivo de la caja.' },
  { id: 'checar', para: 'Entrada, descanso y salida (con Asistencia activada).' },
];
