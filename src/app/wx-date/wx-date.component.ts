import { Component, ElementRef, forwardRef, Input, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * Calendario de Wybix.
 *
 * POR QUE NO UNA DEPENDENCIA
 * `pick-ui-library` no aplica: su lista curada es integramente de React
 * (base-ui, cmdk, Sonner...) y esta aplicacion es Angular. De las opciones
 * reales para Angular, Material arrastra `@angular/material` + `@angular/cdk`
 * enteros por un calendario, que era justo lo que el encargo descartaba; y
 * una libreria generica hay que reestilarla igualmente para que respete los
 * tokens, con lo que el trabajo no desaparece, solo cambia de sitio.
 *
 * El calendario en si es una rejilla de 42 celdas. Lo que suele justificar la
 * dependencia -posicionamiento, deteccion de colision, cierre al hacer clic
 * fuera, Escape y devolucion del foco- ya lo resuelve la primitiva `.wx-pop`
 * con popover nativo y anclaje CSS. Asi que aqui son 0 kB.
 *
 * Es un reemplazo directo de `<input type="date">`: implementa
 * ControlValueAccessor y habla el mismo formato 'YYYY-MM-DD', de modo que
 * ningun `[(ngModel)]` existente cambia de tipo ni de valor.
 */
@Component({
  selector: 'wx-date',
  standalone: true,
  imports: [CommonModule],
  providers: [{
    provide: NG_VALUE_ACCESSOR,
    useExisting: forwardRef(() => WxDateComponent),
    multi: true,
  }],
  templateUrl: './wx-date.component.html',
  styleUrls: ['./wx-date.component.css'],
})
export class WxDateComponent implements ControlValueAccessor {
  @Input() placeholder = 'Seleccionar fecha';
  @Input() limpiable = true;
  /** Limites opcionales, en 'YYYY-MM-DD'. */
  @Input() min?: string;
  @Input() max?: string;

  @ViewChild('panel') panel?: ElementRef<HTMLElement>;

  /** Identificador propio: el popover se enlaza por id y puede haber varios. */
  readonly idPanel = 'wxcal-' + Math.random().toString(36).slice(2, 9);
  /** Nombre de ancla propio de ESTA instancia.
   *
   * Vivia en el CSS del componente, y por tanto era el mismo para todas las
   * instancias. Cuando un formulario tenia varios, el nombre repetido resolvia
   * -por especificacion- al ULTIMO del arbol, asi que todos los paneles se
   * abrian sobre el mismo campo. En el modal de producto eso mandaba el menu a
   * otro punto de la pantalla. El anclaje es una relacion entre dos elementos
   * concretos, no un estilo compartido: el nombre tiene que ser unico. */
  readonly ancla = '--ancla-' + this.idPanel;

  valor: string | null = null;          // 'YYYY-MM-DD'
  deshabilitado = false;

  /** Mes que se esta mostrando. */
  cursor = new Date();
  /** Dia enfocado por teclado dentro de la rejilla. */
  focado: Date | null = null;

  readonly diasSemana = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  private readonly meses = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];

  private alCambiar: (v: string | null) => void = () => {};
  private alTocar: () => void = () => {};

  // ---------------------------------------------------------- ControlValueAccessor
  writeValue(v: string | null) {
    this.valor = this.normalizar(v);
    if (this.valor) this.cursor = this.aFecha(this.valor)!;
  }
  registerOnChange(fn: (v: string | null) => void) { this.alCambiar = fn; }
  registerOnTouched(fn: () => void) { this.alTocar = fn; }
  setDisabledState(v: boolean) { this.deshabilitado = v; }

  // ---------------------------------------------------------- presentacion
  get etiqueta(): string {
    const f = this.aFecha(this.valor);
    if (!f) return this.placeholder;
    // Formato corto de es-MX: 04/09/2026.
    return f.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  get tituloMes(): string {
    return `${this.meses[this.cursor.getMonth()]} ${this.cursor.getFullYear()}`;
  }

  /**
   * Las 42 celdas del mes visible (6 semanas), empezando en lunes, que es la
   * convencion en Mexico. Se incluyen los dias de los meses vecinos para que
   * la rejilla no cambie de alto al pasar de mes: si el alto bailara, el panel
   * daria un salto en cada navegacion.
   */
  get celdas(): Array<{ fecha: Date; fuera: boolean; hoy: boolean; sel: boolean; off: boolean }> {
    const anio = this.cursor.getFullYear();
    const mes = this.cursor.getMonth();
    const primero = new Date(anio, mes, 1);
    // getDay(): 0 = domingo. Se desplaza para que el lunes sea la columna 0.
    const desplazamiento = (primero.getDay() + 6) % 7;
    const inicio = new Date(anio, mes, 1 - desplazamiento);

    const hoy = this.soloDia(new Date());
    const sel = this.aFecha(this.valor);
    const selDia = sel ? this.soloDia(sel).getTime() : -1;

    const out = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i);
      const t = this.soloDia(d).getTime();
      out.push({
        fecha: d,
        fuera: d.getMonth() !== mes,
        hoy: t === hoy.getTime(),
        sel: t === selDia,
        off: this.fueraDeRango(d),
      });
    }
    return out;
  }

  esFocado(d: Date): boolean {
    const f = this.focado ?? this.aFecha(this.valor) ?? new Date();
    return this.soloDia(f).getTime() === this.soloDia(d).getTime();
  }

  // ---------------------------------------------------------- interaccion
  mesAnterior() { this.cursor = new Date(this.cursor.getFullYear(), this.cursor.getMonth() - 1, 1); }
  mesSiguiente() { this.cursor = new Date(this.cursor.getFullYear(), this.cursor.getMonth() + 1, 1); }

  elegir(d: Date) {
    if (this.fueraDeRango(d)) return;
    this.valor = this.aTexto(d);
    this.alCambiar(this.valor);
    this.alTocar();
    this.cerrar();
  }

  irHoy() {
    const h = new Date();
    this.cursor = new Date(h.getFullYear(), h.getMonth(), 1);
    this.focado = h;
    if (!this.fueraDeRango(h)) this.elegir(h);
  }

  limpiar(e: Event) {
    e.stopPropagation();
    this.valor = null;
    this.alCambiar(null);
    this.alTocar();
  }

  alAbrirCerrar(e: { newState?: string }) {
    if (e?.newState === 'open') {
      this.cursor = this.aFecha(this.valor) ?? new Date();
      this.focado = this.aFecha(this.valor) ?? new Date();
    } else {
      this.alTocar();
    }
  }

  /**
   * Navegacion con teclado sobre la rejilla, la misma que ofrece el control
   * nativo: flechas por dia y semana, RePag/AvPag por mes, Inicio/Fin por
   * semana, Enter o Espacio para elegir.
   */
  alPulsar(e: KeyboardEvent) {
    const base = this.focado ?? this.aFecha(this.valor) ?? new Date();
    let d: Date | null = null;
    switch (e.key) {
      case 'ArrowLeft':  d = this.sumarDias(base, -1); break;
      case 'ArrowRight': d = this.sumarDias(base, 1); break;
      case 'ArrowUp':    d = this.sumarDias(base, -7); break;
      case 'ArrowDown':  d = this.sumarDias(base, 7); break;
      case 'Home':       d = this.sumarDias(base, -((base.getDay() + 6) % 7)); break;
      case 'End':        d = this.sumarDias(base, 6 - ((base.getDay() + 6) % 7)); break;
      case 'PageUp':     d = new Date(base.getFullYear(), base.getMonth() - 1, base.getDate()); break;
      case 'PageDown':   d = new Date(base.getFullYear(), base.getMonth() + 1, base.getDate()); break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        this.elegir(base);
        return;
      default: return;
    }
    e.preventDefault();
    this.focado = d;
    // Si el dia enfocado cae en otro mes, el calendario le sigue.
    if (d.getMonth() !== this.cursor.getMonth() || d.getFullYear() !== this.cursor.getFullYear()) {
      this.cursor = new Date(d.getFullYear(), d.getMonth(), 1);
    }
  }

  private cerrar() {
    const el = document.getElementById(this.idPanel) as any;
    if (el?.hidePopover && el.matches(':popover-open')) el.hidePopover();
  }

  // ---------------------------------------------------------- utilidades
  private soloDia(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  private sumarDias(d: Date, n: number) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }

  private fueraDeRango(d: Date): boolean {
    const t = this.soloDia(d).getTime();
    const mn = this.aFecha(this.min ?? null);
    const mx = this.aFecha(this.max ?? null);
    if (mn && t < this.soloDia(mn).getTime()) return true;
    if (mx && t > this.soloDia(mx).getTime()) return true;
    return false;
  }

  private normalizar(v: string | null): string | null {
    if (!v) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }

  /**
   * 'YYYY-MM-DD' -> Date LOCAL.
   * `new Date('2026-09-04')` se interpreta como UTC y en Mexico retrocede un
   * dia; por eso se construye con los componentes por separado.
   */
  private aFecha(v: string | null): Date | null {
    const s = this.normalizar(v);
    if (!s) return null;
    const [a, m, d] = s.split('-').map(Number);
    return new Date(a, m - 1, d);
  }

  private aTexto(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
}
