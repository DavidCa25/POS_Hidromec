import {WxSelectComponent,WxOpcion} from '../../app/wx-select/wx-select.component';
import { ReceiptViewer } from '../../app/receipt-viewer/receipt-viewer.component';
import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgIf, NgFor, CurrencyPipe, DatePipe, NgClass } from '@angular/common';
import { AuthService, PAQUETES } from '../../services/auth.service';
import { SupervisorAuthService } from '../../services/supervisor.service';
import { ShiftService, fechaLocal } from '../../core';
import Swal from 'sweetalert2';
import { WxDateComponent } from '../../app/wx-date/wx-date.component';

type TipoMov = 'SALE' | 'DEPOSIT' | 'WITHDRAW' | 'REFUND' | string;

interface CashMovementRow {
  id: number;
  datee: string | Date;
  user_id: number;
  user_name: string;
  typee: TipoMov;
  amount: number;
  reference_id: number | null;
  reference: string | null;
  note: string | null;
  closure_id: number | null;
  payment_method?: string | null;
  /* 0049: los clasifica SQL con el catalogo de tipos. */
  grupo?: GrupoCaja;
  tipo_label?: string;
  concepto?: string;
}

/** Renglones del corte, en el orden en que suman al efectivo esperado. */
type GrupoCaja = 'FONDO' | 'VENTAS' | 'ABONOS' | 'ENTRADAS' | 'DEVOLUCIONES' | 'AJUSTES'
  | 'RETIROS' | 'PROVEEDORES' | 'EGRESOS' | 'OTROS';

interface LineaDesglose { grupo: GrupoCaja; concepto: string; total: number; movimientos: number; }

const GRUPOS_CAJA: { grupo: GrupoCaja; etiqueta: string }[] = [
  { grupo: 'VENTAS', etiqueta: 'Ventas en efectivo' },
  { grupo: 'ABONOS', etiqueta: 'Abonos de clientes en efectivo' },
  { grupo: 'ENTRADAS', etiqueta: 'Otras entradas de efectivo' },
  { grupo: 'RETIROS', etiqueta: 'Retiros de caja' },
  { grupo: 'PROVEEDORES', etiqueta: 'Pagos a proveedores' },
  { grupo: 'EGRESOS', etiqueta: 'Egresos' },
  { grupo: 'DEVOLUCIONES', etiqueta: 'Devoluciones' },
  { grupo: 'AJUSTES', etiqueta: 'Ajustes de venta' },
  { grupo: 'OTROS', etiqueta: 'Otros movimientos' },
];

interface Summary {
  ventas_plataforma?:number;
  total_entradas: number;
  total_salidas: number;
  neto: number;
  opening_cash?: number;
  cash_expected?: number;

  ventas_efectivo?: number;
  ventas_tarjeta?: number;
  ventas_transferencia?: number;
  ventas_mp?: number;
  ventas_credito?: number;
}

interface RegisterOption {
  id: number;
  name: string;
}

interface Breakdown {
  ventasPlataforma:number;
  ventasEfectivo: number;
  ventasTarjeta: number;
  ventasTransferencia: number;
  ventasMercadoPago: number;
  ventasCredito: number;
  entradasEfectivo: number;
  salidasEfectivo: number;
  devolucionesEfectivo: number;
}

type Mode = 'TURNO' | 'DIA';

@Component({
  selector: 'app-corte',
  templateUrl: './corte.html',
  standalone: true,
  imports: [WxSelectComponent,ReceiptViewer,RouterOutlet, FormsModule, NgIf, NgFor, CurrencyPipe, DatePipe, NgClass, WxDateComponent],
  styleUrls: ['./corte.css']
})
export class Corte {
  closedOptions:WxOpcion[]=[];selectedClosed:number|null=null;
  async cargarCortes(){const r=await (window as any).electronAPI.ticketClosures({registerId:this.selectedRegisterId});this.closedOptions=(r?.data??[]).map((c:any)=>({valor:c.id,etiqueta:'#'+c.id+' · '+c.register_name,nota:new Date(c.closed_at).toLocaleString('es-MX')}));}
  receiptId:number|null=null;lastClosedId:number|null=null;
  verCorte(){this.receiptId=this.lastClosedId;}
  hoy = new Date();

