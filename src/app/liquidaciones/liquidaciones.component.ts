import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import * as XLSX from 'xlsx';
import { WxDateComponent } from '../wx-date/wx-date.component';
import { WxSelectComponent, WxOpcion } from '../wx-select/wx-select.component';
import { WxCargandoComponent } from '../wx-cargando/wx-cargando.component';
import { AuthService, PAQUETES } from '../../services/auth.service';
import {
  PLATAFORMAS, nombrePlataforma, leerArchivoPlataforma, depositoEsperado,
  type LecturaPlataforma, type Plataforma,
} from '../../../shared/plataformas';

/** Encabezado de sp_platform_settlement_get / _list. */
interface Liquidacion {
  id: number; platform: Plataforma; period_from: string; period_to: string;
  status: 'BORRADOR' | 'CONFIRMADA' | 'CANCELADA'; source_file: string | null;
  gross_sales: number; marketing: number; service_fees: number; refunds: number;
  isr_withheld: number; iva_withheld: number; other_adjustments: number; iva_rate?: number;
  deposit_expected: number; deposit_real: number | null; deposit_date: string | null; deposit_difference: number | null;
  note?: string | null; created_by_name?: string; confirmed_at?: string | null; confirmed_by_name?: string | null;
  voided_at?: string | null; void_reason?: string | null;
  fee_base?: number; fee_iva?: number; marketing_base?: number; refunds_base?: number;
  pedidos: number; pedidos_ok?: number; pedidos_diferencia?: number; pedidos_faltan: number;
  pedidos_cancelados?: number; caja_sobrantes?: number;
  total_plataforma?: number; total_caja_emparejado?: number; total_faltan?: number; total_sobrantes?: number;
}
type Estado = 'OK' | 'DIFERENCIA' | 'FALTA_EN_CAJA' | 'CANCELADO';
interface Pedido {
  id: number; line_no: number; platform_order_id: string | null; order_at: string | null; customer: string | null;
  fulfillment: string | null; platform_status: string | null; sales_total: number; net_amount: number | null;
  cancelled: boolean; sale_id: number | null; match_kind: 'REFERENCIA' | 'IMPORTE' | 'MANUAL' | null;
  sale_datee: string | null; caja_amount: number | null; caja_reference: string | null; caja_channel: string | null;
  diferencia: number | null; estado: Estado;
}
interface Sobrante { sale_id: number; datee: string; amount: number; reference: string | null; channel_name: string | null; mapped: boolean; }
interface PorCobrar {
  platform: Plataforma; ventas_sin_liquidar: number; importe_sin_liquidar: number; desde_sin_liquidar: string | null;
  liquidaciones_sin_deposito: number; importe_sin_deposito: number;
  isr_retenido: number; iva_retenido: number; iva_comision: number; canales: number;
}
interface CanalVenta { channel_id: string; nombre: string; activo: boolean; plataforma: Plataforma | null; ventas_90d: number; }

/** El desglose que se captura, en pesos con IVA como lo enseña la plataforma. */
interface Desglose {
  ventas: number | null; marketing: number | null; comision: number | null; reembolsos: number | null;
  isr: number | null; iva: number | null; otros: number | null; depositoReal: number | null; fechaDeposito: string | null;
}
const VACIO: Desglose = { ventas: null, marketing: null, comision: null, reembolsos: null, isr: null, iva: null, otros: null, depositoReal: null, fechaDeposito: null };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/*
 * LIQUIDACIONES DE PLATAFORMA (0069).
 *
 * El ticket dice un monto; Uber Eats, Didi o Rappi depositan menos. Aquí se
 * concilia una cosa con la otra: el archivo de pedidos de la plataforma
 * contra las ventas de la caja pagadas en plataforma, y el desglose de lo que
 * descontó (promociones, comisión, reembolsos, retenciones) contra el
 * depósito. Al confirmar, cada cosa va a su lugar en el estado de resultados.
 *
 * El archivo se lee aquí (shared/plataformas.ts). Emparejar, repartir y crear
 * el egreso de comisión lo decide SQL; esta pantalla no calcula resultados.
 */
