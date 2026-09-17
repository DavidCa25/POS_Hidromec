import { Component, HostListener, OnDestroy, OnInit, effect, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgIf, NgFor, CurrencyPipe, DatePipe, SlicePipe, NgStyle } from '@angular/common';
import Swal from 'sweetalert2';
import { AuthService } from '../../services/auth.service';
import { SupervisorAuthService } from '../../services/supervisor.service';
import { ConceptoFactura, FacturaNueva } from '../../app/factura-nueva/factura-nueva.component';
import { WxSelectComponent, WxOpcion } from '../../app/wx-select/wx-select.component';
import { WxDateComponent } from '../../app/wx-date/wx-date.component';
import {
  Cart, CartLine, CartService, CatalogProduct, CatalogService, CartCustomer,
  LoyaltyAward, Payment, PaymentMethod, SaleDetailRow, SaleHeader, SaleService,
  ShiftService, SoldLine,
} from '../../core';
import { PremiosVenta } from '../../loyalty/premios-venta';
import { CuponVenta } from '../../loyalty/cupon-venta';
import { MenuCatalogService, ModifierGroup } from '../../core/menu-catalog.service';
import { SelectedOption } from '../../core/models';
import {
  ResumenOpcion, aSeleccionada, admiteCantidad, gruposAConfigurar, minimoDe,
  opcionesElegibles, resumenDeOpciones, seleccionAutomatica, topeDeGrupo,
} from '../../core/opciones';

/*
 * RETAIL POS — capa de presentacion.
 *
 * Esta pantalla ya no es duena del carrito ni registra ventas por su cuenta:
 *   - el carrito (lineas, cantidades, totales, cuentas en espera) vive en
 *     CartService;
 *   - la venta se registra UNICAMENTE con SaleService.checkout();
 *   - el catalogo se lee de CatalogService;
 *   - el turno y las salidas de efectivo pasan por ShiftService;
 *   - la pantalla de cliente se alimenta sola desde el carrito.
 * Lo que queda aqui es interaccion: modales, atajos, scanner, mensajes.
 */

interface CreditCustomer {
  id: number;
  customerName: string;
  phone?: string;
  email?: string;
  creditLimit: number;
  currentBalance: number;
  availableCredit: number;
}

interface RefundLine {
  productId: number;
  productName: string;
  maxQty: number;
  qty: number;
  unitPrice: number;
}

@Component({
  selector: 'app-venta',
  templateUrl: './venta.html',
  imports: [RouterOutlet, FormsModule, NgIf, NgFor, CurrencyPipe, DatePipe, SlicePipe, NgStyle, FacturaNueva, WxDateComponent, WxSelectComponent, PremiosVenta, CuponVenta],
  styleUrls: ['./venta.css']
})
export class Venta implements OnInit, OnDestroy {
  private readonly cart = inject(CartService);
  private readonly catalog = inject(CatalogService);
  private readonly shift = inject(ShiftService);
  private readonly sale = inject(SaleService);
  // Solo para leer los grupos de opciones de un producto. Retail no pinta el
  // menu Touch; lo necesita para saber que variante lleva una linea.
  private readonly menu = inject(MenuCatalogService);

  today = new Date();

  nextFolioSuggested = 1;
  folioInput: number | null = null;

  // =========================
  // Scanner/tecleo sin inputs
  // =========================
  private scanBuffer = '';
  private scanTimer: any = null;
  private lastKeyTs = 0;
  private isScannerLike = false;
  private offBarcode: (() => void) | null = null;

  private readonly SCAN_GAP_MS = 35;
  private readonly IDLE_CLEAR_MS = 600;
  private readonly MAX_BUFFER_LEN = 32;
  private readonly PART_MAX_LEN = 3;
  private readonly BARCODE_MIN_LEN = 6;

  printingTicket = false;

  autoPrintTicketOnSale = true;

  private lastAddedProductId: number | null = null;

  showModal = false;
  dineroRecibido: number | null = null;
  paymentMethod: PaymentMethod = 'EFECTIVO';

  dueDate: string | null = null;

  creditCustomers: CreditCustomer[] = [];
  loadingCreditCustomers = false;

  lastSalePaid: number = 0;
  lastSaleChange: number = 0;

  showModalProductos = false;
  filtro = '';

  // Salida de efectivo (F10)
  showCashOutModal = false;
  cashOutAmount: number | null = null;
  cashOutNote = '';
  cashOutIsSupplier = false;
  cashOutSupplierId: number | null = null;
  cashOutSuppliers: { id: number; nombre: string }[] = [];
  cashOutSupAbierto = false;

  // Post-venta (acciones: PDF / WhatsApp)
  showPostSaleModal = false;
  lastSaleId: number | null = null;
  lastSaleIsCredito = false;
  lastSaleTotal = 0;

  // =========================
  // Facturacion
  // =========================
  showFacturaModal = false;
  facturaConceptos: ConceptoFactura[] = [];
  facturaSaleId: number | null = null;

  lastClienteSeleccionado: CartCustomer | null = null;

  facturaReceptorRfc: string | null = null;
  facturaReceptorNombre: string | null = null;
  facturaReceptorRegimen: string | null = null;
  facturaReceptorUso: string | null = null;

  // =========================
  // Turno (Abrir / estado)
  // =========================
  showOpenShiftModal = false;
  openShiftRequired = false;
  openingShiftLoading = false;

  openingCash: number | null = null;
  openingNote = '';

  private shiftCheckInProgress = false;

  // =========================
  // Modo edición
  // =========================
  editingSaleId: number | null = null;
  editingHeader: SaleHeader | null = null;
  editingLoading = false;

  // Solo lectura por default, “Modificar” desbloquea
  editUnlocked = false;

  // =========================
  // Reembolso / Cambio
  // =========================
  showRefundModal = false;
  refundLines: RefundLine[] = [];
  refundKind: 'EFECTIVO' | 'CAMBIO' = 'EFECTIVO';
  refundNote = '';
  refundLoading = false;

  showModalClientes = false;
  clientesGenerales: CartCustomer[] = [];
  filtroClientes = '';

  constructor(private auth: AuthService, private router: Router, private supervisor: SupervisorAuthService) {
    // Acuse visual de que el total cambio (ver `totalPulso`).
    effect(() => {
      const total = this.cart.total();
      if (this.totalAnterior !== null && total !== this.totalAnterior) {
        clearTimeout(this.pulsoTimer);
        this.totalPulso = this.totalPulso === 1 ? 2 : 1;
        this.pulsoTimer = setTimeout(() => { this.totalPulso = 0; }, 220);
      }
      this.totalAnterior = total;
    });
  }

  async ngOnInit() {
    await this.refreshFolioFromDb();

    if (!this.auth.usuarioActualId) {
      Swal.fire({
        icon: 'info',
        title: 'Sesión requerida',
        text: 'Inicia sesión para continuar.',
        timer: 1500,
        showConfirmButton: false
      }).then(() => this.router.navigate(['/login']));
      return;
    }

    const api = (window as any).electronAPI;
    if (api?.onBarcodeScan) {
      const off = api.onBarcodeScan(async (_payload: any) => {
        const code = String(_payload?.code || '').trim();
        if (!code) return;

        if (this.isTypingInInput()) return;
        if (this.showModal || this.showModalProductos || this.showCashOutModal || this.showPostSaleModal || this.showOpenShiftModal) return;
        if (this.isEditing && !this.editUnlocked) return;

        await this.addByBarcode(code);
      });
      this.offBarcode = typeof off === 'function' ? off : null;
    }

    // Se relee de SQL al entrar, no se confia en lo que quedo en memoria: el
    // turno pudo cerrarse desde el Corte, desde otra ventana o desde otra caja
    // de la red. `ensureShiftOpen` corta en seco si el signal dice "abierto",
    // asi que sin este refresco un turno ya cerrado dejaba entrar a vender.
    await this.shift.refresh();
    await this.ensureShiftOpen('VENTA');
  }

  ngOnDestroy() {
    // Antes cada visita a Ventas apilaba un listener mas del scanner.
    try { this.offBarcode?.(); } catch { /* noop */ }
    this.offBarcode = null;
    clearTimeout(this.pulsoTimer);
    clearTimeout(this.exitoTimer);
    this.clearScanBuffer();
  }