  // Wizard control
  currentStep = 1;

  cajas: RegisterOption[] = [];
  selectedRegisterId: number | null = null;

  showCloseModal = false;
  cashDelivered: number | null = null;
  /** 0056: efectivo que se queda en la caja al cerrar (fondo del siguiente turno). */
  cashLeft: number | null = null;
  get cashLeftInvalido(): boolean {
    return this.cashLeft !== null && this.cashLeft !== undefined && (this.cashLeft as any) !== ''
      && (Number(this.cashLeft) < 0 || (this.cashDelivered !== null && Number(this.cashLeft) > Number(this.cashDelivered)));
  }
  closeNotes = '';

  closing = false;

  showFilters = true;
  loading = false;

  // Modo: TURNO (para cerrar) vs DIA (reporte)
  mode: Mode = 'TURNO';

  // Filtros (para DIA / reportes)
  preset: 'HOY'|'AYER'|'SEMANA'|null = 'HOY';
  desdeStr = '';
  hastaStr = '';

  // TURNO
  onlyOpen = true;
  openShiftId: number | null = null;
  openShiftOpenedAt: Date | null = null;
  openShiftOpeningCash = 0;

  movimientos: CashMovementRow[] = [];
  summary: Summary = { total_entradas: 0, total_salidas: 0, neto: 0 };
  /* El desglose por grupo y concepto, tal como lo arma SQL. La suma de sus
     totales es exactamente el neto: nada que sume al esperado queda fuera. */
  desglose: LineaDesglose[] = [];

  breakdown: Breakdown = {
    ventasEfectivo: 0, ventasTarjeta: 0, ventasTransferencia: 0,
    ventasPlataforma:0, ventasMercadoPago: 0, ventasCredito: 0, entradasEfectivo: 0,
    salidasEfectivo: 0, devolucionesEfectivo: 0
  };

  constructor(private auth: AuthService, private shift: ShiftService, private supervisor: SupervisorAuthService) {
    this.setPreset('HOY');
  }

  async ngOnInit() {
    await this.cargarCajas();
  }

  private toStr(d: Date){ return fechaLocal(d); }

  private startOfWeek(d: Date){
    const x = new Date(d);
    const dow = x.getDay();
    const diff = (dow === 0 ? -6 : 1) - dow;
    x.setDate(x.getDate() + diff);
    x.setHours(0,0,0,0);
    return x;
  }

  setPreset(p: 'HOY'|'AYER'|'SEMANA'){
    this.preset = p;
    const today = new Date(); today.setHours(0,0,0,0);

    if (p === 'HOY'){
      this.desdeStr = this.toStr(today);
      this.hastaStr = this.toStr(today);
    } else if (p === 'AYER'){
      const y = new Date(today); y.setDate(y.getDate()-1);
      this.desdeStr = this.toStr(y);
      this.hastaStr = this.toStr(y);
    } else {
      const ini = this.startOfWeek(today);
      this.desdeStr = this.toStr(ini);
      this.hastaStr = this.toStr(today);
    }
  }

  // ===== WIZARD NAVIGATION =====
  async selectRegister(registerId: number) {
    this.selectedRegisterId = registerId;
    await this.onRegisterChange();
  }

  nextStep() {
    if (this.currentStep < 3) {
      this.currentStep++;
    }
  }

  prevStep() {
    if (this.currentStep > 1) {
      this.currentStep--;
    }
  }

  async selectMode(mode: Mode) {
    this.mode = mode;
    if (mode === 'TURNO') {
      this.onlyOpen = true;
      if (this.selectedRegisterId) {
        await this.fetchOpenShiftForSelectedRegister();
      }
    } else {
      this.setPreset('HOY');
    }
  }

