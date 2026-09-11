import { Injectable, computed, inject, signal } from '@angular/core';
import { ElectronBridge } from './electron-bridge.service';
import { CatalogProduct, InventoryMode, SelectedOption } from './models';

/*
 * Catalogo del punto de venta Touch.
 *
 * Todo llega en UNA llamada (sp_get_menu_catalog): categorias, productos,
 * grupos, opciones y la relacion entre ellos. Tocar un producto no consulta
 * nada: los modificadores ya estan en memoria. Las miniaturas se sincronizan
 * por version contra la cache local de la caja, asi que solo se descargan
 * las que cambiaron.
 */

export type ModifierRole = 'SIZE' | 'ADDON' | 'SUBSTITUTION' | 'NOTE';
export type ModifierEffect = 'NONE' | 'ADD' | 'REMOVE' | 'SUBSTITUTE' | 'SCALE';

export interface MenuCategory {
  category_id: number | null;
  category_name: string;
  products_count: number;
}

export interface MenuProduct extends CatalogProduct {
  inventory_mode: InventoryMode;
  /** En una receta: que ingrediente se acaba primero y por cuanto. */
  limita_nombre?: string | null;
  limita_stock?: number | null;
  limita_uom?: string | null;
  limita_necesita?: number | null;
  available_units: number;
  image_version: number;
  /** Ruta local de la miniatura, si esta cacheada. */
  thumb: string | null;
}

export interface ModifierOption {
  id: number;
  group_id: number;
  name: string;
  price_delta: number;
  effect: ModifierEffect;
  sort_order: number;
  available_units: number;
}

export interface ModifierGroup {
  id: number;
  name: string;
  role: ModifierRole;
  min_select: number;
  max_select: number;
  required: boolean;
  sort_order: number;
  options: ModifierOption[];
}

@Injectable({ providedIn: 'root' })
export class MenuCatalogService {
  private readonly bridge = inject(ElectronBridge);