@Component({
  selector: 'app-liquidaciones',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, WxDateComponent, WxSelectComponent, WxCargandoComponent],
  templateUrl: './liquidaciones.component.html',
  styleUrls: ['./liquidaciones.component.css'],
})
export class LiquidacionesComponent implements OnInit {
  private readonly auth = inject(AuthService);
  readonly nombrePlataforma = nombrePlataforma;
  readonly hoy = iso(new Date());
  readonly opcionesPlataforma: WxOpcion[] = PLATAFORMAS.map((p) => ({ valor: p.id, etiqueta: p.nombre }));
  readonly opcionesLigar: WxOpcion[] = [{ valor: '', etiqueta: 'No es plataforma' }, ...this.opcionesPlataforma];

  readonly puedeAdministrar = computed(() => this.auth.puede(PAQUETES.CONFIGURACION_ADMINISTRAR));

  // ------------------------------------------------------------- lista
  readonly cargando = signal(false);
  readonly error = signal('');
  readonly aviso = signal('');
  readonly liquidaciones = signal<Liquidacion[]>([]);
  readonly porCobrar = signal<PorCobrar[]>([]);
  readonly sinPlataforma = signal<{ ventas: number; importe: number }>({ ventas: 0, importe: 0 });
  readonly canales = signal<CanalVenta[]>([]);
  readonly verCanales = signal(false);
  readonly verCanceladas = signal(false);
  /** Solo las plataformas que el negocio usa: con canal ligado o con liquidaciones. */
  readonly plataformasEnUso = computed(() =>
    this.porCobrar().filter((p) => p.canales > 0 || p.ventas_sin_liquidar > 0 || p.liquidaciones_sin_deposito > 0
      || this.liquidaciones().some((l) => l.platform === p.platform)));
  readonly sinCanales = computed(() => !this.canales().some((c) => c.plataforma));

