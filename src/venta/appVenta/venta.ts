import { Component, HostListener } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgIf, NgFor, CurrencyPipe, DatePipe, SlicePipe, NgStyle } from '@angular/common';
import Swal from 'sweetalert2';
import { AuthService } from '../../services/auth.service';

interface ProductRow {
  id: number;
  part_number: string;
  product_name: string;
  price: number;
  stock: number;
  category_name: string;
  brand_name: string;
}

interface SaleItem {
  productId: number;
  productName: string;
  qty: number;
  unitPrice: number;
  get subtotal(): number;
}

interface CreditCustomer {
  id: number;
  customerName: string;
  phone?: string;
  email?: string;
  creditLimit: number;
  currentBalance: number;
  availableCredit: number;
}

interface SaleHeader {
  sale_id: number;
  datee: string | Date;
  user_id: number;
  total: number;
  payment_method: string;
  customer_id: number | null;
  paid_amount: number;
  balance: number;
  due_date: string | null;
  refund_total: number;
}

interface SaleDetailRow {
  sale_id: number;
  product_id: number;
  product_name?: string;
  productName?: string;
  name?: string;
  quantity: number;
  unitary_price: number;
  refunded_qty?: number;
  remaining_qty?: number;
}

interface RefundLine {
  productId: number;
  productName: string;
  maxQty: number;
  qty: number;
  unitPrice: number;
}

@Component({
  selector: 'app-venta',
  templateUrl: './venta.html',
  imports: [RouterOutlet, FormsModule, NgIf, NgFor, CurrencyPipe, DatePipe, SlicePipe, NgStyle],
  styleUrls: ['./venta.css']
})
export class Venta {
  today = new Date();

  // Folio UI (1 solo input)
  nextFolioSuggested = 1;
  folioInput: number | null = null;

  private lastAddedProductId: number | null = null;

  showModal = false;
  dineroRecibido: number | null = null;
  paymentMethod: 'EFECTIVO' | 'TARJETA' | 'TRANSFERENCIA' | 'CREDITO' = 'EFECTIVO';

  customerId: number | null = null;
  dueDate: string | null = null;

  creditCustomers: CreditCustomer[] = [];
  loadingCreditCustomers = false;

  lastSalePaid: number = 0;
  lastSaleChange: number = 0;

  showModalProductos = false;
  productos: ProductRow[] = [];
  filtro = '';

  items: SaleItem[] = [];
  totalVenta = 0;

  // Salida de efectivo (F10)
  showCashOutModal = false;
  cashOutAmount: number | null = null;
  cashOutNote = '';

  // Post-venta (acciones: PDF / WhatsApp)
  showPostSaleModal = false;
  lastSaleId: number | null = null;
  lastSaleIsCredito = false;
  lastSaleTotal = 0;

  // =========================
  // Turno (Abrir / estado)
  // =========================
  shiftOpen = false;
  shiftId: number | null = null;
  shiftOpenedAt: Date | null = null;
  shiftOpeningCash = 0;

  showOpenShiftModal = false;
  openShiftRequired = false;
  openingShiftLoading = false;

  openingCash: number | null = null;
  openingNote = '';

  private shiftCheckInProgress = false;

  // =========================
  // Modo edición
  // =========================
  editingSaleId: number | null = null;
  editingHeader: SaleHeader | null = null;
  editingLoading = false;

  // Nuevo: solo lectura por default, “Modificar” desbloquea
  editUnlocked = false;

  // =========================
  // Reembolso / Cambio
  // =========================
  showRefundModal = false;
  refundLines: RefundLine[] = [];
  refundKind: 'EFECTIVO' | 'CAMBIO' = 'EFECTIVO';
  refundNote = '';
  refundLoading = false;

  constructor(private auth: AuthService, private router: Router) {}

  async ngOnInit() {
    await this.refreshFolioFromDb();

    if (!this.auth.usuarioActualId) {
      Swal.fire({
        icon: 'info',
        title: 'Sesión requerida',
        text: 'Inicia sesión para continuar.',
        timer: 1500,
        showConfirmButton: false
      }).then(() => this.router.navigate(['/login']));
      return;
    }

    await this.ensureShiftOpen('VENTA');
  }

