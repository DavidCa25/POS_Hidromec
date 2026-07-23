import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import Swal from 'sweetalert2';
import { LicenseService } from '../../services/license.service';

const COMPRA_URL = 'https://wybix-landing.vercel.app';

const UMBRALES = [15, 7, 3, 1]; 

@Component({
  selector: 'app-trial-banner',
  standalone: true,
  imports: [CommonModule],
  template: `
  <div class="trial-chip" [class.urgente]="dias <= 5">
    <i class="bi bi-hourglass-split"></i>
    <span class="txt">
      Prueba gratis ·
      <strong>{{ dias }} {{ dias === 1 ? 'día' : 'días' }}</strong> restantes
    </span>
    <button class="chip-btn" (click)="comprar()">Comprar</button>
  </div>
  `,
  styles: [`
    .trial-chip{position:fixed;right:18px;bottom:18px;z-index:1500;display:flex;align-items:center;gap:.6rem;
      background:#0F2A3F;color:#fff;border-radius:999px;padding:.55rem .85rem .55rem 1rem;
      box-shadow:0 10px 25px rgba(0,0,0,.28);font-size:.9rem;}
    .trial-chip i{color:#45B3C3;}
    .trial-chip.urgente{background:#7c2d12;}
    .trial-chip.urgente i{color:#fdba74;}
    .txt strong{font-weight:800;}
    .chip-btn{margin-left:.4rem;background:#2563EB;color:#fff;border:none;border-radius:999px;padding:.35rem .9rem;font-weight:700;font-size:.85rem;cursor:pointer;}
    .chip-btn:hover{background:#1d4ed8;}
    .trial-chip.urgente .chip-btn{background:#ea580c;}
    .trial-chip.urgente .chip-btn:hover{background:#c2410c;}
  `]
})
export class TrialBannerComponent implements OnInit {
  constructor(private license: LicenseService) {}

  get dias(): number { return this.license.diasRestantesPrueba; }

  ngOnInit() { this.avisarSiCorresponde(); }

  comprar() {
    const api = (window as any).electronAPI;
    if (api?.openExternal) { api.openExternal(COMPRA_URL); return; }
    try { window.open(COMPRA_URL, '_blank'); } catch { /* noop */ }
  }

  // Muestra un aviso una sola vez por umbral (15, 7, 3, 1 días).
  private avisarSiCorresponde() {
    const dias = this.dias;
    let disparo: number | null = null;
    for (const u of UMBRALES) {
      const key = 'wybix_trial_notice_' + u;
      if (dias <= u && !localStorage.getItem(key)) {
        localStorage.setItem(key, '1');
        disparo = disparo === null ? u : Math.min(disparo, u);
      }
    }
    if (disparo !== null) this.mostrarAviso(dias);
  }

  private mostrarAviso(dias: number) {
    const urgente = dias <= 3;
    Swal.fire({
      icon: urgente ? 'warning' : 'info',
      title: dias === 1 ? 'Te queda 1 día de prueba' : `Te quedan ${dias} días de prueba`,
      text: 'Activa tu licencia para seguir usando Wybix POS sin interrupciones.',
      showCancelButton: true,
      confirmButtonText: 'Comprar licencia',
      cancelButtonText: 'Después',
      confirmButtonColor: '#2563EB'
    }).then(r => { if (r.isConfirmed) this.comprar(); });
  }
}
