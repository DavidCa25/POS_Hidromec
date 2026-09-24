import { Injectable, computed, inject, signal } from '@angular/core';
import { ElectronBridge } from '../core/electron-bridge.service';

/**
 * EL PUENTE DEL MODULO SERVICIOS.
 *
 * Una capa fina: traduce lo que la pantalla sabe -un identificador, un texto-
 * al canal correspondiente, y devuelve lo que llegó. No decide nada. Que un
 * presupuesto necesite reautorización, quién puede hacer qué servicio y cuánto
 * comisiona cada línea lo decide SQL, y el proceso principal comprueba el
 * permiso antes de dejar pasar la llamada.
 *
 * POR QUÉ UN SOLO SERVICIO Y NO SEIS
 * ----------------------------------
 * Órdenes, catálogo, profesionales y agenda son partes de lo mismo y la
 * pantalla de una necesita datos de las otras: la orden enseña profesionales,
 * la agenda enseña servicios. Seis servicios habrían sido seis cachés que se
 * desincronizan entre sí.
 *
 * EL ERROR SE DEVUELVE, NO SE LANZA
 * ---------------------------------
 * Igual que el resto del puente: cada método devuelve `{ ok, datos, error }`.
 * Una excepción obligaría a cada pantalla a envolver cada llamada, y la mitad
 * se olvidarían.
 */

export interface Servicio {
  product_id: number;
  part_number: string;
  nombre: string;
  price: number;
  tasa_iva: number;
  active: boolean;
  duration_minutes: number;
  requires_professional: boolean;
  default_commission_pct: number | null;
  schedulable: boolean;
  notes: string | null;
  professionals_count: number;
  category_name?: string | null;
}

export interface ActivoCliente {
  id: number;
  customer_id: number;
  customer_name: string;
  kind: string;
  label: string;
  identifier: string | null;
  secondary_identifier: string | null;
  brand: string | null;
  model: string | null;
  year_or_age: string | null;
  color: string | null;
  notes: string | null;
  active: boolean;
  orders_count: number;
}

export interface Profesional {
  id: number;
  full_name: string;
  title: string | null;
  phone: string | null;
  email: string | null;
  user_id: number | null;
  user_name: string | null;
  default_commission_pct: number;
  color: string | null;
  active: boolean;
  services_count: number;
  open_lines: number;
}

export type EstadoOrden = 'BORRADOR' | 'ABIERTA' | 'EN_PROCESO' | 'TERMINADA' | 'ENTREGADA' | 'CANCELADA';
export type EstadoEconomico = 'SIN_COBRAR' | 'POR_COBRAR' | 'PAGADA';
export type EstadoLinea = 'PENDIENTE' | 'EN_PROCESO' | 'HECHA' | 'CANCELADA';

export interface OrdenResumen {
  id: number;
  folio: string;
  status: EstadoOrden;
  customer_id: number;
  customer_name: string;
  asset_label: string | null;
  asset_identifier: string | null;
  opened_at: string;
  promised_at: string | null;
  total: number;
  economic_status: EstadoEconomico;
  needs_reauthorization: boolean;
  lines_count: number;
  lines_done: number;
  sale_id: number | null;
  rowver: string;
}

export interface LineaOrden {
  id: number;
  line_no: number;
  line_kind: 'SERVICIO' | 'PRODUCTO';
  product_id: number;
  name_snapshot: string;
  unit_price_snapshot: number;
  quantity: number;
  line_total: number;
  professional_id: number | null;
  professional_name: string | null;
  professional_color: string | null;
  commission_pct_snapshot: number | null;
  status: EstadoLinea;
  notes: string | null;
  current_price: number;
  current_name: string;
}

export interface EventoOrden {
  id: number;
  happened_at: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  quote_version: number | null;
  amount: number | null;
  detail: string | null;
  user_name: string | null;
}

