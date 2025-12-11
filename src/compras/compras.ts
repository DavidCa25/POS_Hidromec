import { Component, HostListener, LOCALE_ID, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgIf, NgFor, CurrencyPipe, DatePipe, SlicePipe, NgClass } from '@angular/common';
import { registerLocaleData } from '@angular/common';
import localeEsMX from '@angular/common/locales/es-MX';
import { AuthService } from '../services/auth.service';
import Swal from 'sweetalert2';

registerLocaleData(localeEsMX, 'es-MX');

interface ProductRow {
  id: number;
  part_number: string;
  product_name: string;
  price: number;
  stock: number;
  category_name: string;
  brand_name: string;
  purchasePrice?: number;
}

interface Proveedor {
  id: number;
  nombre: string;
}

class PurchaseItem {
  constructor(
    public productId: number,
    public productName: string,
    public qty: number,
    public unitPrice: number,     // Precio de venta (referencia)
    public purchasePrice: number,
    public proveedorId: number | null
  ) {}
  get subtotal(): number {
    return this.qty * this.purchasePrice;
  }
}

@Component({
  selector: 'app-compras',
  templateUrl: './compras.html',
  imports: [RouterOutlet, FormsModule, NgIf, NgFor, CurrencyPipe, DatePipe, SlicePipe, NgClass],
  styleUrls: ['./compras.css'],
  providers: [
    { provide: LOCALE_ID, useValue: 'es-MX' }
  ]
})
export class Compras implements OnInit {
  folio: number | null = null;
  today = new Date();

  proveedores: Proveedor[] = [];
  productos: ProductRow[] = [];
  filtro = '';

  items: PurchaseItem[] = [];

  // Forma de pago al proveedor
  pagoProveedor: 'NOPAGAR' | 'EFECTIVO' | 'CHEQUE' | 'TRANSFERENCIA' = 'NOPAGAR';

  // Estado modales
  showModalProductos = false;
  showPagoModal = false;

  // Datos del modal de pago
  montoEntregado: number | null = null;
  numeroCheque = '';
  referenciaTransferencia = '';
  proveedorPagoNombre = '';

  // IVA
  ivaTasa = 0.16;

  constructor(private authService: AuthService) {
    this.cargarProveedores();
  }

  ngOnInit() {
    this.cargarFolio();
  }

  get usuarioActualId(): number {
    return this.authService.usuarioActualId ?? 0;
  }

  /** ====== Cálculos ====== **/
  get subtotal(): number {
    return this.items.reduce((acc, it) => acc + it.subtotal, 0);
  }
  get iva(): number {
    return this.subtotal * this.ivaTasa;
  }
  get total(): number {
    return this.subtotal + this.iva;
  }
  get cambioProveedor(): number {
    if (this.montoEntregado == null) return 0;
    return this.montoEntregado - this.total;
  }

  /** ====== Cargar catálogo ====== **/
  async cargarProveedores() {
    try {
      const rs = await (window as any).electronAPI.getSuppliers();
      this.proveedores = Array.isArray(rs) ? rs : [];
    } catch (e) {
      console.error('❌ Error al cargar proveedores:', e);
      this.proveedores = [];
    }
  }

  cargarFolio() {
    (window as any).electronAPI.getNextPurchaseFolio()
      .then((resFolio: any) => {
        if (resFolio?.success) {
          this.folio = resFolio.folio;
        }
      })
      .catch((err: any) => {
        console.error('Error al obtener folio al iniciar:', err);
      });
  }

  /** ====== Productos ====== **/
  async abrirModalProductos() {
    this.filtro = '';
    await this.cargarProductosActivos();
    this.showModalProductos = true;
  }

  cerrarModalProductos() {
    this.showModalProductos = false;
  }

  async cargarProductosActivos() {
    try {
      const rs = await (window as any).electronAPI.getActiveProducts();
      const rows = Array.isArray(rs?.recordset) ? rs.recordset : Array.isArray(rs) ? rs : [];
      this.productos = rows.map((r: any) => ({
        id: r.id,
        part_number: r.part_number,
        product_name: r.product_name,
        price: r.price,
        stock: r.stock,
        category_name: r.category_name,
        brand_name: r.brand_name,
        purchasePrice: 0
      })) as (ProductRow & { purchasePrice: number })[];
    } catch (e) {
      console.error('❌ Error al cargar productos activos:', e);
      this.productos = [];
    }
  }

  seleccionarProducto(p: ProductRow & { purchasePrice?: number }) {
    const existing = this.items.find(it => it.productId === p.id);
    if (existing) {
      existing.qty += 1;
      this.showModalProductos = false;
      return;
    }

    const item = new PurchaseItem(
      p.id,
      p.product_name,
      1,
      p.price ?? 0,
      p.purchasePrice ?? 0,
      null
    );
    this.items.push(item);
    this.showModalProductos = false;
  }

  /** ====== Eventos de edición de items ====== **/
  onQtyChange(i: number) {
    const it = this.items[i];
    if (!it) return;
    if (it.qty < 1) it.qty = 1;
  }

  onPurchasePriceChange(i: number) {
    const it = this.items[i];
    if (!it) return;
    if (it.purchasePrice < 0) it.purchasePrice = 0;
  }

  onProveedorChange(i: number, value?: number | null) {
    const item = this.items[i];
    if (!item) return;
    if (value !== undefined) {
      item.proveedorId = value === null ? null : Number(value);
    }
  }

