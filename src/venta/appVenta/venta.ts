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

@Component({
  selector: 'app-venta',
  templateUrl: './venta.html',
  imports: [RouterOutlet, FormsModule, NgIf, NgFor, CurrencyPipe, DatePipe, SlicePipe, NgStyle],
  styleUrls: ['./venta.css']
})
export class Venta {
  today = new Date();

  folio: number = 1;
  private FOLIO_KEY = 'folioCounter';

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

  // evita carreras/duplicados al consultar/abrir
  private shiftCheckInProgress = false;

  constructor(private auth: AuthService, private router: Router) {
    this.totalVenta = 0;
  }

  async ngOnInit() {
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

    // al entrar a ventas, checo si hay turno abierto
    await this.ensureShiftOpen('VENTA');
  }

  private get currentUserId(): number {
    return this.auth.usuarioActualId as number;
  }

  private readFolioCounter(): number {
    const v = Number(localStorage.getItem(this.FOLIO_KEY) || '0');
    return Number.isFinite(v) ? v : 0;
  }
  private writeFolioCounter(v: number) {
    localStorage.setItem(this.FOLIO_KEY, String(v));
  }
  private advanceFolioAfterConfirm() {
    const current = this.readFolioCounter();
    const confirmed = current + 1;
    this.writeFolioCounter(confirmed);
    this.folio = confirmed + 1;
  }

  get cambio(): number {
    if (this.dineroRecibido == null) return 0;
    const c = this.dineroRecibido - this.totalVenta;
    return c > 0 ? c : 0;
  }

  private recalcularTotal() {
    this.totalVenta = this.items.reduce((acc, it) => acc + it.subtotal, 0);
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
    this.items.splice(i, 1);
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

      if (!resp?.success) {
        return false;
      }

      const row = resp.data;

      // con tu SP actual: si hay fila y closed_at es null => abierto
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
    // ya abierto
    if (this.shiftOpen) return true;

    // evita carreras si se llama varias veces (entrar + hotkeys, etc)
    if (this.shiftCheckInProgress) return false;

    this.shiftCheckInProgress = true;
    try {
      const ok = await this.fetchOpenShift();
      if (ok) return true;

      // si no hay turno, abro modal
      this.abrirModalAbrirTurno(true);

      // si venía de cobrar o salida, cierro lo que esté abierto
      if (source === 'COBRO') this.showModal = false;
      if (source === 'SALIDA') this.showCashOutModal = false;

      return false;
    } finally {
      this.shiftCheckInProgress = false;
    }
  }

  abrirModalAbrirTurno(required: boolean) {
    // si ya hay turno, no vuelvo a abrir modal
    if (this.shiftOpen) return;

    this.openShiftRequired = required;

    // defaults suaves
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
      await Swal.fire({
        icon: 'error',
        title: 'No disponible',
        text: 'No se pudo abrir turno (API no disponible).'
      });
      return;
    }

    const opening_cash = Number(this.openingCash ?? 0);
    if (opening_cash < 0) {
      await Swal.fire({
        icon: 'warning',
        title: 'Monto inválido',
        text: 'El fondo inicial no puede ser negativo.'
      });
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
        await Swal.fire({
          icon: 'error',
          title: 'No se pudo abrir el turno',
          text: resp?.error || 'Ocurrió un error al abrir el turno.'
        });
        return;
      }

      const row = resp.data ?? resp.recordset?.[0] ?? null;
      if (row) {
        this.setShiftFromRow(row);
        // si tu SP devuelve closure_id, úsalo
        if (row?.closure_id && !this.shiftId) this.shiftId = Number(row.closure_id);
        if (row?.opened_at && !this.shiftOpenedAt) this.shiftOpenedAt = new Date(row.opened_at);
        if (row?.opening_cash != null) this.shiftOpeningCash = Number(row.opening_cash);
      } else {
        // fallback: vuelve a consultar
        await this.fetchOpenShift();
      }

