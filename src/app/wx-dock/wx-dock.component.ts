import {
  ChangeDetectionStrategy, Component, HostListener, Input, OnDestroy, OnInit,
  computed, signal,
} from '@angular/core';
import { NgClass, NgFor, NgIf } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { Subscription, filter } from 'rxjs';
import { AuthService, PAQUETES } from '../../services/auth.service';
import { ModulesService, ModulesState } from '../../services/modules.service';
import { CapabilityService } from '../../core';
import { WxAvatarComponent } from '../wx-avatar/wx-avatar.component';

/**
 * WX-DOCK — la barra de trabajo de Wybix.
 *
 * Sustituye al rail lateral. No es el mismo menu movido abajo: es otro modelo.
 *
 * QUE CAMBIA Y POR QUE
 * --------------------
 * El rail tenia dieciocho entradas en una columna. Encontrar algo obligaba a
 * LEER la lista entera, porque dieciocho etiquetas apiladas no se escanean: se
 * leen. Y ocupaba 240 px de ancho permanentes en pantallas donde lo que falta
 * siempre es ancho de tabla.
 *
 * El dock tiene SEIS areas. Cada una es un dominio del negocio, no una
 * pantalla, y cada una es una VENTANA: al pasar el cursor por encima se asoma
 * lo que hay dentro -la cifra que importa y a donde mas se puede ir- sin salir
 * de donde estas. La mayoria de las veces con eso basta y no entras.
 *
 * NADA DEJA DE SER ALCANZABLE. Las dieciocho entradas del rail siguen todas
 * aqui: unas son area, otras son destino dentro de la ventana de su area, y el
 * resto vive en «Mas». Lo que se fue es la lista de dieciocho, no los destinos.
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
};

type Aviso = { texto: string; tono: 'peligro' | 'aviso' | 'ok' } | null;

type Area = {
  id: string;
  nombre: string;
  icono: string;
  ruta: string;
  /** Prefijo que marca el area como activa, aunque la ruta exacta sea otra. */
  raiz: string;
  tecla: string;
  visible: boolean;
  cifra: string;
  pie: string;
  aviso: Aviso;
  destinos: Destino[];
};

@Component({
  selector: 'wx-dock',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, RouterLink, RouterLinkActive, WxAvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './wx-dock.component.html',
  styleUrls: ['./wx-dock.component.css'],
})
export class WxDockComponent implements OnInit, OnDestroy {
  /** Cifras de las ventanas. Vacias hasta que llegan; nunca inventadas. */
  private readonly datos = signal<Record<string, { cifra: string; pie: string; aviso: Aviso }>>({});

  readonly crearAbierto = signal(false);
  readonly masAbierto = signal(false);
  readonly buscarAbierto = signal(false);
  readonly usuarioAbierto = signal(false);
  readonly consulta = signal('');

  /* Signal y no campo suelto: de esto dependen las listas de abajo, y una
     lista que depende de un campo mudo no se entera de que cambio. */
  readonly modulos = signal<ModulesState>({ pagoServicios: false });
  private modSub?: Subscription;

  /* DONDE ESTAMOS, COMO SIGNAL.
     Leer `router.url` dentro de la plantilla no bastaba: con OnPush, navegar
     no dispara por si mismo una revision de este componente, asi que el area
     iluminada se quedaba en la anterior. Se veia clarisimo al entrar a
     Inventario con Inicio todavia encendido. */
  private readonly ruta = signal('');
  private rutaSub?: Subscription;

  constructor(
    private router: Router,
    public auth: AuthService,
    public caps: CapabilityService,
    private modules: ModulesService,
  ) {}

  ngOnInit(): void {
    this.modSub = this.modules.mods$.subscribe(m => this.modulos.set(m));
    this.ruta.set(this.router.url);
    this.rutaSub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(e => this.ruta.set(e.urlAfterRedirects));
    void this.cargarCifras();
  }

  ngOnDestroy(): void {
    this.modSub?.unsubscribe();
    this.rutaSub?.unsubscribe();
  }

  /* Lo resuelve el panel: la sesion trae un nombre y la base puede traer otro
     mas correcto. Esa correccion ya vivia alli y no tiene por que mudarse. */
  @Input() usuario = 'Usuario';

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

