import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import Swal from 'sweetalert2';
import { CatalogosService } from '../../services/catalogos.service';
import { FacturaCancelar } from '../factura-cancelar/factura-cancelar.component';

interface InvoiceDetail {
  id: number;
  uuid: string | null;
  serie: string | null;
  folio: string | null;
  fiscalapi_invoice_id: string | null;
  xml_content: string | null;
  receptor_razon_social: string | null;
  estado: string;
}

@Component({
  selector: 'app-factura-detalle',
  standalone: true,
  imports: [CommonModule, FacturaCancelar],
  templateUrl: './factura-detalle.component.html',
  styleUrls: ['./factura-detalle.component.css']
})
export class FacturaDetalle implements OnInit {
  @Input() invoiceId!: number;
  @Output() cerrar = new EventEmitter<void>();
  @Output() actualizada = new EventEmitter<void>();

  data: InvoiceDetail | null = null;
  cargando = true;
  descargando = false;
  showCancelarModal = false;

  // Se oculta mientras un SweetAlert del hijo esta arriba
  oculto = false;

  onOcultarDetalle(v: boolean) {
    this.oculto = v;
  }

  constructor(private catalogos: CatalogosService) {}

  private get api() { return (window as any).electronAPI; }

  async ngOnInit() {
    await this.cargar();
  }

  private async cargar() {
    this.cargando = true;
    try {
      const res = await this.api?.getInvoiceFilesData?.(this.invoiceId);
      if (res?.success) this.data = res.data;
    } catch { /* noop */ }
    this.cargando = false;
  }

  get puedeCancelar(): boolean {
    return this.data?.estado === 'timbrada' && !!this.data?.fiscalapi_invoice_id;
  }

  // Descarga un base64 como archivo
  private descargarBase64(base64: string, filename: string, mime: string) {
    const link = document.createElement('a');
    link.href = `data:${mime};base64,${base64}`;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  descargarXmlLocal() {
    if (!this.data?.xml_content) {
      Swal.fire({ icon: 'info', title: 'Sin XML', text: 'Esta factura no tiene XML guardado localmente.' });
      return;
    }
    const nombre = `${this.data.uuid || 'factura'}.xml`;
    const b64 = btoa(unescape(encodeURIComponent(this.data.xml_content)));
    this.descargarBase64(b64, nombre, 'application/xml');
  }

  async descargarArchivos() {
    if (!this.data?.fiscalapi_invoice_id) {
      Swal.fire({ icon: 'info', title: 'Sin referencia', text: 'Esta factura no tiene id del timbrador.' });
      return;
    }
    this.descargando = true;
    try {
      const endpoint = `${this.catalogos.supabaseUrl}/functions/v1/fiscal-invoice-files`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.catalogos.anonKey}`,
          'apikey': this.catalogos.anonKey
        },
        body: JSON.stringify({ invoiceId: this.data.fiscalapi_invoice_id })
      });
      const out = await res.json();
      if (!out?.success) throw new Error(out?.error || 'No se pudieron obtener los archivos.');

      const base = this.data.uuid || 'factura';
      if (out.pdfBase64) this.descargarBase64(out.pdfBase64, `${base}.pdf`, 'application/pdf');
      if (out.xmlBase64) this.descargarBase64(out.xmlBase64, `${base}.xml`, 'application/xml');

      if (!out.pdfBase64 && out.xmlBase64) {
        Swal.fire({ icon: 'info', title: 'Solo XML', text: 'Se descargo el XML. El PDF no estuvo disponible.' });
      }
    } catch (e: any) {
      Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'No se pudieron descargar los archivos.' });
    } finally {
      this.descargando = false;
    }
  }

  abrirCancelar() {
    if (!this.puedeCancelar) return;
    this.showCancelarModal = true;
  }

  onCancelarCerrado() {
    this.showCancelarModal = false;
  }

  async onFacturaCancelada() {
    this.showCancelarModal = false;
    this.actualizada.emit();     
    this.cerrar.emit();           
  }

  cerrarModal() { this.cerrar.emit(); }
}