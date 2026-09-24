import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';
import { AuthService, PAQUETES } from '../../services/auth.service';
import { GiroServiciosService, hoyLocal, moverDias } from '../../core';
import {
  Ausencia, Cita, Profesional, ServiciosService,
} from '../../modulo-servicios/servicios.service';
import {
  BloqueCita, Ventana, aY, bloquesDe, comoHora, horasDe, minutosDe, ventanaDe,
} from '../../modulo-servicios/agenda/agenda-layout';

/**
 * SERVICIOS EN TOUCH — EL DÍA MANDA (dirección A).
 *
 * En una tableta detrás del mostrador de una estética, la pregunta no es
 * «¿qué órdenes tengo?»: es «¿quién viene ahora y quién sigue?». Por eso la
 * agenda no es una pestaña más, es LA pantalla, y lo único que la acompaña es
 * lo que hace falta en ese momento: quién está sentado y qué viene después.
 *
 * QUÉ COMPARTE CON EL BACKOFFICE, Y QUÉ NO
 * ----------------------------------------
 * Comparte todo lo que decide: el servicio (`ServiciosService`), el motor de
 * solapes, el giro y la aritmética de colocar bloques en un día, que vive en
 * `agenda-layout.ts` justamente para no tener dos versiones de la misma
 * cuenta. Lo único propio es la ergonomía: la hora mide 96 px en vez de 64
 * porque el dedo es más gordo que el cursor, y las acciones de una cita se
 * abren en una hoja inferior en vez de un menú.
 *
 * NO ES UN MÓDULO APARTE. Es la misma arquitectura con otra piel, igual que
 * el punto de venta Touch es el mismo Core que Retail.
 */
