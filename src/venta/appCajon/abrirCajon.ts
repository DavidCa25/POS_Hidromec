import { Component, HostListener } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-cajon',
  templateUrl: './cajon.html',
  imports: [RouterOutlet, FormsModule],
  styleUrls: ['./cajon.css']
})
export class Cajon {
  loading = false;
  ultimaAccion: string | null = null;

  async abrirCajon() {
    const api = (window as any).electronAPI;

    if (!api || !api.openCashDrawer) {
      console.warn('openCashDrawer no disponible (¿ng serve?)');
      await Swal.fire({
        icon: 'info',
        title: 'Modo demo',
        text: 'No hay conexión con Electron. Solo es simulación visual.',
      });
      return;
    }

    try {
      this.loading = true;
      const resp = await api.openCashDrawer();

      if (resp?.success) {
        this.ultimaAccion = `Cajón abierto a las ${new Date().toLocaleTimeString()}`;
        await Swal.fire({
          icon: 'success',
          title: 'Cajón abierto',
          text: 'Se envió la señal de apertura al cajón.',
          timer: 1500,
          showConfirmButton: false,
          timerProgressBar: true
        });
      } else {
        await Swal.fire({
          icon: 'error',
          title: 'Error',
          text: resp?.error || 'No se pudo abrir el cajón.'
        });
      }
    } catch (e: any) {
      console.error('❌ Error abrirCajon:', e);
      await Swal.fire({
        icon: 'error',
        title: 'Error inesperado',
        text: e?.message || 'Ocurrió un error al intentar abrir el cajón.'
      });
    } finally {
      this.loading = false;
    }
  }
}
