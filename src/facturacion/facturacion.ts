import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { FacturaNueva } from '../app/factura-nueva/factura-nueva.component';
import { FacturaDetalle } from '../app/factura-detalle/factura-detalle.component';

interface Invoice {
  id: number;
  uuid: string | null;
  serie: string | null;
  folio: string | null;
  tipo: string;
  receptor_rfc: string;
  receptor_razon_social: string;
  total: number;
  estado: string;
  fecha_timbrado: string | null;
  created_at: string;
}

interface Counts {
  total: number;
  timbradas: number;
  borradores: number;
  canceladas: number;
  errores: number;
}

@Component({
  selector: 'app-facturacion',
  standalone: true,
  templateUrl: './facturacion.html',
  imports: [FormsModule, CommonModule, FacturaNueva, FacturaDetalle],
  styleUrls: ['./facturacion.css']
})
export class Facturacion implements OnInit {
  invoices: Invoice[] = [];
  counts: Counts = { total: 0, timbradas: 0, borradores: 0, canceladas: 0, errores: 0 };
  filtroEstado: string | null = null;
  busqueda = '';
  cargando = true;
  showFacturaModal = false;
  verId: number | null = null;

  constructor(private router: Router) {}

  private get api() {
    return (window as any).electronAPI;
  }

  async ngOnInit() {
    await this.cargar();
  }

  async cargar() {
    this.cargando = true;
    try {
      const [inv, cnt] = await Promise.all([
        this.api?.getInvoices?.({ estado: this.filtroEstado, busqueda: this.busqueda || null }),
        this.api?.getInvoicesCounts?.()
      ]);
      this.invoices = inv?.success ? inv.data : [];
      if (cnt?.success && cnt.data) this.counts = cnt.data;
    } catch {
      this.invoices = [];
    } finally {
      this.cargando = false;
    }
  }

  nuevaFactura() {
    this.showFacturaModal = true;
  }

  onFacturaCerrada() {
    this.showFacturaModal = false;
    this.cargar();  
  }

  verFactura(f: Invoice) {
    this.verId = f.id;
  }

  cerrarDetalle() {
    this.verId = null;
  }

  onDetalleActualizado() {
    this.cargar(); 
  }

  filtrar(estado: string | null) {
    this.filtroEstado = estado;
    this.cargar();
  }

  irAConfiguracion() {
    this.router.navigate(['/facturacion/configuracion']);
  }

  money(n: number | null | undefined): string {
    return '$' + Number(n ?? 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  estadoLabel(estado: string): string {
    const map: Record<string, string> = {
      timbrada: 'Timbrada', borrador: 'Borrador', cancelada: 'Cancelada', error: 'Error'
    };
    return map[estado] || estado;
  }
}