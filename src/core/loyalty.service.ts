import { Injectable, computed, signal } from '@angular/core';

/*
 * Fidelizacion: campanas, recompensas, cupones, dinamicas y rifas.
 *
 * Este servicio NO decide nada. No calcula si una venta gana, no elige quien
 * se lleva la rifa y no resuelve si una dinamica se acerto. Todo eso lo
 * decide SQL, dentro de una transaccion, con el reloj del servidor. Aqui solo
 * se pide, se cachea lo que se acaba de pedir y se reparte a las pantallas.
 *
 * La razon es la de siempre en este POS: hay varias cajas. Una regla que
 * viva en el navegador vale lo que valga el reloj de ese equipo y lo que el
 * usuario quiera creerse.
 */

export type CampaignOutcome = 'REWARD' | 'COUPON' | 'DYNAMIC' | 'RAFFLE_ENTRY';
export type RewardKind = 'FREE_PRODUCT' | 'AMOUNT' | 'PERCENT';
export type DynamicType = 'TIMING' | 'WHEEL';
export type RaffleStatus = 'DRAFT' | 'OPEN' | 'CLOSED' | 'DRAWN';
export type PremioTipo = 'REWARD' | 'COUPON' | 'DYNAMIC' | 'RAFFLE_ENTRY';

export interface Campaign {
  id: number;
  name: string;
  description: string | null;
  outcome: CampaignOutcome;
  reward_definition_id: number | null;
  coupon_definition_id: number | null;
  dynamic_definition_id: number | null;
  raffle_id: number | null;
  quantity: number;
  per_amount: number | null;
  min_total: number | null;
  product_id: number | null;
  requires_customer: boolean;
  first_purchase_only: boolean;
  weekday_mask: number | null;
  time_from: string | null;
  time_to: string | null;
  starts_at: string | null;
  ends_at: string | null;
  priority: number;
  active: boolean;
  /** Nombre de lo que reparte, resuelto por SQL para no volver a cruzarlo aqui. */
  premio_nombre?: string | null;
}

export interface RewardDefinition {
  id: number;
  name: string;
  kind: RewardKind;
  product_id: number | null;
  product_name: string | null;
  amount: number | null;
  discount_pct: number | null;
  notes: string | null;
  valid_days: number | null;
  uses_allowed: number;
  active: boolean;
  emitidas: number;
}

export interface CouponDefinition {
  id: number;
  name: string;
  kind: RewardKind;
  amount: number | null;
  discount_pct: number | null;
  product_id: number | null;
  product_name: string | null;
  valid_days: number | null;
  uses_allowed: number;
  code_prefix: string | null;
  active: boolean;
  emitidos: number;
}

export interface DynamicDefinition {
  id: number;
  name: string;
  type: DynamicType;
  description: string | null;
  target_value: number | null;
  tolerance: number | null;
  attempts_allowed: number;
  reward_definition_id: number | null;
  reward_name: string | null;
  active: boolean;
  intentos: number;
  ganados: number;
}

export interface RaffleDefinition {
  id: number;
  name: string;
  description: string | null;
  prize: string | null;
  starts_at: string | null;
  ends_at: string | null;
  status: RaffleStatus;
  winners_count: number;
  code_prefix: string | null;
  participaciones: number;
  sorteos: number;
  /** La foto del cierre: cuantos boletos quedaron dentro, y cuando. */
  closed_at?: string | null;
  closed_entries_count?: number | null;
}

/** Una dinamica que una venta dejo pendiente de jugar. */
export interface DynamicPending {
  attempt_id: number;
  token: string;
  definition_id: number;
  name: string;
  type: DynamicType;
  description: string | null;
  target_value: number | null;
  tolerance: number | null;
  attempts_allowed: number;
  expires_at: string | null;
  reward_name: string | null;
  cliente: string | null;
}

