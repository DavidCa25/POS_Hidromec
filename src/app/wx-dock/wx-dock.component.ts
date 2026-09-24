import {
  ChangeDetectionStrategy, Component, HostListener, Input, OnDestroy, OnInit,
  computed, signal,
} from '@angular/core';
import { NgClass, NgFor, NgIf } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { Subscription, filter } from 'rxjs';
import { AuthService, PAQUETES } from '../../services/auth.service';
import { ModulesService, ModulesState } from '../../services/modules.service';
import { CapabilityService, GiroServiciosService } from '../../core';
import { WxMascotaComponent } from '../wx-mascota/wx-mascota.component';
import { PaletaService } from '../wx-paleta/paleta.service';
import { GuiaService } from '../wx-guia/guia.service';
import { WxGuiaComponent } from '../wx-guia/wx-guia.component';

/**
 * WX-DOCK — la barra de trabajo de Wybix.
 *
 * Sustituye al rail lateral. No es el mismo menu movido abajo: es otro modelo.
 *
 * ================================================================
 * EL MODELO: SEIS AREAS, Y CADA UNA SE ABRE
 * ================================================================
 * El rail tenia veintiuna entradas en una columna. Encontrar algo obligaba a
 * LEER la lista entera, porque veintiuna etiquetas apiladas no se escanean: se
 * leen. Y ocupaba 250 px de ancho permanentes en pantallas donde lo que falta
 * siempre es ancho de tabla.
 *
 * Aqui hay seis areas, y cada una es un DOMINIO del negocio -no una pantalla-
 * que al abrirse ensena lo que tiene dentro: su destino principal, sus
 * subsecciones y, cuando aporta, su estado.
 *
 * ABRIR NO DEPENDE DEL RATON
 * --------------------------
 * La primera version abria el panel solo al pasar el cursor. Eso tenia dos
 * problemas, y el segundo es el grave:
 *
 *   1. Al mover el raton hacia una opcion se cruzaba el hueco entre el boton y
 *      el panel, se perdia el hover y el panel se cerraba a medio camino.
 *   2. En una pantalla tactil NO HAY CURSOR, asi que la mitad de la navegacion
 *      sencillamente no existia.
 *
 * Ahora el panel tiene dos formas de abrirse y una sola de comportarse:
 *
 *   PASAR EL CURSOR   lo asoma (solo con raton fino). Se cierra al salir.
 *   PULSAR / TOCAR    lo FIJA. Se queda hasta Escape o un clic fuera.
 *   TECLADO           Enter o espacio sobre el area lo fija igual.
 *
 * El hover es una comodidad; el clic es el contrato. Nada que se pueda hacer
 * con el raton deja de poderse hacer con el dedo.
 *
 * NADA VIVE SOLO EN Ctrl+K
 * ------------------------
 * Ctrl+K es un acelerador, no el unico camino. Los veintiun destinos del rail
 * tienen todos un sitio al que se llega pulsando: unos son el destino
 * principal de un area, otros una subseccion suya, y el resto viven en «Mas».
 *
 * LOS PERMISOS SON LOS MISMOS
 * ---------------------------
 * Cada area y cada destino pregunta por el PAQUETE que exige la operacion a la
 * que lleva, exactamente igual que preguntaba el rail. El dock no puede
 * ofrecer lo que despues se rechaza ni esconder lo que si se permite, porque
 * son las mismas preguntas y no una copia suya.
 */

type Destino = {
  texto: string;
  ruta: string;
  icono: string;
  visible: boolean;
  /** Una linea de contexto bajo el nombre. Solo cuando aporta algo. */
  pie?: string;
  /** El destino principal del area: el que se abre con Enter. */
  principal?: boolean;
};

type Aviso = { texto: string; tono: 'peligro' | 'aviso' | 'ok' } | null;

