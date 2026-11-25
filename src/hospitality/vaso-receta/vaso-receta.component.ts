import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { IngredienteVaso, claseDe, colorDe, dibujarVaso } from '../../../shared/vaso';

let siguiente = 0;

/**
 * EL VASO QUE SE PREPARA mientras se arma la receta.
 *
 * Solo dibuja: sale de las mismas líneas que se editan en la tabla de
 * Recetas y no guarda nada. Las cuentas viven en shared/vaso.ts.
 *
 * Accesible: el dibujo es decorativo (`aria-hidden`); lo que dice va en texto
 * al lado (cada ingrediente con su cantidad, y si se desborda). Con
 * movimiento reducido las capas cambian sin transición.
 */
@Component({
  selector: 'wx-vaso-receta',
  standalone: true,
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="vaso-r" data-guide="receta-vaso">
      <div class="vr__cab">
        <b>Así queda{{ titulo() ? ' · ' + titulo() : '' }}</b>
        <span class="vr__cap" [class.pasa]="d().desborda" role="status">
          {{ d().desborda ? 'Se desborda: ' : '' }}{{ d().ocupado | number:'1.0-0' }} de {{ d().capacidad | number:'1.0-0' }} ml
        </span>
      </div>
      <div class="vr__escena" [class.gris]="heredada()">
        <svg class="vr__svg" viewBox="0 0 300 420" aria-hidden="true">
          <defs><clipPath [attr.id]="clip"><path [attr.d]="d().vaso"></path></clipPath></defs>
          <ellipse cx="150" cy="398" rx="96" ry="9" fill="rgba(15,23,42,0.10)"></ellipse>
          <path [attr.d]="d().vaso" class="vr__vidrio"></path>
          <g [attr.clip-path]="'url(#' + clip + ')'">
            @for (c of d().capas; track $index) {
              <rect class="vr__capa" x="0" [attr.y]="c.y" width="300" [attr.height]="c.h" [attr.fill]="c.color"></rect>
              @if (c.merma > 0) {
                <rect class="vr__capa" x="0" [attr.y]="c.y" width="300" height="3" fill="none" stroke="rgba(15,23,42,0.35)" stroke-dasharray="6 5"></rect>
              }
            }
            @for (k of d().cubos; track $index) {
              <rect class="vr__cubo" [attr.x]="k.x" [attr.y]="k.y" width="30" height="30" rx="7"></rect>
            }
          </g>
          @if (d().domo) { <path [attr.d]="d().domo" class="vr__domo"></path> }
          @for (t of d().trocitos; track $index) {
            <rect [attr.x]="t.x" [attr.y]="t.y" width="9" height="4" rx="2" [attr.fill]="t.color"
                  [attr.transform]="'rotate(' + t.giro + ' ' + t.x + ' ' + t.y + ')'"></rect>
          }
          <path [attr.d]="d().vaso" class="vr__borde"></path>
          <path [attr.d]="d().brillo" class="vr__brillo"></path>
          @if (d().popote && d().capas.length) { <path [attr.d]="d().popote" class="vr__popote"></path> }
        </svg>
        <ul class="vr__rotulos">
          @for (r of rotulos(); track r.nombre) {
            <li><span class="vr__punto" [style.background]="r.color"></span><span class="vr__nom">{{ r.nombre }}</span><b>{{ r.cant }}</b></li>
          }
          @if (!rotulos().length) { <li class="vr__vacio">Agrega ingredientes y la bebida se va sirviendo.</li> }
        </ul>
      </div>
      @if (heredada()) { <p class="vr__nota">Usa la receta base. Ajusta y guarda para darle la suya.</p> }
    </div>
  `,
  styles: [`
    :host { display: block; }
    /* No .vr: Bootstrap la usa para una raya vertical de 1px. */
    .vaso-r { display: flex; flex-direction: column; gap: 10px; }
    .vr__cab { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: var(--wx-text-base); }
    .vr__cap { font-size: var(--wx-text-xs); font-weight: 600; border-radius: 999px; padding: 3px 10px;
      background: var(--wx-accent-soft); color: var(--wx-accent-text); white-space: nowrap; }
    .vr__cap.pasa { background: var(--wx-danger-soft); color: var(--wx-danger); }
    .vr__escena { display: flex; gap: 6px; border-radius: var(--wx-radius-md); overflow: hidden; min-height: 300px;
      background: radial-gradient(120% 80% at 50% 100%, var(--wx-accent-soft) 0%, var(--wx-raised) 65%); }
    .vr__escena.gris { filter: grayscale(0.85); opacity: .8; }
    .vr__svg { flex: 0 0 52%; max-height: 360px; }
    .vr__vidrio { fill: rgba(237, 241, 246, 0.55); }
    .vr__borde { fill: none; stroke: var(--wx-edge-strong); stroke-width: 3; }
    .vr__brillo { fill: none; stroke: rgba(255, 255, 255, 0.7); stroke-width: 6; stroke-linecap: round; }
    .vr__popote { fill: none; stroke: var(--wx-accent); stroke-width: 9; stroke-linecap: round; }
    .vr__domo { fill: #FFFDF7; stroke: #EFE7D6; stroke-width: 2; }
    .vr__cubo { fill: rgba(255, 255, 255, 0.55); stroke: rgba(255, 255, 255, 0.9); stroke-width: 2; }
    .vr__capa { transition: y .35s ease, height .35s ease; }
    @media (prefers-reduced-motion: reduce) { .vr__capa { transition: none; } }
    .vr__rotulos { list-style: none; margin: 0; padding: 14px 12px 14px 0; display: flex; flex-direction: column; justify-content: flex-end; gap: 8px; flex: 1 1 auto; min-width: 0; }
    .vr__rotulos li { display: flex; align-items: center; gap: 8px; font-size: var(--wx-text-sm); }
    .vr__nom { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .vr__rotulos b { font-family: var(--wx-font-mono); font-weight: 500; font-size: var(--wx-text-xs); color: var(--wx-text-muted); white-space: nowrap; }
    .vr__punto { width: 12px; height: 12px; border-radius: 4px; flex: 0 0 12px; border: 1px solid rgba(15, 24, 38, 0.18); }
    .vr__vacio { color: var(--wx-text-muted); }
    .vr__nota { margin: 0; font-size: var(--wx-text-xs); color: var(--wx-text-dim); }
  `],
})
export class VasoRecetaComponent {
  /** Las líneas de la receta, ya en unidad base (ml, g, pza). */
  readonly lineas = input<IngredienteVaso[]>([]);
  readonly capacidad = input<number>(473);
  readonly titulo = input<string>('');
  /** La variante todavía usa la receta base. */
  readonly heredada = input<boolean>(false);
  /** Unidad base de cada línea, para el rótulo. */
  readonly unidades = input<string[]>([]);

  readonly clip = `vr-clip-${++siguiente}`;
  readonly d = computed(() => dibujarVaso(this.lineas(), this.capacidad()));

  /** De arriba hacia abajo, como se ve en el vaso. */
  readonly rotulos = computed(() => this.lineas()
    .map((l, i) => ({ nombre: l.nombre, color: claseDe(l.nombre, l.dimension) === 'crema' ? '#FFFDF7' : colorDe(l.nombre),
      cant: `${+l.cantidad.toFixed(2)} ${this.unidades()[i] ?? ''}`.trim() }))
    .reverse());
}
