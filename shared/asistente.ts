/**
 * WYBIX, ASISTENTE OPERATIVO — los contratos.
 *
 * Los usan el proceso principal (electron/asistente/) y la pantalla
 * (src/core/asistente.service.ts). POS Mobile los usará igual: una regla, un
 * hallazgo o un plan significan lo mismo en las tres. Diseño completo en
 * docs/arquitectura/asistente-operativo.md.
 *
 * El patrón de todo el sistema:
 *
 *   detectar → explicar → proponer → previsualizar → confirmar → ejecutar → auditar
 *
 * Wybix NO cambia nada sensible por su cuenta. Las reglas solo leen; un plan
 * lo confirma una persona y lo ejecuta la pantalla con la API que ya existe
 * (permisos y aprobaciones incluidos).
 */

export type Severidad = 'info' | 'aviso' | 'importante' | 'critico';
export type Dominio =
  | 'inventario' | 'costos' | 'caja' | 'produccion' | 'compras' | 'ventas' | 'datos' | 'sistema';
export type EstadoHallazgo = 'abierto' | 'visto' | 'pospuesto' | 'descartado' | 'resuelto';

/** Un número de la evidencia, con su etiqueta: «Quedan · 4 L». */
export interface Dato { etiqueta: string; valor: string; }

/** Lo que Wybix encontró. Sale de una regla; nunca se escribe a mano. */
export interface Hallazgo {
  id: number;
  /** regla + entidad + periodo: la misma situación no se repite. */
  clave: string;
  regla: string;
  version: number;
  dominio: Dominio;
  severidad: Severidad;
  /** 0–100. Severidad × impacto × confianza, menos la fatiga de descartes. */
  prioridad: number;
  titulo: string;
  /** La explicación, en una o dos frases, con los números reales. */
  detalle: string;
  evidencia: Dato[];
  entidad?: { tipo: string; id: string | number; nombre?: string } | null;
  /** Lo que se puede hacer: cada una abre un intent con sus datos ya puestos. */
  acciones: AccionSugerida[];
  estado: EstadoHallazgo;
  /** La pantalla donde se resuelve (ruta del dock). */
  ruta?: string | null;
  detectadoEn: string;
  actualizadoEn: string;
}

export interface AccionSugerida {
  etiqueta: string;
  /** Intent que la ejecuta, con sus parámetros listos. */
  intent: string;
  params?: Record<string, unknown>;
  principal?: boolean;
}

// --------------------------------------------------------------- lenguaje

/** Cómo de seguro está Wybix de un dato: `dudoso` siempre se pregunta. */
export type Confianza = 'exacto' | 'probable' | 'dudoso';

export interface Slot<T = unknown> {
  valor: T | null;
  texto?: string;
  confianza: Confianza;
  /** Si es dudoso: las opciones para elegir con un toque. */
  opciones?: { etiqueta: string; valor: T; nota?: string }[];
}

export interface Interpretacion {
  /** null: no se entendió. */
  intent: string | null;
  /** 0–1: qué tan claro fue el intent. */
  puntaje: number;
  /** Los otros intents posibles, para «¿quisiste decir…?». */
  alternativas: { intent: string; etiqueta: string; puntaje: number }[];
  slots: Record<string, Slot>;
  /** Slot que falta o es dudoso y se pregunta ahora. */
  falta?: string | null;
}

// ------------------------------------------------------------------ planes

export type NivelAccion = 'consulta' | 'confirmar' | 'autorizar';
export type EstadoPlan = 'borrador' | 'ejecutado' | 'fallido' | 'cancelado' | 'caducado';

/** Lo que se va a hacer, ANTES de hacerlo. */
export interface Plan {
  id: string;
  intent: string;
  nivel: NivelAccion;
  titulo: string;
  /** Antes y después, costos: lo que se ve en la tarjeta de Confirmar. */
  vista: Dato[];
  avisos?: string[];
  /** Método de la API del renderer (electronAPI) y su payload. */
  ejecutar: { api: string; payload: unknown } | null;
  /** Paquete que hace falta; la pantalla lo comprueba antes de ofrecer Confirmar. */
  permiso?: string | null;
  /** Hallazgo que lo originó, si vino de uno. */
  hallazgoId?: number | null;
  caducaEn: string;
}

// ---------------------------------------------------------------- mensajes

export type Autor = 'wybix' | 'persona';

/** Un mensaje del chat. Lo de Wybix siempre sale de una plantilla. */
export interface Mensaje {
  id: string;
  autor: Autor;
  texto: string;
  en: string;
  /** Tono de la mascota mientras lo dice. */
  tono?: 'normal' | 'atencion' | 'exito' | 'error';
  hallazgo?: Hallazgo | null;
  plan?: Plan | null;
  /** Botones de respuesta rápida. */
  opciones?: { etiqueta: string; texto?: string; intent?: string; params?: Record<string, unknown> }[];
  /** Lista de datos (respuestas a consultas). */
  datos?: Dato[];
  /** A dónde llevar a la persona. */
  ruta?: string | null;
  /** «Cóbrale 2 cocas»: lo que se deja cargado en la cuenta de Venta antes de llevarla ahí. */
  carrito?: { productId: number; cantidad: number }[];
  /** La forma de los números: barras o línea (wx-grafica-chat). Los exactos van en `datos`. */
  grafica?: { tipo: 'barras' | 'linea'; dinero?: boolean; puntos: { etiqueta: string; valor: number }[] };
  /** La persona pidió que le lea las respuestas («léeme las respuestas»). */
  hablar?: boolean;
}

/** Lo que el chat necesita para pintar la mascota y el número del dock. */
export interface ResumenAsistente {
  pendientes: number;
  masUrgente: Hallazgo | null;
  /** El doctor técnico: todo en orden o qué falla. */
  sistema: { ok: boolean; problemas: number };
  evaluadoEn: string | null;
}
