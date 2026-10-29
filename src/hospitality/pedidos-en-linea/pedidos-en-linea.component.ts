import {
  ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal,
} from '@angular/core';
import { CurrencyPipe, NgClass, NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';
import * as QRCode from 'qrcode';
import { CapabilityService, MesaService } from '../../core';
import {
  ConfigMenuEnLinea, PedidoEnLinea, PedidosEnLineaService, URL_MENU,
} from '../../core/pedidos-en-linea.service';
import { AuthService, PAQUETES } from '../../services/auth.service';
import { ADDON } from '../../app/marca/addon';

/** Cada cuánto se relee la bandeja: los pedidos bajan de la nube cada 20 s. */
const REFRESCO_MS = 6000;

const ESTADOS: Record<string, string> = {
  RECIBIDO: 'Por aceptar', ACEPTADO: 'Aceptado', PREPARANDO: 'En preparación', LISTO: 'Listo para recoger',
  ENTREGADO: 'Entregado', RECHAZADO: 'Rechazado', CANCELADO: 'Cancelado',
};

/**
 * PEDIDOS EN LÍNEA (0067).
 *
 * Arriba lo que espera respuesta: quién, qué y cuánto, con Aceptar y
 * Rechazar. Aceptar abre la cuenta con su número del día y la manda a
 * cocina por el mismo camino que Touch; no cobra. Abajo, los de hoy con el
 * estado que ve el cliente y «Cobrar» cuando lo recoge.
 *
 * Quien administra el negocio también publica aquí el menú: su dirección,
 * el tiempo estimado y el QR para el mostrador, las mesas o las redes.
 */
@Component({
  selector: 'app-pedidos-en-linea',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, CurrencyPipe, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pedidos-en-linea.component.html',
  styleUrls: ['../hx.css', './pedidos-en-linea.component.css'],
})
export class PedidosEnLineaComponent implements OnInit, OnDestroy {
  private readonly servicio = inject(PedidosEnLineaService);
  private readonly mesas = inject(MesaService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly caps = inject(CapabilityService);

  readonly config = signal<ConfigMenuEnLinea | null>(null);
  readonly lista = signal<PedidoEnLinea[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly trabajando = signal<number | null>(null);
  readonly configurando = signal(false);
  readonly qr = signal<string | null>(null);
  readonly guardando = signal(false);

  /** El formulario de configuración (solo administración). */
  form = { activo: false, recibePedidos: true, slug: '', minutos: 15, mensaje: '' };

  readonly pendientes = computed(() => this.lista().filter(p => p.estado === 'PENDIENTE'));
  readonly deHoy = computed(() => this.lista().filter(p => p.estado !== 'PENDIENTE'));
  readonly url = computed(() => (this.config()?.slug ? `${URL_MENU}${this.config()!.slug}` : null));

  get puedeConfigurar(): boolean { return this.auth.puede(PAQUETES.CONFIGURACION_ADMINISTRAR); }

  private reloj: any = null;
  private readonly alVolver = () => { if (document.visibilityState === 'visible') void this.leer(); };

  ngOnInit(): void {
    this.servicio.escuchar();
    void this.leer(true);
    this.reloj = setInterval(() => void this.leer(), REFRESCO_MS);
    document.addEventListener('visibilitychange', this.alVolver);
  }

  ngOnDestroy(): void {
    clearInterval(this.reloj);
    document.removeEventListener('visibilitychange', this.alVolver);
  }

  async leer(conConfig = false): Promise<void> {
    if (conConfig) {
      const c = await this.servicio.config();
      if (c.ok) {
        this.config.set(c.datos);
        this.form = { activo: c.datos.activo, recibePedidos: c.datos.recibePedidos, slug: c.datos.slug ?? '',
                      minutos: c.datos.minutos, mensaje: c.datos.mensaje ?? '' };
        void this.pintarQr();
      }
    }
    const r = await this.servicio.pedidos();
    this.cargando.set(false);
    if (!r.ok) { this.error.set(r.error); return; }
    this.error.set(null);
    this.lista.set(r.datos);
  }

  async aceptar(p: PedidoEnLinea): Promise<void> {
    if (this.trabajando()) return;
    this.trabajando.set(p.id);
    try {
      const r = await this.servicio.aceptar(p.id);
      if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se aceptó', text: r.error }); return; }
      void Swal.fire({ icon: 'success', title: `Pedido ${r.datos.numero}`, text: `${p.nombre} ya está en cocina. Se cobra al recoger.`,
                       timer: 2200, showConfirmButton: false });
      await this.leer();
    } finally { this.trabajando.set(null); }
  }

  async rechazar(p: PedidoEnLinea): Promise<void> {
    const { value } = await Swal.fire({
      title: `Rechazar el pedido de ${p.nombre}`,
      input: 'text',
      inputLabel: 'El cliente va a leer el motivo',
      inputPlaceholder: 'Se nos acabó, ya vamos a cerrar…',
      showCancelButton: true,
      confirmButtonText: 'Rechazar',
      cancelButtonText: 'Volver',
      inputValidator: (v) => (!String(v || '').trim() ? 'Escribe el motivo.' : null),
    });
    if (!value) return;
    this.trabajando.set(p.id);
    try {
      const r = await this.servicio.rechazar(p.id, String(value).trim());
      if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se rechazó', text: r.error }); return; }
      await this.leer();
    } finally { this.trabajando.set(null); }
  }

  /** Lo recoge: su cuenta se carga en la venta y se cobra como cualquier otra. */
  async cobrar(p: PedidoEnLinea): Promise<void> {
    if (!p.cuentaId) return;
    const r = await this.mesas.cargar(p.cuentaId);
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se abrió la cuenta', text: r.error }); return; }
    await this.router.navigateByUrl(this.caps.rutaDeVenta);
  }

  async sincronizar(): Promise<void> {
    const r = await this.servicio.sincronizar();
    if (!r.ok) await Swal.fire({ icon: 'info', title: 'Sin conexión', text: r.error });
    await this.leer(true);
  }

  async guardar(): Promise<void> {
    if (this.guardando()) return;
    this.guardando.set(true);
    try {
      const r = await this.servicio.guardar({ ...this.form, slug: this.form.slug.trim().toLowerCase(), marca: await marcaDelAddon() });
      if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se guardó', text: r.error }); return; }
      await this.leer(true);
      if (r.datos.publicado?.error) {
        await Swal.fire({ icon: 'info', title: 'Guardado', text: 'Se publica en cuanto haya conexión con la nube.' });
      }
    } finally { this.guardando.set(false); }
  }

  private async pintarQr(): Promise<void> {
    const u = this.url();
    this.qr.set(u ? await QRCode.toDataURL(`${u}?origen=mostrador`, { width: 320, margin: 1, color: { dark: '#0F1826', light: '#FFFFFF' } }) : null);
  }

  etiqueta(e: string): string { return ESTADOS[e] ?? e; }

  /** «Hace 3 min». Un pedido que espera se mide en minutos. */
  hace(p: PedidoEnLinea): string {
    const min = p.minutos;
    return min < 1 ? 'Ahora' : min < 60 ? `Hace ${min} min` : `Hace ${Math.floor(min / 60)} h ${min % 60}`;
  }

  /** Más de 5 minutos sin respuesta: se marca. */
  tarde(p: PedidoEnLinea): boolean { return p.minutos > 5; }

  cobrable(p: PedidoEnLinea): boolean {
    return p.estado === 'ACEPTADO' && !!p.cuentaId && !['ENTREGADO', 'CANCELADO'].includes(p.estadoCliente);
  }

  volver() { void this.router.navigateByUrl('/touch'); }
  porId = (_: number, x: { id: number }) => x.id;
}

/** La marca del addon (hueco `menuEnLinea`), con el logo ya como data URL. */
async function marcaDelAddon(): Promise<{ logo: string | null; color: string; acento: string | null } | null> {
  const m = ADDON?.menuEnLinea;
  if (!m) return null;
  let logo: string | null = null;
  if (m.logo) {
    try {
      const b = await (await fetch(m.logo)).blob();
      logo = await new Promise<string>((ok, mal) => { const f = new FileReader(); f.onload = () => ok(String(f.result)); f.onerror = mal; f.readAsDataURL(b); });
    } catch { logo = null; }
  }
  return { logo, color: m.color, acento: m.acento ?? null };
}
