import { Component, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { TecladoPantalla } from './teclado';
import { RegisterService } from '../services/register.service';
import {
  CapabilityService, CartLine, CartService, CustomerDisplayService, LoyaltyAward, MenuCatalogService,
  MenuProduct, ModifierGroup, ModifierOption, PaymentMethod, SaleService,
  SelectedOption, ServiceMode, ShiftService,
} from '../core';
import { PremiosVenta } from '../loyalty/premios-venta';
import { CuponVenta } from '../loyalty/cupon-venta';
import {
  Elegida, admiteCantidad, cabeOtra, faltanPorElegir, gruposPendientes,
  maximoCantidad, opcionesElegibles, resumenDeOpciones, topeDeGrupo,
  unidadesElegidas,
} from '../core/opciones';

/*
 * WYBIX TOUCH POS
 *
 * Presentacion nueva sobre el MISMO Core: el carrito es CartService, la venta
 * es SaleService.checkout() (el unico camino), el turno es ShiftService y la
 * pantalla de cliente se alimenta sola. Aqui no hay logica de venta.
 *
 * Ergonomia tactil: objetivos de 44 px minimo y 56 px en las acciones
 * principales, sin hover, sin clic derecho, sin teclado fisico obligatorio.
 * Los mensajes se muestran en la propia pantalla (no hay dialogos del
 * sistema que obliguen a apuntar con un raton).
 */

type Vista = 'menu' | 'cobro';

interface Aviso {
  texto: string;
  tipo: 'error' | 'ok';
}

@Component({
  selector: 'app-touch-pos',
  standalone: true,
  imports: [CommonModule, FormsModule, TecladoPantalla, PremiosVenta, CuponVenta],
  templateUrl: './touch-pos.html',
  styleUrls: ['./touch-pos.css'],
})
export class TouchPos implements OnInit, OnDestroy {
  /** Si este negocio tiene Servicios encendido. Decide si la agenda existe. */
  readonly caps = inject(CapabilityService);

  private readonly menu = inject(MenuCatalogService);
  private readonly cart = inject(CartService);
  private readonly sale = inject(SaleService);
  private readonly shift = inject(ShiftService);
  private readonly display = inject(CustomerDisplayService);
  private readonly auth = inject(AuthService);
  private readonly registro = inject(RegisterService);
  private readonly router = inject(Router);

  /** A la agenda del día, que en Touch es la pantalla de Servicios. */
  aServicios() { void this.router.navigate(['/touch/servicios']); }

  vista = signal<Vista>('menu');
  categoriaSel = signal<number | null>(null);
  buscando = signal(false);
  termino = signal('');
  aviso = signal<Aviso | null>(null);
  private avisoTimer: any;

  // -------------------------------------------------------------- catalogo
  readonly cargando = this.menu.loading;
  readonly errorCatalogo = this.menu.error;
  readonly categorias = this.menu.categories;

  readonly productos = computed(() => {
    const t = this.termino().trim();
    if (t) return this.menu.search(t);
    return this.menu.productsOf(this.categoriaSel());
  });

  // ---------------------------------------------------------------- carrito
  readonly lineas = this.cart.lines;
  readonly totales = this.cart.totals;
  readonly cuentas = this.cart.carts;
  readonly cuentaActiva = this.cart.activeCartId;
  readonly serviceMode = computed(() => { this.cart.version(); return this.cart.activeCart().serviceMode; });

  readonly hayTurno = computed(() => this.shift.shift().open);

  // ----------------------------------------------------------- modificadores
  /** El teclado en pantalla se abre bajo demanda, no ocupa sitio siempre. */
  tecladoNota = signal(false);

  hoja = signal<MenuProduct | null>(null);
  grupos = signal<ModifierGroup[]>([]);
  /** grupo -> opciones elegidas. */
  seleccion = signal<Map<number, ModifierOption[]>>(new Map());
  cantidadHoja = signal(1);
  notaHoja = signal('');

  /**
   * El precio de la hoja, con la CANTIDAD de cada extra.
   *
   * Multiplicar por la cantidad no es un detalle estetico: `sp_register_sale`
   * recalcula este mismo numero con los `price_delta` de la configuracion y
   * rechaza la venta si no coincide. Sumar dos shots y cobrar uno terminaria
   * en "el precio no coincide con sus opciones" al cobrar.
   */
  readonly precioHoja = computed(() => {
    const p = this.hoja();
    if (!p) return 0;
    let precio = Number(p.price);
    for (const [gid, opts] of this.seleccion()) {
      const g = this.grupos().find(x => x.id === gid);
      const conCantidad = !!g && admiteCantidad(g);
      for (const o of opts) {
        precio += Number(o.price_delta || 0) * (conCantidad ? (this.cantidades().get(o.id) || 1) : 1);
      }
    }
    return precio * this.cantidadHoja();
  });

  /** Grupos obligatorios que aun no tienen eleccion. */
  /* La regla vive en `core/opciones.ts`, compartida con Retail. Estaba escrita
     solo aqui, y por eso Retail no la tenia: anadia sus lineas sin variante y
     las ventas de productos con receta por tamano se rechazaban diciendo que
     no habia receta. Una sola regla, dos pantallas. */
  readonly faltantes = computed(() => faltanPorElegir(this.grupos(), this.seleccion()));

  readonly puedeAgregar = computed(() => this.faltantes().length === 0);

  // ------------------------------------------------------------------ cobro
  metodo = signal<PaymentMethod>('EFECTIVO');
  recibido = signal<string>('');
  cobrando = signal(false);

  readonly recibidoNum = computed(() => Number(this.recibido() || 0));
  readonly cambio = computed(() => Math.max(0, this.recibidoNum() - this.totales().total));
  readonly alcanza = computed(() => this.metodo() !== 'EFECTIVO' || this.recibidoNum() >= this.totales().total);

  /** Sugerencias de billete: el importe exacto y los redondeos utiles. */
  readonly sugerencias = computed(() => {
    const t = this.totales().total;
    if (t <= 0) return [];
    const base = [Math.ceil(t), 50, 100, 200, 500, 1000];
    return [...new Set(base.filter(v => v >= t))].sort((a, b) => a - b).slice(0, 4);
  });

  private offBarcode: (() => void) | null = null;

  async ngOnInit() {
    // Identidad de caja de esta maquina. Sin esto la venta viajaria sin
    // register_id y SQL la asignaria a la primera caja: en una sucursal con
    // varias cajas, el turno y el corte quedarian en la caja equivocada.
    // Retail lo carga desde el Dashboard; Touch no pasa por el.
    await this.registro.load();
    // FORZADO: el catalogo trae el stock, y el stock cambia fuera de esta
    // pantalla -se edita en Inventario, entra por una compra, lo consume otra
    // caja-. `load()` sin forzar corta en cuanto hay productos en memoria, asi
    // que se leia UNA vez por sesion: se corregia el inventario, se volvia a
    // Touch y el producto seguia diciendo "Agotado" hasta reiniciar la app.
    await this.menu.load(true);

    // Si esta caja no tiene turno, se pide abrirlo AL ENTRAR, con la misma
    // hoja que abre el boton de la barra. Antes solo se avisaba al llegar al
    // cobro: el cajero montaba la cuenta entera para descubrir ahi que no
    // podia cobrarla. Retail ya lo pedia al entrar; esto lo iguala.
    // La hoja se puede cerrar para mirar el menu: lo que no se puede es
    // cobrar, y de eso se encarga `irACobro`.
    if (!(await this.shift.refresh())) this.abrirTurno.set(true);

    const api = (window as any).electronAPI;
    if (api?.onBarcodeScan) {
      const off = api.onBarcodeScan((payload: any) => {
        const code = String(payload?.code || '').trim();
        if (!code) return;
        this.porCodigo(code);
      });
      this.offBarcode = typeof off === 'function' ? off : null;
    }
  }

  ngOnDestroy() {
    try { this.offBarcode?.(); } catch { /* noop */ }
    this.offBarcode = null;
    clearTimeout(this.avisoTimer);
  }

  /** Scanner fisico: sigue funcionando aunque no haya teclado a la vista. */
  private porCodigo(code: string) {
    const p = this.menu.findByBarcode(code);
    if (!p) { this.mostrar(`Sin coincidencia para ${code}`, 'error'); return; }
    this.tocar(p);
  }

  private mostrar(texto: string, tipo: Aviso['tipo'] = 'error') {
    this.aviso.set({ texto, tipo });
    clearTimeout(this.avisoTimer);
    this.avisoTimer = setTimeout(() => this.aviso.set(null), tipo === 'ok' ? 1800 : 3200);
  }

  // ============================================================ CATALOGO

  elegirCategoria(id: number | null) {
    this.categoriaSel.set(id);
    this.termino.set('');
    this.buscando.set(false);
  }

  alternarBusqueda() {
    const b = !this.buscando();
    this.buscando.set(b);
    if (!b) this.termino.set('');
  }

  cerrarBusqueda() {
    this.buscando.set(false);
    this.termino.set('');
  }

  agotado(p: MenuProduct): boolean {
    return p.available_units <= 0;
  }

  /**
   * Por que no se puede vender. En una receta, "agotado" no dice nada util:
   * el producto no tiene existencias propias y quien esta en la barra no puede
   * adivinar cual de los ingredientes falta ni cuanto. Se nombra el que se
   * acaba primero y se dan las dos cifras.
   */
  porQueAgotado(p: MenuProduct): string {
    if (p.inventory_mode === 'RECIPE' && p.limita_nombre) {
      const hay = `${p.limita_stock ?? 0} ${p.limita_uom ?? ''}`.trim();
      const pide = `${p.limita_necesita ?? 0} ${p.limita_uom ?? ''}`.trim();
      return `Falta ${p.limita_nombre}: hay ${hay} y cada uno lleva ${pide}`;
    }
    return `${p.product_name} está agotado`;
  }

  pocas(p: MenuProduct): boolean {
    return p.available_units > 0 && p.available_units <= 5;
  }

  /**
   * Si tiene sentido poner un numero en la tarjeta.
   *
   * Un producto sin inventario (NONE) llega con 999999 de centinela: no se
   * cuenta y escribirlo seria ruido.
   */
  hayCuenta(p: MenuProduct): boolean {
    return p.inventory_mode !== 'NONE' && Number(p.available_units) < 999999;
  }

  /**
   * Cuantas se pueden despachar. En una receta son las que alcanzan los
   * ingredientes -con conversion y merma-, no su stock propio, que es 0.
   */
  disponibles(p: MenuProduct): number {
    return Math.max(0, Math.floor(Number(p.available_units) || 0));
  }

  /** Iniciales discretas para el mosaico cuando el producto no tiene imagen. */
  iniciales(p: MenuProduct): string {
    return p.product_name.split(/\s+/).slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase();
  }

  /**
   * Icono del mosaico cuando el producto no tiene foto.
   *
   * Sale del modo de inventario, que es un dato del dominio, no de adivinar
   * por el nombre: una receta se ve como receta y un servicio como servicio,
   * sin heuristicas de texto.
   */
  icono(p: MenuProduct): string {
    if (p.inventory_mode === 'RECIPE') return 'ph-cooking-pot';
    if (p.inventory_mode === 'NONE') return 'ph-hand-heart';
    return 'ph-package';
  }

  /** Etiqueta corta del grupo para la hoja de opciones. */
  reglaGrupo(g: ModifierGroup): string {
    if (g.required || g.min_select > 0) return 'Obligatorio';
    if (g.max_select > 1) return `Hasta ${g.max_select}`;
    return 'Opcional';
  }

  /**
   * Un toque en el producto.
   *
   * Sin opciones obligatorias entra directo al carrito: es el caso comun del
   * mostrador y no debe costar dos toques.
   */
  tocar(p: MenuProduct) {
    if (this.agotado(p)) { this.mostrar(this.porQueAgotado(p)); return; }
    if (this.menu.needsChoice(p)) { this.abrirHoja(p); return; }
    this.agregar(p, 1, [], null);
    this.mostrar(`${p.product_name} agregado`, 'ok');
  }

  /** Toque largo o boton de opciones: abre la hoja aunque no sea obligatoria. */
  abrirHoja(p: MenuProduct) {
    this.hoja.set(p);
    this.grupos.set(this.menu.groupsOf(p.id));
    this.cantidadHoja.set(1);
    this.notaHoja.set('');
    // Preselecciona lo obligatorio de un solo valor: menos toques.
    const sel = new Map<number, ModifierOption[]>();
    // Los grupos que se resuelven solos (obligatorio, unico, una sola opcion).
    for (const p of gruposPendientes(this.grupos())) {
      if (p.automatico) sel.set(p.grupo.id, [opcionesElegibles(p.grupo)[0]]);
    }
    this.seleccion.set(sel);
  }

  cerrarHoja() {
    this.cantidades.set(new Map());
    this.tecladoNota.set(false);
    this.hoja.set(null);
    this.grupos.set([]);
    this.seleccion.set(new Map());
  }

  elegido(g: ModifierGroup, o: ModifierOption): boolean {
    return (this.seleccion().get(g.id) || []).some(x => x.id === o.id);
  }

  /**
   * Lo elegido de un grupo, con su cantidad.
   *
   * La seleccion y las cantidades viven en dos mapas distintos -uno por grupo,
   * otro por opcion- y la regla del tope necesita verlos juntos.
   */
  private elegidasDe(g: ModifierGroup): Elegida[] {
    const conCantidad = admiteCantidad(g);
    return (this.seleccion().get(g.id) || []).map(o => ({
      optionId: o.id,
      quantity: conCantidad ? (this.cantidades().get(o.id) || 1) : 1,
    }));
  }

  /**
   * Alterna una opcion respetando el tope del grupo, contado en UNIDADES.
   *
   * Antes se comparaba `actuales.length` contra `max_select`, es decir nombres
   * distintos contra un tope de unidades. Con `max_select = 3` eso dejaba
   * entrar Espresso x3 + Azucar x3, nueve shots en un vaso.
   *
   * Y el tope se leia crudo: si `max_select` llegaba sin valor, `undefined`
   * no era 1 ni era mayor que la cuenta, asi que la segunda opcion del grupo
   * ni sustituia ni se anadia. Se quedaba bloqueado sin decir por que.
   */
  alternarOpcion(g: ModifierGroup, o: ModifierOption) {
    if (o.available_units <= 0) { this.mostrar(`${o.name} no está disponible`); return; }
    const tope = topeDeGrupo(g);
    this.seleccion.update(mapa => {
      const n = new Map(mapa);
      const actuales = [...(n.get(g.id) || [])];
      const idx = actuales.findIndex(x => x.id === o.id);

      if (idx >= 0) {
        // Quitarla siempre se puede, y con ella su cantidad.
        actuales.splice(idx, 1);
        this.cantidades.update(c => { const m = new Map(c); m.delete(o.id); return m; });
      } else if (tope <= 1) {
        // Eleccion unica: elegir sustituye.
        for (const x of actuales) {
          this.cantidades.update(c => { const m = new Map(c); m.delete(x.id); return m; });
        }
        actuales.length = 0;
        actuales.push(o);
      } else if (cabeOtra(g, this.elegidasDe(g), o.id)) {
        actuales.push(o);
      } else {
        this.mostrar(`Máximo ${tope} en ${g.name}`);
        return mapa;
      }
      n.set(g.id, actuales);
      return n;
    });
  }

  masHoja(delta: number) {
    this.cantidadHoja.update(q => Math.max(1, q + delta));
  }

  /* ------------------------------------------------------ cantidad por extra
     Dos shots son dos shots: suman 2 x 30 g de cafe y 2 x $10. Sin esto, un
     extra solo se podia pedir una vez y "doble shot" habia que configurarlo
     como una opcion aparte, con su propia cantidad duplicada a mano.

     Solo tiene sentido donde el efecto SUMA consumo: no existe "dos veces sin
     azucar" ni "dos tamanos". */
  cantidades = signal<Map<number, number>>(new Map());

  admiteCantidad(g: ModifierGroup): boolean { return admiteCantidad(g); }
  maximoDe(g: ModifierGroup): number { return maximoCantidad(g); }

  cantidadDe(o: ModifierOption): number { return this.cantidades().get(o.id) || 1; }

  /**
   * Sube o baja la cantidad de una opcion ya elegida.
   *
   * El tope es del GRUPO y se cuenta en unidades: con maximo 3 y Azucar x1 ya
   * puesto, Espresso llega hasta 2. Antes cada opcion se topaba por separado
   * contra el mismo maximo, asi que tres opciones podian llegar a nueve.
   */
  cambiarCantidad(g: ModifierGroup, o: ModifierOption, delta: number) {
    if (!this.elegido(g, o)) return;
    const actual = this.cantidadDe(o);

    if (delta > 0) {
      // Lo que cabe ademas de lo que ya hay puesto, esta opcion incluida.
      const otras = this.elegidasDe(g).filter(e => e.optionId !== o.id);
      const libre = topeDeGrupo(g) - unidadesElegidas(otras) - actual;
      if (libre <= 0) { this.mostrar(`Máximo ${topeDeGrupo(g)} en ${g.name}`); return; }
    }

    const nueva = Math.max(1, actual + delta);
    this.cantidades.update(m => { const n = new Map(m); n.set(o.id, nueva); return n; });
  }

  /** Lo que suman las opciones elegidas, para verlo antes de agregar. */
  readonly extraHoja = computed(() => {
    let total = 0;
    for (const g of this.grupos()) {
      for (const o of (this.seleccion().get(g.id) || [])) {
        total += Number(o.price_delta || 0) * (this.cantidades().get(o.id) || 1);
      }
    }
    return total;
  });

  /** Resumen de la linea del carrito, con su precio por extra. */
  resumenOpciones(l: CartLine) { return resumenDeOpciones(l.options); }

  /**
   * Avisa si la combinacion elegida no alcanza, nombrando el ingrediente.
   *
   * El catalogo dice si el producto se puede ofrecer -receta base-; esto dice
   * si ESTA combinacion se puede preparar. Un latte puede estar disponible y
   * la leche de almendra que eligio el cliente estar agotada.
   */
  private async alcanzaLaSeleccion(productId: number, opciones: SelectedOption[]): Promise<boolean> {
    const hosp = (window as any).wybix;
    if (typeof hosp?.catalog?.disponibilidad !== 'function') return true;
    try {
      const rs = await hosp.catalog.disponibilidad({
        productId,
        options: opciones.map(o => ({ optionId: o.optionId, quantity: o.quantity })),
      });
      const d = rs?.data;
      if (!rs?.success || !d) return true;
      if (Number(d.disponible) > 0) return true;
      this.mostrar(d.motivo || 'No hay existencias para esta combinación');
      return false;
    } catch (e) {
      // La venta vuelve a validar dentro de su transaccion: esto es UX.
      console.error('[TOUCH] No se pudo consultar la disponibilidad:', e);
      return true;
    }
  }

  confirmarHoja() {
    const p = this.hoja();
    if (!p) return;
    if (!this.puedeAgregar()) {
      this.mostrar(`Falta elegir ${this.faltantes()[0].name}`);
      return;
    }
    const opciones: SelectedOption[] = [];
    for (const g of this.grupos()) {
      for (const o of (this.seleccion().get(g.id) || [])) {
        opciones.push({
          groupId: g.id, optionId: o.id, groupName: g.name, optionName: o.name,
          priceDelta: Number(o.price_delta || 0),
          quantity: this.admiteCantidad(g) ? this.cantidadDe(o) : 1,
        });
      }
    }

    // Con la seleccion completa se pregunta si ALCANZA, antes de meterla al
    // carrito. Asi el mensaje nombra el ingrediente que falta en vez de
    // fallar al cobrar con un error generico.
    this.alcanzaLaSeleccion(p.id, opciones).then(ok => {
      if (!ok) return;
      this.agregar(p, this.cantidadHoja(), opciones, this.notaHoja().trim() || null);
      this.cerrarHoja();
      this.mostrar(`${p.product_name} agregado`, 'ok');
    });
  }

  private agregar(p: MenuProduct, qty: number, opciones: SelectedOption[], nota: string | null) {
    const linea = this.cart.addProduct({
      productId: p.id,
      productName: p.product_name,
      unitPrice: Number(p.price),
      claveProdServ: p.clave_prod_serv ?? null,
      claveUnidad: p.clave_unidad ?? null,
      objetoImpuesto: p.objeto_impuesto ?? null,
      tasaIva: p.tasa_iva ?? null,
      inventoryMode: p.inventory_mode,
    }, qty, opciones);
    if (nota) linea.note = nota;
    // La disponibilidad mostrada baja al instante; el stock real lo valida SQL.
    this.menu.consumeEstimate(p.id, qty);
  }

  // ============================================================== CARRITO

  mas(l: CartLine, delta: number) {
    if (l.qty + delta <= 0) { this.cart.removeLine(l); return; }
    this.cart.adjustQty(l, delta);
  }

  quitar(l: CartLine) {
    this.cart.removeLine(l);
  }

  vaciar() {
    if (!this.lineas().length) return;
    this.cart.clearActive();
  }

  nuevaCuenta() {
    if (!this.cart.createCart()) this.mostrar(`Máximo ${CartService.MAX_CARTS} cuentas abiertas`);
  }

  cambiarCuenta(id: number) {
    this.cart.switchTo(id);
  }

  etiquetaCuenta(id: number, i: number): string {
    return `Cuenta ${i + 1}`;
  }

  itemsDe(c: { lines: CartLine[] }): number {
    return c.lines.reduce((a, l) => a + l.qty, 0);
  }

  fijarServicio(m: ServiceMode) {
    this.cart.setServiceMode(this.serviceMode() === m ? null : m);
  }

  // ================================================================ COBRO

  async irACobro() {
    if (!this.lineas().length) { this.mostrar('Agrega productos antes de cobrar'); return; }
    const ok = await this.shift.ensureOpen();
    if (!ok) { this.mostrar('Abre el turno de esta caja antes de vender'); return; }
    this.recibido.set('');
    this.metodo.set('EFECTIVO');
    this.vista.set('cobro');
  }

  volverAlMenu() {
    this.vista.set('menu');
  }

  /** Teclado numerico propio: no depende del teclado del sistema. */
  tecla(t: string) {
    if (t === 'C') { this.recibido.set(''); return; }
    if (t === '<') { this.recibido.update(v => v.slice(0, -1)); return; }
    if (t === '.') {
      this.recibido.update(v => (v.includes('.') ? v : (v || '0') + '.'));
      return;
    }
    this.recibido.update(v => {
      const n = v + t;
      // Dos decimales como maximo: es dinero.
      if (/\.\d{3,}$/.test(n)) return v;
      return n.length > 9 ? v : n;
    });
  }

  usarSugerencia(v: number) {
    this.recibido.set(String(v));
  }

  elegirMetodo(m: PaymentMethod) {
    this.metodo.set(m);
    if (m !== 'EFECTIVO') this.recibido.set('');
  }

  async confirmar() {
    if (this.cobrando()) return;
    if (!this.alcanza()) { this.mostrar('El importe recibido no alcanza'); return; }
    this.cobrando.set(true);
    try {
      const res = await this.sale.checkout({
        method: this.metodo(),
        received: this.metodo() === 'EFECTIVO' ? this.recibidoNum() : null,
      }, {
        openDrawer: this.metodo() === 'EFECTIVO',
        autoPrint: true,
      });

      if (!res.ok) { this.mostrar(res.error || 'No se pudo registrar la venta'); return; }

      const cambio = res.change ?? 0;
      this.ultimoCambio.set(cambio);
      this.ultimoFolio.set(res.saleId ?? null);
      this.vista.set('menu');
      this.recibido.set('');
      // El catalogo cambio: se recarga en segundo plano para refrescar
      // existencias y disponibilidad derivada.
      this.menu.load(true);
      this.mostrarCambio.set(true);
      setTimeout(() => this.mostrarCambio.set(false), cambio > 0 ? 6000 : 2500);
      // Los premios se pintan encima del aviso de cambio: en Touch el
      // cliente esta delante de la caja y es AHORA cuando hay que decirselo.
      this.premiosUltimaVenta.set(res.premios ?? []);
      // Un canje fallido NO se calla: el cliente ya se llevo el beneficio.
      if (res.cupon && !res.cupon.ok) this.mostrar(`Cupón: ${res.cupon.mensaje}`, 'error');
    } finally {
      this.cobrando.set(false);
    }
  }

  ultimoCambio = signal(0);
  ultimoFolio = signal<number | null>(null);
  /** Lo que gano la ultima venta, si Fidelizacion esta encendida. */
  premiosUltimaVenta = signal<LoyaltyAward[]>([]);
  cerrarPremios() { this.premiosUltimaVenta.set([]); }
  mostrarCambio = signal(false);

  cerrarCambio() { this.mostrarCambio.set(false); }

  async imprimirUltimo() {
    const folio = this.ultimoFolio();
    if (!folio) return;
    await this.sale.printTicket(folio, { silent: true, paymentMethod: this.metodo() });
    this.mostrar('Ticket enviado', 'ok');
  }

  // ------------------------------------------------------------- turno/salida
  abrirTurno = signal(false);
  fondo = signal('');

  /** Mismo teclado numerico que el cobro: la caja no necesita uno fisico. */
  teclaFondo(t: string) {
    if (t === '<') { this.fondo.update(v => v.slice(0, -1)); return; }
    if (t === '.') { this.fondo.update(v => (v.includes('.') ? v : (v || '0') + '.')); return; }
    this.fondo.update(v => {
      const n = v + t;
      if (/\.\d{3,}$/.test(n)) return v;
      return n.length > 9 ? v : n;
    });
  }

  async confirmarTurno() {
    const r = await this.shift.open(Number(this.fondo() || 0), null);
    if (!r.ok) { this.mostrar(r.error || 'No se pudo abrir el turno'); return; }
    this.abrirTurno.set(false);
    this.fondo.set('');
    this.mostrar('Turno abierto', 'ok');
  }

  salir() {
    this.router.navigate(['/dashboard/estadisticas']);
  }

  /** Escape cierra lo que este abierto: util con teclado conectado. */
  @HostListener('window:keydown.escape')
  onEsc() {
    if (this.hoja()) { this.cerrarHoja(); return; }
    if (this.vista() === 'cobro') { this.volverAlMenu(); return; }
    if (this.buscando()) this.alternarBusqueda();
  }
}
