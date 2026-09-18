import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';
import { AuthService, PAQUETES } from '../../services/auth.service';
import { Ausencia, Cita, horaDeFranja, Profesional, ServiciosService } from '../servicios.service';

/** Una cita ya colocada: dónde va y de qué color. */
interface Bloque {
  cita: Cita;
  top: number;
  alto: number;
  color: string;
  suave: string;
}

/**
 * LA AGENDA — columnas por persona.
 *
 * Qué hay hoy, quién lo atiende y qué queda libre. Es la pantalla que se mira
 * con el teléfono en la mano.
 *
 * LOS HUECOS NO SE DIBUJAN: SE PULSAN
 * -----------------------------------
 * El espacio vacío de una columna ES el hueco. Dibujar una caja por cada
 * intervalo libre habría llenado la pantalla de recuadros compitiendo con las
 * citas de verdad, que son lo que se vino a ver. Al pulsar en el vacío se
 * agenda ahí, que es lo que se quería hacer.
 *
 * LA VENTANA HORARIA SALE DE LO QUE HAY
 * -------------------------------------
 * No se pintan las veinticuatro horas: se toma la primera hora en la que
 * alguien trabaja y la última, y se añade una de margen. Un taller que abre a
 * las nueve no necesita scrollear seis horas vacías cada mañana.
 *
 * LOS COLORES SON DE DOS SITIOS
 * -----------------------------
 * El cromo —cabecera, botón— toma el color que el negocio eligió, igual que
 * Compras e Inventario. Cada bloque toma el color de SU profesional, que es un
 * dato: con cinco personas, distinguirlas por color es lo que hace la pantalla
 * legible de un vistazo.
 */