export interface OrdenDetalle extends OrdenResumen {
  customer_phone: string | null;
  customer_mobile: string | null;
  customer_asset_id: number | null;
  asset_kind: string | null;
  asset_brand: string | null;
  asset_model: string | null;
  asset_year_or_age: string | null;
  asset_color: string | null;
  reported_issue: string | null;
  diagnosis: string | null;
  notes: string | null;
  quote_version: number;
  authorized_version: number | null;
  authorized_at: string | null;
  authorized_by_name: string | null;
  authorized_channel: string | null;
  total_servicios: number;
  total_productos: number;
  sale_total: number | null;
  sale_balance: number | null;
  sale_payment_method: string | null;
  opened_by_name: string | null;
  closed_by_name: string | null;
}

export interface Orden {
  cabecera: OrdenDetalle;
  lineas: LineaOrden[];
  eventos: EventoOrden[];
}

export interface Cita {
  id: number;
  customer_id: number;
  customer_name: string;
  customer_phone: string | null;
  customer_mobile: string | null;
  customer_asset_id: number | null;
  asset_label: string | null;
  professional_id: number | null;
  professional_name: string | null;
  professional_color: string | null;
  service_product_id: number | null;
  service_name: string | null;
  starts_at: string;
  ends_at: string;
  status: 'AGENDADA' | 'CONFIRMADA' | 'ATENDIDA' | 'CANCELADA' | 'NO_ASISTIO';
  service_order_id: number | null;
  order_folio: string | null;
  rescheduled_from_id: number | null;
  notes: string | null;
  fuera_de_horario?: boolean;
  en_ausencia?: boolean;
  citas_encimadas?: number;
}

export interface Ausencia {
  id: number;
  professional_id: number;
  professional_name?: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
}

export interface Franja {
  id?: number;
  professional_id?: number;
  weekday: number;
  starts_at: string;
  ends_at: string;
  active?: boolean;
}

/**
 * La hora de una franja, siempre como `HH:MM`.
 *
 * SQL guarda las franjas como `TIME(0)`, pero al cruzar el puente llegan como
 * una fecha ISO con el día 1 de enero de 1970 pegado delante:
 * `"1970-01-01T09:00:00.000Z"`. Quien esperaba `"09:00"` y hacía
 * `split(':')` obtenía `NaN`, y con un `NaN` dentro toda la ventana horaria
 * de la agenda se volvía `NaN`: los bloques perdían su posición y se apilaban
 * todos arriba. La agenda se rompía justo al declarar un horario, que es lo
 * primero que hace un negocio.
 *
 * Se leen los componentes UTC a propósito. La cadena lleva `Z`, así que
 * `getHours()` le aplicaría la zona local y las nueve de la mañana pasarían a
 * ser las tres en México. Lo que hay ahí no es un instante: es una hora del
 * reloj de pared.
 */
export function horaDeFranja(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s) return '00:00';

  const simple = /^(\d{1,2}):(\d{2})/.exec(s);
  if (simple) return `${simple[1].padStart(2, '0')}:${simple[2]}`;

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '00:00';
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** Lo que devuelve cualquier llamada de este servicio. */
export interface Respuesta<T> {
  ok: boolean;
  datos: T;
  error?: string;
  motivo?: string;
  conjuntos?: any[][];
}

@Injectable({ providedIn: 'root' })
export class ServiciosService {
  private readonly bridge = inject(ElectronBridge);
  private get api(): any { return this.bridge.api; }

  /**
   * La orden abierta en pantalla. Vive aquí y no en el componente porque tres
   * sitios la miran: el detalle, el cobro y la agenda cuando viene de una cita.
   */
  private readonly _orden = signal<Orden | null>(null);
  readonly orden = this._orden.asReadonly();

  readonly necesitaReautorizacion = computed(() => !!this._orden()?.cabecera?.needs_reauthorization);

  /** Traduce la respuesta del puente a algo que la pantalla pueda usar. */
  private envolver<T>(r: any, extraer: (r: any) => T): Respuesta<T> {
    if (!r) return { ok: false, datos: extraer({}), error: 'No hay conexión con el proceso principal.' };
    if (r.success === false) {
      return { ok: false, datos: extraer({}), error: r.error, motivo: r.motivo };
    }
    return { ok: true, datos: extraer(r), conjuntos: r.sets };
  }

  private lista<T>(r: any): Respuesta<T[]> {
    return this.envolver<T[]>(r, (x) => (x.data ?? []) as T[]);
  }

