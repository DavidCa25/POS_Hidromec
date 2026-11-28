import { Injectable } from '@angular/core';

/*
 * CARNE POR RENDIMIENTO (0095).
 *
 * Una taquería no pesa 70 g por taco: dice cuántos tacos le salen por kilo
 * y, al cerrar, cuánta carne le quedó. Todo el cálculo vive en SQL
 * (sp_rendimiento_*); este servicio solo habla con `window.wybix.rendimiento`.
 */
export interface CarneConfig {
  carne_id: number; nombre: string; clave: string; rinde: number; activo: boolean;
  existencia_kg: number; costo_kg: number; presentacion_kilo: number | null;
  ultimo_precio_kg: number | null; ultimo_proveedor: number | null; platillos: number;
}
export interface Platillo { product_id: number; nombre: string; carne_id: number; tacos: number; manual: boolean; }
export interface CarneCierre {
  carne_id: number; nombre: string; rinde: number; tenia_kg: number; comprado_kg: number;
  vendidos: number; precio_taco: number | null; costo_kg: number; contado: boolean; quedo_kg: number | null;
}
export interface CarneDia {
  conteo_id: number; carne_id: number; nombre: string; rinde: number; tenia_kg: number; quedo_kg: number; usado_kg: number;
  vendidos: number; esperados: number; faltan: number; valor_faltante: number; rinde_real: number | null;
  costo_taco: number | null; precio_taco: number | null; costo_carne: number; veredicto: 'FALTA' | 'SOBRA' | 'NORMAL';
}
export interface Sugerencia { carne_id: number; nombre: string; rinde: number; conteos: number; promedio: number; sugerido: number; }
export interface ResumenMes {
  periodo: string; comprado_kg: number; comprado: number; tacos: number; se_fueron: number; valor_se_fueron: number;
  costo_carne: number; costo_taco: number | null; pct_perdido: number | null; noches_sin_contar: number;
}
export interface Mes {
  actual: ResumenMes | null; anterior: ResumenMes | null;
  dias: { dow: number; se_fueron: number; valor: number }[];
  carnes: { carne_id: number; nombre: string; rinde: number; usado_kg: number; vendidos: number; rinde_real: number | null; se_fueron: number; valor: number }[];
}

/** Las carnes que ofrece el arranque, con un número a ojo para empezar. */
export const CARNES_TAQUERIA: { clave: string; nombre: string; rinde: number }[] = [
  { clave: 'pastor', nombre: 'Pastor', rinde: 14 },
  { clave: 'bistec', nombre: 'Bistec', rinde: 12 },
  { clave: 'suadero', nombre: 'Suadero', rinde: 13 },
  { clave: 'tripa', nombre: 'Tripa', rinde: 10 },
  { clave: 'longaniza', nombre: 'Longaniza', rinde: 15 },
  { clave: 'cabeza', nombre: 'Cabeza', rinde: 11 },
];

type Resp<T> = { success: boolean; data?: T; error?: string };

@Injectable({ providedIn: 'root' })
export class CarneService {
  private get api(): any { return (window as any).wybix?.rendimiento; }

  private async llamar<T>(metodo: string, p?: unknown): Promise<T> {
    if (!this.api?.[metodo]) throw new Error('Actualiza Wybix para usar el inventario de carne.');
    const r: Resp<T> = await this.api[metodo](p);
    if (!r?.success) throw new Error(r?.error || 'No se pudo completar.');
    return r.data as T;
  }

  config() { return this.llamar<{ carnes: CarneConfig[]; platillos: Platillo[] }>('config'); }
  guardar(carnes: { clave: string; nombre: string; rinde: number; activo: boolean }[]) {
    return this.llamar<{ carnes: CarneConfig[]; platillos: Platillo[] }>('guardar', { carnes });
  }
  cierre(closureId: number | null) { return this.llamar<CarneCierre[]>('cierre', { closureId }); }
  contar(closureId: number | null, conteos: { carneId: number; quedoKg: number }[]) {
    return this.llamar<{ carnes: CarneDia[]; sugerencias: Sugerencia[] }>('contar', { closureId, conteos });
  }
  dia(closureId: number | null) { return this.llamar<{ carnes: CarneDia[]; sugerencias: Sugerencia[] }>('dia', { closureId }); }
  ajustar(carneId: number, rinde: number) { return this.llamar<{ carne_id: number; rinde: number }>('ajustar', { carneId, rinde }); }
  mes(desde: string, hasta: string) { return this.llamar<Mes>('mes', { desde, hasta }); }

  /** ¿Hay alguna carne que preguntar al cierre? Sin el canal, no. */
  async activa(): Promise<boolean> {
    try { return (await this.config()).carnes.some((c) => c.activo); } catch { return false; }
  }
}

/** Kilos para mostrar: sin ceros de más («2.5», «16», «0.75»). */
export const kg = (n: number | null | undefined) => {
  const v = Number(n ?? 0);
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2)));
};
export const pesos = (n: number | null | undefined, dec = 0) =>
  Number(n ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: dec, maximumFractionDigits: dec });
