import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import Swal from 'sweetalert2';
import { LicenseService } from '../../services/license.service';

const COMPRA_URL = 'https://wybix-landing.vercel.app';

const UMBRALES = [15, 7, 3, 1]; 

/*
 * MINIMIZABLE.
 *
 * La pastilla vivia fija en la esquina inferior derecha, justo donde estan
 * «Cobrar» en Touch y los totales en Venta: estorbaba la operacion. Ahora se
 * pliega en una pestaña de 30 px pegada al borde derecho, con los dias que
 * quedan, y se recuerda en este equipo.
 *
 * Una sola excepcion: al entrar en los ultimos dias (URGENTE) vuelve a
 * abrirse UNA vez, porque ahi el aviso si importa mas que el espacio. Se
 * puede volver a plegar.
 */
const CLAVE_PLEGADA = 'wybix_trial_plegada';
const URGENTE = 3;

@Component({
  selector: 'app-trial-banner',
  standalone: true,
  imports: [CommonModule],
  template: `
  @if (!plegada()) {
    <div class="trial-chip" [class.urgente]="dias <= 5" role="status">
      <i class="ph ph-hourglass" aria-hidden="true"></i>
      <span class="txt">
        Prueba gratuita ·
        <strong>{{ dias }} {{ dias === 1 ? 'día' : 'días' }}</strong> restantes
      </span>
      <button type="button" class="chip-btn" (click)="comprar()">Comprar</button>
      <button type="button" class="chip-min" (click)="plegar()"
              aria-label="Minimizar el aviso de prueba" title="Minimizar">
        <i class="ph ph-caret-right" aria-hidden="true"></i>
      </button>
    </div>
  } @else {
    <button type="button" class="trial-tab" [class.urgente]="dias <= 5" (click)="desplegar()"
            [attr.aria-label]="'Prueba gratuita: ' + dias + (dias === 1 ? ' día' : ' días') + ' restantes. Mostrar aviso'"
            [title]="'Prueba gratuita · ' + dias + (dias === 1 ? ' día' : ' días')">
      <i class="ph ph-hourglass" aria-hidden="true"></i>
      <span>{{ dias }}d</span>
    </button>
  }
  `,
  styles: [`
    .trial-chip{position:fixed;right:18px;bottom:18px;z-index:1500;display:flex;align-items:center;gap:.6rem;
      background: var(--wx-navy-600);color: #fff;border-radius:999px;padding:.45rem .45rem .45rem 1rem;
      box-shadow: var(--wx-shadow-menu);font-size:.9rem;
      animation: trial-entra var(--wx-dur-state) var(--wx-ease-out) both;}
    .trial-chip i{color: var(--wx-cyan-400);}
    .trial-chip.urgente{background: #7c2d12;}
    .trial-chip.urgente i{color: #fdba74;}
    .txt strong{font-weight: 600;}
    .chip-btn{margin-left:.4rem;background: var(--wx-blue-600);color: #fff;border:none;border-radius:999px;padding:.35rem .9rem;font-weight: 600;font-size:.85rem;cursor:pointer;
      transition: background-color var(--wx-dur-micro) ease, transform var(--wx-dur-press) var(--wx-ease-out);}
    .chip-btn:hover{background: #1d4ed8;}
    .trial-chip.urgente .chip-btn{background: #ea580c;}
    .trial-chip.urgente .chip-btn:hover{background: #c2410c;}
    .chip-min{display:grid;place-items:center;width:30px;height:30px;border:none;border-radius:999px;cursor:pointer;
      background: rgb(255 255 255 / .08);color: rgb(255 255 255 / .82);
      transition: background-color var(--wx-dur-micro) ease, transform var(--wx-dur-press) var(--wx-ease-out);}
    .chip-min i{color: inherit;font-size:15px;}
    .chip-min:hover{background: rgb(255 255 255 / .16);color:#fff;}
    .chip-btn:active,.chip-min:active{transform: scale(.96);}

    /* Plegada: una pestaña contra el borde derecho, a media altura baja, fuera
       de las esquinas donde viven «Cobrar» y los totales. */
    .trial-tab{position:fixed;right:0;top:38%;z-index:1500;display:flex;flex-direction:column;align-items:center;gap:2px;
      width:30px;padding:9px 0 8px;border:none;border-radius: var(--wx-radius-sm) 0 0 var(--wx-radius-sm);cursor:pointer;
      background: var(--wx-navy-600);color: #fff;box-shadow: var(--wx-shadow-raised);
      font: 600 10.5px/1 var(--wx-font-mono);
      animation: trial-asoma var(--wx-dur-state) var(--wx-ease-out) both;
      transition: width var(--wx-dur-micro) var(--wx-ease-out), background-color var(--wx-dur-micro) ease;}
    .trial-tab i{font-size:15px;color: var(--wx-cyan-400);}
    .trial-tab:hover{width:36px;}
    .trial-tab.urgente{background: #7c2d12;}
    .trial-tab.urgente i{color: #fdba74;}
    .trial-tab:focus-visible,.chip-min:focus-visible,.chip-btn:focus-visible{outline:2px solid var(--wx-cyan-400);outline-offset:2px;}

    @keyframes trial-entra { from { opacity:0; transform: translateY(6px); } }
    @keyframes trial-asoma { from { opacity:0; transform: translateX(8px); } }
    @media (prefers-reduced-motion: reduce){ .trial-chip,.trial-tab{animation:none;} .trial-tab{transition:none;} }
  `]
})
export class TrialBannerComponent implements OnInit {
  constructor(private license: LicenseService) {}

  /** Plegada en la pestaña del borde. */
  readonly plegada = signal(false);

  get dias(): number { return this.license.diasRestantesPrueba; }

  ngOnInit() {
    this.plegada.set(this.leerPlegada());
    this.avisarSiCorresponde();
  }

  plegar() {
    this.plegada.set(true);
    /* Se guarda con cuantos dias quedaban: asi se sabe si ya se plego dentro
       de los ultimos dias o antes de llegar a ellos. */
    try { localStorage.setItem(CLAVE_PLEGADA, String(this.dias)); } catch { /* noop */ }
  }

  desplegar() {
    this.plegada.set(false);
    try { localStorage.removeItem(CLAVE_PLEGADA); } catch { /* noop */ }
  }

  private leerPlegada(): boolean {
    let guardado: string | null = null;
    try { guardado = localStorage.getItem(CLAVE_PLEGADA); } catch { return false; }
    if (guardado === null) return false;
    /* Plegada ANTES de los ultimos dias y ya estamos en ellos: se abre una vez. */
    if (this.dias <= URGENTE && Number(guardado) > URGENTE) {
      try { localStorage.removeItem(CLAVE_PLEGADA); } catch { /* noop */ }
      return false;
    }
    return true;
  }

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