  /** Los tres conjuntos de una orden, con el nombre que usa la pantalla. */
  private comoOrden(r: any): Respuesta<Orden | null> {
    const res = this.envolver<Orden | null>(r, (x) => {
      const sets = x.sets ?? [];
      const cab = (sets[0] ?? [])[0];
      if (!cab) return null;
      return { cabecera: cab, lineas: sets[1] ?? [], eventos: sets[2] ?? [] };
    });
    if (res.ok && res.datos) this._orden.set(res.datos);
    return res;
  }

  // ------------------------------------------------------------- catálogo
  async catalogo(p: { soloActivos?: boolean; busqueda?: string } = {}) {
    return this.lista<Servicio>(await this.api?.serviciosCatalogo?.(p));
  }
  async guardarServicio(p: any) {
    return this.lista<Servicio>(await this.api?.serviciosGuardarServicio?.(p));
  }
  async activarServicio(productId: number, activo: boolean) {
    return this.lista<any>(await this.api?.serviciosActivarServicio?.({ productId, activo }));
  }
  async asignarProfesionales(productId: number, asignaciones: { professionalId: number; commissionPct?: number | null }[]) {
    return this.lista<any>(await this.api?.serviciosAsignarProfesionales?.({ productId, asignaciones }));
  }

  // -------------------------------------------------------------- activos
  async activos(p: { clienteId?: number; busqueda?: string; soloActivos?: boolean } = {}) {
    return this.lista<ActivoCliente>(await this.api?.serviciosActivos?.(p));
  }
  async guardarActivo(p: any) {
    return this.lista<ActivoCliente>(await this.api?.serviciosGuardarActivo?.(p));
  }
  async activarActivo(id: number, activo: boolean) {
    return this.lista<any>(await this.api?.serviciosActivarActivo?.({ id, activo }));
  }

  // -------------------------------------------------------- profesionales
  async profesionales(p: { soloActivos?: boolean; servicioId?: number } = {}) {
    return this.lista<Profesional>(await this.api?.serviciosProfesionales?.(p));
  }
  async guardarProfesional(p: any) {
    return this.lista<Profesional>(await this.api?.serviciosGuardarProfesional?.(p));
  }
  async activarProfesional(id: number, activo: boolean) {
    return this.lista<any>(await this.api?.serviciosActivarProfesional?.({ id, activo }));
  }
  /** Horario semanal y ausencias: dos conjuntos, porque son dos cosas. */
  async horario(profesionalId?: number) {
    const r = await this.api?.serviciosHorario?.({ profesionalId });
    return this.envolver<{ franjas: Franja[]; ausencias: Ausencia[] }>(r, (x) => ({
      franjas: (x.sets?.[0] ?? []) as Franja[],
      ausencias: (x.sets?.[1] ?? []) as Ausencia[],
    }));
  }
  async guardarHorario(profesionalId: number, franjas: Franja[]) {
    return this.lista<Franja>(await this.api?.serviciosGuardarHorario?.({ profesionalId, franjas }));
  }
  async guardarAusencia(p: any) {
    const r = await this.api?.serviciosGuardarAusencia?.(p);
    return this.envolver<{ ausencia: Ausencia | null; citasAfectadas: Cita[] }>(r, (x) => ({
      ausencia: (x.sets?.[0] ?? [])[0] ?? null,
      /* Las citas que quedan dentro. No se tocan: se avisan, para que alguien
         pueda llamar a esas personas. */
      citasAfectadas: (x.sets?.[1] ?? []) as Cita[],
    }));
  }
  async borrarAusencia(id: number) {
    return this.lista<any>(await this.api?.serviciosBorrarAusencia?.({ id }));
  }

