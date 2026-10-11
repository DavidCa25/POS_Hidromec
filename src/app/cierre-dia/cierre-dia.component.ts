import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WxDateComponent } from '../wx-date/wx-date.component';

interface Corte {
  id: number; caja: string | null; cajero: string | null; opened_at: string; closed_at: string | null;
  opening_cash: number | null; cash_expected: number | null; cash_delivered: number | null; difference: number | null;
  cash_left: number | null; closing_note: string | null; a_ciegas: boolean; cerro: string | null; autorizo: string | null;
}
interface Cierre {
  resumen: { tickets: number; vendido: number; ahorro_promociones: number; tickets_con_promocion: number; devoluciones: number; devoluciones_n: number } | null;
  pagos: { metodo: string; monto: number; movimientos: number }[];
  cortes: Corte[];
  salidas: { datee: string; tipo: string; grupo: string; monto: number; note: string | null; quien: string | null; caja: string | null }[];
  promociones: { cajero: string; tickets: number; ahorro: number }[];
  eventos: { datee: string; event_type: string; amount: number | null; detail: string | null; quien: string | null; autorizo: string | null }[];
  ventas: { folio: number; datee: string; cajero: string | null; caja: string | null; total: number; payment_method: string; ahorro: number | null }[];
}

/** Lo que cuenta la bitácora, dicho para el dueño. */
const EVENTOS: Record<string, string> = {
  CASH_OUT_AUTHORIZED: 'Retiro de efectivo', EXPENSE_AUTHORIZED: 'Egreso', REFUND: 'Devolución',
  SALE_UPDATE: 'Venta modificada', DRAWER_NO_SALE: 'Cajón abierto sin venta', STOCK_ADJUST_AUTHORIZED: 'Ajuste de existencias',
  PURCHASE_AUTHORIZED: 'Compra', SUPPLIER_PAYMENT_AUTHORIZED: 'Pago a proveedor', PRICE_DROP: 'Precio rebajado (vigilado)',
  PRICE_CHANGE: 'Cambio de precio', PROMO_CHANGED: 'Promoción modificada', PROMO_AUTHORIZED: 'Promoción fuera de límite',
  SHIFT_CLOSED: 'Corte cerrado', SHIFT_CLOSED_BY_OTHER: 'Corte cerrado por otra persona', VOID: 'Venta anulada',
  ANULADA: 'Venta anulada', DELETE: 'Producto quitado del ticket', ACTOR_IGNORADO: 'Intento de operar como otra persona',
};
/** Los que el dueño debería mirar dos veces. */
const VIGILADOS = new Set(['PRICE_DROP', 'PROMO_AUTHORIZED', 'DRAWER_NO_SALE', 'REFUND', 'VOID', 'ANULADA', 'ACTOR_IGNORADO', 'STOCK_ADJUST_AUTHORIZED']);

const PAGOS: Record<string, string> = {
  EFECTIVO: 'Efectivo', TARJETA: 'Tarjeta', TRANSFERENCIA: 'Transferencia', CREDITO: 'Crédito',
  MIXTO: 'Mixto', PLATAFORMA: 'Plataformas', TERMINAL_MP: 'Terminal Mercado Pago',
};

const hoyLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/*
 * ROLES V2 · CIERRE DEL DÍA.
 *
 * Una sola pantalla para responder «¿cómo cerró el día?» sin ir caja por caja:
 * lo vendido, los cortes de todas las cajas (esperado, contado, diferencia y
 * lo que se quedó), lo que salió del cajón, las promociones por cajero y lo
 * que se autorizó. Se abre desde Inicio; la ven el Encargado y el
 * Administrador (el canal exige REPORTES_VER).
 */
@Component({
  selector: 'app-cierre-dia',
  standalone: true,
  imports: [CommonModule, FormsModule, WxDateComponent],
  templateUrl: './cierre-dia.component.html',
  styleUrls: ['./cierre-dia.component.css'],
})
export class CierreDiaComponent implements OnInit {
  private get api() { return (window as any).electronAPI; }

  fecha = hoyLocal();
  readonly hoy = hoyLocal();
  readonly datos = signal<Cierre | null>(null);
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly verVentas = signal(false);

  readonly cortesConDiferencia = computed(() =>
    (this.datos()?.cortes ?? []).filter((c) => c.closed_at && Math.abs(Number(c.difference ?? 0)) >= 0.01).length);
  readonly abiertos = computed(() => (this.datos()?.cortes ?? []).filter((c) => !c.closed_at).length);
  readonly totalSalidas = computed(() => (this.datos()?.salidas ?? []).reduce((a, s) => a + Number(s.monto || 0), 0));

  async ngOnInit() { await this.cargar(); }

  async cargar() {
    this.cargando.set(true);
    this.error.set('');
    try {
      const r = await this.api?.reporteCierreDia?.({ fecha: this.fecha || this.hoy });
      if (!r?.success) throw new Error(r?.error || 'No se pudo cargar el cierre del día.');
      this.datos.set(r.data as Cierre);
    } catch (e: any) {
      this.datos.set(null);
      this.error.set(e?.message || 'No se pudo cargar el cierre del día.');
    } finally {
      this.cargando.set(false);
    }
  }

  async cambiarFecha(f: string | null) { this.fecha = f || this.hoy; await this.cargar(); }

  pago(m: string) { return PAGOS[String(m || '').toUpperCase()] ?? m; }
  evento(t: string) { return EVENTOS[t] ?? t; }
  vigilado(t: string) { return VIGILADOS.has(t); }
  hora(d: string | null) {
    if (!d) return '—';
    const x = new Date(d);
    return Number.isNaN(x.getTime()) ? '—' : x.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  }
  dinero(n: number | null | undefined) {
    return n == null ? '—' : Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  }
  tonoDiferencia(c: Corte) {
    if (!c.closed_at) return 'abierto';
    const d = Number(c.difference ?? 0);
    return Math.abs(d) < 0.01 ? 'ok' : d < 0 ? 'falta' : 'sobra';
  }
}
