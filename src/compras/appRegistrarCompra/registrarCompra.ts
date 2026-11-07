import { Component, HostListener, LOCALE_ID, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgIf, NgFor, CurrencyPipe, DatePipe, SlicePipe, DecimalPipe} from '@angular/common';
import { registerLocaleData } from '@angular/common';
import localeEsMX from '@angular/common/locales/es-MX';
import { AuthService } from '../../services/auth.service';
import Swal from 'sweetalert2';
import { CapabilityService, HospitalityService, SociosService } from '../../core';
import { RegisterService } from '../../services/register.service';
import { WxOpcion, WxSelectComponent } from '../../app/wx-select/wx-select.component';
import { ProveedorFormComponent } from '../../app/proveedores/proveedor-form.component';
import { CompraDocumentoComponent, DocumentoAplicado } from './documento/compra-documento.component';
import { fechaDeSql, zonaDeSql } from '../../core/fechas';
import { ShiftService } from '../../core/shift.service';

registerLocaleData(localeEsMX, 'es-MX');

interface ProductRow {
  id: number;
  part_number: string;
  product_name: string;
  price: number;
  cost?: number;
  bar_code?: string;
  stock: number;
  category_name: string;
  brand_name: string;

  base_uom: string;
  sellable: boolean;
  objeto_impuesto: string;
  tasa_iva: number;

  purchasePrice?: number;

  profitPercent?: number;
}

interface Proveedor { id: number; nombre: string; }

/** Una presentacion de compra: como se captura y por cuanto multiplica. */
interface Presentacion { id: number | null; nombre: string; factor: number; }

class PurchaseItem {
  constructor(
    public productId: number,
    public productName: string,
    public qty: number,
    public unitPrice: number,
    public purchasePrice: number,
    public profitPercent: number = 0,
    /**
     * Presentacion en la que se compra esta linea. `null` = unidad base.
     * `sp_register_purchase` la convierte: 5 cajas de 1 L suben 5000 ml.
     */
    public presentationId: number | null = null,
    /** Presentaciones del producto, para el selector de la fila. */
    public presentaciones: Presentacion[] = [],
    /**
     * Las mismas, en el formato del selector. Es un campo y no un getter a
     * proposito: un getter devolveria un arreglo nuevo en cada ciclo de
     * deteccion y `wx-select` veria una entrada distinta cada vez.
     */
    public opciones: WxOpcion[] = [],
    /** Unidad base, para escribirla junto a la cantidad. */
    public baseUom: string = 'pza',
    /** Un ingrediente no se cobra en caja: no se le calcula precio de venta. */
    public sellable: boolean = true,
    /** Los del producto, para que el sugerido salga igual que en SQL. */
    public objetoImpuesto: string = '02',
    public tasaIva: number = 0.16,
  ) {}

  /** Cuantas unidades base trae una unidad de lo que se esta capturando. */
  get factor(): number {
    const p = this.presentaciones.find(x => x.id === this.presentationId);
    return p && p.factor > 0 ? p.factor : 1;
  }

  /** Lo que se le paga al proveedor por esta linea, sin IVA. */
  get subtotal() {
    const q = Number(this.qty) || 0;
    const p = Number(this.purchasePrice) || 0;
    return q * p;
  }

  /** Lo que entra al inventario, ya convertido a unidad base. */
  get cantidadBase() {
    return (Number(this.qty) || 0) * this.factor;
  }

  /**
   * Costo por unidad BASE, sin IVA. Es exactamente lo que
   * `sp_register_purchase` guarda en `products.cost`: el precio capturado
   * dividido entre el factor de la presentacion. Comprar una bolsa de 400 g a
   * $95 no cuesta $95 el gramo.
   */
  get costoBase() {
    const p = Number(this.purchasePrice) || 0;
    return this.factor > 0 ? p / this.factor : p;
  }

  /** IVA que aplica al producto: 0 si no es objeto de impuesto. */
  get ivaProducto() {
    return this.objetoImpuesto !== '02' ? 0 : (Number(this.tasaIva) || 0);
  }

  /** IVA de la linea, con la tasa del producto. */
  get ivaLinea() {
    return this.subtotal * this.ivaProducto;
  }

  /**
   * Nuevo precio de venta sugerido, POR UNIDAD BASE y con IVA incluido.
   * Misma formula que el procedimiento; si no cuadraran, la pantalla estaria
   * prometiendo un precio que la compra no va a escribir.
   */
  get suggestedPrice() {
    const g = Number(this.profitPercent) || 0;
    return this.costoBase * (1 + this.ivaProducto) * (1 + (g / 100));
  }
}

