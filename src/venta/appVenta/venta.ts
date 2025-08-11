import { Component, HostListener } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgIf, NgFor, CurrencyPipe, DatePipe, SlicePipe } from '@angular/common';


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

@Component({
  selector: 'app-venta',
  templateUrl: './venta.html',
  imports: [RouterOutlet, FormsModule, NgIf, NgFor, CurrencyPipe, DatePipe, SlicePipe],
  styleUrls: ['./venta.css']
})
export class Venta {
  today = new Date();

  // Modal de cobro
  showModal = false;
  dineroRecibido: number | null = null;

  // Modal de productos
  showModalProductos = false;
  productos: ProductRow[] = [];
  filtro = '';

  // Detalle de la venta
  items: SaleItem[] = [];
  totalVenta = 0;

  constructor() {
    this.totalVenta = 0;
  }

  // ====== Calculos ======
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
