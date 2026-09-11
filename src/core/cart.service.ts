import { Injectable, computed, signal } from '@angular/core';
import { CartCustomer, LineSource, SelectedOption, ServiceMode } from './models';

/**
 * Linea de carrito. Clase (no interfaz) para que `subtotal` sea un getter y
 * las plantillas que ya usaban `it.subtotal` sigan funcionando.
 */
export class CartLine {
  lineId: number;
  productId: number;
  productName: string;
  qty: number;
  unitPrice: number;
  options: SelectedOption[];
  claveProdServ: string | null;
  claveUnidad: string | null;
  objetoImpuesto: string | null;
  tasaIva: number | null;
  inventoryMode: LineSource['inventoryMode'];
  /** Nota libre de la linea ("sin hielo"). No afecta inventario. */
  note: string | null = null;

  constructor(lineId: number, src: LineSource, qty: number, options: SelectedOption[] = []) {
    this.lineId = lineId;
    this.productId = src.productId;
    this.productName = src.productName;
    this.qty = qty;
    this.unitPrice = Number(src.unitPrice ?? 0);
    this.options = options;
    this.claveProdServ = src.claveProdServ ?? null;
    this.claveUnidad = src.claveUnidad ?? null;
    this.objetoImpuesto = src.objetoImpuesto ?? null;
    this.tasaIva = src.tasaIva ?? null;
    this.inventoryMode = src.inventoryMode;
  }

  /** Precio unitario efectivo: base + deltas de opciones. */
  get effectiveUnitPrice(): number {
    const delta = this.options.reduce((a, o) => a + Number(o.priceDelta || 0) * Number(o.quantity || 1), 0);
    return this.unitPrice + delta;
  }

  get subtotal(): number {
    return this.qty * this.effectiveUnitPrice;
  }

  /** Texto corto de las opciones, para tablas y pantalla de cliente. */
  get optionsLabel(): string {
    return this.options.map(o => (o.quantity > 1 ? `${o.quantity}× ` : '') + o.optionName).join(', ');
  }
}

export interface Cart {
  id: number;
  lines: CartLine[];
  /** Cliente de contado asignado (Retail: "Cliente asignado"). */
  customer: CartCustomer | null;
  /** Cliente de credito elegido al cobrar. */
  creditCustomerId: number | null;
  serviceMode: ServiceMode | null;
  createdAt: number;
  /**
   * Un carrito transitorio no es una cuenta en espera: es una venta cargada
   * por folio (solo lectura / edicion / reembolso). No aparece en las
   * pestanas y al cerrarlo se vuelve al carrito que estaba activo.
   */
  transient: boolean;
  meta?: Record<string, unknown>;
}

export interface CartTotals {
  subtotal: number;
  tax: number;
  total: number;
  itemCount: number;
}

const IVA_POR_DEFECTO = 0.16;

/**
 * PROPIETARIO DEL CARRITO. Retail y Touch NO tienen carrito propio: le piden
 * a este servicio que agregue, cambie o quite lineas, y leen totales de aqui.
 *
 * Ciclo de vida (V1, en memoria):
 *   crear -> modificar -> aparcar (cambiar de cuenta) -> recuperar -> cobrar.
 * Las cuentas sobreviven a la navegacion dentro de la sesion porque el
 * servicio es raiz; no se persisten a disco a proposito (un carrito viejo al
 * arrancar la caja al dia siguiente seria un error, no una ayuda).
 */
@Injectable({ providedIn: 'root' })
export class CartService {
  static readonly MAX_CARTS = 8;

  private seqCart = 0;
  private seqLine = 0;

  /** Todas las cuentas, incluidas las transitorias. */
  private readonly _carts = signal<Cart[]>([]);
  private readonly _activeId = signal<number>(0);
  /** Se incrementa en cada mutacion: las lineas se editan en sitio (ngModel). */
  readonly version = signal(0);

