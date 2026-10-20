import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import Swal from 'sweetalert2';
import { WxSelectComponent, WxOpcion } from '../wx-select/wx-select.component';

interface Directo { id: number; product_name: string; part_number: string | null; base_uom: string; dimension: string; stock: number; cost: number | null; }
interface Unidad { code: string; name: string; dimension: string; factor_to_base: number; }
interface Linea { ingredientProductId: number; inputQty: number; inputUom: string; wastePct: number; }
interface ConFormula { product_id: number; product_name: string; yield_qty: number; unit_cost: number; }
interface Producto { product_id: number; product_name: string; product_price: number | null; product_stock: number | null; tiene_formula: boolean; }

/*
 * 0060 · FÓRMULAS DE PRODUCCIÓN (concepto B, «fórmula escalable»).
 *
 * Se lee como la receta del cuaderno: «Para 12 donas de chocolate se usa…»,
 * con +/− en cada ingrediente. A un lado, el simulador «Si hoy haces N» dice
 * qué alcanza, qué falta, cuánto costaría esa tanda y el margen contra el
 * precio de venta. El simulador no mueve inventario.
 *
 * Es catálogo, como una receta, pero de un producto con existencia propia:
 * sus ingredientes salen al EMPEZAR una tanda, nunca al vender (la venta no
 * la lee). Lo preparado al momento sigue en «Recetas y modificadores».
 */
@Component({
  selector: 'app-produccion-formulas',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, WxSelectComponent],
  templateUrl: './formulas.component.html',
  styleUrls: ['./formulas.component.css'],
})
export class FormulasComponent implements OnInit {
  private get prod() { return (window as any).wybix?.produccion; }
  private get catalogo() { return (window as any).wybix?.catalog; }

  readonly directos = signal<Directo[]>([]);
  readonly unidades = signal<Unidad[]>([]);
  readonly conFormula = signal<ConFormula[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);

  /** Lo que se está editando. Señales: el simulador se recalcula solo. */
  readonly producto = signal<Producto | null>(null);
  readonly rinde = signal(12);
  readonly lineas = signal<Linea[]>([]);
  readonly simular = signal(100);
  notas = '';
  /** El selector de «+ Nueva fórmula» o de «Agregar ingrediente» abierto. */
  readonly eligiendoProducto = signal(false);
  nuevoIngrediente: number | null = null;
  readonly guardando = signal(false);
  readonly errorEditor = signal<string | null>(null);

  readonly opcionesProducto = computed<WxOpcion[]>(() => this.directos()
    .filter(d => !this.conFormula().some(f => f.product_id === d.id))
    .map(d => ({ valor: d.id, etiqueta: d.product_name, nota: d.part_number || '', busca: d.part_number || '' })));

  readonly opcionesIngrediente = computed<WxOpcion[]>(() => {
    const usados = new Set(this.lineas().map(l => l.ingredientProductId));
    const pid = this.producto()?.product_id;
    return this.directos().filter(d => d.id !== pid && !usados.has(d.id)).map(d => ({
      valor: d.id, etiqueta: d.product_name, nota: `hay ${this.cantidad(d.stock, d.base_uom)}`, busca: d.part_number || '',
    }));
  });

  /** Lo que pide cada ingrediente para N piezas, contra lo que hay. */
  readonly simulacion = computed(() => {
    const n = this.simular(), r = this.rinde() || 1;
    const filas = this.lineas().map(l => {
      const d = this.directo(l.ingredientProductId);
      const porPieza = this.base(l) * (1 + (l.wastePct || 0) / 100) / r;
      const pide = porPieza * n;
      const hay = Number(d?.stock || 0);
      return { nombre: d?.product_name ?? '', uom: d?.base_uom ?? '', pide, hay, falta: Math.max(0, pide - hay),
        alcanzaPara: porPieza > 0 ? Math.floor(hay / porPieza) : Infinity, costo: pide * Number(d?.cost || 0) };
    });
    const costo = filas.reduce((a, f) => a + f.costo, 0);
    const alcanzaPara = filas.length ? Math.min(...filas.map(f => f.alcanzaPara)) : 0;
    const limita = filas.filter(f => f.falta > 0);
    return { filas, costo, porPieza: n > 0 ? costo / n : 0, alcanzaPara, limita };
  });
  readonly margen = computed(() => {
    const precio = Number(this.producto()?.product_price || 0);
    return precio > 0 ? (precio - this.simulacion().porPieza) / precio : null;
  });

