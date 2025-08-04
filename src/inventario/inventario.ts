import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { JsonPipe } from '@angular/common';
import { NgFor, NgStyle, NgIf } from '@angular/common';

@Component({
  selector: 'app-inventario',
  templateUrl: './inventario.html',
  standalone: true,
  imports: [RouterOutlet, FormsModule, JsonPipe, NgFor, NgStyle, NgIf],
  styleUrls: ['./inventario.css']
})
export class Inventario {
  menuOpen = true;
  inventario: any[] = [];
  colorModalAbierto = false;
  productoModalAbierto = false;
  brand: { BrandID: number; BrandName: string }[] = [];
  categorys: { CategoryID: number; CategoryName: string }[] = [];
  subcategorys: { SubCategoryID: number; SubCategoryName: string }[] = [];

  colores = [
  { nombre: 'Castrol', value: '#00662f' },
  { nombre: 'Azul fuerte', value: '#0070cc' },
  { nombre: 'Azul claro', value: '#047ef8' },
  { nombre: 'Mostaza', value: '#c99c1c' },
  ];

  piezasCaja = [
    { value: 3, label: '3 piezas' },
    { value: 4, label: '4 piezas' },
    { value: 12, label: '12 piezas'}
  ]

  controlType = [
    { value: 'CAJA', label: 'CAJA'},
    { value: 'PIEZA', label: 'PIEZA'}
  ]

  constructor() {
  }

  ngOnInit(): void { 
    this.consultarInventario();
    this.onCategoryChange({ target: { value: 1 } });
  }

  toggleMenu() {
    this.menuOpen = !this.menuOpen;
  }

  

  async consultarInventario() {
    try {
      const resultado = await (window as any).electronAPI.consultarInventario();
      this.inventario = resultado;

    } catch (error) {
      console.error('❌ Error al consultar el inventario:', error);
      this.inventario = [];
    }
  }

  async agregarProducto() {
    try {
      // const producto = await (window as any).electronAPI.agregarProducto();
      // console.log('👉 Producto agregado:', producto);
      this.consultarInventario(); // Actualizar el inventario después de agregar
    } catch (error) {
      console.error('❌ Error al agregar el producto:', error);
    }
  }

  async onCategoryChange(event: any) {
  const categoryID = event.target.value;

  this.brand = [];
  this.categorys = [];
  this.subcategorys = [];

  try {
    const detalles = await (window as any).electronAPI.consultarDetallesProducto(categoryID);
    this.brand = detalles.brand;     
    this.categorys = detalles.categorys;          
    this.subcategorys = detalles.subcategorys; 

    } catch (error) {
      console.error('❌ Error al consultar los detalles del producto:', error);
      
    }
  }


  abrirColorModal() {
  this.colorModalAbierto = true;
  }
  cerrarColorModal() {
    this.colorModalAbierto = false;
  }
  cambiarColor(color: string) {
    document.documentElement.style.setProperty('--castrol-main', color);
    this.colorModalAbierto = false;
  }

  abrirProductoModal() {
    this.productoModalAbierto = true;
  }
  cerrarProductoModal() {
    this.productoModalAbierto = false;
  }

  addProducto() {
    
  }
}