  get canConsult(): boolean {
    if (!this.selectedRegisterId) return false;
    if (this.mode === 'TURNO') {
      return !!this.openShiftId;
    }
    return true;
  }

  get canClose(): boolean {
    if (!this.selectedRegisterId) return false;
    if (this.mode === 'TURNO') {
      return !!this.openShiftId;
    }
    return true;
  }

  editarFiltros(){
    this.showFilters = true;
    this.currentStep = 1;
  }

  limpiar(){
    this.preset = null;
    this.desdeStr = '';
    this.hastaStr = '';
    this.onlyOpen = true;
    this.selectedRegisterId = null;
    this.mode = 'TURNO';

    this.openShiftId = null;
    this.openShiftOpenedAt = null;
    this.openShiftOpeningCash = 0;

    this.movimientos = [];
    this.summary = { total_entradas: 0, total_salidas: 0, neto: 0 };
    this.showFilters = true;
    this.currentStep = 1;
  }

  async onRegisterChange() {
    this.openShiftId = null;
    this.openShiftOpenedAt = null;
    this.openShiftOpeningCash = 0;

    if (this.mode === 'TURNO' && this.selectedRegisterId) {
      await this.fetchOpenShiftForSelectedRegister();
    }
  }

  private async fetchOpenShiftForSelectedRegister(): Promise<boolean> {
    const api = (window as any).electronAPI;
    if (!api?.getOpenShift) return false;
    if (!this.selectedRegisterId) return false;

    // Resuelve turno mediante register_id en lugar de user_id
    const resp = await api.getOpenShift({ register_id: this.selectedRegisterId });

    if (!resp?.success) return false;

    const row = resp.data;
    const isOpen = !!row?.id && (row.closed_at == null);

    if (!isOpen) {
      this.openShiftId = null;
      this.openShiftOpenedAt = null;
      this.openShiftOpeningCash = 0;
      return false;
    }

    this.openShiftId = Number(row.id);
    this.openShiftOpenedAt = row.opened_at ? new Date(row.opened_at) : null;
    this.openShiftOpeningCash = Number(row.opening_cash ?? 0);
    return true;
  }

  async consultar() {
    void this.cargarCortes();
    if (!this.selectedRegisterId) {
      await Swal.fire({
        icon: 'warning', title: 'Selecciona una caja', text: 'Elige una caja para consultar.', confirmButtonColor: '#10b981'
      });
      return;
    }

    this.loading = true;
    try {
      if (this.mode === 'TURNO') {
        const ok = await this.fetchOpenShiftForSelectedRegister();
        if (!ok || !this.openShiftId) {
          this.movimientos = [];
          this.summary = { total_entradas: 0, total_salidas: 0, neto: 0 };
          await Swal.fire({
            icon: 'info', title: 'Sin turno abierto', text: 'Esta caja no tiene un turno abierto para cerrar.', confirmButtonColor: '#10b981'
          });
          return;
        }
      }

      const payload = {
        start_date: this.mode === 'DIA' ? (this.desdeStr || null) : null,
        end_date:   this.mode === 'DIA' ? (this.hastaStr || null) : null,
        register_id: this.selectedRegisterId,
        typee:      null,
        closure_id: this.mode === 'TURNO' ? this.openShiftId : null,
        only_open:  this.mode === 'TURNO' ? 1 : (this.onlyOpen ? 1 : 0),
      };

      const res = await (window as any).electronAPI.getCashMovements(payload);
      this.desglose = [];

      this.breakdown = {
        ventasEfectivo: 0, ventasTarjeta: 0, ventasTransferencia: 0,
        ventasPlataforma:0, ventasMercadoPago: 0, ventasCredito: 0, entradasEfectivo: 0,
        salidasEfectivo: 0, devolucionesEfectivo: 0
      };

      if (res?.success) {
        const rows: CashMovementRow[] = (res.data?.rows ?? []).map((r: any) => ({
          ...r,
          datee: new Date(r.datee)
        }));

        this.movimientos = rows;
        this.summary = res.data?.summary ?? { total_entradas: 0, total_salidas: 0, neto: 0 };
        this.desglose = (res.data?.desglose ?? []).map((d: any) => ({
          grupo: d.grupo, concepto: d.concepto, total: Number(d.total ?? 0), movimientos: Number(d.movimientos ?? 0),
        }));
        this.showFilters = false;

        this.breakdown.ventasEfectivo = Number(this.summary.ventas_efectivo || 0);
        this.breakdown.ventasTarjeta = Number(this.summary.ventas_tarjeta || 0);
        this.breakdown.ventasTransferencia = Number(this.summary.ventas_transferencia || 0);
        this.breakdown.ventasMercadoPago = Number(this.summary.ventas_mp || 0);
        this.breakdown.ventasPlataforma=Number(this.summary.ventas_plataforma||0);
        this.breakdown.ventasCredito = Number(this.summary.ventas_credito || 0);
      } else {
        this.movimientos = [];
        this.summary = { total_entradas: 0, total_salidas: 0, neto: 0 };
      }
    } catch (e) {
      console.error('getCashMovements:', e);
      this.movimientos = [];
      this.summary = { total_entradas: 0, total_salidas: 0, neto: 0 };
    } finally {
      this.loading = false;
    }
  }

