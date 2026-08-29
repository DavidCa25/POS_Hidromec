import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { LicenseService } from '../../services/license.service';

@Component({
  selector: 'app-iniciar-prueba',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
  <div class="lic-wrap">
    <div class="lic-card">
      <div class="lic-brand">Wybix <span>POS</span></div>

      <ng-container *ngIf="modo === 'prueba'">
        <h1>Comienza tu prueba gratis</h1>
        <p class="lic-sub">30 días con todas las funciones. Sin tarjeta.</p>

        <label class="lic-lbl">Nombre del negocio</label>
        <input class="lic-in" [(ngModel)]="businessName" placeholder="Mi Tienda" [disabled]="cargando">

        <label class="lic-lbl">Correo (opcional)</label>
        <input class="lic-in" [(ngModel)]="email" placeholder="tucorreo@ejemplo.com" [disabled]="cargando">

        <button class="lic-btn" (click)="iniciar()" [disabled]="cargando">
          <i class="ph ph-rocket-launch"></i> {{ cargando ? 'Activando...' : 'Comenzar prueba gratis' }}
        </button>
        <button class="lic-link" (click)="modo='clave'" [disabled]="cargando">Ya tengo una clave de licencia</button>
      </ng-container>

      <ng-container *ngIf="modo === 'clave'">
        <h1>Activar licencia</h1>
        <p class="lic-sub">Escribe la clave que recibiste por WhatsApp.</p>

        <label class="lic-lbl">Clave de licencia</label>
        <input class="lic-in mono" [(ngModel)]="clave" placeholder="XXXX-XXXX-XXXX" [disabled]="cargando" style="text-transform:uppercase;">

        <button class="lic-btn" (click)="activar()" [disabled]="cargando">
          <i class="ph ph-key"></i> {{ cargando ? 'Validando...' : 'Activar licencia' }}
        </button>
        <button class="lic-link" (click)="modo='prueba'" [disabled]="cargando">Volver a la prueba gratis</button>
      </ng-container>
    </div>
  </div>
  `,
  styles: [`
    .lic-wrap{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#0F2A3F,#16384f);padding:1.5rem;z-index:2000;}
    .lic-card{background: var(--wx-surface);border-radius:24px;padding:2.5rem;width:100%;max-width:440px;box-shadow: var(--wx-shadow-raised);}
    .lic-brand{font-weight: 600;font-size:1.4rem;color: var(--wx-text);margin-bottom:1.5rem;}
    .lic-brand span{color: var(--wx-accent-text);font-weight:400;}
    .lic-card h1{font-size:1.7rem;font-weight: 600;color: var(--wx-text);margin:0 0 .3rem;}
    .lic-sub{color: var(--wx-text-muted);margin:0 0 1rem;}
    .lic-lbl{display:block;font-size:.85rem;font-weight:600;color: var(--wx-text-muted);margin:.8rem 0 .35rem;}
    .lic-in{width:100%;border: 1px solid var(--wx-edge);border-radius:12px;padding:.8rem 1rem;font-size:1rem;outline:none;box-sizing:border-box;}
    .lic-in:focus{border-color: var(--wx-accent);}
    .lic-btn{width:100%;margin-top:1.5rem;background: #2563EB;color: #fff;border:none;border-radius:12px;padding:.9rem;font-weight: 600;font-size:1rem;cursor:pointer;}
    .lic-btn:hover{background: #1d4ed8;}
    .lic-btn:disabled{opacity:.6;cursor:default;}
    .lic-link{width:100%;margin-top:1rem;background:none;border:none;color: var(--wx-text-muted);font-weight:600;cursor:pointer;}
    .lic-link:hover{color: var(--wx-accent-text);}
    .mono{font-family: var(--wx-font-mono);letter-spacing:1px;}
  `]
})
export class IniciarPruebaComponent {
  @Output() listo = new EventEmitter<void>();
  modo: 'prueba' | 'clave' = 'prueba';
  businessName = '';
  email = '';
  clave = '';
  cargando = false;

  constructor(private license: LicenseService) {}

  async iniciar() {
    if (!this.businessName.trim()) { await Swal.fire({ icon: 'warning', title: 'Falta el nombre del negocio' }); return; }
    this.cargando = true;
    const res = await this.license.iniciarPrueba({ businessName: this.businessName.trim(), email: this.email.trim() || undefined });
    this.cargando = false;
    if (res.ok) {
      await Swal.fire({ icon: 'success', title: '¡Prueba activada!', text: 'Tienes 30 días gratis con todas las funciones.', timer: 1800, showConfirmButton: false });
      this.listo.emit();
    } else {
      await Swal.fire({ icon: 'error', title: 'No se pudo iniciar', text: res.error });
    }
  }

  async activar() {
    this.cargando = true;
    const res = await this.license.activarClave(this.clave);
    this.cargando = false;
    if (res.ok) {
      await Swal.fire({ icon: 'success', title: 'Licencia activada', timer: 1400, showConfirmButton: false });
      this.listo.emit();
    } else {
      await Swal.fire({ icon: 'error', title: 'Clave inválida', text: res.error });
    }
  }
}