type Area = {
  id: string;
  nombre: string;
  icono: string;
  /** El destino principal, al que llevan Ctrl+1..6. */
  ruta: string;
  /** Prefijo que marca el area como activa, aunque la ruta exacta sea otra. */
  raiz: string;
  tecla: string;
  visible: boolean;
  aviso: Aviso;
  destinos: Destino[];
};

/**
 * Lo que tarda el panel en cerrarse al salir el cursor.
 *
 * No es una animacion: es la tolerancia del recorrido. Un trayecto en diagonal
 * del boton a una opcion del borde roza el aire de al lado, y sin esta pausa
 * el panel se cierra en ese roce. 220 ms es suficiente para cubrirlo y
 * demasiado poco para que se note como pereza.
 */
const GRACIA = 220;

@Component({
  selector: 'wx-dock',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, RouterLink, RouterLinkActive, WxMascotaComponent, WxGuiaComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './wx-dock.component.html',
  styleUrls: ['./wx-dock.component.css'],
})
export class WxDockComponent implements OnInit, OnDestroy {
  /** Cifras y avisos de los paneles. Vacios hasta que llegan; nunca inventados. */
  private readonly datos = signal<Record<string, { aviso: Aviso; pies: Record<string, string> }>>({});

  /** El area cuyo panel esta a la vista, y si se quedo fijado con un clic. */
  readonly panel = signal<string | null>(null);
  readonly fijado = signal(false);

  readonly crearAbierto = signal(false);
  readonly masAbierto = signal(false);

  /** «Mas acciones» dentro del boton de crear. */
  readonly crearTodo = signal(false);

  private cierre: any = null;

  /* Signal y no campo suelto: de esto dependen las listas de abajo, y una
     lista que depende de un campo mudo no se entera de que cambio. */
  readonly modulos = signal<ModulesState>({ pagoServicios: false });
  private modSub?: Subscription;

  /* DONDE ESTAMOS, COMO SIGNAL.
     Leer `router.url` dentro de la plantilla no bastaba: con OnPush, navegar
     no dispara por si mismo una revision de este componente, asi que el area
     iluminada se quedaba en la anterior. */
  private readonly ruta = signal('');
  private rutaSub?: Subscription;

  constructor(
    private router: Router,
    public auth: AuthService,
    public caps: CapabilityService,
    private modules: ModulesService,
    private giro: GiroServiciosService,
    private paleta: PaletaService,
    public guia: GuiaService,
  ) {}

  ngOnInit(): void {
    this.modSub = this.modules.mods$.subscribe(m => this.modulos.set(m));
    this.ruta.set(this.router.url);
    this.rutaSub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(e => { this.ruta.set(e.urlAfterRedirects); this.cerrarTodo(); });
    void this.cargarDatos();
    /* La guia lee lo suyo una vez y lo comparte con el dock y con Inicio. */
    void this.guia.cargar();
  }

  ngOnDestroy(): void {
    this.modSub?.unsubscribe();
    this.rutaSub?.unsubscribe();
    clearTimeout(this.cierre);
  }

  // ------------------------------------------------------------- permisos
  // Las mismas preguntas que hacia el rail. Si aqui se copiaran con otro
  // nombre, el dia que cambie un paquete cambiarian por separado.
  get verNumeros() { return this.auth.puede(PAQUETES.REPORTES_VER); }
  get supervisarVentas() { return this.auth.puede(PAQUETES.VENTAS_SUPERVISAR); }
  get operarVentas() { return this.auth.puede(PAQUETES.VENTAS_OPERAR); }
  get operarInventario() { return this.auth.puede(PAQUETES.INVENTARIO_OPERAR); }
  get administrarNegocio() { return this.auth.puede(PAQUETES.CONFIGURACION_ADMINISTRAR); }
  get operarServicios() {
    return this.auth.puede(PAQUETES.SERVICIOS_OPERAR) || this.auth.puede(PAQUETES.SERVICIOS_ADMINISTRAR);
  }
  get administrarServicios() { return this.auth.puede(PAQUETES.SERVICIOS_ADMINISTRAR); }