  // =========================
  // Vistas sobre el Core (la plantilla sigue usando los mismos nombres)
  // =========================
  get items(): CartLine[] { return this.cart.lines(); }
  get totalVenta(): number { return this.cart.total(); }
  get saleTabs(): Cart[] { return this.cart.carts(); }
  get activeTabId(): number { return this.cart.activeCartId(); }
  get clienteSeleccionado(): CartCustomer | null { return this.cart.activeCart().customer; }
  /** Lo vendible, no todo el inventario: los ingredientes no se cobran. */
  get productos(): CatalogProduct[] { return this.catalog.vendibles(); }

  /** Cliente de credito elegido en el cobro. */
  get customerId(): number | null { return this.cart.activeCart().creditCustomerId; }
  set customerId(v: number | null) { this.cart.setCreditCustomer(v); }

  get shiftOpen(): boolean { return this.shift.isOpen; }
  get shiftId(): number | null { return this.shift.shift().id; }
  get shiftOpenedAt(): Date | null { return this.shift.shift().openedAt; }
  get shiftOpeningCash(): number { return this.shift.shift().openingCash; }

  private get currentUserId(): number {
    return this.auth.usuarioActualId as number;
  }

  get isEditing(): boolean {
    return this.editingSaleId != null;
  }

  /**
   * ¿La venta cargada se puede modificar?
   *
   * `sp_update_sale` recalcula el stock por PRODUCTO vendido, y eso solo es
   * correcto para lineas DIRECT sin modificadores: una receta consume
   * ingredientes, no el producto. El procedure lo rechaza, asi que la
   * pantalla no debe ofrecer un boton que siempre va a fallar. El camino
   * oficial para corregir esas ventas es Reembolso / Cambio, que repone lo
   * que la venta consumio de verdad.
   */
  ventaEditable = true;

  private evaluarEditable(details: SaleDetailRow[]): void {
    this.ventaEditable = !(details || []).some((d: any) =>
      d.inventory_mode === 'RECIPE' || !!d.modifiers);
  }

  get cambio(): number {
    if (this.dineroRecibido == null) return 0;
    const c = this.dineroRecibido - this.totalVenta;
    return c > 0 ? c : 0;
  }

  /**
   * Marca de "el total acaba de cambiar".
   *
   * La plantilla la usa para reproducir un cruce muy corto sobre la cifra:
   * es el acuse de recibo de que el producto entro a la venta. Alternar entre
   * dos valores reinicia la animacion aunque lleguen dos cambios seguidos.
   */
  totalPulso = 0;
  private pulsoTimer: any;
  private totalAnterior: number | null = null;

  private adjustLastAddedQty(delta: number) {
    const lines = this.items;
    if (!lines.length) return;

    const fallback = lines[lines.length - 1];
    const target = this.lastAddedProductId != null
      ? lines.find(it => it.productId === this.lastAddedProductId) ?? fallback
      : fallback;

    if (!target) return;
    this.cart.adjustQty(target, delta);
  }

  onQtyChange(i: number) {
    const it = this.items[i];
    if (!it) return;
    this.cart.setQty(it, it.qty);
  }

  onPriceChange(i: number) {
    const it = this.items[i];
    if (!it) return;
    this.cart.setPrice(it, it.unitPrice);
    // Detección (robo hormiga): registra el cambio de precio en la venta.
    this.supervisor.registrar('PRICE_CHANGE', { detail: (it.productName || 'Producto') + ' -> $' + Number(it.unitPrice).toFixed(2) });
  }

  quitarItem(i: number) {
    const removed = this.items[i];
    if (!removed) return;
    this.cart.removeLine(removed);

    if (removed.productId === this.lastAddedProductId) {
      const last = this.cart.lastLine();
      this.lastAddedProductId = last ? last.productId : null;
    }
  }

  // =========================
  // Turno helpers
  // =========================
  private async ensureShiftOpen(source: 'VENTA' | 'COBRO' | 'SALIDA'): Promise<boolean> {
    // Agregar al carrito se fia del estado en memoria: es el camino del
    // escaner y consultar en cada lectura seria una consulta por producto.
    // Cobrar y sacar efectivo NO se fian: ahi se mueve dinero, y el turno pudo
    // cerrarse desde el Corte o desde otra caja mientras esta pantalla seguia
    // abierta. La comprobacion cuesta una consulta por operacion.
    if (source === 'VENTA' && this.shift.isOpen) return true;
    if (this.shiftCheckInProgress) return false;

    this.shiftCheckInProgress = true;
    try {
      const ok = await this.shift.ensureOpen();
      if (ok) return true;

      this.abrirModalAbrirTurno(true);

      if (source === 'COBRO') this.showModal = false;
      if (source === 'SALIDA') this.showCashOutModal = false;

      return false;
    } finally {
      this.shiftCheckInProgress = false;
    }
  }

  abrirModalAbrirTurno(required: boolean) {
    if (this.shift.isOpen) return;
    this.openShiftRequired = required;
    this.openingCash = 0;
    this.openingNote = '';
    this.showOpenShiftModal = true;
  }

  cerrarModalAbrirTurno() {
    this.showOpenShiftModal = false;
    this.openShiftRequired = false;
  }

  async confirmarAbrirTurno() {
    const opening_cash = Number(this.openingCash ?? 0);
    if (opening_cash < 0) {
      await Swal.fire({ icon: 'warning', title: 'Monto inválido', text: 'El fondo inicial no puede ser negativo.' });
      return;
    }

    try {
      this.openingShiftLoading = true;
      const r = await this.shift.open(opening_cash, this.openingNote);
      if (!r.ok) {
        const sinApi = /API no disponible/.test(r.error || '');
        await Swal.fire({ icon: 'error', title: sinApi ? 'No disponible' : 'No se pudo abrir el turno', text: r.error });
        return;
      }

      this.showOpenShiftModal = false;
      this.openShiftRequired = false;

      await Swal.fire({ icon: 'success', title: 'Turno abierto', text: 'Listo, ya puedes registrar ventas y movimientos.' });
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error inesperado', text: e?.message || 'Ocurrió un error al abrir el turno.' });
    } finally {
      this.openingShiftLoading = false;
    }
  }

  salirDeVentas() {
    this.router.navigate(['/dashboard']);
  }

  // =========================
  // Cobro / métodos
  // =========================
  async abrirModalCobrar() {
    const ok = await this.ensureShiftOpen('COBRO');
    if (!ok) return;

    if (this.isEditing) {
      await Swal.fire({
        icon: 'info',
        title: 'Folio cargado',
        text: 'Esta pantalla es para reembolsos/cambios. Cierra el folio (X) para cobrar una venta nueva.'
      });
      return;
    }

    this.dineroRecibido = null;
    this.showModal = true;
  }

  cerrarModalCobrar() { this.showModal = false; }

  async onPaymentMethodChange(method: PaymentMethod) {
    this.paymentMethod = method;

    if (method === 'CREDITO') {
      this.dineroRecibido = null;
      await this.loadCreditCustomers();

      const cli = this.clienteSeleccionado;
      if (cli && this.creditCustomers.length > 0) {
        const match = this.creditCustomers.find(c => c.id === cli.id);
        if (match) this.customerId = match.id;
      }
    } else {
      this.customerId = null;
      this.dueDate = null;
    }
  }

  private async loadCreditCustomers() {
    const api = (window as any).electronAPI;
    if (!api || !api.getCreditCustomers) {
      await Swal.fire({ icon: 'error', title: 'No disponible', text: 'No se pudo cargar la lista de clientes con crédito.' });
      return;
    }

    try {
      this.loadingCreditCustomers = true;
      this.creditCustomers = [];

      const resp = await api.getCreditCustomers();

      if (!resp?.success) {
        await Swal.fire({ icon: 'error', title: 'Error al cargar clientes', text: resp?.error || 'No se pudieron obtener los clientes con crédito.' });
        return;
      }

      this.creditCustomers = (resp.data || []).map((r: any) => ({
        id: r.id,
        customerName: r.customerName,
        phone: r.phone,
        email: r.email,
        creditLimit: Number(r.credit_limit ?? 0),
        currentBalance: Number(r.current_balance ?? 0),
        availableCredit: Number(r.available_credit ?? 0),
      }));

      this.customerId = this.creditCustomers.length > 0 ? this.creditCustomers[0].id : null;
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error inesperado', text: e?.message || 'Ocurrió un error al cargar los clientes con crédito.' });
    } finally {
      this.loadingCreditCustomers = false;
    }
  }

