import {
  ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal,
} from '@angular/core';
import { CurrencyPipe, NgClass, NgFor, NgIf } from '@angular/common';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';
import { AreaSalon, CapabilityService, MesaSalon, MesaService } from '../../core';
import { AuthService, PAQUETES } from '../../services/auth.service';
import { MesitaComponent } from '../mesita/mesita.component';
import { iconoDeArea, nombreDeMesa } from '../hx';

interface Zona {
  area: AreaSalon;
  icono: string;
  mesas: MesaSalon[];
  ocupadas: number;
}

/** Cada cuanto se relee el salon: otra caja pudo abrir o cobrar una mesa. */
const REFRESCO_MS = 8000;

/**
 * EL SALON.
 *
 * Una rejilla de mesas con TRES estados a la vista -libre, abierta, por
 * cobrar- y, cuando aporta, lo que pasa en cocina: cuantas comandas se estan
 * preparando y cuantas estan listas para llevar. Nada mas: un mesero con una
 * charola en la mano tiene que leerla de un vistazo.
 *
 * Tocar una mesa la abre (o toma su cuenta si ya la tiene) y lleva a la
 * pantalla de venta de esta caja con esa cuenta cargada. Ahi se pide, se
 * envia a cocina y se cobra con el cobro de siempre.
 */
@Component({
  selector: 'app-mesas',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, CurrencyPipe, MesitaComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './mesas.component.html',
  styleUrls: ['../hx.css', './mesas.component.css'],
})
export class MesasComponent implements OnInit, OnDestroy {
  private readonly mesas = inject(MesaService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  readonly caps = inject(CapabilityService);

  readonly areas = signal<AreaSalon[]>([]);
  readonly todas = signal<MesaSalon[]>([]);
  readonly area = signal<number | null>(null);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly abriendo = signal<number | null>(null);

  /** En Touch la pantalla va sin el panel: necesita su propia salida. */
  readonly enTouch = this.router.url.startsWith('/touch');

  /**
   * El salon por AREAS, en su orden. Con «Todas» se ven todas agrupadas: un
   * mesero piensa «la terraza», no «la mesa 14 de una lista».
   */
  readonly zonas = computed<Zona[]>(() => {
    const a = this.area();
    return this.areas()
      .filter(x => a == null || x.id === a)
      .map(area => {
        const mesas = this.todas().filter(m => m.area_id === area.id);
        return { area, icono: iconoDeArea(area.nombre), mesas, ocupadas: mesas.filter(m => m.estado !== 'LIBRE').length };
      })
      .filter(z => z.mesas.length);
  });

  readonly resumen = computed(() => {
    const m = this.todas();
    const ocupadas = m.filter(x => x.estado !== 'LIBRE');
    return {
      libres: m.length - ocupadas.length,
      abiertas: m.filter(x => x.estado === 'ABIERTA').length,
      porCobrar: m.filter(x => x.estado === 'POR_COBRAR').length,
      /* Mesas con algo listo en cocina esperando a que alguien lo lleve. */
      listas: m.filter(x => x.comandas_listas > 0).length,
      enMesas: ocupadas.reduce((t, x) => t + Number(x.total || 0), 0),
    };
  });

  get puedeConfigurar(): boolean { return this.auth.puede(PAQUETES.CONFIGURACION_ADMINISTRAR); }

  private reloj: any = null;
  private readonly alVolver = () => { if (document.visibilityState === 'visible') void this.leer(); };

  ngOnInit(): void {
    void this.leer();
    this.reloj = setInterval(() => void this.leer(), REFRESCO_MS);
    document.addEventListener('visibilitychange', this.alVolver);
  }

  ngOnDestroy(): void {
    clearInterval(this.reloj);
    document.removeEventListener('visibilitychange', this.alVolver);
  }

  async leer(): Promise<void> {
    const r = await this.mesas.salon();
    this.cargando.set(false);
    if (!r.ok) { this.error.set(r.error); return; }
    this.error.set(null);
    this.areas.set(r.datos.areas);
    this.todas.set(r.datos.mesas);
  }

  nombreArea(id: number): string {
    return this.areas().find(a => a.id === id)?.nombre ?? '';
  }

  etiqueta(m: MesaSalon): string {
    return m.estado === 'LIBRE' ? 'Libre' : m.estado === 'POR_COBRAR' ? 'Por cobrar' : 'Abierta';
  }

  readonly nombreDeMesa = nombreDeMesa;

  mesasEnArea(id: number): number { return this.todas().filter(m => m.area_id === id).length; }

  /** «Recién abierta», «25 min», «1 h 10». Lo que se dice en voz alta. */
  tiempo(m: MesaSalon): string {
    const min = Number(m.minutos ?? 0);
    if (min < 1) return 'Recién abierta';
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60), r = min % 60;
    return r ? `${h} h ${r}` : `${h} h`;
  }

  /** Mas de hora y media sentada: se marca, sin alarmas. */
  larga(m: MesaSalon): boolean { return Number(m.minutos ?? 0) >= 90; }

  /** Una cuenta abierta sin nada pedido: se puede liberar sin cobrar. */
  vacia(m: MesaSalon): boolean { return m.estado !== 'LIBRE' && !m.lineas; }

  async abrir(m: MesaSalon): Promise<void> {
    if (this.abriendo()) return;
    this.abriendo.set(m.id);
    try {
      const r = await this.mesas.abrirMesa(m.id);
      if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se pudo abrir', text: r.error }); return; }
      await this.router.navigateByUrl(this.caps.rutaDeVenta);
    } finally {
      this.abriendo.set(null);
    }
  }

  /** La barra o un «para llevar» que espera: una cuenta con nombre, sin mesa. */
  async cuentaSinMesa(): Promise<void> {
    const { value } = await Swal.fire({
      title: 'Cuenta sin mesa',
      input: 'text',
      inputLabel: '¿A nombre de quién?',
      inputPlaceholder: 'Barra, Ana, pedido 12…',
      showCancelButton: true,
      confirmButtonText: 'Abrir',
      cancelButtonText: 'Cancelar',
      inputValidator: (v) => (!String(v || '').trim() ? 'Escribe un nombre.' : null),
    });
    if (!value) return;
    const r = await this.mesas.abrirCuenta(String(value).trim());
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se pudo abrir', text: r.error }); return; }
    await this.router.navigateByUrl(this.caps.rutaDeVenta);
  }

  /** Solo se ofrece con la mesa sin consumo: con consumo, se cobra. */
  async liberar(m: MesaSalon, e: Event): Promise<void> {
    e.stopPropagation();
    if (!m.cuenta_id) return;
    const r = await this.mesas.liberar(m.cuenta_id);
    if (!r.ok) { await Swal.fire({ icon: 'info', title: 'No se liberó', text: r.error }); return; }
    await this.leer();
  }

  configurar() { void this.router.navigateByUrl('/dashboard/salon'); }
  volver() { void this.router.navigateByUrl('/touch'); }

  porId = (_: number, x: { id: number }) => x.id;
  porZona = (_: number, z: Zona) => z.area.id;
}
