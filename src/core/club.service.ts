import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { CartService } from './cart.service';
import { InventoryMode, LineSource } from './models';

/** Una membresía del cliente, tal como la deja sp_membership_status. */
export interface MembresiaCliente {
  id: number; uuid: string; plan_id: number; plan_name: string; paid_until: string | null;
  grace_days: number; daily_limit: number; estado: 'ACTIVA' | 'VENCIDA' | 'CANCELADA';
  usados_hoy: number; disponibles_hoy: number; ultimo_canje: string | null; ultimo_canje_en: string | null;
  sale_product_id: number | null; sale_product_name: string | null; sale_product_price: number | null;
  sale_product_inventory_mode: InventoryMode | null; sale_product_tasa_iva: number | null; sale_product_objeto_impuesto: string | null;
  sale_product_clave_prod_serv: string | null; sale_product_clave_unidad: string | null;
}
export interface ProductoClub {
  plan_id: number; product_id: number; nombre: string; price: number;
  inventory_mode: InventoryMode | null; tasa_iva: number | null; objeto_impuesto: string | null; clave_prod_serv: string | null; clave_unidad: string | null;
}
export interface PlanClub {
  id: number; name: string; period_days: number; daily_limit: number; sale_product_id: number; sale_product_name: string; sale_product_price: number;
  sale_product_inventory_mode: InventoryMode | null; sale_product_tasa_iva: number | null; sale_product_objeto_impuesto: string | null;
  sale_product_clave_prod_serv: string | null; sale_product_clave_unidad: string | null;
}
export interface EstadoClub { membresias: MembresiaCliente[]; productos: ProductoClub[]; planes: PlanClub[]; }

/** 0064 · Puntos y sellos del cliente, tal como los deja sp_loyalty_customer_status. */
export interface TarjetaSellos {
  id: number; uuid: string; name: string; stamps_required: number; reward_product_id: number | null;
  reward_product_name: string | null; sellos: number;
}
export interface ProductoTarjeta extends Omit<ProductoClub, 'plan_id'> { card_id: number; es_premio: boolean; }
export interface RecompensaCanje {
  id: number; name: string; kind: 'FREE_PRODUCT' | 'AMOUNT' | 'PERCENT'; product_id: number | null;
  amount: number | null; discount_pct: number | null; points_cost: number;
  product_name: string | null; product_price: number | null; product_inventory_mode: InventoryMode | null;
  product_tasa_iva: number | null; product_objeto_impuesto: string | null; product_clave_prod_serv: string | null; product_clave_unidad: string | null;
}
export interface PuntosCliente {
  resumen: { enabled: boolean; puntos: number; vencen: string | null; per_amount: number | null; points_per: number; visit_points: number } | null;
  tarjetas: TarjetaSellos[]; productos: ProductoTarjeta[]; recompensas: RecompensaCanje[];
}

/*
 * CLUB EN LA CAJA (0063).
 *
 * Sigue al cliente de la cuenta activa: al elegirlo, pregunta su membresía.
 * Dar el café, renovar o afiliar son cosas que se hacen sobre el CARRITO
 * (agregar el producto, pedir el beneficio); quien decide si procede es la
 * cotización y, al cobrar, SQL. Esta clase no tiene opinión sobre el dinero.
 */
@Injectable({ providedIn: 'root' })
export class ClubService {
  private readonly carts = inject(CartService);
  readonly estado = signal<EstadoClub | null>(null);
  /** 0064 · Puntos y sellos del cliente de la cuenta. */
  readonly puntos = signal<PuntosCliente | null>(null);
  readonly cargando = signal(false);
  private clienteCargado: number | null = null;
  private cuentaCargada: number | null = null;

  private get api() { return (window as any).electronAPI; }

