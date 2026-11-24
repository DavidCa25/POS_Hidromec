import { Injectable, inject } from '@angular/core';
import { ElectronBridge } from '../core';

/* ------------------------------------------------------------------ tipos */

export interface Respuesta<T> { ok: boolean; datos: T; error?: string; motivo?: string | null; }

export interface ProductoFarmacia {
  product_id: number; nombre: string; part_number: string | null; bar_code: string | null;
  price: number; stock: number; fraccion: number | null; es_antibiotico: boolean;
  sustancia_activa: string | null; presentacion: string | null; registro_sanitario: string | null;
  refrigeracion: boolean; precio_maximo: number | null; controla_lotes: boolean;
  requiere_receta: boolean; es_controlado: boolean; tiene_ficha: boolean;
  en_lotes: number; sin_lote: number; proxima_caducidad: string | null; excede_maximo: boolean;
}

export interface Lote {
  lote_id: number; product_id: number; nombre: string; part_number: string | null;
  lote: string; caducidad: string; cantidad: number; costo: number | null;
  dias_restantes: number; caducado: boolean;
}

export interface ResumenFarmacia {
  lotes_caducados: number; lotes_por_caducar: number; con_receta: number;
  recetas_hoy: number; lecturas_hoy: number; sobre_maximo: number;
}

export interface MovimientoLibro {
  movimiento_id: number; at: string; product_id: number; nombre: string; sustancia_activa: string | null;
  fraccion: number | null; lote: string | null; caducidad: string | null; tipo: string;
  entrada: number; salida: number; saldo: number; sale_id: number | null;
  medico: string | null; cedula: string | null; fecha_receta: string | null; retenida: boolean | null;
  nota: string | null; usuario: string | null;
}

export interface Temperatura { id: number; equipo: string; grados: number; at: string; usuario: string | null; }

export interface PacienteLista {
  customer_id: number; nombre: string; telefono: string | null; fecha_nacimiento: string | null;
  email: string | null; curp: string | null; sexo: string | null; alergias: string | null;
  es_paciente: boolean; con_consentimiento: boolean; ultima_atencion: string | null;
}

export interface Antecedentes {
  heredofamiliares?: string; patologicos?: string; noPatologicos?: string;
  ginecoObstetricos?: string; medicamentos?: string;
}

export interface FichaPaciente {
  customer_id: number; nombre: string; telefono: string | null; email: string | null;
  fecha_nacimiento: string | null; curp: string | null; sexo: string | null; tutor: string | null;
  contacto_emergencia: string | null; grupo_sanguineo: string | null; alergias: string | null;
  antecedentes: Antecedentes | null; consentimiento_at: string | null; es_paciente: boolean;
  version: string | null;
}

export type TipoDocumento = 'HISTORIA' | 'NOTA' | 'RECETA' | 'CONSENTIMIENTO' | 'SOLICITUD' | 'REFERENCIA';

/** Quien firma: lo que se COPIA al documento o al resultado al firmarse. */
export interface Firmante {
  nombre: string; cedula: string; institucion: string | null; especialidad: string | null;
  cedula_especialidad: string | null; establecimiento?: string | null; domicilio?: string | null; telefono?: string | null;
}
export interface Profesional extends Firmante { user_id: number; updated_at: string; }