/** Lo que una venta gano, tal y como lo devolvio sp_loyalty_evaluate_sale. */
export interface PremioDeVenta {
  tipo: PremioTipo;
  codigo: string | null;
  nombre: string | null;
  numero: number | null;
  token: string | null;
  detalle: string | null;
}

export interface ResultadoDinamica {
  ok: boolean;
  motivo: string | null;
  resultado: 'WIN' | 'LOSE' | null;
  codigo: string | null;
  premio: string | null;
  mensaje: string;
}

/** Una recompensa o un cupon REALMENTE emitido, no su definicion. */
export interface LoyaltyInstance {
  id: number;
  code: string;
  definition_id: number;
  promocion: string;
  kind: RewardKind;
  amount: number | null;
  discount_pct: number | null;
  product_name: string | null;
  customer_id: number | null;
  cliente: string | null;
  campaign_id: number | null;
  campana: string | null;
  sale_id: number | null;
  register_id: number | null;
  caja: string | null;
  machine_id: string | null;
  issued_at: string;
  expires_at: string | null;
  status: string;
  uses_count: number;
  uses_allowed: number;
  /** Lo decide SQL con el reloj del servidor, no la pantalla. */
  vigente: boolean;
  situacion: 'VIGENTE' | 'USADO' | 'VENCIDO' | 'ANULADO';
  ultima_redencion: string | null;
  venta_redencion: number | null;
}

/** Lo que respondio SQL sobre un codigo de cupon. */
export interface CouponCheck {
  ok: boolean;
  motivo: 'OK' | 'NO_EXISTE' | 'EXPIRADO' | 'AGOTADO' | 'ANULADO' | 'INACTIVO';
  /** Valido NO es lo mismo que aplicable: ver `sp_coupon_redeem`. */
  aplicable: boolean;
  instance_id: number | null;
  code: string;
  nombre: string | null;
  kind: RewardKind | null;
  amount: number | null;
  discount_pct: number | null;
  product_id: number | null;
  product_name: string | null;
  expires_at: string | null;
  uses_allowed: number | null;
  uses_count: number | null;
  cliente: string | null;
  mensaje: string;
}

export interface CouponRedeem {
  ok: boolean;
  motivo: string;
  mensaje: string;
  redemption_id: number | null;
  instance_id: number | null;
  uses_count: number | null;
  uses_allowed: number | null;
  estado: string | null;
}

export interface RaffleEntry {
  entry_number: number;
  boleto: string;
  customer_id: number | null;
  cliente: string | null;
  sale_id: number | null;
  register_id: number | null;
  created_at: string;
  status: string;
}

export interface RaffleWinner {
  winner_id: number;
  draw_id: number;
  position: number;
  status: string;
  delivered_at: string | null;
  notes: string | null;
  entry_number: number;
  boleto: string;
  cliente: string | null;
}

@Injectable({ providedIn: 'root' })
export class LoyaltyService {
  readonly campanas = signal<Campaign[]>([]);
  readonly recompensas = signal<RewardDefinition[]>([]);
  readonly cupones = signal<CouponDefinition[]>([]);
  readonly dinamicas = signal<DynamicDefinition[]>([]);
  readonly rifas = signal<RaffleDefinition[]>([]);

  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly cargado = signal(false);

  readonly campanasActivas = computed(() => this.campanas().filter(c => c.active));
  readonly hayAlgo = computed(() =>
    this.campanas().length > 0 || this.recompensas().length > 0 ||
    this.cupones().length > 0 || this.dinamicas().length > 0 || this.rifas().length > 0);

  private get api(): any {
    return (window as any).wybix ?? null;
  }

  /** Esta instalacion expone el IPC de Fidelizacion. */
  get disponible(): boolean {
    return !!this.api?.loyalty?.catalog;
  }

