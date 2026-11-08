import { AfterViewInit, Component, ElementRef, EventEmitter, Input, Output, inject } from '@angular/core';
import { CurrencyPipe, NgFor, NgIf } from '@angular/common';
import { ModifierGroup, ModifierOption } from '../../core/menu-catalog.service';
import { SelectedOption } from '../../core/models';
import {
  Elegida, aSeleccionada, admiteCantidad, cabeOtra, minimoDe, opcionesElegibles,
  precioDeOpciones, topeDeGrupo, unidadesElegidas,
} from '../../core/opciones';

/**
 * LAS OPCIONES DE UN PRODUCTO EN RETAIL — «Latte: tamaño, leche, extras».
 *
 * Dos paneles: a la izquierda los grupos, con lo que les falta; a la derecha
 * las opciones del grupo abierto, como tarjetas que se tocan. Abajo, lo que va
 * elegido y el precio con todo.
 *
 * Sustituye a la hoja de SweetAlert con radios, casillas y un campo de número
 * por opción. Lo que decide (qué grupos salen, cuánto cabe, cuánto suma) sigue
 * siendo `core/opciones`, el mismo que usa Touch: aquí solo cambia cómo se
 * pinta.
 *
 *   - Grupo de una sola opción (tamaño, leche): tocar elige y sustituye; si
 *     el grupo es obligatorio, se pasa solo al siguiente que falte.
 *   - Grupo de varias: tocar agrega; las que suman consumo (shot extra)
 *     llevan − / + y el tope se cuenta en UNIDADES, igual que en Touch.
 *   - Teclado: flechas arriba/abajo cambian de grupo, Enter agrega, Esc cancela.
 */
@Component({
  selector: 'app-opciones-producto',
  standalone: true,
  imports: [NgIf, NgFor, CurrencyPipe],
  templateUrl: './opciones-producto.component.html',
  styleUrls: ['./opciones-producto.component.css'],
})
export class OpcionesProductoComponent implements AfterViewInit {
  private readonly host = inject(ElementRef<HTMLElement>);
  @Input() nombre = '';
  @Input() precioBase = 0;
  @Input() grupos: ModifierGroup[] = [];

  @Output() aceptar = new EventEmitter<SelectedOption[]>();
  @Output() cancelar = new EventEmitter<void>();

  /** El grupo que se ve a la derecha. */
  activo = 0;
  /** Lo elegido por grupo, con cantidad. */
  private readonly elegidas = new Map<number, Elegida[]>();
  aviso: string | null = null;

  /** El foco entra a la ventana: Esc, Enter y flechas funcionan sin clic. */
  ngAfterViewInit() { this.host.nativeElement.querySelector('.op')?.focus(); }

  get grupo(): ModifierGroup | null { return this.grupos[this.activo] ?? null; }

  opciones(g: ModifierGroup): ModifierOption[] { return opcionesElegibles(g); }

  // ------------------------------------------------------------ lectura

  cantidadDe(g: ModifierGroup, o: ModifierOption): number {
    return (this.elegidas.get(g.id) || []).find(e => e.optionId === o.id)?.quantity ?? 0;
  }
  esUnico(g: ModifierGroup): boolean { return topeDeGrupo(g) <= 1; }
  conCantidad(g: ModifierGroup): boolean { return !this.esUnico(g) && admiteCantidad(g); }
  completo(g: ModifierGroup): boolean { return unidadesElegidas(this.elegidas.get(g.id)) >= minimoDe(g); }
  cabeOtra(g: ModifierGroup, o: ModifierOption): boolean { return cabeOtra(g, this.elegidas.get(g.id), o.id); }

  /** La regla del grupo en pocas palabras: «elige 1», «hasta 3», «2/3». */
  regla(g: ModifierGroup): string {
    const tope = topeDeGrupo(g), min = minimoDe(g), n = unidadesElegidas(this.elegidas.get(g.id));
    if (tope > 1) return n ? `${n}/${tope}` : `hasta ${tope}`;
    if (min > 0) return n ? '' : 'elige 1';
    return 'opcional';
  }

