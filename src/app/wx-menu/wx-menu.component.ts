import { Component, EventEmitter, Input, Output } from '@angular/core';
import { NgClass, NgFor, NgIf } from '@angular/common';

export interface WxMenuOpcion {
  valor: any;
  etiqueta: string;
  /** Clase del icono Phosphor, opcional. */
  icono?: string;
  nota?: string;
  desactivada?: boolean;
}

/**
 * Menu desplegable de acciones (Exportar, etc.).
 *
 * QUE SE ROMPIO
 * -------------
 * Los menus de "Exportar" eran un `<div>` con `position: absolute` dentro de
 * la cabecera de la pantalla. En Inventario esa cabecera tiene
 * `overflow: hidden` -para recortar su propio degradado-, asi que el menu
 * quedaba CORTADO: se alcanzaba a ver la primera opcion y la segunda no.
 *
 * No era un problema de z-index, y por eso subir el z-index no lo arreglaba
 * nunca: `overflow: hidden` recorta a sus descendientes posicionados
 * independientemente de la capa en la que esten.
 *
 * COMO SE RESUELVE
 * ----------------
 * Con la misma primitiva que ya usan `wx-select` y `wx-date`: `popover`
 * nativo. El panel se pinta en el TOP LAYER del navegador, fuera del flujo,
 * asi que ningun ancestro puede recortarlo ni taparlo. El anclaje al boton lo
 * hace CSS con `anchor-name` / `position-anchor`, y la deteccion de colision
 * -voltear arriba si no cabe abajo- viene de `position-try-fallbacks`.
 *
 * Ademas trae gratis el cierre por clic fuera y por Escape, con devolucion del
 * foco al disparador, que el `<div>` con `*ngIf` no tenia.
 */
@Component({
  selector: 'wx-menu',
  standalone: true,
  imports: [NgClass, NgFor, NgIf],
  templateUrl: './wx-menu.component.html',
  styleUrls: ['./wx-menu.component.css'],
})
export class WxMenuComponent {
  @Input() etiqueta = 'Acciones';
  /** Clase del icono del disparador. */
  @Input() icono = 'ph ph-dots-three';
  @Input() opciones: WxMenuOpcion[] = [];
  /**
   * Aspecto del disparador.
   *
   *   'sobre-color'  sobre una cabecera pintada con el acento (Inventario,
   *                  Ventas). El contraste viene del blanco, no del acento.
   *   'neutral'      sobre una superficie normal.
   *
   * POR QUE NO HEREDA LA CLASE DE LA PANTALLA
   * -----------------------------------------
   * Al principio este boton usaba `castrol-btn-color`, la clase de cada
   * pantalla. No funciona: Angular encapsula los estilos por componente, asi
   * que una regla escrita en `inventario.css` NO alcanza a un boton que se
   * pinta dentro de la plantilla de `wx-menu`. El boton se quedaba sin
   * ninguna regla y salia con el gris por defecto del navegador.
   *
   * El disparador trae su propio estilo, con los mismos valores que ya usaban
   * esas cabeceras. `claseBoton` sigue existiendo para casos puntuales.
   */
  @Input() variante: 'sobre-color' | 'neutral' = 'sobre-color';
  /** Clase extra opcional, si una pantalla necesita algo propio. */
  @Input() claseBoton = '';
  @Input() deshabilitado = false;
  /** Oculta el texto del disparador y deja solo el icono. */
  @Input() soloIcono = false;

  @Output() elegir = new EventEmitter<any>();

  /**
   * Un id por instancia: `popovertarget` empareja por id, y dos menus en la
   * misma pantalla con el mismo id abririan el panel equivocado.
   */
  readonly idPanel = 'wxmenu-' + Math.random().toString(36).slice(2, 9);
  readonly ancla = '--ancla-' + this.idPanel;

  elegirOpcion(o: WxMenuOpcion) {
    if (o.desactivada) return;
    this.cerrar();
    this.elegir.emit(o.valor);
  }

  private cerrar() {
    const el = document.getElementById(this.idPanel) as any;
    if (el?.hidePopover && el.matches(':popover-open')) el.hidePopover();
  }
}
