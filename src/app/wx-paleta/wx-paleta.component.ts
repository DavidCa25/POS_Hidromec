import {
  ChangeDetectionStrategy, Component, HostListener, OnInit, computed, effect, signal,
} from '@angular/core';
import { NgClass, NgFor, NgIf } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService, PAQUETES } from '../../services/auth.service';
import { CapabilityService, GiroServiciosService } from '../../core';
import { WxAvatarComponent } from '../wx-avatar/wx-avatar.component';
import { PaletaService } from './paleta.service';
import { NavegacionService } from '../wx-nav/navegacion.service';

/**
 * WX-PALETA — Ctrl+K.
 *
 * ================================================================
 * QUE ES, Y QUE NO
 * ================================================================
 * La primera version era una lista de rutas con un campo encima. Funcionaba y
 * no servia para nada: para ir a Inventario ya esta el dock, y nadie abre un
 * buscador para pulsar lo que tiene delante.
 *
 * Esto busca TRES clases de cosa a la vez, que es lo que la vuelve util:
 *
 *   ACCIONES   lo que se puede hacer ahora mismo. "nueva" -> Nueva venta,
 *              Nueva orden, Nueva cita, Nuevo cliente.
 *   ENTIDADES  lo que el negocio tiene dentro: productos, clientes, ordenes y
 *              los activos del giro. "aceite" encuentra el aceite; "ABC-123"
 *              encuentra el coche y la orden que lo lleva.
 *   DESTINOS   las pantallas. Sigue estando, pero ya no es lo unico.
 *
 * Ctrl+K es un ACELERADOR, no el camino obligatorio: todo lo que aparece aqui
 * se puede alcanzar tambien pulsando en el dock. Si algo solo viviera aqui,
 * estaria escondido.
 *
 * ================================================================
 * DE DONDE SALEN LOS DATOS
 * ================================================================
 * De canales que YA EXISTEN. No se ha abierto ninguno nuevo. Los indices se
 * piden la PRIMERA vez que se abre la paleta -no al arrancar la aplicacion- y
 * se quedan en memoria mientras viva la ventana.
 *
 * El filtrado es local. Para un catalogo de punto de venta -cientos o unos
 * pocos miles de filas- recorrer un array es mas rapido que ir a la base en
 * cada tecla, y sobre todo no deja la interfaz esperando. `TOPE` corta el
 * indice: si alguien tiene cincuenta mil productos, esto se queda con los
 * primeros y hay que cambiarlo por una consulta con filtro. No se disimula.
 */

type Grupo = 'Acciones' | 'Productos' | 'Clientes' | 'Órdenes' | 'Activos' | 'Ir a';

type Resultado = {
  grupo: Grupo;
  texto: string;
  pie?: string;
  icono?: string;
  /** Semilla de blobatar cuando el resultado ES una persona. */
  persona?: string;
  ruta: string;
  /** Folios, placas y claves se leen mejor en monoespaciada. */
  mono?: boolean;
};

/** Cuantas filas se traen de cada indice. Ver la nota de arriba. */
const TOPE = 2000;

/** Cuantos resultados se ensenan por grupo. */
const POR_GRUPO = 4;

const RECIENTES = 'wx.paleta.recientes';

@Component({
  selector: 'wx-paleta',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, WxAvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './wx-paleta.component.html',
  styleUrls: ['./wx-paleta.component.css'],
})
export class WxPaletaComponent implements OnInit {
  readonly consulta = signal('');
  readonly indice = signal(0);
  readonly cargando = signal(false);

  private readonly productos = signal<Resultado[]>([]);
  private readonly clientes = signal<Resultado[]>([]);
  private readonly ordenes = signal<Resultado[]>([]);
  private readonly activos = signal<Resultado[]>([]);
  private cargado = false;

  readonly recientes = signal<Resultado[]>([]);

  constructor(
    public paleta: PaletaService,
    private router: Router,
    private auth: AuthService,
    private caps: CapabilityService,
    private giro: GiroServiciosService,
    private nav: NavegacionService,
  ) {
    /* Al abrirse: limpia, enfoca y -la primera vez- trae los indices. */
    effect(() => {
      if (!this.paleta.abierta()) return;
      this.consulta.set('');
      this.indice.set(0);
      void this.cargarIndices();
      setTimeout(() => document.getElementById('wxpal-q')?.focus(), 0);
    });
  }

  ngOnInit(): void { this.leerRecientes(); }

  get abierta() { return this.paleta.abierta(); }

  // ------------------------------------------------------------- permisos
  private get operarVentas() { return this.auth.puede(PAQUETES.VENTAS_OPERAR); }
  private get supervisarVentas() { return this.auth.puede(PAQUETES.VENTAS_SUPERVISAR); }
  private get verNumeros() { return this.auth.puede(PAQUETES.REPORTES_VER); }
  private get operarInventario() { return this.auth.puede(PAQUETES.INVENTARIO_OPERAR); }
  private get administrarNegocio() { return this.auth.puede(PAQUETES.CONFIGURACION_ADMINISTRAR); }
  private get haceServicios() {
    return this.caps.servicios
      && (this.auth.puede(PAQUETES.SERVICIOS_OPERAR) || this.auth.puede(PAQUETES.SERVICIOS_ADMINISTRAR));
  }