  // --------------------------------------------------------------- órdenes
  async ordenes(p: any = {}) {
    return this.lista<OrdenResumen>(await this.api?.serviciosOrdenes?.(p));
  }
  async cargarOrden(id: number) {
    return this.comoOrden(await this.api?.serviciosOrden?.({ id }));
  }
  async crearOrden(p: any) {
    return this.comoOrden(await this.api?.serviciosOrdenCrear?.(p));
  }
  async actualizarOrden(p: any) {
    return this.comoOrden(await this.api?.serviciosOrdenActualizar?.(this.conTestigo(p)));
  }
  async cambiarEstado(id: number, estado: EstadoOrden) {
    return this.comoOrden(await this.api?.serviciosOrdenEstado?.(this.conTestigo({ id, estado })));
  }
  async autorizar(id: number, autorizaNombre: string, via = 'MOSTRADOR') {
    return this.comoOrden(await this.api?.serviciosOrdenAutorizar?.(
      this.conTestigo({ id, autorizaNombre, via })));
  }
  async cancelarOrden(id: number, motivo: string) {
    return this.comoOrden(await this.api?.serviciosOrdenCancelar?.(this.conTestigo({ id, motivo })));
  }
  async agregarLinea(p: any) {
    return this.comoOrden(await this.api?.serviciosLineaAgregar?.(p));
  }
  async actualizarLinea(p: any) {
    return this.comoOrden(await this.api?.serviciosLineaActualizar?.(p));
  }

  /**
   * Añade el testigo de versión de la orden que hay en pantalla.
   *
   * Sin él, dos personas editando la misma orden se pisan sin enterarse. Se
   * pone aquí y no en cada pantalla porque olvidarlo en una sola sería
   * suficiente para perder el diagnóstico que alguien acababa de escribir.
   */
  private conTestigo(p: any) {
    const actual = this._orden()?.cabecera;
    if (actual && Number(actual.id) === Number(p.id) && !p.rowver) {
      return { ...p, rowver: actual.rowver };
    }
    return p;
  }

  // ----------------------------------------------------------------- cobro
  async cobroPrevia(ordenId: number) {
    const r = await this.api?.serviciosCobroPrevia?.({ ordenId });
    return this.envolver<{ resumen: any; partidas: any[] }>(r, (x) => ({
      resumen: (x.sets?.[0] ?? [])[0] ?? null,
      partidas: x.sets?.[1] ?? [],
    }));
  }
  async enlazarVenta(ordenId: number, ventaId: number) {
    return this.comoOrden(await this.api?.serviciosOrdenEnlazarVenta?.({ ordenId, ventaId }));
  }

  // ---------------------------------------------------------------- agenda
  async citas(p: { desde: string | Date; hasta: string | Date; profesionalId?: number; estados?: string[]; clienteId?: number }) {
    const r = await this.api?.serviciosCitas?.(p);
    return this.envolver<{ citas: Cita[]; ausencias: Ausencia[] }>(r, (x) => ({
      citas: (x.sets?.[0] ?? []) as Cita[],
      ausencias: (x.sets?.[1] ?? []) as Ausencia[],
    }));
  }
  async cita(id: number) {
    return this.lista<Cita>(await this.api?.serviciosCita?.({ id }));
  }
  async guardarCita(p: any) {
    return this.lista<Cita>(await this.api?.serviciosCitaGuardar?.(p));
  }
  async cambiarEstadoCita(id: number, estado: string, notas?: string) {
    return this.lista<Cita>(await this.api?.serviciosCitaEstado?.({ id, estado, notas }));
  }
  async reprogramar(p: any) {
    return this.lista<Cita>(await this.api?.serviciosCitaReprogramar?.(p));
  }
  async citaAOrden(id: number, cajaId?: number) {
    return this.comoOrden(await this.api?.serviciosCitaAOrden?.({ id, cajaId }));
  }
  async disponibilidad(p: any) {
    return this.lista<{ professional_id: number; professional_name: string; starts_at: string; ends_at: string }>(
      await this.api?.serviciosDisponibilidad?.(p));
  }

  // ------------------------------------------------------------ comisiones
  async comisiones(p: { desde: string; hasta: string; profesionalId?: number }) {
    const r = await this.api?.serviciosComisiones?.(p);
    return this.envolver<{ porPersona: any[]; detalle: any[] }>(r, (x) => ({
      porPersona: x.sets?.[0] ?? [],
      detalle: x.sets?.[1] ?? [],
    }));
  }

  limpiarOrden() { this._orden.set(null); }
}
