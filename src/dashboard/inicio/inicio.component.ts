import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { NgClass, NgFor, NgIf } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService, PAQUETES } from '../../services/auth.service';
import { CapabilityService, GiroServiciosService } from '../../core';
import { WxAvatarComponent } from '../../app/wx-avatar/wx-avatar.component';
import { EstadoMascota, WxMascotaComponent } from '../../app/wx-mascota/wx-mascota.component';
import { GuiaService } from '../../app/wx-guia/guia.service';

/**
 * INICIO — la pantalla con la que empieza el dia.
 *
 * El panel no tenia pantalla de entrada: se caia en la ultima ruta o en
 * ninguna. Quien abre Wybix a las ocho de la manana quiere saber DOS cosas
 * antes que nada: como va el dia y que esta parado. Eso es todo lo que hay
 * aqui.
 *
 * TODO LO QUE SE ENSENA ES REAL
 * -----------------------------
 * Cada cifra sale de un canal que ya existia. Lo que no se puede saber no se
 * dibuja: una tarjeta con un numero inventado en la pantalla donde se toman
 * decisiones es peor que un hueco, porque el hueco se nota y el numero no.
 *
 * DONDE ESTA WYBIX, Y POR QUE ASI
 * -------------------------------
 * UNA figura, de 104 px, arriba, junto al saludo. Y su expresion es el
 * resumen del dia:
 *
 *   sin pendientes  reposo.     "Todo tranquilo por aqui."
 *   con pendientes  atencion.   "3 cosas necesitan tu atencion."
 *
 * La version anterior tenia dos: una pequena en el saludo y otra asomandose a
 * la lista de pendientes. Dos figuras a la vez diciendo cosas distintas es una
 * conversacion, no una pantalla de trabajo. Ahora hay una sola y su cara ES el
 * estado; la lista de abajo da el detalle.
 *
 * No va dentro de una tarjeta ni sobre un disco: se apoya en el lienzo, al
 * lado de la frase. La forma ya tiene suficiente personalidad y un contenedor
 * que no aporta nada solo la encierra.
 */

type Pendiente = {
  titulo: string;
  detalle: string;
  tono: 'peligro' | 'aviso' | 'ok';
  accion: string;
  ruta: string;
};

@Component({
  selector: 'app-inicio',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, WxAvatarComponent, WxMascotaComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './inicio.component.html',
  styleUrls: ['./inicio.component.css'],
})
export class Inicio implements OnInit {
  readonly cargando = signal(true);

  readonly vendidoHoy = signal<number | null>(null);
  readonly tickets = signal<number | null>(null);
  /*
   * LOS PENDIENTES SALEN DE LA GUIA.
   *
   * Inicio tenia su propia lista y su propia lectura de `alerts:counts`, y la
   * frase salia de la guia: el resultado fue una pantalla diciendo "una cosa
   * necesita tu atencion" encima de una lista VACIA, porque cada mitad contaba
   * cosas distintas. Un solo calculo, en `GuiaService`, y las tres caras
   * -dock, Inicio y panel- dicen lo mismo siempre.
   */
  readonly pendientes = computed<Pendiente[]>(() =>
    this.guia.avisos()
      .filter(a => a.tono !== 'ok')
      .map(a => ({
        titulo: a.texto,
        detalle: a.area,
        tono: a.tono,
        accion: a.ruta ? 'Revisar' : '',
        ruta: a.ruta ?? '',
      })));
  readonly equipo = signal<{ id: number; usuario: string; rol: string }[]>([]);
  readonly estrella = signal<{ nombre: string; piezas: number } | null>(null);

  constructor(
    private router: Router,
    public auth: AuthService,
    public caps: CapabilityService,
    private giro: GiroServiciosService,
    public guia: GuiaService,
  ) {}

  ngOnInit(): void {
    void this.cargar();
    /* La guia ya la pidio el dock; esto solo la despierta si Inicio fue lo
       primero en montarse. Dentro se ignora si ya se pidio. */
    void this.guia.cargar();
  }

  // ----------------------------------------------------------------- copia
  get nombre(): string {
    const n = this.auth.usuarioActual?.nombre ?? '';
    return n.split(/\s+/)[0] || 'hola';
  }

  /** Buenos dias / buenas tardes / buenas noches, segun el reloj de la caja. */
  get saludo(): string {
    const h = new Date().getHours();
    if (h < 12) return 'Buenos días';
    if (h < 20) return 'Buenas tardes';
    return 'Buenas noches';
  }