  async ngOnInit() {
    try {
      const [ing, uoms, tab] = await Promise.all([this.catalogo?.ingredients?.({}), this.catalogo?.uoms?.(), this.prod?.tablero?.({})]);
      if (!ing?.success) throw new Error(ing?.error || 'No se pudieron leer los productos.');
      this.directos.set((ing?.data ?? []) as Directo[]);
      this.unidades.set((uoms?.data ?? []).map((u: any) => ({ ...u, factor_to_base: Number(u.factor_to_base) })));
      this.conFormula.set(tab?.data?.productos ?? []);
      const primero = this.conFormula()[0];
      if (primero) await this.editar(primero.product_id);
      else this.eligiendoProducto.set(true);
    } catch (e: any) {
      this.error.set(e?.message || 'No se pudieron leer los productos.');
    } finally {
      this.cargando.set(false);
    }
  }

  private directo(id: number | null) { return this.directos().find(d => d.id === id) ?? null; }
  private unidad(code: string | null | undefined) { return this.unidades().find(u => u.code === code) ?? null; }
  /** La cantidad de la línea en la unidad base del ingrediente. */
  private base(l: Linea) {
    const d = this.directo(l.ingredientProductId), u = this.unidad(l.inputUom), ub = this.unidad(d?.base_uom);
    return u && ub ? Number(l.inputQty || 0) * u.factor_to_base / ub.factor_to_base : Number(l.inputQty || 0);
  }

  async editar(productId: number | null) {
    this.errorEditor.set(null);
    this.eligiendoProducto.set(false);
    if (!productId) return;
    const r = await this.prod?.formula?.({ productId });
    if (!r?.success) { this.errorEditor.set(r?.error || 'No se pudo leer la fórmula.'); return; }
    const c = r.data?.cabecera;
    this.producto.set(c ? { product_id: c.product_id, product_name: c.product_name, product_price: c.product_price,
      product_stock: c.product_stock, tiene_formula: !!c.tiene_formula } : null);
    this.rinde.set(c?.tiene_formula ? Number(c.yield_qty) : 12);
    this.notas = c?.notes || '';
    this.lineas.set((r.data?.lineas ?? []).map((l: any) => ({
      ingredientProductId: l.ingredient_product_id, inputQty: Number(l.input_qty), inputUom: l.input_uom, wastePct: Number(l.waste_pct || 0),
    })));
    this.simular.set(Math.max(this.rinde(), Math.round(this.rinde() * 8)));
  }
  nuevaFormula() { this.eligiendoProducto.set(true); }

  /* ------------------------------------------------------------ líneas */
  agregarIngrediente(id: number | null) {
    const d = this.directo(id);
    if (!d) return;
    const inicial = d.base_uom === 'pza' ? 1 : 100;
    this.lineas.update(ls => [...ls, { ingredientProductId: d.id, inputQty: inicial, inputUom: d.base_uom, wastePct: 0 }]);
    setTimeout(() => { this.nuevoIngrediente = null; });
  }
  quitar(i: number) { this.lineas.update(ls => ls.filter((_, k) => k !== i)); }
  /** El paso del +/−: 10 g o ml, 0.1 kg o L, 1 pieza. */
  paso(l: Linea) { return ['g', 'ml'].includes(l.inputUom) ? 10 : ['kg', 'L', 'lb'].includes(l.inputUom) ? 0.1 : 1; }
  mover(i: number, signo: 1 | -1) {
    this.lineas.update(ls => ls.map((l, k) => k !== i ? l : { ...l, inputQty: Math.max(0, Math.round((l.inputQty + signo * this.paso(l)) * 1000) / 1000) }));
  }
  fijar(i: number, campo: 'inputQty' | 'inputUom' | 'wastePct', v: any) {
    this.lineas.update(ls => ls.map((l, k) => k !== i ? l : { ...l, [campo]: campo === 'inputUom' ? v : Math.max(0, Number(v) || 0) }));
  }
  merma(i: number, signo: 1 | -1) {
    this.lineas.update(ls => ls.map((l, k) => k !== i ? l : { ...l, wastePct: Math.min(100, Math.max(0, (l.wastePct || 0) + signo)) }));
  }
  opcionesUnidad(l: Linea): WxOpcion[] {
    const d = this.directo(l.ingredientProductId);
    return this.unidades().filter(u => !d || u.dimension === d.dimension).map(u => ({ valor: u.code, etiqueta: u.code, busca: u.name }));
  }
  nombre(id: number) { return this.directo(id)?.product_name ?? ''; }
  hay(id: number) { const d = this.directo(id); return d ? this.cantidad(d.stock, d.base_uom) : ''; }

