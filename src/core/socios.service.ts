import { Injectable, inject } from '@angular/core';
import { ElectronBridge } from './electron-bridge.service';

/*
 * SOCIOS y PROPINAS (0079). docs/socios.md.
 *
 * El reparto real lo hace SQL (sp_socios_asignar) y se congela. Aqui solo se
 * habla con el proceso principal y se calcula el EJEMPLO del asistente, con
 * los duenos que se estan eligiendo y todavia no se guardan. La formula es la
 * misma; la prueba scripts/db/pruebas/socios.mjs la calcula aparte igual.
 */

export type Regla = 'A' | 'B' | 'C';
export type GastoRegla = 'IGUALES' | 'FIJO' | 'VENTAS';

export interface Socio { id: number; nombre: string; user_id: number | null; usuario?: string | null; pct_fijo: number | null; activo: boolean; orden: number; }
export interface ConfigSocios {
  regla: Regla; pct_vende: number; gasto_regla: GastoRegla; faltante_regla: 'IGUALES' | 'VENTAS';
  sin_dueno_socio_id: number | null; liquidacion: 'SEMANAL' | 'MENSUAL'; dia_cierre: number | null;
  inicio: string; activo: boolean; hay_liquidaciones: boolean;
}
export interface CategoriaDueno { categoria_id: number; categoria: string; socio_id: number | null; pct: number | null; productos: number; }
export interface EstadoSocios { config: ConfigSocios | null; socios: Socio[]; categorias: CategoriaDueno[]; productos: any[]; }

/** Lo que manda el asistente (sp_socios_config_guardar). */
export interface PayloadSocios {
  regla: Regla; pctVende: number; gastoRegla: GastoRegla; faltanteRegla: 'IGUALES' | 'VENTAS';
  sinDueno: string | null; liquidacion: 'SEMANAL' | 'MENSUAL'; diaCierre: number | null; inicio: string;
  socios: { clave: string; id?: number; nombre: string; userId: number | null; pctFijo: number | null; activo: boolean }[];
  categorias: { categoriaId: number; duenos: { socio: string; pct: number }[] }[];
}

export interface FilaSocio {
  socio_id: number; nombre: string; activo: boolean; desde: string; hasta: string;
  vendido: number; costo: number; ganancia: number; gastos: number; anticipos: number;
  aportaciones: number; retiros: number; faltantes: number; resultado: number;
  saldo_inicial: number; saldo_final: number;
}

export const REGLAS: { id: Regla; nombre: string; corto: string; cuando: string }[] = [
  { id: 'A', nombre: 'Quien vende', corto: 'Toda la ganancia es de quien vende el producto.',
    cuando: 'Conviene cuando cada quien vende lo suyo y los insumos del otro son pocos.' },
  { id: 'B', nombre: 'Quien aporta', corto: 'La ganancia se reparte según cuánto puso cada quien en insumos.',
    cuando: 'Conviene cuando lo que importa es quién pone el dinero de los insumos.' },
  { id: 'C', nombre: 'Mixta', corto: 'Un porcentaje a quien prepara y vende; el resto, según lo que aportó cada quien.',
    cuando: 'Conviene cuando uno prepara y vende con insumos de los dos: se reconoce el trabajo y el dinero.' },
];

export const GASTO_REGLAS: { id: GastoRegla; nombre: string; ayuda: string }[] = [
  { id: 'IGUALES', nombre: 'Partes iguales', ayuda: 'La renta o la luz se divide igual entre todos.' },
  { id: 'FIJO', nombre: 'Porcentaje fijo', ayuda: 'Cada socio paga un porcentaje que tú decides.' },
  { id: 'VENTAS', nombre: 'Según lo que vende', ayuda: 'Paga más quien vendió más en el periodo.' },
];

/**
 * El reparto de un renglon (docs/socios.md 1.3).
 * vende: socio -> fraccion (dueno del producto); costos: socio -> costo de
 * sus insumos; pctVende: 0..100.
 */
export function repartir(ingreso: number, vende: Map<string, number>, costos: Map<string, number>, pctVende: number)
    : Map<string, { costo: number; ganancia: number; total: number }> {
  const k = pctVende / 100;
  const ctot = [...costos.values()].reduce((a, b) => a + b, 0);
  const ganancia = ingreso - ctot;
  const out = new Map<string, { costo: number; ganancia: number; total: number }>();
  for (const s of new Set([...vende.keys(), ...costos.keys()])) {
    const v = vende.get(s) ?? 0, c = costos.get(s) ?? 0;
    const a = ctot > 0 ? c / ctot : v;
    const g = ganancia * (k * v + (1 - k) * a);
    out.set(s, { costo: c, ganancia: g, total: c + g });
  }
  return out;
}