  private get currentUserId(): number {
    return this.auth.usuarioActualId as number;
  }

  get isEditing(): boolean {
    return this.editingSaleId != null;
  }

  get cambio(): number {
    if (this.dineroRecibido == null) return 0;
    const c = this.dineroRecibido - this.totalVenta;
    return c > 0 ? c : 0;
  }

  private recalcularTotal() {
    this.totalVenta = this.items.reduce((acc, it) => acc + it.subtotal, 0);
  }

  private adjustLastAddedQty(delta: number) {
    if (!this.items.length) return;

    const fallback = this.items[this.items.length - 1];
    const target = this.lastAddedProductId != null
      ? this.items.find(it => it.productId === this.lastAddedProductId) ?? fallback
      : fallback;

    if (!target) return;

    target.qty = Math.max(1, Number(target.qty || 0) + delta);
    this.recalcularTotal();
  }

  onQtyChange(i: number) {
    const it = this.items[i];
    if (!it) return;
    if (it.qty < 1) it.qty = 1;
    this.recalcularTotal();
  }

  onPriceChange(i: number) {
    const it = this.items[i];
    if (!it) return;
    if (it.unitPrice < 0) it.unitPrice = 0;
    this.recalcularTotal();
  }

  quitarItem(i: number) {
    const removed = this.items[i];
    this.items.splice(i, 1);

    if (removed && removed.productId === this.lastAddedProductId) {
      this.lastAddedProductId = this.items.length ? this.items[this.items.length - 1].productId : null;
    }

    this.recalcularTotal();
  }

  // =========================
  // Turno helpers
  // =========================
  private setShiftFromRow(row: any) {
    this.shiftOpen = true;
    this.shiftId = row?.id ?? row?.shift_id ?? row?.closure_id ?? null;
    this.shiftOpenedAt = row?.opened_at ? new Date(row.opened_at) : null;
    this.shiftOpeningCash = Number(row?.opening_cash ?? row?.openingCash ?? 0);
  }

  private clearShift() {
    this.shiftOpen = false;
    this.shiftId = null;
    this.shiftOpenedAt = null;
    this.shiftOpeningCash = 0;
  }

  private async fetchOpenShift(): Promise<boolean> {
    const api = (window as any).electronAPI;
    if (!api || !api.getOpenShift) {
      // En modo ng serve puede no existir: no bloqueo.
      return true;
    }

    try {
      const resp = await api.getOpenShift({ user_id: this.currentUserId });
      if (!resp?.success) return false;

      const row = resp.data;
      const isOpen = !!row?.id && (row.closed_at == null);

      if (isOpen) {
        this.setShiftFromRow(row);
        return true;
      }

      this.clearShift();
      return false;
    } catch {
      this.clearShift();
      return false;
    }
  }

  private async ensureShiftOpen(source: 'VENTA' | 'COBRO' | 'SALIDA'): Promise<boolean> {
    if (this.shiftOpen) return true;
    if (this.shiftCheckInProgress) return false;

    this.shiftCheckInProgress = true;
    try {
      const ok = await this.fetchOpenShift();
      if (ok) return true;

      this.abrirModalAbrirTurno(true);

      if (source === 'COBRO') this.showModal = false;
      if (source === 'SALIDA') this.showCashOutModal = false;

      return false;
    } finally {
      this.shiftCheckInProgress = false;
    }
  }

  abrirModalAbrirTurno(required: boolean) {
    if (this.shiftOpen) return;
    this.openShiftRequired = required;
    this.openingCash = 0;
    this.openingNote = '';
    this.showOpenShiftModal = true;
  }

  cerrarModalAbrirTurno() {
    this.showOpenShiftModal = false;
    this.openShiftRequired = false;
  }

