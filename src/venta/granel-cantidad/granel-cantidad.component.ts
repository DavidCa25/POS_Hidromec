import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CurrencyPipe, NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WxFlechasDirective } from '../../app/wx-flechas/wx-flechas.directive';

/**
 * ¿CUÁNTO? — la cantidad de un producto a granel.
 *
 * En una tienda el jamón, el queso o el frijol no se venden «uno»: se piden
 * por peso («un cuarto») o por dinero («deme 50 pesos»). Esta ventana sale al
 * agregar un producto que se vende por peso o medida, y otra vez con Enter
 * sobre su renglón para corregirlo.
 *
 *   - Cantidad e Importe están ligados: se escribe uno y se calcula el otro.
 *   - La base guarda 2 decimales: «$50 de jamón a $138» son 0.36 kg y se
 *     cobran $49.68. Se enseña lo que DE VERDAD se cobra, nunca un importe que
 *     no corresponde a la cantidad.
 *   - «250 g», «250g» o «.250» se entienden como 0.25 kg.
 *   - Todo con teclado: el foco empieza en Cantidad, Enter agrega, Esc cancela
 *     y las flechas llegan a los botones.
 */
@Component({
  selector: 'app-granel-cantidad',
  standalone: true,
  imports: [NgIf, NgFor, FormsModule, CurrencyPipe, WxFlechasDirective],
  templateUrl: './granel-cantidad.component.html',
  styleUrls: ['./granel-cantidad.component.css'],
})
export class GranelCantidadComponent implements OnInit {
  @Input() nombre = '';
  @Input() precio = 0;
  /** Unidad base del producto: kg, g, L, ml... */
  @Input() uom: string | null = 'kg';
  @Input() cantidadInicial: number | null = null;

  @Output() aceptar = new EventEmitter<number>();
  @Output() cancelar = new EventEmitter<void>();

  cantidadTexto = '';
  importeTexto = '';
  /** Desde qué campo se escribió por última vez: el otro se calcula. */
  private origen: 'cantidad' | 'importe' = 'cantidad';
  error: string | null = null;

  get unidad(): string { return this.uom || 'kg'; }

  /** Atajos de lo que más se pide. Solo para kilo y litro. */
  get rapidos(): { texto: string; valor: number }[] {
    const u = this.unidad.toLowerCase();
    if (u !== 'kg' && u !== 'l') return [];
    const s = u === 'kg' ? 'kg' : 'L';
    return [
      { texto: `¼ ${s}`, valor: 0.25 },
      { texto: `½ ${s}`, valor: 0.5 },
      { texto: `¾ ${s}`, valor: 0.75 },
      { texto: `1 ${s}`, valor: 1 },
    ];
  }

  ngOnInit() {
    const q = this.cantidadInicial ?? 1;
    this.cantidadTexto = GranelCantidadComponent.formato(q);
    this.importeTexto = (q * this.precio).toFixed(2);
  }

  /** La cantidad que se va a cobrar, ya con 2 decimales; null si no es válida. */
  get cantidad(): number | null {
    if (this.origen === 'importe') {
      const imp = GranelCantidadComponent.numero(this.importeTexto);
      if (imp == null || imp <= 0 || !(this.precio > 0)) return null;
      return GranelCantidadComponent.redondear(imp / this.precio);
    }
    return GranelCantidadComponent.leerCantidad(this.cantidadTexto, this.unidad);
  }

  get importe(): number | null {
    const q = this.cantidad;
    return q == null ? null : Math.round(q * this.precio * 100) / 100;
  }

  /** Por dinero, lo pedido y lo cobrado pueden diferir unos centavos. */
  get diferenciaPorRedondeo(): boolean {
    if (this.origen !== 'importe') return false;
    const pedido = GranelCantidadComponent.numero(this.importeTexto);
    return pedido != null && this.importe != null && Math.abs(pedido - this.importe) >= 0.01;
  }

  alEscribirCantidad(t: string) {
    this.cantidadTexto = t;
    this.origen = 'cantidad';
    this.error = null;
    const imp = this.importe;
    this.importeTexto = imp == null ? '' : imp.toFixed(2);
  }

  alEscribirImporte(t: string) {
    this.importeTexto = t;
    this.origen = 'importe';
    this.error = null;
    const q = this.cantidad;
    this.cantidadTexto = q == null ? '' : GranelCantidadComponent.formato(q);
  }

  elegirRapido(v: number) {
    this.alEscribirCantidad(GranelCantidadComponent.formato(v));
    this.confirmar();
  }

  confirmar() {
    const q = this.cantidad;
    if (q == null || q < 0.01) {
      this.error = this.origen === 'importe'
        ? 'Escribe cuánto dinero quiere el cliente.'
        : `Escribe la cantidad en ${this.unidad}. Ejemplos: 0.25, 1.5 o 250 g.`;
      return;
    }
    this.aceptar.emit(q);
  }

  /** Enter en un campo: agrega. Se corta aquí para que no active otro botón. */
  alPulsarEnter(ev: Event) {
    ev.preventDefault();
    this.confirmar();
  }

  // --------------------------------------------------------------- lectura

  static redondear(n: number): number { return Math.round(n * 100) / 100; }

  static formato(n: number): string {
    return String(GranelCantidadComponent.redondear(n));
  }

  static numero(t: string): number | null {
    const limpio = String(t ?? '').replace(/[$\s,]/g, '');
    if (!limpio) return null;
    const n = Number(limpio);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * «0.25», «.250», «1,5», «250 g», «250g», «500 ml». Una cantidad en gramos
   * (o mililitros) para un producto en kg (o L) se convierte sola.
   */
  static leerCantidad(t: string, unidad: string): number | null {
    let s = String(t ?? '').trim().toLowerCase().replace(',', '.');
    if (!s) return null;
    const u = unidad.toLowerCase();
    let factor = 1;
    const m = s.match(/^([0-9]*\.?[0-9]+)\s*(kg|g|gr|grs|l|ml|lt|lts)?$/);
    if (!m) return null;
    const sufijo = m[2] ?? '';
    if (u === 'kg' && /^(g|gr|grs)$/.test(sufijo)) factor = 0.001;
    if (u === 'l' && sufijo === 'ml') factor = 0.001;
    const n = Number(m[1]) * factor;
    return Number.isFinite(n) && n > 0 ? GranelCantidadComponent.redondear(n) : null;
  }
}
