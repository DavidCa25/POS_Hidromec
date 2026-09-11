import { Component, ElementRef, forwardRef, Input, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';

export interface WxOpcion {
  valor: any;
  etiqueta: string;
  /** Segunda linea o texto a la derecha (saldo, clave, telefono...). */
  nota?: string;
  /** Texto extra por el que se puede buscar sin mostrarlo. */
  busca?: string;
  desactivada?: boolean;
}

/**
 * Select y combobox de Wybix.
 *
 * Sustituye a los `<select>` nativos de los flujos principales, que se veian
 * prestados del sistema operativo y no admitian ni el tipo ni los colores del
 * resto de la aplicacion.
 *
 * Con `buscable` se comporta como combobox: filtra sobre las opciones que YA
 * estan en memoria. No consulta nada ni cambia de donde salen los datos.
 *
 * Igual que el calendario, se apoya en la primitiva `.wx-pop`: el popover
 * nativo aporta top layer, cierre al hacer clic fuera, Escape y devolucion del
 * foco, y el anclaje CSS aporta la deteccion de colision.
 */
@Component({
  selector: 'wx-select',
  standalone: true,
  imports: [CommonModule, FormsModule],
  providers: [{
    provide: NG_VALUE_ACCESSOR,
    useExisting: forwardRef(() => WxSelectComponent),
    multi: true,
  }],
  templateUrl: './wx-select.component.html',
  styleUrls: ['./wx-select.component.css'],
})
export class WxSelectComponent implements ControlValueAccessor {
  @Input() opciones: WxOpcion[] = [];
  @Input() placeholder = 'Seleccionar';
  @Input() buscable = false;
  @Input() textoBusqueda = 'Buscar...';
  @Input() vacio = 'Sin resultados';

  @ViewChild('busqueda') campoBusqueda?: ElementRef<HTMLInputElement>;

  readonly idPanel = 'wxsel-' + Math.random().toString(36).slice(2, 9);
  /** Nombre de ancla propio de ESTA instancia.
   *
   * Vivia en el CSS del componente, y por tanto era el mismo para todas las
   * instancias. Cuando un formulario tenia varios, el nombre repetido resolvia
   * -por especificacion- al ULTIMO del arbol, asi que todos los paneles se
   * abrian sobre el mismo campo. En el modal de producto eso mandaba el menu a
   * otro punto de la pantalla. El anclaje es una relacion entre dos elementos
   * concretos, no un estilo compartido: el nombre tiene que ser unico. */
  readonly ancla = '--ancla-' + this.idPanel;

  valor: any = null;
  deshabilitado = false;
  filtro = '';
  /** Opcion resaltada por teclado. */
  indice = 0;

  private alCambiar: (v: any) => void = () => {};
  private alTocar: () => void = () => {};
  /** Buffer de escritura rapida para el select no buscable. */
  private tecleo = '';
  private tecleoTimer: any;

  // ---------------------------------------------------------- CVA
  writeValue(v: any) { this.valor = v; }
  registerOnChange(fn: (v: any) => void) { this.alCambiar = fn; }
  registerOnTouched(fn: () => void) { this.alTocar = fn; }
  setDisabledState(v: boolean) { this.deshabilitado = v; }

  // ---------------------------------------------------------- presentacion
  get seleccionada(): WxOpcion | undefined {
    return this.opciones.find(o => this.mismoValor(o.valor, this.valor));
  }
  get etiqueta(): string { return this.seleccionada?.etiqueta ?? this.placeholder; }

  get visibles(): WxOpcion[] {
    const q = this.filtro.trim().toLowerCase();
    if (!q) return this.opciones;
    // Se busca por etiqueta y por el texto adicional (telefono, correo...).
    return this.opciones.filter(o =>
      (o.etiqueta + ' ' + (o.nota ?? '') + ' ' + (o.busca ?? '')).toLowerCase().includes(q));
  }

  esSeleccionada(o: WxOpcion) { return this.mismoValor(o.valor, this.valor); }

  elegirPuntero(e: PointerEvent, o: WxOpcion) {
    if (e.button !== 0 || o.desactivada) return;

    // En Electron/Chromium el popover puede consumir el click posterior.
    // Seleccionamos en pointerdown, que sí llega de forma consistente.
    e.preventDefault();
    this.elegir(o);
  }

  elegirClick(e: MouseEvent, o: WxOpcion) {
    // Conserva activación por teclado / accesibilidad.
    // Un click físico ya fue procesado en pointerdown.
    if (e.detail === 0) this.elegir(o);
  }

  // ---------------------------------------------------------- interaccion
  elegir(o: WxOpcion) {
    if (o.desactivada) return;
    this.valor = o.valor;
    this.alCambiar(o.valor);
    this.alTocar();
    this.cerrar();
  }

  alAbrirCerrar(e: { newState?: string }) {
    if (e?.newState === 'open') {
      this.filtro = '';
      this.indice = Math.max(0, this.visibles.findIndex(o => this.esSeleccionada(o)));
      if (this.buscable) {
        // El foco al campo de busqueda debe esperar a que el popover exista.
        setTimeout(() => this.campoBusqueda?.nativeElement.focus(), 0);
      }
    } else {
      this.alTocar();
    }
  }

  alPulsar(e: KeyboardEvent) {
    const lista = this.visibles;
    if (!lista.length) return;
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); this.indice = Math.min(this.indice + 1, lista.length - 1); break;
      case 'ArrowUp':   e.preventDefault(); this.indice = Math.max(this.indice - 1, 0); break;
      case 'Home':      e.preventDefault(); this.indice = 0; break;
      case 'End':       e.preventDefault(); this.indice = lista.length - 1; break;
      case 'Enter':     e.preventDefault(); this.elegir(lista[this.indice]); return;
      default:
        // Escritura rapida: solo tiene sentido cuando no hay campo de busqueda,
        // porque si lo hay las letras deben ir al campo.
        if (!this.buscable && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
          this.porTecleo(e.key, lista);
        }
        return;
    }
    this.desplazarAlIndice();
  }

  alFiltrar() { this.indice = 0; }

  private porTecleo(letra: string, lista: WxOpcion[]) {
    clearTimeout(this.tecleoTimer);
    this.tecleo += letra.toLowerCase();
    this.tecleoTimer = setTimeout(() => { this.tecleo = ''; }, 600);
    const i = lista.findIndex(o => o.etiqueta.toLowerCase().startsWith(this.tecleo));
    if (i >= 0) { this.indice = i; this.desplazarAlIndice(); }
  }

  private desplazarAlIndice() {
    setTimeout(() => {
      const panel = document.getElementById(this.idPanel);
      panel?.querySelectorAll('.wx-opt')[this.indice]
        ?.scrollIntoView({ block: 'nearest' });
    }, 0);
  }

  private cerrar() {
    const el = document.getElementById(this.idPanel) as any;
    if (el?.hidePopover && el.matches(':popover-open')) el.hidePopover();
  }

  /** Compara sin exigir identidad: los ids pueden llegar como texto o numero. */
  private mismoValor(a: any, b: any) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    return String(a) === String(b);
  }
}
