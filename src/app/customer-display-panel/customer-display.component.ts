import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';

interface Monitor { id: number; label: string; primary: boolean; }

@Component({
  selector: 'app-customer-display-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrls: ['../panel-controls.css'],
  styles: [`
    .cd-row{display:flex;justify-content:space-between;align-items:center;gap:1rem;padding:.9rem 0;border-bottom:1px solid rgba(148,163,184,.2);}
    .cd-row .info{font-weight:600;}
    .cd-row .info small{display:block;font-weight:400;color:#64748b;font-size:.8rem;margin-top:2px;}
    .cd-status{font-size:.8rem;font-weight:700;padding:.25rem .7rem;border-radius:999px;white-space:nowrap;}
    .cd-status.on{background:rgba(16,185,129,.14);color:#059669;}
    .cd-status.off{background:rgba(148,163,184,.18);color:#64748b;}
  `],
  template: `
  <div class="panel-content">
    <div class="section-title"><i class="bi bi-display"></i> Pantalla de cliente</div>
    <p class="hint" style="margin-bottom:1rem;">Muestra la venta en tiempo real en un segundo monitor, de cara al cliente.</p>

    <div class="cd-row">
      <div class="info">Activar pantalla de cliente
        <small>Se abre sola cada vez que inicias el punto de venta.</small>
      </div>
      <label class="sw">
        <input type="checkbox" [checked]="enabled" (change)="toggle()">
        <span class="sl"></span>
      </label>
    </div>

    <div *ngIf="enabled" style="margin-top:1.2rem;">
      <label class="lbl">Monitor</label>
      <select class="ctl" [(ngModel)]="displayId" (ngModelChange)="onMonitorChange()">
        <option [ngValue]="null">Automático (segundo monitor)</option>
        <option *ngFor="let m of monitors" [ngValue]="m.id">{{ m.label }}{{ m.primary ? ' — principal' : '' }}</option>
      </select>
      <small class="hint">Si solo tienes un monitor, la pantalla se abre encima; conecta un segundo monitor para el cliente.</small>

      <div class="btn-row" style="margin-top:1.2rem; align-items:center; gap:12px;">
        <button class="btn-primary" type="button" (click)="abrir()"><i class="bi bi-box-arrow-up-right"></i> Abrir ahora</button>
        <button class="btn-outline" type="button" (click)="cerrar()"><i class="bi bi-x-circle"></i> Cerrar</button>
        <span class="cd-status" [class.on]="isOpen" [class.off]="!isOpen">{{ isOpen ? 'Abierta' : 'Cerrada' }}</span>
      </div>
    </div>
  </div>
  `
})
export class CustomerDisplayPanelComponent implements OnInit {
  private get api() { return (window as any).electronAPI; }

  enabled = false;
  displayId: number | null = null;
  monitors: Monitor[] = [];
  isOpen = false;

  async ngOnInit() {
    try {
      const cfg = await this.api?.getDeviceConfig?.();
      const cd = cfg?.data?.customerDisplay || {};
      this.enabled = !!cd.enabled;
      this.displayId = cd.displayId ?? null;
    } catch { /* usa default */ }
    await this.cargarMonitores();
    await this.refrescarEstado();
    this.api?.onCustomerDisplayDisconnected?.(() => {
      this.isOpen = false;
      Swal.fire({ icon: 'warning', title: 'Monitor desconectado', text: 'Se perdió la pantalla de cliente. Reconéctala y vuelve a abrirla.' });
    });
  }

  async cargarMonitores() {
    try { this.monitors = (await this.api?.customerDisplayListMonitors?.()) || []; }
    catch { this.monitors = []; }
  }

  async refrescarEstado() {
    try { const s = await this.api?.customerDisplayStatus?.(); this.isOpen = !!s?.open; }
    catch { /* noop */ }
  }

  private async guardar() {
    await this.api?.setDeviceConfig?.({ customerDisplay: { enabled: this.enabled, displayId: this.displayId } });
  }

  async toggle() {
    this.enabled = !this.enabled;
    await this.guardar();
    if (this.enabled) { await this.cargarMonitores(); await this.abrir(); }
    else { await this.cerrar(); }
  }

  async onMonitorChange() {
    await this.guardar();
    if (this.isOpen) await this.abrir(); // reabre en el monitor elegido
  }

  async abrir() {
    const r = await this.api?.customerDisplayOpen?.(this.displayId ?? null);
    if (r && r.ok === false) { await Swal.fire({ icon: 'error', title: 'No se pudo abrir', text: r?.error || 'Error.' }); }
    await this.refrescarEstado();
  }

  async cerrar() {
    await this.api?.customerDisplayClose?.();
    await this.refrescarEstado();
  }
}
