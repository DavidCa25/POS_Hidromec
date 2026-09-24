import definicion from '../../electron/servicios/presets.json';

/**
 * LOS GIROS DE SERVICIOS, PARA LA INTERFAZ.
 *
 * Importa el MISMO archivo que lee el proceso principal y que lee el gestor
 * de demos: `electron/servicios/presets.json`. No hay copia, no hay espejo y
 * no hay nada que sincronizar, que es justo lo que se quería evitar —una
 * lista de giros en producción y otra en las demos acaban separándose, y el
 * síntoma aparece meses después, en una demostración delante de un cliente.
 *
 * El archivo vive bajo `electron/` y no bajo `src/` porque el empaquetado
 * mete `electron/**` y de `src/` sólo el bundle ya compilado: si la fuente
 * viviera aquí, el proceso principal no la tendría en una instalación real.
 */

/** Qué papel juega en este giro la cosa sobre la que se trabaja. */
export type UsoDeActivo =
  /** Sin eso la orden está a medias: el coche del taller, el equipo del técnico. */
  | 'CENTRAL'
  /** A veces hay algo y a veces no: una visita a domicilio no siempre tiene equipo. */
  | 'OPCIONAL'
  /** El trabajo es sobre la persona que viene. Enseñarlo es ruido. */
  | 'NO';

/**
 * Qué papel juega la autorización del cliente.
 *
 * No es lo mismo un presupuesto de taller —hay que diagnosticar, cotizar y
 * esperar el «sí» antes de tocar nada— que un corte de cabello, donde el
 * precio se conoce al agendar. Forzar el mismo trámite en los dos convierte
 * la autorización en un botón que se pulsa sin leer, que es peor que no
 * tenerla.
 */
export type ModoAutorizacion =
  /** El flujo gira alrededor de ella y se avisa cuando falta. */
  | 'REQUERIDA'
  /** Disponible, pero sin protagonismo: no se reclama ni se marca en rojo. */
  | 'OPCIONAL'
  /** Existe por si hace falta, y no aparece salvo que se busque. */
  | 'DISCRETA';

export type PresetActivo = {
  usa: UsoDeActivo;
  /** Compatibilidad: `usa === 'CENTRAL'`. Se conserva porque se lee en plantillas. */
  requerido: boolean;
  /** El tipo que propone el giro para `customer_assets.asset_type`. */
  tipo: 'VEHICULO' | 'MASCOTA' | 'EQUIPO' | 'INMUEBLE' | 'OTRO' | null;
  /** Los tipos que este giro ofrece. Vacío cuando no usa activos. */
  tipos: string[];
  singular: string;
  plural: string;
  /** Cómo se llama aquí el dato que lo identifica: placa, serie, referencia. */
  identificador: string;
  ejemplo: string;
  ejemploIdentificador: string;
};

/** Cómo se llama aquí lo que se consume o se vende junto al trabajo. */
export type PresetMaterial = {
  singular: string;
  plural: string;
  /** El texto del botón que lo añade a una orden. */
  agregar: string;
};

/**
 * Los textos que cambian de un giro a otro.
 *
 * Están aquí y no repartidos por las plantillas por una razón concreta: son
 * catorce frases y cinco giros, y mantenerlas con condicionales significaría
 * que añadir el sexto giro obliga a encontrar catorce sitios. Olvidarse de uno
 * es cómo una barbería acaba preguntando por la placa del vehículo.
 */
export type PresetTextos = {
  reportado: string;
  reportadoEjemplo: string;
  reportadoCorto: string;
  diagnostico: string;
  diagnosticoCorto: string;
  cambiarActivo: string;
  indicarActivo: string;
  elegirActivo: string;
  registrarActivo: string;
  ordenVacia: string;
};

export type PresetServicios = {
  id: string;
  nombre: string;
  ejemplos: string;
  icono: string;
  orden: number;
  /** Los módulos del negocio que el giro enciende. */
  modulos: string[];
  /** La pestaña que abre el módulo. */
  inicio: 'ordenes' | 'agenda';
  /** Si la agenda forma parte del trabajo de este giro. */
  agenda: boolean;
  autorizacion: ModoAutorizacion;
  activo: PresetActivo;
  material: PresetMaterial;
  textos: PresetTextos;
};

export const PRESETS_SERVICIOS: PresetServicios[] =
  ([...(definicion.presets as unknown as PresetServicios[])])
    .sort((a, b) => (a.orden ?? 99) - (b.orden ?? 99));

/**
 * El giro de quien todavía no ha elegido ninguno.
 *
 * Una base anterior a los giros tenía Servicios encendido y nada más. Al
 * abrirla ve el vocabulario neutro y todas las pestañas: lo mismo que veía
 * antes. Elegir un giro es algo que puede hacer cuando quiera, no un trámite
 * que se le impone por haber actualizado.
 */
export const PRESET_POR_DEFECTO = 'OTRO';

export function buscarPreset(id: string | null | undefined): PresetServicios {
  const clave = String(id ?? '').trim().toUpperCase();
  return PRESETS_SERVICIOS.find(p => p.id === clave)
      ?? PRESETS_SERVICIOS.find(p => p.id === PRESET_POR_DEFECTO)!;
}