  /** Cuentas visibles como pestanas (no transitorias). */
  readonly carts = computed(() => this._carts().filter(c => !c.transient));
  readonly activeCartId = computed(() => this._activeId());
  readonly activeCart = computed<Cart>(() => {
    const id = this._activeId();
    return this._carts().find(c => c.id === id) ?? this.ensureOne();
  });
  readonly isTransient = computed(() => this.activeCart().transient);

  readonly lines = computed<CartLine[]>(() => { this.version(); return this.activeCart().lines; });
  readonly totals = computed<CartTotals>(() => { this.version(); return CartService.totalsOf(this.activeCart()); });
  readonly total = computed(() => this.totals().total);

  /** Id del carrito que estaba activo antes de abrir un transitorio. */
  private previousActiveId: number | null = null;

  constructor() {
    this.ensureOne();
  }

  // ------------------------------------------------------------------ cuentas

  private ensureOne(): Cart {
    let list = this._carts();
    if (list.some(c => !c.transient)) {
      if (!list.some(c => c.id === this._activeId())) {
        const first = list.find(c => !c.transient)!;
        this._activeId.set(first.id);
      }
      return list.find(c => c.id === this._activeId())!;
    }
    const cart = this.newCart(false);
    list = [...list, cart];
    this._carts.set(list);
    this._activeId.set(cart.id);
    return cart;
  }

  private newCart(transient: boolean, meta?: Record<string, unknown>): Cart {
    return {
      id: ++this.seqCart,
      lines: [],
      customer: null,
      creditCustomerId: null,
      serviceMode: null,
      createdAt: Date.now(),
      transient,
      meta,
    };
  }

  private touch() { this.version.update(v => v + 1); }

  /** Crea una cuenta nueva y la activa. Devuelve null si se alcanzo el limite. */
  createCart(): Cart | null {
    if (this.isTransient()) return null;
    if (this.carts().length >= CartService.MAX_CARTS) return null;
    const cart = this.newCart(false);
    this._carts.update(l => [...l, cart]);
    this._activeId.set(cart.id);
    this.touch();
    return cart;
  }

  /** Aparcar la actual y recuperar otra. */
  switchTo(id: number): boolean {
    if (this.isTransient()) return false;
    if (!this._carts().some(c => c.id === id && !c.transient)) return false;
    this._activeId.set(id);
    this.touch();
    return true;
  }

  /** Cierra (descarta) una cuenta. Siempre queda al menos una. */
  closeCart(id: number): void {
    if (this.isTransient()) return;
    const list = this._carts();
    const idx = list.findIndex(c => c.id === id && !c.transient);
    if (idx < 0) return;
    const wasActive = id === this._activeId();
    const next = list.filter(c => c.id !== id);
    this._carts.set(next);
    if (next.filter(c => !c.transient).length === 0) {
      const fresh = this.newCart(false);
      this._carts.set([...next, fresh]);
      this._activeId.set(fresh.id);
    } else if (wasActive) {
      const visibles = next.filter(c => !c.transient);
      const vecino = visibles[Math.max(0, Math.min(idx - 1, visibles.length - 1))];
      this._activeId.set(vecino.id);
    }
    this.touch();
  }

  /**
   * Tras cobrar: la cuenta activa desaparece y se pasa a la vecina; si era la
   * unica, se vacia y se conserva. Mismo comportamiento que tenia Retail.
   */
  completeActive(): void {
    const active = this.activeCart();
    if (active.transient) return;
    const visibles = this.carts();
    if (visibles.length > 1) {
      this.closeCart(active.id);
    } else {
      active.lines = [];
      active.customer = null;
      active.creditCustomerId = null;
      active.serviceMode = null;
      this.touch();
    }
  }

  /** Vacia la cuenta activa sin cerrarla. */
  clearActive(): void {
    const active = this.activeCart();
    active.lines = [];
    active.customer = null;
    active.creditCustomerId = null;
    this.touch();
  }

  // -------------------------------------------------------------- transitorio

