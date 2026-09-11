import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import {
  CapabilityService, CatalogProduct, CatalogService,
  HospitalityService, Ingredient, ModifierGroupRow, ModifierOptionRow,
  Presentation, RecipeHeader, RecipeLine, Uom,
} from '../core';
import { WxOpcion, WxSelectComponent } from '../app/wx-select/wx-select.component';
import { problemasDeOpcion } from '../core/opciones';

/*
 * Administracion de Hospitality: recetas, modificadores y presentaciones.
 *
 * Extiende el Backoffice actual, no lo sustituye: usa los mismos tokens, los
 * mismos controles (.ctl, .wx-set, .btn-*) y el mismo drawer. Solo aparece
 * cuando el negocio es HOSPITALITY.
 *
 * La UI no valida reglas de dominio (un ingrediente no puede ser receta, las
 * unidades deben compartir dimension...): eso vive en los procedures y aqui
 * solo se muestra el mensaje que devuelven. Asi no hay dos verdades.
 */

interface DraftLine {
  ingredientProductId: number;
  ingredientName: string;
  baseUom: string;
  inputQty: number;
  inputUom: string;
  wastePct: number;
  cost: number | null;
}

interface DraftOption {
  id: number | null;
  name: string;
  priceDelta: number;
  effect: 'NONE' | 'ADD' | 'REMOVE' | 'SUBSTITUTE' | 'SCALE';
  ingredientProductId: number | null;
  replacesProductId: number | null;
  qtyBase: number | null;
  qtyFactor: number | null;
  active: boolean;
}

@Component({
  selector: 'app-hospitality-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, WxSelectComponent],
  templateUrl: './hospitality-admin.html',
  styleUrls: ['./hospitality-admin.css'],
})
export class HospitalityAdmin implements OnInit {
  private readonly hosp = inject(HospitalityService);
  private readonly catalog = inject(CatalogService);
  readonly caps = inject(CapabilityService);

  tab: 'recetas' | 'modificadores' = 'recetas';
  cargando = signal(false);

  // ---------------------------------------------------------------- datos
  productos = signal<CatalogProduct[]>([]);
  ingredientes = signal<Ingredient[]>([]);
  uoms = signal<Uom[]>([]);
  grupos = signal<ModifierGroupRow[]>([]);
  opciones = signal<ModifierOptionRow[]>([]);

  filtroProducto = '';
  filtroIngrediente = '';

  /** Productos que pueden tener receta. */
  readonly recetables = computed(() =>
    this.productos().filter(p => p.inventory_mode === 'RECIPE'));

  readonly recetablesFiltrados = computed(() => {
    const t = this.filtroProducto.trim().toLowerCase();
    if (!t) return this.recetables();
    return this.recetables().filter(p => p.product_name.toLowerCase().includes(t));
  });

  readonly ingredientesFiltrados = computed(() => {
    const t = this.filtroIngrediente.trim().toLowerCase();
    const usados = new Set(this.draftLines().map(l => l.ingredientProductId));
    return this.ingredientes()
      .filter(i => !usados.has(i.id))
      .filter(i => !t || i.product_name.toLowerCase().includes(t));
  });

  // -------------------------------------------------------------- recetas
  productoSel = signal<CatalogProduct | null>(null);
  variantes = signal<ModifierOptionRow[]>([]);
  varianteSel = signal<number | null>(null);
  recetaHeader = signal<RecipeHeader | null>(null);
  draftLines = signal<DraftLine[]>([]);
  guardando = signal(false);