export const dinero = (n: number | null | undefined) =>
  (Number(n) || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

export interface ConfigPropinas { reparto: 'ATENDIO' | 'HORAS' | 'IGUALES'; sugeridas: string; comision_pct: number; comision_a: 'NEGOCIO' | 'PROPINA'; activo: boolean; }
export const REPARTOS_PROPINA: { id: ConfigPropinas['reparto']; nombre: string; ayuda: string }[] = [
  { id: 'HORAS', nombre: 'Bote por horas trabajadas', ayuda: 'Se junta lo del turno y se reparte según las horas de Asistencia. Recomendado para cafeterías.' },
  { id: 'IGUALES', nombre: 'Bote en partes iguales', ayuda: 'Se junta lo del turno y se reparte igual entre quienes trabajaron.' },
  { id: 'ATENDIO', nombre: 'A quien atendió', ayuda: 'Cada propina es de quien cobró la cuenta. Para negocios con meseros.' },
];

type Resultado<T> = { ok: true; data: T } | { ok: false; error: string };

@Injectable({ providedIn: 'root' })
export class SociosService {
  private readonly bridge = inject(ElectronBridge);

  private async llamar<T>(fn: string, p?: any): Promise<Resultado<T>> {
    const api = this.bridge.api;
    if (!api?.[fn]) return { ok: false, error: 'Socios no está disponible en esta caja.' };
    try {
      const r = await api[fn](p);
      return r?.success ? { ok: true, data: r.data as T } : { ok: false, error: r?.error || 'No se pudo completar.' };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'No se pudo completar.' };
    }
  }

  config() { return this.llamar<EstadoSocios>('sociosConfig'); }
  activar(p: PayloadSocios) { return this.llamar<EstadoSocios>('sociosActivar', p); }
  guardar(p: PayloadSocios) { return this.llamar<EstadoSocios>('sociosConfigGuardar', p); }
  ejemplo(productId?: number | null) {
    return this.llamar<{ producto: any; insumos: any[]; opciones: any[] }>('sociosEjemplo', { productId: productId ?? null });
  }
  duenoProducto(productId: number) { return this.llamar<any[]>('sociosProductoDueno', { productId }); }
  /** Sin dueños (lista vacía): el producto vuelve a ser de su categoría. */
  guardarDuenoProducto(productId: number, duenos: { socioId: number; pct: number }[]) {
    return this.llamar<any[]>('sociosProductoDueno', { productId, duenos });
  }
  resumen(desde?: string | null, hasta?: string | null) { return this.llamar<FilaSocio[]>('sociosResumen', { desde, hasta }); }
  porCorte(desde: string, hasta: string) { return this.llamar<any[]>('sociosPorCorte', { desde, hasta }); }
  liquidar(hasta: string) { return this.llamar<{ liquidacion: any; lineas: any[] }>('sociosLiquidar', { hasta }); }
  liquidaciones() { return this.llamar<any[]>('sociosLiquidaciones'); }
  liquidacion(id: number) { return this.llamar<{ liquidacion: any; lineas: any[] }>('sociosLiquidacion', { id }); }
  movimiento(p: { socioId: number; tipo: 'RETIRO' | 'PAGO' | 'APORTACION'; monto: number; metodo: string; nota?: string | null; registerId?: number | null }) {
    return this.llamar<any>('sociosMovimiento', p);
  }
  movimientos(desde: string, hasta: string) { return this.llamar<any[]>('sociosMovimientos', { desde, hasta }); }

  // ------------------------------------------------------------ propinas
  configPropinas() { return this.llamar<ConfigPropinas | null>('propinasConfig'); }
  activarPropinas(p: { reparto: string; sugeridas: number[]; comisionPct: number; comisionA: string }) {
    return this.llamar<ConfigPropinas>('propinasActivar', p);
  }
  guardarPropinas(p: { reparto: string; sugeridas: number[]; comisionPct: number; comisionA: string }) {
    return this.llamar<ConfigPropinas>('propinasConfigGuardar', p);
  }
  repartirPropinas(registerId: number | null, confirmar: boolean) {
    return this.llamar<{ reparto: any; lineas: any[] }>('propinasRepartir', { registerId, confirmar });
  }
  historialPropinas(desde: string, hasta: string) {
    return this.llamar<{ propinas: any[]; repartos: any[]; lineas: any[] }>('propinasHistorial', { desde, hasta });
  }
}
