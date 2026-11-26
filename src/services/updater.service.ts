import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import Swal from 'sweetalert2';

declare const window: any;

export interface UpdateStatus {
  type: string;
  message: string;
  version?: string;
  percent?: number;
}

@Injectable({
  providedIn: 'root'
})
export class UpdaterService {
  private updateStatus$ = new BehaviorSubject<UpdateStatus | null>(null);

  constructor() {
    this.initializeUpdateListener();
  }

  private initializeUpdateListener() {
    if (window.electronAPI?.onUpdateStatus) {
      window.electronAPI.onUpdateStatus((status: UpdateStatus) => {
        console.log('Update status:', status);
        this.updateStatus$.next(status);
        this.handleUpdateStatus(status);
      });
    } else {
      console.warn('electronAPI.onUpdateStatus no existe (preload no expuso electronAPI?)');
    }
  }

  private handleUpdateStatus(status: UpdateStatus) {
    switch (status.type) {
      case 'available':
        void this.showUpdateAvailableDialog(status);
        break;
      case 'downloaded':
        void this.showUpdateReadyDialog(status);
        break;
      case 'error':
        console.error('Error en actualización:', status.message);
        break;
    }
  }

  /* Con SweetAlert y no con `confirm()` del navegador: así sale con el estilo
     de Wybix y con Guide, como el resto de las alertas (wx-alerta). */
  private async showUpdateAvailableDialog(status: UpdateStatus) {
    const r = await Swal.fire({
      icon: 'info',
      title: `Nueva versión ${status.version}`,
      text: '¿La descargamos ahora? Puedes seguir trabajando mientras baja.',
      showCancelButton: true,
      confirmButtonText: 'Descargar',
      cancelButtonText: 'Más tarde',
    });
    if (r.isConfirmed && window.electronAPI?.downloadUpdate) {
      window.electronAPI.downloadUpdate();
    }
  }

  private async showUpdateReadyDialog(status: UpdateStatus) {
    const r = await Swal.fire({
      icon: 'question',
      title: `Actualización ${status.version} lista`,
      text: 'Para instalarla, Wybix se cierra y vuelve a abrir. ¿Lo hacemos ahora?',
      showCancelButton: true,
      confirmButtonText: 'Instalar y reiniciar',
      cancelButtonText: 'Más tarde',
    });
    if (r.isConfirmed && window.electronAPI?.installUpdate) {
      window.electronAPI.installUpdate();
    }
  }

  async checkForUpdates() {
    if (window.api?.checkForUpdates) {
      return await window.api.checkForUpdates();
    }
  }

  getUpdateStatus$() {
    return this.updateStatus$.asObservable();
  }
}