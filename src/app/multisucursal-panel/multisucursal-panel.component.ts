import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WxSelectComponent, type WxOpcion } from '../wx-select/wx-select.component';
import { WxMultiSelectComponent } from '../wx-multi-select/wx-multi-select.component';

/**
 * MULTISUCURSAL (Configuración → Nube y cuenta).
 *
 *   MATRIZ    publica el catálogo corporativo, fija las reglas de la empresa,
 *             los precios y la disponibilidad de cada sucursal, y qué usuarios
 *             son de empresa.
 *   SUCURSAL  ve qué versión tiene, la recibe a mano si no quiere esperar a la
 *             sincronización, y las reglas que le aplican.
 *
 * Todo lo que va a la nube lo valida la nube: aquí solo se ofrece.
 */
interface Sucursal { id: string; nombre: string; es_matriz: boolean; }
interface Estado {
  multisucursal: boolean; esMatriz: boolean; locationId: string; matriz: { id: string; nombre: string } | null;
  sucursales: Sucursal[]; reglas: { precios_sucursal: boolean; productos_locales: boolean };
  versionNube: number | null; versionLocal: number | null; aplicadoEn: string | null; publicadoEn: string | null;
}
interface Fila { product_uuid: string; nombre: string; part_number: string; categoria: string | null; price: number; especial: string | number | null; disponible: boolean; }

@Component({
  selector: 'app-multisucursal-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, WxSelectComponent, WxMultiSelectComponent],
  templateUrl: './multisucursal-panel.component.html',
  styleUrls: ['../panel-controls.css', './multisucursal-panel.component.css'],
})
export class MultisucursalPanelComponent implements OnInit {
  private get api() { return (window as any).electronAPI; }

  cargando = signal(true);
  ocupado = signal(false);
  error = signal<string | null>(null);
  aviso = signal<string | null>(null);
  estado = signal<Estado | null>(null);

  // Precios y disponibilidad por sucursal (matriz)
  sucursalElegida: string | null = null;
  filas = signal<Fila[]>([]);
  buscar = '';
  soloConExcepcion = false;
  cargandoFilas = signal(false);

  // Usuarios de empresa (matriz)
  usuarios = signal<Array<{ id: number; usuario: string; rol: string; active: boolean; corporate: boolean; scope: string[] | null }>>([]);

  readonly otrasSucursales = computed<WxOpcion[]>(() => (this.estado()?.sucursales ?? [])
    .filter((s) => !s.es_matriz).map((s) => ({ valor: s.id, etiqueta: s.nombre })));
  readonly opcionesAlcance = computed<WxOpcion[]>(() => [
    { valor: '*', etiqueta: 'Todas las sucursales' },
    ...(this.estado()?.sucursales ?? []).filter((s) => !s.es_matriz).map((s) => ({ valor: s.id, etiqueta: s.nombre })),
  ]);
  /** Getter y no computed: `buscar` y `soloConExcepcion` son campos de formulario. */
  get filasVisibles(): Fila[] {
    const q = this.buscar.trim().toLowerCase();
    return this.filas().filter((f) =>
      (!q || f.nombre.toLowerCase().includes(q) || f.part_number.toLowerCase().includes(q))
      && (!this.soloConExcepcion || this.tieneExcepcion(f)));
  }
  /** Un campo numérico vacío llega como null, no como ''. */
  tieneEspecial(f: Fila): boolean { return f.especial !== '' && f.especial != null; }
  tieneExcepcion(f: Fila): boolean { return this.tieneEspecial(f) || !f.disponible; }

  async ngOnInit() { await this.cargar(); }

