import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { LicenseService } from '../../services/license.service';

const COMPRA_URL = 'https://wybix-landing.vercel.app';

@Component({
  selector: 'app-licencia-vencida',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
  <div class="lic-wrap">
    <div class="lic-card">
      <div class="lic-icon" [class.warn]="motivo === 'tamper'">
        <i class="ph" [ngClass]="motivo === 'tamper' ? 'ph-shield-warning' : 'ph-clock-counter-clockwise'"></i>
      </div>
      <h1>{{ motivo === 'tamper' ? 'No pudimos validar tu licencia' : 'Tu prueba de 30 días terminó' }}</h1>
      <p class="lic-sub" *ngIf="motivo !== 'tamper'">Para seguir usando Wybix POS, activa tu licencia. Tus datos siguen guardados y seguros.</p>
      <p class="lic-sub" *ngIf="motivo === 'tamper'">Detectamos un problema con la licencia de este equipo. Conéctate a internet para revalidar, o activa tu clave. Tus datos siguen guardados y seguros.</p>

      <button class="lic-btn buy" (click)="comprar()">
        <i class="ph ph-bag"></i> Comprar licencia
      </button>

      <div class="lic-div"><span>o activa tu clave</span></div>

      <label class="lic-lbl">Clave de licencia</label>
      <input class="lic-in mono" [(ngModel)]="clave" placeholder="XXXX-XXXX-XXXX" [disabled]="cargando" style="text-transform:uppercase;">
      <button class="lic-btn" (click)="activar()" [disabled]="cargando">
        <i class="ph ph-key"></i> {{ cargando ? 'Validando...' : 'Activar licencia' }}
      </button>

      <p class="lic-help">¿Ya pagaste? Escríbenos por WhatsApp para recibir tu clave.</p>
    </div>
  </div>
  `,
  styles: [`
    .lic-wrap{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#0F2A3F,#16384f);padding:1.5rem;z-index:2000;}
    .lic-card{background: var(--wx-surface);border-radius:24px;padding:2.5rem;width:100%;max-width:440px;box-shadow: var(--wx-shadow-raised);text-align:center;}
    .lic-icon{width:64px;height:64px;border-radius:50%;background: var(--wx-warning-soft);color: var(--wx-warning);display:flex;align-items:center;justify-content:center;font-size:1.8rem;margin:0 auto 1.2rem;}
    .lic-icon.warn{background: var(--wx-danger-soft);color: var(--wx-danger);}
    .lic-card h1{font-size:1.6rem;font-weight: 600;color: var(--wx-text);margin:0 0 .5rem;}
    .lic-sub{color: var(--wx-text-muted);margin:0 0 1.5rem;}
    .lic-btn{width:100%;background: var(--wx-surface);color: var(--wx-text);border: 1px solid var(--wx-edge);border-radius:12px;padding:.9rem;font-weight: 600;font-size:1rem;cursor:pointer;margin-top:.6rem;}
    .lic-btn:hover{background: var(--wx-raised);}
    .lic-btn.buy{background: #2563EB;color: #fff;border-color: var(--wx-accent);}
    .lic-btn.buy:hover{background: #1d4ed8;}
    .lic-btn:disabled{opacity:.6;cursor:default;}
    .lic-div{display:flex;align-items:center;gap:.8rem;color: var(--wx-text-dim);font-size:.85rem;margin:1.5rem 0 .5rem;}
    .lic-div::before,.lic-div::after{content:'';flex:1;height:1px;background: var(--wx-edge);}
    .lic-lbl{display:block;text-align:left;font-size:.85rem;font-weight:600;color: var(--wx-text-muted);margin:.8rem 0 .35rem;}
    .lic-in{width:100%;border: 1px solid var(--wx-edge);border-radius:12px;padding:.8rem 1rem;font-size:1rem;outline:none;box-sizing:border-box;}
    .lic-in:focus{border-color: var(--wx-accent);}
    .lic-help{color: var(--wx-text-dim);font-size:.82rem;margin-top:1.2rem;}
    .mono{font-family: var(--wx-font-mono);letter-spacing:1px;}
  `]
})
export class LicenciaVencidaComponent {
  @Input() motivo: 'vencida' | 'tamper' = 'vencida';
  @Output() activado = new EventEmitter<void>();
  clave = '';
  cargando = false;

  constructor(private license: LicenseService) {}

  comprar() {
    const api = (window as any).electronAPI;
    if (api?.openExternal) { api.openExternal(COMPRA_URL); return; }
    try { window.open(COMPRA_URL, '_blank'); } catch { /* noop */ }
  }

  async activar() {
    this.cargando = true;
    const res = await this.license.activarClave(this.clave);
    this.cargando = false;
    if (res.ok) {
      await Swal.fire({ icon: 'success', title: 'Licencia activada', text: 'Bienvenido de vuelta.', timer: 1500, showConfirmButton: false });
      this.activado.emit();
    } else {
      await Swal.fire({ icon: 'error', title: 'Clave inválida', text: res.error });
    }
  }
}
