import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-servicios',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styles: [`
    :host{display:block;}
    .sv-head{margin-bottom:1.2rem;}
    .sv-head h2{font-weight:800;margin:0;color:#0f172a;}
    .sv-head p{color:#64748b;margin:.25rem 0 0;font-size:.9rem;}
    .sv-tabs{display:flex;gap:8px;margin-bottom:1.2rem;}
    .sv-tab{border:1px solid #e2e8f0;background:#fff;border-radius:999px;padding:.55rem 1.1rem;font-weight:700;font-size:.9rem;cursor:pointer;color:#334155;}
    .sv-tab.active{background:#0f2a3f;color:#fff;border-color:#0f2a3f;}
    .sv-card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:1.4rem;max-width:560px;box-shadow:0 10px 30px rgba(15,23,42,.05);}
    .sv-field{margin-bottom:1rem;}
    .sv-field label{display:block;font-size:.8rem;font-weight:700;color:#334155;margin-bottom:.35rem;}
    .sv-ctl{width:100%;border:1px solid #cbd5e1;border-radius:11px;padding:.7rem .9rem;font-size:.95rem;outline:none;background:#f8fafc;color:#0f172a;}
    .sv-ctl:focus{border-color:#45B3C3;box-shadow:0 0 0 3px rgba(69,179,195,.12);background:#fff;}
    .sv-montos{display:flex;flex-wrap:wrap;gap:8px;}
    .sv-monto{border:1px solid #cbd5e1;background:#fff;border-radius:10px;padding:.5rem .9rem;font-weight:700;cursor:pointer;color:#334155;}
    .sv-monto.sel{background:#45B3C3;color:#fff;border-color:#45B3C3;}
    .sv-btn{display:inline-flex;align-items:center;gap:8px;border:none;border-radius:12px;padding:.8rem 1.4rem;font-weight:800;font-size:.95rem;cursor:pointer;background:#0f2a3f;color:#fff;}
    .sv-btn:disabled{opacity:.5;cursor:not-allowed;}
    .sv-banner{display:flex;gap:10px;align-items:flex-start;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);color:#92400e;border-radius:12px;padding:.8rem 1rem;font-size:.85rem;margin-bottom:1.2rem;max-width:560px;}

    :host-context(html.dark) .sv-head h2{color:#f1f5f9;}
    :host-context(html.dark) .sv-tab{background:#16233a;border-color:rgba(255,255,255,.12);color:#cbd5e1;}
    :host-context(html.dark) .sv-tab.active{background:#45B3C3;color:#04121a;border-color:#45B3C3;}
    :host-context(html.dark) .sv-card{background:#16233a;border-color:rgba(255,255,255,.1);}
    :host-context(html.dark) .sv-field label{color:#94a3b8;}
    :host-context(html.dark) .sv-ctl{background:#0f1826;color:#e2e8f0;border-color:rgba(255,255,255,.14);}
    :host-context(html.dark) .sv-monto{background:#0f1826;color:#cbd5e1;border-color:rgba(255,255,255,.14);}
    :host-context(html.dark) .sv-banner{background:rgba(245,158,11,.12);color:#fcd9a1;}
  `],
  template: `
  <div class="sv-head">
    <h2>Pago de servicios y recargas</h2>
    <p>Ofrece recargas de tiempo aire y pago de servicios a tus clientes.</p>
  </div>

  <div class="sv-banner">
    <i class="bi bi-info-circle"></i>
    <span>Módulo en integración con <b>TAECEL</b>. Ya está configurado; las operaciones en vivo se habilitan al conectar la API del proveedor.</span>
  </div>

  <div class="sv-tabs">
    <button class="sv-tab" [class.active]="tab==='recargas'" (click)="tab='recargas'">Recargas</button>
    <button class="sv-tab" [class.active]="tab==='servicios'" (click)="tab='servicios'">Pago de servicios</button>
  </div>

  <!-- RECARGAS -->
  <div class="sv-card" *ngIf="tab==='recargas'">
    <div class="sv-field">
      <label>Compañía</label>
      <select class="sv-ctl" [(ngModel)]="compania">
        <option *ngFor="let c of companias" [value]="c">{{ c }}</option>
      </select>
    </div>
    <div class="sv-field">
      <label>Número de teléfono</label>
      <input class="sv-ctl" [(ngModel)]="telefono" maxlength="10" placeholder="10 dígitos" inputmode="numeric">
    </div>
    <div class="sv-field">
      <label>Monto</label>
      <div class="sv-montos">
        <button type="button" class="sv-monto" *ngFor="let m of montos" [class.sel]="monto===m" (click)="monto=m">$ {{ m }}</button>
      </div>
    </div>
    <button class="sv-btn" [disabled]="busy || telefono.length!==10 || !monto" (click)="operar('recarga')">
      <i class="bi bi-phone"></i> {{ busy ? 'Procesando...' : 'Realizar recarga' }}
    </button>
  </div>

  <!-- SERVICIOS -->
  <div class="sv-card" *ngIf="tab==='servicios'">
    <div class="sv-field">
      <label>Servicio</label>
      <select class="sv-ctl" [(ngModel)]="servicio">
        <option *ngFor="let s of servicios" [value]="s">{{ s }}</option>
      </select>
    </div>
    <div class="sv-field">
      <label>Referencia / número de cuenta</label>
      <input class="sv-ctl" [(ngModel)]="referencia" placeholder="Referencia del recibo">
    </div>
    <div class="sv-field">
      <label>Monto a pagar</label>
      <input class="sv-ctl" type="number" [(ngModel)]="montoServicio" min="1" placeholder="0.00">
    </div>
    <button class="sv-btn" [disabled]="busy || !referencia || !montoServicio" (click)="operar('servicio')">
      <i class="bi bi-lightning-charge"></i> {{ busy ? 'Procesando...' : 'Pagar servicio' }}
    </button>
  </div>
  `
})
export class Servicios {
  private get api() { return (window as any).electronAPI; }

  tab: 'recargas' | 'servicios' = 'recargas';
  busy = false;

  companias = ['Telcel', 'Movistar', 'AT&T', 'Unefon', 'Bait', 'Weex'];
  compania = 'Telcel';
  telefono = '';
  montos = [10, 20, 30, 50, 100, 150, 200, 300, 500];
  monto: number | null = null;

  servicios = ['CFE (Luz)', 'Agua', 'Gas Natural', 'Telmex', 'Izzi', 'Totalplay', 'Sky', 'Dish'];
  servicio = 'CFE (Luz)';
  referencia = '';
  montoServicio: number | null = null;

  async operar(tipo: 'recarga' | 'servicio') {
    this.busy = true;
    try {
      const op = tipo === 'recarga'
        ? { type: 'recarga', compania: this.compania, telefono: this.telefono, monto: this.monto }
        : { type: 'servicio', servicio: this.servicio, referencia: this.referencia, monto: this.montoServicio };
      const res = await this.api?.servicesOperate?.(op);
      if (res?.ok) {
        await Swal.fire({ icon: 'success', title: 'Operación exitosa', timer: 1600, showConfirmButton: false });
        this.reset();
      } else if (res?.pendingApi) {
        await Swal.fire({ icon: 'info', title: 'Falta conectar TAECEL', text: res?.error || 'Conecta la API de TAECEL para operar en vivo.' });
      } else {
        await Swal.fire({ icon: 'error', title: 'No se pudo procesar', text: res?.error || 'Intenta de nuevo.' });
      }
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'Error inesperado.' });
    } finally {
      this.busy = false;
    }
  }

  private reset() {
    this.telefono = ''; this.monto = null;
    this.referencia = ''; this.montoServicio = null;
  }
}