  // ---------------------------------------------------------------- areas
  /**
   * Las seis areas, en el orden en que se dibujan.
   *
   * Compras es area propia y ya no cuelga de Inventario. Son dos trabajos
   * distintos -mirar lo que hay y traer lo que falta-, los hace muchas veces
   * gente distinta, y meter el segundo dentro del primero obligaba a entrar a
   * Inventario para registrar una compra.
   */
  readonly areas = computed<Area[]>(() => {
    const d = this.datos();
    const dato = (id: string) => d[id] ?? { aviso: null, pies: {} };
    const pie = (id: string, clave: string) => dato(id).pies[clave];

    const lista: Area[] = [
      {
        /*
         * INICIO NO ABRE PANEL: LLEVA A INICIO.
         *
         * Lo tuvo, con «Resumen del dia» como primera fila, y era un gesto de
         * mas para lo unico que la gente quiere de este boton. Un panel que
         * existe para que su primera opcion te lleve a donde ya decia el boton
         * no es navegacion, es un peaje.
         *
         * Alertas y Estadisticas son dominios propios y viven en «Mas», que es
         * primer nivel. Ademas la propia pantalla de Inicio enlaza a Alertas
         * desde cada pendiente, que es donde de verdad se necesitan.
         */
        id: 'inicio', nombre: 'Inicio', icono: 'ph-house', tecla: 'Ctrl 1',
        ruta: '/dashboard/inicio', raiz: '/dashboard/inicio', visible: true,
        aviso: dato('inicio').aviso,
        destinos: [
          { texto: 'Resumen del dia', ruta: '/dashboard/inicio', icono: 'ph-house', visible: true, principal: true },
        ],
      },
      {
        id: 'venta', nombre: 'Venta', icono: 'ph-cash-register', tecla: 'Ctrl 2',
        ruta: '/dashboard/venta', raiz: '/dashboard/venta', visible: this.operarVentas,
        aviso: dato('venta').aviso,
        destinos: [
          { texto: 'Nueva venta', ruta: '/dashboard/venta', icono: 'ph-cash-register', visible: true, principal: true, pie: pie('venta', 'turno') },
          { texto: 'Ventas realizadas', ruta: '/dashboard/tablaVenta', icono: 'ph-receipt', visible: this.supervisarVentas },
          { texto: 'Corte del dia', ruta: '/dashboard/corte-dia', icono: 'ph-calendar-check', visible: this.verNumeros },
          { texto: 'Abrir cajon', ruta: '/dashboard/abrir-cajon', icono: 'ph-vault', visible: this.supervisarVentas },
        ],
      },
      {
        id: 'inventario', nombre: 'Inventario', icono: 'ph-package', tecla: 'Ctrl 3',
        ruta: '/dashboard/inventario', raiz: '/dashboard/inventario', visible: this.operarInventario,
        aviso: dato('inventario').aviso,
        destinos: [
          { texto: 'Ver inventario', ruta: '/dashboard/inventario', icono: 'ph-package', visible: true, principal: true, pie: pie('inventario', 'stock') },
          { texto: 'Conteo fisico', ruta: '/dashboard/conteo', icono: 'ph-clipboard-text', visible: true },
          { texto: 'Recetas y modificadores', ruta: '/dashboard/recetas', icono: 'ph-cooking-pot', visible: this.caps.hospitality },
          { texto: 'Importar productos', ruta: '/dashboard/importador', icono: 'ph-file-arrow-up', visible: this.administrarNegocio },
        ],
      },
      {
        id: 'compras', nombre: 'Compras', icono: 'ph-shopping-bag-open', tecla: 'Ctrl 4',
        ruta: '/dashboard/registrarCompra', raiz: '/dashboard/registrarCompra',
        visible: this.operarInventario,
        aviso: dato('compras').aviso,
        destinos: [
          { texto: 'Registrar compra', ruta: '/dashboard/registrarCompra', icono: 'ph-bag', visible: true, principal: true },
          { texto: 'Compras registradas', ruta: '/dashboard/tablaCompra', icono: 'ph-table', visible: true },
          { texto: 'Proveedores', ruta: '/dashboard/proveedores', icono: 'ph-truck', visible: true, pie: pie('compras', 'proveedores') },
        ],
      },
      {
        id: 'servicios', nombre: 'Servicios', icono: 'ph-wrench', tecla: 'Ctrl 5',
        ruta: '/dashboard/ordenes-de-servicio', raiz: '/dashboard/ordenes-de-servicio',
        visible: this.operarServicios && this.caps.servicios,
        aviso: dato('servicios').aviso,
        /*
         * LAS SEIS PANTALLAS DEL MODULO, cada una por su nombre.
         *
         * En el rail eran UNA entrada a proposito: seis mas en una lista de
         * veintiuna la volvian ilegible. Dentro de su propio panel no compiten
         * con nada -solo se ven al abrir Servicios- y entonces esconderlas
         * obliga a entrar y buscar la pestana. La carcasa conserva sus
         * pestanas: esto es un atajo a ellas, no un segundo sitio.
         *
         * Agenda y Activos dependen del GIRO: un taller sin cita previa no
         * tiene agenda, y un servicio a domicilio no trabaja sobre un activo.
         */
        destinos: [
          /*
           * EL PRIMERO LO DECIDE EL GIRO, NO UNA CONSTANTE.
           *
           * Una barberia abre en la agenda porque su dia es la agenda; un
           * taller abre en ordenes porque su dia son las ordenes. Eso ya lo
           * resolvia la redireccion de la carcasa, y poner «Ordenes» fijo aqui
           * la saltaba: el dock mandaba a todo el mundo al mismo sitio.
           */
          ...(this.giro.inicio === 'agenda'
            ? [{ texto: 'Agenda', ruta: '/dashboard/ordenes-de-servicio/agenda', icono: 'ph-calendar-dots', visible: this.giro.usaAgenda, principal: true }]
            : []),
          { texto: 'Ordenes', ruta: '/dashboard/ordenes-de-servicio/ordenes', icono: 'ph-clipboard-text', visible: true, principal: this.giro.inicio !== 'agenda', pie: pie('servicios', 'ordenes') },
          { texto: 'Agenda', ruta: '/dashboard/ordenes-de-servicio/agenda', icono: 'ph-calendar-dots', visible: this.giro.usaAgenda && this.giro.inicio !== 'agenda' },
          { texto: this.giro.activoPlural, ruta: '/dashboard/ordenes-de-servicio/activos', icono: 'ph-car', visible: this.giro.usaActivos },
          { texto: 'Catalogo', ruta: '/dashboard/ordenes-de-servicio/catalogo', icono: 'ph-list-checks', visible: this.administrarServicios },
          { texto: 'Profesionales', ruta: '/dashboard/ordenes-de-servicio/profesionales', icono: 'ph-users-three', visible: this.administrarServicios },
          { texto: 'Comisiones', ruta: '/dashboard/ordenes-de-servicio/comisiones', icono: 'ph-percent', visible: this.verNumeros },
        ],
      },
      {
        id: 'clientes', nombre: 'Clientes', icono: 'ph-users', tecla: 'Ctrl 6',
        ruta: '/dashboard/clientes', raiz: '/dashboard/clientes', visible: this.operarVentas,
        aviso: dato('clientes').aviso,
        /*
         * Fidelizacion NO cuelga de aqui, aunque una campana vaya dirigida a
         * clientes. Ya vivio colgada de Inventario y costo encontrarla; si
         * ahora colgara de Clientes seria el mismo error con otro padre. Es un
         * dominio propio y vive en «Mas», que es primer nivel.
         */
        destinos: [
          { texto: 'Ver clientes', ruta: '/dashboard/clientes', icono: 'ph-users', visible: true, principal: true, pie: pie('clientes', 'saldo') },
        ],
      },
    ];

    return lista.filter(a => a.visible);
  });

