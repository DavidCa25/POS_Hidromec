import Swal from 'sweetalert2';

/**
 * ¿QUITAR EL PRODUCTO DE LA VENTA?
 *
 * Al bajar la cantidad por debajo del mínimo (1 pieza, o 0.01 si se vende a
 * granel) la cantidad se quedaba en el mínimo y el producto no se podía quitar
 * con «−». Ahora se pregunta.
 *
 * Con teclado: ← → cambian entre «Quitar» y «Cancelar» (SweetAlert mueve el
 * foco entre botones con las flechas), Enter elige y Esc cancela.
 */
export async function confirmarQuitar(nombre: string): Promise<boolean> {
  const r = await Swal.fire({
    icon: 'question',
    title: '¿Quitar de la venta?',
    text: nombre,
    showCancelButton: true,
    confirmButtonText: 'Quitar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#dc3545',
    focusConfirm: true,
  });
  return r.isConfirmed;
}
