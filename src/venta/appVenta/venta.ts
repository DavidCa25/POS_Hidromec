import {ReceiptEmail} from '../../app/receipt-email/receipt-email.component';
import {distribuirPagoDividido,type MetodoDividido,type PagoAplicado} from '../../../shared/pagos';
import {CommercialService} from '../../core/commercial.service';
import { DevolucionesService, MOTIVOS_DEVOLUCION, type LineaCambio, type MetodoDiferencia, type Regreso, type VentaParaDevolver } from '../../core/devoluciones.service';
import { ReceiptViewer } from '../../app/receipt-viewer/receipt-viewer.component';
import {CommercialSaleComponent} from '../../app/commercial-sale/commercial-sale.component';
import { Component, HostListener, OnDestroy, OnInit, effect, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgIf, NgFor, CurrencyPipe, DatePipe, DecimalPipe, SlicePipe, NgStyle } from '@angular/common';
import Swal from 'sweetalert2';
import { AuthService, PAQUETES } from '../../services/auth.service';
import { SupervisorAuthService } from '../../services/supervisor.service';
import { ConceptoFactura, FacturaNueva } from '../../app/factura-nueva/factura-nueva.component';
import { WxSelectComponent, WxOpcion } from '../../app/wx-select/wx-select.component';
import { WxDateComponent } from '../../app/wx-date/wx-date.component';
import { WxMascotaComponent } from '../../app/wx-mascota/wx-mascota.component';
import { WxFlechasDirective } from '../../app/wx-flechas/wx-flechas.directive';
import { GranelCantidadComponent } from '../granel-cantidad/granel-cantidad.component';
import { OpcionesProductoComponent } from '../opciones-producto/opciones-producto.component';
import { confirmarQuitar } from '../confirmar-quitar';
import { preguntarCajonVoucher } from '../cajon-voucher';
import {
  Cart, CartLine, CartService, CatalogProduct, CatalogService, CartCustomer,
  LoyaltyAward, Payment, PaymentMethod, SaleDetailRow, SaleHeader, SaleService,
  MesaService, ShiftService, SoldLine, ClientesVentaService,
  CajonService,
} from '../../core';
import { ClubService } from '../../core/club.service';
import { ClubWalletLectura } from '../../core/club-wallet-lectura';
import { SalidaEfectivo } from '../salida-efectivo/salida-efectivo.component';
import { EntradaEfectivo } from '../entrada-efectivo/entrada-efectivo.component';
import { PremiosVenta } from '../../loyalty/premios-venta';
import { LicenseService } from '../../services/license.service';
import { ServiciosService } from '../../modulo-servicios/servicios.service';
import { CuponVenta } from '../../loyalty/cupon-venta';
import { ClubClienteComponent } from '../../app/club-cliente/club-cliente.component';
import { MenuCatalogService, ModifierGroup } from '../../core/menu-catalog.service';
import { Memo } from '../../core/memo';
import { SelectedOption } from '../../core/models';
import {
  ResumenOpcion, gruposAConfigurar, resumenDeOpciones, seleccionAutomatica,
} from '../../core/opciones';
import { CapabilityService, FechaSqlPipe, MOTIVOS_SIN_CREDITO } from '../../core';
import { RegisterService } from '../../services/register.service';
import { AsistenciaChecarComponent } from '../../app/asistencia/checar/asistencia-checar.component';
import { PropinaCobroComponent, PropinaElegida } from '../../app/socios/propina-cobro.component';
import { DevolucionTouch } from '../../touch/devolucion-touch/devolucion-touch.component';

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
  termsDays: number;
  riskLevel: number;
  /** Por que no se le puede fiar (null = si). Lo decide la base. */
  block: 'RIESGO' | 'VENCIDAS' | 'SIN_DISPONIBLE' | null;
}

/* Los motivos viven en el servicio compartido: Touch dice lo mismo. */
const MOTIVO_CREDITO = MOTIVOS_SIN_CREDITO;

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
  imports: [FechaSqlPipe, AsistenciaChecarComponent, PropinaCobroComponent, DevolucionTouch, ReceiptEmail,CommercialSaleComponent,RouterOutlet, FormsModule, NgIf, NgFor, CurrencyPipe, DatePipe, DecimalPipe, SlicePipe, NgStyle, FacturaNueva, WxDateComponent, WxSelectComponent, PremiosVenta, CuponVenta, WxMascotaComponent, WxFlechasDirective, GranelCantidadComponent, OpcionesProductoComponent, SalidaEfectivo, EntradaEfectivo, ClubClienteComponent, ReceiptViewer],
  styleUrls: ['./venta.css']
})
export class Venta implements OnInit, OnDestroy {
  /** 0063 · Club: la tarjeta y el descuento en el cobro. */
  readonly club = inject(ClubService);
  priced(line:CartLine){return CartService.displayOf(this.cart.activeCart(),line);}

  private readonly cart = inject(CartService);
  protected readonly catalog = inject(CatalogService);
  private readonly shift = inject(ShiftService);
  private readonly cajon = inject(CajonService);
  readonly commercial=inject(CommercialService);
  private readonly sale = inject(SaleService);
  // Solo para leer los grupos de opciones de un producto. Retail no pinta el
  // menu Touch; lo necesita para saber que variante lleva una linea.
  private readonly menu = inject(MenuCatalogService);
  /* Servicios: esta pantalla cobra sus ordenes. No las conoce por dentro; solo
     sabe pedir sus partidas y, al final, decir con que venta se cobraron. */
  private readonly servicios = inject(ServiciosService);
  private readonly ruta = inject(ActivatedRoute);

  /*
   * Mesas: una cuenta de mesa abierta desde el salon se atiende aqui igual
   * que en Touch. Lo enviado ya esta en cocina; lo nuevo se envia con
   * «Enviar a cocina»; el cobro es el de siempre y despues libera la mesa.
   */
  private readonly mesaSvc = inject(MesaService);
  private readonly clientesSvc = inject(ClientesVentaService);
  private readonly licencia = inject(LicenseService);
  /* 0071: Checar (Asistencia), solo si el negocio activo la aplicacion. */
  readonly caps = inject(CapabilityService);
  private readonly cajaActual = inject(RegisterService);
  showChecar = false;
  /* 0065: devolucion directa, la misma que Touch. */
  devolviendo = false;
  motivoChecar: string | null = null;
  get cajaDeChecar(): number | null { return this.cajaActual.registerId; }
  abrirChecar(motivo: string | null = null): void {
    if (!this.caps.asistencia) return;
    this.motivoChecar = motivo;
    this.showChecar = true;
  }
  readonly cuentaMesa = this.mesaSvc.cuentaActiva;
  readonly pendientesMesa = this.mesaSvc.pendientes;
  enviandoMesa = false;

  async enviarMesa() {
    if (this.enviandoMesa) return;
    this.enviandoMesa = true;
    try {
      const r = await this.mesaSvc.enviar();
      if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se envió', text: r.error }); return; }
      const { comandas, sinImprimir } = r.datos;
      await Swal.fire({
        icon: sinImprimir.length ? 'warning' : 'success',
        title: comandas ? `Enviado a cocina · ${comandas} comanda${comandas > 1 ? 's' : ''}` : 'Guardado en la cuenta',
        text: sinImprimir.length ? `Sin imprimir: ${sinImprimir.join(' · ')}` : undefined,
        timer: sinImprimir.length ? undefined : 1400,
        showConfirmButton: !!sinImprimir.length,
      });
    } finally {
      this.enviandoMesa = false;
    }
  }