@Component({
  selector: 'app-servicios-agenda',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './agenda.component.html',
  styleUrls: ['../servicios.css', './agenda.component.css'],
})
export class ServiciosAgenda {
  private readonly srv = inject(ServiciosService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  /** Un píxel por minuto sería ilegible; 64 px por hora es lo que cabe. */
  readonly altoHora = 64;
  readonly anchoHoras = 58;

  readonly hoy = new Date().toISOString().slice(0, 10);
  readonly dia = signal(this.hoy);
  readonly profesionalId = signal<number | null>(null);

  readonly citas = signal<Cita[]>([]);
  readonly ausencias = signal<Ausencia[]>([]);
  readonly profesionales = signal<Profesional[]>([]);
  readonly servicios = signal<any[]>([]);
  readonly franjas = signal<{ weekday: number; starts_at: string; ends_at: string }[]>([]);
  readonly cargando = signal(false);

  get puedeOperar(): boolean { return this.auth.puede(PAQUETES.SERVICIOS_OPERAR); }

  porProfesional = (_: number, p: Profesional) => p.id;
  porCita = (_: number, b: Bloque) => b.cita.id;

  constructor() { void this.arrancar(); }

  // ------------------------------------------------------------- columnas
  /**
   * CUÁNTAS COLUMNAS CABEN ANTES DE QUE DEJEN DE LEERSE.
   *
   * Con seis, cada una tiene unos 180 px y el nombre del cliente entra. Con
   * nueve —que es lo que tiene un taller mediano— cada bloque queda en «Cliente
   * Age…» y la agenda deja de servir para lo que existe: mirarla y entenderla.
   */
  private static readonly MAX_COLUMNAS = 6;

  /**
   * Quién tiene columna.
   *
   * Con filtro, esa persona sola. Sin filtro, primero quien TIENE algo ese día
   * —citas o ausencia— y después el resto, hasta donde cabe. Un taller con
   * nueve personas de las que tres trabajan hoy ve a esas tres arriba, no a
   * las tres primeras del abecedario.
   */
  readonly columnas = computed<Profesional[]>(() => {
    const id = this.profesionalId();
    const todas = this.profesionales();
    if (id != null) return todas.filter(p => p.id === id);

    const conAlgo = new Set<number>();
    for (const c of this.citas()) if (c.professional_id != null) conAlgo.add(c.professional_id);
    for (const a of this.ausencias()) conAlgo.add(a.professional_id);

    return [...todas]
      .sort((a, b) => {
        const d = Number(conAlgo.has(b.id)) - Number(conAlgo.has(a.id));
        return d !== 0 ? d : a.full_name.localeCompare(b.full_name, 'es');
      })
      .slice(0, ServiciosAgenda.MAX_COLUMNAS);
  });

  /** Cuántas personas quedaron fuera de la pantalla. Se dice, no se esconde. */
  readonly ocultas = computed(() =>
    this.profesionalId() != null ? 0 : Math.max(0, this.profesionales().length - this.columnas().length));

  plantillaColumnas(): string {
    const n = Math.max(this.columnas().length, 1);
    return `${this.anchoHoras}px repeat(${n}, minmax(0, 1fr))`;
  }

  colorDe(p: Profesional): string { return p.color || 'var(--wx-accent)'; }

  cuantas(profesionalId: number): number {
    return this.citas().filter(c => c.professional_id === profesionalId && this.enPie(c)).length;
  }

  // -------------------------------------------------------- ventana horaria
  /**
   * La primera y la última hora que hay que enseñar.
   *
   * Sale de los horarios declarados y de lo que ya está agendado: una cita
   * fuera de horario —que se permite a propósito— no puede quedarse fuera de
   * la pantalla, porque entonces nadie la vería.
   */
  private readonly ventana = computed<{ desde: number; hasta: number }>(() => {
    const minutos: number[] = [];
    const diaSemana = new Date(this.dia() + 'T12:00:00').getDay() + 1;

    for (const f of this.franjas()) {
      if (Number(f.weekday) !== diaSemana) continue;
      minutos.push(this.aMinutos(f.starts_at), this.aMinutos(f.ends_at));
    }
    for (const c of this.citas()) {
      minutos.push(this.minutosDe(c.starts_at), this.minutosDe(c.ends_at));
    }
    for (const a of this.ausencias()) {
      minutos.push(this.minutosDe(a.starts_at), this.minutosDe(a.ends_at));
    }

    if (!minutos.length) return { desde: 8 * 60, hasta: 20 * 60 };

    /* Una hora de margen arriba y abajo, redondeando a la hora: así el primer
       bloque no queda pegado al borde. */
    const desde = Math.max(0, Math.floor(Math.min(...minutos) / 60) * 60 - 60);
    const hasta = Math.min(24 * 60, Math.ceil(Math.max(...minutos) / 60) * 60 + 60);
    return { desde, hasta: Math.max(hasta, desde + 4 * 60) };
  });

  readonly horas = computed<string[]>(() => {
    const { desde, hasta } = this.ventana();
    const out: string[] = [];
    for (let m = desde; m < hasta; m += 60) {
      out.push(String(Math.floor(m / 60)).padStart(2, '0') + ':00');
    }
    return out;
  });

  altoLienzo(): number { return this.horas().length * this.altoHora; }

  private aY(minutos: number): number {
    return ((minutos - this.ventana().desde) / 60) * this.altoHora;
  }

  // ---------------------------------------------------------- los bloques
  citasDe(profesionalId: number): Bloque[] {
    return this.citas()
      .filter(c => c.professional_id === profesionalId)
      .map(c => {
        const ini = this.minutosDe(c.starts_at);
        const fin = this.minutosDe(c.ends_at);
        const color = c.professional_color || 'var(--wx-accent)';
        return {
          cita: c,
          top: this.aY(ini),
          /* 22 px es lo mínimo que deja leer un nombre: una cita de diez
             minutos tiene que poder pulsarse. */
          alto: Math.max(22, ((fin - ini) / 60) * this.altoHora - 2),
          color,
          suave: this.suavizar(color),
        };
      });
  }

  ausenciasDe(profesionalId: number): { top: number; alto: number; motivo: string | null }[] {
    return this.ausencias()
      .filter(a => a.professional_id === profesionalId)
      .map(a => {
        const ini = this.minutosDe(a.starts_at);
        const fin = this.minutosDe(a.ends_at);
        return {
          /* Una ausencia de varios días se recorta al día que se mira. */
          top: this.aY(Math.max(ini, this.ventana().desde)),
          alto: Math.max(18, ((Math.min(fin, this.ventana().hasta) - Math.max(ini, this.ventana().desde)) / 60) * this.altoHora),
          motivo: a.reason,
        };
      });
  }

  /** El color del profesional, rebajado para poder leer texto encima. */
  private suavizar(color: string): string {
    const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
    if (!m) return 'var(--wx-accent-soft)';
    const n = parseInt(m[1], 16);
    return `rgb(${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255} / .15)`;
  }

  // ------------------------------------------------------------ la hora
  lineaAhora(): number | null {
    if (this.dia() !== this.hoy) return null;
    const ahora = new Date();
    const m = ahora.getHours() * 60 + ahora.getMinutes();
    const { desde, hasta } = this.ventana();
    if (m < desde || m > hasta) return null;
    return this.aY(m);
  }
  horaAhora(): string {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  // ------------------------------------------------------------- resumen
  resumen(): string {
    const enPie = this.citas().filter(c => this.enPie(c)).length;
    const sinConfirmar = this.citas().filter(c => c.status === 'AGENDADA').length;
    if (!enPie) return 'Nada agendado';
    return `${enPie} cita${enPie === 1 ? '' : 's'}`
      + (sinConfirmar ? ` · ${sinConfirmar} sin confirmar` : '');
  }

  readonly sinHorario = computed(() =>
    this.profesionales().length > 0 && this.franjas().length === 0);

  enPie(c: Cita): boolean { return c.status === 'AGENDADA' || c.status === 'CONFIRMADA'; }

  // --------------------------------------------------------------- carga
  private async arrancar() {
    const [pr, sv, ho] = await Promise.all([
      this.srv.profesionales({ soloActivos: true }),
      this.srv.catalogo({ soloActivos: true }),
      this.srv.horario(),
    ]);
    this.profesionales.set(pr.datos);
    this.servicios.set(sv.datos.filter(s => s.schedulable));
    if (ho.ok) this.franjas.set(ho.datos.franjas as any);
    await this.cargar();
  }

  irA(d: string) { if (d) { this.dia.set(d); void this.cargar(); } }
  mover(dias: number) {
    const d = new Date(this.dia() + 'T12:00:00');
    d.setDate(d.getDate() + dias);
    this.irA(d.toISOString().slice(0, 10));
  }
  filtrarPor(id: number | null) { this.profesionalId.set(id); void this.cargar(); }

  async cargar() {
    this.cargando.set(true);
    const r = await this.srv.citas({
      desde: this.dia() + 'T00:00:00',
      hasta: this.dia() + 'T23:59:59',
      profesionalId: this.profesionalId() ?? undefined,
    });
    this.cargando.set(false);
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se pudo cargar', text: r.error }); return; }
    this.citas.set(r.datos.citas);
    this.ausencias.set(r.datos.ausencias);
  }

  // ------------------------------------------------------------- acciones
  /**
   * Una cita abierta: lo que se puede hacer con ella, según dónde esté.
   *
   * Un menú y no cuatro botones en el bloque: a 64 px por hora, una cita de
   * media hora tiene 30 px de alto y ahí no caben cuatro botones que se
   * puedan pulsar.
   */
  async abrirCita(c: Cita) {
    if (!this.puedeOperar) return;

    if (c.service_order_id) {
      void this.router.navigate(['/dashboard/ordenes-de-servicio/orden', c.service_order_id]);
      return;
    }
    if (!this.enPie(c)) {
      await Swal.fire({
        icon: 'info',
        title: this.etiquetaEstado(c.status),
        text: `${c.customer_name} · ${new Date(c.starts_at).toLocaleString('es-MX')}`,
      });
      return;
    }

    const cuando = (iso: string) =>
      new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

    /* El detalle trae los avisos que la lista no calcula: si cae fuera del
       horario de esa persona, dentro de una ausencia, o encima de otra cita.
       Ninguno impide nada —agendar un sábado o en vacaciones pasa a
       propósito— pero quien la abre tiene que enterarse. */
    const detalle = await this.srv.cita(c.id);
    const d = detalle.ok ? detalle.datos[0] : null;
    const avisos: string[] = [];
    if (d?.fuera_de_horario) avisos.push('Fuera del horario de esta persona.');
    if (d?.en_ausencia) avisos.push('Cae dentro de una ausencia declarada.');
    if (d?.citas_encimadas) {
      avisos.push(`Encimada con ${d.citas_encimadas} cita(s) más a la misma hora.`);
    }

    /* Lo que se hace casi siempre —«llegó»— es un clic. Lo demás está un
       nivel más adentro: en una agenda llena, cuatro botones por cita
       convierten la pantalla en una botonera. */
    const r = await Swal.fire({
      title: c.customer_name,
      html: `<p style="font-size:14px;color:#617284;margin:0;line-height:1.55">
               ${cuando(c.starts_at)} – ${cuando(c.ends_at)}
               ${c.service_name ? '<br>' + c.service_name : ''}
               ${c.professional_name ? '<br>' + c.professional_name : ''}
               ${c.customer_mobile || c.customer_phone
                 ? '<br>' + (c.customer_mobile || c.customer_phone) : ''}
             </p>
             ${avisos.length
               ? `<p style="font-size:13px;color:#A16207;margin:10px 0 0;line-height:1.5">
                    ${avisos.join('<br>')}
                  </p>`
               : ''}`,
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: 'Llegó',
      denyButtonText: 'Mover',
      cancelButtonText: 'Más…',
    });

    if (r.isConfirmed) { await this.llego(c); return; }
    if (r.isDenied) { await this.reprogramar(c); return; }
    /* «Más…» sale por `cancel`; cerrar con Escape o el fondo sale por
       `backdrop`/`esc`, y eso no debe abrir nada. */
    if (r.dismiss !== Swal.DismissReason.cancel) return;

    const { value: accion } = await Swal.fire({
      title: c.customer_name,
      input: 'radio',
      inputOptions: {
        no: 'No llegó',
        cancelar: 'Cancelar la cita',
      },
      showCancelButton: true,
      confirmButtonText: 'Continuar',
      cancelButtonText: 'Volver',
    });
    if (accion === 'no') await this.noLlego(c);
    else if (accion === 'cancelar') await this.cancelar(c);
  }

  async llego(c: Cita) {
    const r = await this.srv.citaAOrden(c.id);
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se pudo', text: r.error }); return; }
    void this.router.navigate(['/dashboard/ordenes-de-servicio/orden', r.datos!.cabecera.id]);
  }

  async noLlego(c: Cita) {
    const conf = await Swal.fire({
      icon: 'question', title: 'No llegó',
      text: 'Se marca distinto de una cancelación: una se avisa y la otra se pierde.',
      showCancelButton: true, confirmButtonText: 'Marcar',
    });
    if (!conf.isConfirmed) return;
    const r = await this.srv.cambiarEstadoCita(c.id, 'NO_ASISTIO');
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se pudo', text: r.error }); return; }
    await this.cargar();
  }

  async cancelar(c: Cita) {
    const { value: motivo } = await Swal.fire({
      title: 'Cancelar la cita', input: 'text',
      inputPlaceholder: 'Motivo (opcional)',
      showCancelButton: true, confirmButtonText: 'Cancelar la cita', cancelButtonText: 'Volver',
    });
    if (motivo === undefined) return;
    const r = await this.srv.cambiarEstadoCita(c.id, 'CANCELADA', motivo || undefined);
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se pudo', text: r.error }); return; }
    await this.cargar();
  }

  async reprogramar(c: Cita) {
    const { value } = await Swal.fire({
      title: 'Mover la cita',
      html: `<input id="ag-new" class="swal2-input" type="datetime-local" value="${this.paraInput(c.starts_at)}">
             <input id="ag-why" class="swal2-input" placeholder="Motivo: el cliente no puede…">`,
      focusConfirm: false, showCancelButton: true, confirmButtonText: 'Mover',
      preConfirm: () => {
        const d = (document.getElementById('ag-new') as HTMLInputElement)?.value;
        if (!d) { Swal.showValidationMessage('Pon la nueva hora'); return false; }
        return { id: c.id, desde: d,
                 motivo: (document.getElementById('ag-why') as HTMLInputElement)?.value.trim() || null };
      },
    });
    if (!value) return;

    let r = await this.srv.reprogramar(value);
    if (!r.ok && /ya hay una cita/i.test(r.error ?? '')) {
      const conf = await Swal.fire({
        icon: 'warning', title: 'Esa hora ya está ocupada', text: r.error,
        showCancelButton: true, confirmButtonText: 'Mover igual',
      });
      if (!conf.isConfirmed) return;
      r = await this.srv.reprogramar({ ...(value as any), permitirEncimar: true });
    }
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se pudo mover', text: r.error }); return; }
    await this.cargar();
  }

  async nuevaCita() {
    const clientes = await (window as any).electronAPI?.getCustomers?.();
    const lista: any[] = clientes?.data ?? clientes ?? [];
    if (!lista.length) {
      await Swal.fire({ icon: 'info', title: 'Primero, un cliente',
        text: 'Una cita es de alguien. Da de alta al cliente y vuelve.' });
      return;
    }

    const opsCli = lista.map(c => `<option value="${c.id}">${c.customerName}</option>`).join('');
    const opsSrv = this.servicios().map(s =>
      `<option value="${s.product_id}">${s.nombre} · ${s.duration_minutes} min</option>`).join('');
    const opsPro = this.profesionales().map(p =>
      `<option value="${p.id}">${p.full_name}</option>`).join('');

    const { value } = await Swal.fire({
      title: 'Nueva cita',
      html: `
        <select id="ag-cli" class="swal2-select"><option value="">Cliente…</option>${opsCli}</select>
        <select id="ag-srv" class="swal2-select"><option value="">Servicio (opcional)</option>${opsSrv}</select>
        <select id="ag-pro" class="swal2-select"><option value="">Sin asignar</option>${opsPro}</select>
        <input id="ag-ini" class="swal2-input" type="datetime-local" value="${this.dia()}T09:00">`,
      focusConfirm: false, showCancelButton: true, confirmButtonText: 'Agendar',
      preConfirm: () => {
        const cli = (document.getElementById('ag-cli') as HTMLSelectElement)?.value;
        const ini = (document.getElementById('ag-ini') as HTMLInputElement)?.value;
        if (!cli) { Swal.showValidationMessage('Elige el cliente'); return false; }
        if (!ini) { Swal.showValidationMessage('Pon la hora'); return false; }
        const s = (document.getElementById('ag-srv') as HTMLSelectElement)?.value;
        const p = (document.getElementById('ag-pro') as HTMLSelectElement)?.value;
        return {
          clienteId: Number(cli), desde: ini,
          servicioId: s ? Number(s) : null,
          profesionalId: p ? Number(p) : null,
        };
      },
    });
    if (!value) return;
    await this.guardarCita(value);
  }

  /** Si choca, se dice con quién y se ofrece encimarla a propósito. */
  private async guardarCita(datos: any) {
    let r = await this.srv.guardarCita(datos);
    if (!r.ok && /ya hay una cita/i.test(r.error ?? '')) {
      const c = await Swal.fire({
        icon: 'warning', title: 'Esa hora ya está ocupada', text: r.error,
        showCancelButton: true, confirmButtonText: 'Agendar igual', cancelButtonText: 'Elegir otra hora',
      });
      if (!c.isConfirmed) return;
      r = await this.srv.guardarCita({ ...datos, permitirEncimar: true });
    }
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se pudo agendar', text: r.error }); return; }
    await this.cargar();
  }

  // --------------------------------------------------------------- ayudas
  /** Los minutos del día de una franja, venga como venga desde SQL. */
  private aMinutos(hora: unknown): number {
    const [h, m] = horaDeFranja(hora).split(':');
    return Number(h) * 60 + Number(m);
  }
  private minutosDe(iso: string): number {
    const d = new Date(iso);
    return d.getHours() * 60 + d.getMinutes();
  }
  /** `datetime-local` no acepta zona ni segundos: se recorta lo que sobra. */
  private paraInput(iso: string): string {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  etiquetaEstado(s: string): string {
    return ({
      AGENDADA: 'Agendada', CONFIRMADA: 'Confirmada', ATENDIDA: 'Atendida',
      CANCELADA: 'Cancelada', NO_ASISTIO: 'No llegó',
    } as Record<string, string>)[s] ?? s;
  }
}
