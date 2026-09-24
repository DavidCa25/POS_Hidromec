import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { ModoNavegacion } from './navegacion.service';

let secuencia = 0;

/**
 * EL TIRADOR DEL BORDE.
 *
 * Cambia entre dock y barra lateral. No es un boton flotante: es una pestana
 * del mismo navy que el rail, pegada al borde del que sale lo que va a
 * aparecer.
 *
 *   Con dock      vive en el borde izquierdo de la ventana, que es de donde
 *                 entrara la barra.
 *   Con barra     vive en el borde derecho de la propia barra, que es hacia
 *                 donde se repliega.
 *
 * En reposo apenas asoma. Al acercarse el cursor, o al llegar con el teclado,
 * sale del todo y ensena la GEOMETRIA DEL DESTINO: una pantalla pequena con
 * la franja lateral o la barra de abajo. Asi dice a donde lleva sin una
 * palabra, y el tooltip lo confirma con una.
 *
 * Sin raton (una caja tactil) no hay «acercarse»: la pestana se queda asomada
 * y se pulsa con el dedo.
 */
@Component({
  selector: 'wx-nav-modo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="wxmodo" [class.es-dock]="desde === 'dock'" [class.es-sidebar]="desde === 'sidebar'"
            [attr.aria-label]="etiqueta" [attr.aria-describedby]="idTip"
            (click)="cambiar.emit()">
      <span class="wxmodo__pestana" aria-hidden="true">
        <span class="wxmodo__glifo">
          <span class="wxmodo__pantalla"><span class="wxmodo__franja"></span></span>
          <i class="ph wxmodo__flecha" [class.ph-caret-right]="desde === 'dock'"
             [class.ph-caret-left]="desde === 'sidebar'"></i>
        </span>
      </span>
      <span class="wxmodo__tip" role="tooltip" [id]="idTip">{{ etiqueta }}</span>
    </button>
  `,
  styleUrls: ['./wx-nav-modo.component.css'],
})
export class WxNavModoComponent {
  /** Desde que modo se pulsa. Lleva al otro. */
  @Input({ required: true }) desde!: ModoNavegacion;
  @Output() cambiar = new EventEmitter<void>();

  readonly idTip = `wxmodo-tip-${++secuencia}`;

  get etiqueta(): string {
    return this.desde === 'dock' ? 'Usar menú lateral' : 'Usar Dock';
  }
}
