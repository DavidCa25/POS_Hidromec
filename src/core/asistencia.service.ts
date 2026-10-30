import { Injectable, inject } from '@angular/core';
import { ElectronBridge } from './electron-bridge.service';

/*
 * ASISTENCIA (0071): entradas, descansos y salidas en la caja; horas
 * trabajadas y extra. No es nomina: no calcula pagos.
 *
 * Aqui no hay reglas ni calculo: los hace SQL (sp_asistencia_*). Este
 * servicio solo habla con el proceso principal y dice, en palabras, que
 * significa cada respuesta.
 */

export type TipoMarca = 'ENTRADA' | 'INICIO_DESCANSO' | 'FIN_DESCANSO' | 'SALIDA';

/** Las respuestas al activar. Son las reglas del negocio. */
export interface ReglasAsistencia {
  cuentaExtra: boolean;
  tolerancia: boolean;
  descansoPagado: boolean;
  diaLibreExtra: boolean;
  marcaRetardos: boolean;
  entradaParaVender: boolean;
}

export interface PreguntaAsistencia {
  clave: keyof ReglasAsistencia;
  texto: string;
  ayuda: string;
  /** Lo que se propone. Se puede cambiar; nada viene escondido. */
  sugerida: boolean;
}

/**
 * Las preguntas de "Activar Asistencia". Pocas, solo las que cambian el
 * numero que ve el dueno. Son datos: la pantalla de activacion y la de
 * reglas pintan esta misma lista.
 */
export const PREGUNTAS_ASISTENCIA: PreguntaAsistencia[] = [
  { clave: 'cuentaExtra', texto: '¿Se cuentan horas extra?',
    ayuda: 'Lo que pase de la hora de salida del horario de cada persona.', sugerida: true },
  { clave: 'tolerancia', texto: '¿Hay 10 minutos de tolerancia?',
    ayuda: 'Salir a las 16:08 con salida a las 16:00 no cuenta como extra; llegar 8:08 no es retardo.', sugerida: true },
  { clave: 'descansoPagado', texto: '¿El descanso cuenta como tiempo trabajado?',
    ayuda: 'Si es no, el descanso se resta de las horas del día.', sugerida: false },
  { clave: 'diaLibreExtra', texto: '¿Trabajar en su día de descanso es todo extra?',
    ayuda: 'Todas las horas de ese día se cuentan como extra.', sugerida: true },
  { clave: 'marcaRetardos', texto: '¿Se marcan los retardos?',
    ayuda: 'Entrar después de la hora del horario aparece en la tabla.', sugerida: true },
  { clave: 'entradaParaVender', texto: '¿Hay que checar entrada antes de cobrar?',
    ayuda: 'Si es sí, la caja no cobra a quien no ha checado su entrada.', sugerida: false },
];

export function reglasSugeridas(): ReglasAsistencia {
  return Object.fromEntries(PREGUNTAS_ASISTENCIA.map(p => [p.clave, p.sugerida])) as unknown as ReglasAsistencia;
}

/** Lo que devuelve SQL en sp_asistencia_reglas_get, a palabras de pantalla. */
export function reglasDeFila(f: any): ReglasAsistencia {
  return {
    cuentaExtra: !!f?.cuenta_extra,
    tolerancia: Number(f?.tolerancia_min) > 0,
    descansoPagado: !!f?.descanso_pagado,
    diaLibreExtra: !!f?.dia_libre_extra,
    marcaRetardos: !!f?.marca_retardos,
    entradaParaVender: !!f?.entrada_para_vender,
  };
}

export interface EstadoAsistencia {
  user_id: number;
  usuario: string;
  activa: boolean;
  entrada_para_vender: boolean;
  ahora: string;
  jornada_id: number | null;
  entrada_en: string | null;
  en_descanso: boolean;
  descanso_desde: string | null;
  trabajado_min: number;
  descanso_min: number;
  horario_entrada: string | null;
  horario_salida: string | null;
  horario_descanso_min: number | null;
  puede_entrada: boolean;
  puede_descanso: boolean;
  puede_fin_descanso: boolean;
  puede_salida: boolean;
}

export interface DiaAsistencia {
  user_id: number;
  dia: string;
  entrada: string | null;
  salida: string | null;
  trabajado_min: number;
  descanso_min: number;
  extra_min: number;
  retardo_min: number;
  abierta: boolean;
  revisar: boolean;
  corregida: boolean;
  jornadas: number;
  tiene_horario: boolean;
  dia_libre: boolean;
}

export interface PersonaAsistencia { user_id: number; usuario: string; rol: string; active: boolean; }
export interface HorarioDia { user_id?: number; weekday: number; entrada: string; salida: string; descanso_min: number; }

export interface ResumenAsistencia { dias: DiaAsistencia[]; personas: PersonaAsistencia[]; horarios: HorarioDia[]; }

type Resultado<T> = { ok: true; data: T } | { ok: false; error: string };

/** 1 = lunes ... 7 = domingo, como en SQL. */
export const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

/** `512` -> `8:32`. Las horas se leen como reloj, no como decimal. */
export function horasMin(min: number | null | undefined): string {
  const m = Math.max(0, Math.round(Number(min) || 0));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

@Injectable({ providedIn: 'root' })
export class AsistenciaService {
  private readonly bridge = inject(ElectronBridge);

  private async llamar<T>(fn: string, p?: any): Promise<Resultado<T>> {
    const api = this.bridge.api;
    if (!api?.[fn]) return { ok: false, error: 'Asistencia no está disponible en esta caja.' };
    try {
      const r = await api[fn](p);
      return r?.success ? { ok: true, data: r.data as T } : { ok: false, error: r?.error || 'No se pudo completar.' };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'No se pudo completar.' };
    }
  }

  estado() { return this.llamar<EstadoAsistencia | null>('asistenciaEstado'); }
  marcar(tipo: TipoMarca, registerId?: number | null) {
    return this.llamar<EstadoAsistencia | null>('asistenciaMarcar', { tipo, registerId: registerId ?? null });
  }
  misHoras(desde: string, hasta: string) { return this.llamar<ResumenAsistencia>('asistenciaMisHoras', { desde, hasta }); }
  reglas() { return this.llamar<any>('asistenciaReglas'); }
  activar(r: ReglasAsistencia) { return this.llamar<any>('asistenciaActivar', r); }
  guardarReglas(r: ReglasAsistencia) { return this.llamar<any>('asistenciaReglasGuardar', r); }
  resumen(desde: string, hasta: string, personaId?: number | null) {
    return this.llamar<ResumenAsistencia>('asistenciaResumen', { desde, hasta, personaId: personaId ?? null });
  }
  jornadas(personaId: number, desde: string, hasta: string) {
    return this.llamar<{ jornadas: any[]; descansos: any[]; correcciones: any[] }>('asistenciaJornadas', { personaId, desde, hasta });
  }
  corregir(p: { jornadaId?: number | null; personaId?: number | null; entrada: string; salida?: string | null; motivo: string }) {
    return this.llamar<{ jornada_id: number }>('asistenciaCorregir', p);
  }
  horario(personaId: number | null) { return this.llamar<HorarioDia[]>('asistenciaHorario', { personaId }); }
  guardarHorario(personaId: number, dias: { weekday: number; entrada: string; salida: string; descansoMin: number }[]) {
    return this.llamar<HorarioDia[]>('asistenciaHorarioGuardar', { personaId, dias });
  }
}