  /** Solo se abre panel si el area tiene mas de un sitio al que ir. */
  destinosDe(a: Area): Destino[] { return a.destinos.filter(d => d.visible); }
  tienePanel(a: Area): boolean { return this.destinosDe(a).length > 1; }

  /**
   * «MAS» ES PRIMER NIVEL, NO UN CAJON DE SASTRE.
   *
   * Son dominios propios que no caben en las seis plazas del dock. Lo que vive
   * aqui no cuelga de NINGUN otro dominio, y por eso se puede encontrar sin
   * saber de antemano bajo que otra cosa lo guardaron. Es exactamente la
   * leccion que costo tres mudanzas.
   */
  readonly mas = computed<Destino[]>(() => {
    return [
      { texto: 'Alertas', ruta: '/dashboard/alertas', icono: 'ph-bell', visible: this.verNumeros },
      { texto: 'Estadisticas', ruta: '/dashboard/estadisticas', icono: 'ph-chart-line', visible: this.verNumeros },
      { texto: 'Fidelizacion', ruta: '/dashboard/fidelizacion', icono: 'ph-gift', visible: this.administrarNegocio && this.caps.loyalty },
      { texto: 'Facturacion', ruta: '/dashboard/facturacion', icono: 'ph-seal-check', visible: this.operarVentas },
      { texto: 'Pago de servicios', ruta: '/dashboard/servicios', icono: 'ph-device-mobile', visible: this.modulos().pagoServicios },
      { texto: 'Aplicaciones', ruta: '/dashboard/aplicaciones', icono: 'ph-squares-four', visible: this.administrarNegocio },
      { texto: 'Configuracion', ruta: '/dashboard/configuracion', icono: 'ph-gear', visible: this.administrarNegocio },
      { texto: 'Migracion', ruta: '/dashboard/migracion', icono: 'ph-database', visible: this.administrarNegocio },
    ].filter(x => x.visible);
  });