export type TipoEstudio = 'LAB' | 'IMAGEN';
export type Modalidad = 'RX' | 'MASTOGRAFIA' | 'USG' | 'TAC' | 'RM' | 'DENSITOMETRIA' | 'OTRO';
export interface ParametroLab {
  clave: string; nombre: string; unidad: string | null; min: number | null; max: number | null; texto: string | null;
}
export interface Estudio {
  product_id: number; nombre: string; precio: number; tasa_iva: number; iva_exento: boolean;
  tipo: TipoEstudio; modalidad: Modalidad | null; preparacion: string | null; muestra: string | null;
  entrega_horas: number | null; parametros: ParametroLab[];
}
export type EstadoEstudio = 'SOLICITADO' | 'TOMADO' | 'CAPTURADO' | 'VALIDADO' | 'CANCELADO';
export interface ResultadoLab { clave: string; valor: string; bandera: 'A' | 'B' | null; }
export interface EstudioOrdenado {
  id: number; orden_id: number; product_id: number; nombre: string; tipo: TipoEstudio; modalidad: Modalidad | null;
  precio: number; estado: EstadoEstudio; tomado_at: string | null; capturado_at: string | null; capturado_por: string | null;
  validado_at: string | null; validado_por: string | null; parametros: ParametroLab[]; resultados: ResultadoLab[];
  hallazgos: string | null; conclusion: string | null; birads: number | null; firmante: Firmante | null; huella: string | null;
}
export type EstadoOrdenEstudios = 'ABIERTA' | 'LISTA' | 'ENTREGADA' | 'CANCELADA';
export interface OrdenEstudios {
  id: number; folio: string; paciente_id: number; paciente: string; fecha_nacimiento: string | null; sexo: string | null;
  medico: string | null; indicaciones: string | null; estado: EstadoOrdenEstudios; orden_id: number | null;
  orden_folio: string | null; orden_status: string | null; created_at: string; creado_por: string | null;
  entregado_at: string | null; entregado_por: string | null; estudios: number; validados: number; total: number;
  items: EstudioOrdenado[];
}

export interface Diagnostico { cie10: string | null; descripcion: string; principal: boolean; }
export interface Adenda { id: number; texto: string; at: string; autor: string | null; }

export interface Documento {
  id: number; tipo: TipoDocumento; titulo: string | null; contenido: any; estado: 'BORRADOR' | 'FIRMADO';
  autor_id: number; autor: string | null; created_at: string; firmado_at: string | null;
  firmado_por: string | null; huella: string | null; firmante: Firmante | null;
  diagnosticos: Diagnostico[]; adendas: Adenda[];
}

export interface Expediente { ficha: FichaPaciente | null; documentos: Documento[]; }

export interface MarcaDental { diente: number; cara: string; estado: string; nota?: string | null; at?: string; usuario?: string | null; }

export interface PlanItem {
  id?: number; fase: number; diente: number | null; procedimiento: string;
  product_id?: number | null; productId?: number | null; precio: number; estado?: 'PENDIENTE' | 'HECHO';
}
export interface Plan {
  id: number; titulo: string; estado: 'PROPUESTO' | 'ACEPTADO' | 'TERMINADO' | 'CANCELADO';
  orden_id: number | null; created_at: string; total: number; procedimientos: number; hechos: number;
  items: PlanItem[];
}

export interface EntradaBitacora { id: number; accion: string; documento_id: number | null; at: string; usuario: string | null; }

/**
 * EL MÓDULO HABLA CON EL PROCESO PRINCIPAL SOLO AQUÍ.
 *
 * Cada método traduce la respuesta del puente a `Respuesta<T>`: la pantalla
 * nunca lee `success` ni `recordset`, y un cambio de forma en el canal se
 * arregla en un solo sitio. Vive con el módulo (chunk propio): una caja sin
 * Salud no descarga ni una línea de esto.
 */
@Injectable({ providedIn: 'root' })
export class SaludService {
  private readonly bridge = inject(ElectronBridge);
  private get api(): any { return this.bridge.api; }

  private envolver<T>(r: any, extraer: (r: any) => T, vacio: T): Respuesta<T> {
    if (!r) return { ok: false, datos: vacio, error: 'No hay conexión con el proceso principal.' };
    if (r.success === false) return { ok: false, datos: vacio, error: r.error, motivo: r.motivo ?? null };
    return { ok: true, datos: extraer(r) };
  }
  private lista<T>(r: any): Respuesta<T[]> { return this.envolver<T[]>(r, (x) => x.data ?? [], []); }
  private fila<T>(r: any): Respuesta<T | null> { return this.envolver<T | null>(r, (x) => (x.data ?? [])[0] ?? null, null); }

