import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { NgClass, NgFor, NgIf } from '@angular/common';

/**
 * HX-MESITA — una mesa vista desde arriba, con sus sillas.
 *
 * Es el dibujo que hace que el salon parezca un salon y no una hoja de
 * calculo: una mesa de dos es pequena, una de ocho es larga, un banco de
 * barra es redondo. Las sillas se pintan del color del estado, asi que una
 * mesa ocupada «se ve ocupada» antes de leer ninguna palabra.
 *
 * Decorativa (`aria-hidden`): quien la usa ya dice en texto el nombre, el
 * estado y cuantas sillas tiene. Solo cajas con bordes redondeados; ni SVG ni
 * imagenes, asi que cambia de tema con los tokens como todo lo demas.
 */
@Component({
  selector: 'hx-mesita',
  standalone: true,
  imports: [NgIf, NgFor, NgClass],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <span class="mesita" aria-hidden="true"
        [ngClass]="['es-' + estado, 'mesita--' + tam]" [class.es-redonda]="n === 1"
        [style.--cols]="cols">
    <span class="mesita__fila"><i *ngFor="let _ of arriba"></i></span>
    <span class="mesita__medio">
      <span class="mesita__lado"><i *ngIf="izq"></i></span>
      <span class="mesita__tabla"><ng-content></ng-content></span>
      <span class="mesita__lado"><i *ngIf="der"></i></span>
    </span>
    <span class="mesita__fila"><i *ngFor="let _ of abajo"></i></span>
  </span>
  `,
  styles: [`
    :host { display: inline-flex; }
    .mesita {
      --u: var(--mesita-u, 14px);
      --silla: var(--wx-edge-strong);
      --tabla: var(--wx-raised);
      --borde: var(--wx-edge-strong);
      display: inline-flex; flex-direction: column; align-items: center;
      gap: calc(var(--u) * 0.2);
    }
    .mesita--md { --u: var(--mesita-u, 18px); }
    .mesita--lg { --u: var(--mesita-u, 22px); }

    .mesita__fila { display: flex; justify-content: center; gap: calc(var(--u) * 0.35); min-height: calc(var(--u) * 0.36); }
    .mesita__medio { display: flex; align-items: center; gap: calc(var(--u) * 0.2); }
    .mesita__lado { display: flex; width: calc(var(--u) * 0.36); justify-content: center; }

    .mesita__fila i, .mesita__lado i {
      display: block;
      background: var(--silla);
      border-radius: calc(var(--u) * 0.2);
      transition: background-color var(--wx-dur-state) var(--wx-ease-out);
    }
    .mesita__fila i { width: calc(var(--u) * 0.85); height: calc(var(--u) * 0.36); }
    .mesita__lado i { width: calc(var(--u) * 0.36); height: calc(var(--u) * 0.85); }

    .mesita__tabla {
      display: grid; place-items: center;
      width: calc(var(--cols, 1) * var(--u) * 1.2 + (var(--cols, 1) - 1) * var(--u) * 0.35);
      height: calc(var(--u) * 1.5);
      border-radius: calc(var(--u) * 0.32);
      background: var(--tabla);
      border: 1.5px solid var(--borde);
      color: var(--wx-text-muted);
      font-size: calc(var(--u) * 0.62); font-weight: 700; line-height: 1;
      transition: background-color var(--wx-dur-state) var(--wx-ease-out),
                  border-color var(--wx-dur-state) var(--wx-ease-out);
    }
    .es-redonda .mesita__tabla { width: calc(var(--u) * 1.5); border-radius: 50%; }

    .es-abierta { --silla: var(--wx-accent); --tabla: var(--wx-accent-soft); --borde: var(--wx-accent-line); }
    .es-por_cobrar { --silla: var(--wx-warning); --tabla: var(--wx-warning-soft); --borde: color-mix(in srgb, var(--wx-warning) 55%, transparent); }
    .es-abierta .mesita__tabla { color: var(--wx-accent-text); }
    .es-por_cobrar .mesita__tabla { color: var(--wx-warning-ink); }
  `],
})
export class MesitaComponent {
  /** 'libre' | 'abierta' | 'por_cobrar'. El tamano lo fija `tam`, o quien
      la usa con `--mesita-u` (el ancho de una silla). */
  @Input() estado = 'libre';
  @Input() tam: 'sm' | 'md' | 'lg' = 'md';

  n = 4;
  arriba: number[] = [0];
  abajo: number[] = [0];
  izq = true;
  der = true;
  cols = 1;

  /** Cuantas sillas. Sin dato, cuatro: la mesa que casi todos imaginan. */
  @Input() set sillas(v: number | null | undefined) {
    const n = Math.max(1, Math.min(12, Math.round(Number(v) || 4)));
    this.n = n;
    let arriba = 0, abajo = 0, izq = false, der = false;
    if (n <= 4) {
      /* Arriba, abajo, izquierda, derecha: en ese orden se sienta la gente. */
      abajo = 1;
      if (n >= 2) arriba = 1;
      if (n >= 3) izq = true;
      if (n >= 4) der = true;
    } else {
      izq = der = true;
      arriba = Math.ceil((n - 2) / 2);
      abajo = Math.floor((n - 2) / 2);
    }
    this.arriba = Array.from({ length: arriba }, (_, i) => i);
    this.abajo = Array.from({ length: abajo }, (_, i) => i);
    this.izq = izq;
    this.der = der;
    this.cols = Math.max(1, arriba, abajo);
  }
}