  // ------------------------------------------------------------- catalogo
  /**
   * Todo el catalogo en UNA llamada.
   *
   * La pantalla de administracion tiene cinco pestanas y se salta entre
   * ellas constantemente. Pedir cada lista al entrar en su pestana serian
   * cinco viajes para pintar lo que ya se sabia.
   */
  async cargar(forzar = false): Promise<void> {
    if (this.cargado() && !forzar) return;
    if (!this.disponible) {
      this.error.set('Fidelización no está disponible en este equipo.');
      return;
    }
    this.cargando.set(true);
    this.error.set(null);
    try {
      const r = await this.api.loyalty.catalog();
      if (!r?.success) throw new Error(r?.error || 'No se pudo cargar Fidelización.');
      const d = r.data || {};
      this.campanas.set((d.campanas || []).map(LoyaltyService.normCampana));
      this.recompensas.set((d.recompensas || []).map(LoyaltyService.normRecompensa));
      this.cupones.set((d.cupones || []).map(LoyaltyService.normCupon));
      this.dinamicas.set((d.dinamicas || []).map(LoyaltyService.normDinamica));
      this.rifas.set((d.rifas || []).map(LoyaltyService.normRifa));
      this.cargado.set(true);
    } catch (e: any) {
      this.error.set(e?.message || 'No se pudo cargar Fidelización.');
    } finally {
      this.cargando.set(false);
    }
  }

  // ------------------------------------------------------------ guardado
  async guardarCampana(p: Record<string, any>): Promise<void> {
    await this.exigirOk(this.api?.loyalty?.saveCampaign(p), 'No se pudo guardar la campaña.');
    await this.cargar(true);
  }

  async guardarDefinicion(kindOf: 'REWARD' | 'COUPON' | 'DYNAMIC', p: Record<string, any>): Promise<void> {
    await this.exigirOk(this.api?.loyalty?.saveDefinition({ ...p, kindOf }), 'No se pudo guardar.');
    await this.cargar(true);
  }

  async guardarRifa(p: Record<string, any>): Promise<void> {
    await this.exigirOk(this.api?.raffles?.save(p), 'No se pudo guardar la rifa.');
    await this.cargar(true);
  }

  // -------------------------------------------------------------- ventas
  /**
   * Que gano esta venta.
   *
   * Se llama DESPUES de cobrar. Si falla, la venta ya esta hecha y cobrada:
   * devuelve lista vacia en lugar de lanzar, porque no hay nada que un error
   * aqui pueda arreglar y si hay mucho que estropear ensenandoselo a alguien
   * que acaba de pagar.
   */
  async premiosDeVenta(saleId: number): Promise<PremioDeVenta[]> {
    if (!this.disponible || !saleId) return [];
    try {
      const r = await this.api.loyalty.evaluateSale({ saleId });
      if (!r?.success) {
        console.warn('[LOYALTY] evaluar venta:', r?.error);
        return [];
      }
      return (r.data || []) as PremioDeVenta[];
    } catch (e) {
      console.warn('[LOYALTY] evaluar venta:', e);
      return [];
    }
  }

  // ----------------------------------------------------------- dinamicas
  async dinamicasPendientes(saleId: number): Promise<DynamicPending[]> {
    if (!this.disponible || !saleId) return [];
    try {
      const r = await this.api.dynamics.pending({ saleId });
      return r?.success ? (r.data || []) : [];
    } catch { return []; }
  }

  /**
   * Jugar una dinamica.
   *
   * El resultado no se calcula aqui. `input_value` viaja a SQL y SQL decide,
   * marcando el intento con un UPDATE condicional: dos clics seguidos no
   * premian dos veces porque el segundo no encuentra intento pendiente.
   */
  async jugar(token: string, inputValue: number): Promise<ResultadoDinamica> {
    const r = await this.api?.dynamics?.play({ token, inputValue });
    if (!r?.success) {
      return {
        ok: false, motivo: r?.error || 'error', resultado: null, codigo: null,
        premio: null, mensaje: r?.error || 'No se pudo jugar.',
      };
    }
    const fila = (r.data || [])[0];
    return {
      ok: !!fila?.ok,
      motivo: fila?.motivo ?? null,
      resultado: fila?.resultado ?? null,
      codigo: fila?.codigo ?? null,
      premio: fila?.premio ?? null,
      mensaje: fila?.mensaje || 'Sin resultado.',
    };
  }

