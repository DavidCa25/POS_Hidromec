import { Component, Input } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { EstadoTabla, WxColumna } from './tabla-estado';

/**
 * La barra de [Filtrar por] [Agrupar por] [Columnas] de una tabla.
 *
 * No sabe nada de ninguna pantalla: recibe un `EstadoTabla` y las filas contra
 * las que ofrecer valores de filtro. Cada tabla sigue pintando sus celdas.
 *
 * Los tres paneles usan `popover` nativo -la misma primitiva de `wx-select` y
 * `wx-menu`-, asi que se pintan en el top layer y ningun `overflow: hidden` de
 * una cabecera puede recortarlos. Ese fue el defecto del menu de Exportar y no
 * conviene repetirlo.
 */
@Component({
  selector: 'wx-tabla-barra',
  standalone: true,
  imports: [NgFor, NgIf],
  templateUrl: './wx-tabla-barra.component.html',
  styleUrls: ['./wx-tabla-barra.component.css'],
})
export class WxTablaBarraComponent {
  /** El estado compartido. Lo crea la pantalla y lo conserva. */
  @Input({ required: true }) estado!: EstadoTabla;
  /**
   * Las filas YA buscadas, antes de filtrar. De aqui salen los valores que se
   * ofrecen en "Filtrar por": ofrecer un valor que no existe en la tabla seria
   * darle al usuario un filtro que no devuelve nada.
   */
  @Input() filas: any[] = [];

  /** Un id por instancia: `popovertarget` empareja por id. */
  private readonly sufijo = Math.random().toString(36).slice(2, 8);
  readonly idFiltrar = 'wxtb-f-' + this.sufijo;
  readonly idAgrupar = 'wxtb-g-' + this.sufijo;
  readonly idColumnas = 'wxtb-c-' + this.sufijo;
  readonly anclaFiltrar = '--a-' + this.idFiltrar;
  readonly anclaAgrupar = '--a-' + this.idAgrupar;
  readonly anclaColumnas = '--a-' + this.idColumnas;

  /** Solo se ofrecen columnas que de verdad tienen algo que filtrar. */
  get filtrables(): WxColumna[] { return this.estado.columnasFiltrables; }
  get agrupables(): WxColumna[] { return this.estado.columnasAgrupables; }

  opciones(c: WxColumna) { return this.estado.opcionesDeFiltro(c.clave, this.filas); }

  cerrar(id: string) {
    const el = document.getElementById(id) as any;
    if (el?.hidePopover && el.matches(':popover-open')) el.hidePopover();
  }

  elegirGrupo(clave: string | null) {
    this.estado.agruparPor(clave);
    this.cerrar(this.idAgrupar);
  }

  /** trackBy para que alternar un filtro no reconstruya toda la lista. */
  porClave = (_: number, c: WxColumna) => c.clave;
  porValor = (_: number, o: { valor: string }) => o.valor;
}
