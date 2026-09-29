import { Component, OnInit } from '@angular/core';
import { NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';

// Panel de "Sincronización en la nube": activa/desactiva el envío de datos
// a Supabase (para la app del dueño) y fuerza un envío inmediato
// ("Sincronizar ahora") con su resultado.
//
// Ya no pide la service key: cada caja se vincula con un token propio de su
// sucursal a través de la Edge Function pos-sync. Esa llave no debe estar en
// ninguna caja (ver docs/licensing.md, hallazgos de seguridad).
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
    this.saving = true;
    try {
      await this.api?.cloudSetConfig?.({ enabled: !this.activa });
      await this.cargar();
      if (this.activa) await this.sincronizarAhora();
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
        this.lastResult = r?.skipped === 'suscripcion'
          ? 'En pausa: la sincronización vuelve al renovar tu suscripción.'
          : (r?.error || 'No se pudo sincronizar. Revisa tu conexión.');
      }
    } catch (e: any) {
      this.lastOk = false;
      this.lastResult = e?.message || 'Error inesperado.';
    } finally {
      this.syncing = false;
    }
  }
}
