import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/**
 * EL INDICADOR DE PROCESO DE WYBIX. Uno solo.
 *
 * DE DONDE SALE
 * -------------
 * Antes habia OCHO animaciones de girar distintas repartidas por la
 * aplicacion —`wx-spin`, `tp-spin`, `sn-spin`, `rf-spin`, `rd-giro`,
 * `pv-girar`, `pq-spin` y `spin`—, todas diciendo lo mismo con un dibujo
 * ligeramente distinto. Ninguna vino de fuera: las produjo copiar y pegar.
 *
 * QUE LO HACE DE WYBIX Y NO UN CIRCULO MAS
 * ----------------------------------------
 * El trazo NO es una circunferencia: es el contorno de la cabeza de Wybix
 * —mas ancha arriba, recogida abajo—, recortado a tres cuartos. Al girar se
 * reconoce la silueta sin que haya un logotipo dando vueltas, que es lo que
 * queriamos evitar.
 *
 * POR QUE GIRA Y NO «RESPIRA»
 * ---------------------------
 * Se miro que hacen las galerias de componentes: casi todos sus cargadores
 * animan `box-shadow`, `filter: blur` o `background-position` en bucle
 * infinito. Las tres obligan al navegador a repintar un area grande en cada
 * fotograma; en una caja de mostrador con graficos integrados eso se nota,
 * y esto puede estar ocho horas en pantalla.
 *
 * Aqui solo se anima `transform: rotate`, que la GPU compone sin repintar
 * nada. Un unico bucle, y solo mientras hay trabajo de verdad detras.
 */
@Component({
  selector: 'wx-cargando',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="wxc" [style.width.px]="size" [style.height.px]="size"
          role="status" [attr.aria-label]="alt">
      <svg class="wxc__giro wx-latir" [attr.width]="size" [attr.height]="size"
           viewBox="0 0 100 100" aria-hidden="true">
        <!-- El contorno completo, muy tenue: da la silueta incluso parado. -->
        <path d="M50 12c21 0 33 15 33 35 0 24-15 39-33 39S17 71 17 47C17 27 29 12 50 12z"
              fill="none" [attr.stroke]="'currentColor'" stroke-opacity="0.16"
              [attr.stroke-width]="grosor" />
        <!-- Tres cuartos del MISMO contorno: lo que gira. -->
        <path d="M50 12c21 0 33 15 33 35 0 24-15 39-33 39S17 71 17 47"
              fill="none" [attr.stroke]="'currentColor'"
              [attr.stroke-width]="grosor" stroke-linecap="round" />
      </svg>
    </span>
  `,
  styles: [`
    .wxc { display: inline-flex; align-items: center; justify-content: center; flex: none;
           color: var(--wx-accent-text); }
    /* El giro (wx-latir) vive en styles/movimiento.css: una sola definicion
       para toda la aplicacion. Aqui solo se dice que este elemento gira. */
    .wxc__giro { display: block; transform-origin: 50% 50%; }
  `],
})
export class WxCargandoComponent {
  @Input() size = 20;
  /** Lo que lee un lector de pantalla. Siempre dice QUE se esta haciendo. */
  @Input() alt = 'Cargando';

  /** El trazo se mantiene legible a cualquier tamaño sin engordar. */
  get grosor(): number {
    return this.size <= 16 ? 9 : this.size <= 28 ? 7 : 5.5;
  }
}
