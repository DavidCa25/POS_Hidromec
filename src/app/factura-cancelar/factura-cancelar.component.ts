import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { CatalogosService } from '../../services/catalogos.service';

interface MotivoCancelacion {
  code: string;
  label: string;
  requiereFolio: boolean;
}

@Component({
  selector: 'app-factura-cancelar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './factura-cancelar.component.html',
  styleUrls: ['./factura-cancelar.component.css']
})
export class FacturaCancelar {
  @Input() invoiceId!: number;                  // id local
  @Input() fiscalapiInvoiceId!: string;         // id en Fiscalapi
  @Input() uuid: string | null = null;
  @Output() cerrar = new EventEmitter<void>();
  @Output() cancelada = new EventEmitter<void>();

  motivos: MotivoCancelacion[] = [
    { code: '01', label: 'Comprobante emitido con errores con relacion', requiereFolio: true },
    { code: '02', label: 'Comprobante emitido con errores sin relacion', requiereFolio: false },
    { code: '03', label: 'No se llevo a cabo la operacion', requiereFolio: false }
  ];

  motivoSeleccionado: string | null = null;
  folioSustitucion = '';
  motivosAbierto = false;
  cancelando = false;

  constructor(private catalogos: CatalogosService) {}

  private get api() { return (window as any).electronAPI; }

  get motivoLabel(): string {
    const m = this.motivos.find(x => x.code === this.motivoSeleccionado);
    return m ? `${m.code} - ${m.label}` : 'Selecciona el motivo';
  }

  get requiereFolio(): boolean {
    const m = this.motivos.find(x => x.code === this.motivoSeleccionado);
    return !!m?.requiereFolio;
  }

  async confirmar() {
    if (!this.motivoSeleccionado) {
      await Swal.fire({ icon: 'warning', title: 'Falta el motivo', text: 'Selecciona el motivo de cancelacion.' });
      return;
    }
    if (this.requiereFolio && !this.folioSustitucion.trim()) {
      await Swal.fire({ icon: 'warning', title: 'Falta el folio', text: 'El motivo 01 requiere el folio fiscal que la sustituye.' });
      return;
    }

    const confirmar = await Swal.fire({
      icon: 'warning',
      title: 'Cancelar factura',
      html: `Esta accion cancela el CFDI ante el SAT y <b>no se puede deshacer</b>.<br><br>Folio fiscal:<br><small>${this.uuid || 'N/D'}</small>`,
      showCancelButton: true,
      confirmButtonText: 'Si, cancelar factura',
      cancelButtonText: 'No, regresar',
      confirmButtonColor: '#dc2626'
    });
    if (!confirmar.isConfirmed) return;

    this.cancelando = true;
    try {
      const endpoint = `${this.catalogos.supabaseUrl}/functions/v1/fiscal-cancel-invoice`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.catalogos.anonKey}`,
          'apikey': this.catalogos.anonKey
        },
        body: JSON.stringify({
          invoiceId: this.fiscalapiInvoiceId,
          motivo: this.motivoSeleccionado,
          folioSustitucion: this.folioSustitucion.trim() || null
        })
      });
      const out = await res.json();
      if (!out?.success) throw new Error(out?.error || 'No se pudo cancelar la factura.');

      // Registrar la cancelacion en el SQL local
      await this.api?.cancelInvoice?.({
        id: this.invoiceId,
        motivo_cancelacion: this.motivoSeleccionado,
        folio_sustitucion: this.folioSustitucion.trim() || null
      });

      await Swal.fire({ icon: 'success', title: 'Factura cancelada', text: 'El CFDI se cancelo ante el SAT.' });
      this.cancelada.emit();
      this.cerrar.emit();
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error al cancelar', text: e?.message || 'No se pudo cancelar.' });
    } finally {
      this.cancelando = false;
    }
  }

  cerrarModal() { this.cerrar.emit(); }
}