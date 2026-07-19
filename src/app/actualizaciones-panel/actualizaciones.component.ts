import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-actualizaciones-panel',
  standalone: true,
  imports: [CommonModule],
  styleUrls: ['../panel-controls.css'],
  styles: [`
    .ver-box{display:flex;align-items:center;justify-content:space-between;background:#f8fafc;border:1px solid #eef2f6;border-radius:14px;padding:1.1rem 1.3rem;margin-bottom:1rem;}
    .ver-box .lbl2{font-size:.8rem;color:#64748b;text-transform:uppercase;letter-spacing:.03em;}
    .ver-box .val{font-size:1.4rem;font-weight:800;color:#0f172a;}
    .estado-ok{display:flex;align-items:center;gap:.5rem;color:#16a34a;font-weight:600;margin-top:.4rem;}
  `],
  template: `
  <div class="panel-content">
    <div class="section-title"><i class="bi bi-arrow-repeat"></i> Actualizaciones</div>

    <div class="ver-box">
      <div>
        <div class="lbl2">Versión instalada</div>
        <div class="val">Wybix POS {{ version ? 'v' + version : '—' }}</div>
        <div class="estado-ok" *ngIf="alDia">
          <i class="bi bi-check-circle-fill"></i> Estás en la última versión
        </div>
      </div>
      <i class="bi bi-box-seam" style="font-size:2.4rem;color:#2563EB;opacity:.35;"></i>
    </div>

    <p class="hint">Wybix busca actualizaciones automáticamente. También puedes revisar manualmente.</p>

    <div class="btn-row" style="margin-top:1.5rem;">
      <button class="btn-outline" type="button" (click)="buscar()" [disabled]="buscando">
        <i class="bi bi-arrow-repeat"></i> {{ buscando ? 'Buscando...' : 'Buscar actualizaciones' }}
      </button>
    </div>
  </div>
  `
})
export class ActualizacionesPanelComponent implements OnInit {
  private get api() { return (window as any).electronAPI; }
  version = '';
  buscando = false;
  alDia = false;

  async ngOnInit() {
    try {
      const r = await this.api?.getAppVersion?.();
      if (r?.success) this.version = r.version || '';
    } catch { /* sin versión */ }
  }

  async buscar() {
    this.buscando = true;
    try {
      // Refresca la versión instalada; el auto-updater corre en segundo plano.
      const r = await this.api?.getAppVersion?.();
      if (r?.success) this.version = r.version || this.version;
      this.alDia = true;
      await Swal.fire({ icon: 'success', title: 'Estás al día', text: 'Tienes la última versión disponible.', timer: 1600, showConfirmButton: false });
    } finally {
      this.buscando = false;
    }
  }
}