  // ---------------------------------------------------------------- crear
  /**
   * LO QUE SE CREA, EN ORDEN DE FRECUENCIA.
   *
   * Primero lo que este negocio hace muchas veces al dia; el resto detras de
   * «Mas acciones». Una lista de ocho obliga a leerla entera cada vez, y la
   * accion de crear es justo la que no deberia hacer leer.
   */
  readonly crearFrecuentes = computed<Destino[]>(() => this.crearTodas().slice(0, 4));
  readonly crearResto = computed<Destino[]>(() => this.crearTodas().slice(4));

  private crearTodas(): Destino[] {
    const haceServicios = this.operarServicios && this.caps.servicios;
    /* El giro manda el orden: una barberia crea citas todo el dia y ordenes de
       vez en cuando; un taller al reves. */
    const primeroCita = haceServicios && this.giro.usaAgenda && this.giro.inicio === 'agenda';

    const cita: Destino = {
      texto: 'Nueva cita', ruta: '/dashboard/ordenes-de-servicio/agenda',
      icono: 'ph-calendar-plus', visible: haceServicios && this.giro.usaAgenda,
    };
    const orden: Destino = {
      texto: 'Nueva orden', ruta: '/dashboard/ordenes-de-servicio/ordenes',
      icono: 'ph-wrench', visible: haceServicios,
    };

    return [
      { texto: 'Nueva venta', ruta: '/dashboard/venta', icono: 'ph-cash-register', visible: this.operarVentas },
      ...(primeroCita ? [cita, orden] : [orden, cita]),
      { texto: 'Nuevo cliente', ruta: '/dashboard/clientes', icono: 'ph-user-plus', visible: this.operarVentas },
      { texto: 'Registrar compra', ruta: '/dashboard/registrarCompra', icono: 'ph-bag', visible: this.operarInventario },
      { texto: 'Nuevo producto', ruta: '/dashboard/inventario', icono: 'ph-package', visible: this.operarInventario },
    ].filter(x => x.visible);
  }

