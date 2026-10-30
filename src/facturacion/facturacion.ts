import { Component, OnInit, inject } from '@angular/core';
import Swal from 'sweetalert2';
import { ReportService, ReportConfig, fechaSql } from '../services/report.service';
import { WxMenuComponent, WxMenuOpcion } from '../app/wx-menu/wx-menu.component';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { FacturaNueva } from '../app/factura-nueva/factura-nueva.component';
import { FacturaDetalle } from '../app/factura-detalle/factura-detalle.component';
import { FechaSqlPipe } from '../core';

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
  imports: [FechaSqlPipe, FormsModule, CommonModule, FacturaNueva, FacturaDetalle, WxMenuComponent],
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

  /* ------------------------------------------------------- exportar
     La lista que se ve (estado y búsqueda): relación de facturas para el
     contador. Los XML y PDF de cada CFDI se descargan desde su detalle. */
  private readonly reportes = inject(ReportService);
  readonly opcionesExportar: WxMenuOpcion[] = [
    { valor: 'pdf', etiqueta: 'PDF', icono: 'ph ph-file-pdf' },
    { valor: 'excel', etiqueta: 'Excel', icono: 'ph ph-file-xls' },
  ];

  async exportar(tipo: 'pdf' | 'excel') {
    const f = (d: string | null) => fechaSql(d);
    const filas = this.invoices;
    const vigentes = filas.filter(i => i.estado === 'timbrada');
    const cfg: ReportConfig = {
      titulo: 'Relación de facturas',
      subtitulo: this.filtroEstado ? `Estado: ${this.filtroEstado}` : 'Todas',
      columns: [
        { header: 'Serie-Folio', key: 'sf', width: 12 }, { header: 'Tipo', key: 'tipo', width: 8 },
        { header: 'Timbrado', key: 'timbrado', width: 16 }, { header: 'RFC receptor', key: 'receptor_rfc', width: 15 },
        { header: 'Razón social', key: 'receptor_razon_social', width: 30 }, { header: 'UUID', key: 'uuid', width: 38 },
        { header: 'Estado', key: 'estado', width: 12 }, { header: 'Total', key: 'total', money: true, width: 14 },
      ],
      rows: filas.map(i => ({ ...i, sf: [i.serie, i.folio].filter(Boolean).join('-') || `#${i.id}`, timbrado: f(i.fecha_timbrado || i.created_at) })),
      totals: { total: filas.reduce((s, i) => s + Number(i.total || 0), 0) },
      meta: [`${filas.length} facturas · timbradas ${vigentes.length} por ${vigentes.reduce((s, i) => s + Number(i.total || 0), 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}`],
      filename: 'facturas',
    };
    try {
      if (tipo === 'excel') await this.reportes.exportExcel(cfg);
      else await this.reportes.exportPdf(cfg);
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'No se pudo exportar', text: e?.message || 'Intenta de nuevo.' });
    }
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