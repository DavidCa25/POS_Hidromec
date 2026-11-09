import { Injectable, computed, inject, signal } from '@angular/core';
import { ElectronBridge } from './electron-bridge.service';
import { CatalogProduct, LineSource } from './models';

/**
 * Catalogo de venta: productos, categorias, busqueda y cache.
 *
 * Una sola lectura de sp_get_active_products alimenta a Retail y a Touch. La
 * validacion de stock REAL siempre la hace SQL al vender.
 *
 * CATALOGOS GRANDES (5,000 productos o mas)
 * ----------------------------------------
 * Leer SQL tarda poco (~70 ms con 6,000); lo caro era la pantalla: el
 * buscador pintaba todas las tarjetas y releia el catalogo ANTES de abrirse,
 * cada vez. Ahora:
 *   - lo que ya se leyo se muestra al instante y se refresca en segundo plano
 *     (`refrescarEnFondo`), solo si tiene mas de `VIGENCIA_MS` o una venta lo
 *     marco viejo (`marcarViejo`): el stock no se queda atras, pero nadie
 *     espera por el;
 *   - buscar usa un indice con el texto ya en minusculas (`buscar`), y
 *     devuelve los primeros `limite` y cuantos hay en total: la pantalla pinta
 *     decenas, no miles.
 */