@Component({
  selector: 'app-touch-servicios',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './touch-servicios.html',
  styleUrls: ['../touch-pos.css', './touch-servicios.css'],
})
export class TouchServicios {
  private readonly srv = inject(ServiciosService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly giro = inject(GiroServiciosService);

  /** Más alto que en el escritorio: se toca con el dedo, no con el cursor. */
  readonly altoHora = 96;

  readonly hoy = hoyLocal();
  readonly dia = signal(this.hoy);
  readonly cargando = signal(true);

  readonly profesionales = signal<Profesional[]>([]);
  readonly citas = signal<Cita[]>([]);
  readonly ausencias = signal<Ausencia[]>([]);
  readonly horarios = signal<{ professional_id: number; starts_at: unknown; ends_at: unknown }[]>([]);

  /** La cita cuyas acciones están abiertas en la hoja inferior. */
  readonly hoja = signal<Cita | null>(null);

  get puedeOperar(): boolean { return this.auth.puede(PAQUETES.SERVICIOS_OPERAR); }

  constructor() {
    void this.giro.cargar();
    void this.cargar();
  }

  // ------------------------------------------------------------- los datos
  async cargar() {
    this.cargando.set(true);
    /* Las mismas tres llamadas que hace la agenda del Backoffice, y por el
       mismo servicio: los horarios encuadran la ventana, las citas y las
       ausencias la llenan. */
    const [pros, dia, horario] = await Promise.all([
      this.srv.profesionales({ soloActivos: true }),
      this.srv.citas({ desde: this.dia() + 'T00:00:00', hasta: this.dia() + 'T23:59:59' }),
      this.srv.horario(),
    ]);
    this.profesionales.set(pros.ok ? pros.datos : []);
    this.citas.set(dia.ok ? dia.datos.citas : []);
    this.ausencias.set(dia.ok ? dia.datos.ausencias : []);
    this.horarios.set(horario.ok ? (horario.datos.franjas as any) : []);
    this.cargando.set(false);
  }

  irA(dia: string) { this.dia.set(dia); void this.cargar(); }

  mover(dias: number) { this.irA(moverDias(this.dia(), dias)); }

  // ------------------------------------------------------- la colocación
  readonly ventana = computed<Ventana>(() =>
    ventanaDe(this.horarios(), this.citas(), this.ausencias()));

  readonly horas = computed(() => horasDe(this.ventana()));

  /**
   * Las columnas. En una tableta caben TRES antes de que un nombre deje de
   * leerse; el resto se dice, no se esconde en silencio.
   */
  readonly MAX_COLUMNAS = 3;

  readonly columnas = computed<Profesional[]>(() => {
    const conTrabajo = new Set(this.citas().map(c => c.professional_id));
    return [...this.profesionales()]
      .sort((a, b) => {
        const ta = conTrabajo.has(a.id) ? 0 : 1;
        const tb = conTrabajo.has(b.id) ? 0 : 1;
        return ta - tb || a.full_name.localeCompare(b.full_name, 'es');
      })
      .slice(0, this.MAX_COLUMNAS);
  });

  readonly ocultas = computed(() =>
    Math.max(0, this.profesionales().length - this.columnas().length));

  readonly alto = computed(() =>
    ((this.ventana().hasta - this.ventana().desde) / 60) * this.altoHora);

  citasDe(profesionalId: number): BloqueCita<Cita>[] {
    return bloquesDe(
      this.citas().filter(c => c.professional_id === profesionalId),
      this.ventana(), this.altoHora,
      /* 34 px: lo mínimo que se lee y se toca con el dedo. */
      34);
  }

  /** Dónde va la línea de ahora, o `null` si hoy no es el día que se mira. */
  lineaAhora(): number | null {
    if (this.dia() !== this.hoy) return null;
    const ahora = new Date();
    const m = ahora.getHours() * 60 + ahora.getMinutes();
    const v = this.ventana();
    if (m < v.desde || m > v.hasta) return null;
    return aY(m, v, this.altoHora);
  }

  etiquetaHora(h: number): string { return comoHora(h * 60); }

  rango(c: Cita): string {
    return `${comoHora(minutosDe(c.starts_at))} – ${comoHora(minutosDe(c.ends_at))}`;
  }

  // ------------------------------------------------------- ahora y después
  /** Lo que está ocurriendo en este momento. */
  readonly enCurso = computed<Cita | null>(() => {
    if (this.dia() !== this.hoy) return null;
    const ahora = new Date().getHours() * 60 + new Date().getMinutes();
    return this.citas().find(c =>
      minutosDe(c.starts_at) <= ahora && ahora < minutosDe(c.ends_at)
      && (c.status === 'AGENDADA' || c.status === 'CONFIRMADA' || c.status === 'ATENDIDA')) ?? null;
  });

  /** Las dos siguientes. Más de dos en pantalla dejan de mirarse. */
  readonly siguientes = computed<Cita[]>(() => {
    const ahora = this.dia() === this.hoy
      ? new Date().getHours() * 60 + new Date().getMinutes()
      : 0;
    return this.citas()
      .filter(c => minutosDe(c.starts_at) >= ahora
                && (c.status === 'AGENDADA' || c.status === 'CONFIRMADA'))
      .sort((a, b) => minutosDe(a.starts_at) - minutosDe(b.starts_at))
      .slice(0, 3);
  });

  nombreDe(profesionalId: number | null): string {
    return this.profesionales().find(p => p.id === profesionalId)?.full_name ?? 'Sin asignar';
  }

  iniciales(nombre: string): string {
    const p = String(nombre || '').trim().split(/\s+/).filter(Boolean);
    return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() || '?';
  }

  // ---------------------------------------------------------- las acciones
  abrir(c: Cita) {
    if (!this.puedeOperar) return;
    this.hoja.set(c);
  }

  cerrarHoja() { this.hoja.set(null); }

  /**
   * El cliente llegó: se abre su orden con lo que ya se sabe.
   *
   * Es el gesto del día en este giro, así que es la acción principal de la
   * hoja y no una opción más de un menú. El procedimiento traslada cliente,
   * profesional, servicio y hora: aquí no se vuelve a capturar nada.
   */
  async llego(c: Cita) {
    const r = await this.srv.citaAOrden(c.id);
    if (!r.ok) { await this.aviso('No se pudo abrir la orden', r.error); return; }
    this.cerrarHoja();
    const id = r.datos?.cabecera?.id;
    if (id) void this.router.navigate(['/dashboard/ordenes-de-servicio/orden', id]);
    else await this.cargar();
  }

  async marcar(c: Cita, estado: 'CONFIRMADA' | 'CANCELADA' | 'NO_ASISTIO') {
    const r = await this.srv.cambiarEstadoCita(c.id, estado);
    if (!r.ok) { await this.aviso('No se pudo guardar', r.error); return; }
    this.cerrarHoja();
    await this.cargar();
  }

  private async aviso(titulo: string, texto?: string) {
    await Swal.fire({ icon: 'error', title: titulo, text: texto });
  }

  etiquetaEstado(s: string): string {
    return ({
      AGENDADA: 'Agendada', CONFIRMADA: 'Confirmada', ATENDIDA: 'Atendida',
      CANCELADA: 'Cancelada', NO_ASISTIO: 'No llegó',
    } as Record<string, string>)[s] ?? s;
  }

  // ------------------------------------------------------------ navegación
  aVender() { void this.router.navigate(['/touch']); }
  aOrdenes() { void this.router.navigate(['/dashboard/ordenes-de-servicio/ordenes']); }
}
