import { Component, HostListener, OnInit } from '@angular/core';
import { WxTablaBarraComponent } from '../app/wx-tabla/wx-tabla-barra.component';
import { EstadoTabla, WxItem } from '../app/wx-tabla/tabla-estado';
import { RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import Swal from 'sweetalert2';
import { CatalogosService, CatalogoItem } from '../services/catalogos.service';
import { WxSelectComponent, WxOpcion } from '../app/wx-select/wx-select.component';
import { WxAvatarComponent } from '../app/wx-avatar/wx-avatar.component';
import { AuthService } from '../services/auth.service';

const PLIEGUE = 'wx-clientes:pliegue:';
function leerPliegue(seccion: string, porDefecto: boolean): boolean {
  try {
    const v = localStorage.getItem(PLIEGUE + seccion);
    return v === null ? porDefecto : v === '1';
  } catch { return porDefecto; }
}
function guardarPliegue(seccion: string, abierta: boolean) {
  try { localStorage.setItem(PLIEGUE + seccion, abierta ? '1' : '0'); } catch { /* noop */ }
}

type Cliente = {
  id: number;
  code?: string;
  name: string;
  tax_id?: string;          
  regimen_fiscal?: string;  
  uso_cfdi?: string;        
  razon_social?: string;    
  phone?: string;
  email?: string;
  creditLimit: number;
  termsDays: number;
  active: boolean;

  graceDays?: number;
  lateFeePct?: number;
  lateFeeFixed?: number;
  riskLevel?: number;

  /* ESTADO DE CUENTA: lo calcula sp_get_customers desde las ventas a credito.
     No se captura: antes eran «Saldo (demo)» y «# vencidos (demo)», campos
     que se editaban a mano y no se guardaban en ningun lado. */
  balance: number;
  overdueCount: number;
  overdueBalance?: number;
  availableCredit?: number;
  nextDueDate?: string | null;
  maxDaysLate?: number;
  lateFeeEstimate?: number;
  /** Por que no se le puede vender a credito (null = si se puede). */
  creditBlock?: BloqueoCredito | null;
};

type BloqueoCredito = 'INACTIVO' | 'SIN_LIMITE' | 'RIESGO' | 'VENCIDAS' | 'SIN_DISPONIBLE';

/** Lo que se le dice a la persona. `SIN_LIMITE` no se dice: es no dar credito. */
const MOTIVO_BLOQUEO: Record<BloqueoCredito, string> = {
  INACTIVO: 'Está inactivo.',
  SIN_LIMITE: 'No tiene crédito autorizado.',
  RIESGO: 'Está en riesgo alto: el crédito nuevo está suspendido.',
  VENCIDAS: 'Tiene ventas vencidas: hay que abonar antes de fiarle otra vez.',
  SIN_DISPONIBLE: 'Ya usó todo su límite.',
};

type ClienteVenta = {
  id: number;
  datee: string;
  total: number;
  paid_amount: number;
  balance: number;
  due_date: string | null;
  daysLate: number;
  overdue: boolean;
  lateFee: number;
};

@Component({
  selector: 'app-clientes',
  templateUrl: './clientes.html',
  imports: [WxTablaBarraComponent, WxAvatarComponent, 
    RouterOutlet,
    FormsModule,
    CommonModule,
    DatePipe,
    DecimalPipe,
    WxSelectComponent
  ],
  styleUrls: ['./clientes.css']
})
export class Clientes implements OnInit {


  // Listas de los selectores. Son las mismas opciones que habia en el marcado,
  // movidas aqui para que las consuma la primitiva. No cambia ningun valor.
  readonly opcEstado: WxOpcion[] = [
    { valor: 'todos', etiqueta: 'Todos' },
    { valor: 'activos', etiqueta: 'Activos' },
    { valor: 'inactivos', etiqueta: 'Inactivos' },
  ];
  readonly opcActivo: WxOpcion[] = [
    { valor: true, etiqueta: 'Sí' },
    { valor: false, etiqueta: 'No' },
  ];
  /* Los valores no cambian (0-3, ya guardados en la base). Lo que cambia es
     que el 3 ahora HACE algo: sp_register_sale no le vende a credito. */
  readonly opcRiesgo: WxOpcion[] = [
    { valor: 0, etiqueta: 'Normal' },
    { valor: 1, etiqueta: 'Bajo' },
    { valor: 2, etiqueta: 'Medio', nota: 'Se avisa en caja' },
    { valor: 3, etiqueta: 'Alto', nota: 'Sin crédito nuevo' },
  ];
  readonly opcMetodoAbono: WxOpcion[] = [
    { valor: 'EFECTIVO', etiqueta: 'Efectivo' },
    { valor: 'TARJETA', etiqueta: 'Tarjeta' },
    { valor: 'TRANSFERENCIA', etiqueta: 'Transferencia' },
  ];

  clientes: Cliente[] = [];
  loading = false;
  error: string | undefined = undefined;

  // ------- Filtros / presets -------
  search = '';
  estado: 'todos' | 'activos' | 'inactivos' = 'todos';
  preset: 'todos' | 'con_saldo' | 'vencidos' = 'todos';

  // ------- Modal Nuevo/Editar -------
  showModal = false;
  editing: Cliente | null = null;
  form: Partial<Cliente> = {};

  // ------- Modal Abono -------
  showAbonoModal = false;
  abonoCliente: Cliente | null = null;
  ventasCliente: ClienteVenta[] = [];
  selectedSaleId: number | null = null;
  abonoAmount: number | null = null;
  abonoPaymentMethod: 'EFECTIVO' | 'TARJETA' | 'TRANSFERENCIA' = 'EFECTIVO';
  abonoNote: string = '';
  loadingVentas = false;
  savingAbono = false;

  hoy = new Date();

  regimenes: CatalogoItem[] = [];
  usosCfdi: CatalogoItem[] = [];

  /* Secciones plegables del dialogo. Se recuerda en este equipo como las dejo
     la persona: quien no da credito no quiere verlo abierto cada vez. */
  creditoAbierto = leerPliegue('credito', false);
  facturacionAbierta = leerPliegue('facturacion', false);
  opcRegimen: WxOpcion[] = [];
  opcUso: WxOpcion[] = [];

  constructor(private catalogos: CatalogosService, private auth: AuthService) {}

  async ngOnInit() {
    await this.cargarCatalogos();
    await this.loadClientes();
  }

  // ===== CARGA DESDE BD =====
  private async loadClientes() {
    const api = (window as any).electronAPI;
    if (!api || !api.getCustomers) {
      console.warn('Electron API no disponible. ¿Estás corriendo con ng serve?');
      this.error = 'No hay conexión con Electron/DB.';
      return;
    }

    try {
      this.loading = true;
      this.error = undefined;

      const res = await api.getCustomers();

      if (!res?.success) {
        this.error = res?.error || 'Error al cargar clientes.';
        await Swal.fire({
          icon: 'error',
          title: 'Error',
          text: this.error || 'Error al cargar clientes.',
        });
        return;
      }

      this.clientes = (res.data || []).map((row: any) => ({
        id: row.id,
        code: row.code,
        name: row.customerName,
        tax_id: row.tax_id,                
        regimen_fiscal: row.regimen_fiscal, 
        uso_cfdi: row.uso_cfdi,          
        razon_social: row.razon_social,     
        phone: row.phone,
        email: row.email,
        creditLimit: Number(row.credit_limit ?? 0),
        termsDays: Number(row.terms_days ?? 0),
        active: !!row.active,
        graceDays: Number(row.grace_days ?? 0),
        lateFeePct: Number(row.late_fee_pct ?? 0),
        lateFeeFixed: Number(row.late_fee_fixed ?? 0),
        riskLevel: Number(row.risk_level ?? 0),
        balance: Number(row.balance ?? 0),
        overdueCount: Number(row.overdueCount ?? 0),
        overdueBalance: Number(row.overdue_balance ?? 0),
        availableCredit: Number(row.available_credit ?? 0),
        nextDueDate: row.next_due_date ?? null,
        maxDaysLate: Number(row.max_days_late ?? 0),
        lateFeeEstimate: Number(row.late_fee_estimate ?? 0),
        creditBlock: (row.credit_block ?? null) as BloqueoCredito | null,
      }));
    } catch (e: any) {
      console.error(e);
      this.error = e?.message || 'Error desconocido al cargar clientes.';
      await Swal.fire({
        icon: 'error',
        title: 'Error inesperado',
        text: this.error || 'Error desconocido al cargar clientes.',
      });
    } finally {
      this.loading = false;
    }
  }

  // ----- KPIs -----
  get kpiTotal()      { return this.clientes.length; }
  get kpiConSaldo()   { return this.clientes.filter(c => c.balance > 0).length; }
  get kpiVencidos()   { return this.clientes.filter(c => c.overdueCount > 0).length; }
  get kpiSaldoTotal() { return this.clientes.reduce((s,c)=> s + (c.balance>0?c.balance:0), 0); }
  get activosCount()  { return this.clientes.filter(c => c.active).length; }

  // ----- Vista filtrada -----
  /**
   * Descriptor de la tabla. Clientes usa `tabla-corte`: la barra comparte el
   * ESTADO, no el marcado, asi que no hace falta reescribir la tabla.
   */
  readonly tabla = new EstadoTabla('clientes', [
    { clave: 'name', titulo: 'Cliente', obligatoria: true },
    { clave: 'contacto', titulo: 'Contacto' },
    { clave: 'creditLimit', titulo: 'Límite' },
    { clave: 'balance', titulo: 'Saldo' },
    { clave: 'estado', titulo: 'Estado', filtrable: true, agrupable: true,
      valor: (c) => !c.active ? 'Inactivo'
                  : (c.overdueCount > 0) ? 'Con vencidos'
                  : (c.balance > 0) ? 'Con saldo' : 'Al corriente' },
    { clave: 'acciones', titulo: 'Acciones', obligatoria: true },
  ]);

  /** Lo buscado, ya filtrado por la barra, y aplanado con sus grupos. */
  get items(): WxItem[] { return this.tabla.aplanar(this.tabla.filtrar(this.clientesView)); }

  get clientesView(): Cliente[] {
    let rows = [...this.clientes];

    const q = this.search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(c =>
        c.name.toLowerCase().includes(q) ||
        (c.phone ?? '').toLowerCase().includes(q) ||
        (c.email ?? '').toLowerCase().includes(q)
      );
    }

    if (this.estado === 'activos')   rows = rows.filter(c => c.active);
    if (this.estado === 'inactivos') rows = rows.filter(c => !c.active);

    if (this.preset === 'con_saldo') rows = rows.filter(c => c.balance > 0);
    if (this.preset === 'vencidos')  rows = rows.filter(c => c.overdueCount > 0);

    rows.sort((a,b) => (b.overdueCount - a.overdueCount) || (b.balance - a.balance));
    return rows;
  }

  // ----- Helpers -----
  badgeEstado(c: Cliente): { text: string; cls: string } {
    if (c.overdueCount > 0) return { text: 'Vencido', cls: 'badge tarjeta' };
    if (c.balance > 0)      return { text: 'Con saldo', cls: 'badge transfer' };
    return { text: 'Al corriente', cls: 'badge efectivo' };
  }

  // ----- UI Actions -----
  setPreset(p: 'todos'|'con_saldo'|'vencidos') { this.preset = p; }

  nuevo() {
    this.editing = null;
    this.form = {
      creditLimit: 0,
      termsDays: 0,
      active: true,
      graceDays: 0,
      lateFeePct: 0,
      lateFeeFixed: 0,
      riskLevel: 0
    };
    this.showModal = true;
  }

  editar(c: Cliente) {
    this.editing = c;
    this.form = { ...c };
    this.showModal = true;
  }

  async guardar() {
    if (!this.form.name) {
      await Swal.fire({
        icon: 'error',
        title: 'Falta información',
        text: 'El nombre del cliente es obligatorio.',
      });
      return;
    }

    const problema = this.problemaCredito();
    if (problema) {
      this.creditoAbierto = true;
      await Swal.fire({ icon: 'warning', title: 'Revisa el crédito', text: problema });
      return;
    }

    const api = (window as any).electronAPI;
    if (!api || (!api.createCustomer && !api.updateCustomer)) {
      await Swal.fire({
        icon: 'error',
        title: 'Sin conexión',
        text: 'No hay conexión con Electron/DB (¿quizá estás en ng serve?).',
      });
      return;
    }

    try {
      if (this.editing) {
        // ===== UPDATE =====
        const res = await api.updateCustomer(
          this.editing.id,
          this.form.code ?? '',
          this.form.name!,
          this.form.tax_id ?? null,
          this.form.email ?? '',
          this.form.phone ?? '',
          this.form.creditLimit ?? 0,
          this.form.termsDays ?? 0,
          this.form.active ?? true,
          this.form.regimen_fiscal ?? null,
          this.form.uso_cfdi ?? null,
          this.form.razon_social ?? null,
          this.form.graceDays ?? 0,
          this.form.lateFeePct ?? 0,
          this.form.lateFeeFixed ?? 0,
          this.form.riskLevel ?? 0
        );

        if (!res?.success) {
          await Swal.fire({
            icon: 'error',
            title: 'Error al actualizar',
            text: res?.error || 'No se pudo actualizar el cliente.',
          });
          return;
        }

        /* Limite, plazo o gracia cambian el disponible y lo vencido: se relee. */
        await this.loadClientes();

        await Swal.fire({
          icon: 'success',
          title: 'Cliente actualizado',
          text: 'Los cambios se guardaron correctamente.',
          timer: 1800,
          showConfirmButton: false,
          timerProgressBar: true
        });

      } else {
        // ===== CREATE =====
        const res = await api.createCustomer(
          this.form.code ?? null,
          this.form.name!,
          this.form.tax_id ?? null,       
          this.form.email ?? '',
          this.form.phone ?? '',
          this.form.creditLimit ?? 0,
          this.form.termsDays ?? 0,
          this.form.active ?? true,
          this.form.regimen_fiscal ?? null,
          this.form.uso_cfdi ?? null,
          this.form.razon_social ?? null,
          /* Antes el alta no los mandaba: se capturaban y se perdian. */
          Number(this.form.graceDays) || 0,
          Number(this.form.lateFeePct) || 0,
          Number(this.form.lateFeeFixed) || 0,
          Number(this.form.riskLevel) || 0
        );

        if (!res?.success) {
          await Swal.fire({
            icon: 'error',
            title: 'Error al guardar',
            text: res?.error || 'No se pudo crear el cliente.',
          });
          return;
        }

        /* El estado de cuenta lo calcula la base: se relee en vez de inventarlo. */
        await this.loadClientes();

        await Swal.fire({
          icon: 'success',
          title: 'Cliente agregado',
          text: 'Se guardó correctamente.',
          timer: 1800,
          showConfirmButton: false,
          timerProgressBar: true
        });
      }

      this.cerrarModal();

    } catch (e: any) {
      console.error(e);
      await Swal.fire({
        icon: 'error',
        title: 'Error inesperado',
        text: e?.message || 'Ocurrió un error inesperado.',
      });
    }
  }

  cerrarModal() { this.showModal = false; }

  @HostListener('document:keydown.escape')
  alEscape() {
    /* Un menu abierto (wx-select) se cierra primero con su propio Escape. */
    if (this.showModal && !document.querySelector('.wx-pop:popover-open')) this.cerrarModal();
  }

  /** Lo que no cuadra en las condiciones de credito, dicho para la persona. */
  problemaCredito(): string | null {
    const f = this.form;
    const num = (v: any) => (v === null || v === undefined || v === '' ? 0 : Number(v));
    if (!Number.isFinite(num(f.creditLimit)) || num(f.creditLimit) < 0) return 'El límite de crédito no puede ser negativo.';
    if (!Number.isInteger(num(f.termsDays)) || num(f.termsDays) < 0) return 'Los días de plazo son un número entero, cero o más.';
    if (!Number.isInteger(num(f.graceDays)) || num(f.graceDays) < 0) return 'Los días de gracia son un número entero, cero o más.';
    if (num(f.lateFeePct) < 0 || num(f.lateFeePct) > 100) return 'El interés moratorio va de 0 a 100 % al mes.';
    if (num(f.lateFeeFixed) < 0) return 'El recargo por venta vencida no puede ser negativo.';
    return null;
  }

  /** Por que no se le puede fiar, o null. */
  motivoBloqueo(c: Cliente | null): string | null {
    if (!c?.creditBlock || c.creditBlock === 'SIN_LIMITE') return null;
    return MOTIVO_BLOQUEO[c.creditBlock] ?? null;
  }

  /** El limite nuevo queda por debajo de lo que ya debe. */
  get limiteBajoDeuda(): boolean {
    return !!this.editing && Number(this.form.creditLimit) > 0
      && Number(this.form.creditLimit) < (this.editing.balance || 0);
  }

  get moraTotal(): number {
    return this.ventasCliente.reduce((s, v) => s + (v.lateFee || 0), 0);
  }

  /** Editar -> abonar sin pasar por la lista. */
  async abonarDesdeFicha() {
    const c = this.editing;
    if (!c) return;
    this.cerrarModal();
    await this.abonar(c);
  }

  alternarCredito() {
    this.creditoAbierto = !this.creditoAbierto;
    guardarPliegue('credito', this.creditoAbierto);
  }

  alternarFacturacion() {
    this.facturacionAbierta = !this.facturacionAbierta;
    guardarPliegue('facturacion', this.facturacionAbierta);
  }

  /** Lo que dice la seccion de credito plegada. */
  get resumenCredito(): string {
    const limite = Number(this.form.creditLimit) || 0;
    const dinero = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 });
    const debe = this.editing?.balance || 0;
    if (limite <= 0) return debe > 0 ? `Sin crédito · debe ${dinero(debe)}` : 'Sin crédito';
    const plazo = Number(this.form.termsDays) || 0;
    const base = plazo > 0 ? `${dinero(limite)} · ${plazo} ${plazo === 1 ? 'día' : 'días'}` : dinero(limite);
    return debe > 0 ? `${base} · debe ${dinero(debe)}` : base;
  }

  /** Lo que dice la seccion de facturacion plegada. */
  get resumenFacturacion(): string {
    return (this.form.tax_id || '').trim() || 'Sin datos';
  }

  // ===== ABONOS =====
  async abonar(c: Cliente) {
  this.abonoCliente = c;
  this.showAbonoModal = true;
  this.ventasCliente = [];
  this.selectedSaleId = null;
  this.abonoAmount = null;
  this.abonoPaymentMethod = 'EFECTIVO';
  this.abonoNote = '';

  await this.loadVentasCliente(c.id);

  if (!this.loadingVentas && this.ventasCliente.length === 0) {
    await Swal.fire({
      icon: 'info',
      title: 'Sin saldo pendiente',
      text: 'Este cliente no tiene ventas a crédito con saldo por cobrar.',
    });
    this.cerrarAbonoModal();
  }
}


  private async loadVentasCliente(customerId: number) {
    const api = (window as any).electronAPI;
    if (!api || !api.getCustomerOpenSales) {
      console.warn('getCustomerOpenSales no disponible');
      return;
    }

    try {
      this.loadingVentas = true;
      const resp = await api.getCustomerOpenSales(customerId);

      if (!resp?.success) {
        await Swal.fire({
          icon: 'error',
          title: 'Error al cargar ventas',
          text: resp?.error || 'No se pudieron obtener las ventas a crédito del cliente.',
        });
        return;
      }

      this.ventasCliente = (resp.data || []).map((r: any) => ({
        id: r.id,
        datee: r.datee,
        total: Number(r.total ?? 0),
        paid_amount: Number(r.paid_amount ?? 0),
        balance: Number(r.balance ?? 0),
        due_date: r.due_date,
        daysLate: Number(r.days_late ?? 0),
        overdue: !!r.is_overdue,
        lateFee: Number(r.late_fee_estimate ?? 0),
      }));

      if (this.ventasCliente.length > 0) {
        this.selectedSaleId = this.ventasCliente[0].id;
        this.abonoAmount = this.ventasCliente[0].balance;
      }

    } catch (e: any) {
      console.error('❌ loadVentasCliente:', e);
      await Swal.fire({
        icon: 'error',
        title: 'Error inesperado',
        text: e?.message || 'Ocurrió un error al cargar las ventas a crédito.',
      });
    } finally {
      this.loadingVentas = false;
    }
  }

  cerrarAbonoModal() {
    this.showAbonoModal = false;
    this.abonoCliente = null;
    this.ventasCliente = [];
    this.selectedSaleId = null;
    this.abonoAmount = null;
    this.abonoNote = '';
  }

  async confirmarAbono() {
    if (!this.abonoCliente) return;

    if (!this.selectedSaleId) {
      await Swal.fire({
        icon: 'error',
        title: 'Selecciona una venta',
        text: 'Debes elegir a qué venta aplicar el abono.',
      });
      return;
    }

    if (this.abonoAmount == null || this.abonoAmount <= 0) {
      await Swal.fire({
        icon: 'error',
        title: 'Monto inválido',
        text: 'El monto del abono debe ser mayor a 0.',
      });
      return;
    }

    const venta = this.ventasCliente.find(v => v.id === this.selectedSaleId);
    if (!venta) {
      await Swal.fire({
        icon: 'error',
        title: 'Venta no encontrada',
        text: 'No se encontró la venta seleccionada.',
      });
      return;
    }

    if (this.abonoAmount > venta.balance) {
      await Swal.fire({
        icon: 'error',
        title: 'Monto mayor al saldo',
        text: `El monto no puede ser mayor al saldo pendiente (${venta.balance.toFixed(2)}).`,
      });
      return;
    }

    const api = (window as any).electronAPI;
    if (!api || !api.registerCustomerPayment) {
      await Swal.fire({
        icon: 'error',
        title: 'No disponible',
        text: 'No se puede registrar el abono (Electron no disponible).',
      });
      return;
    }

    try {
      this.savingAbono = true;

      /* El proceso principal usa el de la sesion; este es solo por si acaso. */
      const userId = this.auth.usuarioActualId;

      const resp = await api.registerCustomerPayment(
        this.abonoCliente.id,
        this.selectedSaleId,
        this.abonoAmount,
        userId,
        this.abonoPaymentMethod,
        this.abonoNote || null
      );

      if (!resp?.success) {
        await Swal.fire({
          icon: 'error',
          title: 'Error al registrar abono',
          text: resp?.error || 'No se pudo registrar el abono.',
        });
        return;
      }

      await Swal.fire({
        icon: 'success',
        title: 'Abono registrado',
        text: 'El abono se aplicó correctamente.',
        timer: 1700,
        showConfirmButton: false,
        timerProgressBar: true
      });

      await this.loadClientes();
      this.cerrarAbonoModal();

    } catch (e: any) {
      console.error('❌ confirmarAbono:', e);
      await Swal.fire({
        icon: 'error',
        title: 'Error inesperado',
        text: e?.message || 'Ocurrió un error al registrar el abono.',
      });
    } finally {
      this.savingAbono = false;
    }
  }

  private async cargarCatalogos() {
    try {
      const [reg, uso] = await Promise.all([
        this.catalogos.get('SatTaxRegimes'),
        this.catalogos.get('SatCfdiUses')
      ]);
      this.regimenes = reg;
      this.usosCfdi = uso;
      this.opcRegimen = reg.map(r => ({ valor: r.code, etiqueta: r.description, nota: r.code, busca: r.code }));
      this.opcUso = uso.map(u => ({ valor: u.code, etiqueta: u.description, nota: u.code, busca: u.code }));
    } catch (e) {
      console.error('Error al cargar catálogos SAT en clientes:', e);
    }
  }
}