@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly bridge = inject(ElectronBridge);

  readonly products = signal<CatalogProduct[]>([]);
  readonly loadedAt = signal<number>(0);
  readonly loading = signal(false);

  /**
   * Lo que se puede cobrar.
   *
   * `sp_get_active_products` devuelve TODOS los activos, ingredientes
   * incluidos, porque Inventario y Compras los necesitan: la leche se compra
   * aunque no se venda. Filtrar es cosa de quien vende, y hasta ahora solo lo
   * hacia Touch -en SQL, dentro de `sp_get_menu_catalog`-; el buscador de
   * Retail listaba los insumos y dejaba agregarlos a la venta.
   *
   * `undefined` significa que la fila viene de un origen que no trae la
   * columna. Ahi lo seguro es tratarla como vendible: nunca esconder algo que
   * si se cobra.
   */
  readonly vendibles = computed(() => this.products().filter(p => p.sellable !== false));

  readonly categories = computed(() => {
    const vistos = new Map<string, number>();
    for (const p of this.vendibles()) {
      const n = p.category_name || '';
      if (n) vistos.set(n, (vistos.get(n) ?? 0) + 1);
    }
    return [...vistos.entries()].map(([name, count]) => ({ name, count }));
  });

  private inflight: Promise<CatalogProduct[]> | null = null;

  /** Cuanto vale lo leido antes de refrescarlo en segundo plano. */
  static readonly VIGENCIA_MS = 60_000;

  /**
   * El texto en que se busca, ya en minusculas: nombre, parte, codigo, marca y
   * categoria. Se arma UNA vez por lectura del catalogo, no por tecla.
   */
  private readonly indice = computed(() => this.vendibles().map(p => ({
    p,
    texto: `${p.product_name || ''}${p.part_number || ''}${p.bar_code || ''}${p.brand_name || ''}${p.category_name || ''}`.toLowerCase(),
  })));
  /** Por codigo de barras y por numero de parte: el escaner no recorre 6,000. */
  private readonly porCodigo = computed(() => {
    const m = new Map<string, CatalogProduct>();
    for (const p of this.vendibles()) {
      const b = (p.bar_code || '').trim().toLowerCase();
      if (b && !m.has(b)) m.set(b, p);
    }
    return m;
  });
  private readonly porParte = computed(() => {
    const m = new Map<string, CatalogProduct>();
    for (const p of this.vendibles()) {
      const k = (p.part_number || '').toLowerCase();
      if (k && !m.has(k)) m.set(k, p);
    }
    return m;
  });
  private readonly porId = computed(() => new Map(this.products().map(p => [p.id, p])));

  /** Carga (o reutiliza) el catalogo. `force` vuelve a leer de SQL. */
  async load(force = false): Promise<CatalogProduct[]> {
    if (!force && this.products().length) return this.products();
    if (this.inflight) return this.inflight;
    this.loading.set(true);
    this.inflight = (async () => {
      try {
        const rs = await this.bridge.api?.getActiveProducts?.();
        const rows = this.bridge.filas(rs);
        const list = rows.map(r => CatalogService.normalizar(r));
        this.products.set(list);
        this.loadedAt.set(Date.now());
        return list;
      } catch {
        this.products.set([]);
        return [];
      } finally {
        this.loading.set(false);
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  invalidate(): void {
    this.loadedAt.set(0);
    this.products.set([]);
  }

  /**
   * Lo leido ya no esta al dia (se vendio algo), pero se sigue mostrando: la
   * siguiente pantalla que lo pida lo refresca en segundo plano en vez de
   * esperar con la lista vacia.
   */
  marcarViejo(): void { this.loadedAt.set(0); }

  /**
   * Para pantallas que muestran el catalogo al abrirse: si no hay nada, espera
   * la lectura; si ya hay, NO espera y solo relee en segundo plano cuando lo
   * leido es viejo. Devuelve lo que hay para pintar ya.
   */
  async refrescarEnFondo(): Promise<CatalogProduct[]> {
    if (!this.products().length) return this.load(true);
    if (Date.now() - this.loadedAt() > CatalogService.VIGENCIA_MS) void this.load(true);
    return this.products();
  }

  /** Solo entre lo vendible: el escaner tampoco debe colar un ingrediente. */
  findByBarcode(code: string): CatalogProduct | undefined {
    const key = (code || '').trim().toLowerCase();
    return key ? this.porCodigo().get(key) : undefined;
  }

  findByPartNumber(code: string): CatalogProduct | undefined {
    const key = (code || '').trim().toLowerCase();
    return key ? this.porParte().get(key) : undefined;
  }

  /**
   * Por id, sobre el catalogo COMPLETO: una venta guardada puede referirse a
   * un producto que hoy ya no se vende, y esa linea tiene que poder leerse.
   */
  findById(id: number): CatalogProduct | undefined {
    return this.porId().get(id);
  }

  /** Filtro de texto sobre nombre, parte, codigo, marca y categoria. */
  search(term: string, list: CatalogProduct[] = this.vendibles()): CatalogProduct[] {
    const t = (term || '').trim().toLowerCase();
    if (!t) return list;
    if (list === this.vendibles()) return this.indice().filter(x => x.texto.includes(t)).map(x => x.p);
    return list.filter(p =>
      (p.product_name || '').toLowerCase().includes(t) ||
      (p.part_number || '').toLowerCase().includes(t) ||
      (p.bar_code || '').toLowerCase().includes(t) ||
      (p.brand_name || '').toLowerCase().includes(t) ||
      (p.category_name || '').toLowerCase().includes(t));
  }

  /**
   * Lo que pinta un buscador: los primeros `limite` que coinciden y cuantos
   * hay en total. Sin texto y con un catalogo grande, primero lo ultimo que se
   * dio de alta (lo que mas probablemente se busca recien capturado); con
   * texto, en el orden del catalogo.
   */
  buscar(term: string, limite = 120): { items: CatalogProduct[]; total: number } {
    const t = (term || '').trim().toLowerCase();
    const idx = this.indice();
    if (!t) {
      if (idx.length <= limite) return { items: idx.map(x => x.p), total: idx.length };
      const items: CatalogProduct[] = [];
      for (let i = idx.length - 1; i >= 0 && items.length < limite; i--) items.push(idx[i].p);
      return { items, total: idx.length };
    }
    const items: CatalogProduct[] = [];
    let total = 0;
    for (const x of idx) {
      if (!x.texto.includes(t)) continue;
      total++;
      if (items.length < limite) items.push(x.p);
    }
    return { items, total };
  }

  /** Traduce un producto de catalogo a la fuente de una linea de carrito. */
  static toLineSource(p: CatalogProduct): LineSource {
    return {
      productId: p.id,
      productName: p.product_name,
      unitPrice: Number(p.price ?? 0),
      claveProdServ: p.clave_prod_serv ?? null,
      claveUnidad: p.clave_unidad ?? null,
      objetoImpuesto: p.objeto_impuesto ?? null,
      tasaIva: p.tasa_iva ?? null,
      inventoryMode: p.inventory_mode,
      /* Mismo criterio que Inventario al elegir la unidad: lo que no es pieza
         se vende con decimales. Solo mercancía de existencia directa: una
         receta o un producto de menú se venden por unidad aunque se midan en ml. */
      decimal: CatalogService.esGranel(p),
    };
  }

  /** ¿Se vende por peso o medida? Ver `LineSource.decimal`. */
  static esGranel(p: { allow_decimal_qty?: boolean | number | null; base_uom?: string | null; inventory_mode?: string | null }): boolean {
    if (p.inventory_mode && p.inventory_mode !== 'DIRECT') return false;
    return !!p.allow_decimal_qty || (!!p.base_uom && p.base_uom !== 'pza');
  }

  static normalizar(r: any): CatalogProduct {
    return {
      id: Number(r.id),
      part_number: r.part_number ?? '',
      bar_code: r.bar_code ?? r.barcode ?? r.barCode ?? '',
      product_name: r.product_name ?? r.nombre ?? r.name ?? '',
      price: Number(r.price ?? 0),
      stock: Number(r.stock ?? 0),
      category_id: r.category_id != null ? Number(r.category_id) : null,
      category_name: r.category_name ?? '',
      brand_name: r.brand_name ?? '',
      clave_prod_serv: r.clave_prod_serv ?? null,
      clave_unidad: r.clave_unidad ?? null,
      objeto_impuesto: r.objeto_impuesto ?? null,
      tasa_iva: r.tasa_iva != null ? Number(r.tasa_iva) : null,
      inventory_mode: r.inventory_mode ?? undefined,
      sellable: r.sellable != null ? !!r.sellable : undefined,
      base_uom: r.base_uom ?? undefined,
      // Sin la columna se cae al stock: una base anterior a este cambio sigue
      // mostrando lo mismo que mostraba antes, no un cero nuevo.
      available_units: r.available_units != null ? Number(r.available_units) : Number(r.stock ?? 0),
      limita_nombre: r.limita_nombre ?? null,
      limita_stock: r.limita_stock != null ? Number(r.limita_stock) : null,
      limita_uom: r.limita_uom ?? null,
      limita_necesita: r.limita_necesita != null ? Number(r.limita_necesita) : null,
      allow_decimal_qty: r.allow_decimal_qty != null ? !!r.allow_decimal_qty : undefined,
      has_modifiers: r.has_modifiers != null ? !!r.has_modifiers : undefined,
      thumb: r.thumb ?? null,
    };
  }
}