  // ------------------------------------------------------------- farmacia
  async resumenFarmacia() { return this.fila<ResumenFarmacia>(await this.api?.saludFarmaciaResumen?.()); }
  async productos(p: { buscar?: string; soloMedicamentos?: boolean; top?: number }) {
    return this.lista<ProductoFarmacia>(await this.api?.saludFarmaciaProductos?.(p));
  }
  async guardarFicha(p: {
    productId: number; fraccion: number | null; esAntibiotico: boolean; sustanciaActiva: string;
    presentacion: string; registroSanitario: string; refrigeracion: boolean; precioMaximo: number | null; controlaLotes: boolean;
  }) { return this.fila<any>(await this.api?.saludProductoGuardar?.(p)); }
  async lotes(p: { productId?: number; dias?: number | null }) { return this.lista<Lote>(await this.api?.saludLotes?.(p)); }
  async entradaLote(p: { productId: number; lote: string; caducidad: string; cantidad: number; costo?: number | null; nota?: string }) {
    return this.fila<Lote>(await this.api?.saludLoteEntrada?.(p));
  }
  async ajustarLote(p: { loteId: number; cantidad: number; nota: string }) {
    return this.fila<Lote>(await this.api?.saludLoteAjustar?.(p));
  }
  async libro(p: { desde: string; hasta: string; tipo: 'CONTROLADOS' | 'ANTIBIOTICOS' }) {
    return this.lista<MovimientoLibro>(await this.api?.saludLibroControl?.(p));
  }
  async temperaturas(dias = 30) { return this.lista<Temperatura>(await this.api?.saludTemperaturas?.({ dias })); }
  async guardarTemperatura(p: { equipo: string; grados: number }) {
    return this.fila<any>(await this.api?.saludTemperaturaGuardar?.(p));
  }

  // ----------------------------------------------------------- expediente
  async cie10(buscar: string) { return this.lista<{ codigo: string; descripcion: string }>(await this.api?.saludCie10?.({ buscar })); }
  async pacientes(buscar: string) { return this.lista<PacienteLista>(await this.api?.saludPacientes?.({ buscar })); }
  async guardarPaciente(p: any) {
    return this.envolver<number | null>(await this.api?.saludPacienteGuardar?.(p), (x) => x.data?.[0]?.customer_id ?? null, null);
  }
  async expediente(customerId: number) {
    return this.envolver<Expediente>(await this.api?.saludExpediente?.({ customerId }), (x) => x.data, { ficha: null, documentos: [] });
  }
  async guardarDocumento(p: {
    id?: number | null; pacienteId: number; tipo: TipoDocumento; titulo?: string | null;
    contenido: any; diagnosticos?: Diagnostico[];
  }) {
    return this.envolver<number | null>(await this.api?.saludDocumentoGuardar?.(p), (x) => x.data?.[0]?.id ?? null, null);
  }
  async firmar(id: number) { return this.fila<any>(await this.api?.saludDocumentoFirmar?.({ id })); }
  async adenda(documentoId: number, texto: string) { return this.fila<any>(await this.api?.saludDocumentoAdenda?.({ documentoId, texto })); }
  async descartar(id: number) { return this.fila<any>(await this.api?.saludDocumentoDescartar?.({ id })); }
  async bitacora(customerId: number, registrar?: 'IMPRIMIR' | 'EXPORTAR', documentoId?: number) {
    return this.lista<EntradaBitacora>(await this.api?.saludBitacora?.({ customerId, registrar, documentoId }));
  }

  // ------------------------------------------------------- quién firma
  async profesional() { return this.envolver<Profesional | null>(await this.api?.saludProfesional?.(), (x) => x.data ?? null, null); }
  async guardarProfesional(p: { nombre: string; cedula: string; institucion?: string; especialidad?: string; cedulaEspecialidad?: string }) {
    return this.envolver<Profesional | null>(await this.api?.saludProfesionalGuardar?.(p), (x) => x.data ?? null, null);
  }