  /** Los campos numéricos se toman al terminar de escribir (change), no con
      cada tecla: reescribirlos a medio número convertía «0.6» en «0». */
  entero(v: any) { return Math.max(1, Math.round(Number(v) || 1)); }
  porPosicion(i: number) { return i; }

  sumarRinde(d: number) { this.rinde.update(r => Math.max(1, r + d)); }
  sumarSimular(d: number) { this.simular.update(n => Math.max(1, n + d)); }

  /* ------------------------------------------------------------ guardar */
  async guardar() {
    this.errorEditor.set(null);
    const p = this.producto();
    if (!p) { this.errorEditor.set('Elige qué producto se fabrica.'); return; }
    const lineas = this.lineas();
    if (!lineas.length) { this.errorEditor.set('Agrega al menos un ingrediente.'); return; }
    if (lineas.some(l => !(l.inputQty > 0))) { this.errorEditor.set('Cada ingrediente necesita una cantidad mayor a cero.'); return; }
    this.guardando.set(true);
    try {
      const r = await this.prod?.guardarFormula?.({ productId: p.product_id, rinde: this.rinde(), notas: this.notas || null, lineas });
      if (!r?.success) { this.errorEditor.set(r?.error || 'No se pudo guardar.'); return; }
      this.producto.set({ ...p, tiene_formula: true });
      const tab = await this.prod?.tablero?.({});
      this.conFormula.set(tab?.data?.productos ?? this.conFormula());
      await Swal.fire({ icon: 'success', title: 'Fórmula guardada', timer: 1200, showConfirmButton: false });
    } finally {
      this.guardando.set(false);
    }
  }

  async quitarFormula() {
    const p = this.producto();
    if (!p) return;
    const ok = await Swal.fire({ icon: 'warning', title: 'Quitar la fórmula',
      text: 'Ya no se podrá producir este producto por tandas. Las tandas registradas conservan lo que consumieron.',
      showCancelButton: true, confirmButtonText: 'Quitar', cancelButtonText: 'Cancelar' });
    if (!ok.isConfirmed) return;
    const r = await this.prod?.quitarFormula?.({ productId: p.product_id });
    if (!r?.success) { this.errorEditor.set(r?.error || 'No se pudo quitar.'); return; }
    this.conFormula.set(this.conFormula().filter(f => f.product_id !== p.product_id));
    this.producto.set(null);
    this.lineas.set([]);
    const otro = this.conFormula()[0];
    if (otro) await this.editar(otro.product_id); else this.eligiendoProducto.set(true);
  }

  /* -------------------------------------------------------------- formato */
  cantidad(n: number, uom: string) {
    const v = Number(n || 0);
    if (uom === 'g' && v >= 1000) return `${this.redondo(v / 1000)} kg`;
    if (uom === 'ml' && v >= 1000) return `${this.redondo(v / 1000)} L`;
    return `${this.redondo(v)} ${uom}`;
  }
  redondo(n: number) { return Math.round(n * 100) / 100; }
  dinero(n: number) { return Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }); }
  porciento(n: number | null) { return n == null ? '—' : `${Math.round(n * 100)}%`; }
}
