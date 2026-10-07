import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';

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
  @Output() ocultarPadre = new EventEmitter<boolean>();

  motivos: MotivoCancelacion[] = [
    { code: '01', label: 'Comprobante emitido con errores con relacion', requiereFolio: true },
    { code: '02', label: 'Comprobante emitido con errores sin relacion', requiereFolio: false },
    { code: '03', label: 'No se llevo a cabo la operacion', requiereFolio: false }
  ];

  motivoSeleccionado: string | null = null;
  folioSustitucion = '';
  motivosAbierto = false;
  cancelando = false;

  // Oculta este modal (y el de detalle) mientras el SweetAlert esta arriba
  oculto = false;


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

    // Oculta los modales mientras el SweetAlert esta arriba
    this.oculto = true;
    this.ocultarPadre.emit(true);

    const confirmar = await Swal.fire({
      icon: 'warning',
      title: 'Cancelar factura',
      html: `Esta accion cancela el CFDI ante el SAT y <b>no se puede deshacer</b>.<br><br>Folio fiscal:<br><small>${this.uuid || 'N/D'}</small>`,
      showCancelButton: true,
      confirmButtonText: 'Si, cancelar factura',
      cancelButtonText: 'No, regresar',
      confirmButtonColor: '#dc2626'
    });

    // Si se arrepiente, restaura los modales
    if (!confirmar.isConfirmed) {
      this.oculto = false;
      this.ocultarPadre.emit(false);
      return;
    }

    const motivo = this.motivoSeleccionado;
    const folioSust = this.folioSustitucion.trim() || null;
    const invoiceIdLocal = this.invoiceId;
    const fiscalapiId = this.fiscalapiInvoiceId;

    Swal.fire({
      title: 'Cancelando ante el SAT',
      text: 'Espera un momento...',
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => Swal.showLoading()
    });

    try {
      // Fase 1: por el proceso principal, con la credencial del EQUIPO. La
      // llave anonima ya no basta: la nube decide empresa -> emisor -> factura.
      const out = await this.api?.fiscalCancelar?.({ invoiceId: fiscalapiId, motivo, folioSustitucion: folioSust });
      if (!out?.success) throw new Error(out?.error || 'No se pudo cancelar la factura.');

      await this.api?.cancelInvoice?.({
        id: invoiceIdLocal,
        motivo_cancelacion: motivo,
        folio_sustitucion: folioSust
      });

      Swal.close();

      this.cancelada.emit();
      this.cerrar.emit();

      await Swal.fire({ icon: 'success', title: 'Factura cancelada', text: 'El CFDI se cancelo ante el SAT.' });
    } catch (e: any) {
      Swal.close();
      await Swal.fire({ icon: 'error', title: 'Error al cancelar', text: e?.message || 'No se pudo cancelar.' });
      this.oculto = false;
      this.ocultarPadre.emit(false);
    }
  }

  cerrarModal() { this.cerrar.emit(); }
}