  /** Tras cobrar una cuenta de mesa: enlazarla a su venta libera la mesa. */
  private async cerrarMesa(mesa: { id: number } | null, saleId: number | null) {
    if (!mesa) return;
    const e = await this.mesaSvc.enlazarCobro(mesa.id, saleId);
    if (!e.ok) await Swal.fire({ icon: 'warning', title: 'La mesa no se liberó', text: e.error });
  }

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
  private readonly BARCODE_MIN_LEN = 6;

  printingTicket = false;
  enviarCorreo=false;

  autoPrintTicketOnSale = true;

  /**
   * «Cobrar sin ticket» apaga la impresion SOLO de la venta en curso. Se
   * vuelve a encender al abrir el siguiente cobro: olvidarlo apagado dejaria
   * a la siguiente persona de la fila sin su comprobante.
   */
  imprimirEstaVenta = true;

  private lastAddedProductId: number | null = null;

  showModal = false;
  dineroRecibido: number | null = null;
  paymentMethod: PaymentMethod = 'EFECTIVO';
  /** 0069: el numero de pedido de Uber Eats / Didi / Rappi (opcional). Con el,
      Liquidaciones de plataforma empareja la venta con el pedido sin dudar. */
  pedidoPlataforma='';
  /* Pago dividido, igual que en Touch: se eligen los métodos y en cada uno se
     escribe cuánto lleva. El que falta por escribir se llena solo con lo que
     falta; del efectivo sale el cambio. La regla es `distribuirPagoDividido`
     (shared/pagos), la misma de Touch.
     0081: «A crédito» también se combina: el cliente paga una parte y el
     resto queda en su crédito («trae $100 de $150»). */
  readonly mixedMethods: { valor: MetodoDividido; etiqueta: string; icono: string }[] = [
    { valor: 'EFECTIVO', etiqueta: 'Efectivo', icono: 'ph-coins' },
    { valor: 'TARJETA', etiqueta: 'Tarjeta', icono: 'ph-credit-card' },
    { valor: 'TRANSFERENCIA', etiqueta: 'Transferencia', icono: 'ph-bank' },
    { valor: 'PLATAFORMA', etiqueta: 'Plataforma', icono: 'ph-moped' },
    { valor: 'CREDITO', etiqueta: 'A crédito', icono: 'ph-hourglass' },
  ];
  metodosMixtos: MetodoDividido[] = [];
  capturadosMixtos: Partial<Record<MetodoDividido, number>> = {};
  get dividido() { return distribuirPagoDividido(this.totalVenta, this.metodosMixtos, this.capturadosMixtos); }
  /** Lo que se registra en la venta. */
  get pagosMixtos(): PagoAplicado[] { return this.dividido.pagos; }
  get errorMixto() { return this.paymentMethod === 'MIXTO' ? this.dividido.error : ''; }
  /** Cómo se llama el campo de cada método: el de efectivo dice lo que dio. */
  etiquetaMixto(m: MetodoDividido): string {
    return m === 'EFECTIVO' ? 'Efectivo recibido' : this.mixedMethods.find(x => x.valor === m)?.etiqueta ?? m;
  }
  /** Tocar un método: entra al pago; si ya estaba, sale (queda al menos uno). */
  alternarMetodoMixto(m: MetodoDividido) {
    if (this.cobrando) return;
    if (this.metodosMixtos.includes(m)) {
      if (this.metodosMixtos.length <= 1) return;
      this.metodosMixtos = this.metodosMixtos.filter(x => x !== m);
      const { [m]: _, ...resto } = this.capturadosMixtos;
      this.capturadosMixtos = resto;
    } else {
      if (this.metodosMixtos.length >= 4) return;
      this.metodosMixtos = [...this.metodosMixtos, m];
    }
    void this.alCambiarPagosMixtos();
  }
  /** Lo que se escribe en un método. Vacío: vuelve a llenarse solo. */
  capturarMixto(m: MetodoDividido, v: number | string | null) {
    const n = Number(v);
    const { [m]: _, ...resto } = this.capturadosMixtos;
    this.capturadosMixtos = v === '' || v == null || !Number.isFinite(n) ? resto : { ...resto, [m]: n };
  }

  /** ¿Algo de esta venta queda a crédito? La venta entera o una parte del pago dividido. */
  get usaCredito(): boolean {
    return this.paymentMethod === 'CREDITO' || (this.paymentMethod === 'MIXTO' && this.metodosMixtos.includes('CREDITO'));
  }
  /** Lo que queda a crédito: el total, o la parte «A crédito» del pago dividido. */
  get montoACredito(): number {
    if (this.paymentMethod === 'CREDITO') return this.totalVenta;
    return this.metodosMixtos.includes('CREDITO') ? Number(this.dividido.valores.CREDITO) || 0 : 0;
  }
  /** Lo que se cobra ahora cuando una parte queda a crédito. */
  get cobradoAhora(): number { return Math.max(0, Math.round((this.totalVenta - this.montoACredito) * 100) / 100); }

  /**
   * Al elegir «A crédito» en el pago dividido hace falta el cliente: se cargan
   * los que tienen crédito y se propone el de la cuenta, como en Crédito.
   * Al quitarlo, el cliente de crédito se suelta.
   */
  async alCambiarPagosMixtos(): Promise<void> {
    if (!this.usaCredito) { if (this.customerId != null) { this.customerId = null; this.dueDate = null; } return; }
    /* Solo al EMPEZAR a usar crédito: después, el cliente que se elija a mano
       se respeta. Manda el de la cuenta, como en «Crédito»; la lista solo
       propone al primero que puede fiar cuando la cuenta no tiene cliente. */
    if (this.customerId != null) return;
    await this.loadCreditCustomers();
    const cli = this.clienteSeleccionado;
    const match = cli ? this.creditCustomers.find(c => c.id === cli.id && !c.block) : null;
    if (match) this.customerId = match.id;
  }


  dueDate: string | null = null;

  creditCustomers: CreditCustomer[] = [];
  loadingCreditCustomers = false;

  lastSalePaid: number = 0;
  lastSaleChange: number = 0;
  /** Numero de pedido del dia de la ultima venta, si fue de una cuenta sin mesa. */
  lastSalePedido: number | null = null;

  showModalProductos = false;
  filtro = '';