  /**
   * Estados visibles del cobro: reposo -> procesando -> confirmado.
   * `cobrando` deshabilita el boton y evita el doble envio.
   */
  cobrando = false;
  cobroConfirmado = false;
  private exitoTimer: any;

  async confirmarCobro() {
    if (this.cobrando) return;
    this.cobrando = true;
    try {
      await this.confirmarCobroInterno();
      this.cobroConfirmado = true;
      clearTimeout(this.exitoTimer);
      this.exitoTimer = setTimeout(() => { this.cobroConfirmado = false; }, 900);
    } finally {
      this.cobrando = false;
    }
  }

  private async confirmarCobroInterno() {
    const ok = await this.ensureShiftOpen('COBRO');
    if (!ok) return;

    if (this.paymentMethod === 'TERMINAL_MP') {
      // Las validaciones basicas se hacen antes de mandar a la terminal.
      const err = this.sale.validate(this.cart.activeCart(), { method: 'TERMINAL_MP' });
      if (err) { this.showModal = false; await Swal.fire({ icon: 'error', title: 'Oops...', text: err }); return; }
      this.showModal = false;
      await this.cobrarConTerminalMP();
      return;
    }

    const isCredito = this.paymentMethod === 'CREDITO';
    const payment: Payment = {
      method: this.paymentMethod,
      received: isCredito ? null : this.dineroRecibido,
      creditCustomerId: isCredito ? this.customerId : null,
      dueDate: isCredito ? this.dueDate : null,
    };

    // Mismos mensajes que antes: el Core valida, la pantalla los muestra.
    const err = this.sale.validate(this.cart.activeCart(), payment);
    if (err) {
      this.showModal = false;
      const esCliente = /cliente/i.test(err);
      await Swal.fire({ icon: 'error', title: esCliente ? 'Cliente requerido' : 'Oops...', text: err });
      return;
    }

    const res = await this.sale.checkout(payment, {
      openDrawer: !isCredito,
      autoPrint: this.autoPrintTicketOnSale,
    });

    if (!res.ok) {
      this.showModal = false;
      await Swal.fire({ icon: 'error', title: 'Error al registrar venta', text: res.error || 'No se pudo registrar la venta.' });
      return;
    }

    this.afterSale(res.saleId ?? null, res, isCredito);
    this.showModal = false;
    this.showPostSaleModal = true;
    await this.avisarCuponFallido(res.cupon);

    await this.refreshFolioFromDb();
  }

  /**
   * Lo que la ultima venta gano, si Fidelizacion esta encendida.
   *
   * Vive aqui y no dentro del modal posventa porque tambien hay que
   * ensenarlo tras un cobro con terminal, que no pasa por ese modal.
   */
  premiosUltimaVenta: LoyaltyAward[] = [];

  cerrarPremios() { this.premiosUltimaVenta = []; }

  /**
   * El canje del cupon fallo: hay que decirlo, no tragarselo.
   *
   * Pasa cuando otra caja gasto el mismo cupon en el mismo momento. SQL
   * garantiza que solo una lo consuma, pero no puede deshacer que el cliente
   * ya se llevo el producto gratis. Quien cobra tiene que enterarse en el
   * acto, mientras el cliente sigue delante.
   */
  private async avisarCuponFallido(cupon?: { ok: boolean; mensaje: string } | null) {
    if (!cupon || cupon.ok) return;
    await Swal.fire({
      icon: 'warning',
      title: 'El cupón no se pudo canjear',
      html: `${cupon.mensaje}<br><br>La venta quedó registrada con el descuento aplicado. ` +
            'Revísalo con el cliente antes de que se vaya.',
    });
  }

  /** Estado posventa comun a efectivo/tarjeta/credito/terminal. */
  private afterSale(saleId: number | null, res: { total?: number; paid?: number; change?: number; lines?: SoldLine[]; customer?: CartCustomer | null; premios?: LoyaltyAward[] }, isCredito: boolean) {
    this.premiosUltimaVenta = res.premios ?? [];
    this.lastSaleId = saleId;
    this.lastSaleIsCredito = isCredito;
    this.lastSaleTotal = res.total ?? 0;
    if (!isCredito) {
      this.lastSalePaid = res.paid ?? this.lastSaleTotal;
      this.lastSaleChange = res.change ?? 0;
    }
    // Cliente en memoria para facturar despues de limpiar la vista.
    this.lastClienteSeleccionado = res.customer ?? null;
    this.prepararConceptosFactura(res.lines ?? [], saleId);

    this.dineroRecibido = null;
    this.customerId = null;
    this.dueDate = null;
  }

  private async refreshFolioFromDb() {
    this.nextFolioSuggested = await this.sale.nextFolio();
    // Si NO está editando, deja el input listo con el sugerido
    if (!this.isEditing) this.folioInput = this.nextFolioSuggested;
  }

  // ==================
  // FACTURACION
  // ==================
  private prepararConceptosFactura(items: Pick<SoldLine, 'productName' | 'qty' | 'unitPrice' | 'claveProdServ' | 'claveUnidad' | 'objetoImpuesto' | 'tasaIva'>[], saleId: number | null) {
    this.facturaSaleId = saleId;
    this.facturaConceptos = items.map(it => ({
      description: it.productName,
      quantity: it.qty,
      unitPrice: it.unitPrice,
      claveProdServ: it.claveProdServ ?? null,
      claveUnidad: it.claveUnidad ?? null,
      taxObject: it.objetoImpuesto ?? '02',
      taxRate: it.tasaIva != null ? it.tasaIva : 0.16
    }));
  }

  async facturarFolioCargado() {
    if (!this.editingSaleId || !this.items.length) {
      await Swal.fire({ icon: 'info', title: 'Carga una venta', text: 'Primero carga un folio con productos.' });
      return;
    }
    this.prepararConceptosFactura(this.items.map(l => ({
      productName: l.productName, qty: l.qty, unitPrice: l.effectiveUnitPrice,
      claveProdServ: l.claveProdServ, claveUnidad: l.claveUnidad, objetoImpuesto: l.objetoImpuesto, tasaIva: l.tasaIva,
    })), this.editingSaleId);
    this.showFacturaModal = true;
  }

  onFacturaCerrada() {
    this.showFacturaModal = false;
  }

  onFacturaTimbrada(_out: any) {
    // Aqui podrias marcar la venta como facturada si quieres
  }

  // ==================
  // PRODUCTOS
  // ==================
  async abrirModalProductos() {
    if (this.isEditing && !this.editUnlocked) {
      await Swal.fire({
        icon: 'info',
        title: 'Solo lectura',
        text: 'Esta venta está cargada. Para agregar/quitar productos debes entrar a “Modificar” (supervisor).'
      });
      return;
    }

    this.filtro = '';
    await this.cargarProductosActivos();
    this.showModalProductos = true;
  }

  cerrarModalProductos() { this.showModalProductos = false; }

  /** Relee el catalogo (stock fresco al abrir el buscador). */
  async cargarProductosActivos() {
    await this.catalog.load(true);
  }

  /**
   * Agrega un producto al carrito, resolviendo antes sus opciones.
   *
   * ANTES ERA UNA SOLA LÍNEA: `addProduct(src, 1)`, sin opciones nunca. Con un
   * producto RECIPE cuya receta depende del tamaño —Caramel Macchiato, Taro
   * Latte— eso significaba vender sin variante, y `sp_register_sale` rechazaba
   * la venta con *"no tiene receta configurada"*: falso, la receta estaba, lo
   * que faltaba era decir de qué tamaño.
   *
   * La regla de qué se resuelve solo y qué hay que preguntar vive en
   * `core/opciones.ts`, la misma que usa Touch. Aquí solo se aplica.
   */
  async seleccionarProducto(p: CatalogProduct) {
    const opciones = await this.resolverOpciones(p);
    if (opciones === null) return;        // hacía falta elegir y se canceló

    this.cart.addProduct(CatalogService.toLineSource(p), 1, opciones);
    this.lastAddedProductId = p.id;
    this.showModalProductos = false;
  }

