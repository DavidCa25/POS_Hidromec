import { Injectable, inject, signal } from '@angular/core';
import { ElectronBridge } from './electron-bridge.service';

/*
 * Cliente del dominio Hospitality para el Backoffice: unidades,
 * ingredientes, recetas, modificadores, presentaciones e imagenes.
 *
 * Es una fachada delgada sobre `window.wybix.*`: no calcula nada. Toda la
 * validacion vive en los procedures (una receta no puede consumir otra
 * receta, una unidad debe ser de la misma dimension, etc.), asi que la UI no
 * puede saltarsela ni duplicarla.
 */

export interface Uom {
  code: string;
  name: string;
  dimension: 'COUNT' | 'WEIGHT' | 'VOLUME' | 'LENGTH';
  factor_to_base: number;
  is_base: boolean;
  sort_order: number;
}

export interface Ingredient {
  id: number;
  product_name: string;
  part_number: string;
  base_uom: string;
  dimension: string;
  stock: number;
  cost: number | null;
  category_name: string | null;
}

export interface RecipeHeader {
  recipe_id: number;
  product_id: number;
  variant_option_id: number | null;
  requested_variant_option_id: number | null;
  is_fallback: boolean;
  notes: string | null;
  product_name: string;
  unit_cost: number;
}

export interface RecipeLine {
  recipe_line_id: number;
  ingredient_product_id: number;
  ingredient_name: string;
  base_uom: string;
  dimension: string;
  qty_base: number;
  input_qty: number;
  input_uom: string;
  waste_pct: number;
  sort_order: number;
  ingredient_stock: number;
  ingredient_cost: number | null;
  line_cost: number;
}

export interface ModifierGroupRow {
  id: number;
  name: string;
  role: 'SIZE' | 'ADDON' | 'SUBSTITUTION' | 'NOTE';
  min_select: number;
  max_select: number;
  required: boolean;
  active: boolean;
  sort_order: number;
  products_count: number;
}

export interface ModifierOptionRow {
  id: number;
  group_id: number;
  name: string;
  price_delta: number;
  effect: 'NONE' | 'ADD' | 'REMOVE' | 'SUBSTITUTE' | 'SCALE';
  ingredient_product_id: number | null;
  ingredient_name: string | null;
  ingredient_uom: string | null;
  replaces_product_id: number | null;
  replaces_name: string | null;
  qty_base: number | null;
  qty_factor: number | null;
  active: boolean;
  sort_order: number;
}

export interface Presentation {
  id: number;
  product_id: number;
  name: string;
  factor_to_base: number;
  is_default: boolean;
  active: boolean;
  base_uom: string;
}

type R<T> = { success: boolean; data?: T; error?: string };

@Injectable({ providedIn: 'root' })
export class HospitalityService {
  private readonly bridge = inject(ElectronBridge);

  readonly uoms = signal<Uom[]>([]);

  private get api(): any { return (window as any).wybix ?? null; }

  get disponible(): boolean { return !!this.api?.recipes?.get; }

  private ok<T>(r: any, fallback: T): T {
    if (!r?.success) throw new Error(r?.error || 'Operación no disponible.');
    return (r.data ?? fallback) as T;
  }

  // ------------------------------------------------------------- unidades
  async loadUoms(force = false): Promise<Uom[]> {
    if (!force && this.uoms().length) return this.uoms();
    const r = await this.api?.catalog?.uoms?.();
    const list = this.ok<Uom[]>(r, []).map(u => ({ ...u, factor_to_base: Number(u.factor_to_base), is_base: !!u.is_base }));
    this.uoms.set(list);
    return list;
  }

  /** Unidades compatibles con la unidad base de un ingrediente. */
  uomsFor(baseUom: string): Uom[] {
    const base = this.uoms().find(u => u.code === baseUom);
    if (!base) return this.uoms();
    return this.uoms().filter(u => u.dimension === base.dimension);
  }

  ingredients(search?: string): Promise<Ingredient[]> {
    return this.api.catalog.ingredients({ search: search ?? null }).then((r: any) => this.ok<Ingredient[]>(r, []));
  }