  async confirmarAbrirTurno() {
    const api = (window as any).electronAPI;
    if (!api || !api.openShift) {
      await Swal.fire({ icon: 'error', title: 'No disponible', text: 'No se pudo abrir turno (API no disponible).' });
      return;
    }

    const opening_cash = Number(this.openingCash ?? 0);
    if (opening_cash < 0) {
      await Swal.fire({ icon: 'warning', title: 'Monto inválido', text: 'El fondo inicial no puede ser negativo.' });
      return;
    }

    try {
      this.openingShiftLoading = true;

      const payload = {
        user_id: this.currentUserId,
        opening_cash,
        opening_note: (this.openingNote || '').trim() || null,
        opening_user_id: this.currentUserId
      };

      const resp = await api.openShift(payload);

      if (!resp?.success) {
        await Swal.fire({ icon: 'error', title: 'No se pudo abrir el turno', text: resp?.error || 'Ocurrió un error al abrir el turno.' });
        return;
      }

      const row = resp.data ?? resp.recordset?.[0] ?? null;
      if (row) {
        this.setShiftFromRow(row);
        if (row?.closure_id && !this.shiftId) this.shiftId = Number(row.closure_id);
      } else {
        await this.fetchOpenShift();
      }

      this.showOpenShiftModal = false;
      this.openShiftRequired = false;

      await Swal.fire({ icon: 'success', title: 'Turno abierto', text: 'Listo, ya puedes registrar ventas y movimientos.' });
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error inesperado', text: e?.message || 'Ocurrió un error al abrir el turno.' });
    } finally {
      this.openingShiftLoading = false;
    }
  }

  salirDeVentas() {
    this.router.navigate(['/dashboard']);
  }

  // =========================
  // Cobro / métodos
  // =========================
  async abrirModalCobrar() {
    const ok = await this.ensureShiftOpen('COBRO');
    if (!ok) return;

    if (this.isEditing) {
      await Swal.fire({
        icon: 'info',
        title: 'Folio cargado',
        text: 'Esta pantalla es para reembolsos/cambios. Cierra el folio (X) para cobrar una venta nueva.'
      });
      return;
    }

    this.dineroRecibido = null;
    this.showModal = true;
  }

  cerrarModalCobrar() { this.showModal = false; }

  async onPaymentMethodChange(method: 'EFECTIVO' | 'TARJETA' | 'TRANSFERENCIA' | 'CREDITO') {
    this.paymentMethod = method;

    if (method === 'CREDITO') {
      this.dineroRecibido = null;
      await this.loadCreditCustomers();
    } else {
      this.customerId = null;
      this.dueDate = null;
    }
  }

  private async loadCreditCustomers() {
    const api = (window as any).electronAPI;
    if (!api || !api.getCreditCustomers) {
      await Swal.fire({ icon: 'error', title: 'No disponible', text: 'No se pudo cargar la lista de clientes con crédito.' });
      return;
    }

    try {
      this.loadingCreditCustomers = true;
      this.creditCustomers = [];

      const resp = await api.getCreditCustomers();

      if (!resp?.success) {
        await Swal.fire({ icon: 'error', title: 'Error al cargar clientes', text: resp?.error || 'No se pudieron obtener los clientes con crédito.' });
        return;
      }

      this.creditCustomers = (resp.data || []).map((r: any) => ({
        id: r.id,
        customerName: r.customerName,
        phone: r.phone,
        email: r.email,
        creditLimit: Number(r.credit_limit ?? 0),
        currentBalance: Number(r.current_balance ?? 0),
        availableCredit: Number(r.available_credit ?? 0),
      }));

      this.customerId = this.creditCustomers.length > 0 ? this.creditCustomers[0].id : null;
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error inesperado', text: e?.message || 'Ocurrió un error al cargar los clientes con crédito.' });
    } finally {
      this.loadingCreditCustomers = false;
    }
  }

