import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService, PAQUETES } from '../../services/auth.service';
import { fechaDeSql } from '../../core';

interface Tanda {
  id: number; uuid: string; product_id: number; product_name: string; base_uom: string;
  status: 'PLANNED' | 'IN_PROGRESS' | 'DONE'; planned_qty: number; good_qty: number | null; waste_qty: number | null;
  waste_reason: string | null; unit_cost: number | null; total_cost: number | null;
  created_at: string; created_by_name: string | null; started_at: string | null; started_by_name: string | null;
  finished_at: string | null; finished_by_name: string | null; faltantes: number;
}
interface Ingrediente { ingredient_product_id: number; ingredient_name: string; base_uom: string; needed: number; stock: number; missing: number; }
interface Fabricable { product_id: number; product_name: string; base_uom: string; yield_qty: number; stock: number; unit_cost: number; }

type Hoja =
  | { tipo: 'nueva'; productId: number | null }
  | { tipo: 'planeada'; tanda: Tanda }
  | { tipo: 'horno'; tanda: Tanda };

/** Por qué no salieron todas. Cortos: se tocan con harina en las manos. */
const MOTIVOS = ['Se quemó', 'Se cayó', 'Quedó mal', 'Otro'];

/*
 * 0060 · PRODUCCIÓN DE HOY.
 *
 * Un tablero de tres etapas (planeado -> en preparación -> listo para vender)
 * con tarjetas grandes para la pantalla táctil, y una hoja con teclado
 * numérico para lo único que se captura: cuántas. Quién, cuándo, dónde y el
 * costo los pone Wybix.
 *
 *   planear   no mueve inventario
 *   empezar   salen los ingredientes (si no alcanzan, no empieza)
 *   terminar  entran las piezas buenas; la diferencia es merma con motivo
 *
 * Las reglas viven en SQL (sp_production_*): esta pantalla pregunta y enseña
 * lo que SQL respondió.
 */