  // -------------------------------------------------------------- recetas
  async getRecipe(productId: number, variantOptionId: number | null = null): Promise<{ header: RecipeHeader | null; lines: RecipeLine[] }> {
    const r = await this.api.recipes.get({ productId, variantOptionId });
    if (!r?.success) throw new Error(r?.error || 'No se pudo cargar la receta.');
    return { header: r.data?.header ?? null, lines: r.data?.lines ?? [] };
  }

  async saveRecipe(payload: {
    productId: number;
    variantOptionId?: number | null;
    notes?: string | null;
    lines: { ingredientProductId: number; inputQty: number; inputUom: string; wastePct?: number; sortOrder?: number }[];
  }): Promise<number> {
    const r = await this.api.recipes.save(payload);
    if (!r?.success) throw new Error(r?.error || 'No se pudo guardar la receta.');
    return r.recipeId;
  }

  async deleteRecipe(recipeId: number): Promise<void> {
    const r = await this.api.recipes.remove({ recipeId });
    if (!r?.success) throw new Error(r?.error || 'No se pudo eliminar la receta.');
  }

  // --------------------------------------------------------- modificadores
  async modifierGroups(productId: number | null = null, onlyActive = false): Promise<{ grupos: ModifierGroupRow[]; opciones: ModifierOptionRow[] }> {
    const r = await this.api.modifiers.list({ productId, onlyActive });
    if (!r?.success) throw new Error(r?.error || 'No se pudieron cargar los modificadores.');
    return { grupos: r.data?.grupos ?? [], opciones: r.data?.opciones ?? [] };
  }

  async saveModifierGroup(payload: {
    groupId?: number | null; name: string; role: string;
    minSelect?: number; maxSelect?: number; required?: boolean; active?: boolean; sortOrder?: number;
    options: { id?: number | null; name: string; priceDelta?: number; effect: string;
               ingredientProductId?: number | null; replacesProductId?: number | null;
               qtyBase?: number | null; qtyFactor?: number | null; active?: boolean; sortOrder?: number }[];
  }): Promise<number> {
    const r = await this.api.modifiers.save(payload);
    if (!r?.success) throw new Error(r?.error || 'No se pudo guardar el grupo.');
    return r.groupId;
  }

  async deleteModifierGroup(groupId: number): Promise<string> {
    const r = await this.api.modifiers.remove({ groupId });
    if (!r?.success) throw new Error(r?.error || 'No se pudo eliminar el grupo.');
    return r.data?.[0]?.result ?? 'DELETED';
  }

  async setProductGroups(productId: number, groupIds: number[]): Promise<void> {
    const r = await this.api.modifiers.setProductGroups({ productId, groupIds });
    if (!r?.success) throw new Error(r?.error || 'No se pudieron asignar los grupos.');
  }

  // ------------------------------------------------------- presentaciones
  presentations(productId: number | null = null): Promise<Presentation[]> {
    return this.api.presentations.list({ productId }).then((r: any) => this.ok<Presentation[]>(r, []));
  }

  async savePresentation(p: { id?: number | null; productId: number; name: string; factorToBase: number; isDefault?: boolean; active?: boolean }): Promise<number> {
    const r = await this.api.presentations.save(p);
    if (!r?.success) throw new Error(r?.error || 'No se pudo guardar la presentación.');
    return r.data?.[0]?.id ?? 0;
  }

  async deletePresentation(id: number): Promise<string> {
    const r = await this.api.presentations.remove({ id });
    if (!r?.success) throw new Error(r?.error || 'No se pudo eliminar la presentación.');
    return r.data?.[0]?.result ?? 'DELETED';
  }

  // -------------------------------------------------------------- imagenes
  async setImage(productId: number, dataUrl: string | null): Promise<void> {
    const r = await this.api.images.set({ productId, dataUrl });
    if (!r?.success) throw new Error(r?.error || 'No se pudo guardar la imagen.');
  }
}