  /** El cliente de la cuenta activa (o null). */
  readonly cliente = computed(() => { this.carts.version(); return this.carts.activeCart().customer ?? null; });
  /** La membresía que se muestra: la activa, o la más reciente. */
  readonly membresia = computed<MembresiaCliente | null>(() => this.estado()?.membresias?.[0] ?? null);
  readonly productos = computed(() => { const m = this.membresia(); return (this.estado()?.productos ?? []).filter(p => p.plan_id === m?.plan_id); });
  readonly planes = computed(() => this.estado()?.planes ?? []);
  /** ¿La cuenta pidió el beneficio? ¿y la cotización lo aplicó? */
  readonly pedido = computed(() => { this.carts.version(); return !!this.carts.activeCart().membership; });
  readonly aplicado = computed(() => {
    this.carts.version();
    const c = this.carts.activeCart();
    const q: any = c.commercial?.quote;
    return c.membership && q?.membership ? { unidades: Number(q.membership.units), monto: Number(q.membership.amountApplied) } : null;
  });
  readonly errorCotizacion = computed(() => { this.carts.version(); const c = this.carts.activeCart(); return c.membership ? (c.commercial?.error || '') : ''; });

  /* ------------------------------------------------ 0064 · puntos y sellos */
  readonly saldo = computed(() => Number(this.puntos()?.resumen?.puntos ?? 0));
  readonly puntosActivos = computed(() => !!this.puntos()?.resumen?.enabled);
  readonly tarjetas = computed(() => this.puntos()?.tarjetas ?? []);
  /** El catálogo de canje, con si le alcanza o cuánto le falta. */
  readonly recompensas = computed(() => (this.puntos()?.recompensas ?? []).map(r => ({ ...r, faltan: Math.max(0, r.points_cost - this.saldo()) })));
  readonly canje = computed(() => { this.carts.version(); return this.carts.activeCart().canje ?? null; });
  /** Lo que la cotización aplicó de verdad. */
  readonly aplicadoPuntos = computed(() => {
    this.carts.version();
    const c = this.carts.activeCart(), q: any = c.commercial?.quote;
    return c.canje?.rewardId && q?.points ? { nombre: String(q.points.name), costo: Number(q.points.cost), monto: Number(q.points.amountApplied) } : null;
  });
  readonly aplicadoSellos = computed(() => {
    this.carts.version();
    const c = this.carts.activeCart(), q: any = c.commercial?.quote;
    return c.canje?.cardId && q?.stamps ? { nombre: String(q.stamps.name), costo: Number(q.stamps.cost), monto: Number(q.stamps.amountApplied) } : null;
  });
  readonly errorCanje = computed(() => { this.carts.version(); const c = this.carts.activeCart(); return c.canje ? (c.commercial?.error || '') : ''; });

  constructor() {
    /* Cambió el cliente o la cuenta: se vuelve a preguntar. */
    effect(() => {
      const cli = this.cliente()?.id ?? null;
      const cuenta = this.carts.activeCart().id;
      untracked(() => {
        if (cli === this.clienteCargado && cuenta === this.cuentaCargada) return;
        this.clienteCargado = cli; this.cuentaCargada = cuenta;
        void this.cargar();
      });
    });
  }

  async cargar(): Promise<void> {
    const id = this.clienteCargado;
    if (!id) { this.estado.set(null); this.puntos.set(null); return; }
    this.cargando.set(true);
    try {
      const [r, p] = await Promise.all([
        this.api?.clubEstado?.({ customerId: id }),
        this.api?.puntosEstado?.({ customerId: id }),
      ]);
      if (this.clienteCargado !== id) return;
      this.estado.set(r?.success ? r.data : null);
      this.puntos.set(p?.success ? p.data : null);
    } finally {
      this.cargando.set(false);
    }
  }

  private fuente(p: ProductoClub): LineSource {
    return { productId: p.product_id, productName: p.nombre, unitPrice: Number(p.price), inventoryMode: p.inventory_mode ?? undefined,
             tasaIva: p.tasa_iva, objetoImpuesto: p.objeto_impuesto, claveProdServ: p.clave_prod_serv, claveUnidad: p.clave_unidad };
  }
  private fuentePlan(p: MembresiaCliente | PlanClub): LineSource | null {
    if (!p.sale_product_id) return null;
    return { productId: p.sale_product_id, productName: p.sale_product_name ?? 'Membresía', unitPrice: Number(p.sale_product_price ?? 0),
             inventoryMode: p.sale_product_inventory_mode ?? undefined, tasaIva: p.sale_product_tasa_iva, objetoImpuesto: p.sale_product_objeto_impuesto,
             claveProdServ: p.sale_product_clave_prod_serv, claveUnidad: p.sale_product_clave_unidad };
  }

