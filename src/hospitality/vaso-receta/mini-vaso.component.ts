import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { colorDe } from '../../../shared/vaso';

type Efecto = 'NONE' | 'ADD' | 'REMOVE' | 'SUBSTITUTE' | 'SCALE';

/**
 * ANTES Y DESPUÉS de una opción de modificador, en dos vasitos.
 *
 *   ADD          una capa nueva del ingrediente, con «+»
 *   SUBSTITUTE   la capa de abajo cambia de color, con flechas
 *   REMOVE       el ingrediente punteado y tachado, con «×»
 *   SCALE        el vaso entero más grande, con «×1.5»
 *   NONE         nota para barra: el vaso igual, con una burbuja
 *
 * Decorativo: lo que dice va en el texto de al lado (`resumen`), que lee
 * cualquiera, con o sin lector de pantalla.
 */
@Component({
  selector: 'wx-mini-vaso',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 150 130" class="mv" aria-hidden="true">
      <!-- antes -->
      <path d="M14 30 L60 30 L54 112 L20 112 Z" class="mv__vaso"></path>
      <path d="M18 70 L56 70 L54 112 L20 112 Z" [attr.fill]="base()"></path>
      <path d="M17 56 L57 56 L56 70 L18 70 Z" fill="#4B2E1F"></path>
      <path d="M65 71 l12 0 m-5 -5 l5 5 -5 5" class="mv__flecha"></path>
      <!-- después -->
      @switch (efecto()) {
        @case ('SCALE') {
          <path d="M84 22 L138 22 L130 112 L92 112 Z" class="mv__vaso mv__vaso--on"></path>
          <path d="M89 66 L133 66 L130 112 L92 112 Z" [attr.fill]="base()"></path>
          <path d="M88 50 L134 50 L133 66 L89 66 Z" fill="#4B2E1F"></path>
          <rect x="102" y="27" width="36" height="18" rx="9" class="mv__marca"></rect>
          <text x="120" y="40" text-anchor="middle" class="mv__txt">×{{ factorTexto() }}</text>
        }
        @default {
          <path d="M88 30 L134 30 L128 112 L94 112 Z" class="mv__vaso"></path>
          @if (efecto() === 'ADD') {
            <path d="M92 76 L130 76 L128 112 L94 112 Z" [attr.fill]="base()"></path>
            <path d="M91 62 L131 62 L130 76 L92 76 Z" fill="#4B2E1F"></path>
            <path d="M90 46 L132 46 L131 62 L91 62 Z" [attr.fill]="color()" class="mv__nueva"></path>
            <circle cx="132" cy="36" r="11" class="mv__marca"></circle>
            <path d="M127 36h10M132 31v10" class="mv__icono"></path>
          } @else if (efecto() === 'SUBSTITUTE') {
            <path d="M92 70 L130 70 L128 112 L94 112 Z" [attr.fill]="color()" class="mv__nueva"></path>
            <path d="M91 56 L131 56 L130 70 L92 70 Z" fill="#4B2E1F"></path>
            <circle cx="132" cy="36" r="11" class="mv__marca"></circle>
            <path d="M127 34h9l-3 -3M137 39h-9l3 3" class="mv__icono"></path>
          } @else if (efecto() === 'REMOVE') {
            <path d="M92 70 L130 70 L128 112 L94 112 Z" [attr.fill]="base()"></path>
            <path d="M91 56 L131 56 L130 70 L92 70 Z" fill="none" class="mv__quita"></path>
            <circle cx="132" cy="36" r="11" class="mv__marca mv__marca--quita"></circle>
            <path d="M128 32l8 8M136 32l-8 8" class="mv__icono mv__icono--claro"></path>
          } @else {
            <path d="M92 70 L130 70 L128 112 L94 112 Z" [attr.fill]="base()"></path>
            <path d="M91 56 L131 56 L130 70 L92 70 Z" fill="#4B2E1F"></path>
            <path d="M116 14 h26 a6 6 0 0 1 6 6 v12 a6 6 0 0 1 -6 6 h-16 l-8 7 v-7 a6 6 0 0 1 -6 -6 v-12 a6 6 0 0 1 6 -6z" class="mv__nota"></path>
          }
        }
      }
    </svg>
  `,
  styles: [`
    :host { display: block; }
    .mv { width: 150px; height: 130px; display: block; }
    .mv__vaso { fill: var(--wx-sunken); stroke: var(--wx-edge-strong); stroke-width: 2; }
    .mv__vaso--on { stroke: var(--wx-accent); }
    .mv__flecha { stroke: var(--wx-text-dim); stroke-width: 2; fill: none; stroke-linecap: round; }
    .mv__nueva { stroke: var(--wx-accent); stroke-width: 2; stroke-dasharray: 4 3; }
    .mv__quita { stroke: var(--wx-danger); stroke-width: 2; stroke-dasharray: 4 3; }
    .mv__marca { fill: var(--wx-accent); }
    .mv__marca--quita { fill: var(--wx-danger); }
    .mv__icono { stroke: var(--wx-accent-ink); stroke-width: 2.2; fill: none; stroke-linecap: round; stroke-linejoin: round; }
    .mv__icono--claro { stroke: #fff; }
    .mv__txt { font-family: var(--wx-font); font-size: 11px; font-weight: 700; fill: var(--wx-accent-ink); }
    .mv__nota { fill: var(--wx-surface); stroke: var(--wx-edge-strong); stroke-width: 2; }
  `],
})
export class MiniVasoComponent {
  readonly efecto = input<Efecto>('NONE');
  /** El ingrediente que agrega o que entra al sustituir. */
  readonly ingrediente = input<string | null>(null);
  readonly factor = input<number | null>(null);

  readonly color = computed(() => colorDe(this.ingrediente() ?? ''));
  /** La leche de siempre, para que el cambio se note contra ella. */
  readonly base = computed(() => '#F3EEE4');
  readonly factorTexto = computed(() => String(+(this.factor() ?? 1).toFixed(2)));
}