  // ---------------------------------------------------------------- areas
  /**
   * Las seis areas, en el orden en que se dibujan.
   *
   * Compras vive DENTRO de Inventario y no como area propia: registrar una
   * compra es como entra el stock, y quien la registra viene de mirar lo que
   * falta. Separarlas obligaba a cruzar el menu a media tarea.
   */
  readonly areas = computed<Area[]>(() => {
    const d = this.datos();
    const dato = (id: string) => d[id] ?? { cifra: '', pie: '', aviso: null };

    const lista: Area[] = [
      {
        id: 'inicio', nombre: 'Inicio', icono: 'ph-house', tecla: 'Ctrl 1',
        ruta: '/dashboard/inicio', raiz: '/dashboard/inicio', visible: true,
        ...dato('inicio'),
        destinos: [
          { texto: 'Alertas', ruta: '/dashboard/alertas', icono: 'ph-bell', visible: this.verNumeros },
          { texto: 'Estadísticas', ruta: '/dashboard/estadisticas', icono: 'ph-chart-line', visible: this.verNumeros },
        ],
      },
      {
        id: 'venta', nombre: 'Venta', icono: 'ph-cash-register', tecla: 'Ctrl 2',
        ruta: '/dashboard/venta', raiz: '/dashboard/venta', visible: this.operarVentas,
        ...dato('venta'),
        destinos: [
          { texto: 'Abrir cajón', ruta: '/dashboard/abrir-cajon', icono: 'ph-vault', visible: this.supervisarVentas },
          { texto: 'Corte del día', ruta: '/dashboard/corte-dia', icono: 'ph-calendar-check', visible: this.verNumeros },
          { texto: 'Tabla de ventas', ruta: '/dashboard/tablaVenta', icono: 'ph-receipt', visible: this.supervisarVentas },
        ],
      },
      {
        id: 'inventario', nombre: 'Inventario', icono: 'ph-package', tecla: 'Ctrl 3',
        ruta: '/dashboard/inventario', raiz: '/dashboard/inventario', visible: this.operarInventario,
        ...dato('inventario'),
        destinos: [
          { texto: 'Conteo físico', ruta: '/dashboard/conteo', icono: 'ph-clipboard-text', visible: this.operarInventario },
          { texto: 'Registrar compra', ruta: '/dashboard/registrarCompra', icono: 'ph-bag', visible: true },
          { texto: 'Tabla de compras', ruta: '/dashboard/tablaCompra', icono: 'ph-table', visible: this.operarInventario },
          { texto: 'Proveedores', ruta: '/dashboard/proveedores', icono: 'ph-truck', visible: this.operarInventario },
          { texto: 'Recetas y modificadores', ruta: '/dashboard/recetas', icono: 'ph-cooking-pot', visible: this.operarInventario && this.caps.hospitality },
        ],
      },
      {
        id: 'servicios', nombre: 'Servicios', icono: 'ph-wrench', tecla: 'Ctrl 4',
        ruta: '/dashboard/ordenes-de-servicio', raiz: '/dashboard/ordenes-de-servicio',
        visible: this.operarServicios && this.caps.servicios,
        ...dato('servicios'),
        destinos: [],
      },
      {
        id: 'clientes', nombre: 'Clientes', icono: 'ph-users', tecla: 'Ctrl 5',
        ruta: '/dashboard/clientes', raiz: '/dashboard/clientes', visible: this.operarVentas,
        ...dato('clientes'),
        /*
         * Fidelizacion NO cuelga de aqui, aunque una campana vaya dirigida a
         * clientes. Ya vivio colgada de Inventario y costo encontrarla; si
         * ahora colgara de Clientes seria el mismo error con otro padre.
         * Es un dominio propio y vive en «Mas», que es primer nivel.
         */
        destinos: [],
      },
    ];

    return lista.filter(a => a.visible);
  });

  /**
   * «MAS» ES PRIMER NIVEL, NO UN CAJON DE SASTRE.
   *
   * Son dominios propios que no caben en las seis plazas del dock. La
   * diferencia con un submenu importa y no es cosmetica: lo que vive aqui no
   * cuelga de NINGUN otro dominio, y por eso se puede encontrar sin saber de
   * antemano bajo que otra cosa lo guardaron.
   *
   * Es exactamente la leccion que costo tres mudanzas: Fidelizacion vivio
   * colgada de Inventario, que es donde nadie buscaria una campana. Aqui no
   * cuelga de nada.
   */
  readonly mas = computed<Destino[]>(() => {
    return [
      { texto: 'Fidelización', ruta: '/dashboard/fidelizacion', icono: 'ph-gift', visible: this.administrarNegocio && this.caps.loyalty },
      { texto: 'Facturación', ruta: '/dashboard/facturacion', icono: 'ph-seal-check', visible: this.operarVentas },
      { texto: 'Aplicaciones', ruta: '/dashboard/aplicaciones', icono: 'ph-squares-four', visible: this.administrarNegocio },
      { texto: 'Configuración', ruta: '/dashboard/configuracion', icono: 'ph-gear', visible: this.administrarNegocio },
      { texto: 'Pago de servicios', ruta: '/dashboard/servicios', icono: 'ph-device-mobile', visible: this.modulos().pagoServicios },
      { texto: 'Importar productos', ruta: '/dashboard/importador', icono: 'ph-file-arrow-up', visible: this.administrarNegocio },
      { texto: 'Migración', ruta: '/dashboard/migracion', icono: 'ph-database', visible: this.administrarNegocio },
    ].filter(x => x.visible);
  });