  /**
   * Las opciones con las que entra la línea, o `null` si se cancela.
   *
   * Un producto sin grupos no consulta nada y entra igual de rápido que
   * siempre: esto solo se nota en los productos que de verdad tienen opciones.
   */
  private async resolverOpciones(p: CatalogProduct): Promise<SelectedOption[] | null> {
    let grupos: ModifierGroup[] = [];
    try {
      grupos = await this.menu.groupsOfProduct(p.id);
    } catch (e) {
      // Sin el catálogo de opciones no se puede decidir. Se deja constancia y
      // se sigue: una línea sin opciones es lo que hacía Retail hasta ahora, y
      // si al producto le hacía falta el tamaño, SQL lo dirá con claridad.
      console.error('[VENTA] No se pudieron leer las opciones del producto:', e);
      return [];
    }

    const elegidas = seleccionAutomatica(grupos);

    /* UNA sola hoja con TODOS los grupos, obligatorios y opcionales.
       Antes se encadenaba un modal de radio por cada grupo obligatorio y
       despues una lista con el resto. Con un producto de tres grupos eso eran
       tres pantallas seguidas, y quien cancelaba en la primera se quedaba sin
       ver las otras dos: por eso parecia que Retail "solo tenia el modal de
       tamano". Touch siempre lo enseno todo junto; ahora tambien Retail, y
       con la MISMA regla de que grupos se muestran. */
    const aConfigurar = gruposAConfigurar(grupos);
    if (aConfigurar.length) {
      const extra = await this.preguntarOpciones(p, aConfigurar);
      if (extra === null) return null;
      elegidas.push(...extra);
    }

    /* Con la seleccion completa se pregunta a SQL si ALCANZA. El catalogo dice
       si el producto se puede ofrecer; esto dice si esta combinacion se puede
       preparar. Es la diferencia entre "hay latte" y "hay leche de almendra". */
    const problema = await this.avisarSiNoAlcanza(p, elegidas);
    if (problema) return null;

    return elegidas;
  }