  /** Fondo inicial del periodo: el del turno, o el de los turnos del rango. */
  get fondoInicial(): number {
    const f = (this.summary as any)?.opening_cash;
    return Number(f ?? (this.mode === 'TURNO' ? this.openShiftOpeningCash : 0));
  }

  /** Lineas del efectivo esperado: solo los grupos con movimientos. */
  get lineasCaja(): { grupo: GrupoCaja; etiqueta: string; total: number; conceptos: LineaDesglose[] }[] {
    return GRUPOS_CAJA
      .map(g => {
        const conceptos = this.desglose.filter(d => d.grupo === g.grupo);
        return { ...g, total: conceptos.reduce((a, d) => a + d.total, 0), conceptos };
      })
      .filter(l => l.conceptos.length > 0);
  }

  /** Lo que salio del cajon, agrupado: retiro, proveedor y egreso por separado. */
  get salidasPorConcepto(): { grupo: string; concepto: string; total: number; movimientos: number }[] {
    const etiqueta = (g: GrupoCaja) => GRUPOS_CAJA.find(x => x.grupo === g)?.etiqueta ?? g;
    return this.desglose
      .filter(d => d.total < 0 && ['RETIROS', 'PROVEEDORES', 'EGRESOS', 'DEVOLUCIONES', 'AJUSTES', 'OTROS'].includes(d.grupo))
      .map(d => ({ grupo: etiqueta(d.grupo), concepto: d.concepto, total: -d.total, movimientos: d.movimientos }));
  }

  /**
   * CORTE CIEGO. Quien cuenta el cajón sin ser Encargado captura lo que contó
   * SIN ver antes lo esperado ni la diferencia: así no hay número al que
   * «cuadrar» el conteo. Esperado y diferencia aparecen al confirmar, cuando el
   * corte ya quedó registrado. El Encargado los sigue viendo: revisar es su
   * trabajo. El cierre guarda si fue a ciegas.
   */
  get corteCiego(): boolean {
    // 0056: quien tiene «Cortes de caja» tambien revisa: ve lo esperado.
    return !this.auth.puede(PAQUETES.VENTAS_SUPERVISAR) && !this.auth.puede(PAQUETES.CAJA_CORTES);
  }

  get cashExpected(): number {
    const fromDb = (this.summary as any)?.cash_expected;
    if (fromDb != null) return Number(Number(fromDb).toFixed(2));

    const opening = Number((this.summary as any)?.opening_cash ?? this.openShiftOpeningCash ?? 0);
    const neto = Number(this.summary?.neto ?? 0);
    return Number((opening + neto).toFixed(2));
  }


  get cashDiff(): number {
    const d = (this.cashDelivered ?? 0) - this.cashExpected;
    return Number(d.toFixed(2));
  }

