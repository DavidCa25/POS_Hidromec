import { Injectable, inject } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { RegisterService } from '../services/register.service';
import { Cart, CartService } from './cart.service';
import { CatalogService } from './catalog.service';
import { CustomerDisplayService } from './customer-display.service';
import { ElectronBridge } from './electron-bridge.service';
import { CheckoutResult, Payment, SaleIntent, SoldLine } from './models';
import { ShiftService } from './shift.service';

export interface CheckoutOptions {
  /** Abrir el cajon tras registrar (Retail: cualquier contado que no sea terminal). */
  openDrawer?: boolean;
  /** Imprimir ticket en silencio tras registrar. */
  autoPrint?: boolean;
}

/**
 * UNICO punto del frontend que registra una venta.
 *
 * Retail y Touch llaman a `checkout()`. Aqui se traduce el carrito al
 * contrato de venta, se invoca el IPC que ejecuta sp_register_sale, y
 * DESPUES de que SQL confirmo se disparan los efectos (cajon, pantalla de
 * cliente, ticket). Ningun dispositivo participa antes del COMMIT.
 *
 * No hay `retailRegisterSale` ni `touchRegisterSale`: si una experiencia
 * necesita algo distinto, se expresa en el contrato (opciones, service mode),
 * nunca en un segundo camino.
 */
@Injectable({ providedIn: 'root' })
export class SaleService {
  private readonly bridge = inject(ElectronBridge);
  private readonly auth = inject(AuthService);
  private readonly register = inject(RegisterService);
  private readonly cart = inject(CartService);
  private readonly catalog = inject(CatalogService);
  private readonly display = inject(CustomerDisplayService);
  private readonly shift = inject(ShiftService);

  /** Evita el doble envio: una venta en vuelo bloquea la siguiente. */
  private inflight = false;
  get busy(): boolean { return this.inflight; }

  // ------------------------------------------------------------ contrato

  /** Carrito -> intencion de venta. Puro: no toca IPC. */
  buildIntent(cart: Cart, payment: Payment): SaleIntent {
    const isCredit = payment.method === 'CREDITO';
    return {
      userId: this.auth.usuarioActualId as number,
      paymentMethod: payment.method,
      lines: cart.lines.map(l => ({
        productId: l.productId,
        qty: l.qty,
        // El precio que viaja es el efectivo (base + opciones): SQL guarda lo
        // que se cobro por unidad de esa linea.
        unitPrice: l.effectiveUnitPrice,
        options: l.options,
        note: l.note ?? null,
      })),
      customerId: isCredit ? (payment.creditCustomerId ?? null) : (cart.customer?.id ?? null),
      dueDate: isCredit ? (payment.dueDate ?? null) : null,
      registerId: this.register.registerId,
      serviceMode: cart.serviceMode,
    };
  }

  /** Validaciones de negocio previas al cobro. Mensajes iguales a Retail. */
  validate(cart: Cart, payment: Payment): string | null {
    const t = CartService.totalsOf(cart);
    if (!cart.lines.length) return 'Agrega productos a la venta';
    if (t.total <= 0) return 'El total de la venta debe ser mayor a cero';
    if (payment.method === 'CREDITO') {
      if (payment.creditCustomerId == null) return 'Selecciona el cliente para la venta a crédito.';
      return null;
    }
    if (payment.method === 'TERMINAL_MP') return null;
    if (payment.received == null || payment.received < t.total) {
      return 'El dinero recibido debe ser mayor o igual al total de la venta';
    }
    return null;
  }

  // ------------------------------------------------------------- cobro

