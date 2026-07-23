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
        <i class="bi" [ngClass]="motivo === 'tamper' ? 'bi-shield-exclamation' : 'bi-clock-history'"></i>
      </div>
      <h1>{{ motivo === 'tamper' ? 'No pudimos validar tu licencia' : 'Tu prueba de 30 días terminó' }}</h1>
      <p class="lic-sub" *ngIf="motivo !== 'tamper'">Para seguir usando Wybix POS, activa tu licencia. Tus datos siguen guardados y seguros.</p>
      <p class="lic-sub" *ngIf="motivo === 'tamper'">Detectamos un problema con la licencia de este equipo. Conéctate a internet para revalidar, o activa tu clave. Tus datos siguen guardados y seguros.</p>

      <button class="lic-btn buy" (click)="comprar()">
        <i class="bi bi-bag-check"></i> Comprar licencia
      </button>

      <div class="lic-div"><span>o activa tu clave</span></div>

      <label class="lic-lbl">Clave de licencia</label>
      <input class="lic-in mono" [(ngModel)]="clave" placeholder="XXXX-XXXX-XXXX" [disabled]="cargando" style="text-transform:uppercase;">
      <button class="lic-btn" (click)="activar()" [disabled]="cargando">
        <i class="bi bi-key"></i> {{ cargando ? 'Validando...' : 'Activar licencia' }}
      </button>

      <p class="lic-help">¿Ya pagaste? Escríbenos por WhatsApp para recibir tu clave.</p>
    </div>
  </div>
  `,
  styles: [`
    .lic-wrap{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#0F2A3F,#16384f);padding:1.5rem;z-index:2000;}
    .lic-card{background:#fff;border-radius:24px;padding:2.5rem;width:100%;max-width:440px;box-shadow:0 30px 60px rgba(0,0,0,.35);text-align:center;}
    .lic-icon{width:64px;height:64px;border-radius:50%;background:#fef3c7;color:#d97706;display:flex;align-items:center;justify-content:center;font-size:1.8rem;margin:0 auto 1.2rem;}
    .lic-icon.warn{background:#fee2e2;color:#dc2626;}
    .lic-card h1{font-size:1.6rem;font-weight:800;color:#0f172a;margin:0 0 .5rem;}
    .lic-sub{color:#64748b;margin:0 0 1.5rem;}
    .lic-btn{width:100%;background:#fff;color:#0f172a;border:1px solid #e2e8f0;border-radius:12px;padding:.9rem;font-weight:700;font-size:1rem;cursor:pointer;margin-top:.6rem;}
    .lic-btn:hover{background:#f8fafc;}
    .lic-btn.buy{background:#2563EB;color:#fff;border-color:#2563EB;}
    .lic-btn.buy:hover{background:#1d4ed8;}
    .lic-btn:disabled{opacity:.6;cursor:default;}
    .lic-div{display:flex;align-items:center;gap:.8rem;color:#94a3b8;font-size:.85rem;margin:1.5rem 0 .5rem;}
    .lic-div::before,.lic-div::after{content:'';flex:1;height:1px;background:#e2e8f0;}
    .lic-lbl{display:block;text-align:left;font-size:.85rem;font-weight:600;color:#334155;margin:.8rem 0 .35rem;}
    .lic-in{width:100%;border:1px solid #e2e8f0;border-radius:12px;padding:.8rem 1rem;font-size:1rem;outline:none;box-sizing:border-box;}
    .lic-in:focus{border-color:#2563EB;}
    .lic-help{color:#94a3b8;font-size:.82rem;margin-top:1.2rem;}
    .mono{font-family:monospace;letter-spacing:1px;}
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
