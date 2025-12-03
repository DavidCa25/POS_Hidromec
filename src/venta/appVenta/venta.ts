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

  showModalProductos = false;
  productos: ProductRow[] = [];
  filtro = '';

  items: SaleItem[] = [];
  totalVenta = 0;

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
          const api = (window as any).electronAPI;
          if (api && api.openCashDrawer) {
            try {
              await api.openCashDrawer();
            } catch (e) {
              console.error('⚠ Error al abrir el cajón después de la venta:', e);
            }
          } else {
            console.warn('openCashDrawer no disponible (¿modo ng serve?)');
          }
        }

        this.advanceFolioAfterConfirm();
        this.items = [];
        this.totalVenta = 0;
        this.dineroRecibido = null;
        this.customerId = null;
        this.dueDate = null;
        this.showModal = false;

        await Swal.fire({
          icon: 'success',
          title: isCredito ? 'Venta a crédito registrada' : 'Venta registrada',
          text: 'Se guardó correctamente.',
          timer: 1800,
          showConfirmButton: false,
          timerProgressBar: true
        });
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

  @HostListener('window:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    if (event.key === 'F8') {
      event.preventDefault();
      if (!this.showModal) this.abrirModalCobrar();
    }
  }
}
