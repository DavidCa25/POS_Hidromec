import {
  ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal,
} from '@angular/core';
import { NgClass, NgFor, NgIf } from '@angular/common';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';
import { CapabilityService } from '../../core';
import { AuthService, PAQUETES } from '../../services/auth.service';
import { colorEstacion, nombreDeMesa } from '../hx';
import { WxMenuComponent, WxMenuOpcion } from '../../app/wx-menu/wx-menu.component';

const OPC_REIMPRIMIR: WxMenuOpcion = { valor: 'reimprimir', etiqueta: 'Reimprimir', icono: 'ph ph-printer' };
const OPC_CANCELAR: WxMenuOpcion = { valor: 'cancelar', etiqueta: 'Cancelar comanda', icono: 'ph ph-x-circle' };
const ACC_AMBAS = [OPC_REIMPRIMIR, OPC_CANCELAR];
const ACC_REIMPRIMIR = [OPC_REIMPRIMIR];
const ACC_CANCELAR = [OPC_CANCELAR];

type Estado = 'NUEVA' | 'PREPARANDO' | 'LISTA' | 'ENTREGADA' | 'CANCELADA';

interface LineaKds { id: number; nombre: string; cantidad: number; nota: string | null; opciones: string[]; }

interface ComandaKds {
  id: number;
  estacion: string;
  station_id: number;
  estado: Estado;
  destino: string;
  area: string | null;
  /** Segundos que llevaba al leerla; el reloj de la pantalla suma desde ahi. */
  segundos: number;
  leidaEn: number;
  lineas: LineaKds[];
}

interface Estacion { id: number; nombre: string; salida: string; impresora: string | null; }

interface Carril { estado: Estado; titulo: string; vacio: string; comandas: ComandaKds[]; }

/** Cada cuanto se relee: otra caja pudo enviar algo. */
const REFRESCO_MS = 4000;
/** Cuando una comanda empieza a pedir atencion, y cuando ya esta atrasada. */
const AVISO_MIN = 8;
const ATRASO_MIN = 15;
const LLAVE_ESTACION = 'wx-kds-estacion';

/**
 * LA PANTALLA DE COCINA.
 *
 * Esta pantalla se mira de pie, a un metro, con las manos ocupadas y durante
 * todo un turno. Por eso:
 *
 *   - cada tarjeta dice lo justo: numero, para quien, cuanto lleva, y que
 *     preparar con sus opciones y notas, en letra grande;
 *   - hay UN boton por tarjeta, el siguiente paso, y ocupa todo el ancho;
 *   - el unico color que cambia es el del tiempo: la tarjeta se calienta a los
 *     8 minutos y se marca a los 15. Nada parpadea;
 *   - no hay menus ni tablas: no es un tablero de administracion.
 *
 * La estacion elegida se recuerda en ESTE equipo: la pantalla de la barra
 * amanece mostrando la barra.
 */
