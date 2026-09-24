import { Injectable, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService, PAQUETES } from '../../services/auth.service';
import { ModulesService, ModulesState } from '../../services/modules.service';
import { CapabilityService, GiroServiciosService } from '../../core';

/**
 * LA NAVEGACION DE WYBIX, EN UN SOLO SITIO.
 *
 * Wybix tiene una navegacion y dos formas de pintarla: el dock y la barra
 * lateral. Las dos leen de aqui las areas, los destinos, los permisos, los
 * modulos, las cifras y lo que esta activo. La paleta (Ctrl+K) tambien.
 *
 * Antes esto vivia dentro de `wx-dock`, y la paleta tenia su propia copia que
 * ya se habia separado: ofrecia «Pago de servicios» a todo el mundo aunque el
 * modulo estuviera apagado. Una seccion nueva se declara AQUI y aparece en el
 * dock, en la barra lateral y en Ctrl+K a la vez.
 *
 * Cada destino pregunta por el PAQUETE que exige la operacion a la que lleva,
 * exactamente igual que la operacion. Ninguna representacion filtra por su
 * cuenta: si lo hiciera, dejaria de ofrecer lo mismo que la otra.
 */

export type Aviso = { texto: string; tono: 'peligro' | 'aviso' | 'ok' } | null;

export type Destino = {
  texto: string;
  ruta: string;
  icono: string;
  visible: boolean;
  /** Una linea de contexto bajo el nombre. Solo cuando aporta algo. */
  pie?: string;
  /** El destino principal del area: el que se abre con Enter. */
  principal?: boolean;
};

/** Los dominios de «Mas». La barra lateral los separa como hacia el rail. */
export type GrupoMas = 'negocio' | 'sistema';
export type DestinoMas = Destino & { grupo: GrupoMas };