  // ------------------------------------------------------------ busqueda
  esActiva(a: Area): boolean { return this.ruta().startsWith(a.raiz); }
  esActivoDestino(d: Destino): boolean { return this.ruta() === d.ruta; }

  /*
   * TRACKBY, Y NO ES OPCIONAL.
   *
   * Estas listas se recalculan cuando cambian los permisos, los modulos o los
   * datos. Sin `trackBy`, cada recalculo devuelve objetos nuevos y `ngFor`
   * destruye y reconstruye TODO el dock, incluidos sus `routerLinkActive`, que
   * a su vez vuelven a marcar el componente para revision. Eso no es lento: es
   * un bucle que deja el hilo del renderer colgado y la ventana en blanco.
   * Paso exactamente eso la primera vez que se probo.
   */
  porId = (_: number, a: Area) => a.id;
  porRuta = (_: number, d: Destino) => d.ruta + d.texto;

  // ------------------------------------------------------------- aperturas
  /** El cursor asoma el panel; no lo fija. */
  asomar(a: Area) {
    if (!this.tienePanel(a)) return;
    clearTimeout(this.cierre);
    if (this.fijado()) return;         // uno fijado manda sobre el cursor
    this.cerrarPopovers();
    this.panel.set(a.id);
  }

  /** Al salir el cursor se cierra, pero con gracia (ver GRACIA). */
  retirar() {
    if (this.fijado()) return;
    clearTimeout(this.cierre);
    this.cierre = setTimeout(() => this.panel.set(null), GRACIA);
  }

  /** Quedarse dentro del panel cancela el cierre en curso. */
  sostener() { clearTimeout(this.cierre); }

  /**
   * Pulsar o tocar un area CON panel: lo fija. Volver a pulsar lo cierra.
   * Las areas sin panel son enlaces y no pasan por aqui.
   */
  pulsar(a: Area, _e: Event) {
    clearTimeout(this.cierre);
    const yaEstaba = this.panel() === a.id && this.fijado();
    this.cerrarTodo();
    if (!yaEstaba) { this.panel.set(a.id); this.fijado.set(true); }
  }

  alternarCrear() {
    const v = !this.crearAbierto();
    this.cerrarTodo();
    this.crearAbierto.set(v);
    this.crearTodo.set(false);
  }

  verMasAcciones() { this.crearTodo.set(true); }

  alternarMas() {
    const v = !this.masAbierto();
    this.cerrarTodo();
    this.masAbierto.set(v);
  }

  private cerrarPopovers() {
    this.crearAbierto.set(false);
    this.masAbierto.set(false);
  }

  cerrarTodo() {
    clearTimeout(this.cierre);
    this.guia.cerrar();
    this.cerrarPopovers();
    this.panel.set(null);
    this.fijado.set(false);
    this.crearTodo.set(false);
  }

  ir(ruta: string) {
    this.cerrarTodo();
    void this.router.navigateByUrl(ruta);
  }

  /** El boton de la lupa y Ctrl+K abren lo mismo, desde sitios distintos. */
  abrirBuscador() { this.cerrarTodo(); this.paleta.abrir(); }

