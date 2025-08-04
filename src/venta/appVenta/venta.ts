import { Component, HostListener } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgIf, CurrencyPipe, DatePipe } from '@angular/common';

@Component({
  selector: 'app-venta',
  templateUrl: './venta.html',
  imports: [RouterOutlet, FormsModule, NgIf, CurrencyPipe, DatePipe],
  styleUrls: ['./venta.css']
})
export class Venta {
//   menuOpen = true;

//   toggleMenu() {
//     this.menuOpen = !this.menuOpen;
//   }
today = new Date();
showModal = false;
totalVenta = 0; // Aquí pon el total real calculado
dineroRecibido: number | null = null;

  get cambio(): number {
    if (this.dineroRecibido == null) return 0;
    const c = this.dineroRecibido - this.totalVenta;
    return c > 0 ? c : 0;
  }

  abrirModalCobrar() {
    this.dineroRecibido = null;
    this.showModal = true;
  }

  cerrarModalCobrar() {
    this.showModal = false;
  }

  constructor() {
    this.totalVenta = 385.50;
  }

@HostListener('window:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    if (event.key === 'F8') {
      event.preventDefault(); // evita que el navegador haga otra acción
      if (!this.showModal) {
        this.abrirModalCobrar();
      }
    }
  }
}
