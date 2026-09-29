import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { LicenseService } from '../../services/license.service';

const COMPRA_URL = 'https://wybix-landing.vercel.app';
const LICENCIA_URL = 'https://wybix-landing.vercel.app/licencia';

@Component({
  selector: 'app-licencia-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrls: ['../panel-controls.css'],
  styles: [`
    .lic-status{display:flex;gap:12px;align-items:flex-start;border: 1px solid var(--wx-edge);border-radius:14px;padding:14px 16px;margin-bottom:18px;background: var(--wx-raised);}
    .lic-status .ic{width:42px;height:42px;border-radius:12px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-size:20px;}
    .lic-status.trial .ic{background: var(--wx-info-soft);color: var(--wx-accent-text);}
    .lic-status.active .ic{background: var(--wx-success-soft);color: var(--wx-success);}
    .lic-status.grace .ic{background: var(--wx-warning-soft);color: var(--wx-warning);}
    .lic-status.warn .ic{background: var(--wx-danger-soft);color: var(--wx-danger);}
    .lic-status b{display:block;font-size:14px;font-weight: 600;}
    .lic-status small{display:block;font-size:12px;color: var(--wx-text-muted);margin-top:2px;line-height:1.4;}
    .lic-key{letter-spacing:1px;text-transform:uppercase;font-family: var(--wx-font-mono);}
    .lic-datos{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:0 0 18px;font-size:13px;}
    .lic-datos dt{color: var(--wx-text-muted);}
    .lic-datos dd{margin:0;font-weight:550;}
    .lic-codigo{font-family: var(--wx-font-mono);font-size:12px;word-break:break-all;}
  `],
  template: `
  <div class="panel-content">
    <div class="section-title"><i class="ph-fill ph-key"></i> Licencia</div>

    <div class="lic-status" [ngClass]="claseEstado" data-guide="licencia-estado">
      <span class="ic"><i class="ph" [ngClass]="iconoEstado"></i></span>
      <div>
        <b>{{ tituloEstado }}</b>
        <small>{{ detalleEstado }}</small>
      </div>
    </div>

    <dl class="lic-datos" *ngIf="tieneCertificado">
      <dt>Plan</dt><dd>{{ license.planTexto }}</dd>
      <dt *ngIf="license.girosTexto">Giros</dt><dd *ngIf="license.girosTexto">{{ license.girosTexto }}</dd>
      <dt *ngIf="estado.paidUntil">Suscripción hasta</dt><dd *ngIf="estado.paidUntil">{{ estado.paidUntil | date:'longDate' }}</dd>
      <dt *ngIf="estado.validUntil && !license.enPrueba">Validar antes del</dt><dd *ngIf="estado.validUntil && !license.enPrueba">{{ estado.validUntil | date:'longDate' }}</dd>
    </dl>

    <ng-container *ngIf="!esActiva">
      <label class="lbl" for="lic-clave">Clave de licencia</label>
      <input id="lic-clave" class="ctl lic-key" [(ngModel)]="clave" placeholder="WYBIX-XXXX-XXXX-XXXX"
             maxlength="32" autocomplete="off" [disabled]="cargando">
      <small class="hint">La recibes por correo al comprar. Puedes activarla cuando quieras, sin esperar a que termine la prueba.</small>

      <div class="btn-row">
        <button class="btn-primary" type="button" (click)="activar()" [disabled]="cargando || !clave.trim()">
          <i class="ph ph-check-circle"></i> {{ cargando ? 'Activando...' : 'Activar licencia' }}
        </button>
        <button class="btn-outline" type="button" (click)="comprar()">
          <i class="ph ph-bag"></i> Comprar
        </button>
      </div>
    </ng-container>

    <div class="btn-row">
      <button class="btn-outline" type="button" (click)="refrescar()" [disabled]="cargando" *ngIf="tieneCertificado || esActiva">
        <i class="ph ph-arrows-clockwise"></i> Actualizar licencia
      </button>
      <button class="btn-outline" type="button" (click)="importar()" [disabled]="cargando">
        <i class="ph ph-file-arrow-down"></i> Importar archivo de licencia
      </button>
      <button class="btn-outline" type="button" (click)="liberar()" [disabled]="cargando" *ngIf="esActiva">
        <i class="ph ph-monitor"></i> Liberar esta computadora
      </button>
    </div>
    <small class="hint">
      ¿Esta computadora no tiene Internet? Descarga su licencia desde otro equipo en
      <b>{{ licenciaUrl }}</b> con tu clave y este código, y tráela en una memoria USB:
    </small>
    <p class="lic-codigo" *ngIf="estado.machineCode">{{ estado.machineCode }}</p>
    <small class="hint" *ngIf="esActiva">Usa «Liberar» solo si vas a mover tu licencia a otra computadora. Puedes hacerlo las veces que necesites.</small>
  </div>
  `
})
export class LicenciaPanelComponent implements OnInit {
  clave = '';
  cargando = false;
  readonly licenciaUrl = LICENCIA_URL.replace(/^https:\/\//, '');

  constructor(public license: LicenseService) {}

  async ngOnInit() { await this.license.cargarEstado(); }

  get estado() { return this.license.estado; }
  get esActiva(): boolean { return ['ACTIVE', 'GRACE', 'SALE_ONLY'].includes(this.license.modo); }
  get tieneCertificado(): boolean { return !!this.estado.entitlements && this.license.modo !== 'DEMO'; }
  /** Una licencia TEST/QA/INTERNAL lo dice: no se confunde con una comercial. */
  get esDePruebas(): boolean { return ['TEST', 'QA', 'INTERNAL'].includes(this.estado.origin ?? ''); }

  get claseEstado(): string {
    switch (this.license.modo) {
      case 'ACTIVE': case 'DEMO': return 'active';
      case 'TRIAL': return 'trial';
      case 'GRACE': return 'grace';
      default: return 'warn';
    }
  }
  get iconoEstado(): string {
    switch (this.license.modo) {
      case 'DEMO': return 'ph-fill ph-play-circle';
      case 'ACTIVE': return 'ph-fill ph-seal-check';
      case 'TRIAL': return 'ph-hourglass';
      case 'GRACE': return 'ph-fill ph-clock-countdown';
      case 'SALE_ONLY': return 'ph-fill ph-storefront';
      default: return 'ph-fill ph-warning';
    }
  }
  get tituloEstado(): string {
    switch (this.license.modo) {
      case 'DEMO': return 'Demostración';
      case 'ACTIVE': return 'Licencia activa';
      case 'TRIAL': return 'Prueba gratuita';
      case 'GRACE': return 'Tu suscripción venció';
      case 'SALE_ONLY': return 'Modo Venta Esencial';
      case 'EXPIRED': return 'Prueba terminada';
      case 'TAMPER': return 'Licencia con problema';
      default: return 'Sin licencia';
    }
  }
  get detalleEstado(): string {
    const s = this.estado;
    switch (this.license.modo) {
      case 'DEMO': return 'Esta copia es una demostración con datos de ejemplo. No necesita licencia.';
      case 'ACTIVE':
        return `Plan ${this.license.planTexto}${s.customerName ? ' · ' + s.customerName : ''}${this.esDePruebas ? ' · licencia de pruebas' : ''}`;
      case 'TRIAL': {
        const d = s.daysRemaining ?? 0;
        return `Te ${d === 1 ? 'queda 1 día' : 'quedan ' + d + ' días'}. Activa tu clave cuando la tengas.`;
      }
      case 'GRACE': {
        const d = s.daysRemaining ?? 0;
        return `Todo sigue funcionando: te ${d === 1 ? 'queda 1 día' : 'quedan ' + d + ' días'} de funcionamiento completo. Renueva para no perder ninguna función.`;
      }
      case 'SALE_ONLY':
        return s.motivo === 'SIN_VALIDAR'
          ? 'Tu licencia necesita validarse. Conéctate a Internet o importa tu archivo de licencia. Mientras, Wybix sigue vendiendo.'
          : 'Wybix sigue permitiendo ventas básicas. Renueva para recuperar Inventario, Compras, Servicios, Restaurante y las demás funciones de tu plan.';
      default: return 'Ingresa tu clave para activar el sistema.';
    }
  }

  async activar() {
    this.cargando = true;
    const res = await this.license.activarClave(this.clave);
    this.cargando = false;
    if (res.ok) {
      this.clave = '';
      await Swal.fire({ icon: 'success', title: 'Licencia activada', text: 'Gracias por tu compra.', timer: 1600, showConfirmButton: false });
    } else {
      await Swal.fire({ icon: 'error', title: 'No se pudo activar', text: res.error || 'Revisa la clave e intenta de nuevo.' });
    }
  }

  async refrescar() {
    this.cargando = true;
    await this.license.refrescar();
    this.cargando = false;
  }

  async importar() {
    this.cargando = true;
    const r = await this.license.importar();
    this.cargando = false;
    if (r.cancelado) return;
    if (r.ok) await Swal.fire({ icon: 'success', title: 'Licencia importada', text: this.tituloEstado, timer: 1800, showConfirmButton: false });
    else await Swal.fire({ icon: 'error', title: 'No se importó', text: r.error || 'El archivo no es válido.' });
  }

  async liberar() {
    const c = await Swal.fire({
      icon: 'warning', title: 'Liberar esta computadora',
      text: 'Esta computadora dejará de usar la licencia y podrás activarla en otra.',
      showCancelButton: true, confirmButtonText: 'Liberar', cancelButtonText: 'Cancelar'
    });
    if (!c.isConfirmed) return;
    this.cargando = true;
    const r = await this.license.liberar();
    this.cargando = false;
    if (r.ok) await Swal.fire({ icon: 'success', title: 'Computadora liberada', timer: 1400, showConfirmButton: false });
    else await Swal.fire({ icon: 'error', title: 'No se pudo liberar', text: r.error || 'Revisa tu conexión e intenta de nuevo.' });
  }

  comprar() {
    const api = (window as any).electronAPI;
    if (api?.openExternal) { api.openExternal(COMPRA_URL); return; }
    try { window.open(COMPRA_URL, '_blank'); } catch { /* noop */ }
  }
}
