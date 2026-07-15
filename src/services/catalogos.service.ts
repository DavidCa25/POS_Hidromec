import { Injectable } from '@angular/core';

export interface CatalogoItem {
  code: string;
  description: string;
}

@Injectable({ providedIn: 'root' })
export class CatalogosService {
  public readonly supabaseUrl = 'https://swlpspgmkwzlrowllvvj.supabase.co';
  public readonly anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN3bHBzcGdta3d6bHJvd2xsdnZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwNDMyNzAsImV4cCI6MjA5ODYxOTI3MH0.Wyh4fjmhYJp-USPHtrj_dKAJow038Nj62jR44qirmlM';

  private cache = new Map<string, CatalogoItem[]>();

  private cacheKey(catalog: string): string {
    return `wybix_cat_${catalog}`;
  }

  async get(catalog: string, forzarRed = false): Promise<CatalogoItem[]> {
    if (!forzarRed && this.cache.has(catalog)) {
      return this.cache.get(catalog)!;
    }
 
    if (!forzarRed) {
      const guardado = localStorage.getItem(this.cacheKey(catalog));
      if (guardado) {
        try {
          const items = JSON.parse(guardado) as CatalogoItem[];
          this.cache.set(catalog, items);
          // Refresca en segundo plano sin bloquear
          this.refrescar(catalog).catch(() => { /* offline, se queda con cache */ });
          return items;
        } catch { /* cache corrupto, sigue a red */ }
      }
    }
 
    return this.refrescar(catalog);
  }
 
  private async refrescar(catalog: string): Promise<CatalogoItem[]> {
    const endpoint = `${this.supabaseUrl}/functions/v1/fiscal-catalogs?catalog=${encodeURIComponent(catalog)}`;
    const res = await fetch(endpoint, {
      headers: {
        'Authorization': `Bearer ${this.anonKey}`,
        'apikey': this.anonKey
      }
    });
    const out = await res.json();
    if (!out?.success) {
      throw new Error(out?.error || 'No se pudo cargar el catalogo.');
    }
    const items = (out.items ?? []) as CatalogoItem[];
    this.cache.set(catalog, items);
    localStorage.setItem(this.cacheKey(catalog), JSON.stringify(items));
    return items;
  }
 
  async search(catalog: string, term: string, page = 1, pageSize = 20): Promise<CatalogoItem[]> {
    if (!term || term.trim().length < 2) return [];
    const endpoint = `${this.supabaseUrl}/functions/v1/fiscal-catalogs` +
      `?catalog=${encodeURIComponent(catalog)}` +
      `&search=${encodeURIComponent(term.trim())}&page=${page}&pageSize=${pageSize}`;
    const res = await fetch(endpoint, {
      headers: {
        'Authorization': `Bearer ${this.anonKey}`,
        'apikey': this.anonKey
      }
    });
    const out = await res.json();
    if (!out?.success) return [];
    return (out.items ?? []) as CatalogoItem[];
  }
}