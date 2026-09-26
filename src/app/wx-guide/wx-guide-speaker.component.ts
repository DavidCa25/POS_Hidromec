import {
  AfterViewInit, ChangeDetectionStrategy, Component, Input, OnChanges, OnDestroy, ViewChild,
} from '@angular/core';
import { NgIf } from '@angular/common';
import { EstadoMascota, WxMascotaComponent } from '../wx-mascota/wx-mascota.component';
import { VarianteMascota, VARIANTE_BASE } from '../wx-mascota/variantes';
import { EstadoGuia } from './guia-tipos';

/**
 * WX-GUIDE-SPEAKER — Wybix hablando.
 *
 * La MISMA figura de la sesion (`variante`): durante un recorrido no cambia de
 * personaje. Lo que cambia es el gesto:
 *
 *   speaking   un balanceo corto, solo mientras escribe
 *   pointing   mira el objetivo
 *   waiting    mira el objetivo, un poco inclinado hacia el: «te toca»
 *   thinking   mira hacia arriba y tres puntos respiran (sin cara nueva: la
 *              mascota tiene cuatro expresiones a proposito)
 *   success    la cara feliz y un saltito, una vez
 *   attention  la cara de sorpresa y un respingo, una vez
 *   error      la cara triste; el texto dice que paso
 *
 * La mirada la mueve `blobatar/gaze`, que escribe dos propiedades y nada mas.
 * Sin objetivo, los ojos vuelven a su vaiven normal: la figura sigue viva.
 */
@Component({
  selector: 'wx-guide-speaker',
  standalone: true,
  imports: [NgIf, WxMascotaComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <span class="wxgs" [class]="'wxgs es-' + estado" [style.--wxgs-tam.px]="size">
    <wx-mascota [estado]="pose" [variante]="variante" [size]="size"></wx-mascota>
    <span class="wxgs__piensa" *ngIf="estado === 'thinking'" aria-hidden="true"><i></i><i></i><i></i></span>
  </span>
  `,
  styles: [`
    :host { display: inline-flex; }
    .wxgs { position: relative; display: inline-flex; transform-origin: 50% 90%; }
    .wxgs ::ng-deep svg { --mo-track-travel: calc(var(--wxgs-tam, 80px) * 0.05); }
    .es-speaking { animation: wxgs-habla 340ms var(--wx-ease-out) infinite alternate; }
    @keyframes wxgs-habla { to { transform: translateY(-2px) scale(1.02, 0.985); } }
    .es-waiting { transform: rotate(-4deg); transition: transform var(--wx-dur-state) var(--wx-ease-out); }
    .es-success { animation: wxgs-salto 520ms var(--wx-ease-out) 1; }
    @keyframes wxgs-salto { 35% { transform: translateY(-8px) scale(1.03); } 70% { transform: translateY(0) scale(0.98, 1.02); } }
    .es-attention { animation: wxgs-respingo 380ms var(--wx-ease-out) 1; }
    @keyframes wxgs-respingo { 40% { transform: translateY(-4px) rotate(3deg); } }
    .wxgs__piensa { position: absolute; right: -6px; top: 4px; display: flex; gap: 3px; }
    .wxgs__piensa i { width: 6px; height: 6px; border-radius: 50%; background: var(--wx-accent); opacity: 0.35;
      animation: wxgs-punto 1.1s var(--wx-ease-in-out) infinite; }
    .wxgs__piensa i:nth-child(2) { animation-delay: 160ms; }
    .wxgs__piensa i:nth-child(3) { animation-delay: 320ms; }
    @keyframes wxgs-punto { 40% { opacity: 1; transform: translateY(-3px); } }
    @media (prefers-reduced-motion: reduce) {
      .es-speaking, .es-success, .es-attention, .wxgs__piensa i { animation: none; }
      .es-waiting { transform: none; }
      .wxgs__piensa i { opacity: 0.8; }
    }
  `],
})
export class WxGuideSpeakerComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() estado: EstadoGuia = 'idle';
  @Input() objetivo: Element | null = null;
  @Input() variante: VarianteMascota = VARIANTE_BASE;
  @Input() size = 84;

  @ViewChild(WxMascotaComponent) mascota?: WxMascotaComponent;

  private mirada: { lookAt: (t: any) => void; stop: () => void } | null = null;
  private vivo = true;

  /** Cuatro caras y ni una mas; el resto es gesto y mirada. */
  get pose(): EstadoMascota {
    switch (this.estado) {
      case 'success': return 'exito';
      case 'attention': return 'atencion';
      case 'error': return 'error';
      default: return 'idle';
    }
  }

  async ngAfterViewInit() {
    try {
      const mod: any = await import('blobatar/gaze');
      if (!this.vivo) return;
      /* La figura se dibuja de forma asincrona: se espera a que tenga ojos. */
      const svg = this.mascota?.svg();
      if (!svg) return;
      const armar = () => {
        if (!this.vivo || this.mirada || !svg.querySelector('.mo-eyes')) return false;
        this.mirada = mod.gaze(svg);
        this.apuntar();
        return true;
      };
      if (!armar()) {
        const obs = new MutationObserver(() => { if (armar()) obs.disconnect(); });
        obs.observe(svg, { childList: true, subtree: true });
      }
    } catch { /* sin mirada: la figura sigue con su vaiven */ }
  }

  ngOnChanges(): void { this.apuntar(); }

  private apuntar() {
    if (!this.mirada) return;
    const e = this.estado;
    if (e === 'thinking') {
      const r = this.mascota?.svg()?.getBoundingClientRect();
      if (r) this.mirada.lookAt({ x: r.left - 40, y: r.top - 160 });
      return;
    }
    if (this.objetivo && (e === 'pointing' || e === 'waiting' || e === 'speaking' || e === 'attention')) {
      this.mirada.lookAt(this.objetivo);
      return;
    }
    this.mirada.lookAt(null);
  }

  ngOnDestroy(): void {
    this.vivo = false;
    try { this.mirada?.stop(); } catch { /* noop */ }
  }
}
