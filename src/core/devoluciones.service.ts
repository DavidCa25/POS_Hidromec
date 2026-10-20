import { Injectable } from '@angular/core';

/*
 * DEVOLUCIONES (0065): lo que Venta y Touch comparten.
 *
 * Quién decide es sp_refund_sale: qué se puede devolver, por dónde regresa
 * el dinero, si alcanza el crédito. Aquí solo se carga la venta, se ofrecen
 * los motivos y se ANTICIPA por dónde regresará el dinero, con la misma
 * regla que SQL, para que el cajero lo diga antes de confirmar.
 */

/** Los motivos que se ofrecen. «Otro» pide escribir cuál. */
export const MOTIVOS_DEVOLUCION = ['Mal estado', 'Se equivocó de producto', 'No lo quiso', 'Error al cobrar', 'Otro'] as const;
export type MotivoDevolucion = typeof MOTIVOS_DEVOLUCION[number];

/** Una venta que se puede devolver (sp_refund_candidates). */
export interface VentaDevolvible {
  id: number; datee: string; total: number; payment_method: string; customer_id: number | null; cliente: string | null;
  renglones: number; devuelto: number; resumen: string | null; devuelta: boolean;
}
/** Un renglón de la venta con lo que aún se puede devolver. */
export interface RenglonDevolucion { productId: number; nombre: string; precio: number; maximo: number; cantidad: number; }
/** La venta cargada para devolver. */
export interface VentaParaDevolver {
  id: number; datee: string; total: number; metodo: string; balance: number; devuelto: number; customerId: number | null;
  pagos: { metodo: string; monto: number }[]; renglones: RenglonDevolucion[];
}
/** Una parte de cómo regresa el dinero. */
export interface Regreso { metodo: string; monto: number; texto: string; }
/** Lo que se lleva en un CAMBIO (precio de lista). */
export interface LineaCambio { productId: number; nombre: string; precio: number; cantidad: number; }
/** Cómo paga la diferencia de un cambio, si lo que se lleva vale más. */
export type MetodoDiferencia = 'EFECTIVO' | 'TARJETA' | 'TRANSFERENCIA';
/** Resultado de un cambio (sp_exchange_sale). */
export interface CambioHecho { refundId: number; saleId: number; devuelto: number; lleva: number; paga: number; regresa: number; }

const ETIQUETA: Record<string, string> = {
  EFECTIVO: 'Sale del cajón en efectivo',
  TARJETA: 'Se regresa a su tarjeta: hazlo en la terminal',
  TRANSFERENCIA: 'Se le regresa por transferencia',
  TERMINAL_MP: 'Se regresa por Mercado Pago, desde la terminal',
  PLATAFORMA: 'Lo regresa la plataforma de pedidos',
  CREDITO: 'Se descuenta de lo que debe',
};

@Injectable({ providedIn: 'root' })
export class DevolucionesService {
  private get api(): any { return (window as any).electronAPI; }

  /** Las de hoy de esta caja, las de un cliente o una por folio. */
  async ventas(p: { customerId?: number | null; folio?: number | null } = {}): Promise<VentaDevolvible[]> {
    const r = await this.api?.refundCandidates?.(p);
    if (!r?.success) throw new Error(r?.error || 'No se pudieron leer las ventas.');
    return (r.data ?? []).map((v: any) => ({ ...v, total: Number(v.total), devuelto: Number(v.devuelto), devuelta: !!v.devuelta }));
  }

  /** La venta con lo que aún se puede devolver de cada producto. */
  async cargar(folio: number): Promise<VentaParaDevolver> {
    const r = await this.api?.getSaleByFolio?.(folio);
    if (!r?.success || !r.data?.header) throw new Error(r?.error || `No existe la venta #${folio}.`);
    const h = r.data.header;
    let pagos: { metodo: string; monto: number }[] = [];
    try { pagos = (JSON.parse(h.payments_json || '[]') as any[]).map((x) => ({ metodo: String(x.payment_method), monto: Number(x.amount) })); } catch { /* sin pagos */ }
    const renglones = (r.data.details ?? [])
      .filter((d: any) => Number(d.remaining_qty ?? 0) > 0)
      .map((d: any) => ({
        productId: Number(d.product_id),
        nombre: String(d.product_name ?? d.nombre ?? `Producto #${d.product_id}`),
        precio: Number(d.unitary_price ?? 0),
        maximo: Number(d.remaining_qty ?? 0),
        cantidad: 0,
      }));
    return {
      id: Number(h.sale_id), datee: h.datee, total: Number(h.total), metodo: String(h.payment_method ?? ''),
      balance: Number(h.balance ?? 0), devuelto: Number(h.refund_total ?? 0), customerId: h.customer_id ?? null, pagos, renglones,
    };
  }

