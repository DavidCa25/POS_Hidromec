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

type SupplierRow = { id: number; nombre: string };

type ProductSupplierRow = {
  product_id: number;
  supplier_id: number;
  supplier_name: string;
  is_default: boolean;
  last_cost: number | null;
  active: boolean;
};

@Component({
  selector: 'app-inventario',
  templateUrl: './inventario.html',
  standalone: true,
  imports: [RouterOutlet, FormsModule, JsonPipe, NgFor, NgStyle, NgIf, CurrencyPipe],
  styleUrls: ['./inventario.css']
})
export class Inventario {
  form: ProductForm = { brand: null, category: null, partNumber: '', name: '', price: null, stock: 0 };

  inventario: any[] = [];
  colorModalAbierto = false;
  productoModalAbierto = false;

  proveedoresModalAbierto = false;
  selectedProduct: any = null;

  productSuppliers: ProductSupplierRow[] = [];
  suppliersCatalog: SupplierRow[] = [];
  supplierToAdd: number | null = null;
  supplierIsDefault = false;
  supplierLastCost: number | null = null;

  newSupplierName = '';
  creatingSupplier = false;

  brands: BrandRow[] = [];
  categorys: CategoryRow[] = [];

  brandModalAbierto = false;
  categoryModalAbierto = false;

  newBrandName = '';
  newCategoryName = '';