/** Como se paga la compra. El valor viaja tal cual a `sp_register_purchase`. */
const FORMAS_DE_PAGO: WxOpcion[] = [
  { valor: 'CREDITO',       etiqueta: 'A crédito',     nota: 'queda como cuenta por pagar' },
  { valor: 'EFECTIVO',      etiqueta: 'Efectivo',      nota: 'sale de la caja, entra al corte' },
  { valor: 'TRANSFERENCIA', etiqueta: 'Transferencia', nota: 'no toca la caja' },
  { valor: 'TARJETA',       etiqueta: 'Tarjeta',       nota: 'no toca la caja' },
];

@Component({
  selector: 'app-registrar-compra',
  standalone: true,
  templateUrl: './registrarCompra.html',
  styleUrls: ['./registrarCompra.css'],
  imports: [RouterOutlet, FormsModule, NgIf, NgFor, CurrencyPipe, DatePipe, SlicePipe, DecimalPipe, WxSelectComponent, ProveedorFormComponent, CompraDocumentoComponent],
  providers: [{ provide: LOCALE_ID, useValue: 'es-MX' }]
})
export class RegistrarCompra implements OnInit {
  folio: number | null = null;
  today = new Date();

  proveedores: Proveedor[] = [];
  proveedorSeleccionado: number | null = null;
  proveedorAbierto = false;
  altaProveedorAbierta = false;

  showModalProductos = false;
  productos: ProductRow[] = [];
  filtro = '';

  items: PurchaseItem[] = [];

  /** Ticket o factura subido: se lee, se revisa y llena la compra. */
  documentoAbierto = false;
  /**
   * Lo que se paso desde un documento. Al registrar la compra se liga el
   * documento a ella y se recuerda que renglon del proveedor es que producto.
   */
  private documentoPendiente: DocumentoAplicado | null = null;

  ivaTasa = 0.16;

  formasDePago = FORMAS_DE_PAGO;
  formaDePago: string = 'CREDITO';

  constructor(
    private authService: AuthService,
    private hosp: HospitalityService,
    private register: RegisterService,
    private shift: ShiftService,
    public caps: CapabilityService,
    private socios: SociosService,
  ) {
    this.cargarProveedores();
  }

  /* 0079 · Socios: quien pago la compra. Con dinero del negocio (cajon,
     banco), lo comprado es anticipo del dueno de cada producto; si la pago
     un socio de su bolsa, no. En efectivo salio del cajon: lo pago el negocio. */
  opcSocioPago: WxOpcion[] = [];
  socioPago: number | null = null;

  ngOnInit() {
    this.cargarFolio();
    this.cargarSocios();
  }

  private async cargarSocios() {
    if (!this.caps.socios) return;
    const r = await this.socios.config();
    if (!r.ok) return;
    this.opcSocioPago = [{ valor: null, etiqueta: 'El negocio', nota: 'es anticipo del dueño de cada producto' },
      ...r.data.socios.filter(s => s.activo).map(s => ({ valor: s.id, etiqueta: `${s.nombre}, de su bolsa` }))];
  }

  cargarFolio() {
    (window as any).electronAPI.getNextPurchaseFolio()
      .then((r: any) => { if (r?.success) this.folio = r.folio; })
      .catch((e: any) => console.error('Folio:', e));
  }

  get usuarioActualId() {
    return this.authService.usuarioActualId ?? 0;
  }

  // ---- Proveedor unico de la compra (dropdown div) ----
  get proveedorLabel(): string {
    const p = this.proveedores.find(x => x.id === this.proveedorSeleccionado);
    return p ? p.nombre : 'Selecciona proveedor';
  }

  seleccionarProveedor(id: number) {
    this.proveedorSeleccionado = id;
    this.proveedorAbierto = false;
  }

  /** Nota bajo el selector de pago, con las consecuencias en claro. */
  get notaFormaDePago(): string {
    switch (this.formaDePago) {
      case 'EFECTIVO':
        return 'Sale de la caja: hace falta un turno abierto y la salida aparecerá en el corte.';
      case 'TRANSFERENCIA':
      case 'TARJETA':
        return 'Queda pagada al proveedor, pero no mueve el efectivo del cajón: no entra al corte.';
      default:
        return 'La compra queda como cuenta por pagar del proveedor. No toca la caja.';
    }
  }

