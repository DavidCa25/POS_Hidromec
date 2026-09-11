import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Teclado en pantalla de Wybix.
 *
 * Una caja tactil de mostrador no siempre tiene teclado fisico, y el teclado
 * de Windows tapa media pantalla y aparece cuando quiere. Este vive dentro de
 * la aplicacion: se abre cuando hace falta, ocupa lo que debe y usa los
 * mismos tokens que el resto del producto.
 *
 * No guarda estado: recibe el texto y emite el texto nuevo. Quien lo usa
 * decide donde vive ese valor.
 */
@Component({
  selector: 'wx-teclado',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="kb">
    <div class="kb__fila" *ngFor="let fila of filas">
      <button type="button" class="kb__tecla" *ngFor="let t of fila"
              (pointerdown)="pulsar($event, t)">{{ mostrar(t) }}</button>
    </div>
    <div class="kb__fila">
      <button type="button" class="kb__tecla kb__tecla--mod" [class.on]="mayus"
              (pointerdown)="alternarMayus($event)" aria-label="Mayúsculas">
        <i class="ph ph-arrow-fat-up"></i>
      </button>
      <button type="button" class="kb__tecla kb__tecla--espacio" (pointerdown)="pulsar($event, ' ')">espacio</button>
      <button type="button" class="kb__tecla kb__tecla--mod" (pointerdown)="borrar($event)" aria-label="Borrar">
        <i class="ph ph-backspace"></i>
      </button>
    </div>
  </div>
  `,
  styles: [`
    .kb { display: flex; flex-direction: column; gap: 6px; user-select: none; }
    .kb__fila { display: flex; gap: 6px; justify-content: center; }
    .kb__tecla {
      flex: 1 1 0;
      min-width: 0;
      min-height: 46px;
      display: grid;
      place-items: center;
      background: var(--wx-surface);
      border: 1px solid var(--wx-edge);
      border-radius: var(--wx-radius-sm);
      color: var(--wx-text);
      font-family: var(--wx-font);
      font-size: var(--wx-text-md);
      font-weight: 500;
      cursor: pointer;
      touch-action: manipulation;
      /* Solo transform y color: nada que provoque layout. */
      transition: transform var(--wx-dur-press) var(--wx-ease-out),
                  background-color var(--wx-dur-micro) ease;
    }
    .kb__tecla:active { transform: scale(0.94); background: var(--wx-accent-soft); }
    .kb__tecla--mod { flex: 0 0 66px; color: var(--wx-text-muted); font-size: 18px; }
    .kb__tecla--mod.on { background: var(--wx-accent); border-color: var(--wx-accent); color: var(--wx-accent-ink); }
    .kb__tecla--espacio { flex: 3 1 0; color: var(--wx-text-dim); font-size: var(--wx-text-sm); }
    @media (prefers-reduced-motion: reduce) { .kb__tecla { transition: background-color 1ms; } }
  `],
})
export class TecladoPantalla {
  @Input() valor = '';
  @Input() maximo = 120;
  @Output() valorChange = new EventEmitter<string>();

  mayus = false;

  readonly filas = [
    ['q','w','e','r','t','y','u','i','o','p'],
    ['a','s','d','f','g','h','j','k','l','ñ'],
    ['z','x','c','v','b','n','m',',','.'],
  ];

  mostrar(t: string): string {
    return this.mayus ? t.toUpperCase() : t;
  }

  /**
   * `pointerdown` en vez de `click`: responde en cuanto el dedo toca, sin
   * esperar a que se levante. En una caja se teclea rapido y esos 100 ms se
   * notan. `preventDefault` evita que el campo pierda el foco.
   */
  pulsar(e: Event, t: string) {
    e.preventDefault();
    if (this.valor.length >= this.maximo) return;
    const c = this.mayus ? t.toUpperCase() : t;
    this.valorChange.emit(this.valor + c);
    if (this.mayus) this.mayus = false;
  }

  borrar(e: Event) {
    e.preventDefault();
    this.valorChange.emit(this.valor.slice(0, -1));
  }

  alternarMayus(e: Event) {
    e.preventDefault();
    this.mayus = !this.mayus;
  }
}