  // Salida de efectivo (F10): el modal es un componente compartido con Touch.
  showCashOutModal = false;

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
  /* El turno pudo abrirse por otro camino (la barra superior, otra pantalla,
     la preparacion de una demo): el aviso de «abre el turno» ya sobra. */
  private readonly cerrarAvisoConTurno = effect(() => {
    if (this.shift.shift().open && this.showOpenShiftModal) this.cerrarModalAbrirTurno();
  });
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
  /* 0065: el motivo es obligatorio y ya no hay «Cambio»: no hacía nada
     distinto y el cajero creía que no movía dinero. */
  refundMotivo: string | null = null;
  refundNote = '';
  refundVenta: VentaParaDevolver | null = null;
  readonly motivosDevolucion = MOTIVOS_DEVOLUCION;
  private readonly devoluciones = inject(DevolucionesService);
  /** 0065: regresar el dinero o cambiar por otro producto. */
  refundModo: 'dinero' | 'cambio' = 'dinero';
  refundLleva: LineaCambio[] = [];
  refundProductoElegido: number | null = null;
  refundMetodoDif: MetodoDiferencia | null = null;
  refundRecibido: number | null = null;
  /** El comprobante de la última devolución, para imprimirlo. */
  refundComprobante: number | null = null;
  readonly metodosDiferencia: WxOpcion[] = [
    { valor: 'EFECTIVO', etiqueta: 'Efectivo' }, { valor: 'TARJETA', etiqueta: 'Tarjeta' }, { valor: 'TRANSFERENCIA', etiqueta: 'Transferencia' },
  ];
  private readonly memoCambio = new Memo<WxOpcion[]>();
  get opcionesCambio(): WxOpcion[] {
    const vendibles = this.catalog.vendibles();
    return this.memoCambio.de([vendibles], () =>
      vendibles.map(p => ({ valor: p.id, etiqueta: p.product_name, nota: '$' + Number(p.price).toFixed(2), busca: p.part_number ?? '' })));
  }
  get refundTotalLleva(): number { return this.devoluciones.totalLleva(this.refundLleva); }
  get refundDiferencia(): number { return Math.round((this.refundTotalLleva - this.refundTotalPreview) * 100) / 100; }
  agregarCambio(id: number | null): void {
    const p = this.catalog.vendibles().find(x => x.id === Number(id));
    if (!p) return;
    const ya = this.refundLleva.find(l => l.productId === p.id);
    if (ya) ya.cantidad += 1;
    else this.refundLleva = [...this.refundLleva, { productId: p.id, nombre: p.product_name, precio: Number(p.price), cantidad: 1 }];
    setTimeout(() => { this.refundProductoElegido = null; });
  }
  quitarCambio(l: LineaCambio): void { this.refundLleva = this.refundLleva.filter(x => x !== l); }
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
        if (Swal.isVisible()) return;

    if (this.granel || this.opcionesAbiertas || this.showModal || this.showModalProductos || this.showCashOutModal || this.showCashInModal || this.showPostSaleModal || this.showOpenShiftModal) return;
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