  // El "Precio compra" capturado es SIN IVA; el total al proveedor lleva IVA.
  get subtotalSinIva() {
    return this.items.reduce((a, it) => a + it.subtotal, 0);
  }

  /** IVA con la tasa de CADA producto: lo exento no paga. */
  get iva() {
    return this.items.reduce((a, it) => a + it.ivaLinea, 0);
  }

  get totalConIva() {
    return this.subtotalSinIva + this.iva;
  }

  get total() {
    return this.totalConIva;
  }

  get subtotal() {
    return this.subtotalSinIva;
  }

  /** Tasa media de la compra: lo que se guarda en la cabecera. */
  get tasaEfectiva() {
    return this.subtotalSinIva > 0 ? this.iva / this.subtotalSinIva : this.ivaTasa;
  }

  abrirAltaProveedor() {
    this.proveedorAbierto = false;
    this.altaProveedorAbierta = true;
  }

  /** El proveedor recien dado de alta queda elegido: para eso se creo. */
  async alAgregarProveedor(p: { id: number | null; nombre: string }) {
    this.altaProveedorAbierta = false;
    await this.cargarProveedores();
    const nuevo = p.id ?? this.proveedores.find(x => x.nombre === p.nombre)?.id ?? null;
    if (nuevo != null) this.seleccionarProveedor(Number(nuevo));
  }

  async cargarProveedores() {
    try {
      const rs = await (window as any).electronAPI.getSuppliers();
      this.proveedores = Array.isArray(rs) ? rs : [];
    } catch (e) {
      console.error(e);
      this.proveedores = [];
    }
  }

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
      const rows = Array.isArray(rs?.recordset) ? rs.recordset : (Array.isArray(rs) ? rs : []);

