import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { ModulesService } from '../../services/modules.service';

@Component({
  selector: 'app-servicios-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrls: ['../panel-controls.css'],
  styles: [`
    .sv-status{display:flex;gap:12px;align-items:center;border:1px solid rgba(148,163,184,.25);border-radius:14px;padding:14px 16px;margin-bottom:18px;}
    .sv-status .ic{width:42px;height:42px;border-radius:12px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-size:20px;}
    .sv-status.on .ic{background:rgba(16,185,129,.14);color:#10b981;}
    .sv-status.off .ic{background:rgba(148,163,184,.16);color:#64748b;}
    .sv-status b{display:block;font-size:14px;font-weight:800;}
    .sv-status small{display:block;font-size:12px;color:#64748b;margin-top:2px;}
    .sv-note{display:flex;gap:8px;background:rgba(59,130,246,.10);border:1px solid rgba(59,130,246,.22);border-radius:11px;padding:10px 12px;font-size:12px;margin-top:12px;line-height:1.45;}
  `],
  template: `
  <div class="panel-content">
    <div class="section-title"><i class="bi bi-phone"></i> Pago de servicios y recargas</div>
    <p class="hint" style="margin-bottom:1rem;">Vincula tu cuenta con un proveedor para ofrecer recargas de tiempo aire y pago de servicios (luz, agua, gas...) desde el punto de venta.</p>

    <div class="sv-status" [ngClass]="enabled ? 'on' : 'off'">
      <span class="ic"><i class="bi" [ngClass]="enabled ? 'bi-check-circle-fill' : 'bi-plug'"></i></span>
      <div>
        <b>{{ enabled ? 'Conectado' : 'Sin conectar' }}</b>
        <small>{{ enabled ? ('Proveedor: ' + providerLabel) : 'Elige un proveedor y captura tus credenciales.' }}</small>
      </div>
    </div>

    <ng-container *ngIf="!enabled">
      <label class="lbl">Proveedor</label>
      <select class="ctl" [(ngModel)]="provider">
        <option value="taecel">TAECEL</option>
      </select>

      <label class="lbl" style="margin-top:1rem;">Key</label>
      <input class="ctl" [(ngModel)]="key" placeholder="Key de TAECEL" [disabled]="busy">

      <label class="lbl" style="margin-top:.8rem;">NIP</label>
      <input class="ctl" type="password" [(ngModel)]="nip" placeholder="NIP de TAECEL" [disabled]="busy">

      <div class="sv-note">
        <i class="bi bi-info-circle"></i>
        <span>Obtén tu <b>Key</b> y <b>NIP</b> al darte de alta en TAECEL. Necesitas saldo en tu cuenta para poder operar.</span>
      </div>

      <div class="btn-row" style="margin-top:1.2rem;">
        <button class="btn-primary" type="button" (click)="conectar()" [disabled]="busy || !key || !nip">
          <i class="bi bi-link-45deg"></i> {{ busy ? 'Validando...' : 'Conectar' }}
        </button>
      </div>
    </ng-container>

    <ng-container *ngIf="enabled">
      <p class="hint">El módulo <b>Pago de servicios</b> ya aparece en el menú lateral. Si lo desconectas, desaparecerá hasta que vuelvas a configurarlo.</p>
      <div class="btn-row" style="margin-top:1rem;">
        <button class="btn-outline" type="button" (click)="desconectar()" [disabled]="busy">
          <i class="bi bi-plug"></i> Desconectar
        </button>
      </div>
    </ng-container>
  </div>
  `
})
export class ServiciosPanelComponent implements OnInit {
  private get api() { return (window as any).electronAPI; }

  provider = 'taecel';
  key = '';
  nip = '';
  enabled = false;
  busy = false;

  constructor(private modules: ModulesService) {}

  get providerLabel(): string { return this.provider === 'taecel' ? 'TAECEL' : this.provider; }

  async ngOnInit() {
    try {
      const cfg = await this.api?.servicesGetConfig?.();
      const d = cfg?.data;
      this.enabled = !!(d?.enabled && d?.provider);
      if (d?.provider) this.provider = d.provider;
    } catch { /* usa default */ }
  }

  async conectar() {
    this.busy = true;
    try {
      const val = await this.api?.servicesValidate?.({
        provider: this.provider,
        credentials: { key: this.key.trim(), nip: this.nip.trim() }
      });
      if (!val?.ok) {
        await Swal.fire({ icon: 'error', title: 'No se pudo conectar', text: val?.error || 'Revisa tus credenciales.' });
        return;
      }
      await this.api?.servicesSetConfig?.({
        provider: this.provider, enabled: true,
        credentials: { key: this.key.trim(), nip: this.nip.trim() }
      });
      this.enabled = true; this.key = ''; this.nip = '';
      await this.modules.refresh();
      const extra = val?.pendingApi ? ' (falta conectar la API de TAECEL para operar)' : '';
      await Swal.fire({ icon: 'success', title: 'Módulo activado', text: 'Pago de servicios ya aparece en el menú.' + extra, timer: 2000, showConfirmButton: false });
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'No se pudo conectar.' });
    } finally {
      this.busy = false;
    }
  }

  async desconectar() {
    const c = await Swal.fire({
      icon: 'warning', title: 'Desconectar módulo',
      text: 'El módulo de pago de servicios desaparecerá del menú.',
      showCancelButton: true, confirmButtonText: 'Desconectar', cancelButtonText: 'Cancelar'
    });
    if (!c.isConfirmed) return;
    this.busy = true;
    try {
      await this.api?.servicesClear?.();
      this.enabled = false;
      await this.modules.refresh();
      await Swal.fire({ icon: 'success', title: 'Desconectado', timer: 1200, showConfirmButton: false });
    } finally {
      this.busy = false;
    }
  }
}
