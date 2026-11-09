/**
 * Memoriza un cálculo mientras sus entradas no cambien (comparación `===`).
 *
 * POR QUÉ EXISTE
 * --------------
 * Las pantallas viejas exponen sus listas como getters (`get filtrado()`), y
 * Angular los evalúa en CADA detección de cambios: con 6,000 productos,
 * filtrar, ordenar y paginar se repetía en cada tecla y cada movimiento del
 * ratón, varias veces por ciclo (total, páginas, la página...). Pasarlas a
 * signals reescribe la pantalla entera; esto deja el getter como está y solo
 * recalcula cuando cambia algo de lo que depende.
 *
 *     private readonly memoFiltrado = new Memo<any[]>();
 *     get filtrado() {
 *       return this.memoFiltrado.de([this.inventario, this.filtro], () => ...);
 *     }
 *
 * Las entradas tienen que ser inmutables por referencia: un arreglo que se
 * muta en sitio no avisa. Las pantallas que lo usan reemplazan el arreglo.
 */
export class Memo<T> {
  private deps: readonly unknown[] | null = null;
  private valor!: T;

  de(deps: readonly unknown[], calcular: () => T): T {
    const prev = this.deps;
    if (prev && prev.length === deps.length && prev.every((d, i) => d === deps[i])) return this.valor;
    this.valor = calcular();
    this.deps = deps;
    return this.valor;
  }

  olvidar(): void { this.deps = null; }
}