  readonly categories = signal<MenuCategory[]>([]);
  readonly products = signal<MenuProduct[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly loadedAt = signal(0);

  /** grupo por id, con sus opciones ya anidadas. */
  private readonly groups = signal<Map<number, ModifierGroup>>(new Map());
  /** producto -> ids de grupo, en orden. */
  private readonly porProducto = signal<Map<number, number[]>>(new Map());

  readonly hayProductos = computed(() => this.products().length > 0);

  private get api(): any {
    return (window as any).wybix ?? null;
  }

  /** ¿Esta instalacion tiene el IPC de Hospitality? */
  get disponible(): boolean {
    return !!this.api?.catalog?.menu;
  }

  async load(force = false): Promise<void> {
    if (!force && this.products().length) return;
    if (!this.disponible) {
      this.error.set('El catálogo Touch no está disponible en este equipo.');
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      const r = await this.api.catalog.menu();
      if (!r?.success) throw new Error(r?.error || 'No se pudo cargar el catálogo.');
      const { categorias = [], productos = [], grupos = [], opciones = [], relaciones = [] } = r.data || {};

      const porGrupo = new Map<number, ModifierGroup>();
      for (const g of grupos) {
        porGrupo.set(Number(g.id), {
          id: Number(g.id), name: g.name, role: g.role, min_select: Number(g.min_select),
          max_select: Number(g.max_select), required: !!g.required, sort_order: Number(g.sort_order), options: [],
        });
      }
      for (const o of opciones) {
        const g = porGrupo.get(Number(o.group_id));
        if (!g) continue;
        g.options.push({
          id: Number(o.id), group_id: Number(o.group_id), name: o.name,
          price_delta: Number(o.price_delta ?? 0), effect: o.effect,
          sort_order: Number(o.sort_order ?? 0), available_units: Number(o.available_units ?? 999999),
        });
      }
      const rel = new Map<number, number[]>();
      for (const x of relaciones) {
        const pid = Number(x.product_id);
        if (!rel.has(pid)) rel.set(pid, []);
        rel.get(pid)!.push(Number(x.group_id));
      }

      this.groups.set(porGrupo);
      this.porProducto.set(rel);
      this.categories.set(categorias.map((c: any) => ({
        category_id: c.category_id != null ? Number(c.category_id) : null,
        category_name: c.category_name,
        products_count: Number(c.products_count ?? 0),
      })));
      this.products.set(productos.map((p: any) => this.conMiniatura(this.normalizar(p))));
      this.loadedAt.set(Date.now());

      // Solo se piden las que faltan: ver sincronizarImagenes().
      this.sincronizarImagenes();
    } catch (e: any) {
      this.error.set(e?.message || 'No se pudo cargar el catálogo.');
      this.products.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  private normalizar(p: any): MenuProduct {
    return {
      id: Number(p.id),
      part_number: p.part_number ?? '',
      bar_code: p.bar_code ?? '',
      product_name: p.product_name ?? '',
      price: Number(p.price ?? 0),
      stock: Number(p.stock ?? 0),
      category_id: p.category_id != null ? Number(p.category_id) : null,
      category_name: p.category_name ?? 'Sin categoría',
      brand_name: '',
      clave_prod_serv: p.clave_prod_serv ?? null,
      clave_unidad: p.clave_unidad ?? null,
      objeto_impuesto: p.objeto_impuesto ?? null,
      tasa_iva: p.tasa_iva != null ? Number(p.tasa_iva) : null,
      inventory_mode: (p.inventory_mode ?? 'DIRECT') as InventoryMode,
      limita_nombre: p.limita_nombre ?? null,
      limita_stock: p.limita_stock != null ? Number(p.limita_stock) : null,
      limita_uom: p.limita_uom ?? null,
      limita_necesita: p.limita_necesita != null ? Number(p.limita_necesita) : null,
      sellable: true,
      allow_decimal_qty: !!p.allow_decimal_qty,
      has_modifiers: !!p.has_modifiers,
      available_units: Number(p.available_units ?? 0),
      image_version: Number(p.image_version ?? 0),
      thumb: null,
    };
  }

  /**
   * Devuelve el producto con la miniatura que ya se tenia, si sigue valiendo.
   *
   * Vale cuando la version del catalogo coincide con la de la cache. Si la
   * foto cambio (image_version distinta) o se quito (image_version 0) el
   * producto se queda sin miniatura y vuelve a pedirse: nunca se muestra una
   * imagen vieja.
   */
  private conMiniatura(p: MenuProduct): MenuProduct {
    if (p.image_version <= 0) { this.miniaturas.delete(p.id); return p; }
    const previa = this.miniaturas.get(p.id);
    // La entrada puede valer null: es un producto cuya version dice que hay
    // foto pero cuya miniatura no existe (se elimino). Tambien se recuerda,
    // para no volver a pedirla en cada recarga.
    if (previa && previa.version === p.image_version) return { ...p, thumb: previa.thumb };
    this.miniaturas.delete(p.id);
    return p;
  }

  /** Pide SOLO las miniaturas que faltan y las asigna a la rejilla. */
  private async sincronizarImagenes(): Promise<void> {
    if (!this.api?.images?.sync) return;
    const versiones: Record<number, number> = {};
    for (const p of this.products()) {
      if (p.image_version <= 0) continue;
      const previa = this.miniaturas.get(p.id);
      // Ya resuelta para esta version -tenga miniatura o no- no se vuelve a pedir.
      if (previa && previa.version === p.image_version) continue;
      versiones[p.id] = p.image_version;
    }
    // Nada nuevo que traer: es el caso normal despues de una venta.
    if (!Object.keys(versiones).length) return;
    try {
      const r = await this.api.images.sync({ versions: versiones });
      if (!r?.success) return;
      const rutas = r.data?.rutas || {};
      // Se recuerda el resultado de TODO lo que se pidio, incluida la
      // ausencia: si la miniatura ya no esta en la base, este producto no
      // vuelve a pedirse hasta que cambie su version.
      for (const id of Object.keys(versiones)) {
        const pid = Number(id);
        const thumb = rutas[pid];
        this.miniaturas.set(pid, { version: versiones[pid], thumb: thumb ? String(thumb) : null });
      }
      this.products.update(list => list.map(p => ({ ...p, thumb: rutas[p.id] ?? p.thumb })));
    } catch { /* sin imagen se muestra la inicial: no bloquea la venta */ }
  }

  /**
   * Miniaturas ya resueltas, por producto y version.
   *
   * Recargar el catalogo despues de una venta refresca existencias, no
   * fotos. Sin esta cache cada recarga volvia a pedir, convertir y mandar
   * por IPC TODAS las miniaturas: con 2000 productos son ~16 MB y algo mas
   * de un segundo por cada cobro, para acabar con las mismas imagenes.
   */
  private readonly miniaturas = new Map<number, { version: number; thumb: string | null }>();

  /** Grupos de modificadores de un producto, en orden, ya con opciones. */
  /**
   * Los grupos de opciones de un producto, cargando el catálogo si hace falta.
   *
   * Existe para Retail. Touch ya trae el catálogo completo en memoria y usa
   * `groupsOf` directamente; Retail vive del catálogo de inventario y no sabía
   * nada de grupos, que es justo por lo que añadía las líneas sin variante y
   * las ventas de productos con receta por tamaño se rechazaban.
   *
   * La carga es perezosa y se hace una sola vez: el primer producto con
   * opciones la paga, el resto ya la encuentra hecha.
   */
  async groupsOfProduct(productId: number): Promise<ModifierGroup[]> {
    if (!this.disponible) return [];
    if (!this.products().length) await this.load();
    return this.groupsOf(productId);
  }

  groupsOf(productId: number): ModifierGroup[] {
    const ids = this.porProducto().get(productId) || [];
    const map = this.groups();
    return ids.map(id => map.get(id)).filter((g): g is ModifierGroup => !!g);
  }

  productsOf(categoryId: number | null): MenuProduct[] {
    if (categoryId == null) return this.products();
    return this.products().filter(p => p.category_id === categoryId);
  }

  search(term: string): MenuProduct[] {
    const t = (term || '').trim().toLowerCase();
    if (!t) return this.products();
    return this.products().filter(p =>
      p.product_name.toLowerCase().includes(t) ||
      (p.part_number || '').toLowerCase().includes(t) ||
      (p.bar_code || '').toLowerCase().includes(t));
  }

  findByBarcode(code: string): MenuProduct | undefined {
    const k = (code || '').trim().toLowerCase();
    if (!k) return undefined;
    return this.products().find(p => (p.bar_code || '').trim().toLowerCase() === k);
  }

  /**
   * ¿Se puede agregar de un toque?
   *
   * Solo si no tiene ningun grupo que obligue a elegir. Un producto con
   * "Tamaño" obligatorio abre la hoja de opciones; uno sin grupos entra
   * directo al carrito.
   */
  needsChoice(p: MenuProduct): boolean {
    if (!p.has_modifiers) return false;
    return this.groupsOf(p.id).some(g => g.required || g.min_select > 0);
  }

  /** Descuenta la disponibilidad estimada tras agregar al carrito. */
  consumeEstimate(productId: number, units: number): void {
    this.products.update(list => list.map(p =>
      p.id === productId && p.available_units < 999999
        ? { ...p, available_units: Math.max(0, p.available_units - units) }
        : p));
  }

  /** Precio efectivo de un producto con las opciones elegidas. */
  static priceWith(p: MenuProduct, options: SelectedOption[]): number {
    return options.reduce((a, o) => a + o.priceDelta * (o.quantity || 1), Number(p.price || 0));
  }
}