  /** ¿Ya hay en la cuenta algo que el plan regala? */
  hayElegibleEnCuenta(): boolean {
    const ids = new Set(this.productos().map(p => p.product_id));
    return this.carts.activeCart().lines.some(l => ids.has(l.productId));
  }

  /** Dar el beneficio: si no hay un producto del plan en la cuenta, agrega el elegido (o el primero). */
  darBeneficio(productId?: number): void {
    const m = this.membresia(), cli = this.cliente();
    if (!m || !cli) return;
    if (productId || !this.hayElegibleEnCuenta()) {
      const p = this.productos().find(x => x.product_id === productId) ?? this.productos()[0];
      if (p) this.carts.addProduct(this.fuente(p), 1);
    }
    this.carts.setMembership({ membershipId: m.id, customerId: cli.id });
  }

  quitarBeneficio(): void { this.carts.setMembership(null); }

  /** Renovar (un periodo) y, si se puede, dar el café en la misma venta. */
  renovar(conBeneficio = true): void {
    const m = this.membresia();
    const f = m ? this.fuentePlan(m) : null;
    if (!m || !f) return;
    if (!this.carts.activeCart().lines.some(l => l.productId === f.productId)) this.carts.addProduct(f, 1);
    if (conBeneficio && Number(m.disponibles_hoy) > 0) this.darBeneficio();
  }

  /** Afiliar: agrega el producto de cobro del plan; la venta crea la membresía. */
  afiliar(planId: number): void {
    const p = this.planes().find(x => x.id === planId);
    const f = p ? this.fuentePlan(p) : null;
    if (f && !this.carts.activeCart().lines.some(l => l.productId === f.productId)) this.carts.addProduct(f, 1);
  }

  /** 0064 · Canjear una recompensa con puntos. Si es un producto y no está en la cuenta, se agrega. */
  canjearRecompensa(rewardId: number): void {
    const r = this.puntos()?.recompensas.find(x => x.id === rewardId), cli = this.cliente();
    if (!r || !cli) return;
    if (r.kind === 'FREE_PRODUCT' && r.product_id && !this.carts.activeCart().lines.some(l => l.productId === r.product_id)) {
      this.carts.addProduct({ productId: r.product_id, productName: r.product_name ?? r.name, unitPrice: Number(r.product_price ?? 0),
        inventoryMode: r.product_inventory_mode ?? undefined, tasaIva: r.product_tasa_iva, objetoImpuesto: r.product_objeto_impuesto,
        claveProdServ: r.product_clave_prod_serv, claveUnidad: r.product_clave_unidad }, 1);
    }
    this.carts.setCanje({ customerId: cli.id, rewardId: r.id, cardId: this.canje()?.cardId ?? null });
  }

  /** 0064 · Canjear una tarjeta de sellos llena: el regalo es su producto (o el elegido). */
  canjearTarjeta(cardId: number, productId?: number): void {
    const t = this.tarjetas().find(x => x.id === cardId), cli = this.cliente();
    if (!t || !cli) return;
    const premios = (this.puntos()?.productos ?? []).filter(p => p.card_id === cardId && p.es_premio);
    const enCuenta = premios.some(p => this.carts.activeCart().lines.some(l => l.productId === p.product_id));
    if (productId || !enCuenta) {
      const p = premios.find(x => x.product_id === productId) ?? premios[0];
      if (p) this.carts.addProduct({ productId: p.product_id, productName: p.nombre, unitPrice: Number(p.price), inventoryMode: p.inventory_mode ?? undefined,
        tasaIva: p.tasa_iva, objetoImpuesto: p.objeto_impuesto, claveProdServ: p.clave_prod_serv, claveUnidad: p.clave_unidad }, 1);
    }
    this.carts.setCanje({ customerId: cli.id, rewardId: this.canje()?.rewardId ?? null, cardId });
  }

  quitarCanjePuntos(): void { const c = this.canje(); if (c) this.carts.setCanje({ ...c, rewardId: null }); }
  quitarCanjeSellos(): void { const c = this.canje(); if (c) this.carts.setCanje({ ...c, cardId: null }); }

  /** ¿La cuenta ya trae el cobro de una membresía? */
  cobraMembresia(): boolean {
    const ids = new Set([...this.planes().map(p => p.sale_product_id), this.membresia()?.sale_product_id].filter(Boolean) as number[]);
    return this.carts.activeCart().lines.some(l => ids.has(l.productId));
  }
}
