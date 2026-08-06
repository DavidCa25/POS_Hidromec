import { Component, OnInit } from '@angular/core';
import { NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';

// Panel de "Sincronización en la nube": activa/desactiva el envío de datos
// a Supabase (para la app del dueño), permite pegar la service key si falta
// y forzar un envío inmediato ("Sincronizar ahora") con su resultado.
@Component({
  selector: 'app-sync-nube',
  standalone: true,
  imports: [NgIf, FormsModule],
  templateUrl: './sync-nube.component.html',
  styleUrls: ['./sync-nube.component.css']
})
export class SyncNubePanelComponent implements OnInit {
  loading = true;
  saving = false;
  syncing = false;
  cfg: any = null;
  serviceKeyInput = '';
  negocioIdInput = '';
  sucursalIdInput = '';
  mostrarAvanzado = false;
  lastResult = '';
  lastOk: boolean | null = null;

  private get api() {
    return (window as any).electronAPI;
  }

  async ngOnInit() {
    await this.cargar();
  }

  async cargar() {
    this.loading = true;
    try {
      const r = await this.api?.cloudGetConfig?.();
      this.cfg = r?.data ?? null;
      this.negocioIdInput = this.cfg?.negocioId || '';
      this.sucursalIdInput = this.cfg?.sucursalId || '';
    } catch {
      this.cfg = null;
    } finally {
      this.loading = false;
    }
  }

  get activa(): boolean { return !!this.cfg?.enabled; }
  get tieneKey(): boolean { return !!this.cfg?.hasServiceKey; }
  get vinculada(): boolean { return !!this.cfg?.sucursalId; }
  get sucursalCorta(): string {
    const s = this.cfg?.sucursalId || '';
    return s ? s.slice(0, 8) + '…' : '—';
  }
  get minutos(): number { return Math.round((Number(this.cfg?.intervalMs) || 300000) / 60000); }

  async guardarVinculo() {
    const negocioId = this.negocioIdInput.trim();
    const sucursalId = this.sucursalIdInput.trim();
    if (!negocioId || !sucursalId) {
      await Swal.fire({ icon: 'warning', title: 'Faltan datos', text: 'Escribe el ID de negocio y el ID de sucursal.' });
      return;
    }
    this.saving = true;
    try {
      await this.api?.cloudSetConfig?.({ negocioId, sucursalId });
      await this.cargar();
      await Swal.fire({ icon: 'success', title: 'Sucursal actualizada', text: 'Ahora el POS enviará los datos a esa sucursal.', timer: 1600, showConfirmButton: false });
    } finally {
      this.saving = false;
    }
  }

  async toggle() {
    if (!this.activa && !this.tieneKey) {
      await Swal.fire({ icon: 'warning', title: 'Falta la clave de servicio', text: 'Pega la Service Role Key de Supabase antes de activar la sincronización.' });
      return;
    }
    this.saving = true;
    try {
      await this.api?.cloudSetConfig?.({ enabled: !this.activa });
      await this.cargar();
      if (this.activa) await this.sincronizarAhora();
    } finally {
      this.saving = false;
    }
  }

  async guardarKey() {
    const key = this.serviceKeyInput.trim();
    if (!key) return;
    this.saving = true;
    try {
      await this.api?.cloudSetConfig?.({ serviceKey: key });
      this.serviceKeyInput = '';
      await this.cargar();
      await Swal.fire({ icon: 'success', title: 'Clave guardada', timer: 1200, showConfirmButton: false });
    } finally {
      this.saving = false;
    }
  }

  async sincronizarAhora() {
    this.syncing = true;
    this.lastResult = '';
    this.lastOk = null;
    try {
      const r = await this.api?.cloudPushNow?.();
      this.lastOk = !!r?.success;
      if (r?.success) {
        this.lastResult = 'Sincronizado a las ' + new Date(r.at || Date.now()).toLocaleTimeString();
      } else if (r?.skipped) {
        this.lastResult = 'Sincronización desactivada.';
      } else {
        this.lastResult = r?.error || 'No se pudo sincronizar. Revisa tu conexión y la clave.';
      }
    } catch (e: any) {
      this.lastOk = false;
      this.lastResult = e?.message || 'Error inesperado.';
    } finally {
      this.syncing = false;
    }
  }
}
