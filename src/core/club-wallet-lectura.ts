import { CartCustomer } from './models';
import { ClientesVentaService } from './clientes-venta.service';

/**
 * 0066 · LEER LA TARJETA DEL CLUB EN CAJA.
 *
 * El pase de Apple Wallet / Google Wallet trae un QR con `WXC-<serial>`; el
 * escáner lo teclea como cualquier código. La caja lo resuelve a su cliente
 * (club:wallet-resolver: primero la base local, sin internet; si no está, la
 * nube) y lo devuelve como lo lleva el carrito. Lo comparten Venta y Touch.
 */
export const ClubWalletLectura = {
  esCodigo(texto: string | null | undefined): boolean {
    return /^\s*WXC-[0-9a-f]{24}\s*$/i.test(String(texto ?? ''));
  },

  async cliente(codigo: string, clientes: ClientesVentaService): Promise<{ ok: true; cliente: CartCustomer } | { ok: false; error: string }> {
    const api = (window as any).electronAPI;
    if (!api?.clubWalletResolver) return { ok: false, error: 'La tarjeta del Club no está disponible en esta caja.' };
    const r = await api.clubWalletResolver({ codigo: codigo.trim() });
    if (!r?.success) return { ok: false, error: r?.error || 'No se pudo leer la tarjeta.' };
    const lista = await clientes.listar();
    if (!lista.ok) return { ok: false, error: lista.error };
    const c = lista.datos.find((x) => Number(x.id) === Number(r.data.customerId));
    return c ? { ok: true, cliente: c } : { ok: false, error: 'El cliente de esta tarjeta está dado de baja.' };
  },
};