  async confirmarCobro() {
    const ok = await this.ensureShiftOpen('COBRO');
    if (!ok) return;

    if (this.items.length === 0) {
      this.showModal = false;
      await Swal.fire({ icon: "error", title: "Oops...", text: "Agrega productos a la venta" });
      return;
    }
    if (this.totalVenta <= 0) {
      this.showModal = false;
      await Swal.fire({ icon: "error", title: "Oops...", text: "El total de la venta debe ser mayor a cero" });
      return;
    }

    const isCredito = this.paymentMethod === 'CREDITO';

    if (isCredito) {
      if (this.customerId == null) {
        this.showModal = false;
        await Swal.fire({ icon: 'error', title: 'Cliente requerido', text: 'Selecciona el cliente para la venta a crédito.' });
        return;
      }
    } else {
      if (this.dineroRecibido == null || this.dineroRecibido < this.totalVenta) {
        this.showModal = false;
        await Swal.fire({ icon: "error", title: "Oops...", text: "El dinero recibido debe ser mayor o igual al total de la venta" });
        return;
      }
    }

    const detalles = this.items.map(it => ({
      productId: it.productId,
      qty: it.qty,
      unitPrice: it.unitPrice
    }));

    try {
      const resp = await (window as any).electronAPI.registerSale(
        this.currentUserId,
        this.paymentMethod,
        detalles,
        isCredito ? this.customerId : null,
        isCredito ? this.dueDate : null
      );

      if (resp?.success) {
        if (!isCredito) {
          this.lastSalePaid = this.dineroRecibido ?? this.totalVenta;
          this.lastSaleChange = this.cambio;

          const api = (window as any).electronAPI;
          if (api && api.openCashDrawer) {
            try { await api.openCashDrawer(); } catch { /* noop */ }
          } else {
            this.lastSalePaid = this.totalVenta;
            this.lastSaleChange = 0;
          }
        }

        const saleId: number | null = resp.saleId ?? resp.id ?? resp.folio ?? null;

        this.lastSaleId = saleId;
        this.lastSaleIsCredito = isCredito;
        this.lastSaleTotal = this.totalVenta;

        // reset venta nueva
        this.items = [];
        this.totalVenta = 0;
        this.dineroRecibido = null;
        this.customerId = null;
        this.dueDate = null;

        this.showModal = false;
        this.showPostSaleModal = true;

        await this.refreshFolioFromDb();
      } else {
        this.showModal = false;
        await Swal.fire({ icon: 'error', title: 'Error al registrar venta', text: resp?.error || 'No se pudo registrar la venta.' });
      }
    } catch (e: any) {
      this.showModal = false;
      await Swal.fire({ icon: 'error', title: 'Error al registrar la venta', text: e.message || 'Ocurrió un error inesperado.' });
    }
  }

  private async refreshFolioFromDb() {
    const api = (window as any).electronAPI;
    if (!api?.getActualFolio) return;

    try {
      const resp = await api.getActualFolio();
      const next = Number(resp?.data?.next_folio ?? 1);
      this.nextFolioSuggested = Number.isFinite(next) && next > 0 ? next : 1;

      // Si NO está editando, deja el input listo con el sugerido
      if (!this.isEditing) {
        this.folioInput = this.nextFolioSuggested;
      }
    } catch {
      this.nextFolioSuggested = 1;
      if (!this.isEditing) this.folioInput = 1;
    }
  }

  // ==================
  // PRODUCTOS
  // ==================
  async abrirModalProductos() {
    if (this.isEditing && !this.editUnlocked) {
      await Swal.fire({
        icon: 'info',
        title: 'Solo lectura',
        text: 'Esta venta está cargada. Para agregar/quitar productos debes entrar a “Modificar” (supervisor).'
      });
      return;
    }

    this.filtro = '';
    await this.cargarProductosActivos();
    this.showModalProductos = true;
  }

  cerrarModalProductos() { this.showModalProductos = false; }

  async cargarProductosActivos() {
    try {
      const rs = await (window as any).electronAPI.getActiveProducts();
      const rows = Array.isArray(rs?.recordset) ? rs.recordset : Array.isArray(rs) ? rs : [];
      this.productos = rows.map((r: any) => ({
        id: r.id,
        part_number: r.part_number,
        product_name: r.product_name,
        price: r.price,
        stock: r.stock,
        category_name: r.category_name,
        brand_name: r.brand_name
      })) as ProductRow[];
    } catch {
      this.productos = [];
    }
  }