  abrirModalCierre() {
    if (this.mode !== 'TURNO') {
      Swal.fire({
        icon: 'info',
        title: 'Modo reporte',
        text: 'Para cerrar un turno, cambia a modo TURNO.',
        confirmButtonColor: '#10b981'
      });
      return;
    }
    this.cashDelivered = null;
    this.cashLeft = null;
    this.closeNotes = '';
    this.showCloseModal = true;
  }

  cerrarModalCierre() {
    this.showCloseModal = false;
  }

  async confirmarCierreReal() {
    if (!this.selectedRegisterId) {
      await Swal.fire({
        icon: 'warning',
        title: 'Selecciona una caja',
        text: 'Debes elegir la caja a la que le vas a hacer el corte.',
        confirmButtonColor: '#10b981'
      });
      return;
    }

    if (!this.openShiftId) {
      await Swal.fire({
        icon: 'warning',
        title: 'Sin turno abierto',
        text: 'No hay turno abierto detectado para cerrar en esta caja.',
        confirmButtonColor: '#10b981'
      });
      return;
    }

    if (this.cashDelivered == null) {
      await Swal.fire({
        icon: 'warning',
        title: 'Falta efectivo entregado',
        text: 'Captura el efectivo físico contado en caja.',
        confirmButtonColor: '#10b981'
      });
      return;
    }
    this.closing = true;

    // Quien CIERRA el turno lo decide el proceso principal con la SESIÓN: aquí
    // ya no se manda `user_id` (si se mandara, se ignoraría).
    const closureId = Number(this.openShiftId);

    if (!Number.isFinite(closureId) || closureId <= 0) {
      await Swal.fire({ icon: 'error', title: 'closure_id inválido', text: String(this.openShiftId) });
      this.closing = false;
      return;
    }
    try {
      const cerrar = (autorizacion?: string) => (window as any).electronAPI.closeShift({
        closure_id: closureId,
        // La caja que se está cerrando, la misma que usan `getOpenShift` y el
        // resumen de esta pantalla. Faltaba: sin ella el proceso principal
        // mandaba `register_id` nulo y el procedimiento caía a "la primera
        // caja de la tabla", o sea la Caja 1. La laptop, cerrando su Caja 2,
        // recibía "esta caja la está usando DESKTOP-LNQIU8G": cierto de la
        // Caja 1, que no era la suya. Abrir, vender y cerrar tienen que
        // hablar todos de la MISMA caja.
        register_id: this.selectedRegisterId,
        cash_delivered: Number(this.cashDelivered),
        cash_left: this.cashLeft === null || this.cashLeft === undefined || (this.cashLeft as any) === '' ? null : Number(this.cashLeft),
        note: (this.closeNotes || '').trim() || null,
        blind: this.corteCiego,
        autorizacion,
      });
      let resp = await cerrar();

      /* El turno es de otra persona: hace falta que un encargado lo autorice
         con su PIN (o que el encargado que está cerrando confirme con el suyo).
         El comprobante se gasta en ese cierre y no sirve para nada más. */
      if (!resp?.success && resp?.requiereAutorizacion) {
        // 0056: quien tiene «Cortes de caja» confirma con su propio PIN.
        const propio = this.auth.puede(PAQUETES.CAJA_CORTES);
        const token = await this.supervisor.autorizarConPin(
          'Este turno es de otra persona. Cerrarlo requiere la autorización de un encargado.',
          'sp-close-shift', propio);
        if (!token) return;
        resp = await cerrar(token);
      }

      if (!resp?.success) {
        await Swal.fire({
          icon: 'error',
          title: 'No se pudo cerrar el turno',
          text: resp?.error || 'Ocurrió un error al registrar el cierre.',
          confirmButtonColor: '#10b981'
        });
        return;
      }

      const data = resp.data || {};
      this.lastClosedId=closureId;
      void this.cargarCortes();
      await Swal.fire({
        icon: 'success',
        title: '¡Corte registrado exitosamente!',
        html: `
          <div style="text-align:left; background: var(--wx-raised); padding: 1.5rem; border-radius: 12px; margin-top: 1rem;">
            <div style="margin-bottom: 0.75rem; display: flex; justify-content: space-between;">
              <span style="font-weight: 600; color: var(--wx-text-muted);">Caja:</span>
              <span style="font-weight: 600;">${this.selectedRegisterName}</span>
            </div>
            <div style="margin-bottom: 0.75rem; display: flex; justify-content: space-between;">
              <span style="font-weight: 600; color: var(--wx-text-muted);">Turno ID:</span>
              <span style="font-weight: 600;">#${this.openShiftId}</span>
            </div>
            <div style="margin-bottom: 0.75rem; display: flex; justify-content: space-between;">
              <span style="font-weight: 600; color: var(--wx-text-muted);">Efectivo esperado:</span>
              <span style="font-weight: 600;">$${(data.cash_expected ?? this.cashExpected).toFixed(2)}</span>
            </div>
            <div style="margin-bottom: 0.75rem; display: flex; justify-content: space-between;">
              <span style="font-weight: 600; color: var(--wx-text-muted);">Efectivo entregado:</span>
              <span style="font-weight: 600;">$${(data.cash_delivered ?? this.cashDelivered).toFixed(2)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding-top: 0.75rem; border-top: 2px solid var(--wx-edge);">
              <span style="font-weight: 600; color: var(--wx-text);">Diferencia:</span>
              <span style="font-weight: 600; font-size: 1.2rem; color: ${(data.difference ?? this.cashDiff) >= 0 ? '#16a34a' : '#dc2626'};">
                $${(data.difference ?? this.cashDiff).toFixed(2)}
              </span>
            </div>
          </div>
        `,
        confirmButtonColor: '#10b981'
      });

      this.showCloseModal = false;
      this.receiptId=closureId;
      this.openShiftId = null;
      this.openShiftOpenedAt = null;
      this.openShiftOpeningCash = 0;

      // El turno vive tambien en ShiftService, que es de donde leen las
      // pantallas de venta. Esta pantalla limpiaba solo SUS campos, asi que el
      // servicio seguia diciendo "abierto" el resto de la sesion y Retail
      // entraba a vender sin pedir turno. Se relee de SQL en vez de asumir:
      // aqui se puede haber cerrado el turno de OTRA caja.
      await this.shift.refresh();

      await this.consultar();
    } catch (e: any) {
      console.error('closeShift:', e);
      await Swal.fire({
        icon: 'error',
        title: 'Error inesperado',
        text: e?.message || 'Ocurrió un error al registrar el cierre.',
        confirmButtonColor: '#10b981'
      });
    } finally {
      this.closing = false;
    }
  }

  private async cargarCajas() {
    // Las cajas son las que el negocio dio de alta. Inventar "Caja 1"/"Caja 2"
    // cuando la consulta falla no es un respaldo: es cerrar un turno contra una
    // caja que no existe. Si no se pueden leer, se dice y la lista queda vacia.
    try {
      const res = await (window as any).electronAPI.registersList(true);
      if (!res?.success) throw new Error(res?.error || 'No se pudieron leer las cajas.');
      this.cajas = res.data || [];
    } catch (e: any) {
      console.error('registers-list:', e);
      this.cajas = [];
      await Swal.fire('No se pudieron cargar las cajas',
        e?.message || 'Revisa la conexión con el servidor.', 'error');
    }
  }

  get selectedRegisterName(): string {
    const c = this.cajas.find(x => x.id === this.selectedRegisterId);
    return c ? c.name : '';
  }

  get totalVentasGenerales(): number {
    return this.breakdown.ventasPlataforma + this.breakdown.ventasEfectivo +
           this.breakdown.ventasTarjeta +
           this.breakdown.ventasTransferencia +
           this.breakdown.ventasMercadoPago +
           this.breakdown.ventasCredito;
  }
}