import Swal from 'sweetalert2';
import type { SaleService } from '../core/sale.service';

/**
 * ¿ABRIR EL CAJÓN PARA EL VOUCHER?
 *
 * Con efectivo el cajón se abre solo. Con tarjeta no se abría, y el voucher
 * firmado se quedaba suelto en el mostrador. Ahora, al terminar una venta con
 * tarjeta (o Mercado Pago), se pregunta. Enter abre, Esc no.
 *
 * No se pregunta si la venta llevó efectivo (el cajón ya se abrió) ni si esta
 * caja no tiene cajón habilitado.
 */
export async function preguntarCajonVoucher(sale: SaleService, metodos: string[]): Promise<void> {
  const conTarjeta = metodos.some(m => m === 'TARJETA' || m === 'TERMINAL_MP');
  if (!conTarjeta || metodos.includes('EFECTIVO')) return;
  if (!(await sale.cajonHabilitado())) return;

  const r = await Swal.fire({
    icon: 'question',
    title: '¿Abrir el cajón?',
    text: 'Para guardar el voucher de la tarjeta.',
    showCancelButton: true,
    confirmButtonText: 'Abrir cajón',
    cancelButtonText: 'No',
    focusConfirm: true,
    reverseButtons: true,
  });
  if (!r.isConfirmed) return;

  if (!(await sale.abrirCajonVoucher())) {
    await Swal.fire({ icon: 'error', title: 'No se abrió el cajón', text: 'Revisa la configuración del cajón o ábrelo con F1.' });
  }
}