  seleccionarProducto(p: ProductRow) {
    const existing = this.items.find(it => it.productId === p.id);
    if (existing) {
      existing.qty += 1;
      this.lastAddedProductId = p.id;
      this.recalcularTotal();
      this.showModalProductos = false;
      return;
    }

    const item: SaleItem = {
      productId: p.id,
      productName: `${p.product_name}`,
      qty: 1,
      unitPrice: p.price ?? 0,
      get subtotal() { return this.qty * this.unitPrice; }
    };

    this.items.push(item);
    this.lastAddedProductId = p.id;
    this.recalcularTotal();
    this.showModalProductos = false;
  }

  // ==================
  // CAJÓN MANUAL & SALIDA EFECTIVO
  // ==================
  async abrirCajonManual() {
    const api = (window as any).electronAPI;
    if (!api || !api.openCashDrawer) {
      await Swal.fire({ icon: 'info', title: 'No disponible', text: 'La apertura del cajón no está disponible en este entorno.' });
      return;
    }

    try {
      await api.openCashDrawer();
    } catch {
      await Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo abrir el cajón. Revisa la configuración.' });
    }
  }

  async abrirSalidaEfectivo() {
    const ok = await this.ensureShiftOpen('SALIDA');
    if (!ok) return;

    this.cashOutAmount = null;
    this.cashOutNote = '';
    this.showCashOutModal = true;
  }

  cerrarSalidaEfectivo() { this.showCashOutModal = false; }

  async confirmarSalidaEfectivo() {
    const ok = await this.ensureShiftOpen('SALIDA');
    if (!ok) return;

    const amount = Number(this.cashOutAmount ?? 0);

    if (amount <= 0) {
      await Swal.fire({ icon: 'error', title: 'Monto inválido', text: 'El monto a retirar debe ser mayor a cero.' });
      return;
    }

    if (!this.cashOutNote.trim()) {
      await Swal.fire({ icon: 'warning', title: 'Nota requerida', text: 'Describe brevemente para qué es la salida de efectivo.' });
      return;
    }

    const api = (window as any).electronAPI;
    if (!api || !api.registerCashMovement) {
      await Swal.fire({ icon: 'error', title: 'No disponible', text: 'No se pudo registrar la salida de efectivo (API no disponible).' });
      return;
    }

    const payload = {
      user_id: this.currentUserId,
      typee: 'WITHDRAW',
      amount,
      note: this.cashOutNote
    };

    try {
      const resp = await api.registerCashMovement(payload);

      if (resp?.success) {
        this.showCashOutModal = false;
        this.cashOutAmount = null;
        this.cashOutNote = '';
        await Swal.fire({ icon: 'success', title: 'Salida registrada', text: 'La salida de efectivo se registró correctamente.' });
      } else {
        await Swal.fire({ icon: 'error', title: 'Error al registrar salida', text: resp?.error || 'No se pudo registrar la salida.' });
      }
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error inesperado', text: e?.message || 'Ocurrió un error al registrar la salida.' });
    }
  }

  // ==================
  // POST-VENTA
  // ==================
  cerrarPostSaleModal() { this.showPostSaleModal = false; }

  async generarPdfUltimaVenta() {
    if (!this.lastSaleId) return;

    const api = (window as any).electronAPI;
    if (!api || !api.generateSalePdf) {
      await Swal.fire({ icon: 'info', title: 'No disponible', text: 'La generación de PDF no está configurada en este entorno.' });
      return;
    }

    try {
      const payload = { saleId: this.lastSaleId, pagado: this.lastSalePaid, cambio: this.lastSaleChange };
      const resp = await api.generateSalePdf(payload);

      if (!resp?.success) {
        await Swal.fire({ icon: 'error', title: 'Error al generar PDF', text: resp?.error || 'No se pudo generar el PDF.' });
        return;
      }

      await Swal.fire({ icon: 'success', title: 'PDF generado', text: 'El PDF de la venta se generó correctamente.' });
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error inesperado', text: e?.message || 'Ocurrió un error al generar el PDF.' });
    }
  }

