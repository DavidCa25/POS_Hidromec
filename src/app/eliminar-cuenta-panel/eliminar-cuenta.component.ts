import { Component } from '@angular/core';
import { NgIf } from '@angular/common';
import Swal from 'sweetalert2';

// Panel "Eliminar cuenta y datos": borra la cuenta del dueño y los datos del
// negocio en la nube (cumple la política de Google Play). La info local del POS
// no se toca. Requiere confirmación escribiendo ELIMINAR.
@Component({
  selector: 'app-eliminar-cuenta',
  standalone: true,
  imports: [NgIf],
  templateUrl: './eliminar-cuenta.component.html',
  styleUrls: ['./eliminar-cuenta.component.css']
})
export class EliminarCuentaPanelComponent {
  borrando = false;

  private get api() {
    return (window as any).electronAPI;
  }

  async eliminar() {
    const c = await Swal.fire({
      icon: 'warning',
      title: 'Eliminar cuenta y datos',
      html: 'Esto borra <b>permanentemente</b> tu cuenta del dueño y los datos de tu negocio en la nube ' +
            '(ventas, cortes, alertas, riesgo y celulares vinculados). La información local de tu punto de venta ' +
            '<b>no</b> se borra.<br><br>Escribe <b>ELIMINAR</b> para confirmar.',
      input: 'text',
      inputPlaceholder: 'ELIMINAR',
      showCancelButton: true,
      confirmButtonText: 'Eliminar definitivamente',
      confirmButtonColor: '#dc2626',
      cancelButtonText: 'Cancelar',
      preConfirm: (v: string) => {
        if ((v || '').trim().toUpperCase() !== 'ELIMINAR') {
          Swal.showValidationMessage('Escribe ELIMINAR para confirmar');
        }
        return v;
      }
    });
    if (!c.isConfirmed) return;

    this.borrando = true;
    try {
      const r = await this.api?.cloudDeleteAccount?.();
      if (r?.success) {
        await Swal.fire({ icon: 'success', title: 'Cuenta eliminada', text: 'Tu cuenta y los datos en la nube se borraron.', confirmButtonColor: '#2E3A8C' });
      } else {
        await Swal.fire({ icon: 'error', title: 'No se pudo', text: r?.error || 'Intenta de nuevo.' });
      }
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'Error inesperado.' });
    } finally {
      this.borrando = false;
    }
  }
}
