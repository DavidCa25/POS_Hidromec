import { Component, OnInit, NgZone } from '@angular/core';
import { NgIf, NgClass, DecimalPipe } from '@angular/common';
import Swal from 'sweetalert2';

export interface UpdateInfo {
  type: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  message?: string;
  version?: string;
  percent?: number;
  error?: string;
}

export interface ElectronUpdateAPI {
  checkForUpdates: () => Promise<{ success: boolean; error?: string }>;
  downloadUpdate: () => Promise<{ success: boolean; error?: string }>;
  installUpdate: () => void;
  onUpdateStatus: (callback: (info: UpdateInfo) => void) => void;
}

@Component({
  selector: 'app-actualizaciones-panel',
  standalone: true,
  imports: [NgIf, NgClass, DecimalPipe],
  templateUrl: './actualizaciones-panel.component.html',
  styleUrls: ['./actualizaciones-panel.component.css']
})
export class ActualizacionesPanelComponent implements OnInit {
  status: UpdateInfo['type'] = 'idle';
  message: string = 'Haz clic en buscar para comprobar si hay nuevas versiones.';
  version: string = '';
  progress: number = 0;
  
  loading: boolean = false;

  private get api(): ElectronUpdateAPI {
    return (window as unknown as { electronAPI: ElectronUpdateAPI }).electronAPI;
  }

  constructor(private zone: NgZone) {}

  ngOnInit(): void {
    if (this.api?.onUpdateStatus) {
      this.api.onUpdateStatus((info: UpdateInfo) => {
        this.zone.run(() => {
          this.status = info.type;
          this.message = info.message || '';
          
          if (info.version) this.version = info.version;
          if (info.percent !== undefined) this.progress = info.percent;
          
          this.loading = ['checking', 'downloading'].includes(this.status);
        });
      });
    }
  }

  async buscarActualizaciones(): Promise<void> {
    if (!this.api?.checkForUpdates) {
      await Swal.fire('No disponible', 'El actualizador no está configurado en este entorno.', 'info');
      return;
    }

    this.loading = true;
    this.status = 'checking';
    this.message = 'Buscando actualizaciones...';

    try {
      const res = await this.api.checkForUpdates();
      if (!res?.success && res?.error) {
        this.status = 'error';
        this.message = res.error;
        this.loading = false;
      }
    } catch (error: unknown) {
      this.status = 'error';
      this.message = error instanceof Error ? error.message : 'Error desconocido';
      this.loading = false;
    }
  }

  async descargarActualizacion(): Promise<void> {
    this.status = 'downloading';
    this.progress = 0;
    
    try {
      await this.api.downloadUpdate();
    } catch (error: unknown) {
      this.status = 'error';
      this.message = error instanceof Error ? error.message : 'Error en la descarga';
    }
  }

  instalarActualizacion(): void {
    this.api.installUpdate();
  }
}