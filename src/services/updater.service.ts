import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

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
    if (window.api?.onUpdateStatus) {
      window.api.onUpdateStatus((status: UpdateStatus) => {
        console.log('📦 Update status:', status);
        this.updateStatus$.next(status);
        
        this.handleUpdateStatus(status);
      });
    }
  }

  private handleUpdateStatus(status: UpdateStatus) {
    switch (status.type) {
      case 'available':
        this.showUpdateAvailableDialog(status);
        break;
      case 'downloaded':
        this.showUpdateReadyDialog(status);
        break;
      case 'error':
        console.error('Error en actualización:', status.message);
        break;
    }
  }

  private showUpdateAvailableDialog(status: UpdateStatus) {
    const result = confirm(
      `Nueva versión ${status.version} disponible.\n¿Descargar ahora?`
    );
    
    if (result && window.api?.downloadUpdate) {
      window.api.downloadUpdate();
    }
  }

  private showUpdateReadyDialog(status: UpdateStatus) {
    const result = confirm(
      `Actualización ${status.version} descargada.\n¿Instalar y reiniciar ahora?`
    );
    
    if (result && window.api?.installUpdate) {
      window.api.installUpdate();
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