  /** Lo que ofrece el boton central. Depende de lo que este negocio hace. */
  readonly acciones = computed<Destino[]>(() => {
    return [
      { texto: 'Nueva venta', ruta: '/dashboard/venta', icono: 'ph-cash-register', visible: this.operarVentas },
      { texto: 'Nueva orden de servicio', ruta: '/dashboard/ordenes-de-servicio', icono: 'ph-wrench', visible: this.operarServicios && this.caps.servicios },
      { texto: 'Registrar compra', ruta: '/dashboard/registrarCompra', icono: 'ph-bag', visible: this.operarInventario },
      { texto: 'Nuevo cliente', ruta: '/dashboard/clientes', icono: 'ph-user-plus', visible: this.operarVentas },
    ].filter(x => x.visible);
  });

  // ------------------------------------------------------------- busqueda
  /**
   * Ctrl+K busca DESTINOS, no datos.
   *
   * Es una promesa que se puede cumplir entera: todo lo que aparece aqui lleva
   * a algun sitio y no hay ningun caso en el que la lista mienta. Buscar
   * productos, clientes y folios desde el mismo sitio es lo siguiente, pero no
   * se anuncia antes de existir.
   */
  readonly resultados = computed<Destino[]>(() => {
    const q = this.consulta().trim().toLowerCase();
    const areas = this.areas();
    const todo: Destino[] = [
      ...areas.map(a => ({ texto: a.nombre, ruta: a.ruta, icono: a.icono, visible: true })),
      ...areas.flatMap(a => a.destinos.filter(x => x.visible)),
      ...this.mas(),
    ];
    /*
     * SIN ESCRIBIR NADA SE ENSENA TODO, Y ENTERO.
     *
     * Dos motivos. Uno: un buscador vacio que no ofrece nada obliga a adivinar
     * que se le puede pedir. Y dos, que es el importante: las ventanas de las
     * areas se abren al pasar el cursor, y en una pantalla tactil no hay
     * cursor. Esta lista es el camino que SI existe siempre -el boton de la
     * lupa esta ahi, se toque o se teclee-, asi que tiene que llevar a todos
     * los sitios, no a los ocho primeros.
     *
     * Ya filtrando se corta a ocho: ahi lo que hace falta es decidir rapido.
     */
    if (!q) return todo;
    return todo.filter(x => x.texto.toLowerCase().includes(q)).slice(0, 8);
  });

  // ------------------------------------------------------------- acciones
  /*
   * TRACKBY, Y NO ES OPCIONAL.
   *
   * Estas listas se recalculan cuando cambian los permisos, los modulos o las
   * cifras. Sin `trackBy`, cada recalculo devuelve objetos nuevos y `ngFor`
   * destruye y reconstruye TODO el dock, incluidos sus `routerLinkActive`, que
   * a su vez vuelven a marcar el componente para revision. Eso no es lento:
   * es un bucle que deja el hilo del renderer colgado y la ventana en blanco.
   * Paso exactamente eso la primera vez que se probo.
   */
  porId = (_: number, a: Area) => a.id;
  porRuta = (_: number, d: Destino) => d.ruta;

  esActiva(a: Area): boolean { return this.ruta().startsWith(a.raiz); }

  ir(ruta: string) {
    this.cerrarTodo();
    void this.router.navigateByUrl(ruta);
  }

  alternarCrear() {
    const v = !this.crearAbierto();
    this.cerrarTodo();
    this.crearAbierto.set(v);
  }

  alternarMas() {
    const v = !this.masAbierto();
    this.cerrarTodo();
    this.masAbierto.set(v);
  }

  alternarUsuario() {
    const v = !this.usuarioAbierto();
    this.cerrarTodo();
    this.usuarioAbierto.set(v);
  }

  abrirBuscar() {
    this.cerrarTodo();
    this.consulta.set('');
    this.buscarAbierto.set(true);
    /* El foco va al campo despues de que exista: sin el retraso se pierde. */
    setTimeout(() => document.getElementById('wxdock-q')?.focus(), 0);
  }