  get fecha(): string {
    /* `text-transform: capitalize` ponia mayuscula a cada palabra y salia
       "Sabado, 19 De Septiembre". La primera letra y ya. */
    const t = new Date().toLocaleDateString('es-MX', {
      weekday: 'long', day: 'numeric', month: 'long',
    });
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  /**
   * La segunda accion depende de lo que este negocio HACE. Un taller abre
   * ordenes; una tienda sin Servicios registra compras. Ofrecer siempre las
   * mismas dos seria ofrecerle a la mitad una puerta que no usa.
   */
  get haceServicios(): boolean {
    return this.caps.servicios
      && (this.auth.puede(PAQUETES.SERVICIOS_OPERAR) || this.auth.puede(PAQUETES.SERVICIOS_ADMINISTRAR));
  }

  /**
   * Lo que este negocio empieza ademas de vender.
   *
   * Antes era UNA accion y ya: o una orden o una compra. Con el ancho que hay
   * caben las que de verdad usa este negocio, y ofrecer solo una obligaba a
   * cruzar el dock para lo segundo mas frecuente del dia.
   */
  otrasAcciones(): { texto: string; pie: string; icono: string; ruta: string }[] {
    const lista: { texto: string; pie: string; icono: string; ruta: string }[] = [];

    if (this.haceServicios) {
      lista.push({
        texto: 'Nueva orden',
        pie: this.giro.textos.ordenVacia || 'Entra trabajo al taller',
        icono: 'ph-wrench',
        ruta: '/dashboard/ordenes-de-servicio/ordenes',
      });
      if (this.giro.usaAgenda) {
        lista.push({
          texto: 'Nueva cita',
          pie: 'Aparta hora para un cliente',
          icono: 'ph-calendar-plus',
          ruta: '/dashboard/ordenes-de-servicio/agenda',
        });
      }
    }

    if (this.auth.puede(PAQUETES.INVENTARIO_OPERAR)) {
      lista.push({
        texto: 'Registrar compra',
        pie: 'Entra mercancía al inventario',
        icono: 'ph-bag',
        ruta: '/dashboard/registrarCompra',
      });
    }

    /* Tres como mucho junto a "Nueva venta": una cuarta fila obliga a leer en
       vez de reconocer. El resto vive en el boton de crear del dock. */
    return lista.slice(0, 3);
  }

  get puedeVender(): boolean { return this.auth.puede(PAQUETES.VENTAS_OPERAR); }
  get verNumeros(): boolean { return this.auth.puede(PAQUETES.REPORTES_VER); }

  get hayPendientes(): boolean { return this.pendientes().length > 0; }

  /**
   * LA CARA Y LA FRASE SALEN DE LA GUIA, NO DE AQUI.
   *
   * Antes Inicio calculaba su propio estado y el dock el suyo, y podian
   * discrepar: la figura del dock diciendo "todo en orden" mientras esta
   * pantalla decia "3 cosas necesitan tu atencion". Son el mismo negocio, asi
   * que ahora son el mismo calculo, en `GuiaService`.
   */
  readonly estadoGuia = computed<EstadoMascota>(() => this.guia.estado());

  /**
   * Lo que dice, y solo una linea.
   *
   * Mientras carga no dice nada: una frase que afirma "todo tranquilo" y tres
   * segundos despues se corrige a "tres cosas pendientes" es peor que el
   * silencio.
   */
  readonly frase = computed<string>(() => this.guia.frase());

  get ticketPromedio(): number | null {
    const v = this.vendidoHoy(); const t = this.tickets();
    if (v == null || !t) return null;
    return v / t;
  }

  dinero(n: number | null): string {
    if (n == null) return '';
    return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  }

  ir(ruta: string) { void this.router.navigateByUrl(ruta); }

  // ----------------------------------------------------------------- datos
  private async cargar(): Promise<void> {
    const api = (window as any).electronAPI;
    if (!api) { this.cargando.set(false); return; }

    const num = (x: any) => {
      const n = Number(x);
      return Number.isFinite(n) ? n : null;
    };

    /* En paralelo y cada una con su propio catch: que Servicios no responda no
       puede dejar sin cifras al resto de la pantalla. */
    const pedir = <T>(p: Promise<T> | undefined) =>
      (p ?? Promise.resolve(null as any)).catch(() => null);

    const [hoy, ords, usuarios, top] = await Promise.all([
      this.verNumeros ? pedir(api.getSalesDayly?.()) : Promise.resolve(null),
      this.verNumeros ? pedir(api.getTotalOrders?.()) : Promise.resolve(null),
      pedir(api.getActiveUsers?.()),
      this.verNumeros ? pedir(api.getTopSellingProducts?.()) : Promise.resolve(null),
    ]);

    /* Si NINGUNA de las dos lecturas de estado respondio, no se sabe como va
       el dia: se dice, en vez de afirmar que todo esta bien. */
    this.vendidoHoy.set(num(hoy?.data?.[0]?.total_sales_today));
    this.tickets.set(num(ords?.data?.[0]?.total_orders));

    const us = Array.isArray(usuarios?.data) ? usuarios.data : [];
    this.equipo.set(us.slice(0, 6));

    const t = top?.data?.[0];
    if (t?.product_name) {
      this.estrella.set({ nombre: String(t.product_name), piezas: Number(t.total_sold || 0) });
    }

    this.cargando.set(false);
  }
}
