import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { JsonPipe, NgFor, NgIf, NgStyle, CurrencyPipe } from '@angular/common';
import Swal from 'sweetalert2';

interface ProductForm {
  brand: number | null;
  category: number | null;
  partNumber: string;
  name: string;
  price: number | null;
  stock: number;
}

interface CategoryRow { id: number; namee: string; }
interface BrandRow { id: number; namee: string; }

type PageItem = number | '...';

@Component({
  selector: 'app-inventario',
  templateUrl: './inventario.html',
  standalone: true,
  imports: [RouterOutlet, FormsModule, JsonPipe, NgFor, NgStyle, NgIf, CurrencyPipe],
  styleUrls: ['./inventario.css']
})
export class Inventario {
  form: ProductForm = { brand: null, category: null, partNumber: '', name: '', price: null, stock: 0 };

  menuOpen = true;
  inventario: any[] = [];
  colorModalAbierto = false;
  productoModalAbierto = false;

  brands: BrandRow[] = [];
  categorys: CategoryRow[] = [];

  colores = [
    { nombre: 'Navy Blue', value: '#000080' },
    { nombre: 'Dorado', value: '#B8860B' },
  ];

  filtro = '';
  page = 1;
  pageSizeOptions = [10, 20, 50, 100];
  pageSize = 10;

  constructor() {}

  async ngOnInit() {
    await this.consultarInventario();
    await this.cargarCategorias();
    await this.cargarMarcas();
  }

  toggleMenu() { this.menuOpen = !this.menuOpen; }

  async consultarInventario() {
    try {
      const resultado = await (window as any).electronAPI.getActiveProducts();
      this.inventario = Array.isArray(resultado) ? resultado : [];
      this.page = 1;
    } catch (error) {
      console.error('❌ Error al consultar el inventario:', error);
      this.inventario = [];
      this.page = 1;
    }
  }

  async cargarCategorias() {
    try {
      const rs = await (window as any).electronAPI.getCategories();
      this.categorys = (Array.isArray(rs) && rs.length && 'id' in rs[0]) ? (rs as CategoryRow[]) : [];
    } catch (error) {
      console.error('❌ Error al cargar categorías:', error);
      this.categorys = [];
    }
  }

  async cargarMarcas() {
    try {
      const rs = await (window as any).electronAPI.getBrands();
      this.brands = (Array.isArray(rs) && rs.length && 'id' in rs[0]) ? (rs as BrandRow[]) : [];
    } catch (error) {
      console.error('❌ Error al cargar marcas:', error);
      this.brands = [];
    }
  }

  toast = { show: false, message: '', type: 'success' as 'success'|'error' };
  private toastTimer?: any;

  private showToast(message: string, type: 'success'|'error' = 'success', ms = 2200) {
    this.toast = { show: true, message, type };
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast.show = false), ms);
  }

  async addProduct() {
    try {
      const { brand, category, partNumber, name, price, stock } = this.form;

      if (brand == null || category == null || !partNumber || !name || price == null || stock == null) {
        await Swal.fire({ icon: 'error', title: 'Campos incompletos', text: 'Completa los campos obligatorios.' });
        console.log('Formulario:', this.form);
        return;
      }

      const result = await (window as any).electronAPI.agregarProducto(
        brand, category, partNumber, name, price, stock
      );

      if (result?.success) {
        await this.consultarInventario();
        this.cerrarProductoModal();
        this.form = { brand: null, category: null, partNumber: '', name: '', price: 0, stock: 0 };
        await Swal.fire({
          icon: 'success',
          title: '¡Producto agregado!',
          text: 'Se guardó correctamente.',
          timer: 1800,
          showConfirmButton: false,
          timerProgressBar: true
        });
      } else {
        await Swal.fire({ icon: 'error', title: 'Error', text: result?.error ?? 'No se pudo agregar.' });
      }
    } catch (e) {
      console.error('❌ Error al agregar el producto:', e);
      await Swal.fire({ icon: 'error', title: 'Ups...', text: 'Error inesperado al agregar el producto.' });
    }
  }

  abrirColorModal() { this.colorModalAbierto = true; }
  cerrarColorModal() { this.colorModalAbierto = false; }
  cambiarColor(color: string) {
    document.documentElement.style.setProperty('--castrol-main', color);
    this.colorModalAbierto = false;
  }

  abrirProductoModal() {
    this.productoModalAbierto = true;
    this.cargarCategorias();
    this.cargarMarcas();
  }
  cerrarProductoModal() { this.productoModalAbierto = false; }

  get inventarioFiltrado(): any[] {
    const f = (this.filtro || '').toLowerCase().trim();
    if (!f) return this.inventario;

    return this.inventario.filter(p => {
      const part = String(p.part_number ?? '').toLowerCase();
      const name = String(p.product_name ?? '').toLowerCase();
      const cat  = String(p.category_name ?? '').toLowerCase();
      const brand= String(p.brand_name ?? '').toLowerCase();
      const price= String(p.price ?? '').toLowerCase();
      const stock= String(p.stock ?? '').toLowerCase();
      return (
        part.includes(f) ||
        name.includes(f) ||
        cat.includes(f) ||
        brand.includes(f) ||
        price.includes(f) ||
        stock.includes(f)
      );
    });
  }

  get totalItems(): number { return this.inventarioFiltrado.length; }

  get totalPages(): number {
    const t = Math.ceil(this.totalItems / this.pageSize);
    return Math.max(1, t);
  }

  get pageStartIndex(): number {
    return (this.page - 1) * this.pageSize;
  }

  get pageEndIndex(): number {
    return Math.min(this.pageStartIndex + this.pageSize, this.totalItems);
  }

  get inventarioPaginado(): any[] {
    const start = this.pageStartIndex;
    const end = start + this.pageSize;
    return this.inventarioFiltrado.slice(start, end);
  }

  clearFilter() {
    this.filtro = '';
    this.page = 1;
  }

  onFilterChange() {
    this.page = 1;
  }

  onPageSizeChange(v: any) {
    const n = Number(v);
    this.pageSize = Number.isFinite(n) && n > 0 ? n : 10;
    this.page = 1;
  }

  prevPage() {
    if (this.page > 1) this.page--;
  }

  nextPage() {
    if (this.page < this.totalPages) this.page++;
  }

  goToPage(p: number) {
    const page = Math.max(1, Math.min(this.totalPages, p));
    this.page = page;
  }

  onPageClick(p: PageItem) {
    if (p === '...') return;
    this.goToPage(p);
  }

  get pagesToShow(): PageItem[] {
    const total = this.totalPages;
    const current = this.page;

    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

    const items: PageItem[] = [];
    const left = Math.max(2, current - 1);
    const right = Math.min(total - 1, current + 1);

    items.push(1);

    if (left > 2) items.push('...');

    for (let i = left; i <= right; i++) items.push(i);

    if (right < total - 1) items.push('...');

    items.push(total);

    return items;
  }
}