  // ------------------------------------------------------------- catalogo
  /** Lo que se puede HACER. Cada una exige el paquete de su operacion. */
  private acciones(): Resultado[] {
    const a = (texto: string, ruta: string, icono: string, visible: boolean): Resultado | null =>
      visible ? { grupo: 'Acciones', texto, ruta, icono } : null;
    return [
      a('Nueva venta', '/dashboard/venta', 'ph-cash-register', this.operarVentas),
      a('Nueva orden de servicio', '/dashboard/ordenes-de-servicio/ordenes', 'ph-wrench', this.haceServicios),
      a('Nueva cita', '/dashboard/ordenes-de-servicio/agenda', 'ph-calendar-plus', this.haceServicios && this.giro.usaAgenda),
      a('Nuevo cliente', '/dashboard/clientes', 'ph-user-plus', this.operarVentas),
      a('Registrar compra', '/dashboard/registrarCompra', 'ph-bag', this.operarInventario),
      a('Nuevo producto', '/dashboard/inventario', 'ph-package', this.operarInventario),
      a('Abrir cajón', '/dashboard/abrir-cajon', 'ph-vault', this.supervisarVentas),
      a('Hacer corte del día', '/dashboard/corte-dia', 'ph-calendar-check', this.verNumeros),
      a('Conteo físico', '/dashboard/conteo', 'ph-clipboard-text', this.operarInventario),
    ].filter((x): x is Resultado => !!x);
  }

  /**
   * Las pantallas. NO tienen lista propia: son los destinos del registro de
   * navegacion, los mismos que ofrecen el dock y la barra lateral con los
   * mismos permisos. Aqui habia una copia que se habia separado -ofrecia
   * «Pago de servicios» aunque el modulo estuviera apagado-.
   */
  private destinos(): Resultado[] {
    return this.nav.destinos().map(d => ({ grupo: 'Ir a' as Grupo, texto: d.texto, ruta: d.ruta, icono: d.icono }));
  }