  // ---------------------------------------------------------- detalle
  /** null: la lista. 0: una nueva. >0: esa liquidación. */
  readonly abierta = signal<number | null>(null);
  readonly liq = signal<Liquidacion | null>(null);
  readonly pedidos = signal<Pedido[]>([]);
  readonly sobrantes = signal<Sobrante[]>([]);
  readonly guardando = signal(false);
  plataforma: Plataforma = 'UBER_EATS';
  desde = iso(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - 7));
  hasta = iso(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - 1));
  d: Desglose = { ...VACIO };
  nota = '';
  readonly lectura = signal<LecturaPlataforma | null>(null);
  readonly archivo = signal<string | null>(null);
  readonly filtro = signal<'TODOS' | Estado>('TODOS');
  readonly confirmando = signal(false);
  readonly cancelando = signal(false);
  motivo = '';
  /** Venta elegida para emparejar a mano, por renglón de pedido. */
  readonly elegida: Record<number, number | null> = {};

  readonly editable = computed(() => this.abierta() === 0 || this.liq()?.status === 'BORRADOR');
  readonly pedidosVisibles = computed(() => {
    const f = this.filtro();
    return f === 'TODOS' ? this.pedidos() : this.pedidos().filter((p) => p.estado === f);
  });
  readonly cuenta = computed(() => {
    const c: Record<string, number> = { OK: 0, DIFERENCIA: 0, FALTA_EN_CAJA: 0, CANCELADO: 0 };
    for (const p of this.pedidos()) c[p.estado]++;
    return c;
  });
  readonly opcionesSobrantes = computed<WxOpcion[]>(() => this.sobrantes().map((s) => ({
    valor: s.sale_id,
    etiqueta: `Folio ${s.sale_id} · ${this.dinero(s.amount)}`,
    nota: `${this.fechaHora(s.datee)}${s.channel_name ? ' · ' + s.channel_name : ''}${s.reference ? ' · ' + s.reference : ''}`,
  })));

  private get api() { return (window as any).electronAPI; }

  ngOnInit() { this.cargar(); }

  async cargar() {
    this.cargando.set(true);
    this.error.set('');
    try {
      const desde = iso(new Date(new Date().getFullYear() - 1, new Date().getMonth(), 1));
      const [l, c] = await Promise.all([
        this.api.plataformasListar({ desde, hasta: this.hoy, canceladas: this.verCanceladas() }),
        this.api.plataformasCanales(),
      ]);
      if (!l?.success) throw Error(l?.error || 'No se pudieron leer las liquidaciones.');
      if (!c?.success) throw Error(c?.error || 'No se pudieron leer los canales.');
      this.liquidaciones.set(l.data.liquidaciones);
      this.porCobrar.set(l.data.porCobrar);
      this.sinPlataforma.set(l.data.sinPlataforma);
      this.canales.set(c.data.canales);
      if (this.sinCanales()) this.verCanales.set(true);
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.cargando.set(false);
    }
  }

  async ligar(c: CanalVenta, plataforma: Plataforma | '') {
    const r = await this.api.plataformasCanalGuardar({ channel_id: c.channel_id, plataforma: plataforma || null });
    if (!r?.success) { this.error.set(r?.error || 'No se pudo guardar.'); return; }
    await this.cargar();
  }

  toggleCanceladas() { this.verCanceladas.update((v) => !v); this.cargar(); }

  // --------------------------------------------------------------- detalle
  nueva() {
    this.abierta.set(0);
    this.liq.set(null);
    this.pedidos.set([]);
    this.sobrantes.set([]);
    this.lectura.set(null);
    this.archivo.set(null);
    this.d = { ...VACIO };
    this.nota = '';
    this.plataforma = this.plataformasEnUso()[0]?.platform ?? 'UBER_EATS';
    this.aviso.set('');
    this.error.set('');
  }

  async abrir(id: number) {
    this.error.set('');
    this.aviso.set('');
    this.lectura.set(null);
    this.archivo.set(null);
    const r = await this.api.plataformasVer({ id });
    if (!r?.success) { this.error.set(r?.error || 'No se pudo abrir la liquidación.'); return; }
    const l: Liquidacion = r.data.liquidacion;
    this.liq.set(l);
    this.pedidos.set(r.data.pedidos);
    this.sobrantes.set(r.data.sobrantes);
    this.plataforma = l.platform;
    this.desde = l.period_from.slice(0, 10);
    this.hasta = l.period_to.slice(0, 10);
    this.d = {
      ventas: l.gross_sales, marketing: l.marketing, comision: l.service_fees, reembolsos: l.refunds,
      isr: l.isr_withheld, iva: l.iva_withheld, otros: l.other_adjustments,
      depositoReal: l.deposit_real, fechaDeposito: l.deposit_date ? l.deposit_date.slice(0, 10) : null,
    };
    this.nota = l.note ?? '';
    this.confirmando.set(false);
    this.cancelando.set(false);
    this.motivo = '';
    for (const k of Object.keys(this.elegida)) delete this.elegida[Number(k)];
    this.abierta.set(id);
  }

  volver() { this.abierta.set(null); this.cargar(); }

  /** El archivo de la plataforma. Se lee aquí, en memoria; no se guarda. */
  async leerArchivo(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    this.error.set('');
    try {
      /* Un CSV se lee como texto (raw): si no, xlsx toma «05/10/2026» como
         mes/día y lo vuelve 10 de mayo. Las fechas de México son día/mes. */
      const csv = /\.csv$/i.test(f.name) || f.type === 'text/csv';
      const libro = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true, raw: csv, codepage: 65001 });
      const hoja = libro.Sheets[libro.SheetNames[0]];
      const filas = XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, raw: true, defval: null });
      const l = leerArchivoPlataforma(filas);
      this.lectura.set(l);
      this.archivo.set(f.name);
      if (l.desde) this.desde = l.desde;
      if (l.hasta) this.hasta = l.hasta > this.hoy ? this.hoy : l.hasta;
      if (this.d.ventas == null) this.d.ventas = l.ventas;
    } catch (e: any) {
      this.lectura.set(null);
      this.archivo.set(null);
      this.error.set(e?.message || 'No se pudo leer el archivo.');
    }
  }

  esperado() {
    return depositoEsperado({
      gross_sales: this.d.ventas ?? 0, marketing: this.d.marketing ?? 0, service_fees: this.d.comision ?? 0,
      refunds: this.d.reembolsos ?? 0, isr_withheld: this.d.isr ?? 0, iva_withheld: this.d.iva ?? 0, other_adjustments: this.d.otros ?? 0,
    });
  }
  /** Lo que se queda la plataforma, como parte de lo que cobraste. */
  retenido() { const v = this.d.ventas ?? 0; return v > 0 ? (100 * (v - this.esperado())) / v : null; }

  async guardar() {
    if (this.desde > this.hasta) { this.error.set('El periodo está al revés.'); return; }
    this.guardando.set(true);
    this.error.set('');
    try {
      const l = this.lectura();
      const r = await this.api.plataformasGuardar({
        id: this.abierta() || null, plataforma: this.plataforma, desde: this.desde, hasta: this.hasta,
        archivo: this.archivo(), ...this.d, nota: this.nota,
        pedidos: l ? l.pedidos : undefined,
      });
      if (!r?.success) throw Error(r?.error || 'No se pudo guardar.');
      await this.abrir(r.data.id);
      this.aviso.set(l ? `Se leyeron ${l.pedidos.length} pedidos y se emparejaron con la caja.` : 'Guardado.');
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.guardando.set(false);
    }
  }

  async emparejar(p: Pedido, venta: number | null) {
    const r = await this.api.plataformasEmparejar({ id: this.abierta(), pedido: p.id, venta });
    if (!r?.success) { this.error.set(r?.error || 'No se pudo emparejar.'); return; }
    delete this.elegida[p.id];
    await this.abrir(this.abierta()!);
  }

  async confirmar() {
    this.guardando.set(true);
    try {
      // Lo capturado en pantalla se guarda primero: se confirma lo que se ve.
      const g = await this.api.plataformasGuardar({
        id: this.abierta(), plataforma: this.plataforma, desde: this.desde, hasta: this.hasta, ...this.d, nota: this.nota,
      });
      if (!g?.success) throw Error(g?.error || 'No se pudo guardar.');
      const r = await this.api.plataformasConfirmar({ id: this.abierta() });
      if (!r?.success) throw Error(r?.error || 'No se pudo confirmar.');
      await this.abrir(this.abierta()!);
      this.aviso.set('Liquidación confirmada: ya cuenta en el estado de resultados.');
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.guardando.set(false);
      this.confirmando.set(false);
    }
  }

  async cancelar() {
    if (!this.motivo.trim()) { this.error.set('Escribe por qué se cancela.'); return; }
    const r = await this.api.plataformasCancelar({ id: this.abierta(), motivo: this.motivo });
    if (!r?.success) { this.error.set(r?.error || 'No se pudo cancelar.'); return; }
    await this.abrir(this.abierta()!);
    this.aviso.set('Liquidación cancelada. Sus ventas quedan libres para otra liquidación.');
  }

  async registrarDeposito() {
    const r = await this.api.plataformasDeposito({ id: this.abierta(), importe: this.d.depositoReal, fecha: this.d.fechaDeposito });
    if (!r?.success) { this.error.set(r?.error || 'No se pudo registrar el depósito.'); return; }
    await this.abrir(this.abierta()!);
    this.aviso.set('Depósito registrado.');
  }

  // --------------------------------------------------------- presentación
  dinero(n: number | null | undefined) {
    const v = Number(n || 0);
    return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  fecha(d: string | null | undefined) { if (!d) return '—'; const [a, m, dia] = d.slice(0, 10).split('-'); return `${dia}/${m}/${a}`; }
  fechaHora(d: string | null | undefined) { return d ? `${this.fecha(d)} ${d.slice(11, 16)}` : '—'; }
  periodo(l: { period_from: string; period_to: string }) { return `${this.fecha(l.period_from)} – ${this.fecha(l.period_to)}`; }
  estadoTexto(e: Estado) {
    return { OK: 'Cuadra', DIFERENCIA: 'Importe distinto', FALTA_EN_CAJA: 'Falta en caja', CANCELADO: 'Cancelado' }[e];
  }
  como(p: Pedido) {
    return p.match_kind === 'REFERENCIA' ? 'por número de pedido' : p.match_kind === 'IMPORTE' ? 'por día e importe' : p.match_kind === 'MANUAL' ? 'a mano' : '';
  }
  pedidoCorto(id: string | null) { return id ? (id.length > 14 ? id.slice(0, 8).toUpperCase() + '…' : id) : '—'; }
}