      // Aqui SI van todos, ingredientes incluidos: la leche se compra aunque
      // no se venda. El que filtra por `sellable` es el buscador de la venta.
      this.productos = rows.map((r: any) => ({
        id: r.id,
        part_number: r.part_number,
        product_name: r.product_name,
        price: r.price,
        cost: r.cost != null ? Number(r.cost) : undefined,
        bar_code: r.bar_code,
        stock: r.stock,
        category_name: r.category_name,
        brand_name: r.brand_name,

        base_uom: r.base_uom ?? 'pza',
        sellable: r.sellable != null ? !!r.sellable : true,
        objeto_impuesto: r.objeto_impuesto ?? '02',
        tasa_iva: r.tasa_iva != null ? Number(r.tasa_iva) : this.ivaTasa,

        purchasePrice: 0,
        profitPercent: 0
      }));
    } catch (e) {
      console.error(e);
      this.productos = [];
    }
  }
  seleccionarProducto(p: ProductRow) {
    const existing = this.items.find(it => it.productId === p.id);
    if (existing) {
      existing.qty += 1;
      this.showModalProductos = false;
      return;
    }

    const purchasePrice = Number(p.purchasePrice) || 0;
    const profit = Number(p.profitPercent) || 0;

    const item = new PurchaseItem(
      p.id,
      p.product_name,
      1,
      p.price ?? 0,
      purchasePrice,
      profit,
      null,
      [],
      [],
      p.base_uom || 'pza',
      p.sellable,
      p.objeto_impuesto || '02',
      p.tasa_iva,
    );
    this.items.push(item);
    this.cargarPresentaciones(item);

    this.showModalProductos = false;
  }

  /**
   * Trae las presentaciones del producto para el selector de la fila.
   *
   * LO QUE DECIDE ES EL PRODUCTO, NO EL GIRO DEL NEGOCIO
   * ----------------------------------------------------
   * Esto estuvo limitado a alimentos y bebidas con el razonamiento de que "en
   * Retail nadie compra cajas de 1 L". Era falso en cuanto se mira cualquier
   * mostrador: una refaccionaria compra aceite en cajas de 12 y de 24, lo vende
   * por pieza, y la conversion que necesita es la misma.
   *
   * No hace falta ninguna puerta: si el producto no tiene presentaciones
   * definidas, la lista se queda vacia y el selector no se dibuja. Quien no las
   * use no ve nada nuevo, y quien las defina las tiene en cualquier perfil.
   */
  private async cargarPresentaciones(item: PurchaseItem, conservar = false) {
    try {
      const lista = await this.hosp.presentations(item.productId);
      if (!lista.length) return;
      item.presentaciones = [
        { id: null, nombre: `Por ${item.baseUom}`, factor: 1 },
        ...lista.map((p: any) => ({
          id: Number(p.id),
          nombre: String(p.name),
          factor: Number(p.factor_to_base) || 1,
        })),
      ];
      item.opciones = item.presentaciones.map(p => ({
        valor: p.id,
        etiqueta: p.nombre,
        nota: p.id === null ? item.baseUom : `x${p.factor}`,
      }));
      const porDefecto = lista.find((p: any) => p.is_default);
      if (porDefecto && !conservar) item.presentationId = Number(porDefecto.id);
    } catch {
      // Sin presentaciones la linea se compra en unidad base, como siempre.
    }
  }

  /** Lo que subira el inventario con esta linea, ya convertido. */
  entraAlInventario(it: PurchaseItem): string {
    if (it.factor === 1) return '';
    return `${it.cantidadBase} ${it.baseUom}`;
  }

  onQtyChange(i: number) {
    const it = this.items[i];
    if (!it) return;
    if (!Number.isFinite(Number(it.qty)) || it.qty < 1) it.qty = 1;
  }

  onPurchasePriceChange(i: number) {
    const it = this.items[i];
    if (!it) return;
    if (!Number.isFinite(Number(it.purchasePrice)) || it.purchasePrice < 0) it.purchasePrice = 0;
  }

  onProfitChange(i: number) {
    const it = this.items[i];
    if (!it) return;
    if (!Number.isFinite(Number(it.profitPercent)) || it.profitPercent < 0) it.profitPercent = 0;
    if (it.profitPercent > 100) it.profitPercent = 100;
  }

  quitarItem(i: number) {
    this.items.splice(i, 1);
  }

  // Por objeto: un documento puede traer el mismo producto en dos presentaciones.
  trackByItem = (_: number, it: PurchaseItem) => it;

  // ---- Ticket o factura del proveedor ----
  async abrirDocumento() {
    if (!this.productos.length) await this.cargarProductosActivos();
    this.documentoAbierto = true;
  }

  async alCrearProveedorDesdeDocumento(p: { id: number | null; nombre: string }) {
    await this.cargarProveedores();
    const id = p.id ?? this.proveedores.find(x => x.nombre === p.nombre)?.id ?? null;
    if (id != null) this.seleccionarProveedor(Number(id));
  }

  /**
   * % de ganancia para un renglon que llega de un documento.
   *
   * `sp_register_purchase` SIEMPRE reescribe el precio de venta con
   * costo x IVA x (1 + ganancia). Con ganancia 0 el producto quedaria a
   * precio de costo. Se conserva el margen que el producto ya tenia sobre
   * su costo; sin costo conocido, el que deja el precio actual igual.
   */
  private margenDe(p: ProductRow, costoBase: number): number {
    const iva = (p.objeto_impuesto || '02') !== '02' ? 0 : (Number(p.tasa_iva) || 0);
    const precio = Number(p.price) || 0;
    const ref = Number(p.cost) > 0 ? Number(p.cost) : costoBase;
    if (!(precio > 0) || !(ref > 0)) return 0;
    const m = (precio / (ref * (1 + iva)) - 1) * 100;
    return Math.min(100, Math.max(0, Math.round(m * 100) / 100));
  }

  async alAplicarDocumento(d: DocumentoAplicado) {
    this.documentoAbierto = false;
    this.seleccionarProveedor(d.supplier_id);
    for (const l of d.lineas) {
      const p = this.productos.find(x => x.id === l.productId);
      if (!p) continue;
      /* El mismo producto en la misma presentacion: una sola linea. */
      const ya = this.items.find(it => it.productId === l.productId && it.presentationId === l.presentationId);
      if (ya) {
        const q = (Number(ya.qty) || 0) + l.cantidad;
        ya.purchasePrice = Math.round((((Number(ya.qty) || 0) * (Number(ya.purchasePrice) || 0) + l.cantidad * l.costo) / q) * 10000) / 10000;
        ya.qty = q;
        continue;
      }
      const item = new PurchaseItem(
        p.id, p.product_name, l.cantidad, p.price ?? 0, l.costo,
        this.margenDe(p, l.factor > 0 ? l.costo / l.factor : l.costo),
        l.presentationId, [], [], p.base_uom || 'pza', p.sellable, p.objeto_impuesto || '02', p.tasa_iva,
      );
      this.items.push(item);
      await this.cargarPresentaciones(item, true);
    }
    this.documentoPendiente = d;
    /* Un ticket o nota de repartidor se paga al recibir, del cajón: se
       propone «Efectivo» (sale de la caja y entra al corte) si hay turno
       abierto en esta caja; sin turno no hay de dónde sacarlo. Una factura
       CFDI suele ser a crédito: se deja como estaba. */
    if (d.tipo !== 'CFDI' && this.formaDePago === 'CREDITO') {
      const turno = await this.shift.refresh().catch(() => false);
      if (turno) this.formaDePago = 'EFECTIVO';
    }
  }

  /** Despues de registrar: liga el documento y recuerda los renglones. */
  private async aprenderDocumento(purchaseId: number | null) {
    const d = this.documentoPendiente;
    this.documentoPendiente = null;
    if (!d) return;
    try {
      await (window as any).electronAPI.comprasDocAprender({
        document_id: d.document_id,
        supplier_id: this.proveedorSeleccionado ?? d.supplier_id,
        purchase_id: purchaseId,
        lineas: d.lineas.map(l => ({
          texto: l.texto, codigo: l.codigo, product_id: l.productId,
          presentation_id: l.presentationId, factor: l.factor,
        })),
      });
    } catch (e) {
      // No impide la compra: solo no se recuerda para la proxima.
      console.error('compras-doc:aprender', e);
    }
  }

  /**
   * ¿Ya se registró? Antes de guardar se busca, del mismo día, una compra del
   * mismo proveedor por el mismo total, un pago a ese proveedor que ya salió
   * de la caja, una salida de efectivo por el mismo monto o el mismo archivo
   * ya ligado a otra compra. Decide la persona; aquí solo se le muestra.
   *
   * Devuelve null si no hay que registrar, o el pago ya hecho a aplicarle.
   */
  private async revisarDuplicados(): Promise<{ applyPaymentId: number | null } | null> {
    let r: any;
    try {
      r = await (window as any).electronAPI.comprasDocDuplicados({
        supplier_id: this.proveedorSeleccionado,
        total: this.total,
        document_id: this.documentoPendiente?.document_id ?? null,
      });
    } catch { return { applyPaymentId: null }; }
    if (!r?.success) return { applyPaymentId: null };   // no impide registrar
    const { compras = [], pagos = [], salidas = [], documento = null } = r.data || {};
    const prov = this.proveedorLabel;
    const dinero = (n: number) => '$' + (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const hora = (v: any) => fechaDeSql(v)?.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: zonaDeSql(v) }) ?? '';
    const quien = (u: string | null) => (u ? ` por <b>${u}</b>` : '');

    if (documento?.purchase_id) {
      const x = await Swal.fire({
        icon: 'warning', title: 'Este ticket ya se registró',
        html: `El mismo archivo ya está en la compra <b>#${documento.purchase_id}</b>.`,
        showCancelButton: true, confirmButtonText: 'Registrar de todos modos', cancelButtonText: 'No registrar',
        focusCancel: true,
      });
      if (!x.isConfirmed) return null;
    }
    if (compras.length) {
      const c = compras[0];
      const x = await Swal.fire({
        icon: 'warning', title: '¿La misma compra?',
        html: `Hoy ya se registró una compra de <b>${prov}</b> por <b>${dinero(c.total)}</b>: `
            + `folio <b>#${c.id}</b> a las ${hora(c.fecha)}${quien(c.usuario)}.<br>¿Es otra compra?`,
        showCancelButton: true, confirmButtonText: 'Es otra, registrarla', cancelButtonText: 'Es la misma, no registrar',
        focusCancel: true,
      });
      if (!x.isConfirmed) return null;
    }
    if (pagos.length) {
      const pg = pagos[0];
      const x = await Swal.fire({
        icon: 'question', title: 'Ese pago ya salió de la caja',
        html: `A las ${hora(pg.fecha)} se le pagó a <b>${prov}</b> <b>${dinero(pg.monto)}</b>`
            + `${pg.forma === 'EFECTIVO' ? ' en efectivo' : ''}${quien(pg.usuario)}.<br>`
            + `¿Es el pago de esta compra? Si lo es, se le aplica y el efectivo <b>no sale otra vez</b>.`,
        showDenyButton: true, showCancelButton: true,
        confirmButtonText: 'Sí, es este pago', denyButtonText: 'No, es otro pago', cancelButtonText: 'Cancelar',
      });
      if (x.isConfirmed) return { applyPaymentId: Number(pg.id) };
      if (!x.isDenied) return null;
    }
    if (salidas.length && this.formaDePago === 'EFECTIVO') {
      const sa = salidas[0];
      const x = await Swal.fire({
        icon: 'warning', title: '¿Ya se pagó con una salida de efectivo?',
        html: `A las ${hora(sa.fecha)} salió de la caja un <b>${(sa.tipo_nombre || 'movimiento').toLowerCase()}</b> por <b>${dinero(sa.monto)}</b>`
            + `${sa.nota ? ` («${sa.nota}»)` : ''}${quien(sa.usuario)}.<br>`
            + `Si fue para pagar esta compra, registrarla en efectivo la sacaría <b>dos veces</b> del corte: `
            + `cancela esa salida o registra la compra a crédito y abónala.`,
        showCancelButton: true, confirmButtonText: 'Es otra salida, registrar', cancelButtonText: 'Revisar primero',
        focusCancel: true,
      });
      if (!x.isConfirmed) return null;
    }
    return { applyPaymentId: null };
  }

  async registrarCompra() {
    if (this.items.length === 0) {
      Swal.fire({ icon: 'error', title: 'Oops...', text: 'No hay productos en la compra' });
      return;
    }

    // Validaciones
    if (!this.proveedorSeleccionado) {
      Swal.fire({ icon: 'error', title: 'Falta proveedor', text: 'Selecciona el proveedor de la compra.' });
      return;
    }
    if (this.items.some(it => (Number(it.purchasePrice) || 0) <= 0)) {
      Swal.fire({ icon: 'error', title: 'Oops...', text: 'Todos los productos deben tener un precio de compra mayor a 0' });
      return;
    }

    const revision = await this.revisarDuplicados();
    if (!revision) return;

    const payload = {
      user_id: this.usuarioActualId,
      supplier_id: this.proveedorSeleccionado,
      tax_rate: this.tasaEfectiva,
      tax_amount: this.iva,
      subtotal: this.subtotal,
      total: this.total,
      // Como se paga. A credito la compra no toca la caja; en efectivo el
      // procedimiento exige turno abierto y cuelga la salida de ese turno.
      payment_method: this.formaDePago,
      register_id: this.register.registerId,
      // Pago que ya salió de la caja antes de capturar la compra: se le aplica.
      apply_payment_id: revision.applyPaymentId,
      // 0079: la pagó un socio de su bolsa. No si salió del cajón (efectivo
      // o un pago previo de la caja): eso lo pagó el negocio.
      socio_pago_id: this.formaDePago === 'EFECTIVO' || revision.applyPaymentId ? null : this.socioPago,
      detalles: this.items.map(it => ({
        product_id: it.productId,
        quantity: it.qty,
        unit_price: it.purchasePrice,
        profit_percent: it.profitPercent ?? 0,
        // Sin presentacion viaja NULL y la compra se comporta como siempre.
        presentation_id: it.presentationId
      }))
    };

    (window as any).electronAPI.registerPurchase(payload)
      .then((res: any) => {
        if (res?.success) {
          const folio = res.folio ?? res.purchase_id ?? '';
          this.aprenderDocumento(Number(res.purchase_id) || null);
          const pagada = this.formaDePago !== 'CREDITO';
          Swal.fire({
            icon: 'success',
            title: 'Compra registrada',
            html: `Folio: <b>${folio}</b><br>`
                + (revision.applyPaymentId
                    ? 'Se le aplicó el pago que ya había salido de la caja.'
                    : pagada
                    ? `Pagada por ${this.etiquetaPago(this.formaDePago).toLowerCase()}.`
                    : 'Queda como cuenta por pagar del proveedor.')
          });
          if (res.socios && !res.socios.ok) {
            Swal.fire({ icon: 'warning', title: 'La compra quedó; quién la pagó no', text: res.socios.error });
          }
          this.items = [];
          this.formaDePago = 'CREDITO';
          this.socioPago = null;
          this.cargarFolio();
        } else {
          Swal.fire({ icon: 'error', title: 'Error al registrar compra', text: res?.message || res?.error || 'Ocurrió un error.' });
        }
      })
      .catch((err: any) => {
        console.error(err);
        Swal.fire({ icon: 'error', title: 'Error al registrar compra', text: 'Ocurrió un error inesperado.' });
      });
  }

  private etiquetaPago(valor: string): string {
    return this.formasDePago.find(f => f.valor === valor)?.etiqueta ?? valor;
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboardEvent(e: KeyboardEvent) {
    if (e.key === 'F8') {
      e.preventDefault();
      this.registrarCompra();
    }
  }
}
