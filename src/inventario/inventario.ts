import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { JsonPipe, NgFor, NgIf, NgStyle } from '@angular/common';
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

@Component({
  selector: 'app-inventario',
  templateUrl: './inventario.html',
  standalone: true,
  imports: [RouterOutlet, FormsModule, JsonPipe, NgFor, NgStyle, NgIf],
  styleUrls: ['./inventario.css']
})
export class Inventario {
  form: ProductForm = {brand: null, category: null, partNumber: '', name: '', price: null, stock: 0};

  menuOpen = true;
  inventario: any[] = [];
  colorModalAbierto = false;
  productoModalAbierto = false;

  brands: { id: number; namee: string }[] = [];
  categorys: { id: number; namee: string }[] = [];

  colores = [
    { nombre: 'Navy Blue', value: '#000080' },
    { nombre: 'Dorado', value: '#B8860B' },
  ];

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
      this.inventario = resultado ?? [];
    } catch (error) {
      console.error('❌ Error al consultar el inventario:', error);
      this.inventario = [];
    }
  }

  async cargarCategorias() {
    try {
      const rs = await (window as any).electronAPI.getCategories();

      if (Array.isArray(rs) && rs.length && 'id' in rs[0]) {
        this.categorys = rs as CategoryRow[];
        return;
      }
      this.categorys = [];
    } catch (error) {
      console.error('❌ Error al cargar categorías:', error);
      this.categorys = [];
    }
  }

  async cargarMarcas() {
    try {
      const rs = await (window as any).electronAPI.getBrands();

      if (Array.isArray(rs) && rs.length && 'id' in rs[0]) {
        this.brands = rs as BrandRow[];
        return;
      }
      this.brands = [];
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
      const {brand, category, partNumber, name, price, stock } = this.form;
      if (brand == null || category == null || !partNumber || !name || !price || !stock  == null) {
        await Swal.fire({ icon: 'error', title: 'Campos incompletos', text: 'Completa los campos obligatorios.' });
        console.log('Formulario:', this.form);

        return;
      }
      const result = await (window as any).electronAPI.agregarProducto(
        brand, category, partNumber, name, price, stock
      );

      console.log('Formulario:', this.form);

      if (result?.success) {
        await this.consultarInventario();
        this.cerrarProductoModal();
        this.form = {brand: null,  category: null, partNumber: '', name: '', price: 0, stock: 0 };
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
}
