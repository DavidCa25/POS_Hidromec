import { Component, EventEmitter, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { WxFlechasDirective } from '../../app/wx-flechas/wx-flechas.directive';
import { ShiftService } from '../../core';

/** De dónde viene el dinero. El texto es el que queda en el corte. */
export const CONCEPTOS_ENTRADA = [
  { valor: 'Cambio para la caja', icono: 'ph-coins', nota: 'Monedas o billetes chicos' },
  { valor: 'Dinero del dueño', icono: 'ph-user', nota: 'Aporte a la caja' },
  { valor: 'Préstamo', icono: 'ph-handshake', nota: 'Se devolverá después' },
  { valor: 'Otro', icono: 'ph-dots-three-outline', nota: 'Escribe el detalle' },
] as const;

/**
 * ENTRADA DE EFECTIVO A LA CAJA (0076).
 *
 * El espejo de la salida: dinero que entra al cajón sin ser venta ni abono
 * (el cambio que se trae del banco, dinero que pone el dueño, un préstamo).
 * Se guarda como DEPOSIT y el corte lo suma en «Otras entradas de efectivo»
 * y en el efectivo esperado.
 *
 * Un solo componente para Retail (F4) y Touch (botón «Entrada de efectivo»).
 * Quien lo muestra comprueba antes que haya turno; SQL lo vuelve a exigir.
 */
@Component({
  selector: 'app-entrada-efectivo',
  standalone: true,
  imports: [CommonModule, FormsModule, WxFlechasDirective],
  templateUrl: './entrada-efectivo.component.html',
  styleUrls: ['../salida-efectivo/salida-efectivo.component.css'],
  styles: ['.entrada-tipos { grid-template-columns: repeat(2, 1fr); }'],
})
export class EntradaEfectivo {
  @Output() cerrado = new EventEmitter<void>();
  private readonly shift = inject(ShiftService);

  readonly conceptos = CONCEPTOS_ENTRADA;
  concepto: string = CONCEPTOS_ENTRADA[0].valor;
  monto: number | null = null;
  nota = '';
  guardando = false;

  cerrar() { this.cerrado.emit(); }

  async confirmar() {
    if (this.guardando) return;
    const amount = Number(this.monto ?? 0);
    const nota = this.nota.trim();
    if (!(amount > 0)) {
      await Swal.fire({ icon: 'error', title: 'Monto inválido', text: 'El monto debe ser mayor a cero.' });
      return;
    }
    if (this.concepto === 'Otro' && !nota) {
      await Swal.fire({ icon: 'warning', title: 'Nota requerida', text: 'Escribe de dónde viene el dinero.' });
      return;
    }

    this.guardando = true;
    try {
      const resp = await this.shift.registerCashIn(amount, this.concepto, nota);
      if (resp?.success) {
        this.cerrado.emit();
        await Swal.fire({ icon: 'success', title: 'Entrada registrada', text: 'Entró al cajón y aparecerá en el corte como entrada de efectivo.' });
      } else {
        const sinApi = /API no disponible|no está disponible/.test(resp?.error || '');
        await Swal.fire({ icon: 'error', title: sinApi ? 'No disponible' : 'No se pudo registrar', text: resp?.error || 'No se pudo registrar la entrada.' });
      }
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error inesperado', text: e?.message || 'Ocurrió un error al registrar la entrada.' });
    } finally {
      this.guardando = false;
    }
  }
}