  async enviarTicketWhatsApp() {
    if (!this.lastSaleId) return;

    const api = (window as any).electronAPI;
    if (!api || !api.sendSaleTicketWhatsApp) {
      await Swal.fire({ icon: 'info', title: 'No disponible', text: 'El envío por WhatsApp no está configurado en este entorno.' });
      return;
    }

    try {
      const resp = await api.sendSaleTicketWhatsApp(this.lastSaleId);
      if (!resp?.success) {
        await Swal.fire({ icon: 'error', title: 'Error al enviar ticket', text: resp?.error || 'No se pudo enviar el ticket.' });
        return;
      }

      await Swal.fire({ icon: 'success', title: 'Ticket enviado', text: 'Se envió el ticket por WhatsApp correctamente.' });
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error inesperado', text: e?.message || 'Ocurrió un error al enviar el ticket.' });
    }
  }

  // ==================
  // ATAJOS
  // ==================
  @HostListener('window:keydown', ['$event'])
  async handleKeyboardEvent(event: KeyboardEvent) {
    switch (event.key) {
      case 'F1':
        event.preventDefault();
        this.abrirCajonManual();
        break;

      case 'F7':
        event.preventDefault();
        if (!this.showModalProductos) this.abrirModalProductos();
        break;

      case 'F8':
        event.preventDefault();
        if (!this.showModal) await this.abrirModalCobrar();
        break;

      case 'F10':
        event.preventDefault();
        if (!this.showCashOutModal) await this.abrirSalidaEfectivo();
        break;

      case '+':
        if (this.showModal || this.showModalProductos || this.showCashOutModal || this.showPostSaleModal || this.showOpenShiftModal) break;
        if (this.isEditing && !this.editUnlocked) break;
        event.preventDefault();
        this.adjustLastAddedQty(+1);
        break;

      case '-':
        if (this.showModal || this.showModalProductos || this.showCashOutModal || this.showPostSaleModal || this.showOpenShiftModal) break;
        if (this.isEditing && !this.editUnlocked) break;
        event.preventDefault();
        this.adjustLastAddedQty(-1);
        break;
    }
  }

  // ==================
  // EDICIÓN / CARGA FOLIO
  // ==================
  public resetToNewSaleMode() {
    this.editingSaleId = null;
    this.editingHeader = null;
    this.editUnlocked = false;

    this.items = [];
    this.recalcularTotal();

    this.folioInput = this.nextFolioSuggested;
  }

