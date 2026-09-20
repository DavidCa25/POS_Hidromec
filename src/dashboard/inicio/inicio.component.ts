import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { NgClass, NgFor, NgIf } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService, PAQUETES } from '../../services/auth.service';
import { CapabilityService, GiroServiciosService } from '../../core';
import { WxAvatarComponent } from '../../app/wx-avatar/wx-avatar.component';
import { WxMascotaComponent } from '../../app/wx-mascota/wx-mascota.component';

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
 * DONDE ESTA WYBIX
 * ----------------
 * En dos sitios, y en ninguno decora:
 *
 *   - Junto al saludo, en reposo. Es la unica presencia constante, y es la que
 *     dice "esto esta vivo y no ha pasado nada".
 *   - Junto a la lista de pendientes, en atencion, Y SOLO SI HAY PENDIENTES.
 *     No habla desde el saludo: reacciona a un hecho. Un dia sin pendientes no
 *     tiene mascota de atencion, que es justo lo que la hace significar algo.
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
  readonly pendientes = signal<Pendiente[]>([]);
  readonly equipo = signal<{ id: number; usuario: string; rol: string }[]>([]);
  readonly estrella = signal<{ nombre: string; piezas: number } | null>(null);

  constructor(
    private router: Router,
    public auth: AuthService,
    public caps: CapabilityService,
    private giro: GiroServiciosService,
  ) {}

  ngOnInit(): void { void this.cargar(); }

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

  get segundaAccion(): { texto: string; pie: string; icono: string; ruta: string } | null {
    if (this.haceServicios) {
      return {
        texto: 'Nueva orden',
        pie: this.giro.textos.ordenVacia || 'Entra trabajo al taller',
        icono: 'ph-wrench',
        ruta: '/dashboard/ordenes-de-servicio',
      };
    }
    if (this.auth.puede(PAQUETES.INVENTARIO_OPERAR)) {
      return {
        texto: 'Registrar compra',
        pie: 'Entra mercancía al inventario',
        icono: 'ph-bag',
        ruta: '/dashboard/registrarCompra',
      };
    }
    return null;
  }

  get puedeVender(): boolean { return this.auth.puede(PAQUETES.VENTAS_OPERAR); }
  get verNumeros(): boolean { return this.auth.puede(PAQUETES.REPORTES_VER); }

  /** Solo hay mascota de atencion si hay algo a lo que atender. */
  get hayPendientes(): boolean { return this.pendientes().length > 0; }

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

    const [hoy, ords, cuentas, usuarios, top] = await Promise.all([
      this.verNumeros ? pedir(api.getSalesDayly?.()) : Promise.resolve(null),
      this.verNumeros ? pedir(api.getTotalOrders?.()) : Promise.resolve(null),
      pedir(api.alertsCounts?.({ min: 3 })),
      pedir(api.getActiveUsers?.()),
      this.verNumeros ? pedir(api.getTopSellingProducts?.()) : Promise.resolve(null),
    ]);

    this.vendidoHoy.set(num(hoy?.data?.[0]?.total_sales_today));
    this.tickets.set(num(ords?.data?.[0]?.total_orders));

    const c = cuentas?.data ?? {};
    const lista: Pendiente[] = [];
    const sinStock = Number(c.agotados || 0);
    const bajos = Number(c.lowstock || 0);
    const vencidos = Number(c.vencidos || 0);
    const descuadres = Number(c.descuadres || 0);

    if (sinStock > 0) lista.push({
      titulo: `${sinStock} ${sinStock === 1 ? 'producto agotado' : 'productos agotados'}`,
      detalle: 'No se pueden vender hasta reponerlos.',
      tono: 'peligro', accion: 'Reponer', ruta: '/dashboard/alertas',
    });
    if (bajos > 0) lista.push({
      titulo: `${bajos} ${bajos === 1 ? 'producto bajo mínimo' : 'productos bajo mínimo'}`,
      detalle: 'Quedan pocas piezas. Revisa antes de que se acaben.',
      tono: 'aviso', accion: 'Revisar', ruta: '/dashboard/alertas',
    });
    if (vencidos > 0) lista.push({
      titulo: `${vencidos} ${vencidos === 1 ? 'cliente con saldo vencido' : 'clientes con saldo vencido'}`,
      detalle: 'Crédito pasado de fecha.',
      tono: 'aviso', accion: 'Ver', ruta: '/dashboard/clientes',
    });
    if (descuadres > 0) lista.push({
      titulo: `${descuadres} ${descuadres === 1 ? 'corte descuadrado' : 'cortes descuadrados'}`,
      detalle: 'La caja cerró con diferencia en los últimos 30 días.',
      tono: 'peligro', accion: 'Revisar', ruta: '/dashboard/alertas',
    });
    this.pendientes.set(lista);

    const us = Array.isArray(usuarios?.data) ? usuarios.data : [];
    this.equipo.set(us.slice(0, 6));

    const t = top?.data?.[0];
    if (t?.product_name) {
      this.estrella.set({ nombre: String(t.product_name), piezas: Number(t.total_sold || 0) });
    }

    this.cargando.set(false);
  }
}
