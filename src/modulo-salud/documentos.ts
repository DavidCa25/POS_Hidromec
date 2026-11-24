import { TipoDocumento } from './salud.service';

/**
 * LOS DOCUMENTOS DEL EXPEDIENTE, COMO DATOS.
 *
 * Cada tipo es una lista de campos. El editor y la vista los recorren: un
 * documento nuevo (una nota de enfermería, un certificado médico) es una
 * entrada aquí, no otra pantalla. El contenido se guarda como JSON con estas
 * mismas claves, así que lo que se escribió hace cinco años se sigue
 * leyendo aunque el formulario cambie.
 */

export type TipoCampo = 'texto' | 'area' | 'vitales' | 'medicamentos';

export interface Campo { clave: string; texto: string; tipo: TipoCampo; ayuda?: string; obligatorio?: boolean; }

export interface DefinicionDocumento {
  tipo: TipoDocumento;
  nombre: string;
  icono: string;
  /** Lleva diagnósticos CIE-10. */
  diagnosticos: boolean;
  /** Se imprime para el paciente (receta, solicitud, referencia, consentimiento). */
  imprimible: boolean;
  campos: Campo[];
}

export const SIGNOS: { clave: string; texto: string; unidad: string }[] = [
  { clave: 'ta', texto: 'T/A', unidad: 'mmHg' },
  { clave: 'fc', texto: 'FC', unidad: 'lpm' },
  { clave: 'fr', texto: 'FR', unidad: 'rpm' },
  { clave: 'temp', texto: 'Temp.', unidad: '°C' },
  { clave: 'sat', texto: 'SatO₂', unidad: '%' },
  { clave: 'peso', texto: 'Peso', unidad: 'kg' },
  { clave: 'talla', texto: 'Talla', unidad: 'cm' },
];

export interface LineaReceta { medicamento: string; dosis: string; via: string; frecuencia: string; duracion: string; cantidad: string; }

export const DOCUMENTOS: DefinicionDocumento[] = [
  {
    tipo: 'NOTA', nombre: 'Nota de evolución', icono: 'ph-note-pencil', diagnosticos: true, imprimible: false,
    campos: [
      { clave: 'subjetivo', texto: 'Motivo y padecimiento (S)', tipo: 'area', obligatorio: true },
      { clave: 'vitales', texto: 'Signos vitales', tipo: 'vitales' },
      { clave: 'objetivo', texto: 'Exploración física (O)', tipo: 'area' },
      { clave: 'analisis', texto: 'Análisis (A)', tipo: 'area' },
      { clave: 'plan', texto: 'Plan y tratamiento (P)', tipo: 'area', obligatorio: true },
      { clave: 'pronostico', texto: 'Pronóstico', tipo: 'texto' },
    ],
  },
  {
    tipo: 'HISTORIA', nombre: 'Historia clínica', icono: 'ph-clipboard-text', diagnosticos: true, imprimible: false,
    campos: [
      { clave: 'padecimiento', texto: 'Padecimiento actual', tipo: 'area', obligatorio: true },
      { clave: 'interrogatorio', texto: 'Interrogatorio por aparatos y sistemas', tipo: 'area' },
      { clave: 'vitales', texto: 'Signos vitales', tipo: 'vitales' },
      { clave: 'exploracion', texto: 'Exploración física', tipo: 'area' },
      { clave: 'estudios', texto: 'Resultados de estudios previos', tipo: 'area' },
      { clave: 'plan', texto: 'Plan', tipo: 'area' },
    ],
  },
  {
    tipo: 'RECETA', nombre: 'Receta', icono: 'ph-prescription', diagnosticos: true, imprimible: true,
    campos: [
      { clave: 'medicamentos', texto: 'Medicamentos', tipo: 'medicamentos', obligatorio: true },
      { clave: 'indicaciones', texto: 'Indicaciones generales', tipo: 'area' },
    ],
  },
  {
    tipo: 'SOLICITUD', nombre: 'Solicitud de estudios', icono: 'ph-flask', diagnosticos: true, imprimible: true,
    campos: [
      { clave: 'estudios', texto: 'Estudios solicitados', tipo: 'area', obligatorio: true, ayuda: 'Uno por línea' },
      { clave: 'motivo', texto: 'Motivo / datos clínicos', tipo: 'area' },
    ],
  },
  {
    tipo: 'REFERENCIA', nombre: 'Referencia', icono: 'ph-arrow-square-out', diagnosticos: true, imprimible: true,
    campos: [
      { clave: 'destino', texto: 'Se refiere a', tipo: 'texto', obligatorio: true, ayuda: 'Especialidad, médico o institución' },
      { clave: 'motivo', texto: 'Motivo de la referencia', tipo: 'area', obligatorio: true },
      { clave: 'resumen', texto: 'Resumen clínico', tipo: 'area' },
    ],
  },
  {
    tipo: 'CONSENTIMIENTO', nombre: 'Consentimiento informado', icono: 'ph-signature', diagnosticos: false, imprimible: true,
    campos: [
      { clave: 'procedimiento', texto: 'Procedimiento', tipo: 'texto', obligatorio: true },
      { clave: 'riesgos', texto: 'Riesgos explicados', tipo: 'area', obligatorio: true },
      { clave: 'beneficios', texto: 'Beneficios esperados', tipo: 'area' },
      { clave: 'alternativas', texto: 'Alternativas', tipo: 'area' },
      { clave: 'firmante', texto: 'Firma el paciente o su representante', tipo: 'texto', obligatorio: true },
      { clave: 'testigos', texto: 'Testigos', tipo: 'texto' },
    ],
  },
];

export function definicion(tipo: TipoDocumento): DefinicionDocumento {
  return DOCUMENTOS.find((d) => d.tipo === tipo) ?? DOCUMENTOS[0];
}

/** ¿Le falta algo obligatorio? Devuelve el nombre del primer campo vacío. */
export function faltante(def: DefinicionDocumento, c: Record<string, any>): string | null {
  for (const campo of def.campos) {
    if (!campo.obligatorio) continue;
    const v = c[campo.clave];
    if (campo.tipo === 'medicamentos') {
      if (!Array.isArray(v) || !v.some((l: LineaReceta) => l.medicamento?.trim())) return campo.texto;
    } else if (!String(v ?? '').trim()) return campo.texto;
  }
  return null;
}