  total(v: VentaParaDevolver | null): number {
    if (!v) return 0;
    return Math.round(v.renglones.reduce((a, l) => a + l.cantidad * l.precio, 0) * 100) / 100;
  }

  /**
   * Por dónde regresará el dinero. La regla de sp_refund_sale:
   *   · crédito sin pagos: primero baja lo que debe; lo ya pagado, en efectivo;
   *   · con pagos: efectivo primero y luego el resto, descontando lo que ya
   *     se devolvió antes por el mismo camino.
   */
  comoRegresa(v: VentaParaDevolver | null, monto = this.total(v)): Regreso[] {
    if (!v || monto <= 0) return [];
    const partes: Regreso[] = [];
    const poner = (metodo: string, m: number) => { if (m > 0.004) partes.push({ metodo, monto: Math.round(m * 100) / 100, texto: ETIQUETA[metodo] ?? `Se regresa por ${metodo.toLowerCase()}` }); };
    if (!v.pagos.length) {
      if (v.metodo === 'CREDITO') {
        const deuda = Math.min(Math.max(v.balance, 0), monto);
        poner('CREDITO', deuda);
        poner('EFECTIVO', monto - deuda);
      } else poner(v.metodo || 'EFECTIVO', monto);
      return partes;
    }
    const orden = [...v.pagos].sort((a, b) => (a.metodo === 'EFECTIVO' ? 0 : 1) - (b.metodo === 'EFECTIVO' ? 0 : 1));
    let previo = v.devuelto, resta = monto;
    for (const p of orden) {
      let disponible = p.monto;
      const usado = Math.min(previo, disponible);
      previo -= usado; disponible -= usado;
      const parte = Math.min(disponible, resta);
      poner(p.metodo, parte);
      resta -= parte;
    }
    return partes;
  }

  /** Valor de lo que se lleva en un cambio. */
  totalLleva(ls: LineaCambio[]): number {
    return Math.round(ls.reduce((a, l) => a + l.cantidad * l.precio, 0) * 100) / 100;
  }

  /**
   * CAMBIO: devuelve las piezas elegidas y registra la venta de lo que se
   * lleva, en una sola operación (sp_exchange_sale). Si lo que se lleva vale
   * más, paga la diferencia con `pago`; si vale menos, la diferencia le regresa
   * con las reglas de una devolución.
   */
  async cambiar(v: VentaParaDevolver, motivo: string, nota: string, userId: number, lleva: LineaCambio[],
                pago: { metodo: MetodoDiferencia | null; recibido: number | null }): Promise<{ ok: boolean; cancelado?: boolean; error?: string; hecho?: CambioHecho }> {
    const items = v.renglones.filter(l => l.cantidad > 0).map(l => ({ productId: l.productId, qty: l.cantidad, unitPrice: l.precio }));
    const r = await this.api?.refundExchange?.({
      sale_id: v.id, user_id: userId, items, motivo, note: nota.trim() || null,
      lleva: lleva.filter(l => l.cantidad > 0).map(l => ({ productId: l.productId, qty: l.cantidad })),
      diff_method: pago.metodo, received: pago.recibido,
      amount: this.total(v), reason: `Cambio · ${motivo} · folio #${v.id}`,
    });
    if (!r?.success) return { ok: false, cancelado: !!r?.cancelado, error: r?.error || 'No se pudo registrar el cambio.' };
    const d = r.data ?? {};
    return { ok: true, hecho: { refundId: Number(d.refund_id), saleId: Number(d.sale_id), devuelto: Number(d.devuelto),
                                lleva: Number(d.lleva), paga: Number(d.paga), regresa: Number(d.regresa) } };
  }

  /** Registrar. La autorización (PIN o app del dueño) la pide el canal si hace falta. */
  async devolver(v: VentaParaDevolver, motivo: string, nota: string, userId: number): Promise<{ ok: boolean; cancelado?: boolean; error?: string; refundId?: number }> {
    const items = v.renglones.filter(l => l.cantidad > 0).map(l => ({ productId: l.productId, qty: l.cantidad, unitPrice: l.precio }));
    const total = this.total(v);
    const r = await this.api?.refundSale?.({
      sale_id: v.id, user_id: userId, payment_method: v.metodo === 'CREDITO' ? 'EFECTIVO' : (v.metodo || 'EFECTIVO'),
      items, motivo, note: nota.trim() || null, apply_net_update: 0,
      /* Para quien autoriza y para la bitácora. */
      amount: total, reason: `Devolución · ${motivo} · folio #${v.id}`,
    });
    if (!r?.success) return { ok: false, cancelado: !!r?.cancelado, error: r?.error || 'No se pudo registrar la devolución.' };
    const fila = Array.isArray(r.data) ? r.data[0] : r.data;
    return { ok: true, refundId: Number(fila?.refund_id) || undefined };
  }
}