  cerrarTodo() {
    this.crearAbierto.set(false);
    this.masAbierto.set(false);
    this.buscarAbierto.set(false);
    this.usuarioAbierto.set(false);
  }

  alEscribir(e: Event) { this.consulta.set((e.target as HTMLInputElement).value); }

  /** Enter en el buscador lleva al primero, que es lo que espera quien teclea. */
  alEnviar(e: Event) {
    e.preventDefault();
    const primero = this.resultados()[0];
    if (primero) this.ir(primero.ruta);
  }

  /**
   * CERRAR SESION CIERRA LA SESION.
   *
   * El boton del rail solo navegaba a `/login`. La sesion seguia abierta en el
   * proceso principal, que es quien autoriza: quien llegara despues a esa
   * ventana heredaba los permisos del anterior sin volver a identificarse, y
   * cualquier canal sensible invocado a mano se ejecutaba con ellos.
   *
   * `auth.salir()` ya existia y hacia lo correcto; simplemente no la llamaba
   * nadie. Se navega DESPUES de que el proceso principal confirme.
   */
  async cerrarSesion() {
    this.cerrarTodo();
    await this.auth.salir();
    void this.router.navigate(['/login']);
  }
  crearUsuario() { this.cerrarTodo(); void this.router.navigate(['/sign_up']); }

  // -------------------------------------------------------------- teclado
  @HostListener('document:keydown', ['$event'])
  alTeclear(e: KeyboardEvent) {
    if (e.key === 'Escape') { this.cerrarTodo(); return; }

    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      this.abrirBuscar();
      return;
    }

    /* Ctrl+1..6 salta de area. Es lo que hace que el dock no dependa del
       raton: sin esto, quien trabaja con teclado pierde la mitad del modelo. */
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && /^[1-6]$/.test(e.key)) {
      const i = Number(e.key) - 1;
      const areas = this.areas();
      if (i < areas.length) { e.preventDefault(); this.ir(areas[i].ruta); }
      else if (i === areas.length) { e.preventDefault(); this.alternarMas(); }
    }
  }

  @HostListener('document:click', ['$event'])
  alPulsarFuera(e: Event) {
    const raiz = (e.target as HTMLElement)?.closest?.('.wxdock, .wxdock-pop, .wxdock-buscar');
    if (!raiz) this.cerrarTodo();
  }

  // ---------------------------------------------------------------- datos
  /**
   * Las cifras de las ventanas.
   *
   * Todo sale de canales que YA EXISTEN. No se ha abierto ninguno nuevo: cada
   * canal nuevo es una puerta que hay que registrar, autorizar y auditar, y
   * una ventana informativa no justifica abrir puertas.
   *
   * Lo que no se puede saber se queda vacio. Una cifra inventada en el sitio
   * donde se toman decisiones es peor que no tener cifra.
   */
  private async cargarCifras(): Promise<void> {
    const api = (window as any).electronAPI;
    if (!api) return;
    const d: Record<string, { cifra: string; pie: string; aviso: Aviso }> = {};

    if (this.operarInventario) {
      try {
        const r = await api.alertsCounts?.({ min: 3 });
        const bajos = Number(r?.data?.agotados ?? 0) + Number(r?.data?.lowstock ?? 0);
        d['inventario'] = {
          cifra: '', pie: '',
          aviso: bajos > 0
            ? { texto: `${bajos} ${bajos === 1 ? 'producto bajo mínimo' : 'productos bajo mínimo'}`, tono: 'peligro' }
            : { texto: 'Sin productos bajo mínimo', tono: 'ok' },
        };
      } catch { /* sin dato, ventana sin cifra */ }
    }

    if (this.operarVentas) {
      try {
        const r = await api.getOpenShift?.();
        const t = r?.data ?? r?.turno ?? null;
        d['venta'] = {
          cifra: '', pie: '',
          aviso: t
            ? { texto: 'Caja abierta', tono: 'ok' }
            : { texto: 'No hay turno abierto', tono: 'aviso' },
        };
      } catch { /* silencioso */ }
    }

    if (this.operarServicios && this.caps.servicios) {
      try {
        const r = await api.serviciosOrdenes?.({ estado: 'ABIERTAS' });
        const n = Array.isArray(r?.data) ? r.data.length : 0;
        d['servicios'] = {
          cifra: String(n), pie: n === 1 ? 'orden dentro' : 'órdenes dentro',
          aviso: null,
        };
      } catch { /* silencioso */ }
    }

    /* `datos` es un signal y las listas lo leen: escribirlo ya avisa a quien
       depende de el. No hace falta empujar la deteccion a mano. */
    this.datos.set(d);
  }
}