  // --------------------------------------------------------------- rifas
  async detalleRifa(raffleId: number, topEntries = 200): Promise<{
    rifa: RaffleDefinition | null; participaciones: RaffleEntry[]; ganadores: RaffleWinner[];
  }> {
    const r = await this.api?.raffles?.detail({ raffleId, topEntries });
    if (!r?.success) throw new Error(r?.error || 'No se pudo leer la rifa.');
    const d = r.data || {};
    return {
      rifa: d.rifa ? LoyaltyService.normRifa(d.rifa) : null,
      participaciones: d.participaciones || [],
      ganadores: d.ganadores || [],
    };
  }

  /**
   * Sortear. Irreversible: el procedure congela el universo de boletos y
   * deja constancia del algoritmo, su version y la semilla.
   */
  async sortear(p: { raffleId: number; userId?: number | null; registerId?: number | null; winners?: number | null; alternates?: number }): Promise<RaffleWinner[]> {
    const r = await this.api?.raffles?.draw(p);
    if (!r?.success) throw new Error(r?.error || 'No se pudo realizar el sorteo.');
    await this.cargar(true);
    return (r.data || []) as RaffleWinner[];
  }

  async marcarGanador(p: { winnerId: number; status: string; userId?: number | null; notes?: string | null; promoverSuplente?: boolean }): Promise<RaffleWinner[]> {
    const r = await this.api?.raffles?.winnerStatus(p);
    if (!r?.success) throw new Error(r?.error || 'No se pudo actualizar al ganador.');
    return (r.data || []) as RaffleWinner[];
  }

  // --------------------------------------------------------- instancias
  /**
   * Lo que Fidelizacion REPARTIO, no lo que tiene definido.
   *
   * Es la pregunta que aparece cuando un cliente llega con un codigo en la
   * mano. Hasta ahora solo se podia responder abriendo SSMS.
   */
  async instancias(kindOf: 'REWARD' | 'COUPON', filtros: { estado?: string | null; search?: string | null } = {}): Promise<LoyaltyInstance[]> {
    const r = await this.api?.loyalty?.instances({
      kindOf, estado: filtros.estado ?? null, search: filtros.search ?? null,
    });
    if (!r?.success) throw new Error(r?.error || 'No se pudieron leer las emisiones.');
    return (r.data || []).map((x: any) => ({
      ...x,
      vigente: !!x.vigente,
      uses_count: Number(x.uses_count ?? 0),
      uses_allowed: Number(x.uses_allowed ?? 1),
      amount: LoyaltyService.num(x.amount),
      discount_pct: LoyaltyService.num(x.discount_pct),
    })) as LoyaltyInstance[];
  }

  // ------------------------------------------------------------- cupones
  /**
   * Mirar un codigo sin consumirlo.
   *
   * No lanza cuando el cupon no sirve: un papel caducado es el caso normal,
   * no una averia, y la pantalla tiene que poder decir POR QUE.
   */
  async validarCupon(code: string): Promise<CouponCheck> {
    const r = await this.api?.coupons?.validate({ code });
    if (!r?.success) {
      return {
        ok: false, motivo: 'NO_EXISTE', aplicable: false, instance_id: null,
        code, nombre: null, kind: null, amount: null, discount_pct: null,
        product_id: null, product_name: null, expires_at: null,
        uses_allowed: null, uses_count: null, cliente: null,
        mensaje: r?.error || 'No se pudo comprobar el cupón.',
      };
    }
    const f = (r.data || [])[0];
    return { ...f, ok: !!f?.ok, aplicable: !!f?.aplicable } as CouponCheck;
  }

