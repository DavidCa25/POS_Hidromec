import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WxDateComponent } from '../wx-date/wx-date.component';
import { AuthService, PAQUETES } from '../../services/auth.service';
import { ReportService, ReportConfig, ReportColumn, ReportSeccion } from '../../services/report.service';
import { WxMenuComponent, WxMenuOpcion } from '../wx-menu/wx-menu.component';

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
  /** 0060: lo fabricado del día y su merma. */
  produccion: Producido[];
  mermas: { created_at: string; producto: string; qty: number; reason: string; unit_cost: number | null; costo: number; quien: string | null }[];
}
interface Producido {
  product_id: number; producto: string; existencia: number; planeadas: number; producidas: number; merma_produccion: number;
  costo_unitario: number | null; vendidas: number; traspasadas: number; merma_terminado: number; costo_merma: number;
}

/** Por qué se tiró lo que ya estaba a la venta. */
const MOTIVOS_MERMA = ['No se vendió', 'Se cayó', 'Caducó', 'Otro'];

/** Lo que cuenta la bitácora, dicho para el dueño. */
const EVENTOS: Record<string, string> = {
  CASH_OUT_AUTHORIZED: 'Retiro de efectivo', EXPENSE_AUTHORIZED: 'Egreso', REFUND: 'Devolución',
  SALE_UPDATE: 'Venta modificada', DRAWER_NO_SALE: 'Cajón abierto sin venta', STOCK_ADJUST_AUTHORIZED: 'Ajuste de existencias',
  PURCHASE_AUTHORIZED: 'Compra', SUPPLIER_PAYMENT_AUTHORIZED: 'Pago a proveedor', PRICE_DROP: 'Precio rebajado (vigilado)',
  PRICE_CHANGE: 'Cambio de precio', PROMO_CHANGED: 'Promoción modificada', PROMO_AUTHORIZED: 'Promoción fuera de límite',
  SHIFT_CLOSED: 'Corte cerrado', SHIFT_CLOSED_BY_OTHER: 'Corte cerrado por otra persona', VOID: 'Venta anulada',
  ANULADA: 'Venta anulada', DELETE: 'Producto quitado del ticket', ACTOR_IGNORADO: 'Intento de operar como otra persona',
  APPROVALS_DISABLED: 'Se apagaron las aprobaciones', APPROVALS_ENABLED: 'Se encendieron las aprobaciones',
};
/** Los que el dueño debería mirar dos veces. */
const VIGILADOS = new Set(['PRICE_DROP', 'PROMO_AUTHORIZED', 'DRAWER_NO_SALE', 'REFUND', 'VOID', 'ANULADA', 'ACTOR_IGNORADO', 'STOCK_ADJUST_AUTHORIZED', 'APPROVALS_DISABLED']);

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
  imports: [CommonModule, FormsModule, WxDateComponent, WxMenuComponent],
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

  /* 0060 · Merma de producto terminado (lo que sobró y se tiró). */
  private readonly auth = inject(AuthService);
  readonly motivosMerma = MOTIVOS_MERMA;
  readonly puedeMerma = computed(() => this.auth.puede(PAQUETES.PRODUCCION_OPERAR));
  readonly mermaDe = signal<Producido | null>(null);
  readonly mermaNumero = signal('');
  readonly mermaMotivo = signal<string | null>('No se vendió');
  readonly mermaError = signal<string | null>(null);
  readonly mermaGuardando = signal(false);
  readonly totalMerma = computed(() => (this.datos()?.mermas ?? []).reduce((a, m) => a + Number(m.costo || 0), 0));

  readonly cortesConDiferencia = computed(() =>
    (this.datos()?.cortes ?? []).filter((c) => c.closed_at && Math.abs(Number(c.difference ?? 0)) >= 0.01).length);
  readonly abiertos = computed(() => (this.datos()?.cortes ?? []).filter((c) => !c.closed_at).length);
  readonly totalSalidas = computed(() => (this.datos()?.salidas ?? []).reduce((a, s) => a + Number(s.monto || 0), 0));

  async ngOnInit() { await this.cargar(); }

  /* ------------------------------------------------------- exportar
     El mismo día que se ve, en un PDF o un libro de Excel (una hoja por
     sección): para el contador o para guardar el cierre. */
  private readonly reportes = inject(ReportService);
  readonly opcionesExportar: WxMenuOpcion[] = [
    { valor: 'pdf', etiqueta: 'PDF', icono: 'ph ph-file-pdf' },
    { valor: 'excel', etiqueta: 'Excel', icono: 'ph ph-file-xls' },
  ];

  async exportar(tipo: 'pdf' | 'excel') {
    const d = this.datos();
    if (!d) return;
    const $ = (header: string, key: string): ReportColumn => ({ header, key, width: 14, money: true });
    const txt = (header: string, key: string, width = 18): ReportColumn => ({ header, key, width });
    const suma = (xs: any[], k: string) => xs.reduce((a, x) => a + Number(x[k] || 0), 0);
    const r = d.resumen;
    const cfg: ReportConfig = {
      titulo: 'Cierre del día',
      subtitulo: this.fecha.split('-').reverse().join('/'),
      columns: [], rows: [],
      meta: [
        `Vendido ${this.dinero(r?.vendido ?? 0)} en ${r?.tickets ?? 0} tickets · devoluciones ${this.dinero(r?.devoluciones ?? 0)} · ahorro con promociones ${this.dinero(r?.ahorro_promociones ?? 0)}`,
        `Salió del cajón ${this.dinero(this.totalSalidas())} · ${this.cortesConDiferencia()} cortes con diferencia · ${this.abiertos()} turnos abiertos`,
      ],
      filename: `cierre-del-dia_${this.fecha}`,
      secciones: ([
        {
          titulo: 'Por forma de pago',
          columns: [txt('Forma de pago', 'forma', 24), { header: 'Movimientos', key: 'movimientos', num: true, width: 12 }, $('Importe', 'monto')],
          rows: d.pagos.map((p) => ({ ...p, forma: this.pago(p.metodo) })),
          totals: { monto: suma(d.pagos, 'monto') },
        },
        {
          titulo: 'Cortes de caja',
          nota: 'Diferencia = contado − esperado. Negativa: faltó efectivo.',
          columns: [
            { header: 'Corte', key: 'id', num: true, width: 8 }, txt('Caja', 'caja', 12), txt('Cajero', 'cajero', 14),
            txt('Abrió', 'abrio', 8), txt('Cerró', 'cerro_hora', 8),
            $('Fondo', 'opening_cash'), $('Esperado', 'cash_expected'), $('Contado', 'cash_delivered'), $('Diferencia', 'difference'),
            $('Se queda', 'cash_left'), txt('Cerró / autorizó', 'quien', 18), txt('Nota', 'closing_note', 24),
          ],
          rows: d.cortes.map((c) => ({
            ...c, abrio: this.hora(c.opened_at), cerro_hora: c.closed_at ? this.hora(c.closed_at) : 'Abierto',
            quien: [c.cerro, c.autorizo && c.autorizo !== c.cerro ? `autorizó ${c.autorizo}` : ''].filter(Boolean).join(' · '),
          })),
          totals: { cash_expected: suma(d.cortes, 'cash_expected'), cash_delivered: suma(d.cortes, 'cash_delivered'), difference: suma(d.cortes, 'difference') },
        },
        {
          titulo: 'Salidas de efectivo',
          columns: [txt('Hora', 'hora', 8), txt('Tipo', 'tipo', 20), txt('Caja', 'caja', 12), txt('Quién', 'quien', 14), txt('Nota', 'note', 28), $('Monto', 'monto')],
          rows: d.salidas.map((s) => ({ ...s, hora: this.hora(s.datee) })),
          totals: { monto: this.totalSalidas() },
        },
        {
          titulo: 'Promociones por cajero',
          columns: [txt('Cajero', 'cajero', 20), { header: 'Tickets', key: 'tickets', num: true, width: 10 }, $('Ahorro del cliente', 'ahorro')],
          rows: d.promociones,
          totals: { ahorro: suma(d.promociones, 'ahorro') },
        },
        {
          titulo: 'Producción y mermas',
          columns: [txt('Producto', 'producto', 26), { header: 'Producidas', key: 'producidas', num: true }, { header: 'Vendidas', key: 'vendidas', num: true },
            { header: 'Merma prod.', key: 'merma_produccion', num: true }, { header: 'Merma term.', key: 'merma_terminado', num: true }, $('Costo de merma', 'costo_merma')],
          rows: d.produccion,
          totals: { costo_merma: suma(d.produccion, 'costo_merma') },
        },
        {
          titulo: 'Autorizaciones y alertas',
          columns: [txt('Hora', 'hora', 8), txt('Evento', 'evento', 26), txt('Quién', 'quien', 14), txt('Autorizó', 'autorizo', 14), $('Monto', 'amount'), txt('Detalle', 'detail', 30)],
          rows: d.eventos.map((e) => ({ ...e, hora: this.hora(e.datee), evento: this.evento(e.event_type) + (this.vigilado(e.event_type) ? ' (revisar)' : '') })),
        },
        {
          titulo: 'Ventas del día',
          columns: [{ header: 'Folio', key: 'folio', num: true, width: 8 }, txt('Hora', 'hora', 8), txt('Cajero', 'cajero', 14), txt('Caja', 'caja', 12), txt('Forma de pago', 'forma', 16), $('Ahorro', 'ahorro'), $('Total', 'total')],
          rows: d.ventas.map((v) => ({ ...v, hora: this.hora(v.datee), forma: this.pago(v.payment_method) })),
          totals: { total: suma(d.ventas, 'total') },
        },
      ] as ReportSeccion[]).filter((s) => s.rows.length),
    };
    try {
      if (tipo === 'excel') await this.reportes.exportExcel(cfg);
      else await this.reportes.exportPdf(cfg);
    } catch (e: any) {
      this.error.set(e?.message || 'No se pudo exportar.');
    }
  }

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

  abrirMerma(p: Producido) {
    this.mermaDe.set(p);
    // Wybix propone lo que queda: lo que no se vendió ni se traspasó.
    this.mermaNumero.set(String(Math.max(0, Math.round(Number(p.existencia || 0)))));
    this.mermaMotivo.set('No se vendió');
    this.mermaError.set(null);
  }
  cerrarMerma() { if (!this.mermaGuardando()) this.mermaDe.set(null); }
  teclaMerma(k: string) {
    this.mermaError.set(null);
    let n = this.mermaNumero();
    if (k === 'borrar') n = n.slice(0, -1);
    else if (k === 'limpiar') n = '';
    else if (n.length < 4) n = (n === '0' ? '' : n) + k;
    this.mermaNumero.set(n);
  }
  async guardarMerma() {
    const p = this.mermaDe();
    const cantidad = Number(this.mermaNumero() || 0);
    if (!p) return;
    if (cantidad <= 0) { this.mermaError.set('Indica cuántas piezas se tiraron.'); return; }
    if (!this.mermaMotivo()) { this.mermaError.set('Elige el motivo.'); return; }
    this.mermaGuardando.set(true);
    try {
      const r = await (window as any).wybix?.produccion?.merma?.({ productId: p.product_id, cantidad, motivo: this.mermaMotivo(), uuid: crypto.randomUUID() });
      if (!r?.success) { this.mermaError.set(r?.error || 'No se pudo registrar.'); return; }
      this.mermaDe.set(null);
      await this.cargar();
    } finally {
      this.mermaGuardando.set(false);
    }
  }
  redondo(n: number | null | undefined) { return Math.round(Number(n || 0) * 100) / 100; }

  pago(m: string) { return PAGOS[String(m || '').toUpperCase()] ?? m; }
  evento(t: string) { return EVENTOS[t] ?? t; }
  vigilado(t: string) { return VIGILADOS.has(t); }
  hora(d: string | null) {
    if (!d) return '—';
    const x = new Date(d);
    // mssql entrega la hora de pared como UTC (ver fechaSql): se lee en UTC.
    return Number.isNaN(x.getTime()) ? '—' : x.toLocaleTimeString('es-MX', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
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