  /** Lo que va elegido, en el orden de los grupos. */
  get seleccion(): SelectedOption[] {
    const out: SelectedOption[] = [];
    for (const g of this.grupos) {
      for (const e of this.elegidas.get(g.id) || []) {
        const o = opcionesElegibles(g).find(x => x.id === e.optionId);
        if (o) out.push({ ...aSeleccionada(g, o), quantity: admiteCantidad(g) ? (e.quantity ?? 1) : 1 });
      }
    }
    return out;
  }
  get resumen(): string {
    return this.seleccion.map(s => (s.quantity ?? 1) > 1 ? `${s.optionName} ×${s.quantity}` : s.optionName).join(' · ');
  }
  get total(): number { return Math.round((this.precioBase + precioDeOpciones(this.seleccion)) * 100) / 100; }
  get faltan(): ModifierGroup[] { return this.grupos.filter(g => !this.completo(g)); }

  // ------------------------------------------------------------ acciones

  abrir(i: number) { this.activo = i; this.aviso = null; }

  /** Tocar una tarjeta: en grupo único elige; en varios, agrega o quita. */
  tocar(g: ModifierGroup, o: ModifierOption) {
    this.aviso = null;
    const lista = this.elegidas.get(g.id) || [];
    if (this.esUnico(g)) {
      const yaEra = lista.some(e => e.optionId === o.id);
      /* Un opcional se puede desmarcar; un obligatorio solo se cambia. */
      this.elegidas.set(g.id, yaEra && minimoDe(g) === 0 ? [] : [{ optionId: o.id, quantity: 1 }]);
      if (!yaEra) this.siguienteQueFalta();
      return;
    }
    if (lista.some(e => e.optionId === o.id)) {
      this.elegidas.set(g.id, lista.filter(e => e.optionId !== o.id));
      return;
    }
    if (!cabeOtra(g, lista, o.id)) { this.aviso = `${g.name}: máximo ${topeDeGrupo(g)}.`; return; }
    this.elegidas.set(g.id, [...lista, { optionId: o.id, quantity: 1 }]);
  }

  sumar(g: ModifierGroup, o: ModifierOption, d: 1 | -1, ev: Event) {
    ev.stopPropagation();
    this.aviso = null;
    const lista = this.elegidas.get(g.id) || [];
    const e = lista.find(x => x.optionId === o.id);
    if (!e) return;
    if (d > 0 && !cabeOtra(g, lista, o.id)) { this.aviso = `${g.name}: máximo ${topeDeGrupo(g)}.`; return; }
    const n = (e.quantity ?? 1) + d;
    this.elegidas.set(g.id, n <= 0
      ? lista.filter(x => x.optionId !== o.id)
      : lista.map(x => x.optionId === o.id ? { ...x, quantity: n } : x));
  }

  /** Tras elegir en un grupo obligatorio, ir al siguiente que falte. */
  private siguienteQueFalta() {
    const g = this.grupo;
    if (!g || minimoDe(g) === 0) return;
    const i = this.grupos.findIndex((x, k) => k > this.activo && !this.completo(x));
    if (i >= 0) this.activo = i;
  }

  confirmar() {
    const falta = this.faltan[0];
    if (falta) {
      this.activo = this.grupos.indexOf(falta);
      this.aviso = `Falta elegir: ${this.faltan.map(g => g.name).join(', ')}.`;
      return;
    }
    this.aceptar.emit(this.seleccion);
  }

  teclado(ev: KeyboardEvent) {
    if (ev.key === 'Escape') { ev.preventDefault(); this.cancelar.emit(); return; }
    if (ev.key === 'Enter' && !(ev.target as HTMLElement)?.closest('button')) { ev.preventDefault(); this.confirmar(); return; }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const n = this.grupos.length;
      this.abrir((this.activo + (ev.key === 'ArrowDown' ? 1 : n - 1)) % n);
    }
  }
}