  /**
   * Avisa al signal de que una linea cambio.
   *
   * QUE SE ROMPIO
   * -------------
   * Las cantidades, unidades y mermas se editan con `[(ngModel)]="l.inputQty"`,
   * que MUTA el objeto dentro del arreglo. Un signal compara por referencia:
   * el arreglo sigue siendo el mismo, asi que `costoReceta` -que es un
   * `computed`- no se volvia a calcular. Las lineas si se actualizaban, porque
   * `costoLinea()` es un metodo que corre en cada ciclo de deteccion.
   *
   * Resultado: las tres lineas decian 2.85 / 4.55 / 1.20 y el resumen seguia
   * anclado en una suma vieja hasta guardar o recargar.
   *
   * Reemplazar el arreglo es lo minimo que hace falta para que el computed se
   * entere. No se copian las lineas: se conservan las mismas referencias, que
   * es lo que `[(ngModel)]` sigue editando.
   */
  lineaTocada() {
    this.draftLines.set([...this.draftLines()]);
  }

  /** Costo de una unidad con los costos actuales: la misma formula que SQL. */
  readonly costoReceta = computed(() =>
    this.draftLines().reduce((a, l) => a + l.inputQty * this.factor(l.inputUom, l.baseUom) * Number(l.cost ?? 0) * (1 + l.wastePct / 100), 0));

  readonly precioSel = computed(() => Number(this.productoSel()?.price ?? 0));

  /**
   * El precio SIN IVA, que es lo que de verdad se queda el negocio.
   *
   * `products.price` es el precio de mostrador, con IVA incluido; el costo
   * (`products.cost`) viene de la compra y NO lo lleva -el IVA de una compra
   * es acreditable-. Comparar uno contra otro infla el margen: un producto de
   * $100 con $80 de costo salia al 20% cuando el margen real es del 7.2%,
   * porque $13.79 de esos $100 son del SAT. A margenes altos casi no se nota;
   * a margenes bajos es la diferencia entre ganar y perder.
   */
  readonly precioSinIva = computed(() => {
    const p = this.productoSel();
    if (!p) return 0;
    const tasa = (p.objeto_impuesto ?? '02') !== '02' ? 0 : Number(p.tasa_iva ?? 0.16);
    return Number(p.price ?? 0) / (1 + tasa);
  });

  readonly margen = computed(() => {
    const p = this.precioSinIva(), c = this.costoReceta();
    if (!p) return null;
    return ((p - c) / p) * 100;
  });

  // --------------------------------------------------------- modificadores
  grupoSel = signal<ModifierGroupRow | null>(null);
  draftGrupo = signal<{ id: number | null; name: string; role: 'SIZE' | 'ADDON' | 'SUBSTITUTION' | 'NOTE'; minSelect: number; maxSelect: number; required: boolean; active: boolean } | null>(null);
  draftOptions = signal<DraftOption[]>([]);

  readonly roles = [
    { valor: 'SIZE', titulo: 'Tamaño', desc: 'Chico, mediano, grande. Puede tener su propia receta.' },
    { valor: 'ADDON', titulo: 'Extra', desc: 'Agrega un ingrediente: shot extra, crema.' },
    { valor: 'SUBSTITUTION', titulo: 'Sustitución', desc: 'Cambia o quita un ingrediente: leche de almendra, sin azúcar.' },
    { valor: 'NOTE', titulo: 'Nota', desc: 'Indicación para barra. No afecta inventario.' },
  ] as const;

  readonly efectos = [
    { valor: 'NONE', titulo: 'Sin efecto en inventario' },
    { valor: 'ADD', titulo: 'Agrega ingrediente' },
    { valor: 'SUBSTITUTE', titulo: 'Sustituye un ingrediente' },
    { valor: 'REMOVE', titulo: 'Quita un ingrediente' },
    { valor: 'SCALE', titulo: 'Multiplica la receta' },
  ] as const;

