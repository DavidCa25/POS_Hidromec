import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ilustracionDe, type Giro } from '../../../shared/ilustraciones';

let siguiente = 0;

/**
 * <wx-ilustracion>: el dibujo de un producto que NO tiene foto.
 *
 * La foto del cliente siempre manda: este componente solo se pinta en su
 * lugar cuando no hay `thumb`. La forma y el color salen de
 * `shared/ilustraciones.ts` (nombre → categoría → giro), deterministas por id:
 * el mismo producto se ve igual en todas las cajas y todas las veces.
 *
 * SVG en línea, sin red ni almacenamiento: no pesa en la base ni en la
 * sincronización. Estático: no anima, así que no hay nada que apagar con
 * movimiento reducido.
 *
 *   <wx-ilustracion [nombre]="p.product_name" [categoria]="p.category_name"
 *                   [productoId]="p.id" [giro]="caps.businessProfile()" />
 */
@Component({
  selector: 'wx-ilustracion',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'wx-ilustracion', '[attr.data-forma]': 'dibujo().forma' },
  styles: [`:host { display: block; width: 100%; height: 100%; } svg { display: block; width: 100%; height: 100%; }`],
  template: `
    @let d = dibujo();
    <svg viewBox="0 0 192 192" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"
         [style.--fondo-centro]="d.fondoArriba">
      <defs>
        <linearGradient [attr.id]="idFondo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" [attr.stop-color]="d.fondoArriba" />
          <stop offset="1" [attr.stop-color]="d.fondoAbajo" />
        </linearGradient>
      </defs>
      <rect width="192" height="192" [attr.fill]="'url(#' + idFondo + ')'" />
      @for (z of d.trazos; track $index) {
        @switch (z.t) {
          @case ('r') { <rect [attr.x]="z.x" [attr.y]="z.y" [attr.width]="z.w" [attr.height]="z.h" [attr.rx]="z.r || 0" [attr.fill]="z.f" /> }
          @case ('c') { <circle [attr.cx]="z.x" [attr.cy]="z.y" [attr.r]="z.r" [attr.fill]="z.f" /> }
          @case ('e') { <ellipse [attr.cx]="z.x" [attr.cy]="z.y" [attr.rx]="z.rx" [attr.ry]="z.ry" [attr.fill]="z.f"
                                 [attr.transform]="z.rot ? 'rotate(' + (z.rot * 57.2958) + ' ' + z.x + ' ' + z.y + ')' : null" /> }
          @case ('p') { <path [attr.d]="z.d" [attr.fill]="z.f" /> }
          @case ('l') { <path [attr.d]="z.d" fill="none" [attr.stroke]="z.s" [attr.stroke-width]="z.w" stroke-linecap="round" stroke-linejoin="round" /> }
        }
      }
    </svg>
  `,
})
export class WxIlustracionComponent {
  readonly nombre = input.required<string>();
  readonly categoria = input<string | null | undefined>(null);
  readonly productoId = input<number | null | undefined>(null);
  readonly giro = input<Giro | null | undefined>(null);
  /** Preset de servicios (TALLER_AUTOMOTRIZ, BELLEZA, …): el respaldo de su giro. */
  readonly preset = input<string | null | undefined>(null);
  readonly inventario = input<string | null | undefined>(null);

  /** Id del degradado único por instancia (contador, no azar). */
  readonly idFondo = `wx-ilu-${++siguiente}`;

  readonly dibujo = computed(() => ilustracionDe({
    id: this.productoId(), nombre: this.nombre(), categoria: this.categoria(),
    giro: this.giro(), preset: this.preset(), inventario: this.inventario(),
  }));
}
