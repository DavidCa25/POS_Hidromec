import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { ConfigDrawerService } from '../config-drawer.service';

@Component({
  selector: 'app-formas-pago-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrls: ['../panel-controls.css'],
  styles: [`
    .pay-row{display:flex;justify-content:space-between;align-items:center;padding:.95rem 0;border-bottom:1px solid #eef2f6;}
    .pay-info{font-weight:600;color:#334155;display:flex;align-items:center;gap:.7rem;}
    .pay-info i{color:#2563EB;font-size:1.15rem;}
  `],
  template: `
  <div class="panel-content">
    <div class="section-title"><i class="bi bi-cash-coin"></i> Formas de pago</div>
    <p class="hint" style="margin-bottom:.5rem;">Activa las formas de pago que aceptas. Solo esas aparecerán al cobrar.</p>

    <div class="pay-row" *ngFor="let m of metodos">
      <div class="pay-info"><i class="bi bi-{{ m.icon }}"></i> {{ m.label }}</div>
      <label class="sw">
        <input type="checkbox" [checked]="isOn(m.key)" (change)="toggle(m.key)">
        <span class="sl"></span>
      </label>
    </div>

    <div class="btn-row" style="justify-content:flex-end; margin-top:2rem;">
      <button class="btn-primary" type="button" (click)="save()" [disabled]="guardando">
        <i class="bi bi-check2-circle"></i> {{ guardando ? 'Guardando...' : 'Guardar' }}
      </button>
    </div>
  </div>
  `
})
export class FormasPagoPanelComponent implements OnInit {
  private get api() { return (window as any).electronAPI; }

  cfg: Record<string, boolean> = { efectivo: true, tarjeta: true, transferencia: true, credito: true, terminal_mp: true };
  guardando = false;

  metodos = [
    { key: 'efectivo', label: 'Efectivo', icon: 'cash-coin' },
    { key: 'tarjeta', label: 'Tarjeta', icon: 'credit-card' },
    { key: 'transferencia', label: 'Transferencia', icon: 'bank' },
    { key: 'credito', label: 'Crédito (fiado)', icon: 'person-lines-fill' },
    { key: 'terminal_mp', label: 'Terminal Mercado Pago', icon: 'credit-card-2-back' },
  ];

  constructor(private drawer: ConfigDrawerService) {}

  async ngOnInit() {
    try {
      const r = await this.api?.paymentsGet?.();
      if (r?.success && r.data) this.cfg = { ...this.cfg, ...r.data };
    } catch { /* usa default */ }
  }

  isOn(key: string): boolean { return !!this.cfg[key]; }
  toggle(key: string) { this.cfg[key] = !this.cfg[key]; }

  async save() {
    if (!Object.values(this.cfg).some(v => v)) {
      await Swal.fire({ icon: 'warning', title: 'Activa al menos una forma de pago' });
      return;
    }
    this.guardando = true;
    try {
      const r = await this.api?.paymentsSet?.(this.cfg);
      if (!r?.success) throw new Error(r?.error || 'No se pudo guardar.');
      await Swal.fire({ icon: 'success', title: 'Formas de pago guardadas', timer: 1200, showConfirmButton: false });
      this.drawer.requestClose();
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'No se pudo guardar.' });
    } finally {
      this.guardando = false;
    }
  }
}