export type Area = {
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

export type ModoNavegacion = 'dock' | 'sidebar';

type Preferencia = { modo: ModoNavegacion; plegada: boolean };

/**
 * El dock es el modo de siempre. Una instalacion que ya existia no puede
 * amanecer con barra lateral: solo cambia quien la elige.
 */
const POR_DEFECTO: Preferencia = { modo: 'dock', plegada: false };

@Injectable({ providedIn: 'root' })
export class NavegacionService {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly caps = inject(CapabilityService);
  private readonly modules = inject(ModulesService);
  private readonly giro = inject(GiroServiciosService);

  /** Cifras y avisos de las areas. Vacios hasta que llegan; nunca inventados. */
  private readonly datos = signal<Record<string, { aviso: Aviso; pies: Record<string, string> }>>({});

  /* Signal y no campo suelto: de esto dependen las listas, y una lista que
     depende de un campo mudo no se entera de que cambio. */
  private readonly modulos = signal<ModulesState>({ pagoServicios: false });

  /* DONDE ESTAMOS, COMO SIGNAL. Con OnPush, leer `router.url` desde una
     plantilla dejaba encendida el area anterior al navegar. */
  readonly ruta = signal('');

  constructor() {
    this.modules.mods$.subscribe(m => this.modulos.set(m));
    this.ruta.set(this.router.url);
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(e => this.ruta.set(e.urlAfterRedirects));
  }

  // ------------------------------------------------------------- permisos
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
   * Compras es area propia y no cuelga de Inventario: mirar lo que hay y traer
   * lo que falta son dos trabajos distintos, que a menudo hace gente distinta.
   */
  readonly areas = computed<Area[]>(() => {
    const d = this.datos();
    const dato = (id: string) => d[id] ?? { aviso: null, pies: {} };
    const pie = (id: string, clave: string) => dato(id).pies[clave];

    const lista: Area[] = [
      {
        /* Inicio no abre panel: un panel cuya primera opcion lleva a donde ya
           decia el boton no es navegacion, es un peaje. */
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
         * El primero lo decide el GIRO: una barberia abre en la agenda porque
         * su dia es la agenda; un taller, en ordenes. Agenda y Activos
         * dependen del giro: un taller sin cita previa no tiene agenda.
         */
        destinos: [
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
        /* Fidelizacion NO cuelga de aqui: ya vivio colgada de otro dominio y
           costo encontrarla. Es dominio propio y vive en «Mas». */
        id: 'clientes', nombre: 'Clientes', icono: 'ph-users', tecla: 'Ctrl 6',
        ruta: '/dashboard/clientes', raiz: '/dashboard/clientes', visible: this.operarVentas,
        aviso: dato('clientes').aviso,
        destinos: [
          { texto: 'Ver clientes', ruta: '/dashboard/clientes', icono: 'ph-users', visible: true, principal: true, pie: pie('clientes', 'saldo') },
        ],
      },
    ];

    return lista.filter(a => a.visible);
  });

  /** Los destinos de un area que esta persona puede usar. */
  destinosDe(a: Area): Destino[] { return a.destinos.filter(d => d.visible); }

  /** Solo tiene subsecciones un area con mas de un sitio al que ir. */
  tienePanel(a: Area): boolean { return this.destinosDe(a).length > 1; }

  /**
   * «MAS» ES PRIMER NIVEL, NO UN CAJON DE SASTRE.
   *
   * Dominios propios que no cuelgan de ningun otro. El grupo solo lo usa la
   * barra lateral para separarlos como los separaba el rail.
   */
  readonly mas = computed<DestinoMas[]>(() => {
    const lista: DestinoMas[] = [
      { texto: 'Alertas', ruta: '/dashboard/alertas', icono: 'ph-bell', grupo: 'negocio', visible: this.verNumeros },
      { texto: 'Estadisticas', ruta: '/dashboard/estadisticas', icono: 'ph-chart-line', grupo: 'negocio', visible: this.verNumeros },
      { texto: 'Fidelizacion', ruta: '/dashboard/fidelizacion', icono: 'ph-gift', grupo: 'negocio', visible: this.administrarNegocio && this.caps.loyalty },
      { texto: 'Facturacion', ruta: '/dashboard/facturacion', icono: 'ph-seal-check', grupo: 'negocio', visible: this.operarVentas },
      { texto: 'Pago de servicios', ruta: '/dashboard/servicios', icono: 'ph-device-mobile', grupo: 'negocio', visible: this.modulos().pagoServicios },
      { texto: 'Aplicaciones', ruta: '/dashboard/aplicaciones', icono: 'ph-squares-four', grupo: 'sistema', visible: this.administrarNegocio },
      { texto: 'Configuracion', ruta: '/dashboard/configuracion', icono: 'ph-gear', grupo: 'sistema', visible: this.administrarNegocio },
      { texto: 'Migracion', ruta: '/dashboard/migracion', icono: 'ph-database', grupo: 'sistema', visible: this.administrarNegocio },
    ];
    return lista.filter(x => x.visible);
  });

  /**
   * LO QUE SE CREA, EN ORDEN DE FRECUENCIA. El giro manda el orden: una
   * barberia crea citas todo el dia y ordenes de vez en cuando.
   */
  readonly crear = computed<Destino[]>(() => {
    const haceServicios = this.operarServicios && this.caps.servicios;
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
  });

  /**
   * Todos los destinos a los que se puede ir, sin repetir. Es lo que ofrece
   * Ctrl+K en «Ir a», y lo que tienen que alcanzar el dock y la barra.
   */
  readonly destinos = computed<Destino[]>(() => {
    const vistos = new Set<string>();
    const todos: Destino[] = [];
    for (const a of this.areas()) {
      for (const d of this.destinosDe(a)) {
        if (vistos.has(d.ruta)) continue;
        vistos.add(d.ruta);
        /* El destino principal se busca por el nombre del area: nadie escribe
           «ver inventario» para ir a Inventario. */
        todos.push(d.principal ? { ...d, texto: a.nombre } : d);
      }
    }
    for (const d of this.mas()) {
      if (!vistos.has(d.ruta)) { vistos.add(d.ruta); todos.push(d); }
    }
    return todos;
  });

  // ------------------------------------------------------------- activo
  esActiva(a: Area): boolean { return this.ruta().startsWith(a.raiz); }
  esActivoDestino(d: Destino): boolean { return this.ruta() === d.ruta; }

  // ---------------------------------------------------------------- datos
  /**
   * El estado que se ensena junto a las areas.
   *
   * Todo sale de canales que YA EXISTEN: cada canal nuevo es una puerta que
   * hay que registrar, autorizar y auditar. Lo que no se puede saber se queda
   * vacio: una cifra inventada donde se toman decisiones es peor que ninguna.
   */
  async cargarDatos(): Promise<void> {
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
      } catch { /* sin dato, sin linea de contexto */ }
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
          poner('servicios').pies['ordenes'] = `${n} ${n === 1 ? 'orden dentro' : 'ordenes dentro'}`;
        }
      } catch { /* silencioso */ }
    }

    this.datos.set(d);
  }

  // ------------------------------------------------------------------ modo
  /*
   * LA PREFERENCIA ES DE LA PERSONA, NO DEL NEGOCIO.
   *
   * Vive donde viven las demas preferencias de interfaz -el modo oscuro, las
   * columnas de cada tabla, los recientes de Ctrl+K-: en el almacenamiento
   * local de esta caja. La clave lleva el id de quien entro, asi que en la
   * misma caja una persona trabaja con dock y otra con barra lateral. El id y
   * no el nombre: el nombre se puede cambiar.
   *
   * Si el almacenamiento falla, Wybix sigue con el dock: una preferencia
   * perdida no puede tumbar la navegacion.
   */
  private readonly escrituras = signal(0);

  private readonly preferencia = computed<Preferencia>(() => {
    this.escrituras();
    const id = this.auth.acceso()?.userId;
    if (id == null) return POR_DEFECTO;
    try {
      const crudo = localStorage.getItem(this.llave(id));
      const p = crudo ? JSON.parse(crudo) : null;
      return {
        modo: p?.modo === 'sidebar' ? 'sidebar' : 'dock',
        plegada: p?.plegada === true,
      };
    } catch {
      return POR_DEFECTO;
    }
  });

  readonly modo = computed<ModoNavegacion>(() => this.preferencia().modo);
  readonly plegada = computed<boolean>(() => this.preferencia().plegada);

  fijarModo(modo: ModoNavegacion) { this.guardar({ ...this.preferencia(), modo }); }
  fijarPlegada(plegada: boolean) { this.guardar({ ...this.preferencia(), plegada }); }

  private llave(id: number): string { return `wx-nav:${id}`; }

  private guardar(p: Preferencia) {
    const id = this.auth.acceso()?.userId;
    if (id == null) return;
    try { localStorage.setItem(this.llave(id), JSON.stringify(p)); } catch { /* sin almacenamiento */ }
    this.escrituras.update(n => n + 1);
  }
}