  /**
   * Abre (o reemplaza) el carrito transitorio con las lineas dadas. Se usa
   * para una venta cargada por folio: al cerrarlo se vuelve a la cuenta que
   * estaba activa, con sus productos intactos.
   */
  openTransient(lines: CartLine[], meta?: Record<string, unknown>): Cart {
    const active = this.activeCart();
    if (active.transient) {
      active.lines = lines;
      active.meta = meta;
      this.touch();
      return active;
    }
    this.previousActiveId = active.id;
    const t = this.newCart(true, meta);
    t.lines = lines;
    this._carts.update(l => [...l, t]);
    this._activeId.set(t.id);
    this.touch();
    return t;
  }

  closeTransient(): void {
    const active = this.activeCart();
    if (!active.transient) return;
    this._carts.update(l => l.filter(c => c.id !== active.id));
    const prev = this.previousActiveId;
    this.previousActiveId = null;
    if (prev != null && this._carts().some(c => c.id === prev)) this._activeId.set(prev);
    else this.ensureOne();
    this.touch();
  }

  // ------------------------------------------------------------------- lineas

  /** Construye una linea sin agregarla (para cargar ventas por folio). */
  makeLine(src: LineSource, qty: number, options: SelectedOption[] = []): CartLine {
    return new CartLine(++this.seqLine, src, qty, options);
  }

  /**
   * Agrega un producto. Si ya hay una linea del mismo producto con las mismas
   * opciones, suma cantidad (comportamiento Retail). Devuelve la linea.
   */
  addProduct(src: LineSource, qty = 1, options: SelectedOption[] = []): CartLine {
    const cart = this.activeCart();
    const key = CartService.optionsKey(options);
    const existing = cart.lines.find(l => l.productId === src.productId && CartService.optionsKey(l.options) === key);
    if (existing) {
      existing.qty += qty;
      this.touch();
      return existing;
    }
    const line = this.makeLine(src, qty, options);
    cart.lines.push(line);
    this.touch();
    return line;
  }

  setQty(line: CartLine, qty: number, min = 1): void {
    const q = Number(qty);
    line.qty = Number.isFinite(q) && q >= min ? q : min;
    this.touch();
  }

  adjustQty(line: CartLine, delta: number, min = 1): void {
    this.setQty(line, Number(line.qty || 0) + delta, min);
  }

  setPrice(line: CartLine, price: number): void {
    const p = Number(price);
    line.unitPrice = Number.isFinite(p) && p >= 0 ? p : 0;
    this.touch();
  }

  removeLine(line: CartLine): void {
    const cart = this.activeCart();
    cart.lines = cart.lines.filter(l => l !== line);
    this.touch();
  }

  /** La ultima linea agregada o, si se quito, la ultima de la lista. */
  lastLine(): CartLine | null {
    const ls = this.activeCart().lines;
    return ls.length ? ls[ls.length - 1] : null;
  }

  // ------------------------------------------------------------------ cliente

  setCustomer(c: CartCustomer | null): void {
    this.activeCart().customer = c;
    this.touch();
  }

  setCreditCustomer(id: number | null): void {
    this.activeCart().creditCustomerId = id;
    this.touch();
  }

  setServiceMode(m: ServiceMode | null): void {
    this.activeCart().serviceMode = m;
    this.touch();
  }

  // ------------------------------------------------------------------ totales

  static totalsOf(cart: Cart): CartTotals {
    let total = 0;
    let tax = 0;
    let itemCount = 0;
    for (const l of cart.lines) {
      const imp = l.subtotal;
      const rate = l.tasaIva ?? IVA_POR_DEFECTO;
      total += imp;
      tax += imp - imp / (1 + rate);
      itemCount += Number(l.qty) || 0;
    }
    return { total, tax, subtotal: total - tax, itemCount };
  }

  static optionsKey(options: SelectedOption[]): string {
    return options
      .map(o => `${o.groupId}:${o.optionId}:${o.quantity}`)
      .sort()
      .join('|');
  }
}
