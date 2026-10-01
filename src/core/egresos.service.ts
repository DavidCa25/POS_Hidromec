import { Injectable, inject } from '@angular/core';
import { ElectronBridge } from './electron-bridge.service';
import { fechaLocal } from './fechas';

/**
 * EGRESOS Y PAGOS AL PERSONAL (migracion 0049).
 *
 * Un solo servicio para las cuatro puertas: el modal de "salida de efectivo"
 * en Venta, la pantalla de Egresos, la de Pagos al personal y el panel de
 * conceptos. Un pago al personal ES un egreso (concepto "Pago al personal"):
 * no hay otro modelo ni otra fuente de verdad.
 *
 * Aqui no hay reglas: si un egreso en efectivo necesita turno, de que caja
 * sale o que datos exige un pago al personal lo decide SQL. Este servicio
 * solo habla con el proceso principal y deja los errores tal como llegan.
 */

export type FormaEgreso = 'EFECTIVO' | 'TRANSFERENCIA' | 'TARJETA' | 'OTRO';
export type PeriodoPago = 'DIA' | 'SEMANA' | 'OTRO';

export interface ConceptoEgreso {
  id: number;
  name: string;
  kind: 'GENERAL' | 'PERSONAL';
  is_system: boolean;
  active: boolean;
  sort_order: number;
  usos: number;
}

export interface PersonaPago { id: number; usuario: string; rol: string; active: boolean; pagos: number; }

export interface NuevoEgreso {
  category_id: number;
  amount: number;
  payment_method: FormaEgreso;
  expense_date?: string | null;
  note?: string | null;
  beneficiary?: string | null;
  staff_user_id?: number | null;
  period_kind?: PeriodoPago | null;
  period_from?: string | null;
  period_to?: string | null;
  register_id?: number | null;
}

export interface FiltroEgresos {
  date_from?: string | null;
  date_to?: string | null;
  category_id?: number | null;
  payment_method?: FormaEgreso | null;
  staff_user_id?: number | null;
  only_staff?: boolean;
  include_voided?: boolean;
}

export interface FilaEgreso {
  id: number;
  expense_date: string;
  created_at: string;
  category_id: number;
  category_name: string;
  category_kind: 'GENERAL' | 'PERSONAL';
  amount: number;
  payment_method: FormaEgreso;
  note: string | null;
  beneficiary: string | null;
  staff_user_id: number | null;
  staff_name: string | null;
  period_kind: PeriodoPago | null;
  period_from: string | null;
  period_to: string | null;
  user_name: string | null;
  register_name: string | null;
  cash_movement_id: number | null;
  voided_at: string | null;
  voided_by_name: string | null;
  void_reason: string | null;
  cancelable: boolean;
}

export interface ReporteEgresos {
  filas: FilaEgreso[];
  porConcepto: { category_id: number; category_name: string; category_kind: string; total: number; egresos: number }[];
  porPersona: { staff_user_id: number; staff_name: string; total: number; pagos: number }[];
  porForma: { payment_method: FormaEgreso; total: number; egresos: number }[];
  total: { total: number; del_cajon: number; egresos: number; date_from?: string; date_to?: string };
}

export const FORMAS_EGRESO: { valor: FormaEgreso; etiqueta: string; icono: string }[] = [
  { valor: 'EFECTIVO', etiqueta: 'Efectivo', icono: 'ph-money' },
  { valor: 'TRANSFERENCIA', etiqueta: 'Transferencia', icono: 'ph-bank' },
  { valor: 'TARJETA', etiqueta: 'Tarjeta', icono: 'ph-credit-card' },
  { valor: 'OTRO', etiqueta: 'Otro', icono: 'ph-dots-three-circle' },
];

export const PERIODOS_PAGO: { valor: PeriodoPago; etiqueta: string }[] = [
  { valor: 'DIA', etiqueta: 'Día' },
  { valor: 'SEMANA', etiqueta: 'Semana' },
  { valor: 'OTRO', etiqueta: 'Otro periodo' },
];

export const etiquetaForma = (f: string | null | undefined): string =>
  FORMAS_EGRESO.find(x => x.valor === f)?.etiqueta ?? (f || '');

/** Rangos de consulta en fechas locales (nunca `toISOString`: cambia el dia de noche). */
export function rangoEgresos(preset: 'HOY' | 'SEMANA' | 'MES' | 'MES_ANTERIOR'): { desde: string; hasta: string } {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  if (preset === 'HOY') return { desde: fechaLocal(hoy), hasta: fechaLocal(hoy) };
  if (preset === 'SEMANA') {
    const ini = new Date(hoy);
    const dow = ini.getDay();
    ini.setDate(ini.getDate() + ((dow === 0 ? -6 : 1) - dow));
    return { desde: fechaLocal(ini), hasta: fechaLocal(hoy) };
  }
  if (preset === 'MES') return { desde: fechaLocal(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), hasta: fechaLocal(hoy) };
  const ini = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  const fin = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
  return { desde: fechaLocal(ini), hasta: fechaLocal(fin) };
}

@Injectable({ providedIn: 'root' })
export class EgresosService {
  private readonly bridge = inject(ElectronBridge);
  private get api(): any { return this.bridge.api; }

  private async llamar<T>(fn: string, payload?: any): Promise<{ ok: boolean; data?: T; error?: string }> {
    const f = this.api?.[fn];
    if (typeof f !== 'function') return { ok: false, error: 'Esta función no está disponible en esta versión.' };
    try {
      const r = await f(payload);
      if (!r?.success) return { ok: false, error: r?.error || 'No se pudo completar la operación.' };
      return { ok: true, data: r.data as T };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'No se pudo completar la operación.' };
    }
  }

  async conceptos(incluirInactivos = false): Promise<ConceptoEgreso[]> {
    const r = await this.llamar<any[]>('egresosConceptos', { include_inactive: incluirInactivos });
    return (r.data ?? []).map(c => ({
      id: Number(c.id), name: String(c.name), kind: c.kind, is_system: !!c.is_system,
      active: !!c.active, sort_order: Number(c.sort_order), usos: Number(c.usos ?? 0),
    }));
  }

  guardarConcepto(c: { id?: number | null; name: string; active?: boolean }) {
    return this.llamar<any[]>('egresosConceptoGuardar', c);
  }

  moverConcepto(id: number, direction: -1 | 1) {
    return this.llamar('egresosConceptoMover', { id, direction });
  }

  async personal(): Promise<PersonaPago[]> {
    const r = await this.llamar<any[]>('egresosPersonal');
    return (r.data ?? []).map(p => ({
      id: Number(p.id), usuario: String(p.usuario), rol: String(p.rol ?? ''),
      active: !!p.active, pagos: Number(p.pagos ?? 0),
    }));
  }

  registrar(e: NuevoEgreso) {
    return this.llamar<any[]>('egresosRegistrar', e);
  }

  cancelar(expenseId: number, reason: string) {
    return this.llamar('egresosCancelar', { expense_id: expenseId, reason });
  }

  async listar(f: FiltroEgresos): Promise<{ ok: boolean; data?: ReporteEgresos; error?: string }> {
    return this.llamar<ReporteEgresos>('egresosListar', f);
  }
}
