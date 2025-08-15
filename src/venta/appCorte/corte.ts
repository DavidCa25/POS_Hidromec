import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgIf, NgFor, CurrencyPipe, DatePipe } from '@angular/common';

type MetodoPago = 'EFECTIVO' | 'TARJETA' | 'TRANSFERENCIA';

interface VentaRow {
  folio: number;
  fecha: Date;
  metodo: MetodoPago;
  subtotal: number;
  iva: number;
  total: number;
  cajero: string;
}

@Component({
  selector: 'app-corte',
  templateUrl: './corte.html',
  standalone: true,
  imports: [RouterOutlet, FormsModule, NgIf, NgFor, CurrencyPipe, DatePipe],
  styleUrls: ['./corte.css']
})
export class Corte {
  hoy = new Date();

  // Hardcodeado (ejemplo de ventas de hoy)
  ventas: VentaRow[] = [
    { folio: 101, fecha: new Date(), metodo: 'EFECTIVO',      subtotal: 1200, iva: 192,  total: 1392,  cajero: 'Daniela' },
    { folio: 102, fecha: new Date(), metodo: 'TARJETA',       subtotal: 2550, iva: 408,  total: 2958,  cajero: 'Daniela' },
    { folio: 103, fecha: new Date(), metodo: 'TRANSFERENCIA', subtotal: 980.5,iva: 156.88,total: 1137.38, cajero: 'Daniela' },
    { folio: 104, fecha: new Date(), metodo: 'EFECTIVO',      subtotal: 600,  iva: 96,   total: 696,   cajero: 'Daniela' },
  ];

  // KPIs
  get tickets(): number { return this.ventas.length; }
  get totalEfectivo(): number { return this.ventas.filter(v => v.metodo==='EFECTIVO').reduce((a,v)=>a+v.total,0); }
  get totalTarjeta(): number { return this.ventas.filter(v => v.metodo==='TARJETA').reduce((a,v)=>a+v.total,0); }
  get totalTransfer(): number { return this.ventas.filter(v => v.metodo==='TRANSFERENCIA').reduce((a,v)=>a+v.total,0); }
  get totalVendido(): number { return this.ventas.reduce((a,v)=>a+v.total,0); }
  get subtotalAcum(): number { return this.ventas.reduce((a,v)=>a+v.subtotal,0); }
  get ivaAcum(): number { return this.ventas.reduce((a,v)=>a+v.iva,0); }

  imprimir() { window.print(); }

  exportarCSV() {
    const encabezados = ['Folio','Fecha','Hora','Método','Subtotal','IVA','Total','Cajero'];
    const filas = this.ventas.map(v => ([
      v.folio,
      new Intl.DateTimeFormat('es-MX').format(v.fecha),
      new Intl.DateTimeFormat('es-MX',{hour:'2-digit',minute:'2-digit'}).format(v.fecha),
      v.metodo,
      v.subtotal.toFixed(2),
      v.iva.toFixed(2),
      v.total.toFixed(2),
      v.cajero
    ]));
    const csv = [encabezados, ...filas].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `corte_${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }
}
