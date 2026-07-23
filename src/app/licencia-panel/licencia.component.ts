import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { LicenseService } from '../../services/license.service';

const COMPRA_URL = 'https://wybix-landing.vercel.app';

@Component({
  selector: 'app-licencia-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrls: ['../panel-controls.css'],
  styles: [`
    .lic-status{display:flex;gap:12px;align-items:flex-start;border:1px solid #e2e8f0;border-radius:14px;padding:14px 16px;margin-bottom:18px;background:#f8fafc;}
    .lic-status .ic{width:42px;height:42px;border-radius:12px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-size:20px;}
    .lic-status.trial .ic{background:rgba(37,99,235,.12);color:#2563eb;}
    .lic-status.active .ic{background:rgba(16,185,129,.12);color:#10b981;}
    .lic-status.warn .ic{background:rgba(239,68,68,.12);color:#ef4444;}
    .lic-status b{display:block;font-size:14px;font-weight:800;}
    .lic-status small{display:block;font-size:12px;color:#64748b;margin-top:2px;line-height:1.4;}
    .lic-key{letter-spacing:2px;text-transform:uppercase;font-family:ui-monospace,monospace;}
  `],
  template: `
  <div class="panel-content">
    <div class="section-title"><i class="bi bi-key-fill"></i> Licencia</div>

    <div class="lic-status" [ngClass]="claseEstado">
      <span class="ic"><i class="bi" [ngClass]="iconoEstado"></i></span>
      <div>
        <b>{{ tituloEstado }}</b>
        <small>{{ detalleEstado }}</small>
      </div>
    </div>

    <ng-container *ngIf="!esActiva">
      <label class="lbl">Clave de licencia</label>
      <input class="ctl lic-key" [ngModel]="clave" (ngModelChange)="onClaveInput($event)"
             placeholder="XXXX-XX-XXXX-XXXX" maxlength="17" [disabled]="cargando">
      <small class="hint">La recibes por correo o WhatsApp al comprar. Puedes activarla cuando quieras, sin esperar a que termine la prueba.</small>

      <div class="btn-row">
        <button class="btn-primary" type="button" (click)="activar()" [disabled]="cargando || !clave">
          <i class="bi bi-check2-circle"></i> {{ cargando ? 'Activando...' : 'Activar licencia' }}
        </button>
        <button class="btn-outline" type="button" (click)="comprar()">
          <i class="bi bi-bag-check"></i> Comprar
        </button>
      </div>
    </ng-container>

    <ng-container *ngIf="esActiva">
      <div class="btn-row">
        <button class="btn-outline" type="button" (click)="liberar()" [disabled]="cargando">
          <i class="bi bi-pc-display-horizontal"></i> Liberar esta computadora
        </button>
      </div>
      <small class="hint">Usa "Liberar" solo si vas a mover tu licencia a otra computadora.</small>
    </ng-container>
  </div>
  `
})
export class LicenciaPanelComponent implements OnInit {
  clave = '';
  cargando = false;

  constructor(public license: LicenseService) {}

  async ngOnInit() { await this.license.cargarEstado(); }

  get estado() { return this.license.estado; }
  get esActiva(): boolean { return this.estado.state === 'active'; }

  get claseEstado(): string {
    switch (this.estado.state) {
      case 'active': return 'active';
      case 'trial':  return 'trial';
      default:       return 'warn';
    }
  }
  get iconoEstado(): string {
    switch (this.estado.state) {
      case 'active': return 'bi-patch-check-fill';
      case 'trial':  return 'bi-hourglass-split';
      default:       return 'bi-exclamation-triangle-fill';
    }
  }
  get tituloEstado(): string {
    switch (this.estado.state) {
      case 'active':  return 'Licencia activa';
      case 'trial':   return 'Prueba gratis';
      case 'expired': return 'Prueba terminada';
      case 'tamper':  return 'Licencia con problema';
      default:        return 'Sin licencia';
    }
  }
  get detalleEstado(): string {
    const s = this.estado;
    if (s.state === 'active') {
      const plan = s.plan === 'multi' ? 'MultiCaja' : 'MonoCaja';
      return `Plan ${plan}${s.customerName ? ' · ' + s.customerName : ''}`;
    }
    if (s.state === 'trial') {
      const d = s.daysRemaining ?? 0;
      return `Te ${d === 1 ? 'queda 1 día' : 'quedan ' + d + ' días'}. Activa tu clave cuando la tengas.`;
    }
    return 'Ingresa tu clave para activar el sistema.';
  }

  onClaveInput(v: string) {
    const limpio = (v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const p: string[] = [];
    if (limpio.length > 0)  p.push(limpio.slice(0, 4));
    if (limpio.length > 4)  p.push(limpio.slice(4, 6));
    if (limpio.length > 6)  p.push(limpio.slice(6, 10));
    if (limpio.length > 10) p.push(limpio.slice(10, 14));
    this.clave = p.join('-');
  }

  async activar() {
    this.cargando = true;
    const res = await this.license.activarClave(this.clave);
    this.cargando = false;
    if (res.ok) {
      await this.license.cargarEstado();
      this.clave = '';
      await Swal.fire({ icon: 'success', title: 'Licencia activada', text: 'Gracias por tu compra.', timer: 1600, showConfirmButton: false });
    } else {
      await Swal.fire({ icon: 'error', title: 'No se pudo activar', text: res.error || 'Revisa la clave e intenta de nuevo.' });
    }
  }

  async liberar() {
    const c = await Swal.fire({
      icon: 'warning', title: 'Liberar esta computadora',
      text: 'Esta máquina dejará de usar la licencia y podrás activarla en otra.',
      showCancelButton: true, confirmButtonText: 'Liberar', cancelButtonText: 'Cancelar'
    });
    if (!c.isConfirmed) return;
    this.cargando = true;
    const ok = await this.license.liberar();
    this.cargando = false;
    if (ok) {
      await this.license.cargarEstado();
      await Swal.fire({ icon: 'success', title: 'Computadora liberada', timer: 1400, showConfirmButton: false });
    } else {
      await Swal.fire({ icon: 'error', title: 'No se pudo liberar', text: 'Revisa tu conexión e intenta de nuevo.' });
    }
  }

  comprar() {
    const api = (window as any).electronAPI;
    if (api?.openExternal) { api.openExternal(COMPRA_URL); return; }
    try { window.open(COMPRA_URL, '_blank'); } catch { /* noop */ }
  }
}