  async ngOnInit() {
    await this.caps.load();
    if (!this.hosp.disponible) return;
    this.cargando.set(true);
    try {
      const [prods] = await Promise.all([
        this.catalog.load(true),
        this.hosp.loadUoms().then(u => this.uoms.set(u)),
        this.hosp.ingredients().then(i => this.ingredientes.set(i)),
        this.recargarGrupos(),
      ]);
      this.productos.set(prods);
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'No se pudo cargar', text: e?.message || 'Error.' });
    } finally {
      this.cargando.set(false);
    }
  }

  /** Cuántas unidades base hay en una unidad de captura. */
  factor(uom: string, baseUom: string): number {
    const u = this.uoms().find(x => x.code === uom);
    const b = this.uoms().find(x => x.code === baseUom);
    if (!u || !b) return 1;
    return u.factor_to_base / b.factor_to_base;
  }

  uomsDe(baseUom: string): Uom[] {
    return this.hosp.uomsFor(baseUom);
  }

  // --------------------------------------------------- opciones para wx-select
  // Los mismos datos que alimentaban los <select> nativos, en el formato del
  // control propio: un desplegable del sistema operativo dentro de esta
  // pantalla se leia como de otra aplicacion.
  opcUoms(baseUom: string): WxOpcion[] {
    return this.uomsDe(baseUom).map(u => ({ valor: u.code, etiqueta: u.name, nota: u.code }));
  }

  readonly opcRoles: WxOpcion[] = this.roles.map(r => ({ valor: r.valor, etiqueta: r.titulo }));
  readonly opcEfectos: WxOpcion[] = this.efectos.map(e => ({ valor: e.valor, etiqueta: e.titulo }));

  opcIngredientes(): WxOpcion[] {
    return this.ingredientes().map(i => ({
      valor: i.id, etiqueta: i.product_name, nota: i.base_uom, busca: i.part_number ?? '',
    }));
  }

  // ============================================================== RECETAS

  async elegirProducto(p: CatalogProduct) {
    this.productoSel.set(p);
    this.varianteSel.set(null);
    try {
      const { grupos, opciones } = await this.hosp.modifierGroups(p.id, true);
      const size = grupos.filter(g => g.role === 'SIZE').map(g => g.id);
      this.variantes.set(opciones.filter(o => size.includes(o.group_id)));
      await this.cargarReceta();
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message });
    }
  }

  async cargarReceta() {
    const p = this.productoSel();
    if (!p) return;
    try {
      const { header, lines } = await this.hosp.getRecipe(p.id, this.varianteSel());
      this.recetaHeader.set(header);
      // Una receta heredada (fallback) se muestra como punto de partida de la
      // variante, pero se guardara como receta propia.
      this.draftLines.set(lines.map(l => ({
        ingredientProductId: l.ingredient_product_id,
        ingredientName: l.ingredient_name,
        baseUom: l.base_uom,
        inputQty: Number(l.input_qty),
        inputUom: l.input_uom,
        wastePct: Number(l.waste_pct ?? 0),
        cost: l.ingredient_cost != null ? Number(l.ingredient_cost) : null,
      })));
    } catch (e: any) {
      this.recetaHeader.set(null);
      this.draftLines.set([]);
    }
  }

  async cambiarVariante(id: number | null) {
    this.varianteSel.set(id);
    await this.cargarReceta();
  }

  agregarIngrediente(i: Ingredient) {
    this.draftLines.update(l => [...l, {
      ingredientProductId: i.id,
      ingredientName: i.product_name,
      baseUom: i.base_uom,
      inputQty: 1,
      inputUom: i.base_uom,
      wastePct: 0,
      cost: i.cost != null ? Number(i.cost) : null,
    }]);
    this.filtroIngrediente = '';
  }

  quitarLinea(idx: number) {
    this.draftLines.update(l => l.filter((_, i) => i !== idx));
  }

  costoLinea(l: DraftLine): number {
    return l.inputQty * this.factor(l.inputUom, l.baseUom) * Number(l.cost ?? 0) * (1 + l.wastePct / 100);
  }

  async guardarReceta() {
    const p = this.productoSel();
    if (!p) return;
    if (!this.draftLines().length) {
      await Swal.fire({ icon: 'warning', title: 'Receta vacía', text: 'Agrega al menos un ingrediente.' });
      return;
    }
    this.guardando.set(true);
    try {
      await this.hosp.saveRecipe({
        productId: p.id,
        variantOptionId: this.varianteSel(),
        lines: this.draftLines().map((l, i) => ({
          ingredientProductId: l.ingredientProductId,
          inputQty: Number(l.inputQty),
          inputUom: l.inputUom,
          wastePct: Number(l.wastePct ?? 0),
          sortOrder: i + 1,
        })),
      });
      await this.cargarReceta();
      await Swal.fire({ icon: 'success', title: 'Receta guardada', timer: 1200, showConfirmButton: false });
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'No se pudo guardar', text: e?.message });
    } finally {
      this.guardando.set(false);
    }
  }

  async eliminarReceta() {
    const h = this.recetaHeader();
    if (!h) return;
    const c = await Swal.fire({
      icon: 'warning', title: 'Eliminar receta',
      text: 'Las ventas ya registradas conservan lo que consumieron. ¿Continuar?',
      showCancelButton: true, confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar',
    });
    if (!c.isConfirmed) return;
    try {
      await this.hosp.deleteRecipe(h.recipe_id);
      await this.cargarReceta();
      await Swal.fire({ icon: 'success', title: 'Receta eliminada', timer: 1100, showConfirmButton: false });
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'No se pudo eliminar', text: e?.message });
    }
  }

  // ========================================================= MODIFICADORES

  async recargarGrupos() {
    const { grupos, opciones } = await this.hosp.modifierGroups(null, false);
    this.grupos.set(grupos);
    this.opciones.set(opciones);
  }

  opcionesDe(groupId: number): ModifierOptionRow[] {
    return this.opciones().filter(o => o.group_id === groupId && o.active);
  }

  nuevoGrupo() {
    this.grupoSel.set(null);
    this.draftGrupo.set({ id: null, name: '', role: 'ADDON', minSelect: 0, maxSelect: 1, required: false, active: true });
    this.draftOptions.set([]);
  }

  editarGrupo(g: ModifierGroupRow) {
    this.grupoSel.set(g);
    this.draftGrupo.set({
      id: g.id, name: g.name, role: g.role, minSelect: g.min_select,
      maxSelect: g.max_select, required: g.required, active: g.active,
    });
    this.draftOptions.set(this.opcionesDe(g.id).map(o => ({
      id: o.id, name: o.name, priceDelta: Number(o.price_delta ?? 0), effect: o.effect,
      ingredientProductId: o.ingredient_product_id, replacesProductId: o.replaces_product_id,
      qtyBase: o.qty_base != null ? Number(o.qty_base) : null,
      qtyFactor: o.qty_factor != null ? Number(o.qty_factor) : null,
      active: o.active,
    })));
  }

  cerrarGrupo() {
    this.draftGrupo.set(null);
    this.draftOptions.set([]);
    this.grupoSel.set(null);
  }

  agregarOpcion() {
    const rol = this.draftGrupo()?.role ?? 'ADDON';
    // El efecto por defecto es el que tiene sentido para el rol: un extra
    // agrega, una sustitucion sustituye, una nota no toca inventario.
    const effect: DraftOption['effect'] =
      rol === 'ADDON' ? 'ADD' : rol === 'SUBSTITUTION' ? 'SUBSTITUTE' : 'NONE';
    this.draftOptions.update(l => [...l, {
      id: null, name: '', priceDelta: 0, effect,
      ingredientProductId: null, replacesProductId: null, qtyBase: null, qtyFactor: null, active: true,
    }]);
  }

  quitarOpcion(idx: number) {
    this.draftOptions.update(l => l.filter((_, i) => i !== idx));
  }

  /** Unidad base del ingrediente elegido en una opcion, para el sufijo. */
  uomDeIngrediente(id: number | null): string {
    if (id == null) return '';
    return this.ingredientes().find(i => i.id === id)?.base_uom ?? '';
  }

  /** Lo que le falta a cada opcion, por indice, para marcarlo en la pantalla. */
  problemasDe(o: DraftOption): string[] { return problemasDeOpcion(o); }
  opcionIncompleta(o: DraftOption): boolean { return problemasDeOpcion(o).length > 0; }

  async guardarGrupo() {
    const g = this.draftGrupo();
    if (!g) return;

    /* VALIDACION ANTES DE GUARDAR.
       La base ya lo impide con `CK_modifier_options_effect`, pero ese CHECK
       rechaza la fila con un mensaje de SQL Server que no nombra ni el campo
       ni la opcion. Quien esta configurando el menu no puede hacer nada con
       eso. Aqui se dice que falta y en cual. */
    const malas = this.draftOptions()
      .map((o, i) => ({ i, nombre: o.name || `Opción ${i + 1}`, fallos: problemasDeOpcion(o) }))
      .filter(x => x.fallos.length);

    if (malas.length) {
      await Swal.fire({
        icon: 'warning',
        title: 'Faltan datos en las opciones',
        html: malas.map(m =>
          `<b>${m.nombre}</b><br><small>${m.fallos.join('<br>')}</small>`).join('<br><br>'),
      });
      return;
    }

    this.guardando.set(true);
    try {
      await this.hosp.saveModifierGroup({
        groupId: g.id, name: g.name, role: g.role,
        minSelect: g.minSelect, maxSelect: g.maxSelect, required: g.required, active: g.active,
        options: this.draftOptions().map((o, i) => ({
          id: o.id, name: o.name, priceDelta: o.priceDelta, effect: o.effect,
          ingredientProductId: o.ingredientProductId, replacesProductId: o.replacesProductId,
          qtyBase: o.qtyBase, qtyFactor: o.qtyFactor, active: o.active, sortOrder: i + 1,
        })),
      });
      await this.recargarGrupos();
      this.cerrarGrupo();
      await Swal.fire({ icon: 'success', title: 'Grupo guardado', timer: 1200, showConfirmButton: false });
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'No se pudo guardar', text: e?.message });
    } finally {
      this.guardando.set(false);
    }
  }

  async eliminarGrupo(g: ModifierGroupRow) {
    const c = await Swal.fire({
      icon: 'warning', title: `Eliminar "${g.name}"`,
      text: 'Si alguna venta usó sus opciones, el grupo se desactiva en vez de borrarse.',
      showCancelButton: true, confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar',
    });
    if (!c.isConfirmed) return;
    try {
      const res = await this.hosp.deleteModifierGroup(g.id);
      await this.recargarGrupos();
      await Swal.fire({
        icon: 'success',
        title: res === 'DEACTIVATED' ? 'Grupo desactivado' : 'Grupo eliminado',
        text: res === 'DEACTIVATED' ? 'Se conserva porque hay ventas que lo referencian.' : undefined,
        timer: res === 'DEACTIVATED' ? undefined : 1200,
        showConfirmButton: res === 'DEACTIVATED',
      });
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'No se pudo eliminar', text: e?.message });
    }
  }

  /** Asigna a un producto los grupos marcados. */
  async asignarGrupos(p: CatalogProduct, ids: number[]) {
    try {
      await this.hosp.setProductGroups(p.id, ids);
      await Swal.fire({ icon: 'success', title: 'Modificadores asignados', timer: 1100, showConfirmButton: false });
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'No se pudo asignar', text: e?.message });
    }
  }

  // -------------------------------------------- asignacion desde una receta
  asignando = signal(false);
  gruposDelProducto = signal<Set<number>>(new Set());

  async abrirAsignacion() {
    const p = this.productoSel();
    if (!p) return;
    const { grupos } = await this.hosp.modifierGroups(p.id, false);
    this.gruposDelProducto.set(new Set(grupos.map(g => g.id)));
    this.asignando.set(true);
  }

  alternarGrupo(id: number) {
    this.gruposDelProducto.update(s => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  async confirmarAsignacion() {
    const p = this.productoSel();
    if (!p) return;
    await this.asignarGrupos(p, [...this.gruposDelProducto()]);
    this.asignando.set(false);
    await this.elegirProducto(p);
  }
}
