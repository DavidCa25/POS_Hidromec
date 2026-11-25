/**
 * 0090 · LO PEDIDO CONTRA LO QUE LLEGÓ.
 *
 * Registrar compra se llena con el pedido sugerido; al subir el ticket del
 * proveedor, cada renglón se compara contra lo pedido. Puro (sin Angular) para
 * probarlo en node: scripts/pruebas/pedido.test.mjs.
 */

export type Tono = 'ok' | 'aviso' | 'info';
export interface EstadoRenglon { texto: string; tono: Tono }

/**
 * @param pedido   cuánto se pidió de este renglón (null: no estaba en el pedido)
 * @param llego    cuánto dijo el ticket (null: el ticket no lo trae)
 * @param hayTicket si ya se subió un ticket; sin él solo se marca lo pedido
 */
export function estadoRenglon(pedido: number | null, llego: number | null, hayTicket: boolean): EstadoRenglon | null {
  if (!hayTicket) return pedido != null ? { texto: `Pedido: ${pedido}`, tono: 'info' } : null;
  if (pedido == null) return { texto: 'No estaba en el pedido', tono: 'info' };
  if (llego == null) return { texto: 'No viene en el ticket', tono: 'aviso' };
  if (llego < pedido) return { texto: `Faltaron ${redondo(pedido - llego)}`, tono: 'aviso' };
  if (llego > pedido) return { texto: `Llegaron ${redondo(llego - pedido)} de más`, tono: 'aviso' };
  return { texto: 'Completo', tono: 'ok' };
}

/** «subió 0.50» / «bajó 1.20», o null si no cambió (menos de medio centavo). */
export function cambioDeCosto(antes: number | null, ahora: number): string | null {
  if (!(Number(antes) > 0)) return null;
  const d = (Number(ahora) || 0) - Number(antes);
  if (Math.abs(d) < 0.005) return null;
  return d > 0 ? `subió ${d.toFixed(2)}` : `bajó ${(-d).toFixed(2)}`;
}

/** Cuándo se acaba, en palabras: con existencia nunca dice «agotado». */
export function seAcaba(dias: number, existencia: number): string {
  if (!(existencia > 0)) return 'agotado';
  if (dias < 1) return 'hoy';
  if (dias < 2) return 'mañana';
  return `${Math.floor(dias)} d`;
}

function redondo(n: number) { return Math.round(n * 100) / 100; }