  creatingBrand = false;
  creatingCategory = false;

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
    await this.cargarCatalogoProveedores();
  }

  async consultarInventario() {
    try {
      const resultado = await (window as any).electronAPI.getActiveProducts();
      this.inventario = resultado ?? [];
    } catch (error) {
      console.error('Error al consultar el inventario:', error);
      this.inventario = [];
    }
  }

  async cargarCategorias() {
    try {
      const rs = await (window as any).electronAPI.getCategories();
      this.categorys = (Array.isArray(rs) && rs.length && 'id' in rs[0]) ? rs : [];
    } catch (error) {
      console.error('Error al cargar categorías:', error);
      this.categorys = [];
    }
  }

  async cargarMarcas() {
    try {
      const rs = await (window as any).electronAPI.getBrands();
      this.brands = (Array.isArray(rs) && rs.length && 'id' in rs[0]) ? rs : [];
    } catch (error) {
      console.error('❌ Error al cargar marcas:', error);
      this.brands = [];
    }
  }

  async cargarCatalogoProveedores() {
    try {
      const res = await (window as any).electronAPI.getSuppliers?.();
      const arr = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
      this.suppliersCatalog = (arr ?? []).map((s: any) => ({
        id: Number(s.id),
        nombre: String(s.nombre ?? s.namee ?? s.name ?? '').trim()
      })).filter((s: SupplierRow) => Number.isFinite(s.id) && s.nombre);
    } catch (e) {
      console.error('❌ Error cargando catálogo proveedores:', e);
      this.suppliersCatalog = [];
    }
  }

  async addProduct() {
    try {
      const { brand, category, partNumber, name, price, stock } = this.form;
      if (brand == null || category == null || !partNumber || !name || price == null) {
        await Swal.fire({ icon: 'error', title: 'Campos incompletos', text: 'Completa los campos obligatorios.' });
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
          timer: 1600,
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

  abrirProductoModal() {
    this.productoModalAbierto = true;
    this.cargarCategorias();
    this.cargarMarcas();
  }
  cerrarProductoModal() { this.productoModalAbierto = false; }

  abrirColorModal() { this.colorModalAbierto = true; }
  cerrarColorModal() { this.colorModalAbierto = false; }
  cambiarColor(color: string) {
    document.documentElement.style.setProperty('--castrol-main', color);
    this.colorModalAbierto = false;
  }

  async abrirProveedoresModal(product: any) {
    this.selectedProduct = product;
    this.proveedoresModalAbierto = true;

    this.supplierToAdd = null;
    this.supplierIsDefault = false;
    this.supplierLastCost = null;

    this.newSupplierName = '';
    this.creatingSupplier = false;

    await this.cargarCatalogoProveedores();
    await this.cargarProveedoresDeProducto();
  }

  cerrarProveedoresModal() {
    this.proveedoresModalAbierto = false;
    this.selectedProduct = null;
    this.productSuppliers = [];
  }

  async cargarProveedoresDeProducto() {
    try {
      const api = (window as any).electronAPI;
      const productId = Number(this.selectedProduct?.id ?? 0);
      if (!productId) return;

      const res = await api.getProductSuppliers(productId, false);
      if (!res?.success) throw new Error(res?.error || 'No se pudieron cargar proveedores');

      this.productSuppliers = (res.data ?? []).map((r: any) => ({
        product_id: Number(r.product_id),
        supplier_id: Number(r.supplier_id),
        supplier_name: String(r.supplier_name ?? r.nombre ?? r.namee ?? '—'),
        is_default: !!r.is_default,
        last_cost: (r.last_cost === null || r.last_cost === undefined) ? null : Number(r.last_cost),
        active: r.active === undefined ? true : !!r.active
      }));
    } catch (e) {
      console.error('cargarProveedoresDeProducto:', e);
      this.productSuppliers = [];
    }
  }

  async agregarProveedorAlProducto() {
    try {
      const api = (window as any).electronAPI;
      const productId = Number(this.selectedProduct?.id ?? 0);
      const supplierId = Number(this.supplierToAdd ?? 0);

      if (!productId || !supplierId) {
        await Swal.fire('Falta proveedor', 'Selecciona un proveedor.', 'warning');
        return;
      }

      const payload = {
        product_id: productId,
        supplier_id: supplierId,
        is_default: this.supplierIsDefault ? 1 : 0,
        last_cost: this.supplierLastCost,
        active: 1
      };

      const res = await api.upsertProductSupplier(payload);
      if (!res?.success) throw new Error(res?.error || 'No se pudo agregar');

      this.productSuppliers = res.data ?? [];
      this.supplierToAdd = null;
      this.supplierIsDefault = false;
      this.supplierLastCost = null;

      await this.consultarInventario();
    } catch (e: any) {
      console.error(e);
      await Swal.fire('Error', e?.message || 'No se pudo agregar el proveedor.', 'error');
    }
  }

  async crearProveedorCatalogoYSeleccionar() {
    const nombre = (this.newSupplierName || '').trim();
    if (!nombre) {
      await Swal.fire('Falta nombre', 'Escribe el nombre del proveedor.', 'warning');
      return;
    }

    try {
      this.creatingSupplier = true;
      const api = (window as any).electronAPI;
      if (!api?.addSupplier) {
        await Swal.fire('No disponible', 'electronAPI.addSupplier no existe.', 'error');
        return;
      }

      const res = await api.addSupplier(nombre);
      if (!res?.success) throw new Error(res?.error || 'No se pudo crear proveedor');

      const newId = Number(res?.data?.id ?? 0);
      await this.cargarCatalogoProveedores();

      if (newId) this.supplierToAdd = newId;

      this.newSupplierName = '';
      await Swal.fire('Listo', 'Proveedor creado en catálogo.', 'success');
    } catch (e: any) {
      console.error(e);
      await Swal.fire('Error', e?.message || 'No se pudo crear el proveedor.', 'error');
    } finally {
      this.creatingSupplier = false;
    }
  }

  async setDefaultSupplier(row: ProductSupplierRow) {
    try {
      const api = (window as any).electronAPI;
      const res = await api.setProductDefaultSupplier(row.product_id, row.supplier_id);
      if (!res?.success) throw new Error(res?.error || 'No se pudo asignar default');

      this.productSuppliers = res.data ?? [];
      await this.consultarInventario(); 
    } catch (e: any) {
      console.error(e);
      await Swal.fire('Error', e?.message || 'No se pudo asignar default.', 'error');
    }
  }

  async updateLastCost(row: ProductSupplierRow) {
    try {
      const api = (window as any).electronAPI;
      const payload = {
        product_id: row.product_id,
        supplier_id: row.supplier_id,
        is_default: row.is_default ? 1 : 0,
        last_cost: row.last_cost,
        active: row.active ? 1 : 0
      };

      const res = await api.upsertProductSupplier(payload);
      if (!res?.success) throw new Error(res?.error || 'No se pudo actualizar');

      this.productSuppliers = res.data ?? [];
    } catch (e: any) {
      console.error(e);
      await Swal.fire('Error', e?.message || 'No se pudo actualizar.', 'error');
    }
  }

  async quitarProveedor(row: ProductSupplierRow) {
    const ok = await Swal.fire({
      icon: 'warning',
      title: 'Quitar proveedor',
      text: `¿Quitar "${row.supplier_name}" de este producto?`,
      showCancelButton: true,
      confirmButtonText: 'Sí, quitar',
      cancelButtonText: 'Cancelar'
    });

    if (!ok.isConfirmed) return;

    try {
      const api = (window as any).electronAPI;
      const res = await api.removeProductSupplier(row.product_id, row.supplier_id);
      if (!res?.success) throw new Error(res?.error || 'No se pudo quitar');

      this.productSuppliers = res.data ?? [];
      await this.consultarInventario(); // refresca columna default
    } catch (e: any) {
      console.error(e);
      await Swal.fire('Error', e?.message || 'No se pudo quitar.', 'error');
    }
  }

  get inventarioFiltrado(): any[] {
    const f = (this.filtro || '').toLowerCase().trim();
    if (!f) return this.inventario;

    return this.inventario.filter(p => {
      const part = String(p.part_number ?? '').toLowerCase();
      const name = String(p.product_name ?? p.nombre ?? '').toLowerCase();
      const cat  = String(p.category_name ?? '').toLowerCase();
      const brand= String(p.brand_name ?? '').toLowerCase();
      const supplier = String(p.default_supplier_name ?? '').toLowerCase();
      const price= String(p.price ?? '').toLowerCase();
      const stock= String(p.stock ?? '').toLowerCase();
      return (
        part.includes(f) ||
        name.includes(f) ||
        cat.includes(f) ||
        brand.includes(f) ||
        supplier.includes(f) ||
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

  clearFilter() { this.filtro = ''; this.page = 1; }
  onFilterChange() { this.page = 1; }

  onPageSizeChange(v: any) {
    const n = Number(v);
    this.pageSize = Number.isFinite(n) && n > 0 ? n : 10;
    this.page = 1;
  }

  prevPage() { if (this.page > 1) this.page--; }
  nextPage() { if (this.page < this.totalPages) this.page++; }

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

  abrirBrandModal() {
    this.newBrandName = '';
    this.brandModalAbierto = true;
    this.categoryModalAbierto = false;
  }

  cerrarBrandModal() {
    this.brandModalAbierto = false;
    this.newBrandName = '';
  }

  abrirCategoryModal() {
    this.newCategoryName = '';
    this.categoryModalAbierto = true;
    this.brandModalAbierto = false;
  }

  cerrarCategoryModal() {
    this.categoryModalAbierto = false;
    this.newCategoryName = '';
  }

  async crearBrandCatalogo() {
    const name = (this.newBrandName || '').trim();
    if (!name) {
      await Swal.fire('Falta nombre', 'Escribe el nombre de la marca.', 'warning');
      return;
    }

    try {
      this.creatingBrand = true;

      const api = (window as any).electronAPI;
      if (!api?.createBrand) {
        await Swal.fire('No disponible', 'electronAPI.createBrand no existe aún.', 'info');
        return;
      }

      const res = await (window as any).electronAPI.createBrand({ name: this.newBrandName });
      if (!res?.success) throw new Error(res?.error || 'No se pudo crear la marca');

      await this.cargarMarcas();
      this.brandModalAbierto = false;

      await Swal.fire({
        icon: 'success',
        title: 'Marca creada',
        text: `"${name}" se agregó correctamente.`,
        timer: 1400,
        showConfirmButton: false
      });

      this.cerrarBrandModal();
    } catch (e: any) {
      console.error(e);
      await Swal.fire('Error', e?.message || 'No se pudo crear la marca.', 'error');
    } finally {
      this.creatingBrand = false;
    }
  }

  async crearCategoryCatalogo() {
    const name = (this.newCategoryName || '').trim();
    if (!name) {
      await Swal.fire('Falta nombre', 'Escribe el nombre de la categoría.', 'warning');
      return;
    }

    try {
      this.creatingCategory = true;

      const api = (window as any).electronAPI;
      if (!api?.addCategories) {
        await Swal.fire('No disponible', 'electronAPI.addCategories no existe aún.', 'info');
        return;
      }

      const res = await (window as any).electronAPI.createCategory({ name: this.newCategoryName });
      if (!res?.success) throw new Error(res?.error || 'No se pudo crear la categoría');

      await this.cargarCategorias();
      this.categoryModalAbierto = false;

      await Swal.fire({
        icon: 'success',
        title: 'Categoría creada',
        text: `"${name}" se agregó correctamente.`,
        timer: 1400,
        showConfirmButton: false
      });

      this.cerrarCategoryModal();
    } catch (e: any) {
      console.error(e);
      await Swal.fire('Error', e?.message || 'No se pudo crear la categoría.', 'error');
    } finally {
      this.creatingCategory = false;
    }
  }
}