  // ------------------------------------------------------------ resultados
  /**
   * Sin acentos y en minuscula: quien teclea deprisa escribe "afinacion", y
   * una busqueda que no encuentra "Afinación" por una tilde se siente rota.
   */
  private plano(t: string): string {
    return (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  readonly grupos = computed<{ nombre: Grupo; filas: Resultado[] }[]>(() => {
    const q = this.plano(this.consulta().trim());
    if (!q) return [];

    const casa = (r: Resultado) =>
      this.plano(r.texto).includes(q) || (r.pie ? this.plano(r.pie).includes(q) : false);

    /* El orden es deliberado: primero lo que se puede HACER, despues lo que el
       negocio TIENE, y al final a donde IR. Quien escribe "aceite" busca el
       producto, no la pantalla de inventario. */
    const bloques: { nombre: Grupo; filas: Resultado[] }[] = [
      { nombre: 'Acciones', filas: this.acciones().filter(casa) },
      { nombre: 'Productos', filas: this.productos().filter(casa) },
      { nombre: 'Clientes', filas: this.clientes().filter(casa) },
      { nombre: 'Activos', filas: this.activos().filter(casa) },
      { nombre: 'Órdenes', filas: this.ordenes().filter(casa) },
      { nombre: 'Ir a', filas: this.destinos().filter(casa) },
    ];

    return bloques
      .map(b => ({ nombre: b.nombre, filas: b.filas.slice(0, POR_GRUPO) }))
      .filter(b => b.filas.length > 0);
  });

  /** Todo en una sola lista, que es como lo recorre el teclado. */
  readonly planos = computed<Resultado[]>(() => this.grupos().flatMap(g => g.filas));

  readonly vacio = computed(() => this.consulta().trim().length > 0 && this.planos().length === 0);

  /** Con el campo vacio: lo ultimo usado y, si no hay nada, que se puede pedir. */
  readonly sugerencias = computed<Resultado[]>(() => {
    const rec = this.recientes();
    return rec.length ? rec : this.acciones().slice(0, 4);
  });

  readonly tituloSugerencias = computed(() => this.recientes().length ? 'Recientes' : 'Para empezar');

  esElegido(r: Resultado): boolean { return this.planos()[this.indice()] === r; }

  posicion(r: Resultado): number { return this.planos().indexOf(r); }

  // ------------------------------------------------------------- teclado
  @HostListener('document:keydown', ['$event'])
  alTeclear(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      this.paleta.alternar();
      return;
    }
    if (!this.abierta) return;

    if (e.key === 'Escape') { e.preventDefault(); this.paleta.cerrar(); return; }

    const lista = this.consulta().trim() ? this.planos() : this.sugerencias();
    if (!lista.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.indice.set((this.indice() + 1) % lista.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.indice.set((this.indice() - 1 + lista.length) % lista.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = lista[this.indice()];
      if (r) this.abrir(r);
    }
  }

  alEscribir(e: Event) {
    this.consulta.set((e.target as HTMLInputElement).value);
    this.indice.set(0);
  }

  abrir(r: Resultado) {
    this.recordar(r);
    this.paleta.cerrar();
    void this.router.navigateByUrl(r.ruta);
  }

  cerrar() { this.paleta.cerrar(); }

  porFila = (_: number, r: Resultado) => r.grupo + r.ruta + r.texto;

  // ------------------------------------------------------------ recientes
  /*
   * Los recientes son una comodidad de ESTA caja y de ESTA persona, no un dato
   * del negocio: viven en el almacenamiento del navegador y no pasan por la
   * base. Si no hay almacenamiento -o esta bloqueado- la paleta funciona igual
   * y ensena acciones sugeridas en su lugar.
   */
  private leerRecientes() {
    try {
      const crudo = localStorage.getItem(RECIENTES);
      if (crudo) this.recientes.set(JSON.parse(crudo).slice(0, 5));
    } catch { /* sin recientes, se ensenan sugerencias */ }
  }

  private recordar(r: Resultado) {
    try {
      const sin = this.recientes().filter(x => x.ruta !== r.ruta || x.texto !== r.texto);
      const nueva = [r, ...sin].slice(0, 5);
      this.recientes.set(nueva);
      localStorage.setItem(RECIENTES, JSON.stringify(nueva));
    } catch { /* silencioso */ }
  }

  // -------------------------------------------------------------- indices
  private async cargarIndices(): Promise<void> {
    if (this.cargado) return;
    this.cargado = true;
    const api = (window as any).electronAPI;
    if (!api) return;

    this.cargando.set(true);
    const pedir = <T>(p: Promise<T> | undefined) =>
      (p ?? Promise.resolve(null as any)).catch(() => null);

    const [prod, cli, ords, acts] = await Promise.all([
      this.operarInventario ? pedir(api.getActiveProducts?.()) : Promise.resolve(null),
      this.operarVentas ? pedir(api.getCustomers?.()) : Promise.resolve(null),
      this.haceServicios ? pedir(api.serviciosOrdenes?.({})) : Promise.resolve(null),
      this.haceServicios && this.giro.usaActivos ? pedir(api.serviciosActivos?.({})) : Promise.resolve(null),
    ]);

    /*
     * DOS FORMAS DE RESPUESTA, Y LAS DOS SON REALES.
     *
     * Casi todos los canales devuelven `{ success, data }`, pero
     * `getActiveProducts` devuelve el ARRAY pelado -asi lo consume Inventario
     * desde siempre-. Leer solo `.data` dejaba el grupo de Productos vacio sin
     * un solo error: la paleta simplemente no encontraba ningun producto.
     */
    const filas = (r: any) => {
      const arr = Array.isArray(r) ? r : (Array.isArray(r?.data) ? r.data : []);
      return arr.slice(0, TOPE);
    };

    this.productos.set(filas(prod).map((p: any) => {
      const nombre = String(p.product_name ?? p.nombre ?? p.name ?? '').trim();
      const existencias = Number(p.stock ?? 0);
      const servicio = String(p.inventory_mode ?? '') === 'NONE';
      return {
        grupo: 'Productos' as Grupo,
        texto: nombre || '(sin nombre)',
        pie: servicio ? 'Servicio' : `${existencias} en existencia`,
        icono: servicio ? 'ph-wrench' : 'ph-package',
        ruta: '/dashboard/inventario',
      };
    }).filter((x: Resultado) => x.texto !== '(sin nombre)'));

    this.clientes.set(filas(cli).map((c: any) => {
      const nombre = String(c.customerName ?? c.customer_name ?? c.nombre ?? '').trim();
      return {
        grupo: 'Clientes' as Grupo,
        texto: nombre || '(sin nombre)',
        pie: c.code ? String(c.code) : undefined,
        /* Un cliente ES una persona: lleva su figura, no un icono generico. */
        persona: 'c:' + (c.id ?? nombre),
        ruta: '/dashboard/clientes',
      };
    }).filter((x: Resultado) => x.texto !== '(sin nombre)'));

    this.ordenes.set(filas(ords).map((o: any) => ({
      grupo: 'Órdenes' as Grupo,
      texto: String(o.folio ?? o.order_no ?? o.id ?? ''),
      pie: [o.asset_identifier, o.asset_label, o.customer_name, o.status]
        .filter(Boolean).join(' · ') || undefined,
      icono: 'ph-clipboard-text',
      mono: true,
      ruta: '/dashboard/ordenes-de-servicio/orden/' + (o.id ?? ''),
    })).filter((x: Resultado) => !!x.texto));

    this.activos.set(filas(acts).map((a: any) => ({
      grupo: 'Activos' as Grupo,
      texto: String(a.identifier ?? a.label ?? '').trim(),
      pie: [a.label, a.brand, a.model].filter(Boolean).join(' ') || undefined,
      icono: 'ph-car',
      mono: !!a.identifier,
      ruta: '/dashboard/ordenes-de-servicio/activos',
    })).filter((x: Resultado) => !!x.texto));

    this.cargando.set(false);
  }

  /** Como se llaman aqui los activos, para el encabezado del grupo. */
  get nombreActivos(): string { return this.giro.activoPlural; }
}