  // ---------------------------------------------------- laboratorio e imagen
  async estudiosCatalogo(p: { buscar?: string; tipo?: TipoEstudio } = {}) {
    return this.lista<Estudio>(await this.api?.saludEstudiosCatalogo?.(p));
  }
  async guardarEstudio(p: {
    productId?: number | null; nombre: string; precio: number; tasaIva: number; ivaExento: boolean;
    tipo: TipoEstudio; modalidad?: Modalidad | null; preparacion?: string; muestra?: string;
    entregaHoras?: number | null; parametros?: ParametroLab[];
  }) { return this.envolver<number | null>(await this.api?.saludEstudioGuardar?.(p), (x) => x.data?.productId ?? null, null); }
  async crearOrdenEstudios(p: { customerId: number; estudios: number[]; medico?: string; indicaciones?: string }) {
    return this.envolver<{ id: number; folio: string; ordenId: number } | null>(
      await this.api?.saludEstudioOrdenCrear?.(p), (x) => x.data, null);
  }
  async ordenesEstudios(p: { id?: number; customerId?: number; estado?: EstadoOrdenEstudios | null; buscar?: string; top?: number }) {
    return this.lista<OrdenEstudios>(await this.api?.saludEstudioOrdenes?.(p));
  }
  async estadoEstudio(itemId: number, estado: 'TOMADO' | 'CANCELADO') {
    return this.fila<any>(await this.api?.saludEstudioEstado?.({ itemId, estado }));
  }
  async capturarEstudio(p: { itemId: number; resultados?: { clave: string; valor: string }[]; hallazgos?: string; conclusion?: string; birads?: number | null }) {
    return this.fila<any>(await this.api?.saludEstudioCapturar?.(p));
  }
  async validarEstudio(itemId: number) { return this.fila<any>(await this.api?.saludEstudioValidar?.({ itemId })); }
  async entregarEstudios(id: number) { return this.fila<any>(await this.api?.saludEstudioEntregar?.({ id })); }

  // --------------------------------------------------------------- dental
  async odontograma(customerId: number) {
    return this.envolver<{ actual: MarcaDental[]; historial: MarcaDental[] }>(
      await this.api?.saludOdontograma?.({ customerId }), (x) => x.data, { actual: [], historial: [] });
  }
  async marcar(customerId: number, marcas: MarcaDental[]) {
    return this.fila<any>(await this.api?.saludOdontogramaMarcar?.({ customerId, marcas }));
  }
  async planes(customerId: number) { return this.lista<Plan>(await this.api?.saludPlanes?.({ customerId })); }
  async guardarPlan(p: { id?: number | null; customerId: number; titulo: string; items: PlanItem[] }) {
    return this.envolver<number | null>(await this.api?.saludPlanGuardar?.(p), (x) => x.data?.[0]?.id ?? null, null);
  }
  async aceptarPlan(id: number) {
    return this.envolver<{ planId: number; ordenId: number } | null>(await this.api?.saludPlanAceptar?.({ id }), (x) => x.data, null);
  }
  async estadoPlan(id: number, estado: 'CANCELADO' | 'TERMINADO') { return this.fila<any>(await this.api?.saludPlanEstado?.({ id, estado })); }
  async itemHecho(itemId: number, hecho: boolean) { return this.fila<any>(await this.api?.saludPlanItem?.({ itemId, hecho })); }

  /** Servicios del catálogo, para armar un plan dental con lo que de verdad se cobra. */
  async serviciosCatalogo() {
    return this.lista<{ product_id: number; nombre: string; price: number }>(await this.api?.serviciosCatalogo?.({ soloActivos: true }));
  }
}

/* ---------------------------------------------------------- utilidades */

export const ROMANOS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];

/** Edad en años cumplidos a partir de 'YYYY-MM-DD' (o Date). */
export function edad(fecha: string | null | undefined): number | null {
  if (!fecha) return null;
  const n = new Date(String(fecha).slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(n.getTime())) return null;
  const h = new Date();
  let e = h.getFullYear() - n.getFullYear();
  if (h.getMonth() < n.getMonth() || (h.getMonth() === n.getMonth() && h.getDate() < n.getDate())) e--;
  return e;
}

/** Hoy en 'YYYY-MM-DD', en hora local (no UTC: a las 7 p. m. ya sería mañana). */
export function hoyIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