    /* Se viene de una orden de servicio a cobrarla. Va al final, DESPUES del
       turno: si no hay turno abierto no hay nada que cobrar, y cargar las
       partidas antes solo dejaria un carrito a medias. */
    const orden = Number(this.ruta.snapshot.queryParamMap.get('ordenServicio') || 0);
    if (orden > 0) await this.cargarOrdenDeServicio(orden);
  }

  // =========================================================================
  //  COBRAR UNA ORDEN DE SERVICIO
  // =========================================================================

  /**
   * El folio de la orden que se está cobrando en ESTA cuenta.
   *
   * Vive en el carrito y no en una variable de la pantalla porque el mostrador
   * tiene varias cuentas abiertas a la vez: si estuviera aquí, cambiar de
   * pestaña y volver enlazaría la orden con la venta equivocada.
   */
  get ordenServicio(): { id: number; folio: string } | null {
    const m = this.cart.activeCart().meta as any;
    return m?.ordenServicio ?? null;
  }

  /**
   * Trae las partidas de la orden a una cuenta NUEVA.
   *
   * Nueva, y no la que estuviera activa: el mostrador puede tener medio ticket
   * armado, y perdérselo por cobrar una orden sería un daño que nadie pidió.
   *
   * Los precios son los CONGELADOS de la orden, no los del catálogo de hoy.
   * Es lo que el cliente autorizó, y es justo lo que distingue cobrar una
   * orden de volver a teclearla.
   */
  private async cargarOrdenDeServicio(ordenId: number) {
    const previa = await this.servicios.cobroPrevia(ordenId);
    if (!previa.ok) {
      await Swal.fire({ icon: 'error', title: 'No se pudo cargar la orden', text: previa.error });
      return;
    }

    const resumen = previa.datos.resumen;
    if (!resumen || !resumen.can_charge) {
      await Swal.fire({
        icon: 'info', title: 'Esta orden no se puede cobrar',
        text: resumen?.blocked_reason || 'No hay nada que cobrar.',
      });
      void this.router.navigate(['/dashboard/ordenes-de-servicio/orden', ordenId]);
      return;
    }

    const cuenta = this.cart.createCart();
    if (!cuenta) {
      await Swal.fire({
        icon: 'info', title: 'No hay cuentas libres',
        text: 'Cierra o cobra alguna de las cuentas abiertas y vuelve a intentarlo.',
      });
      return;
    }

    for (const p of previa.datos.partidas) {
      this.cart.addProduct({
        productId: Number(p.product_id),
        productName: String(p.name_snapshot),
        unitPrice: Number(p.unit_price),
        inventoryMode: p.line_kind === 'SERVICIO' ? 'NONE' : undefined,
      }, Number(p.quantity));
    }

    /* El cliente de la orden queda puesto: es suya, y volver a elegirlo es
       pedirle al mostrador que repita algo que el sistema ya sabe. */
    const cli = await this.buscarClienteDeLaOrden(Number(resumen.customer_id));
    if (cli) this.cart.setCustomer(cli);

    cuenta.meta = {
      ...(cuenta.meta ?? {}),
      ordenServicio: { id: ordenId, folio: this.folioDeOrden(ordenId) },
    };

    /* Solo si nadie lo decidio antes: desde la orden, «Cobrar igual» ya es
       esa decision y llega como `sinAutorizar=aceptado`. */
    const yaDecidido = this.ruta.snapshot.queryParamMap.get('sinAutorizar') === 'aceptado';
    if (resumen.needs_reauthorization && !yaDecidido) {
      await Swal.fire({
        icon: 'warning', title: 'Sin autorizar',
        text: 'El cliente no ha aprobado este importe. Puedes cobrar igual, '
            + 'pero conviene registrarlo antes.',
      });
    }
  }

  /** Abre la orden que se está cobrando, sin perder el carrito. */
  verOrdenDeServicio(id: number) {
    void this.router.navigate(['/dashboard/ordenes-de-servicio/orden', id]);
  }

  /** El folio se pinta a partir del identificador, igual que lo arma SQL. */
  private folioDeOrden(id: number): string {
    return 'OS-' + String(id).padStart(6, '0');
  }

  private async buscarClienteDeLaOrden(clienteId: number): Promise<CartCustomer | null> {
    if (!clienteId) return null;
    try {
      const r = await (window as any).electronAPI?.getCustomers?.();
      const lista: any[] = r?.data ?? r ?? [];
      const c = lista.find((x: any) => Number(x.id) === clienteId);
      return c ? { id: c.id, name: c.customerName, taxId: c.tax_id ?? null } as CartCustomer : null;
    } catch { return null; }
  }

  /**
   * La venta ya está registrada: se ata a su orden.
   *
   * Si esto falla, la venta EXISTE y la orden queda sin enlazar. No se puede
   * deshacer el cobro —el dinero ya entró— así que lo único honesto es decir
   * el número de venta para poder atarla después. Tragárselo dejaría una orden
   * que parece impagada y que alguien volvería a cobrar.
   */
  private async enlazarOrdenDeServicio(saleId: number | null, orden: { id: number; folio: string }) {
    if (!saleId) return;
    const r = await this.servicios.enlazarVenta(orden.id, saleId);
    if (r.ok) return;

    await Swal.fire({
      icon: 'warning',
      title: 'La venta se registró, pero la orden quedó suelta',
      html: `La venta <b>${saleId}</b> está cobrada y el dinero entró.<br>`
          + `Lo que no quedó es su enlace con <b>${orden.folio}</b>.<br><br>`
          + `Abre la orden y vuelve a cobrarla: reconocerá esta venta y no cobrará de nuevo.`
          + `<br><br><small>${r.error ?? ''}</small>`,
    });
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

  /* El buscador pinta decenas, no miles: con 6,000 productos pintar todas las
     tarjetas tardaba 3–4 s en abrir. Se memoriza por texto y catálogo. */
  private readonly memoBusqueda = new Memo<{ items: CatalogProduct[]; total: number }>();
  get busquedaProductos(): { items: CatalogProduct[]; total: number } {
    return this.memoBusqueda.de([this.catalog.vendibles(), this.filtro], () => this.catalog.buscar(this.filtro, 120));
  }
  readonly esqueletoProductos = Array.from({ length: 6 });
  trackProducto = (_: number, p: CatalogProduct) => p.id;

  /** Cliente de credito elegido en el cobro. */
  get customerId(): number | null { return this.cart.activeCart().creditCustomerId; }
  set customerId(v: number | null) {
    this.cart.setCreditCustomer(v);
    /* El vencimiento sale del plazo del cliente; se puede cambiar a mano. Si
       no hay fecha, sp_register_sale pone la misma. */
    const c = v == null ? null : this.creditCustomers.find(x => x.id === v);
    this.dueDate = c && c.termsDays > 0 ? this.fechaEnDias(c.termsDays) : null;
  }

  /** 'YYYY-MM-DD' local, dentro de n dias. */
  private fechaEnDias(n: number): string {
    const d = new Date();
    d.setDate(d.getDate() + n);
    const z = (x: number) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  }

  /** El cliente de credito elegido, con su disponible. */
  get clienteCredito(): CreditCustomer | null {
    return this.creditCustomers.find(c => c.id === this.customerId) ?? null;
  }

  /** La venta pasa del disponible del cliente: se dice ANTES de cobrar. */
  get excedeCredito(): boolean {
    const c = this.clienteCredito;
    return !!c && this.montoACredito > c.availableCredit + 0.001;
  }

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
    /* 0079: la propina en efectivo se queda en el cajon: no es cambio. */
    const c = this.dineroRecibido - this.totalVenta - this.propinaEfectivo;
    return c > 0 ? c : 0;
  }

  /** 0079 · La propina elegida en el cobro (no suma al total de la venta). */
  propina: PropinaElegida | null = null;
  get propinaEfectivo(): number { return this.propina?.metodo === 'EFECTIVO' ? this.propina.monto : 0; }
  /** Con tarjeta se cobra cuenta + propina: el recibido automatico la incluye. */
  alCambiarPropina(p: PropinaElegida | null): void {
    this.propina = p;
    if (this.recibidoAutomatico && this.paymentMethod === 'TARJETA') this.dineroRecibido = this.totalVenta + (p?.monto ?? 0);
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

  /**
   * El renglón del carrito elegido con ↑ ↓ (resaltado). Con uno elegido, + y −
   * cambian SU cantidad y Supr lo quita; sin elegir, + y − siguen actuando
   * sobre el último agregado, como siempre. Agregar un producto lo suelta.
   */
  lineaSeleccionada: number | null = null;

  private moverSeleccion(delta: number) {
    const n = this.items.length;
    if (!n) { this.lineaSeleccionada = null; return; }
    const actual = this.lineaSeleccionada;
    const sig = actual == null ? (delta > 0 ? 0 : n - 1) : Math.min(n - 1, Math.max(0, actual + delta));
    this.lineaSeleccionada = sig;
    setTimeout(() => document.querySelector('tr.linea-activa')?.scrollIntoView({ block: 'nearest' }));
  }

  private get lineaElegida(): CartLine | null {
    const i = this.lineaSeleccionada;
    return i != null && i < this.items.length ? this.items[i] : null;
  }

  private async ajustarCantidad(delta: number) {
    const l = this.lineaElegida;
    if (l) { if (!l.combo) await this.bajarOQuitar(l, delta); return; }
    await this.adjustLastAddedQty(delta);
  }

  private async adjustLastAddedQty(delta: number) {
    const lines = this.items;
    if (!lines.length) return;

    const fallback = lines[lines.length - 1];
    const target = this.lastAddedProductId != null
      ? lines.find(it => it.productId === this.lastAddedProductId) ?? fallback
      : fallback;

    if (!target) return;
    await this.bajarOQuitar(target, delta);
  }

  /* Bajar de la cantidad mínima (1 pieza, 0.01 a granel) ya no se queda
     atorado en el mínimo: pregunta si se quita el producto de la venta. */
  private async bajarOQuitar(l: CartLine, delta: number) {
    if (delta < 0 && Number(l.qty || 0) + delta < CartService.minimoDe(l)) {
      await this.preguntarQuitar(l);
      return;
    }
    this.cart.adjustQty(l, delta);
  }

  private async preguntarQuitar(l: CartLine): Promise<boolean> {
    if (!(await confirmarQuitar(l.productName || 'Producto'))) return false;
    const i = this.items.indexOf(l);
    if (i >= 0) this.quitarItem(i);
    return true;
  }

  async onQtyChange(i: number) {
    const it = this.items[i];
    if (!it) return;
    /* Escribir 0 en la cantidad también pregunta; si no se quita, vuelve al mínimo. */
    if (it.qty != null && (it.qty as any) !== '' && Number(it.qty) <= 0) {
      if (await this.preguntarQuitar(it)) return;
    }
    this.cart.setQty(it, it.qty);
  }

  /** 0077 · «Cambiar precios». */
  get puedeCambiarPrecio(): boolean { return this.auth.puede(PAQUETES.PRECIOS); }

  onPriceChange(i: number) {
    const it = this.items[i];
    if (!it) return;
    if (!this.puedeCambiarPrecio) return;
    this.cart.setPrice(it, it.unitPrice);
    // Detección (robo hormiga): registra el cambio de precio en la venta.
    this.supervisor.registrar('PRICE_CHANGE', { detail: (it.productName || 'Producto') + ' -> $' + Number(it.unitPrice).toFixed(2) });
  }

  quitarItem(i: number) {
    const removed = this.items[i];
    if (!removed) return;
    this.cart.removeLine(removed);
    if (this.lineaSeleccionada != null) {
      this.lineaSeleccionada = this.items.length ? Math.min(this.lineaSeleccionada, this.items.length - 1) : null;
    }

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

    /* Una cuenta de mesa con productos que van a preparacion y no se
       enviaron: se pregunta, no se cobra en silencio sin comanda. */
    if (this.mesaSvc.cuentaActiva()) {
      const pend = await this.mesaSvc.pendientesDePreparacion(this.cart.activeCart().lines);
      if (pend.length) {
        const r = await Swal.fire({
          icon: 'question',
          title: 'Hay productos sin enviar a preparación',
          text: `${pend.length} ${pend.length === 1 ? 'producto aún no llega' : 'productos aún no llegan'} a cocina. Si cobras así, nadie ${pend.length === 1 ? 'lo' : 'los'} prepara.`,
          showCancelButton: true,
          confirmButtonText: 'Enviar y cobrar',
          cancelButtonText: 'Volver',
        });
        if (!r.isConfirmed) return;
        await this.enviarMesa();
        if ((await this.mesaSvc.pendientesDePreparacion(this.cart.activeCart().lines)).length) return;
      }
    }

    this.dineroRecibido = null;
    this.recibidoAutomatico = false;
    this.pedidoPlataforma = '';
    this.propina = null;
    this.imprimirEstaVenta = true;
    /* Si la venta anterior fue con tarjeta, el método sigue elegido: el total
       exacto se pone de una vez. */
    if (this.paymentMethod === 'TARJETA' || this.paymentMethod === 'TRANSFERENCIA' || this.paymentMethod === 'TERMINAL_MP') {
      this.dineroRecibido = this.totalVenta;
      this.recibidoAutomatico = true;
    }
    this.showModal = true;
  }

  /** La misma venta, sin papel. Funciona con cualquier método de pago. */
  async cobrarSinTicket() {
    if (this.cobrando) return;
    this.imprimirEstaVenta = false;
    await this.confirmarCobro();
  }

  private get imprimirAlCobrar(): boolean {
    return this.autoPrintTicketOnSale && this.imprimirEstaVenta;
  }

  cerrarModalCobrar() { this.showModal = false; }

  /** «Dinero recibido» lo puso Wybix (pago exacto), no la persona. */
  private recibidoAutomatico = false;

  async onPaymentMethodChange(method: PaymentMethod) {
    if(this.cobrando)return;
    const antes = this.paymentMethod;
    this.paymentMethod = method;
    /* Al entrar a dividir: efectivo y tarjeta, sin nada escrito (Touch igual). */
    if (method === 'MIXTO' && antes !== 'MIXTO') { this.metodosMixtos = ['EFECTIVO', 'TARJETA']; this.capturadosMixtos = {}; }
    if(method==='PLATAFORMA')this.dineroRecibido=this.totalVenta;
    else this.pedidoPlataforma='';

    /* Con tarjeta, transferencia o Mercado Pago se cobra el total exacto: se
       pone solo. Antes había que escribirlo, y si no, el cobro fallaba con
       «el dinero recibido debe ser mayor o igual al total». Touch ya lo hacía.
       Al volver a efectivo se borra, para que se escriba lo que dio el cliente. */
    if (method === 'TARJETA' || method === 'TRANSFERENCIA' || method === 'TERMINAL_MP') {
      this.dineroRecibido = this.totalVenta;
      this.recibidoAutomatico = true;
    } else if (method === 'EFECTIVO' && this.recibidoAutomatico) {
      this.dineroRecibido = null;
      this.recibidoAutomatico = false;
    }

    if (method === 'CREDITO') {
      this.dineroRecibido = null;
      await this.loadCreditCustomers();

      const cli = this.clienteSeleccionado;
      if (cli && this.creditCustomers.length > 0) {
        const match = this.creditCustomers.find(c => c.id === cli.id && !c.block);
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
        termsDays: Number(r.terms_days ?? 0),
        riskLevel: Number(r.risk_level ?? 0),
        block: (r.credit_block ?? null),
      }));

      /* Se preselecciona el primero al que SI se le puede fiar. */
      const primero = this.creditCustomers.find(c => !c.block);
      this.customerId = primero ? primero.id : null;
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

    const isCredito = this.usaCredito;
    /* La base tiene la ultima palabra (sp_register_sale), pero decirlo aqui
       ahorra un viaje y un mensaje menos claro. */
    if (isCredito && this.excedeCredito) {
      const c = this.clienteCredito!;
      this.showModal = false;
      await Swal.fire({
        icon: 'warning', title: 'Supera el crédito disponible',
        text: `${c.customerName} tiene ${c.availableCredit.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })} disponibles y ${this.paymentMethod === 'CREDITO' ? 'la venta es' : 'lo que queda a crédito es'} de ${this.montoACredito.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}.`,
      });
      return;
    }
    const payment: Payment = {
      method: this.paymentMethod,
      payments:this.paymentMethod==='MIXTO'?this.pagosMixtos
        :this.paymentMethod==='PLATAFORMA'&&this.pedidoPlataforma.trim()?[{method:'PLATAFORMA' as const,amount:this.totalVenta,reference:this.pedidoPlataforma.trim().slice(0,100)}]
        :undefined,
      received: isCredito ? null : this.dineroRecibido,
      creditCustomerId: isCredito ? this.customerId : null,
      dueDate: isCredito ? this.dueDate : null,
      tip: this.propina,
    };

    // Mismos mensajes que antes: el Core valida, la pantalla los muestra.
    const err = this.sale.validate(this.cart.activeCart(), payment);
    if (err) {
      this.showModal = false;
      const esCliente = /cliente/i.test(err);
      await Swal.fire({ icon: 'error', title: esCliente ? 'Cliente requerido' : 'Oops...', text: err });
      return;
    }

    /* Se lee ANTES de cobrar: `checkout` cierra la cuenta activa y pasa a la
       vecina, así que después ya no hay de dónde sacar la orden. */
    const orden = this.ordenServicio;
    const mesa = this.mesaSvc.cuentaActiva();

    const res = await this.sale.checkout(payment, {
      openDrawer: this.paymentMethod==='MIXTO'?this.pagosMixtos.some(p=>p.method==='EFECTIVO'):this.paymentMethod==='EFECTIVO',
      autoPrint: this.imprimirAlCobrar,
    });

    if (!res.ok) {
      this.showModal = false;
      /* 0071: la regla «checar entrada antes de cobrar». Se abre Checar en
         lugar de un error: la persona resuelve ahi mismo y vuelve a cobrar. */
      if (res.motivo === 'ASISTENCIA_SIN_ENTRADA') { this.abrirChecar(res.error || null); return; }
      await Swal.fire({ icon: 'error', title: 'Error al registrar venta', text: res.error || 'No se pudo registrar la venta.' });
      return;
    }

    if (orden) await this.enlazarOrdenDeServicio(res.saleId ?? null, orden);
    await this.cerrarMesa(mesa, res.saleId ?? null);

    this.afterSale(res.saleId ?? null, res, isCredito);
    this.propina = null;
    if (res.propinaError) await Swal.fire({ icon: 'warning', title: 'La venta quedó; la propina no', text: res.propinaError });
    this.lastSalePedido = mesa?.numero ?? null;
    this.showModal = false;
    await preguntarCajonVoucher(this.sale, this.paymentMethod === 'MIXTO' ? this.pagosMixtos.map(p => p.method) : [this.paymentMethod]);
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

  /* VENTA ANTERIOR: lo mínimo para resolver una duda en el mostrador
     («¿cuánto le di de cambio?») sin abrir el historial. Vive en memoria:
     la última venta cobrada en esta pantalla. */
  ventaAnterior: { id: number | null; total: number; pagado: number | null; cambio: number | null; metodo: string; hora: Date } | null = null;
  verTicketAnterior = false;
  private static readonly METODOS: Record<string, string> = {
    EFECTIVO: 'Efectivo', TARJETA: 'Tarjeta', TRANSFERENCIA: 'Transferencia', TERMINAL_MP: 'Mercado Pago',
    MIXTO: 'Mixto', CREDITO: 'Crédito', PLATAFORMA: 'Plataforma',
  };

  /** Estado posventa comun a efectivo/tarjeta/credito/terminal. */
  private afterSale(saleId: number | null, res: { total?: number; paid?: number; change?: number; lines?: SoldLine[]; customer?: CartCustomer | null; premios?: LoyaltyAward[] }, isCredito: boolean) {
    this.premiosUltimaVenta = res.premios ?? [];
    this.lastSaleId = saleId;
    this.lastSaleIsCredito = isCredito;
    this.lastSaleTotal = res.total ?? 0;
    /* 0081: a crédito con una parte pagada: lo pagado y el cambio sí existen. */
    const pagoUnaParte = isCredito && (res.paid ?? 0) > 0;
    if (!isCredito || pagoUnaParte) {
      this.lastSalePaid = res.paid ?? this.lastSaleTotal;
      this.lastSaleChange = res.change ?? 0;
    }
    const metodo = isCredito ? 'CREDITO' : this.paymentMethod;
    this.ventaAnterior = {
      id: saleId,
      total: this.lastSaleTotal,
      pagado: isCredito && !pagoUnaParte ? null : this.lastSalePaid,
      cambio: isCredito && !pagoUnaParte ? null : this.lastSaleChange,
      metodo: Venta.METODOS[metodo] ?? String(metodo || ''),
      hora: new Date(),
    };
    // Cliente en memoria para facturar despues de limpiar la vista.
    this.lastClienteSeleccionado = res.customer ?? null;
    this.prepararConceptosFactura(res.lines ?? [], saleId);

    this.dineroRecibido = null;
    this.pedidoPlataforma = '';
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
    /* Se abre YA con lo que hay; el catálogo se refresca en segundo plano si
       es viejo. La primera vez (sin nada en memoria) se ve el esqueleto. */
    this.showModalProductos = true;
    await this.catalog.refrescarEnFondo();
  }

  cerrarModalProductos() { this.showModalProductos = false; }

  /**
   * Enter en el buscador: si lo escrito deja productos a la vista, agrega el
   * primero. Es lo que se espera al teclear un nombre o una clave completa;
   * para otro, ↓ baja a la lista y las flechas eligen.
   */
  async agregarPrimerProductoVisible() {
    if (!(this.filtro || '').trim()) return;
    const p = this.busquedaProductos.items[0];
    if (p) await this.seleccionarProducto(p);
  }

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

    const fuente = CatalogService.toLineSource(p);
    /* A granel se pregunta cuánto: el jamón no se vende «uno». */
    let qty = 1;
    if (fuente.decimal) {
      this.showModalProductos = false;
      const q = await this.preguntarCantidad(p.product_name, Number(fuente.unitPrice ?? 0), p.base_uom ?? 'kg', null);
      if (q == null) return;
      qty = q;
    }

    this.cart.addProduct(fuente, qty, opciones);
    this.lastAddedProductId = p.id;
    this.lineaSeleccionada = null;
    this.showModalProductos = false;
  }

  // ==================
  // GRANEL: ¿CUÁNTO?
  // ==================
  /** La ventana «¿Cuánto?» abierta, y a quién le contesta. */
  granel: { nombre: string; precio: number; uom: string; inicial: number | null; resolver: (q: number | null) => void } | null = null;

  /** Abre «¿Cuánto?» y espera: la cantidad elegida, o null si se canceló. */
  private preguntarCantidad(nombre: string, precio: number, uom: string, inicial: number | null): Promise<number | null> {
    return new Promise(resolve => {
      this.granel = { nombre, precio, uom, inicial, resolver: resolve };
    });
  }

  cerrarGranel(q: number | null) {
    const g = this.granel;
    this.granel = null;
    g?.resolver(q);
  }

  /** Enter sobre un renglón a granel del carrito: corregir su cantidad. */
  private async corregirGranel(i: number) {
    const l = this.items[i];
    if (!l?.decimal || l.enviada != null) return;
    const uom = this.catalog.findById(l.productId)?.base_uom ?? 'kg';
    const q = await this.preguntarCantidad(l.productName, l.effectiveUnitPrice, uom, l.qty);
    if (q != null) this.cart.setQty(l, q);
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
   * UNA ventana con todos los grupos del producto (`app-opciones-producto`).
   *
   * Es el equivalente de Retail a la hoja de Touch, y usa exactamente la misma
   * regla para decidir que grupos salen (`gruposAConfigurar`), cuantas
   * unidades caben (`topeDeGrupo`) y cuanto suma (`precioDeOpciones`). Lo que
   * cambia es como se pinta, no lo que se decide: dos motores de reglas es
   * como se llega a que una caja acepte cuatro shots y la otra tres.
   *
   * Devuelve `null` si se cancela.
   */
  opcionesAbiertas: { nombre: string; precio: number; grupos: ModifierGroup[]; resolver: (s: SelectedOption[] | null) => void } | null = null;

  private preguntarOpciones(p: CatalogProduct, grupos: ModifierGroup[]): Promise<SelectedOption[] | null> {
    return new Promise(resolve => {
      this.opcionesAbiertas = { nombre: p.product_name, precio: Number(p.price) || 0, grupos, resolver: resolve };
    });
  }

  cerrarOpciones(sel: SelectedOption[] | null) {
    const o = this.opcionesAbiertas;
    this.opcionesAbiertas = null;
    o?.resolver(sel);
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
    // Venta Esencial: el inventario no se administra, se vende lo vendible.
    if (this.licencia.ventaEsencial) return false;
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
  /* F1: abrir el cajon sin venta. Lo autoriza otra persona y queda
     registrado (CajonService), igual que la pantalla que reemplaza. */
  async abrirCajonManual() {
    await this.cajon.abrirSinVenta();
  }

  async abrirSalidaEfectivo() {
    const ok = await this.ensureShiftOpen('SALIDA');
    if (!ok) return;
    this.showCashOutModal = true;
  }

  /* F4 · 0076: entrada de efectivo (cambio, dinero del dueño, préstamo). */
  showCashInModal = false;
  async abrirEntradaEfectivo() {
    const ok = await this.ensureShiftOpen('SALIDA');
    if (!ok) return;
    this.showCashInModal = true;
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

    /* Con el aviso de abrir turno, F9 sigue checando: es lo primero al llegar. */
    if (event.key === 'F9' && this.showOpenShiftModal && this.caps.asistencia) {
      event.preventDefault();
      this.abrirChecar();
      return;
    }

    /* Con un aviso abierto (p. ej. «¿Quitar de la venta?») las teclas son suyas. */
    if (Swal.isVisible()) return;

    /* La devolución (y el reembolso de un folio cargado) tienen sus propias
       flechas: aquí no se mueve el carrito ni Supr borra un renglón por debajo. */
    if (this.granel || this.opcionesAbiertas || this.devolviendo || this.showRefundModal || this.showModal || this.showModalProductos || this.showCashOutModal || this.showCashInModal || this.showPostSaleModal || this.showOpenShiftModal || this.showFacturaModal) {
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

      case 'F4':
        event.preventDefault();
        if (!this.showCashInModal) await this.abrirEntradaEfectivo();
        return;

      case 'F9':
        if (!this.caps.asistencia) return;
        event.preventDefault();
        this.abrirChecar();
        return;

      case '+':
        event.preventDefault();
        this.ajustarCantidad(+1);
        return;

      case '-':
        event.preventDefault();
        /* 0066 · El código de la tarjeta del Club es WXC-<serial>: ese guion
           es parte de la lectura, no el atajo de restar una pieza. */
        if (/^WXC$/i.test(this.scanBuffer)) { this.pushChar('-'); return; }
        this.ajustarCantidad(-1);
        return;

      /* ↑ ↓ eligen renglón del carrito; Supr lo quita; Esc suelta la elección. */
      case 'ArrowDown':
      case 'ArrowUp':
        if (this.isEditing && !this.editUnlocked) return;
        event.preventDefault();
        this.moverSeleccion(event.key === 'ArrowDown' ? 1 : -1);
        return;

      case 'Delete':
        if (this.lineaSeleccionada == null || (this.isEditing && !this.editUnlocked)) return;
        event.preventDefault();
        this.quitarItem(this.lineaSeleccionada);
        return;

      case 'Escape':
        if (this.lineaSeleccionada == null) return;
        event.preventDefault();
        this.lineaSeleccionada = null;
        return;
    }

    if (event.key === 'Enter') {
      if (this.scanBuffer.length) {
        event.preventDefault();
        await this.commitScanBuffer();
      } else if (this.lineaSeleccionada != null && this.items[this.lineaSeleccionada]?.decimal
                 && (!this.isEditing || this.editUnlocked)) {
        event.preventDefault();
        await this.corregirGranel(this.lineaSeleccionada);
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
          /* Un folio con 0.25 kg se vendió por peso: al modificarlo no puede
             subirse a 1 por la regla de las piezas. */
          decimal: Number(d.quantity ?? 1) % 1 !== 0,
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

      this.refundMotivo = null;
      this.refundNote = '';
      this.refundModo = 'dinero';
      this.refundLleva = [];
      this.refundMetodoDif = null;
      this.refundRecibido = null;
      this.refundVenta = await this.devoluciones.cargar(this.editingSaleId);
      void this.catalog.load(true);
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

  /** Por dónde regresa el dinero, con la regla de SQL, antes de confirmar. */
  get refundRegreso(): Regreso[] {
    if (this.refundModo === 'cambio') {
      return this.refundLleva.length && this.refundDiferencia < 0 ? this.devoluciones.comoRegresa(this.refundVenta, -this.refundDiferencia) : [];
    }
    return this.devoluciones.comoRegresa(this.refundVenta, this.refundTotalPreview);
  }

  get refundTotalPreview(): number {
    const total = (this.refundLines || [])
      .filter(l => Number(l.qty) > 0)
      .reduce((acc, l) => acc + (Number(l.qty) * Number(l.unitPrice)), 0);
    return Number(total.toFixed(2));
  }

  /** 0065: el CAMBIO: devolver y llevarse otra cosa en una sola operación. */
  private async confirmarCambio(): Promise<void> {
    if (!this.refundVenta || !this.refundMotivo) return;
    if (!this.refundLleva.length) {
      await Swal.fire({ icon: 'warning', title: 'Falta qué se lleva', text: 'Elige el producto que se lleva a cambio.' });
      return;
    }
    const dif = this.refundDiferencia;
    if (dif > 0 && !this.refundMetodoDif) {
      await Swal.fire({ icon: 'warning', title: 'Falta cómo paga', text: 'Elige cómo paga la diferencia.' });
      return;
    }
    if (dif > 0 && this.refundMetodoDif === 'EFECTIVO' && Number(this.refundRecibido || 0) < dif) {
      await Swal.fire({ icon: 'warning', title: 'No alcanza', text: 'El dinero recibido no cubre la diferencia.' });
      return;
    }
    for (const l of this.refundVenta.renglones) l.cantidad = Number(this.refundLines.find(x => x.productId === l.productId)?.qty || 0);
    this.refundLoading = true;
    try {
      const r = await this.devoluciones.cambiar(this.refundVenta, this.refundMotivo, this.refundNote || '', this.currentUserId, this.refundLleva,
        { metodo: dif > 0 ? this.refundMetodoDif : null, recibido: dif > 0 && this.refundMetodoDif === 'EFECTIVO' ? Number(this.refundRecibido) : null });
      if (!r.ok || !r.hecho) {
        if (!r.cancelado) await Swal.fire({ icon: 'error', title: 'No se pudo hacer el cambio', text: r.error });
        return;
      }
      this.showRefundModal = false;
      const h = r.hecho;
      const cambioEfectivo = dif > 0 && this.refundMetodoDif === 'EFECTIVO' ? Number(this.refundRecibido) - dif : 0;
      const detalle = h.paga > 0 ? `Cobra la diferencia: <b>$${h.paga.toFixed(2)}</b>${cambioEfectivo > 0 ? ` · cambio $${cambioEfectivo.toFixed(2)}` : ''}`
        : h.regresa > 0 ? `Se le regresan <b>$${h.regresa.toFixed(2)}</b> como en una devolución.` : 'Sin diferencia.';
      const ok = await Swal.fire({ icon: 'success', title: 'Cambio registrado', html: `Venta del cambio #${h.saleId}.<br>${detalle}`,
        showCancelButton: true, confirmButtonText: 'Listo', cancelButtonText: 'Imprimir comprobante' });
      if (ok.dismiss === Swal.DismissReason.cancel) this.refundComprobante = h.refundId;
      this.folioInput = this.editingSaleId;
      await this.buscarFolioPorInput();
    } finally {
      this.refundLoading = false;
    }
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

    if (!this.refundMotivo) {
      await Swal.fire({ icon: 'warning', title: 'Falta el motivo', text: 'Elige por qué se devuelve.' });
      return;
    }
    if (this.refundMotivo === 'Otro' && !(this.refundNote || '').trim()) {
      await Swal.fire({ icon: 'warning', title: 'Escribe el motivo', text: 'Con «Otro», di en la nota qué pasó.' });
      return;
    }

    const totalPreview = this.refundTotalPreview;

    if (this.refundModo === 'cambio') { await this.confirmarCambio(); return; }

    this.showRefundModal = false;

    const confirm = await Swal.fire({
      icon: 'question',
      title: 'Confirmar devolución',
      html: `<div style="text-align:left">Total: <b>$${totalPreview.toFixed(2)}</b><br>Motivo: <b>${this.refundMotivo}</b></div>`,
      showCancelButton: true,
      confirmButtonText: 'Sí, confirmar',
      cancelButtonText: 'Cancelar'
    });

    if (!confirm.isConfirmed) return;

    /* Candado anti robo hormiga (Roles v2): la devolución la autoriza un
       encargado con su PIN o el dueño desde su app. No se pide aquí: si quien
       opera no puede, el canal lo contesta y el diálogo de autorización sale
       solo; la autorización viaja con la operación y queda en bitácora. */

    this.refundLoading = true;
    try {
      const payload = {
        sale_id: this.editingSaleId,
        user_id: this.currentUserId,

        payment_method: 'EFECTIVO',

        motivo: this.refundMotivo,

        items: selected.map(x => ({
          productId: x.productId,
          qty: x.qty,
          unitPrice: x.unitPrice
        })),

        note: (this.refundNote || '').trim() || null,
        // Para quien autoriza (el dueño lo ve en su app) y para la bitácora.
        amount: totalPreview,
        reason: 'Devolución · ' + this.refundMotivo + ' · folio #' + this.editingSaleId,

        apply_net_update: 0
      };

      const resp = await this.sale.refundSale(payload);

      if (!resp?.success) {
        if (resp?.cancelado) return;
        await Swal.fire({ icon: 'error', title: 'No se pudo procesar', text: resp?.error || 'Error en reembolso/cambio.' });
        return;
      }

      const fila = Array.isArray(resp.data) ? resp.data[0] : resp.data;
      const ok = await Swal.fire({ icon: 'success', title: 'Devolución registrada', text: 'Se repuso el inventario.',
        showCancelButton: !!fila?.refund_id, confirmButtonText: 'Listo', cancelButtonText: 'Imprimir comprobante' });
      if (ok.dismiss === Swal.DismissReason.cancel && fila?.refund_id) this.refundComprobante = Number(fila.refund_id);

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
    /* Cada lectura decide de nuevo si vino del escáner. Antes esto no se
       limpiaba: tras el primer escaneo, todo lo tecleado se buscaba como
       código de barras y un No. de parte salía «No encontrado». */
    this.isScannerLike = false;
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

    if (ClubWalletLectura.esCodigo(code)) { await this.clientePorTarjeta(code); return; }

    if (scannerLike || code.length >= this.BARCODE_MIN_LEN) {
      await this.addByBarcode(code);
    } else {
      await this.addByPartNumber(code);
    }
  }

  private async addByPartNumber(code: string) { await this.buscarPorCodigo(code); }

  private async addByBarcode(code: string) { await this.buscarPorCodigo(code); }

  /**
   * Busca lo leído o tecleado por código de barras y por No. de parte, sin
   * importar cómo llegó. Si no está, recarga el catálogo UNA vez (un producto
   * dado de alta con la caja abierta no estaba en la copia en memoria) y
   * vuelve a buscar antes de decir que no existe.
   */
  private async buscarPorCodigo(code: string) {
    const key = (code || '').trim().toLowerCase();
    if (!key) return;

    await this.catalog.load();
    const buscar = () => this.catalog.findByBarcode(key) ?? this.catalog.findByPartNumber(key);
    let p = buscar();
    if (!p) { await this.catalog.load(true); p = buscar(); }

    if (!p) {
      await Swal.fire({
        icon: 'warning',
        title: 'No encontrado',
        text: `No hay un producto con el código ${code}`,
        timer: 1200,
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

    const before=this.totalVenta;
    try{await this.commercial.prepare(this.cart.activeCart(),true);}catch(e){await Swal.fire({icon:'error',title:'Revisa la cuenta',text:(e as Error).message});return;}
    if(Math.abs(before-this.totalVenta)>.001){await Swal.fire({icon:'info',title:'Cambió el total',text:'Revisa el importe antes de iniciar el cobro en terminal.'});return;}
    let orderId: string | null = null;
    try {
      const createResp = await api.mpCreateOrder({
        amount: this.totalVenta,
        commercialQuote:this.cart.activeCart().commercial?.quote?.id,
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
    /* Igual que en el cobro normal: la orden se lee antes, porque `checkout`
       cierra la cuenta activa. */
    const orden = this.ordenServicio;
    const mesa = this.mesaSvc.cuentaActiva();

    const res = await this.sale.checkout({ method: 'TERMINAL_MP' }, {
      mpOrderId:orderId,
      openDrawer: false, // pago con tarjeta: no se abre el cajon
      autoPrint: this.imprimirAlCobrar,
    });

    if (!res.ok) {
      await Swal.fire({
        icon: 'error',
        title: 'Pago aprobado, pero no se registró la venta',
        text: `${res.error || 'Revisa la conexión a la base de datos.'} Orden MP: ${orderId}`
      });
      return;
    }

    if (orden) await this.enlazarOrdenDeServicio(res.saleId ?? null, orden);
    await this.cerrarMesa(mesa, res.saleId ?? null);
    await preguntarCajonVoucher(this.sale, ['TERMINAL_MP']);

    this.paymentMethod = 'TERMINAL_MP';
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
  /* El dominio del cliente es el mismo que en Touch (ClientesVentaService y
     MesaService.fijarCliente): aqui solo cambia como se pinta. */
  async abrirModalClientes() {
    this.filtroClientes = '';
    const r = await this.clientesSvc.listar();
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No disponible', text: r.error }); return; }
    this.clientesGenerales = r.datos;
    this.showModalClientes = true;
  }

  coincideCliente(c: CartCustomer): boolean {
    return ClientesVentaService.coincide(c, this.filtroClientes);
  }

  cerrarModalClientes() {
    this.showModalClientes = false;
  }

  /** 0066 · En el buscador de clientes también se puede leer la tarjeta del Club. */
  async buscarClienteEnter() {
    if (ClubWalletLectura.esCodigo(this.filtroClientes)) {
      const codigo = this.filtroClientes;
      this.filtroClientes = '';
      await this.clientePorTarjeta(codigo);
    }
  }

  /**
   * 0066 · Se leyó la tarjeta del Club (Apple/Google Wallet): su cliente queda
   * en la cuenta, igual que si se hubiera buscado por teléfono.
   */
  private async clientePorTarjeta(codigo: string) {
    const r = await ClubWalletLectura.cliente(codigo, this.clientesSvc);
    if (!r.ok) { await Swal.fire({ icon: 'warning', title: 'Tarjeta del Club', text: r.error }); return; }
    await this.seleccionarCliente(r.cliente);
  }

  async seleccionarCliente(cliente: CartCustomer) {
    const r = await this.mesaSvc.fijarCliente(cliente);
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se asignó', text: r.error }); return; }
    this.cerrarModalClientes();
  }

  async quitarCliente() {
    const r = await this.mesaSvc.fijarCliente(null);
    if (!r.ok) await Swal.fire({ icon: 'error', title: 'No se quitó', text: r.error });
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
    /* Los que no pueden llevar fiado siguen en la lista, desactivados y con
       su motivo: la caja sabe POR QUE, en vez de no encontrar al cliente. */
    return this.creditCustomers.map(c => ({
      valor: c.id,
      etiqueta: c.customerName,
      nota: c.block
        ? MOTIVO_CREDITO[c.block]
        : 'Disp.: ' + c.availableCredit.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
          + (c.riskLevel === 2 ? ' · riesgo medio' : ''),
      busca: [c.phone, c.email].filter(Boolean).join(' '),
      desactivada: !!c.block,
    }));
  }
}
