import { Injectable, computed, inject, signal } from '@angular/core';
import { ElectronBridge } from './electron-bridge.service';
import { CatalogProduct, LineSource } from './models';

/**
 * Catalogo de venta: productos, categorias, busqueda y cache.
 *
 * Una sola lectura de sp_get_active_products alimenta a Retail y a Touch. La
 * cache se refresca cuando la pantalla lo pide (abrir el buscador) y se
 * invalida al registrar una venta, para que el stock mostrado no se quede
 * viejo. La validacion de stock REAL siempre la hace SQL al vender.
 */
@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly bridge = inject(ElectronBridge);

  readonly products = signal<CatalogProduct[]>([]);
  readonly loadedAt = signal<number>(0);
  readonly loading = signal(false);

  readonly categories = computed(() => {
    const vistos = new Map<string, number>();
    for (const p of this.products()) {
      const n = p.category_name || '';
      if (n) vistos.set(n, (vistos.get(n) ?? 0) + 1);
    }
    return [...vistos.entries()].map(([name, count]) => ({ name, count }));
  });

  private inflight: Promise<CatalogProduct[]> | null = null;

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

  findByBarcode(code: string): CatalogProduct | undefined {
    const key = (code || '').trim().toLowerCase();
    if (!key) return undefined;
    return this.products().find(p => (p.bar_code || '').trim().toLowerCase() === key);
  }

  findByPartNumber(code: string): CatalogProduct | undefined {
    const key = (code || '').trim().toLowerCase();
    if (!key) return undefined;
    return this.products().find(p => (p.part_number || '').toLowerCase() === key);
  }

  findById(id: number): CatalogProduct | undefined {
    return this.products().find(p => p.id === id);
  }

  /** Filtro de texto sobre nombre, parte, codigo, marca y categoria. */
  search(term: string, list: CatalogProduct[] = this.products()): CatalogProduct[] {
    const t = (term || '').trim().toLowerCase();
    if (!t) return list;
    return list.filter(p =>
      (p.product_name || '').toLowerCase().includes(t) ||
      (p.part_number || '').toLowerCase().includes(t) ||
      (p.bar_code || '').toLowerCase().includes(t) ||
      (p.brand_name || '').toLowerCase().includes(t) ||
      (p.category_name || '').toLowerCase().includes(t));
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
    };
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
      allow_decimal_qty: r.allow_decimal_qty != null ? !!r.allow_decimal_qty : undefined,
      has_modifiers: r.has_modifiers != null ? !!r.has_modifiers : undefined,
      thumb: r.thumb ?? null,
    };
  }
}
