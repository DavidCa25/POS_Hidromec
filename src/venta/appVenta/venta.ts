import { Component, HostListener } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgIf, NgFor, CurrencyPipe, DatePipe, SlicePipe } from '@angular/common';
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
  imports: [RouterOutlet, FormsModule, NgIf, NgFor, CurrencyPipe, DatePipe, SlicePipe],
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

  constructor(private auth: AuthService, private router: Router) {
    this.totalVenta = 0;
  }

  ngOnInit() {
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
  private peekNextFolio(): number {
    return this.readFolioCounter() + 1;
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

  abrirModalCobrar() {
    this.dineroRecibido = null;
    this.showModal = true;
  }
  cerrarModalCobrar() { this.showModal = false; }

  async onPaymentMethodChange(method: 'EFECTIVO' | 'TARJETA' | 'TRANSFERENCIA' | 'CREDITO') {
    console.log('onPaymentMethodChange =>', method);
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
    console.log('loadCreditCustomers() called');
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
      console.log('getCreditCustomers resp:', resp);

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

      if (this.creditCustomers.length > 0) {
        this.customerId = this.creditCustomers[0].id;
      } else {
        this.customerId = null;
      }

    } catch (e: any) {
      console.error('❌ loadCreditCustomers:', e);
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
    if (this.items.length === 0) {
      this.showModal = false;
      await Swal.fire({
        icon: "error",
        title: "Oops...",
        text: "Agrega productos a la venta"
      });
      return;
    }
    if (this.totalVenta <= 0) {
      this.showModal = false;
      await Swal.fire({
        icon: "error",
        title: "Oops...",
        text: "El total de la venta debe ser mayor a cero"
      });
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
            try {
              await api.openCashDrawer();
            } catch (e) {
              console.error('Error al abrir el cajón después de la venta:', e);
            }
          } else {
            this.lastSalePaid = this.totalVenta;
            this.lastSaleChange = 0;
            console.warn('openCashDrawer no disponible (¿modo ng serve?)');
          }
        }

        const saleId: number | null =
          resp.saleId ?? resp.id ?? resp.folio ?? null;

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
      console.error('❌ registerSale:', e);
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
    } catch (e) {
      console.error('❌ Error al cargar productos activos:', e);
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
      console.warn('openCashDrawer no disponible (¿modo ng serve?)');
      await Swal.fire({
        icon: 'info',
        title: 'No disponible',
        text: 'La apertura del cajón no está disponible en este entorno.'
      });
      return;
    }

    try {
      await api.openCashDrawer();
    } catch (e) {
      console.error('⚠ Error al abrir el cajón:', e);
      await Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'No se pudo abrir el cajón. Revisa la configuración.'
      });
    }
  }

  abrirSalidaEfectivo() {
    this.cashOutAmount = null;
    this.cashOutNote = '';
    this.showCashOutModal = true;
  }

  cerrarSalidaEfectivo() {
    this.showCashOutModal = false;
  }

  async confirmarSalidaEfectivo() {
    const amount = Number(this.cashOutAmount ?? 0);

    if (amount <= 0) {
      await Swal.fire({
        icon: 'error',
        title: 'Monto inválido',
        text: 'El monto a retirar debe ser mayor a cero.'
      });
      return;
    }

    if (!this.cashOutNote.trim()) {
      await Swal.fire({
        icon: 'warning',
        title: 'Nota requerida',
        text: 'Describe brevemente para qué es la salida de efectivo (pago a proveedor, etc.).'
      });
      return;
    }

    const api = (window as any).electronAPI;
    if (!api || !api.registerCashMovement) {
      console.error('registerCashMovement no disponible');
      await Swal.fire({
        icon: 'error',
        title: 'No disponible',
        text: 'No se pudo registrar la salida de efectivo (API no disponible).'
      });
      return;
    }

    const payload = {
      user_id: this.currentUserId,
      typee: 'WITHDRAW',
      amount,
      reference_id: null,
      reference: 'SALIDA CAJA',
      note: this.cashOutNote
    };

    try {
      console.log('💸 Registrando salida de efectivo:', payload);
      const resp = await api.registerCashMovement(payload);

      if (resp?.success) {
        this.showCashOutModal = false;
        this.cashOutAmount = null;
        this.cashOutNote = '';
        await Swal.fire({
          icon: 'success',
          title: 'Salida registrada',
          text: 'La salida de efectivo se registró correctamente.'
        });
      } else {
        console.error(resp?.error);
        await Swal.fire({
          icon: 'error',
          title: 'Error al registrar salida',
          text: resp?.error || 'No se pudo registrar la salida de efectivo.'
        });
      }
    } catch (e: any) {
      console.error('❌ registrar salida efectivo:', e);
      await Swal.fire({
        icon: 'error',
        title: 'Error inesperado',
        text: e?.message || 'Ocurrió un error al registrar la salida.'
      });
    }
  }

  /** ================== POST-VENTA: PDF / WHATSAPP ================== */

  cerrarPostSaleModal() {
    this.showPostSaleModal = false;
  }

  async generarPdfUltimaVenta() {
  if (!this.lastSaleId) return;

  const api = (window as any).electronAPI;
    if (!api || !api.generateSalePdf) {
      await Swal.fire({
        icon: 'info',
        title: 'No disponible',
        text: 'La generación de PDF no está configurada en este entorno.'
      });
      return;
    }

    try {
      const payload = {
        saleId: this.lastSaleId,
        pagado: this.lastSalePaid,
        cambio: this.lastSaleChange,
      };

      const resp = await api.generateSalePdf(payload);

      if (!resp?.success) {
        await Swal.fire({
          icon: 'error',
          title: 'Error al generar PDF',
          text: resp?.error || 'No se pudo generar el PDF de la venta.'
        });
        return;
      }

      await Swal.fire({
        icon: 'success',
        title: 'PDF generado',
        text: 'El PDF de la venta se generó correctamente.'
      });
    } catch (e: any) {
      console.error('❌ generarPdfUltimaVenta:', e);
      await Swal.fire({
        icon: 'error',
        title: 'Error inesperado',
        text: e?.message || 'Ocurrió un error al generar el PDF.'
      });
    }
  }

  async enviarTicketWhatsApp() {
    if (!this.lastSaleId) return;

    const api = (window as any).electronAPI;
    if (!api || !api.sendSaleTicketWhatsApp) {
      await Swal.fire({
        icon: 'info',
        title: 'No disponible',
        text: 'El envío por WhatsApp no está configurado en este entorno.'
      });
      return;
    }

    try {
      const resp = await api.sendSaleTicketWhatsApp(this.lastSaleId);
      if (!resp?.success) {
        await Swal.fire({
          icon: 'error',
          title: 'Error al enviar ticket',
          text: resp?.error || 'No se pudo enviar el ticket por WhatsApp.'
        });
        return;
      }

      await Swal.fire({
        icon: 'success',
        title: 'Ticket enviado',
        text: 'Se envió el ticket por WhatsApp correctamente.'
      });
    } catch (e: any) {
      console.error('❌ enviarTicketWhatsApp:', e);
      await Swal.fire({
        icon: 'error',
        title: 'Error inesperado',
        text: e?.message || 'Ocurrió un error al enviar el ticket.'
      });
    }
  }

  

  /** ================== ATAJOS ================== */

  @HostListener('window:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
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
          this.abrirModalCobrar();
        }
        break;

      case 'F10':
        event.preventDefault();
        if (!this.showCashOutModal) {
          this.abrirSalidaEfectivo();
        }
        break;
    }
  }
}