@Component({
  selector: 'app-kds',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, WxMenuComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './kds.component.html',
  styleUrls: ['../hx.css', './kds.component.css'],
})
export class KdsComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly caps = inject(CapabilityService);

  readonly estaciones = signal<Estacion[]>([]);
  readonly estacion = signal<number | null>(this.leerEstacion());
  /** TODAS las comandas pendientes; la estacion se filtra aqui. Asi cada
      pestana sabe cuantas tiene y cambiar de estacion es instantaneo. */
  readonly todas = signal<ComandaKds[]>([]);
  readonly comandas = computed(() => {
    const e = this.estacion();
    return e == null ? this.todas() : this.todas().filter(c => c.station_id === e);
  });
  readonly error = signal<string | null>(null);
  readonly ocupada = signal<number | null>(null);
  readonly ahora = signal(Date.now());
  readonly leidaEn = signal<number | null>(null);

  /** Tres carriles, en el orden en que viaja una comanda. */
  readonly carriles = computed<Carril[]>(() => {
    const c = this.comandas();
    return [
      { estado: 'NUEVA', titulo: 'Nuevas', vacio: 'Nada nuevo por ahora', comandas: c.filter(x => x.estado === 'NUEVA') },
      { estado: 'PREPARANDO', titulo: 'En preparación', vacio: 'Nada en el fuego', comandas: c.filter(x => x.estado === 'PREPARANDO') },
      /* «para llevar» se confundia con el pedido para llevar: es «para salir». */
      { estado: 'LISTA', titulo: 'Listas para salir', vacio: 'Nada esperando', comandas: c.filter(x => x.estado === 'LISTA') },
    ];
  });

  /**
   * Cada carril ocupa lo que carga: uno vacio se encoge y uno con cinco
   * comandas se ensancha hasta repartirlas en dos columnas. Sin esto, diez
   * comandas nuevas forman una torre mientras los otros carriles miran.
   */
  readonly columnas = computed(() => this.carriles()
    .map(k => {
      const n = k.comandas.length;
      const peso = n === 0 ? 0.7 : n <= 2 ? 1 : n <= 4 ? 1.5 : 2;
      return `minmax(0, ${peso}fr)`;
    })
    .join(' '));

  /** La hora de pared: en una cocina se trabaja contra el reloj. */
  readonly hora = computed(() => {
    const d = new Date(this.ahora());
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });

  readonly haceSegundos = computed(() => {
    const l = this.leidaEn();
    return l == null ? null : Math.max(0, Math.round((this.ahora() - l) / 1000));
  });

  readonly cuentas = computed(() => {
    const c = this.comandas();
    return {
      nuevas: c.filter(x => x.estado === 'NUEVA').length,
      preparando: c.filter(x => x.estado === 'PREPARANDO').length,
      listas: c.filter(x => x.estado === 'LISTA').length,
      atrasadas: c.filter(x => x.estado !== 'LISTA' && this.minutos(x) >= ATRASO_MIN).length,
    };
  });

  get puedeCancelar(): boolean { return this.auth.puede(PAQUETES.VENTAS_SUPERVISAR); }

  private get api(): any { return (window as any).wybix; }
  private relojDatos: any = null;
  private relojSegundos: any = null;

  ngOnInit(): void {
    void this.cargarEstaciones();
    void this.leer();
    this.relojDatos = setInterval(() => void this.leer(), REFRESCO_MS);
    this.relojSegundos = setInterval(() => this.ahora.set(Date.now()), 1000);
  }

  ngOnDestroy(): void {
    clearInterval(this.relojDatos);
    clearInterval(this.relojSegundos);
  }

  private leerEstacion(): number | null {
    try { const v = Number(localStorage.getItem(LLAVE_ESTACION)); return v > 0 ? v : null; } catch { return null; }
  }

  elegir(id: number | null) {
    this.estacion.set(id);
    try {
      if (id) localStorage.setItem(LLAVE_ESTACION, String(id)); else localStorage.removeItem(LLAVE_ESTACION);
    } catch { /* sin almacenamiento: se elige cada vez */ }
  }

  pendientesDe(id: number | null): number {
    return id == null ? this.todas().length : this.todas().filter(c => c.station_id === id).length;
  }

  readonly colorEstacion = colorEstacion;
  readonly nombreDeMesa = nombreDeMesa;

  /** Cuanto del margen lleva gastado: 0 al llegar, 1 al atrasarse. */
  avance(c: ComandaKds): number {
    if (c.estado === 'LISTA') return 1;
    const s = c.segundos + (this.ahora() - c.leidaEn) / 1000;
    return Math.max(0.02, Math.min(1, s / (ATRASO_MIN * 60)));
  }

  icono(e: Estado): string {
    return e === 'NUEVA' ? 'ph-play' : e === 'PREPARANDO' ? 'ph-bell-simple' : 'ph-check-circle';
  }

  /**
   * Reimprimir y cancelar salen del pie a un menu «···»: son de vez en cuando,
   * y dos botones fijos por tarjeta competian con el paso, que es lo de cada
   * minuto. Sin acciones posibles, no hay menu.
   */
  accionesDe(c: ComandaKds): WxMenuOpcion[] | null {
    /* Arreglos FIJOS: la pantalla se repinta cada segundo por el reloj, y un
       arreglo nuevo en cada pasada rehacia el menu abierto bajo el dedo. */
    const imp = this.tieneImpresora(c), can = this.puedeCancelar;
    return imp && can ? ACC_AMBAS : imp ? ACC_REIMPRIMIR : can ? ACC_CANCELAR : null;
  }

  alElegir(c: ComandaKds, accion: string) {
    if (accion === 'reimprimir') void this.reimprimir(c);
    if (accion === 'cancelar') void this.cancelar(c);
  }

  private async cargarEstaciones() {
    const r = await this.api?.estaciones?.listar();
    if (r?.success) this.estaciones.set(r.data || []);
  }

  async leer(): Promise<void> {
    const r = await this.api?.kds?.listar({ stationId: null });
    if (!r?.success) { this.error.set(r?.error || 'No se pudieron leer las comandas.'); return; }
    this.error.set(null);
    const [cab = [], lineas = [], opciones = []] = r.sets || [];
    const ahora = Date.now();
    this.leidaEn.set(ahora);
    this.todas.set(cab.map((c: any) => ({
      id: c.id,
      estacion: c.estacion,
      station_id: c.station_id,
      estado: c.estado,
      destino: c.destino,
      area: c.area ?? null,
      segundos: Number(c.segundos || 0),
      leidaEn: ahora,
      lineas: (lineas as any[]).filter(l => l.comanda_id === c.id).map(l => ({
        id: l.id,
        nombre: l.nombre,
        cantidad: Number(l.cantidad),
        nota: l.nota ?? null,
        opciones: (opciones as any[]).filter(o => o.linea_id === l.id)
          .map(o => (o.quantity > 1 ? `${o.quantity}× ` : '') + o.option_name),
      })),
    })));
  }

  // --------------------------------------------------------------- tiempo
  minutos(c: ComandaKds): number {
    return Math.floor((c.segundos + (this.ahora() - c.leidaEn) / 1000) / 60);
  }

  reloj(c: ComandaKds): string {
    const s = Math.max(0, Math.floor(c.segundos + (this.ahora() - c.leidaEn) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  temperatura(c: ComandaKds): 'fria' | 'aviso' | 'atraso' {
    if (c.estado === 'LISTA') return 'fria';
    const m = this.minutos(c);
    return m >= ATRASO_MIN ? 'atraso' : m >= AVISO_MIN ? 'aviso' : 'fria';
  }

  // ---------------------------------------------------------------- pasos
  siguiente(c: ComandaKds): { estado: Estado; texto: string } | null {
    if (c.estado === 'NUEVA') return { estado: 'PREPARANDO', texto: 'Empezar' };
    if (c.estado === 'PREPARANDO') return { estado: 'LISTA', texto: 'Lista' };
    if (c.estado === 'LISTA') return { estado: 'ENTREGADA', texto: 'Entregada' };
    return null;
  }

  etiquetaEstado(e: Estado): string {
    return e === 'NUEVA' ? 'Nueva' : e === 'PREPARANDO' ? 'Preparando' : e === 'LISTA' ? 'Lista' : e;
  }

  async avanzar(c: ComandaKds): Promise<void> {
    const paso = this.siguiente(c);
    if (!paso || this.ocupada()) return;
    this.ocupada.set(c.id);
    try {
      const r = await this.api?.kds?.estado({ comandaId: c.id, estado: paso.estado });
      if (!r?.success) this.error.set(r?.error || 'No se pudo cambiar la comanda.');
      await this.leer();
    } finally {
      this.ocupada.set(null);
    }
  }

  tieneImpresora(c: ComandaKds): boolean {
    const e = this.estaciones().find(x => x.id === c.station_id);
    return !!e && (e.salida === 'IMPRESORA' || e.salida === 'AMBOS') && !!e.impresora;
  }

  async reimprimir(c: ComandaKds): Promise<void> {
    const r = await this.api?.kds?.reimprimir({ comandaId: c.id });
    if (!r?.success) await Swal.fire({ icon: 'error', title: 'No se imprimió', text: r?.error });
  }

  async cancelar(c: ComandaKds): Promise<void> {
    const { value, isConfirmed } = await Swal.fire({
      icon: 'warning',
      title: `¿Cancelar la comanda #${c.id}?`,
      text: 'Lo pedido sale de la cuenta y no se cobra.',
      input: 'text',
      inputLabel: 'Motivo',
      inputPlaceholder: 'Se acabó, el cliente cambió de opinión…',
      showCancelButton: true,
      confirmButtonText: 'Cancelar comanda',
      cancelButtonText: 'Volver',
      confirmButtonColor: '#dc2626',
    });
    if (!isConfirmed) return;
    const r = await this.api?.kds?.cancelar({ comandaId: c.id, motivo: value || null });
    if (!r?.success) await Swal.fire({ icon: 'error', title: 'No se canceló', text: r?.error });
    await this.leer();
  }

  salir() { void this.router.navigateByUrl(this.caps.touchPos ? '/touch' : '/dashboard/inicio'); }

  porId = (_: number, x: { id: number }) => x.id;
  porCarril = (_: number, c: Carril) => c.estado;
}