  /**
   * UNA hoja con todos los grupos del producto.
   *
   * Es el equivalente de Retail a la hoja de Touch, y usa exactamente la misma
   * regla para decidir que grupos salen (`gruposAConfigurar`), cuantas
   * unidades caben (`topeDeGrupo`) y cuanto suma (`precioDeOpciones`). Lo que
   * cambia es como se pinta, no lo que se decide: dos motores de reglas es
   * como se llega a que una caja acepte cuatro shots y la otra tres.
   *
   * Devuelve `null` si se cancela.
   */
  private async preguntarOpciones(
    p: CatalogProduct, grupos: ModifierGroup[],
  ): Promise<SelectedOption[] | null> {
    const esc = (t: string) => String(t ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const html = grupos.map(g => {
      const min = minimoDe(g);
      const tope = topeDeGrupo(g);
      const conCantidad = admiteCantidad(g);
      /* Radio cuando solo cabe una: asi el control DICE que es excluyente en
         vez de dejar marcar dos y quejarse despues. */
      const unico = tope <= 1;
      const marca = unico ? 'radio' : 'checkbox';

      const reglas = [
        min > 0 ? 'obligatorio' : null,
        tope > 1 ? `hasta ${tope}` : null,
      ].filter(Boolean).join(' · ');

      const filas = opcionesElegibles(g).map(o => {
        const extra = Number(o.price_delta || 0);
        const precio = extra ? `<span class="vo-precio">+$${extra.toFixed(2)}</span>` : '';
        const cant = conCantidad && !unico
          ? `<input type="number" class="vo-cant" min="1" max="${tope}" value="1"
                    data-cant="${o.id}" title="Cantidad">`
          : '';
        return `<label class="vo-fila">
                  <input type="${marca}" name="g${g.id}" data-opt="${o.id}" data-grupo="${g.id}">
                  <span class="vo-nombre">${esc(o.name)}</span>${precio}${cant}
                </label>`;
      }).join('');

      return `<div class="vo-grupo" data-g="${g.id}" data-min="${min}" data-max="${tope}">
                <div class="vo-titulo">
                  <span class="vo-titulo__n">${esc(g.name)}</span>
                  ${reglas ? `<span class="vo-regla">${reglas}</span>` : ''}
                </div>${filas}
              </div>`;
    }).join('');

    const r = await Swal.fire({
      title: p.product_name,
      html: `<div class="vo">${html}</div>`,
      width: 560,
      showCancelButton: true,
      confirmButtonText: 'Agregar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#2563eb',
      /* La validacion vive aqui y no despues de cerrar: cerrar la hoja y
         recibir un error obliga a reconstruir la seleccion entera. */
      preConfirm: () => {
        const sel: { grupo: number; opcion: number; cant: number }[] = [];
        const faltan: string[] = [];
        const pasados: string[] = [];

        document.querySelectorAll<HTMLElement>('.vo .vo-grupo').forEach(bloque => {
          const gid = Number(bloque.dataset['g']);
          const min = Number(bloque.dataset['min'] || 0);
          const max = Number(bloque.dataset['max'] || 1);
          const titulo = bloque.querySelector('.vo-titulo__n')?.textContent || '';
          let unidades = 0;
          let elegidas = 0;

          bloque.querySelectorAll<HTMLInputElement>('input[data-opt]').forEach(el => {
            if (!el.checked) return;
            const id = Number(el.dataset['opt']);
            const c = bloque.querySelector<HTMLInputElement>(`[data-cant="${id}"]`);
            const n = Math.max(1, Number(c?.value || 1));
            unidades += n;
            elegidas += 1;
            sel.push({ grupo: gid, opcion: id, cant: n });
          });

          if (elegidas < min) faltan.push(titulo);
          // El tope se cuenta en UNIDADES, igual que en Touch.
          if (unidades > max) pasados.push(`${titulo} (máximo ${max})`);
        });

        if (faltan.length) {
          Swal.showValidationMessage(`Falta elegir: ${faltan.join(', ')}`);
          return false;
        }
        if (pasados.length) {
          Swal.showValidationMessage(`Te pasaste en: ${pasados.join(', ')}`);
          return false;
        }
        return sel;
      },
    });

    if (!r.isConfirmed) return null;
    const elegidas: SelectedOption[] = [];
    for (const x of (r.value as { grupo: number; opcion: number; cant: number }[] | undefined) || []) {
      const g = grupos.find(y => y.id === x.grupo);
      const o = g ? opcionesElegibles(g).find(y => y.id === x.opcion) : null;
      // Sin cantidad donde no significa nada: no existe "dos tamanos".
      if (g && o) elegidas.push({ ...aSeleccionada(g, o), quantity: admiteCantidad(g) ? x.cant : 1 });
    }
    return elegidas;
  }

  /**
   * Pregunta a SQL si esta combinacion se puede preparar, y lo dice con el
   * nombre del ingrediente que falta.
   *
   * Un fallo de la consulta NO bloquea la venta: es informacion anticipada, y
   * la venta vuelve a validar existencias dentro de su transaccion. Lo que no
   * puede pasar es que el cajero lea "no hay receta" cuando lo que falta es
   * leche de almendra.
   */
  private async avisarSiNoAlcanza(p: CatalogProduct, opciones: SelectedOption[]): Promise<boolean> {
    const hosp = (window as any).wybix;
    if (typeof hosp?.catalog?.disponibilidad !== 'function') return false;
    try {
      const rs = await hosp.catalog.disponibilidad({
        productId: p.id,
        options: opciones.map(o => ({ optionId: o.optionId, quantity: o.quantity })),
      });
      const d = rs?.data;
      if (!rs?.success || !d) return false;
      if (Number(d.disponible) > 0) return false;

      await Swal.fire({
        icon: 'warning',
        title: 'No se puede preparar',
        text: d.motivo || `No hay existencias suficientes para ${p.product_name} con estas opciones.`,
      });
      return true;
    } catch (e) {
      console.error('[VENTA] No se pudo consultar la disponibilidad:', e);
      return false;
    }
  }

  /** El resumen de opciones de una linea, para el carrito. */
  resumenOpciones(l: CartLine): ResumenOpcion[] {
    return resumenDeOpciones(l.options);
  }

  // ==================
  // CAJÓN MANUAL & SALIDA EFECTIVO
  // ==================
  async abrirCajonManual() {
    try {
      const ok = await this.sale.openDrawer();
      if (!ok) {
        await Swal.fire({ icon: 'info', title: 'No disponible', text: 'La apertura del cajón no está disponible en este entorno.' });
      }
    } catch {
      await Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo abrir el cajón. Revisa la configuración.' });
    }
  }

  async abrirSalidaEfectivo() {
    const ok = await this.ensureShiftOpen('SALIDA');
    if (!ok) return;

    this.cashOutAmount = null;
    this.cashOutNote = '';
    this.cashOutIsSupplier = false;
    this.cashOutSupplierId = null;
    this.cashOutSupAbierto = false;
    await this.cargarProveedoresCashOut();
    this.showCashOutModal = true;
  }

  cerrarSalidaEfectivo() { this.showCashOutModal = false; }

  private async cargarProveedoresCashOut() {
    try {
      const api = (window as any).electronAPI;
      const rs = await api?.getSuppliers?.();
      const rows = Array.isArray(rs?.recordset) ? rs.recordset : (Array.isArray(rs) ? rs : []);
      this.cashOutSuppliers = rows.map((x: any) => ({ id: Number(x.id), nombre: x.nombre ?? x.name ?? '' }));
    } catch { this.cashOutSuppliers = []; }
  }
  get cashOutSupplierLabel(): string {
    const s = this.cashOutSuppliers.find(x => x.id === this.cashOutSupplierId);
    return s ? s.nombre : 'Selecciona proveedor';
  }
  seleccionarCashOutProveedor(s: { id: number; nombre: string }) {
    this.cashOutSupplierId = s.id;
    this.cashOutSupAbierto = false;
  }

  async confirmarSalidaEfectivo() {
    const ok = await this.ensureShiftOpen('SALIDA');
    if (!ok) return;

    const amount = Number(this.cashOutAmount ?? 0);

    if (amount <= 0) {
      await Swal.fire({ icon: 'error', title: 'Monto inválido', text: 'El monto a retirar debe ser mayor a cero.' });
      return;
    }

    if (!this.cashOutNote.trim()) {
      await Swal.fire({ icon: 'warning', title: 'Nota requerida', text: 'Describe brevemente para qué es la salida de efectivo.' });
      return;
    }

    if (this.cashOutIsSupplier && !this.cashOutSupplierId) {
      await Swal.fire({ icon: 'warning', title: 'Elige proveedor', text: 'Selecciona el proveedor al que le pagas.' });
      return;
    }

    try {
      const resp = await this.shift.registerCashOut(amount, this.cashOutNote);

      if (resp?.success) {
        // Si la salida es pago a proveedor, registrarlo tambien
        if (this.cashOutIsSupplier && this.cashOutSupplierId) {
          try {
            await this.shift.paySupplier({
              supplier_id: this.cashOutSupplierId,
              amount,
              note: this.cashOutNote,
              cash_movement_id: resp?.cash_movement_id ?? resp?.id ?? null
            });
          } catch { /* el movimiento de caja ya quedo; el pago es complementario */ }
        }
        this.showCashOutModal = false;
        this.cashOutAmount = null;
        this.cashOutNote = '';
        this.cashOutIsSupplier = false;
        this.cashOutSupplierId = null;
        await Swal.fire({ icon: 'success', title: 'Salida registrada', text: 'La salida de efectivo se registró correctamente.' });
      } else {
        const sinApi = /API no disponible/.test(resp?.error || '');
        await Swal.fire({ icon: 'error', title: sinApi ? 'No disponible' : 'Error al registrar salida', text: resp?.error || 'No se pudo registrar la salida.' });
      }
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error inesperado', text: e?.message || 'Ocurrió un error al registrar la salida.' });
    }
  }

  // ==================
  // POST-VENTA
  // ==================
  cerrarPostSaleModal() { this.showPostSaleModal = false; }

  async generarPdfUltimaVenta() {
    if (!this.lastSaleId) return;

    const api = (window as any).electronAPI;
    if (!api || !api.generateSalePdf) {
      await Swal.fire({ icon: 'info', title: 'No disponible', text: 'La generación de PDF no está configurada en este entorno.' });
      return;
    }

    try {
      const resp = await this.sale.generatePdf({ saleId: this.lastSaleId, pagado: this.lastSalePaid, cambio: this.lastSaleChange });

      if (!resp?.success) {
        await Swal.fire({ icon: 'error', title: 'Error al generar PDF', text: resp?.error || 'No se pudo generar el PDF.' });
        return;
      }

      await Swal.fire({ icon: 'success', title: 'PDF generado', text: 'El PDF de la venta se generó correctamente.' });
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error inesperado', text: e?.message || 'Ocurrió un error al generar el PDF.' });
    }
  }

  async enviarTicketWhatsApp() {
    if (!this.lastSaleId) return;

    const api = (window as any).electronAPI;
    if (!api || !api.sendSaleTicketWhatsApp) {
      await Swal.fire({ icon: 'info', title: 'No disponible', text: 'El envío por WhatsApp no está configurado en este entorno.' });
      return;
    }

    try {
      const resp = await this.sale.sendTicketWhatsApp(this.lastSaleId);
      if (!resp?.success) {
        await Swal.fire({ icon: 'error', title: 'Error al enviar ticket', text: resp?.error || 'No se pudo enviar el ticket.' });
        return;
      }

      await Swal.fire({ icon: 'success', title: 'Ticket enviado', text: 'Se envió el ticket por WhatsApp correctamente.' });
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error inesperado', text: e?.message || 'Ocurrió un error al enviar el ticket.' });
    }
  }

  private async printTicketBySaleId(saleId: number, opts?: {
    pagado?: number | null;
    cambio?: number | null;
    silent?: boolean;
    printerName?: string | null;
    paymentMethod?: string | null;
  }) {
    this.printingTicket = true;
    try {
      const resp = await this.sale.printTicket(saleId, {
        pagado: opts?.pagado ?? null,
        cambio: opts?.cambio ?? null,
        silent: opts?.silent ?? true,
        printerName: opts?.printerName ?? undefined,
        paymentMethod: opts?.paymentMethod ?? undefined,
      });

      if (!resp?.success) {
        const sinApi = /preload/.test(resp?.error || '');
        await Swal.fire({
          icon: sinApi ? 'info' : 'error',
          title: sinApi ? 'No disponible' : 'No se pudo imprimir',
          text: resp?.error || 'Error al imprimir el ticket.'
        });
        return;
      }

      if ((opts?.silent ?? true) === false) {
        await Swal.fire({ icon: 'success', title: 'Impresión enviada', timer: 900, showConfirmButton: false });
      }
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error inesperado', text: e?.message || 'Error al imprimir.' });
    } finally {
      this.printingTicket = false;
    }
  }

  async imprimirTicketUltimaVenta(silent: boolean = true) {
    if (!this.lastSaleId) return;

    const pagado = this.lastSaleIsCredito ? null : (this.lastSalePaid ?? null);
    const cambio = this.lastSaleIsCredito ? null : (this.lastSaleChange ?? null);

    await this.printTicketBySaleId(this.lastSaleId, {
      pagado,
      cambio,
      silent,
      paymentMethod: this.lastSaleIsCredito ? 'CREDITO' : this.paymentMethod
    });
  }

  async imprimirTicketFolioCargado(silent: boolean = true) {
    if (!this.editingSaleId || !this.editingHeader) {
      await Swal.fire({ icon: 'info', title: 'Carga un folio', text: 'Primero carga un folio para imprimir.' });
      return;
    }

    const total = Number(this.editingHeader.total ?? 0);
    const paid = Number(this.editingHeader.paid_amount ?? total);
    const pagado = Number.isFinite(paid) ? paid : null;

    const cambio = (this.editingHeader.payment_method === 'CREDITO')
      ? null
      : (pagado != null ? Math.max(0, pagado - total) : null);

    await this.printTicketBySaleId(Number(this.editingSaleId), {
      pagado,
      cambio,
      silent,
      paymentMethod: this.editingHeader.payment_method ?? null
    });
  }

  // ==================
  // ATAJOS + TECLEO/SCANNER
  // ==================
  @HostListener('window:keydown', ['$event'])
  async handleKeyboardEvent(event: KeyboardEvent) {

    if (this.isTypingInInput()) return;

    if (this.isEditing && !this.editUnlocked) {
      return;
    }

    if (this.showModal || this.showModalProductos || this.showCashOutModal || this.showPostSaleModal || this.showOpenShiftModal || this.showFacturaModal) {
      return;
    }

    // ===== Atajos =====
    switch (event.key) {
      case 'F1':
        event.preventDefault();
        this.abrirCajonManual();
        return;

      case 'F7':
        event.preventDefault();
        if (!this.showModalProductos) this.abrirModalProductos();
        return;

      case 'F8':
        event.preventDefault();
        if (!this.showModal) await this.abrirModalCobrar();
        return;

      case 'F10':
        event.preventDefault();
        if (!this.showCashOutModal) await this.abrirSalidaEfectivo();
        return;

      case '+':
        event.preventDefault();
        this.adjustLastAddedQty(+1);
        return;

      case '-':
        event.preventDefault();
        this.adjustLastAddedQty(-1);
        return;
    }

    if (event.key === 'Enter') {
      if (this.scanBuffer.length) {
        event.preventDefault();
        await this.commitScanBuffer();
      }
      return;
    }

    if (event.key === 'Backspace') {
      if (this.scanBuffer.length) {
        this.scanBuffer = this.scanBuffer.slice(0, -1);
        event.preventDefault();
      }
      return;
    }

    if (/^[a-zA-Z0-9]$/.test(event.key)) {
      this.pushChar(event.key);
      return;
    }
  }

  // ==================
  // EDICIÓN / CARGA FOLIO
  // ==================
  public resetToNewSaleMode() {
    this.editingSaleId = null;
    this.editingHeader = null;
    this.editUnlocked = false;

    // Cierra la venta cargada: vuelve la cuenta en espera que estaba activa.
    this.cart.closeTransient();

    this.folioInput = this.nextFolioSuggested;
  }

  async buscarFolioPorInput() {
    const saleId = Number(this.folioInput ?? 0);

    if (!Number.isFinite(saleId) || saleId <= 0) {
      await Swal.fire({ icon: 'warning', title: 'Folio inválido', text: 'Ingresa un folio válido.' });
      return;
    }

    const api = (window as any).electronAPI;
    if (!api?.getSaleByFolio) {
      await Swal.fire({ icon: 'error', title: 'No disponible', text: 'Falta electronAPI.getSaleByFolio' });
      return;
    }

    this.editingLoading = true;
    try {
      const resp = await this.sale.getSaleByFolio(saleId);

      if (!resp?.success) {
        await Swal.fire({ icon: 'error', title: 'No se encontró', text: resp?.error || 'No se encontró la venta.' });
        return;
      }

      const header: SaleHeader | null = resp.data?.header ?? resp.data?.[0] ?? null;
      const details: SaleDetailRow[] = resp.data?.details ?? resp.data?.rows ?? resp.data?.detail ?? [];

      if (!header || !header.sale_id) {
        await Swal.fire({ icon: 'info', title: 'Sin datos', text: 'No se encontró la venta o no regresó header.' });
        return;
      }

      this.editingSaleId = Number(header.sale_id);
      this.editingHeader = {
        ...header,
        datee: header.datee ? new Date(header.datee) : header.datee,
        total: Number(header.total ?? 0),
        refund_total: Number(header.refund_total ?? 0),
      };
      this.editUnlocked = false;
      this.evaluarEditable(details);

      const lines = (details || []).map((d: any) => {
        const name = d.product_name ?? d.productName ?? d.nombre ?? d.nombre_producto ?? d.name ?? '';
        return this.cart.makeLine({
          productId: Number(d.product_id),
          productName: String(name || `Producto #${d.product_id}`),
          unitPrice: Number(d.unitary_price ?? 0),
          claveProdServ: d.clave_prod_serv ?? null,
          claveUnidad: d.clave_unidad ?? null,
          objetoImpuesto: d.objeto_impuesto ?? null,
          tasaIva: d.tasa_iva != null ? Number(d.tasa_iva) : null,
        }, Number(d.quantity ?? 1));
      });

      // La cuenta en espera activa queda intacta: la venta cargada vive en un
      // carrito transitorio aparte.
      this.cart.openTransient(lines, { saleId: this.editingSaleId });

      await Swal.fire({
        icon: 'success',
        title: `Folio #${this.editingSaleId}`,
        text: 'Venta cargada (solo lectura).',
        timer: 1000,
        showConfirmButton: false
      });

    } catch (e: any) {
      console.error('❌ buscarFolioPorInput:', e);
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'Error al cargar la venta.' });
    } finally {
      this.editingLoading = false;
    }
  }

  async habilitarEdicion() {
    const confirm = await Swal.fire({
      icon: 'question',
      title: 'Modificar venta',
      text: 'Esto es modo supervisor. ¿Deseas continuar?',
      showCancelButton: true,
      confirmButtonText: 'Sí, modificar',
      cancelButtonText: 'Cancelar'
    });

    if (!confirm.isConfirmed) return;

    this.editUnlocked = true;
  }

  async cancelarEdicion() {
    this.editUnlocked = false;

    if (this.editingSaleId) {
      this.folioInput = this.editingSaleId;
      await this.buscarFolioPorInput();
    }
  }

  async guardarCambiosVenta() {
    if (!this.editingSaleId) {
      await Swal.fire({ icon: 'info', title: 'No estás editando', text: 'Primero carga un folio.' });
      return;
    }

    if (!this.editUnlocked) {
      await Swal.fire({
        icon: 'info',
        title: 'Edición bloqueada',
        text: 'Presiona “Modificar” (supervisor) para habilitar cambios.'
      });
      return;
    }

    const ok = await this.ensureShiftOpen('VENTA');
    if (!ok) return;

    if (this.items.length === 0) {
      await Swal.fire({ icon: 'warning', title: 'Sin partidas', text: 'La venta no puede quedar vacía.' });
      return;
    }

    const api = (window as any).electronAPI;
    if (!api?.updateSale) {
      await Swal.fire({ icon: 'error', title: 'No disponible', text: 'Falta electronAPI.updateSale' });
      return;
    }

    const confirm = await Swal.fire({
      icon: 'question',
      title: `Guardar cambios (Folio #${this.editingSaleId})`,
      text: 'Se actualizará inventario y (si aplica) caja con el ajuste.',
      showCancelButton: true,
      confirmButtonText: 'Sí, guardar',
      cancelButtonText: 'Cancelar'
    });

    if (!confirm.isConfirmed) return;

    try {
      const payload = {
        sale_id: this.editingSaleId,
        user_id: this.currentUserId,
        items: this.items.map(it => ({
          productId: it.productId,
          qty: it.qty,
          unitPrice: it.effectiveUnitPrice
        })),
        note: 'Edición de venta desde POS'
      };

      const resp = await this.sale.updateSale(payload);

      if (!resp?.success) {
        await Swal.fire({ icon: 'error', title: 'No se pudo actualizar', text: resp?.error || 'Error al actualizar.' });
        return;
      }

      await Swal.fire({ icon: 'success', title: 'Actualizada', text: 'La venta se actualizó correctamente.' });

      this.editUnlocked = false;
      this.folioInput = this.editingSaleId;
      await this.buscarFolioPorInput();

    } catch (e: any) {
      console.error('❌ guardarCambiosVenta:', e);
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'Error al actualizar.' });
    }
  }

  // ==================
  // REEMBOLSO / CAMBIO
  // ==================
  async abrirReembolso() {
    if (!this.editingSaleId || !this.editingHeader) {
      await Swal.fire({ icon: 'info', title: 'Carga una venta', text: 'Primero escribe un folio y presiona Enter.' });
      return;
    }

    const ok = await this.ensureShiftOpen('VENTA');
    if (!ok) return;

    const api = (window as any).electronAPI;
    if (!api?.getSaleByFolio) {
      await Swal.fire({ icon: 'error', title: 'No disponible', text: 'Falta electronAPI.getSaleByFolio' });
      return;
    }

    try {
      const resp = await this.sale.getSaleByFolio(this.editingSaleId);
      if (!resp?.success) {
        await Swal.fire({ icon: 'error', title: 'Error', text: resp?.error || 'No se pudo cargar la venta.' });
        return;
      }

      const details: SaleDetailRow[] = resp.data?.details ?? resp.data?.detail ?? [];

      this.refundLines = (details || [])
        .filter(d => Number(d.remaining_qty ?? 0) > 0)
        .map(d => {
          const name = (d as any).product_name ?? (d as any).productName ?? (d as any).name ?? '';
          return {
            productId: Number(d.product_id),
            productName: String(name || `Producto #${d.product_id}`),
            maxQty: Number(d.remaining_qty ?? 0),
            qty: 0,
            unitPrice: Number(d.unitary_price ?? 0),
          };
        });

      this.refundKind = 'EFECTIVO';
      this.refundNote = '';
      this.showRefundModal = true;

    } catch (e: any) {
      console.error('❌ abrirReembolso:', e);
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'Error al preparar el reembolso.' });
    }
  }

  cerrarReembolso() {
    this.showRefundModal = false;
    this.refundLines = [];
    this.refundNote = '';
    this.refundLoading = false;
  }

  get refundTotalPreview(): number {
    const total = (this.refundLines || [])
      .filter(l => Number(l.qty) > 0)
      .reduce((acc, l) => acc + (Number(l.qty) * Number(l.unitPrice)), 0);
    return Number(total.toFixed(2));
  }

  incQty(l: RefundLine) {
    const max = Number(l?.maxQty ?? Infinity);
    const qty = Number(l?.qty ?? 0);
    l.qty = Math.min(max, qty + 1);
  }

  decQty(l: RefundLine) {
    const qty = Number(l?.qty ?? 0);
    l.qty = Math.max(0, qty - 1);
  }

  async confirmarReembolso() {
    if (!this.editingSaleId) return;

    const api = (window as any).electronAPI;
    if (!api?.refundSale) {
      await Swal.fire({ icon: 'error', title: 'No disponible', text: 'Falta electronAPI.refundSale' });
      return;
    }

    for (const l of this.refundLines) {
      l.qty = Number(l.qty ?? 0);
      if (l.qty < 0) l.qty = 0;
      if (l.qty > l.maxQty) l.qty = l.maxQty;
    }

    const selected = this.refundLines.filter(l => l.qty > 0);
    if (selected.length === 0) {
      await Swal.fire({ icon: 'warning', title: 'Nada que devolver', text: 'Selecciona al menos un producto.' });
      return;
    }

    const totalPreview = this.refundTotalPreview;

    this.showRefundModal = false;

    const confirm = await Swal.fire({
      icon: 'question',
      title: this.refundKind === 'EFECTIVO' ? 'Confirmar reembolso en efectivo' : 'Confirmar cambio',
      html: `<div style="text-align:left">Total: <b>$${totalPreview.toFixed(2)}</b></div>`,
      showCancelButton: true,
      confirmButtonText: 'Sí, confirmar',
      cancelButtonText: 'Cancelar'
    });

    if (!confirm.isConfirmed) return;

    // Candado anti robo hormiga: devoluciones/cambios requieren supervisor.
    const autorizado = await this.supervisor.autorizarYregistrar(
      'Las devoluciones y cambios requieren autorización de un supervisor.',
      'REFUND',
      { amount: totalPreview, saleId: this.editingSaleId,
        detail: (this.refundKind === 'EFECTIVO' ? 'Reembolso efectivo' : 'Cambio') + ' folio #' + this.editingSaleId });
    if (!autorizado) return;

    this.refundLoading = true;
    try {
      const payload = {
        sale_id: this.editingSaleId,
        user_id: this.currentUserId,

        payment_method: 'EFECTIVO',

        refund_kind: this.refundKind,
        register_cash_movement: this.refundKind === 'EFECTIVO' ? 1 : 0,

        items: selected.map(x => ({
          productId: x.productId,
          qty: x.qty,
          unitPrice: x.unitPrice
        })),

        note: (this.refundNote || '').trim() || null,

        apply_net_update: 1
      };

      const resp = await this.sale.refundSale(payload);

      if (!resp?.success) {
        await Swal.fire({ icon: 'error', title: 'No se pudo procesar', text: resp?.error || 'Error en reembolso/cambio.' });
        return;
      }

      await Swal.fire({ icon: 'success', title: 'Listo', text: 'Se registró correctamente.' });

      this.showRefundModal = false;

      this.folioInput = this.editingSaleId;
      await this.buscarFolioPorInput();

    } catch (e: any) {
      console.error('❌ confirmarReembolso:', e);
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'Error al registrar.' });
    } finally {
      this.refundLoading = false;
    }
  }

  // ==================
  // Helpers scanner/tecleo
  // ==================
  private isTypingInInput(): boolean {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return false;
    return ['INPUT','TEXTAREA','SELECT'].includes(el.tagName) || el.isContentEditable;
  }

  private clearScanBuffer() {
    this.scanBuffer = '';
    this.lastKeyTs = 0;
    if (this.scanTimer) clearTimeout(this.scanTimer);
    this.scanTimer = null;
  }

  private pushChar(ch: string) {
    const now = Date.now();

    if (this.lastKeyTs) {
      const gap = now - this.lastKeyTs;
      if (gap <= this.SCAN_GAP_MS) this.isScannerLike = true;
    }
    this.lastKeyTs = now;

    if (this.scanBuffer.length >= this.MAX_BUFFER_LEN) return;

    this.scanBuffer += ch;

    if (this.scanTimer) clearTimeout(this.scanTimer);
    this.scanTimer = setTimeout(() => this.clearScanBuffer(), this.IDLE_CLEAR_MS);
  }

  private async commitScanBuffer() {
    const code = (this.scanBuffer || '').trim();
    const scannerLike = this.isScannerLike;

    this.clearScanBuffer();
    if (!code) return;

    if (scannerLike || code.length >= this.BARCODE_MIN_LEN) {
      await this.addByBarcode(code);
    } else {
      await this.addByPartNumber(code);
    }
  }

  private async addByPartNumber(code: string) {
    const key = (code || '').trim().toLowerCase();
    if (!key) return;

    if (key.length > this.PART_MAX_LEN) {
      await Swal.fire({ icon:'warning', title:'No. Parte inválido', text:`Máximo ${this.PART_MAX_LEN} dígitos.`, timer: 1200, showConfirmButton:false });
      return;
    }

    await this.catalog.load();

    const p = this.catalog.findByPartNumber(key);
    if (!p) {
      await Swal.fire({ icon:'warning', title:'No encontrado', text:`No existe No. Parte: ${code}`, timer: 1000, showConfirmButton:false });
      return;
    }

    this.seleccionarProducto(p);
  }

  private async addByBarcode(code: string) {
    const key = (code || '').trim().toLowerCase();
    if (!key) return;

    await this.catalog.load();

    const p = this.catalog.findByBarcode(key);

    if (!p) {
      await Swal.fire({
        icon: 'warning',
        title: 'No encontrado',
        text: `No existe código de barras: ${code}`,
        timer: 1000,
        showConfirmButton: false
      });
      return;
    }

    this.seleccionarProducto(p);
  }

  private sleep(ms: number) {
    return new Promise(res => setTimeout(res, ms));
  }

  // ==================
  // TERMINAL MERCADO PAGO
  // ==================
  async cobrarConTerminalMP() {
    const api = (window as any).electronAPI;
    if (!api?.mpCreateOrder || !api?.mpGetOrder) {
      await Swal.fire({ icon: 'error', title: 'No disponible', text: 'Falta la integración de Mercado Pago en preload.' });
      return;
    }

    if (!(this.totalVenta > 0)) {
      await Swal.fire({ icon: 'error', title: 'Total inválido', text: 'El total debe ser mayor a cero.' });
      return;
    }

    let orderId: string | null = null;
    try {
      const createResp = await api.mpCreateOrder({
        amount: this.totalVenta,
        externalReference: `POS-${Date.now()}-${Math.floor(Math.random() * 100000)}`
      });

      if (!createResp?.success || !createResp.orderId) {
        await Swal.fire({ icon: 'error', title: 'No se pudo iniciar el cobro', text: createResp?.error || 'Error al crear la orden en la terminal.' });
        return;
      }
      orderId = createResp.orderId;
      console.log('MP orderId =>', orderId);
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'Error al crear la orden.' });
      return;
    }

    if (!orderId) return;
    let canceledByUser = false;
    Swal.fire({
      title: 'Esperando pago en terminal',
      html: 'Pide al cliente que acerque o inserte la tarjeta en la terminal.',
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      showCancelButton: true,
      cancelButtonText: 'Cancelar',
      didOpen: () => Swal.showLoading()
    }).then(res => {
      if (res.dismiss === Swal.DismissReason.cancel) canceledByUser = true;
    });

    try {
      const cfgRs = await api.mpGetConfig?.();
      if (cfgRs?.data?.testMode && api.mpSimulateOrder) {
        setTimeout(() => {
          api.mpSimulateOrder(orderId, 'processed').catch(() => { /* noop */ });
        }, 2500);
      }
    } catch { /* noop */ }

    const intervalMs = 2500;
    const maxMs = 180000;
    const startedAt = Date.now();

    let finalState: 'approved' | 'failed' | 'canceled' | 'verify' | 'timeout' = 'timeout';

    while (Date.now() - startedAt < maxMs) {
      if (canceledByUser) {
        Swal.close();
        const cancelResp = await api.mpCancelOrder(orderId).catch(() => null);
        finalState = cancelResp?.success ? 'canceled' : 'verify';
        break;
      }

      await this.sleep(intervalMs);

      let statusResp: any;
      try {
        statusResp = await api.mpGetOrder(orderId);
      } catch {
        continue;
      }
      if (!statusResp?.success) continue;

      if (statusResp.state === 'approved') { finalState = 'approved'; break; }
      if (statusResp.state === 'failed') { finalState = 'failed'; break; }
      if (statusResp.state === 'action_required') { finalState = 'verify'; break; }
    }

    Swal.close();

    if (finalState === 'approved') {
      await this.registrarVentaTerminal(orderId);
      return;
    }
    if (finalState === 'canceled') {
      await Swal.fire({ icon: 'info', title: 'Cobro cancelado', text: 'No se registró la venta.' });
      return;
    }
    if (finalState === 'failed') {
      await Swal.fire({ icon: 'error', title: 'Pago rechazado', text: 'La terminal no aprobó el pago. No se registró la venta.' });
      return;
    }

    await this.verificarEstadoTerminal(orderId, finalState === 'timeout');
  }

  private async verificarEstadoTerminal(orderId: string, wasTimeout = false) {
    const api = (window as any).electronAPI;

    const choice = await Swal.fire({
      icon: 'warning',
      title: wasTimeout ? 'No se confirmó el pago a tiempo' : 'Verifica la terminal',
      text: 'Revisa la pantalla de la terminal. Si el pago quedó aprobado, vuelve a consultar para registrar la venta.',
      showCancelButton: true,
      confirmButtonText: 'Volver a consultar',
      cancelButtonText: 'Descartar'
    });

    if (!choice.isConfirmed) return; // descarta sin registrar

    try {
      const resp = await api.mpGetOrder(orderId);
      if (resp?.success && resp.state === 'approved') {
        await this.registrarVentaTerminal(orderId);
        return;
      }
      if (resp?.success && resp.state === 'failed') {
        await Swal.fire({ icon: 'error', title: 'Pago rechazado', text: 'No se registró la venta.' });
        return;
      }
      // sigue pendiente / action_required => vuelve a ofrecer consultar
      await this.verificarEstadoTerminal(orderId, false);
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'No se pudo consultar el estado.' });
    }
  }

  /**
   * El pago YA se cobro en la terminal. Si la venta no se registra, hay que
   * conciliar a mano: por eso se muestra el orderId en el error en lugar de
   * reintentar a ciegas. Misma ruta de registro que el resto: SaleService.
   */
  private async registrarVentaTerminal(orderId: string) {
    const res = await this.sale.checkout({ method: 'TERMINAL_MP' }, {
      openDrawer: false, // pago con tarjeta: no se abre el cajon
      autoPrint: this.autoPrintTicketOnSale,
    });

    if (!res.ok) {
      await Swal.fire({
        icon: 'error',
        title: 'Pago aprobado, pero no se registró la venta',
        text: `${res.error || 'Revisa la conexión a la base de datos.'} Orden MP: ${orderId}`
      });
      return;
    }

    this.afterSale(res.saleId ?? null, res, false);
    this.paymentMethod = 'EFECTIVO';

    this.showPostSaleModal = true;
    await this.refreshFolioFromDb();
  }

  async facturarUltimaVenta() {
    if (!this.facturaConceptos.length) {
      await Swal.fire({ icon: 'info', title: 'Sin datos', text: 'No hay conceptos para facturar.' });
      return;
    }
    const cli = this.lastClienteSeleccionado;
    if (cli) {
      this.facturaReceptorRfc = cli.tax_id ?? null;
      this.facturaReceptorNombre = cli.razon_social || cli.name;
      this.facturaReceptorRegimen = cli.regimen_fiscal ?? null;
      this.facturaReceptorUso = cli.uso_cfdi ?? null;
    } else {
      this.facturaReceptorRfc = null;
      this.facturaReceptorNombre = null;
      this.facturaReceptorRegimen = null;
      this.facturaReceptorUso = null;
    }

    this.showPostSaleModal = false;
    this.showFacturaModal = true;
  }

  // ==================
  // CLIENTES
  // ==================
  async abrirModalClientes() {
    const api = (window as any).electronAPI;
    if (!api || !api.getCustomers) {
      await Swal.fire({ icon: 'error', title: 'No disponible', text: 'La búsqueda de clientes no está disponible.' });
      return;
    }

    try {
      this.filtroClientes = '';
      const res = await api.getCustomers();
      if (res?.success) {
        this.clientesGenerales = (res.data || []).map((row: any) => ({
          id: row.id,
          name: row.customerName,
          tax_id: row.tax_id,
          razon_social: row.razon_social,
          regimen_fiscal: row.regimen_fiscal,
          uso_cfdi: row.uso_cfdi,
          phone: row.phone,
          email: row.email
        }));
        this.showModalClientes = true;
      }
    } catch (e: any) {
      console.error(e);
      await Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudieron cargar los clientes.' });
    }
  }

  cerrarModalClientes() {
    this.showModalClientes = false;
  }

  seleccionarCliente(cliente: CartCustomer) {
    this.cart.setCustomer(cliente);
    this.cerrarModalClientes();
  }

  quitarCliente() {
    this.cart.setCustomer(null);
  }

  // =========================
  // Cuentas en espera (multi-venta)
  // =========================
  tabLabel(t: Cart, i: number): string {
    const cli: any = t.customer;
    const n = cli?.name ?? cli?.nombre ?? cli?.customerName ?? cli?.razon_social;
    return n ? String(n) : `Cuenta ${i + 1}`;
  }

  tabItemCount(t: Cart): number {
    return t.lines?.length || 0;
  }

  switchTab(id: number) {
    if (id === this.activeTabId || this.isEditing) return;
    this.cart.switchTo(id);
  }

  nuevaCuenta() {
    if (this.isEditing) return;
    if (!this.cart.createCart()) {
      Swal.fire({ icon: 'info', title: 'Limite', text: `Puedes tener hasta ${CartService.MAX_CARTS} cuentas abiertas a la vez.` });
    }
  }

  async cerrarCuenta(id: number, ev?: Event) {
    ev?.stopPropagation();
    if (this.isEditing) return;
    const t = this.saleTabs.find(x => x.id === id);
    if (!t) return;
    if (t.lines.length > 0) {
      const r = await Swal.fire({
        icon: 'warning', title: 'Cerrar cuenta',
        text: 'Esta cuenta tiene productos. Se descartaran. Continuar?',
        showCancelButton: true, confirmButtonText: 'Cerrar', cancelButtonText: 'Cancelar'
      });
      if (!r.isConfirmed) return;
    }
    this.cart.closeCart(id);
  }

  /**
   * Adapta la lista de clientes con credito al formato del selector.
   * Es solo presentacion: no cambia como se cargan ni que se hace con ellos.
   */
  get opcionesCredito(): WxOpcion[] {
    return this.creditCustomers.map(c => ({
      valor: c.id,
      etiqueta: c.customerName,
      nota: 'Disp.: ' + c.availableCredit.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }),
      busca: [c.phone, c.email].filter(Boolean).join(' '),
    }));
  }
}