  quitarItem(i: number) {
    this.items.splice(i, 1);
  }

  /** ====== Flujo principal de guardar ====== **/

  private async validarAntesDeGuardar(): Promise<boolean> {
    if (this.items.length === 0) {
      await Swal.fire({
        icon: 'error',
        title: 'Oops...',
        text: 'No hay productos en la compra'
      });
      return false;
    }

    const sinProveedor = this.items.some(it => !it.proveedorId);
    if (sinProveedor) {
      await Swal.fire({
        icon: 'error',
        title: 'Oops...',
        text: 'Todos los productos deben tener un proveedor seleccionado'
      });
      return false;
    }

    return true;
  }

  private construirPayloadCompra() {
    return {
      user_id: this.usuarioActualId,
      tax_rate: this.ivaTasa,
      tax_amount: this.iva,
      subtotal: this.subtotal,
      total: this.total,
      detalles: this.items.map(it => ({
        product_id: it.productId,
        supplier_id: it.proveedorId,
        quantity: it.qty,
        unit_price: it.purchasePrice
      }))
    };
  }

  private async ejecutarCompra(conPago: boolean): Promise<void> {
    const esValido = await this.validarAntesDeGuardar();
    if (!esValido) return;

    const payload = this.construirPayloadCompra();
    console.log('Registrando compra:', payload);

    try {
      const res = await (window as any).electronAPI.registerPurchase(payload);

      if (!res?.success) {
        console.error(res?.error);
        await Swal.fire({
          icon: 'error',
          title: 'Error al registrar compra',
          text: res?.message || 'Ocurrió un error inesperado.'
        });
        return;
      }

      const purchaseId: number | undefined =
        res.purchaseId ?? res.purchase_id ?? res.id;

      await Swal.fire({
        icon: 'success',
        title: 'Compra registrada',
        text: purchaseId ? `Folio: ${purchaseId}` : 'La compra se guardó correctamente.',
        confirmButtonText: 'Aceptar'
      });

      if (conPago && this.pagoProveedor !== 'NOPAGAR' && purchaseId) {
        const supplierId = this.items[0].proveedorId!;
        const allSameSupplier = this.items.every(
          it => it.proveedorId === supplierId
        );

        if (!allSameSupplier) {
          await Swal.fire({
            icon: 'warning',
            title: 'Pago al proveedor no registrado',
            text: 'Para registrar el pago inmediato, todos los productos deben ser del mismo proveedor.'
          });
        } else {
          const noteParts: string[] = [`Pago ${this.pagoProveedor} compra ${purchaseId}`];

          if (this.pagoProveedor === 'EFECTIVO' && this.montoEntregado != null) {
            const cambio = this.montoEntregado - this.total;
            noteParts.push(
              `Entregado: ${this.montoEntregado.toFixed(2)}`,
              `Cambio: ${cambio.toFixed(2)}`
            );
          } else if (this.pagoProveedor === 'CHEQUE' && this.numeroCheque) {
            noteParts.push(`Cheque: ${this.numeroCheque}`);
          } else if (this.pagoProveedor === 'TRANSFERENCIA' && this.referenciaTransferencia) {
            noteParts.push(`Referencia: ${this.referenciaTransferencia}`);
          }

          const payPayload = {
            user_id: this.usuarioActualId,
            supplier_id: supplierId,
            purchase_id: purchaseId,
            amount: this.total,
            payment_method: this.pagoProveedor,
            note: noteParts.join(' | ')
          };

          console.log('💸 Registrando pago a proveedor:', payPayload);

          const payRes = await (window as any).electronAPI.registerSupplierPayment(payPayload);

          if (!payRes?.success) {
            console.error(payRes?.error);
            await Swal.fire({
              icon: 'warning',
              title: 'Compra guardada, pero…',
              text: 'No se pudo registrar el pago al proveedor. Revísalo en el módulo de pagos.'
            });
          }
        }
      }

      // Reset formulario + folio
      this.items = [];
      this.pagoProveedor = 'NOPAGAR';
      this.montoEntregado = null;
      this.numeroCheque = '';
      this.referenciaTransferencia = '';

      const resFolio = await (window as any).electronAPI.getNextPurchaseFolio();
      if (resFolio?.success) {
        this.folio = resFolio.folio;
      }

    } catch (err: any) {
      console.error('❌ Error en ejecutarCompra:', err);
      await Swal.fire({
        icon: 'error',
        title: 'Error al registrar compra',
        text: 'Ocurrió un error inesperado.'
      });
    }
  }

  async registrarCompra() {
    const esValido = await this.validarAntesDeGuardar();
    if (!esValido) return;

    if (this.pagoProveedor === 'NOPAGAR') {
      await this.ejecutarCompra(false);
      return;
    }

    const firstSupplierId = this.items[0].proveedorId;
    const prov = this.proveedores.find(p => p.id === firstSupplierId);
    this.proveedorPagoNombre = prov?.nombre || '';

    this.montoEntregado = this.total; 
    this.numeroCheque = '';
    this.referenciaTransferencia = '';

    this.showPagoModal = true;
  }

  cerrarPagoModal() {
    this.showPagoModal = false;
  }

  async soloRegistrarCompra() {
    this.showPagoModal = false;
    await this.ejecutarCompra(false);
  }

  async confirmarCompraConPago() {
    this.showPagoModal = false;
    await this.ejecutarCompra(true);
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    if (event.key === 'F8') {
      event.preventDefault();
      this.registrarCompra();
    }
  }
}