  // -------------------------------------------------------------- teclado
  @HostListener('document:keydown', ['$event'])
  alTeclear(e: KeyboardEvent) {
    if (e.key === 'Escape') { this.cerrarTodo(); return; }

    /* Ctrl+1..6 salta DIRECTO al destino principal del area, sin pasar por su
       panel. Es lo que conserva el camino de un solo gesto para quien ya sabe
       a donde va: el panel esta para descubrir, la tecla para repetir. */
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && /^[1-6]$/.test(e.key)) {
      const i = Number(e.key) - 1;
      const areas = this.areas();
      if (i < areas.length) { e.preventDefault(); this.ir(areas[i].ruta); }
    }
  }

  @HostListener('document:click', ['$event'])
  alPulsarFuera(e: Event) {
    const dentro = (e.target as HTMLElement)?.closest?.('.wxdock, .wxdock-pop, .wxdock-panel');
    if (!dentro) this.cerrarTodo();
  }

  // ---------------------------------------------------------------- datos
  /**
   * El estado que se ensena en los paneles.
   *
   * Todo sale de canales que YA EXISTEN. No se ha abierto ninguno nuevo: cada
   * canal nuevo es una puerta que hay que registrar, autorizar y auditar, y
   * una linea de contexto no justifica abrir puertas.
   *
   * Lo que no se puede saber se queda vacio. Una cifra inventada en el sitio
   * donde se toman decisiones es peor que no tener cifra.
   */
  private async cargarDatos(): Promise<void> {
    const api = (window as any).electronAPI;
    if (!api) return;
    const d: Record<string, { aviso: Aviso; pies: Record<string, string> }> = {};
    const poner = (id: string) => (d[id] ??= { aviso: null, pies: {} });

    if (this.operarInventario) {
      try {
        const r = await api.alertsCounts?.({ min: 3 });
        const c = r?.data ?? {};
        const bajos = Number(c.agotados ?? 0) + Number(c.lowstock ?? 0);
        const inv = poner('inventario');
        inv.aviso = bajos > 0
          ? { texto: `${bajos} ${bajos === 1 ? 'producto bajo minimo' : 'productos bajo minimo'}`, tono: 'peligro' }
          : { texto: 'Sin productos bajo minimo', tono: 'ok' };
        if (bajos > 0) inv.pies['stock'] = `${bajos} por reponer`;

        const total = Number(c.total ?? 0);
        if (total > 0) poner('inicio').pies['alertas'] = `${total} sin revisar`;

        const vencidos = Number(c.vencidos ?? 0);
        if (vencidos > 0) {
          const cl = poner('clientes');
          cl.aviso = { texto: `${vencidos} con saldo vencido`, tono: 'aviso' };
          cl.pies['saldo'] = `${vencidos} con saldo vencido`;
        }
      } catch { /* sin dato, panel sin linea de contexto */ }
    }

    if (this.operarVentas) {
      try {
        const r = await api.getOpenShift?.();
        const t = r?.data ?? r?.turno ?? null;
        const v = poner('venta');
        v.aviso = t ? { texto: 'Caja abierta', tono: 'ok' } : { texto: 'No hay turno abierto', tono: 'aviso' };
        v.pies['turno'] = t ? 'Caja abierta' : 'Hace falta abrir turno';
      } catch { /* silencioso */ }
    }

    if (this.operarServicios && this.caps.servicios) {
      try {
        const r = await api.serviciosOrdenes?.({ estado: 'ABIERTAS' });
        const n = Array.isArray(r?.data) ? r.data.length : 0;
        if (n > 0) {
          const s = poner('servicios');
          s.pies['ordenes'] = `${n} ${n === 1 ? 'orden dentro' : 'ordenes dentro'}`;
        }
      } catch { /* silencioso */ }
    }

    /* `datos` es un signal y las listas lo leen: escribirlo ya avisa a quien
       depende de el. No hace falta empujar la deteccion a mano. */
    this.datos.set(d);
  }

  /**
   * EL ESTADO DE WYBIX MINI.
   *
   * Sale de la GUIA, no de los datos del dock. Antes lo calculaba el dock por
   * su cuenta y habia dos opiniones sobre el mismo negocio: la cara del dock
   * podia decir "todo en orden" mientras Inicio decia "3 cosas pendientes".
   * Una sola fuente, y la cara del dock, la de Inicio y la del panel dicen
   * siempre lo mismo porque son el mismo calculo.
   */
  readonly estadoWybix = computed<'idle' | 'atencion'>(() =>
    this.guia.hayPendientes() ? 'atencion' : 'idle');

  /** Pulsar la figura abre el resumen. No navega a ninguna parte. */
  alternarGuia(e: Event) {
    e.stopPropagation();
    const abierta = this.guia.abierta();
    this.cerrarTodo();
    if (!abierta) this.guia.abrir();
  }
}
