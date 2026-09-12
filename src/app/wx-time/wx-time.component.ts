import { Component, forwardRef, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * Selector de hora de Wybix.
 *
 * Hermano de `wx-date`, por el mismo motivo y con la misma forma: el control
 * nativo `<input type="time">` lo pinta el sistema operativo, asi que ignora
 * los tokens, el modo oscuro y la tipografia, y en una pantalla de Wybix se
 * ve prestado de otra aplicacion.
 *
 * NO ES UN RELOJ ANALOGICO
 * ------------------------
 * Se descarto la esfera arrastrable: aqui se eligen horarios comerciales -"de
 * 2 a 4"-, no instantes exactos. Dos columnas de horas y minutos se recorren
 * mas rapido y funcionan igual con raton, teclado y pantalla tactil.
 *
 * Los minutos van de cinco en cinco porque ningun horario de promocion empieza
 * a las 14:07. Quien necesite un minuto suelto lo escribe: el campo acepta
 * texto y el desplegable es un atajo, no la unica via.
 *
 * Reemplazo directo de `<input type="time">`: habla 'HH:MM' por
 * ControlValueAccessor, asi que ningun `[(ngModel)]` cambia de tipo.
 */
@Component({
  selector: 'wx-time',
  standalone: true,
  imports: [CommonModule],
  providers: [{
    provide: NG_VALUE_ACCESSOR,
    useExisting: forwardRef(() => WxTimeComponent),
    multi: true,
  }],
  templateUrl: './wx-time.component.html',
  styleUrls: ['./wx-time.component.css'],
})
export class WxTimeComponent implements ControlValueAccessor {
  @Input() placeholder = 'Hora';
  @Input() limpiable = true;
  /** Paso de los minutos ofrecidos en la lista. */
  @Input() pasoMinutos = 5;

  /** Igual que wx-date: el ancla es por INSTANCIA, no por componente.
   *  Un nombre compartido hace que todos los paneles se abran sobre el mismo
   *  campo cuando hay varios en un formulario -y aqui siempre hay dos-. */
  readonly idPanel = 'wxtime-' + Math.random().toString(36).slice(2, 9);
  readonly ancla = '--ancla-' + this.idPanel;

  valor: string | null = null;          // 'HH:MM'
  deshabilitado = false;
  /** Lo que el usuario esta escribiendo a mano, sin normalizar todavia. */
  borrador = '';

  private alCambiar: (v: string | null) => void = () => {};
  private alTocar: () => void = () => {};

  // ------------------------------------------------ ControlValueAccessor
  writeValue(v: string | null) {
    this.valor = WxTimeComponent.normalizar(v);
    this.borrador = this.valor ?? '';
  }
  registerOnChange(fn: (v: string | null) => void) { this.alCambiar = fn; }
  registerOnTouched(fn: () => void) { this.alTocar = fn; }
  setDisabledState(v: boolean) { this.deshabilitado = v; }

  // -------------------------------------------------------- presentacion
  get etiqueta(): string {
    return this.valor ?? this.placeholder;
  }

  /** Las horas del dia, 00..23. */
  get horas(): string[] {
    return Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  }

  get minutos(): string[] {
    const paso = Math.max(1, Math.min(30, Number(this.pasoMinutos) || 5));
    const out: string[] = [];
    for (let m = 0; m < 60; m += paso) out.push(String(m).padStart(2, '0'));
    return out;
  }

  get horaSel(): string | null { return this.valor ? this.valor.slice(0, 2) : null; }
  get minSel(): string | null { return this.valor ? this.valor.slice(3, 5) : null; }

  // ------------------------------------------------------------ acciones
  elegirHora(h: string): void {
    // Sin minuto todavia se asume en punto: es lo que casi siempre se quiere
    // y deja el valor utilizable con un solo clic.
    this.aplicar(`${h}:${this.minSel ?? '00'}`);
  }

  elegirMinuto(m: string): void {
    this.aplicar(`${this.horaSel ?? '00'}:${m}`);
  }

  /**
   * Texto escrito a mano.
   *
   * Se acepta `9`, `9:5`, `930` o `09:30`. Quien teclea una hora no deberia
   * pelearse con el formato; normalizar es trabajo del control.
   */
  alEscribir(texto: string): void {
    this.borrador = texto;
    const n = WxTimeComponent.normalizar(texto);
    if (n !== null) this.aplicar(n, false);
    else if (!texto.trim()) this.aplicar(null, false);
  }

  alSalir(): void {
    this.borrador = this.valor ?? '';
    this.alTocar();
  }

  limpiar(ev?: Event): void {
    ev?.stopPropagation();
    ev?.preventDefault();
    this.aplicar(null);
  }

  private aplicar(v: string | null, sincronizarBorrador = true): void {
    this.valor = v;
    if (sincronizarBorrador) this.borrador = v ?? '';
    this.alCambiar(v);
  }

  /**
   * A 'HH:MM' o null.
   *
   * Acepta lo que devuelve SQL ('14:30:00'), lo que guarda el formulario
   * ('14:30') y lo que teclea una persona ('930', '9:5', '9').
   */
  static normalizar(v: unknown): string | null {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    if (!s) return null;

    let h: number, m: number;
    const conDosPuntos = s.match(/^(\d{1,2})\s*:\s*(\d{1,2})/);
    if (conDosPuntos) {
      h = Number(conDosPuntos[1]); m = Number(conDosPuntos[2]);
    } else if (/^\d{3,4}$/.test(s)) {
      h = Number(s.slice(0, s.length - 2)); m = Number(s.slice(-2));
    } else if (/^\d{1,2}$/.test(s)) {
      h = Number(s); m = 0;
    } else {
      return null;
    }
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