  /**
   * Consumir el cupon, con la venta ya cobrada.
   *
   * A diferencia de los premios, un fallo aqui SI se ensena: el cliente se
   * llevo el beneficio y el cupon tiene que quedar gastado. Callarlo dejaria
   * un cupon de un solo uso disponible para siempre.
   */
  async canjearCupon(p: { code: string; saleId: number; registerId?: number | null; amountApplied?: number }): Promise<CouponRedeem> {
    const r = await this.api?.coupons?.redeem(p);
    if (!r?.success) {
      return {
        ok: false, motivo: 'ERROR', mensaje: r?.error || 'No se pudo canjear el cupón.',
        redemption_id: null, instance_id: null, uses_count: null, uses_allowed: null, estado: null,
      };
    }
    const f = (r.data || [])[0];
    return { ...f, ok: !!f?.ok } as CouponRedeem;
  }

  // --------------------------------------------------------------- rifas
  /**
   * Cerrar: deja de admitir boletos y congela cuantos habia.
   *
   * Distinto de sortear. Entre los dos pueden pasar semanas y el numero de
   * participantes no puede moverse, porque es el que se anuncio.
   */
  async cerrarRifa(raffleId: number): Promise<RaffleDefinition | null> {
    const r = await this.api?.raffles?.close({ raffleId });
    if (!r?.success) throw new Error(r?.error || 'No se pudo cerrar la rifa.');
    await this.cargar(true);
    const f = (r.data || [])[0];
    return f ? LoyaltyService.normRifa(f) : null;
  }

  // ------------------------------------------------------------ interior
  /** Convierte el {success:false} del IPC en una excepcion con su motivo. */
  private async exigirOk(promesa: Promise<any> | undefined, porDefecto: string): Promise<any> {
    if (!promesa) throw new Error('Fidelización no está disponible en este equipo.');
    const r = await promesa;
    if (!r?.success) throw new Error(r?.error || porDefecto);
    return r.data;
  }

  private static num(v: any): number | null {
    return v === null || v === undefined ? null : Number(v);
  }

  private static normCampana(c: any): Campaign {
    return {
      ...c,
      id: Number(c.id),
      quantity: Number(c.quantity ?? 1),
      per_amount: LoyaltyService.num(c.per_amount),
      min_total: LoyaltyService.num(c.min_total),
      priority: Number(c.priority ?? 100),
      requires_customer: !!c.requires_customer,
      first_purchase_only: !!c.first_purchase_only,
      active: !!c.active,
    };
  }

  private static normRecompensa(r: any): RewardDefinition {
    return {
      ...r,
      id: Number(r.id),
      amount: LoyaltyService.num(r.amount),
      discount_pct: LoyaltyService.num(r.discount_pct),
      uses_allowed: Number(r.uses_allowed ?? 1),
      emitidas: Number(r.emitidas ?? 0),
      active: !!r.active,
    };
  }

  private static normCupon(c: any): CouponDefinition {
    return {
      ...c,
      id: Number(c.id),
      amount: LoyaltyService.num(c.amount),
      discount_pct: LoyaltyService.num(c.discount_pct),
      uses_allowed: Number(c.uses_allowed ?? 1),
      emitidos: Number(c.emitidos ?? 0),
      active: !!c.active,
    };
  }

  private static normDinamica(d: any): DynamicDefinition {
    return {
      ...d,
      id: Number(d.id),
      target_value: LoyaltyService.num(d.target_value),
      tolerance: LoyaltyService.num(d.tolerance),
      attempts_allowed: Number(d.attempts_allowed ?? 1),
      intentos: Number(d.intentos ?? 0),
      ganados: Number(d.ganados ?? 0),
      active: !!d.active,
    };
  }

  private static normRifa(r: any): RaffleDefinition {
    return {
      ...r,
      id: Number(r.id),
      winners_count: Number(r.winners_count ?? 1),
      participaciones: Number(r.participaciones ?? 0),
      sorteos: Number(r.sorteos ?? 0),
    };
  }
}
