import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WxDateComponent } from '../../app/wx-date/wx-date.component';
import { WxTimeComponent } from '../../app/wx-time/wx-time.component';
import { WxOpcion, WxSelectComponent } from '../../app/wx-select/wx-select.component';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';
import { AuthService, PAQUETES } from '../../services/auth.service';
import { Ausencia, Cita, horaDeFranja, Profesional, ServiciosService } from '../servicios.service';

/** Una cita ya colocada: dónde va y de qué color. */
interface Bloque {
  /** Si sigue prometiendo ese horario. Cancelada y no-llego no lo prometen. */
  viva: boolean;
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
  imports: [CommonModule, FormsModule, WxDateComponent, WxSelectComponent, WxTimeComponent],
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
  /**
   * Las personas, en el formato del selector de Wybix.
   *
   * Se deriva de lo que ya está cargado en vez de pedirlo otra vez: es la
   * misma lista que dibuja las columnas, y dos consultas para lo mismo se
   * desincronizan en cuanto una falla.
   */
  /* Los diálogos de captura de la agenda, con el mismo marcado que la orden
     y que el resto de Wybix. */
  readonly dialogo = signal<'cita' | 'mover' | null>(null);
  readonly guardando = signal(false);
  readonly errorModal = signal('');

  opcClientes: WxOpcion[] = [];
  opcServicios: WxOpcion[] = [];
  formCita = {
    clienteId: null as number | null,
    servicioId: null as number | null,
    profesionalId: null as number | null,
    dia: '',
    hora: '09:00',
    motivo: '',
  };
  private citaAMover: Cita | null = null;

  cerrarDialogo() {
    this.dialogo.set(null);
    this.errorModal.set('');
    this.guardando.set(false);
    this.citaAMover = null;
  }