  /**
   * Registra la venta del carrito activo y ejecuta los efectos posteriores.
   * Nunca lanza: devuelve { ok:false, error } para que la UI lo muestre.
   */
  async checkout(payment: Payment, opts: CheckoutOptions = {}): Promise<CheckoutResult> {
    if (this.inflight) return { ok: false, error: 'Hay una venta en proceso.' };
    const cart = this.cart.activeCart();
    const err = this.validate(cart, payment);
    if (err) return { ok: false, error: err };

    // Retail y Touch pasan los dos por aqui: es el sitio donde la regla se
    // comprueba una sola vez para las dos experiencias. `ensureOpen` relee de
    // SQL si el estado en memoria dice que no hay turno, asi que un turno
    // abierto en otra ventana tampoco bloquea de mas. La palabra final la
    // tiene sp_register_sale, que rechaza la venta sin turno.
    if (!(await this.shift.ensureOpen())) {
      return { ok: false, error: 'Abre el turno de esta caja antes de vender.' };
    }

    const api = this.bridge.api;
    if (!api?.registerSale) return { ok: false, error: 'No se pudo registrar la venta (API no disponible).' };

    const intent = this.buildIntent(cart, payment);
    const totals = CartService.totalsOf(cart);
    const isCredit = payment.method === 'CREDITO';
    const sold: SoldLine[] = cart.lines.map(l => ({
      productId: l.productId, productName: l.productName, qty: l.qty, unitPrice: l.effectiveUnitPrice,
      claveProdServ: l.claveProdServ, claveUnidad: l.claveUnidad, objetoImpuesto: l.objetoImpuesto,
      tasaIva: l.tasaIva, options: l.options,
    }));
    const customer = cart.customer;

    this.inflight = true;
    try {
      const resp = await this.registerIntent(intent);
      if (!resp?.success) {
        return { ok: false, error: resp?.error || 'No se pudo registrar la venta.' };
      }
      const saleId: number | null = resp.saleId ?? resp.id ?? resp.folio ?? null;

      // --- Efectos posteriores al COMMIT ---
      let paid = totals.total;
      let change = 0;
      if (!isCredit) {
        if (payment.method === 'TERMINAL_MP') {
          paid = totals.total; change = 0;
        } else {
          paid = payment.received ?? totals.total;
          change = Math.max(0, paid - totals.total);
        }
        if (opts.openDrawer) {
          try { await api.openCashDrawer?.({ reason: 'payment' }); } catch { /* noop */ }
        }
      }

      this.display.showCheckout({
        total: totals.total,
        paid: isCredit ? null : paid,
        change: isCredit ? null : change,
        method: payment.method,
        credito: isCredit,
      });

      if (opts.autoPrint && saleId && !isCredit) {
        try {
          await this.printTicket(saleId, { pagado: paid, cambio: change, silent: true, paymentMethod: payment.method });
        } catch { /* la impresion nunca deshace una venta ya registrada */ }
      }

      this.cart.completeActive();
      this.catalog.invalidate();

      return { ok: true, saleId, total: totals.total, paid, change, isCredit, lines: sold, customer };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Ocurrió un error inesperado.' };
    } finally {
      this.inflight = false;
    }
  }

  /**
   * Envia la intencion al unico IPC de venta.
   *
   * Con `registerSaleV2` viaja completa (opciones por linea y service mode).
   * Si el preload es anterior, se degrada a la firma posicional: la venta se
   * registra igual, sin modificadores, que es justo lo que hace Retail.
   */
  private registerIntent(intent: SaleIntent): Promise<any> {
    const api = this.bridge.api;
    if (api.registerSaleV2) {
      return api.registerSaleV2({
        userId: intent.userId,
        paymentMethod: intent.paymentMethod,
        lines: intent.lines.map(l => ({
          productId: l.productId,
          qty: l.qty,
          unitPrice: l.unitPrice,
          note: l.note ?? null,
          options: l.options.map(o => ({ optionId: o.optionId, quantity: o.quantity })),
        })),
        customerId: intent.customerId,
        dueDate: intent.dueDate,
        registerId: intent.registerId,
        serviceMode: intent.serviceMode,
      });
    }
    const items = intent.lines.map(l => ({ productId: l.productId, qty: l.qty, unitPrice: l.unitPrice }));
    return api.registerSale(
      intent.userId,
      intent.paymentMethod,
      items,
      intent.customerId,
      intent.dueDate,
      intent.registerId,
    );
  }

  // --------------------------------------------------------- posventa

  async printTicket(saleId: number, opts: { pagado?: number | null; cambio?: number | null; silent?: boolean; printerName?: string | null; paymentMethod?: string | null }): Promise<{ success: boolean; error?: string }> {
    const api = this.bridge.api;
    if (!api?.printSaleTicket) return { success: false, error: 'Falta electronAPI.printSaleTicket en preload.' };
    const resp = await api.printSaleTicket({
      saleId,
      pagado: opts.pagado ?? null,
      cambio: opts.cambio ?? null,
      silent: opts.silent ?? true,
      printerName: opts.printerName ?? undefined,
      paymentMethod: opts.paymentMethod ?? undefined,
    });
    return resp ?? { success: false };
  }

  async openDrawer(): Promise<boolean> {
    const api = this.bridge.api;
    if (!api?.openCashDrawer) return false;
    await api.openCashDrawer();
    return true;
  }

  async nextFolio(): Promise<number> {
    try {
      const resp = await this.bridge.api?.getActualFolio?.();
      const next = Number(resp?.data?.next_folio ?? 1);
      return Number.isFinite(next) && next > 0 ? next : 1;
    } catch { return 1; }
  }

  getSaleByFolio(saleId: number): Promise<any> {
    return this.bridge.api?.getSaleByFolio?.(saleId);
  }

  updateSale(payload: any): Promise<any> {
    return this.bridge.api?.updateSale?.(payload);
  }

  refundSale(payload: any): Promise<any> {
    return this.bridge.api?.refundSale?.(payload);
  }

  generatePdf(payload: { saleId: number; pagado: number; cambio: number }): Promise<any> {
    return this.bridge.api?.generateSalePdf?.(payload);
  }

  sendTicketWhatsApp(saleId: number): Promise<any> {
    return this.bridge.api?.sendSaleTicketWhatsApp?.(saleId);
  }
}
