import { Component, HostListener,LOCALE_ID, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgIf, NgFor, CurrencyPipe, DatePipe, SlicePipe } from '@angular/common';
import { registerLocaleData } from '@angular/common';
import localeEsMX from '@angular/common/locales/es-MX';
import { AuthService } from '../../services/auth.service';

registerLocaleData(localeEsMX, 'es-MX');

interface ProductRow {
  id: number;
  part_number: string;
  product_name: string;
  price: number;
  stock: number;
  category_name: string;
  brand_name: string;
  purchasePrice?: number;
}

interface Proveedor {
  id: number;
  nombre: string;
}

class PurchaseItem {
  constructor(
    public productId: number,
    public productName: string,
    public qty: number,
    public unitPrice: number,     // Precio de venta (referencia)
    public purchasePrice: number,
    public proveedorId: number | null
  ) {}
  get subtotal(): number {
    return this.qty * this.purchasePrice;
  }
}

@Component({
  selector: 'app-compras',
  templateUrl: './compras.html',
  imports: [RouterOutlet, FormsModule, NgIf, NgFor, CurrencyPipe, DatePipe, SlicePipe],
  styleUrls: ['./compras.css'],
  providers: [
    { provide: LOCALE_ID, useValue: 'es-MX' }
  ]
})
export class Compras implements OnInit {
  folio: number | null = null;
  today = new Date();

  // Proveedor
  proveedores: Proveedor[] = [];
  proveedorSeleccionado: number | null = null;

  // Productos
  showModalProductos = false;
  productos: ProductRow[] = [];
  filtro = '';

  // Items de compra
  items: PurchaseItem[] = [];

  // IVA
  ivaTasa = 0.16; // 16%

  constructor(private authService: AuthService) {
    this.cargarProveedores();

    console.log('📅 today:', this.today);

  }

  ngOnInit() {
    this.cargarFolio();
  }

  cargarFolio() {
    (window as any).electronAPI.getNextPurchaseFolio()
      .then((resFolio: any) => {
        if (resFolio.success) {
          this.folio = resFolio.folio;
        }
      })
      .catch((err: any) => {
        console.error('Error al obtener folio al iniciar:', err);
      });
  }

  get usuarioActualId(): number {
    return this.authService.usuarioActualId ?? 0;
  }

  /** ----- CALCULOS ----- **/
  get subtotal(): number {
    return this.items.reduce((acc, it) => acc + it.subtotal, 0);
  }
  get iva(): number {
    return this.subtotal * this.ivaTasa;
  }
  get total(): number {
    return this.subtotal + this.iva;
  }

  /** ----- PROVEEDORES ----- **/
  async cargarProveedores() {
    try {
      const rs = await (window as any).electronAPI.getSuppliers();
      this.proveedores = Array.isArray(rs) ? rs : [];
    } catch (e) {
      console.error('❌ Error al cargar proveedores:', e);
      this.proveedores = [];
    }
  }

  /** ----- PRODUCTOS ----- **/
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
        brand_name: r.brand_name,
        purchasePrice: 0  
      })) as (ProductRow & { purchasePrice: number })[];
    } catch (e) {
      console.error('❌ Error al cargar productos activos:', e);
      this.productos = [];
    }
  }


  seleccionarProducto(p: ProductRow & { purchasePrice?: number }) {
    if (!p.purchasePrice || p.purchasePrice <= 0) {
    alert('Por favor, ingresa un precio de compra válido antes de agregar el producto.');
    return; // Salir de la función sin agregar nada
  }
    const existing = this.items.find(it => it.productId === p.id);
    if (existing) {
      existing.qty += 1;
      this.showModalProductos = false;
      return;
    }

    const item = new PurchaseItem(
      p.id,
      p.product_name,
      1,
      p.price ?? 0,
      p.purchasePrice ?? 0,
      null    
    );
    this.items.push(item);
    this.showModalProductos = false;
  }

  /** ----- EVENTOS DE CAMBIO ----- **/
  onQtyChange(i: number) {
    const it = this.items[i];
    if (!it) return;
    if (it.qty < 1) it.qty = 1;

    console.log(`Item ${i}: qty=${it.qty}, purchasePrice=${it.purchasePrice}, subtotal=${it.subtotal}`);
  }

  onPurchasePriceChange(i: number) {
    const it = this.items[i];
    if (!it) return;
    if (it.purchasePrice < 0) it.purchasePrice = 0;

    console.log(`Item ${i}: qty=${it.qty}, purchasePrice=${it.purchasePrice}, subtotal=${it.subtotal}`);
  }

  onProveedorChange(i: number) {
  const item = this.items[i];
  if (!item) return;
  console.log(`Proveedor cambiado para item ${i}: proveedorId=${item.proveedorId}`);
}


  quitarItem(i: number) {
    this.items.splice(i, 1);
  }

  /** ----- GUARDAR COMPRA ----- **/
  registrarCompra() {

    if (this.items.length === 0) {
      alert('Agregue productos a la compra.');
      return;
    }

    const sinProveedor = this.items.some(it => !it.proveedorId);
    if (sinProveedor) {
      alert('Todos los productos deben tener un proveedor asignado.');
      return;
    }

    const payload = {
      user_id: this.usuarioActualId, 
      tax_rate: this.ivaTasa, 
      tax_amount: this.iva,
      subtotal: this.subtotal,
      total: this.total,
      detalles: this.items.map(it => ({
        product_id: it.productId,
        supplier_id: it.proveedorId,
        quantity: it.qty,
        unit_price: it.purchasePrice
      }))
    };

    console.log('💾 Registrando compra:', payload);

    (window as any).electronAPI.registerPurchase(payload)
      .then((res: any) => {
        if (res.success) {
          alert('Compra registrada correctamente.');
          this.items = [];

          (window as any).electronAPI.getNextPurchaseFolio()
          .then((resFolio: any) => {
            if (resFolio.success) {
              this.folio = resFolio.folio;
            }
          });
        } else {
          console.error(res.error);
          alert('Error al registrar la compra.');
        }
      })
      .catch((err: any) => {
        console.error('❌ Error en registrarCompra:', err);
        alert('Error de conexión al registrar la compra.');
      });
  }


  /** ----- ATAJOS DE TECLADO ----- **/
  @HostListener('window:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    if (event.key === 'F8') {
      event.preventDefault();
      this.registrarCompra();
    }
  }
}