  async cargar() {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const r = await this.api?.multiEstado?.();
      if (!r?.success) throw new Error(r?.error || 'No se pudo leer el estado de la empresa.');
      this.estado.set(r.data);
      if (r.data.multisucursal && r.data.esMatriz) {
        const u = await this.api?.multiUsuarios?.();
        if (u?.success) this.usuarios.set(u.data.filter((x: any) => x.active && !x.corporate));
        if (!this.sucursalElegida && this.otrasSucursales().length) {
          this.sucursalElegida = this.otrasSucursales()[0].valor;
          await this.cargarExcepciones();
        }
      }
    } catch (e: any) {
      this.error.set(e?.message ?? 'Error inesperado.');
    } finally {
      this.cargando.set(false);
    }
  }

  private async hacer(fn: () => Promise<any>, exito: (d: any) => string) {
    this.ocupado.set(true);
    this.error.set(null);
    this.aviso.set(null);
    try {
      const r = await fn();
      if (!r?.success) throw new Error(r?.error || 'No se pudo completar.');
      this.aviso.set(exito(r.data));
      return r.data;
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo completar.');
      return null;
    } finally {
      this.ocupado.set(false);
    }
  }

  // ------------------------------------------------------------ catálogo
  async publicar() {
    const d = await this.hacer(() => this.api.multiPublicar(),
      (x) => x.publicado ? `Catálogo publicado: versión ${x.version} con ${x.productos} productos. Las sucursales lo reciben en su próxima sincronización.` : 'El catálogo no cambió desde la última publicación.');
    if (d) await this.cargar();
  }

  async recibir() {
    const d = await this.hacer(() => this.api.multiRecibir(), (x) => !x.aplicado
      ? 'Esta sucursal ya tiene la versión más reciente.'
      : `Catálogo aplicado: ${x.nuevos ?? 0} nuevos, ${x.actualizados ?? 0} actualizados, ${x.desactivados ?? 0} dados de baja.${x.avisos ? ' ' + x.avisos : ''}`);
    if (d) await this.cargar();
  }

  // --------------------------------------------------------------- reglas
  async guardarReglas(cambio: Partial<Estado['reglas']>) {
    const e = this.estado();
    if (!e) return;
    const reglas = { ...e.reglas, ...cambio };
    const d = await this.hacer(() => this.api.multiReglasGuardar(reglas), () => 'Reglas guardadas. Llegan a cada sucursal en su próxima sincronización.');
    if (d) this.estado.set({ ...e, reglas });
  }

  // ------------------------------------------------ precios por sucursal
  async cargarExcepciones() {
    if (!this.sucursalElegida) return;
    this.cargandoFilas.set(true);
    this.error.set(null);
    try {
      const r = await this.api?.multiExcepciones?.({ locationId: this.sucursalElegida });
      if (!r?.success) throw new Error(r?.error || 'No se pudieron leer los precios de la sucursal.');
      const ex = new Map<string, any>((r.data.items ?? []).map((i: any) => [i.product_uuid, i]));
      this.filas.set((r.data.productos ?? []).map((p: any) => {
        const x = ex.get(p.product_uuid);
        return { product_uuid: p.product_uuid, nombre: p.nombre, part_number: p.part_number, categoria: p.categoria,
          price: Number(p.price), especial: x?.price != null ? String(x.price) : '', disponible: x ? x.available !== false : true };
      }));
    } catch (e: any) {
      this.error.set(e?.message ?? 'Error inesperado.');
    } finally {
      this.cargandoFilas.set(false);
    }
  }

  async guardarExcepciones() {
    const nombre = this.otrasSucursales().find((s) => s.valor === this.sucursalElegida)?.etiqueta ?? 'la sucursal';
    const items = this.filas().filter((f) => this.tieneExcepcion(f))
      .map((f) => ({ product_uuid: f.product_uuid, price: this.tieneEspecial(f) ? Number(f.especial) : null, available: f.disponible }));
    await this.hacer(() => this.api.multiExcepcionesGuardar({ locationId: this.sucursalElegida, items }),
      () => items.length ? `${items.length} excepción(es) guardadas para ${nombre}.` : `${nombre} vende todo con los precios de la matriz.`);
  }

  // --------------------------------------------------- usuarios de empresa
  alcanceDe(u: { scope: string[] | null }): string[] { return u.scope ?? []; }

  async cambiarAlcance(u: { id: number; usuario: string; scope: string[] | null }, valores: string[]) {
    /* «Todas» absorbe a las demás: elegirla junto con una sucursal sería
       decir lo mismo dos veces. */
    const scope = valores.includes('*') ? ['*'] : valores;
    const d = await this.hacer(() => this.api.multiUsuarioAlcance({ userId: u.id, scope }),
      () => scope.length ? `«${u.usuario}» es usuario de empresa. Llega a sus sucursales al publicar el catálogo.` : `«${u.usuario}» vuelve a ser solo de la matriz.`);
    if (d) this.usuarios.update((l) => l.map((x) => x.id === u.id ? { ...x, scope: scope.length ? scope : null } : x));
  }
}