      this.showOpenShiftModal = false;
      this.openShiftRequired = false;

      await Swal.fire({
        icon: 'success',
        title: 'Turno abierto',
        text: 'Listo, ya puedes registrar ventas y movimientos.'
      });
    } catch (e: any) {
      await Swal.fire({
        icon: 'error',
        title: 'Error inesperado',
        text: e?.message || 'Ocurrió un error al abrir el turno.'
      });
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
      await Swal.fire({
        icon: 'error',
        title: 'No disponible',
        text: 'No se pudo cargar la lista de clientes con crédito.',
      });
      return;
    }

    try {
      this.loadingCreditCustomers = true;
      this.creditCustomers = [];

      const resp = await api.getCreditCustomers();

      if (!resp?.success) {
        await Swal.fire({
          icon: 'error',
          title: 'Error al cargar clientes',
          text: resp?.error || 'No se pudieron obtener los clientes con crédito.',
        });
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
      await Swal.fire({
        icon: 'error',
        title: 'Error inesperado',
        text: e?.message || 'Ocurrió un error al cargar los clientes con crédito.',
      });
    } finally {
      this.loadingCreditCustomers = false;
    }
  }

  /** ================== CONFIRMAR COBRO ================== */
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
        await Swal.fire({
          icon: 'error',
          title: 'Cliente requerido',
          text: 'Selecciona o ingresa el cliente para la venta a crédito.',
        });
        return;
      }
    } else {
      if (this.dineroRecibido == null || this.dineroRecibido < this.totalVenta) {
        this.showModal = false;
        await Swal.fire({
          icon: "error",
          title: "Oops...",
          text: "El dinero recibido debe ser mayor o igual al total de la venta"
        });
        return;
      }
    }

    const userId = this.currentUserId;
    const detalles = this.items.map(it => ({
      productId: it.productId,
      qty: it.qty,
      unitPrice: it.unitPrice
    }));

    try {
      const resp = await (window as any).electronAPI.registerSale(
        userId,
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

        this.advanceFolioAfterConfirm();
        this.items = [];
        this.totalVenta = 0;
        this.dineroRecibido = null;
        this.customerId = null;
        this.dueDate = null;

        this.showModal = false;
        this.showPostSaleModal = true;
      } else {
        this.showModal = false;
        await Swal.fire({
          icon: 'error',
          title: 'Error al registrar venta',
          text: resp?.error || 'No se pudo registrar la venta.'
        });
      }
    } catch (e: any) {
      this.showModal = false;
      await Swal.fire({
        icon: 'error',
        title: 'Error al registrar la venta',
        text: e.message || 'Ocurrió un error inesperado.'
      });
    }
  }

  /** ================== PRODUCTOS ================== */
  async abrirModalProductos() {
    // opcional: si quieres bloquear agregar producto sin turno, descomenta:
    // const ok = await this.ensureShiftOpen('VENTA');
    // if (!ok) return;

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
    this.recalcularTotal();
    this.showModalProductos = false;
  }

  /** ================== CAJÓN MANUAL & SALIDA EFECTIVO ================== */
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

  /** ================== POST-VENTA: PDF / WHATSAPP ================== */
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

  /** ================== ATAJOS ================== */
  @HostListener('window:keydown', ['$event'])
  async handleKeyboardEvent(event: KeyboardEvent) {
    switch (event.key) {
      case 'F1':
        event.preventDefault();
        this.abrirCajonManual();
        break;

      case 'F7':
        event.preventDefault();
        if (!this.showModalProductos) {
          this.abrirModalProductos();
        }
        break;

      case 'F8':
        event.preventDefault();
        if (!this.showModal) {
          await this.abrirModalCobrar();
        }
        break;

      case 'F10':
        event.preventDefault();
        if (!this.showCashOutModal) {
          await this.abrirSalidaEfectivo();
        }
        break;
    }
  }
}