  readonly opcProfesionales = computed<WxOpcion[]>(() => [
    { valor: null, etiqueta: 'Todas las personas' },
    ...this.profesionales().map(p => ({
      valor: p.id, etiqueta: p.full_name ?? '(sin nombre)', nota: p.title || undefined,
    })),
  ]);

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
        /* ------------------------------------------------------------
           UNA CITA CANCELADA NO OCUPA HORARIO, Y NO PUEDE PARECER QUE SÍ.

           Funcionalmente el hueco ya se libera: el motor de solapes ignora
           CANCELADA y NO_ASISTIO, y se puede agendar encima sin que proteste.
           Pero seguía dibujándose con la altura completa de su intervalo, y
           una banda tachada de dos horas encima de la agenda se lee como una
           reserva: tapa el hueco que acaba de quedar libre y compite con las
           citas vivas justo donde hay que mirar para reagendar.

           No se borra —el historial importa: saber que ese cliente no llegó
           es la mitad de la razón de tenerlo apuntado— sino que se encoge a
           una banda fina anclada en su hora de inicio. Sigue ahí, sigue
           pulsable, y ya no promete un horario que no está ocupado. */
        const viva = this.enPie(c);
        return {
          cita: c,
          top: this.aY(ini),
          /* 22 px es lo mínimo que deja leer un nombre: una cita de diez
             minutos tiene que poder pulsarse. */
          alto: viva ? Math.max(22, ((fin - ini) / 60) * this.altoHora - 2) : 24,
          /* Y detrás de las vivas, para no taparlas al empezar a la misma hora. */
          viva,
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

  /** Mover la cita: el mismo día y hora de Wybix, y el motivo a la vista. */
  reprogramar(c: Cita) {
    const d = new Date(c.starts_at);
    this.citaAMover = c;
    this.formCita = {
      clienteId: null, servicioId: null, profesionalId: null,
      dia: this.paraInput(c.starts_at).slice(0, 10),
      hora: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      motivo: '',
    };
    this.errorModal.set('');
    this.dialogo.set('mover');
  }

  async confirmarMover() {
    const c = this.citaAMover;
    if (!c) return;
    if (!this.formCita.dia || !this.formCita.hora) { this.errorModal.set('Pon la nueva hora.'); return; }
    const value = {
      id: c.id,
      desde: `${this.formCita.dia}T${this.formCita.hora}`,
      motivo: this.formCita.motivo.trim() || null,
    };
    this.guardando.set(true);
    let r = await this.srv.reprogramar(value);
    const choque = this.choque(r.error);
    if (!r.ok && choque) {
      const conf = await Swal.fire({
        icon: 'warning',
        title: 'Se encima con otra cita',
        text: this.textoDeChoque(choque),
        showCancelButton: true,
        confirmButtonText: 'Mover igual',
        cancelButtonText: 'Elegir otra hora',
      });
      if (!conf.isConfirmed) return;
      r = await this.srv.reprogramar({ ...(value as any), permitirEncimar: true });
    }
    this.guardando.set(false);
    if (!r.ok) { this.errorModal.set(r.error || 'No se pudo mover.'); return; }
    this.cerrarDialogo();
    await this.cargar();
  }

  /**
   * NUEVA CITA, EN UNA PANTALLA CON SUS ETIQUETAS.
   *
   * Era una cadena de cuatro controles del sistema operativo dentro de un
   * aviso: tres `<select>` prestados y un `datetime-local` del navegador, que
   * cambia de aspecto y de idioma en cada equipo. Nada tenía etiqueta —sólo la
   * primera opción hacía de título, y desaparecía al elegir— y la duración del
   * servicio, que es lo que decide a qué hora termina, no se veía por ningún
   * lado hasta después de guardar.
   */
  async nuevaCita(hora?: string, profesionalId?: number | null) {
    const clientes = await (window as any).electronAPI?.getCustomers?.();
    const lista: any[] = clientes?.data ?? clientes ?? [];
    if (!lista.length) {
      await Swal.fire({ icon: 'info', title: 'Primero, un cliente',
        text: 'Una cita es de alguien. Da de alta al cliente y vuelve.' });
      return;
    }

    this.opcClientes = lista.map(c => ({
      valor: c.id,
      etiqueta: c.customerName ?? '(sin nombre)',
      nota: c.mobile || c.phone || undefined,
    }));
    this.opcServicios = [
      { valor: null, etiqueta: 'Sin servicio concreto', nota: 'Se decide al llegar' },
      ...this.servicios().map(x => ({
        valor: x.product_id,
        etiqueta: x.nombre ?? '(sin nombre)',
        /* La duración a la vista: es lo que decide a qué hora queda libre. */
        nota: `${x.duration_minutes} min`,
      })),
    ];
    this.formCita = {
      clienteId: null,
      servicioId: null,
      profesionalId: profesionalId ?? this.profesionalId() ?? null,
      dia: this.dia(),
      hora: hora ?? '09:00',
      motivo: '',
    };
    this.errorModal.set('');
    this.dialogo.set('cita');
  }

  async confirmarCita() {
    if (!this.formCita.clienteId) { this.errorModal.set('Elige el cliente.'); return; }
    if (!this.formCita.dia || !this.formCita.hora) { this.errorModal.set('Pon el día y la hora.'); return; }

    this.guardando.set(true);
    await this.guardarCita({
      clienteId: Number(this.formCita.clienteId),
      desde: `${this.formCita.dia}T${this.formCita.hora}`,
      servicioId: this.formCita.servicioId ? Number(this.formCita.servicioId) : null,
      profesionalId: this.formCita.profesionalId ? Number(this.formCita.profesionalId) : null,
    });
    this.guardando.set(false);
  }

  /**
   * EL CHOQUE, CONTADO COMO SE LO CONTARÍAS A ALGUIEN.
   *
   * El procedimiento devuelve los hechos —quién, desde cuándo, hasta cuándo—
   * y aquí se convierten en una frase. Antes se enseñaba el error crudo:
   * «Ya hay una cita a esa hora (2026-09-19 19:30)», una marca de tiempo en
   * formato de base de datos, con la fecha que no hacía falta y sin decir de
   * quién era la cita ni cuándo termina, que es justo lo que hay que saber
   * para ofrecerle otra hora al cliente que está al teléfono.
   */
  private choque(error: string | undefined): { quien: string; desde: string; hasta: string } | null {
    const m = /CITA_ENCIMADA\|([^|]*)\|([^|]*)\|([^|]*)/.exec(String(error ?? ''));
    if (!m) return null;
    return { quien: m[1] || 'Esa persona', desde: m[2], hasta: m[3] };
  }

  private textoDeChoque(c: { quien: string; desde: string; hasta: string }): string {
    return `${c.quien} ya tiene una cita de ${c.desde} a ${c.hasta}. `
         + 'La nueva se traslapa con ese horario.';
  }

  /** Si choca, se dice con quién y se ofrece encimarla a propósito. */
  private async guardarCita(datos: any) {
    let r = await this.srv.guardarCita(datos);
    const c = this.choque(r.error);
    if (!r.ok && c) {
      const conf = await Swal.fire({
        icon: 'warning',
        title: 'Se encima con otra cita',
        text: this.textoDeChoque(c),
        showCancelButton: true,
        confirmButtonText: 'Agendar igual',
        cancelButtonText: 'Elegir otra hora',
      });
      if (!conf.isConfirmed) return;
      /* Encimar sigue permitido a propósito: dos personas en la misma silla a
         la misma hora pasa de verdad —un retoque rápido entre dos citas— y el
         procedimiento lo deja anotado en la cita. Lo que no puede pasar es
         que ocurra sin que nadie lo haya decidido. */
      r = await this.srv.guardarCita({ ...datos, permitirEncimar: true });
    }
    if (!r.ok) { this.errorModal.set(r.error || 'No se pudo agendar.'); return; }
    this.cerrarDialogo();
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
