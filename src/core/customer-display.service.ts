import { Injectable, effect, inject } from '@angular/core';
import { CartService } from './cart.service';
import { ElectronBridge } from './electron-bridge.service';
import { CustomerDisplayState, PaymentMethod } from './models';

/**
 * Pantalla de cliente (segundo monitor).
 *
 * La UI de venta ya no habla con esa ventana: este servicio observa el
 * carrito activo y empuja el estado (push unidireccional, sin SQL, sin
 * escritura). El cobro llama a `showCheckout`. Funciona igual para Retail y
 * para Touch porque los dos usan el mismo CartService.
 */
@Injectable({ providedIn: 'root' })
export class CustomerDisplayService {
  private readonly bridge = inject(ElectronBridge);
  private readonly cart = inject(CartService);

  private pendiente: CustomerDisplayState | null = null;
  private timer: any = null;
  /** Mientras se muestra el "gracias", el carrito vacio no lo interrumpe. */
  private checkoutHasta = 0;

  constructor() {
    // Cada mutacion del carrito (version) reenvia el estado. Se coalescen las
    // rafagas (escaneo rapido) en un solo IPC por frame.
    effect(() => {
      this.cart.version();
      const c = this.cart.activeCart();
      this.push(this.estadoDeCarrito(c));
    });
  }

  private estadoDeCarrito(c: ReturnType<CartService['activeCart']>): CustomerDisplayState {
    if (!c.lines.length) return { mode: 'idle' };
    const t = CartService.totalsOf(c);
    return {
      mode: 'sale',
      items: c.lines.map(l => ({
        name: l.productName,
        qty: l.qty,
        unitPrice: l.effectiveUnitPrice,
        importe: l.subtotal,
        options: l.optionsLabel || undefined,
      })),
      subtotal: t.subtotal,
      tax: t.tax,
      discount: 0,
      total: t.total,
      serviceMode: c.serviceMode,
    };
  }

  showCheckout(p: { total: number; paid: number | null; change: number | null; method: PaymentMethod; credito: boolean }): void {
    this.checkoutHasta = Date.now() + 8000;
    this.push({ mode: 'checkout', ...p }, true);
  }

  showMessage(text: string): void {
    this.push({ mode: 'message', text }, true);
  }

  idle(): void {
    this.push({ mode: 'idle' }, true);
  }

  /** Reenvia el carrito actual (p. ej. al abrir la pantalla). */
  resync(): void {
    this.push(this.estadoDeCarrito(this.cart.activeCart()), true);
  }

  private push(state: CustomerDisplayState, inmediato = false): void {
    // Un carrito vacio justo despues de cobrar no debe pisar el "gracias";
    // la propia ventana ya lo ignora, pero asi no se manda IPC inutil.
    if (state.mode === 'idle' && Date.now() < this.checkoutHasta) return;
    this.pendiente = state;
    if (inmediato) { this.flush(); return; }
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 16);
  }

  private flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const s = this.pendiente;
    this.pendiente = null;
    if (!s) return;
    try {
      this.bridge.api?.customerDisplayState?.(s);
    } catch { /* la pantalla de cliente nunca frena la venta */ }
  }
}