  async buscarFolioPorInput() {
    const saleId = Number(this.folioInput ?? 0);

    if (!Number.isFinite(saleId) || saleId <= 0) {
      await Swal.fire({ icon: 'warning', title: 'Folio inválido', text: 'Ingresa un folio válido.' });
      return;
    }

    const api = (window as any).electronAPI;
    if (!api?.getSaleByFolio) {
      await Swal.fire({ icon: 'error', title: 'No disponible', text: 'Falta electronAPI.getSaleByFolio' });
      return;
    }

    this.editingLoading = true;
    try {
      const resp = await api.getSaleByFolio(saleId);

      if (!resp?.success) {
        await Swal.fire({ icon: 'error', title: 'No se encontró', text: resp?.error || 'No se encontró la venta.' });
        return;
      }

      const header: SaleHeader | null = resp.data?.header ?? resp.data?.[0] ?? null;
      const details: SaleDetailRow[] = resp.data?.details ?? resp.data?.rows ?? resp.data?.detail ?? [];

      if (!header || !header.sale_id) {
        await Swal.fire({ icon: 'info', title: 'Sin datos', text: 'No se encontró la venta o no regresó header.' });
        return;
      }

      this.editingSaleId = Number(header.sale_id);
      this.editingHeader = {
        ...header,
        datee: header.datee ? new Date(header.datee) : header.datee,
        total: Number(header.total ?? 0),
        refund_total: Number(header.refund_total ?? 0),
      };
      this.editUnlocked = false;

      this.items = (details || []).map((d: any) => {
        const name =
          d.product_name ??
          d.productName ??
          d.nombre_producto ??
          d.name ??
          '';

        return {
          productId: Number(d.product_id),
          productName: String(name || `Producto #${d.product_id}`),
          qty: Number(d.quantity ?? 1),
          unitPrice: Number(d.unitary_price ?? 0),
          get subtotal() { return this.qty * this.unitPrice; }
        };
      });

      this.recalcularTotal();

      await Swal.fire({
        icon: 'success',
        title: `Folio #${this.editingSaleId}`,
        text: 'Venta cargada (solo lectura).',
        timer: 1000,
        showConfirmButton: false
      });

    } catch (e: any) {
      console.error('❌ buscarFolioPorInput:', e);
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'Error al cargar la venta.' });
    } finally {
      this.editingLoading = false;
    }
  }

  async habilitarEdicion() {
    const confirm = await Swal.fire({
      icon: 'question',
      title: 'Modificar venta',
      text: 'Esto es modo supervisor. ¿Deseas continuar?',
      showCancelButton: true,
      confirmButtonText: 'Sí, modificar',
      cancelButtonText: 'Cancelar'
    });

    if (!confirm.isConfirmed) return;

    this.editUnlocked = true;
  }

  async cancelarEdicion() {
    this.editUnlocked = false;

    if (this.editingSaleId) {
      this.folioInput = this.editingSaleId;
      await this.buscarFolioPorInput();
    }
  }

  async guardarCambiosVenta() {
    if (!this.editingSaleId) {
      await Swal.fire({ icon: 'info', title: 'No estás editando', text: 'Primero carga un folio.' });
      return;
    }

    if (!this.editUnlocked) {
      await Swal.fire({
        icon: 'info',
        title: 'Edición bloqueada',
        text: 'Presiona “Modificar” (supervisor) para habilitar cambios.'
      });
      return;
    }

    const ok = await this.ensureShiftOpen('VENTA');
    if (!ok) return;

    if (this.items.length === 0) {
      await Swal.fire({ icon: 'warning', title: 'Sin partidas', text: 'La venta no puede quedar vacía.' });
      return;
    }

    const api = (window as any).electronAPI;
    if (!api?.updateSale) {
      await Swal.fire({ icon: 'error', title: 'No disponible', text: 'Falta electronAPI.updateSale' });
      return;
    }

    const confirm = await Swal.fire({
      icon: 'question',
      title: `Guardar cambios (Folio #${this.editingSaleId})`,
      text: 'Se actualizará inventario y (si aplica) caja con el ajuste.',
      showCancelButton: true,
      confirmButtonText: 'Sí, guardar',
      cancelButtonText: 'Cancelar'
    });

    if (!confirm.isConfirmed) return;

    try {
      const payload = {
        sale_id: this.editingSaleId,
        user_id: this.currentUserId,
        items: this.items.map(it => ({
          productId: it.productId,
          qty: it.qty,
          unitPrice: it.unitPrice
        })),
        note: 'Edición de venta desde POS'
      };

      const resp = await api.updateSale(payload);

      if (!resp?.success) {
        await Swal.fire({ icon: 'error', title: 'No se pudo actualizar', text: resp?.error || 'Error al actualizar.' });
        return;
      }

      await Swal.fire({ icon: 'success', title: 'Actualizada', text: 'La venta se actualizó correctamente.' });

      this.editUnlocked = false;
      this.folioInput = this.editingSaleId;
      await this.buscarFolioPorInput();

    } catch (e: any) {
      console.error('❌ guardarCambiosVenta:', e);
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'Error al actualizar.' });
    }
  }

  // ==================
  // REEMBOLSO / CAMBIO
  // ==================
  async abrirReembolso() {
    if (!this.editingSaleId || !this.editingHeader) {
      await Swal.fire({ icon: 'info', title: 'Carga una venta', text: 'Primero escribe un folio y presiona Enter.' });
      return;
    }

    const ok = await this.ensureShiftOpen('VENTA');
    if (!ok) return;

    const api = (window as any).electronAPI;
    if (!api?.getSaleByFolio) {
      await Swal.fire({ icon: 'error', title: 'No disponible', text: 'Falta electronAPI.getSaleByFolio' });
      return;
    }

    try {
      const resp = await api.getSaleByFolio(this.editingSaleId);
      if (!resp?.success) {
        await Swal.fire({ icon: 'error', title: 'Error', text: resp?.error || 'No se pudo cargar la venta.' });
        return;
      }

      const details: SaleDetailRow[] = resp.data?.details ?? resp.data?.detail ?? [];

      this.refundLines = (details || [])
        .filter(d => Number(d.remaining_qty ?? 0) > 0)
        .map(d => {
          const name =
            (d as any).product_name ??
            (d as any).productName ??
            (d as any).name ??
            '';

          return {
            productId: Number(d.product_id),
            productName: String(name || `Producto #${d.product_id}`),
            maxQty: Number(d.remaining_qty ?? 0),
            qty: 0,
            unitPrice: Number(d.unitary_price ?? 0),
          };
        });

      this.refundKind = 'EFECTIVO';
      this.refundNote = '';
      this.showRefundModal = true;

    } catch (e: any) {
      console.error('❌ abrirReembolso:', e);
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'Error al preparar el reembolso.' });
    }
  }

  cerrarReembolso() {
    this.showRefundModal = false;
    this.refundLines = [];
    this.refundNote = '';
    this.refundLoading = false;
  }

  get refundTotalPreview(): number {
    const total = (this.refundLines || [])
      .filter(l => Number(l.qty) > 0)
      .reduce((acc, l) => acc + (Number(l.qty) * Number(l.unitPrice)), 0);
    return Number(total.toFixed(2));
  }

  incQty(l: RefundLine) {
    const max = Number(l?.maxQty ?? Infinity);
    const qty = Number(l?.qty ?? 0);
    l.qty = Math.min(max, qty + 1);
  }

  decQty(l: RefundLine) {
    const qty = Number(l?.qty ?? 0);
    l.qty = Math.max(0, qty - 1);
  }

  async confirmarReembolso() {
    if (!this.editingSaleId) return;

    const api = (window as any).electronAPI;
    if (!api?.refundSale) {
      await Swal.fire({ icon: 'error', title: 'No disponible', text: 'Falta electronAPI.refundSale' });
      return;
    }

    for (const l of this.refundLines) {
      l.qty = Number(l.qty ?? 0);
      if (l.qty < 0) l.qty = 0;
      if (l.qty > l.maxQty) l.qty = l.maxQty;
    }

    const selected = this.refundLines.filter(l => l.qty > 0);
    if (selected.length === 0) {
      await Swal.fire({ icon: 'warning', title: 'Nada que devolver', text: 'Selecciona al menos un producto.' });
      return;
    }

    const totalPreview = this.refundTotalPreview;

    this.showRefundModal = false;

    const confirm = await Swal.fire({
      icon: 'question',
      title: this.refundKind === 'EFECTIVO' ? 'Confirmar reembolso en efectivo' : 'Confirmar cambio',
      html: `<div style="text-align:left">Total: <b>$${totalPreview.toFixed(2)}</b></div>`,
      showCancelButton: true,
      confirmButtonText: 'Sí, confirmar',
      cancelButtonText: 'Cancelar'
    });

    if (!confirm.isConfirmed) return;

    this.refundLoading = true;
    try {
      const payload = {
        sale_id: this.editingSaleId,
        user_id: this.currentUserId,

        payment_method: 'EFECTIVO',

        refund_kind: this.refundKind,
        register_cash_movement: this.refundKind === 'EFECTIVO' ? 1 : 0,

        items: selected.map(x => ({
          productId: x.productId,
          qty: x.qty,
          unitPrice: x.unitPrice
        })),

        note: (this.refundNote || '').trim() || null,

        apply_net_update: 1
      };

      const resp = await api.refundSale(payload);

      if (!resp?.success) {
        await Swal.fire({ icon: 'error', title: 'No se pudo procesar', text: resp?.error || 'Error en reembolso/cambio.' });
        return;
      }

      await Swal.fire({ icon: 'success', title: 'Listo', text: 'Se registró correctamente.' });

      this.showRefundModal = false;

      this.folioInput = this.editingSaleId;
      await this.buscarFolioPorInput();

    } catch (e: any) {
      console.error('❌ confirmarReembolso:', e);
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'Error al registrar.' });
    } finally {
      this.refundLoading = false;
    }
  }
}