@Component({
  selector: 'app-produccion',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './produccion.component.html',
  styleUrls: ['./produccion.component.css'],
})
export class ProduccionComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private get api() { return (window as any).wybix?.produccion; }

  readonly motivos = MOTIVOS;
  readonly tandas = signal<Tanda[]>([]);
  readonly ingredientes = signal<Ingrediente[]>([]);
  readonly fabricables = signal<Fabricable[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly hoja = signal<Hoja | null>(null);
  readonly guardando = signal(false);
  readonly errorHoja = signal<string | null>(null);
  /** Lo que se está tecleando en la hoja. */
  readonly numero = signal('');
  readonly motivo = signal<string | null>(null);

  readonly puedeFormulas = computed(() => this.auth.puede(PAQUETES.CATALOGO_EDITAR));

  readonly planeadas = computed(() => this.tandas().filter(t => t.status === 'PLANNED'));
  readonly enHorno = computed(() => this.tandas().filter(t => t.status === 'IN_PROGRESS'));
  readonly listas = computed(() => this.tandas().filter(t => t.status === 'DONE'));
  readonly totalListas = computed(() => this.listas().reduce((a, t) => a + Number(t.good_qty || 0), 0));
  readonly totalPlaneado = computed(() => this.tandas().reduce((a, t) => a + Number(t.planned_qty || 0), 0));
  readonly faltan = computed(() => this.ingredientes().filter(i => Number(i.missing) > 0));

  /** Para la hoja: cuánto vale lo tecleado y qué merma deja. */
  readonly valor = computed(() => Number(this.numero() || 0));
  readonly merma = computed(() => {
    const h = this.hoja();
    return h?.tipo === 'horno' ? Math.max(0, Number(h.tanda.planned_qty) - this.valor()) : 0;
  });
  readonly productoNuevo = computed(() => {
    const h = this.hoja();
    return h?.tipo === 'nueva' ? this.fabricables().find(f => f.product_id === h.productId) ?? null : null;
  });

  async ngOnInit() { await this.cargar(); }

  async cargar() {
    this.error.set(null);
    try {
      const r = await this.api?.tablero?.({});
      if (!r?.success) throw new Error(r?.error || 'No se pudo leer la producción.');
      this.tandas.set(r.data.tandas ?? []);
      this.ingredientes.set(r.data.ingredientes ?? []);
      this.fabricables.set(r.data.productos ?? []);
    } catch (e: any) {
      this.error.set(e?.message || 'No se pudo leer la producción.');
    } finally {
      this.cargando.set(false);
    }
  }

  /* -------------------------------------------------------------- hojas */
  abrirNueva() {
    const unico = this.fabricables().length === 1 ? this.fabricables()[0] : null;
    this.abrir({ tipo: 'nueva', productId: unico?.product_id ?? null }, unico ? String(this.redondo(unico.yield_qty)) : '');
  }
  elegirProducto(f: Fabricable) {
    this.hoja.set({ tipo: 'nueva', productId: f.product_id });
    this.numero.set(String(this.redondo(f.yield_qty)));
    this.errorHoja.set(null);
  }
  tocar(t: Tanda) {
    if (t.status === 'PLANNED') this.abrir({ tipo: 'planeada', tanda: t }, String(this.redondo(t.planned_qty)));
    else if (t.status === 'IN_PROGRESS') this.abrir({ tipo: 'horno', tanda: t }, String(this.redondo(t.planned_qty)));
  }
  private abrir(h: Hoja, numero: string) {
    this.hoja.set(h); this.numero.set(numero); this.motivo.set(null); this.errorHoja.set(null);
  }
  cerrar() { if (!this.guardando()) this.hoja.set(null); }

  tecla(k: string) {
    this.errorHoja.set(null);
    let n = this.numero();
    if (k === 'borrar') n = n.slice(0, -1);
    else if (k === 'limpiar') n = '';
    else if (n.length < 4) n = (n === '0' ? '' : n) + k;
    this.numero.set(n);
  }
  sumar(d: number) { this.numero.set(String(Math.max(0, this.valor() + d))); this.errorHoja.set(null); }

  /* ------------------------------------------------------------ acciones */
  async planear() {
    const h = this.hoja();
    if (h?.tipo !== 'nueva') return;
    if (!h.productId) { this.errorHoja.set('Elige qué vas a producir.'); return; }
    if (this.valor() <= 0) { this.errorHoja.set('Indica cuántas piezas.'); return; }
    await this.hacer(() => this.api.planear({ productId: h.productId, cantidad: this.valor(), uuid: crypto.randomUUID() }));
  }
  async cambiarPlan() {
    const h = this.hoja();
    if (h?.tipo !== 'planeada') return;
    if (this.valor() <= 0) { this.errorHoja.set('Indica cuántas piezas.'); return; }
    await this.hacer(() => this.api.planear({ batchId: h.tanda.id, cantidad: this.valor() }));
  }
  async empezar() {
    const h = this.hoja();
    if (h?.tipo !== 'planeada') return;
    const cantidad = this.valor();
    if (cantidad <= 0) { this.errorHoja.set('Indica cuántas piezas.'); return; }
    await this.hacer(async () => {
      // Si cambiaron la cantidad en la hoja, primero se guarda lo planeado.
      if (cantidad !== Number(h.tanda.planned_qty)) {
        const p = await this.api.planear({ batchId: h.tanda.id, cantidad });
        if (!p?.success) return p;
      }
      return this.api.empezar({ batchId: h.tanda.id });
    });
  }
  async quitar() {
    const h = this.hoja();
    if (h?.tipo !== 'planeada') return;
    await this.hacer(() => this.api.cancelar({ batchId: h.tanda.id }));
  }
  async terminar() {
    const h = this.hoja();
    if (h?.tipo !== 'horno') return;
    if (this.merma() > 0 && !this.motivo()) { this.errorHoja.set('Elige el motivo de la merma.'); return; }
    await this.hacer(() => this.api.terminar({ batchId: h.tanda.id, buenas: this.valor(), motivo: this.merma() > 0 ? this.motivo() : null }));
  }

  private async hacer(fn: () => Promise<any>) {
    this.guardando.set(true);
    this.errorHoja.set(null);
    try {
      const r = await fn();
      if (!r?.success) { this.errorHoja.set(r?.error || 'No se pudo completar.'); return; }
      this.hoja.set(null);
      await this.cargar();
    } catch (e: any) {
      this.errorHoja.set(e?.message || 'No se pudo completar.');
    } finally {
      this.guardando.set(false);
    }
  }

  /* -------------------------------------------------------------- formato */
  redondo(n: number | string | null | undefined) { const v = Number(n || 0); return Math.round(v * 100) / 100; }
  /** started_at / finished_at son hora de pared (SYSDATETIME): ver `fechaSql`. */
  hora(iso: string | Date | null) {
    const d = fechaDeSql(iso);
    return d ? d.toLocaleTimeString('es-MX', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' }) : '';
  }
  cantidad(n: number, uom: string) {
    const v = Number(n || 0);
    if (uom === 'g' && v >= 1000) return `${this.redondo(v / 1000)} kg`;
    if (uom === 'ml' && v >= 1000) return `${this.redondo(v / 1000)} L`;
    return `${this.redondo(v)} ${uom}`;
  }
  dinero(n: number | null | undefined) {
    return (Number(n || 0)).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  }
}
