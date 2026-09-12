import { ChangeDetectorRef, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AppliedCoupon, CartService, CouponCheck, LoyaltyService } from '../core';

/*
 * Cupon en el punto de venta.
 *
 * Una sola pieza para Retail y para Touch: las dos cobran por
 * SaleService.checkout(), y el cupon viaja en el carrito hasta ahi.
 *
 * QUE HACE Y QUE NO
 * -----------------
 * Aqui NO se decide si un cupon vale. Se teclea o se escanea un codigo, se le
 * pregunta a SQL, y se ensena lo que SQL respondio. Un cupon caducado no es
 * un error del sistema: es un papel viejo, y el cajero necesita poder decirle
 * al cliente exactamente por que no se lo puede aceptar.
 *
 * APLICAR = PONER LA LINEA A CERO
 * -------------------------------
 * El unico beneficio que hoy se puede aplicar es el producto gratis, y se
 * aplica poniendo a cero el precio de esa linea. Encaja con el contrato de
 * venta tal y como esta: la linea sigue descontando inventario, el ticket
 * dice "0.00" -que es la verdad- y el total se calcula solo.
 *
 * Importe y porcentaje se validan y se explican, pero no se aplican: la venta
 * no tiene concepto de descuento. Ver la nota larga en `sp_coupon_redeem`.
 *
 * CONSUMIR ES DESPUES
 * -------------------
 * Esto no gasta el cupon. Lo gasta `SaleService.checkout()` cuando la venta
 * ya esta cobrada, porque la redencion se liga a la venta.
 */
@Component({
  selector: 'app-cupon-venta',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './cupon-venta.html',
  styleUrls: ['./cupon-venta.css'],
})
export class CuponVenta {
  private readonly loyalty = inject(LoyaltyService);
  private readonly cart = inject(CartService);
  private readonly cd = inject(ChangeDetectorRef);

  codigo = '';
  comprobando = signal(false);
  /** Lo ultimo que dijo SQL sobre el codigo tecleado. */
  revision = signal<CouponCheck | null>(null);

  /** El cupon ya aplicado a esta cuenta, si lo hay. */
  readonly aplicado = computed<AppliedCoupon | null>(() => {
    this.cart.version();
    return this.cart.activeCart().coupon ?? null;
  });

  get disponible(): boolean {
    return this.loyalty.disponible;
  }

  async comprobar(): Promise<void> {
    const code = this.codigo.trim();
    if (!code || this.comprobando()) return;
    this.comprobando.set(true);
    try {
      this.revision.set(await this.loyalty.validarCupon(code));
    } finally {
      this.comprobando.set(false);
      this.cd.detectChanges();
    }
  }

  /**
   * Aplicar: pone a cero la linea del producto que regala el cupon.
   *
   * Si ese producto no esta en el carrito no se aplica nada y se dice: es la
   * situacion normal de un cupon de cafe cuando nadie pidio cafe, y descontar
   * cualquier otra cosa seria regalar lo que no tocaba.
   */
  aplicar(): void {
    const r = this.revision();
    if (!r?.ok || !r.aplicable) return;

    const lineas = this.cart.activeCart().lines;
    const linea = lineas.find(l => l.productId === r.product_id && l.effectiveUnitPrice > 0);
    if (!linea) {
      this.revision.set({
        ...r, ok: false, aplicable: false,
        mensaje: `Agrega ${r.product_name || 'el producto'} a la venta para poder aplicar este cupón.`,
      });
      this.cd.detectChanges();
      return;
    }

    const precioOriginal = linea.unitPrice;
    // Lo que de verdad se rebaja: una unidad, la que regala el cupon.
    const rebajado = linea.effectiveUnitPrice;
    this.cart.setPrice(linea, 0);
    this.cart.setCoupon({
      code: r.code,
      instanceId: r.instance_id ?? 0,
      nombre: r.nombre ?? 'Cupón',
      kind: (r.kind ?? 'FREE_PRODUCT') as AppliedCoupon['kind'],
      productId: r.product_id,
      productName: r.product_name,
      amountApplied: rebajado,
      precioOriginal,
    });
    this.revision.set(null);
    this.codigo = '';
    this.cd.detectChanges();
  }

  /**
   * Quitar antes de cobrar: devuelve la linea a su precio.
   *
   * Como el cupon todavia no se ha canjeado -eso ocurre al cobrar-, quitarlo
   * aqui no gasta nada y el papel sigue sirviendo.
   */
  quitar(): void {
    const c = this.aplicado();
    if (!c) return;
    if (c.precioOriginal != null) {
      const linea = this.cart.activeCart().lines
        .find(l => l.productId === c.productId && l.unitPrice === 0);
      if (linea) this.cart.setPrice(linea, c.precioOriginal);
    }
    this.cart.setCoupon(null);
    this.cd.detectChanges();
  }

  limpiar(): void {
    this.revision.set(null);
    this.codigo = '';
  }

  /** El beneficio en una linea, para que el cajero lo lea de un vistazo. */
  beneficio(r: CouponCheck): string {
    if (r.kind === 'FREE_PRODUCT') return `${r.product_name || 'Producto'} gratis`;
    if (r.kind === 'AMOUNT') return `$${Number(r.amount ?? 0).toFixed(2)} de descuento`;
    if (r.kind === 'PERCENT') return `${Number(r.discount_pct ?? 0)}% de descuento`;
    return r.nombre || 'Cupón';
  }
}
