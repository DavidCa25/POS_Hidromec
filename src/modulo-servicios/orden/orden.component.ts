import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import Swal from 'sweetalert2';
import { AuthService, PAQUETES } from '../../services/auth.service';
import {
  EstadoOrden, EventoOrden, LineaOrden, Orden, ServiciosService,
} from '../servicios.service';
import { GiroServiciosService } from '../../core';
/* Los controles de Wybix. No son de Servicios: son los mismos que usan
   Clientes, Compras y el punto de venta, y por eso estaban ya resueltos
   el teclado, el foco, el cierre con Escape y la colision del panel. */
import { WxOpcion, WxSelectComponent } from '../../app/wx-select/wx-select.component';

type EstadoPaso = 'hecho' | 'activo' | 'pendiente';

/**
 * ORDEN DE SERVICIO — DETALLE.
 *
 * Es la pantalla donde se pasa el día: se cotiza, se autoriza, se trabaja y se
 * cobra. Sigue la Dirección A aprobada: las líneas en el centro, el avance y
 * las acciones en un carril lateral que en pantallas estrechas se convierte en
 * cajón.
 *
 * TODO LO QUE DECIDE VIENE DE LA BASE
 * -----------------------------------
 * Si se puede cobrar, si hace falta reautorizar, cuánto suma: todo sale de la
 * respuesta del procedimiento y se vuelve a pedir después de cada cambio. No
 * se recalcula aquí. Con dos personas en la misma orden, una cuenta hecha en
 * el renderer estaría equivocada la mitad del tiempo, y sería justo la cuenta
 * que decide si se cobra.
 *
 * EL CONFLICTO DE VERSIÓN SE EXPLICA, NO SE TRAGA
 * -----------------------------------------------
 * Cuando alguien más cambió la orden, el guardado no se hace y la pantalla lo
 * dice con esas palabras, ofreciendo recargar. Reintentar en silencio con el
 * testigo nuevo sería exactamente lo que el testigo existe para impedir.
 */
@Component({
  selector: 'app-servicios-orden',
  standalone: true,
  imports: [CommonModule, FormsModule, WxSelectComponent],
  templateUrl: './orden.component.html',
  styleUrls: ['../servicios.css', './orden.component.css'],
})
export class ServiciosOrden {
  /* El vocabulario de la orden: «vehículo» o «equipo», «placa» o «serie».
     Lo decide el giro del negocio, no esta pantalla. */
  readonly giro = inject(GiroServiciosService);
  private readonly srv = inject(ServiciosService);
  private readonly router = inject(Router);
  private readonly ruta = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);

  readonly orden = this.srv.orden;
  readonly cargando = signal(true);
  readonly cajon = signal(false);

  /* ------------------------------------------------------------------
     LOS DIALOGOS DE CAPTURA SON MODALES DE WYBIX, NO CADENAS DE AVISOS.

     Antes cada uno era una cadena de SweetAlert: elegir producto, luego
     cantidad, luego quien lo hace. Tres ventanas para una sola decision, sin
     una etiqueta visible, sin unidades y sin poder corregir el paso anterior
     sin empezar de nuevo. Y por encima de eso, con `<select>` del sistema
     operativo, que es lo unico de Wybix que se ve prestado de otro programa.

     Ahora es UN modal por decision, con el mismo marcado que Clientes y el
     punto de venta y con los controles wx que ya estaban estabilizados.
     ------------------------------------------------------------------ */
  readonly dialogo = signal<'linea' | 'autorizar' | 'datos' | 'activo' | 'nueva' | null>(null);
  readonly guardando = signal(false);
  readonly errorModal = signal('');

  /** Anadir trabajo o material. Una sola pantalla con todo lo que decide. */
  claseLinea: 'SERVICIO' | 'PRODUCTO' = 'SERVICIO';
  opcCatalogo: WxOpcion[] = [];
  opcProfesionales: WxOpcion[] = [];
  formLinea: { productoId: number | null; cantidad: number; profesionalId: number | null } =
    { productoId: null, cantidad: 1, profesionalId: null };

  formAutorizar = { nombre: '', via: 'MOSTRADOR' };
  /** Los cuatro estados de una línea, con lo que significa cada uno. */
  readonly opcEstadoLinea: WxOpcion[] = [
    { valor: 'PENDIENTE', etiqueta: 'Pendiente', nota: 'Todavía no se toca' },
    { valor: 'EN_PROCESO', etiqueta: 'En proceso', nota: 'Alguien está en ello' },
    { valor: 'HECHA', etiqueta: 'Hecha', nota: 'Terminada' },
    { valor: 'CANCELADA', etiqueta: 'Cancelada', nota: 'No se hará, no se cobra' },
  ];

  readonly opcVia: WxOpcion[] = [
    { valor: 'MOSTRADOR', etiqueta: 'En el mostrador', nota: 'El cliente está aquí' },
    { valor: 'TELEFONO', etiqueta: 'Por teléfono', nota: 'Se le llamó' },
    { valor: 'WHATSAPP', etiqueta: 'Por mensaje', nota: 'WhatsApp o SMS' },
  ];

  formDatos = { diagnostico: '', notas: '' };

  opcClientes: WxOpcion[] = [];
  formNueva: { clienteId: number | null; reportado: string } = { clienteId: null, reportado: '' };

  opcActivos: WxOpcion[] = [];
  formActivo: { activoId: number | 'nuevo' | null } = { activoId: null };
  /** El alta rápida, dentro del mismo modal: no se sale de la orden. */
  formActivoNuevo = { clase: '', etiqueta: '', identificador: '', marca: '', modelo: '', anio: '', color: '' };

  /** Lo que cuesta la línea que se está añadiendo, mientras se escribe. */
  get importeLinea(): number {
    const op = this.opcCatalogo.find(o => o.valor === this.formLinea.productoId);
    const precio = Number((op as any)?.precio ?? 0);
    return precio * (Number(this.formLinea.cantidad) || 0);
  }

  cerrarDialogo() {
    this.dialogo.set(null);
    this.errorModal.set('');
    this.guardando.set(false);
  }

  get puedeOperar(): boolean { return this.auth.puede(PAQUETES.SERVICIOS_OPERAR); }

  porLinea = (_: number, l: LineaOrden) => l.id;

  constructor() {
    const id = this.ruta.snapshot.paramMap.get('id');
    if (id === 'nueva') void this.crear();
    else void this.cargar(Number(id));
  }

  private async cargar(id: number) {
    this.cargando.set(true);
    const r = await this.srv.cargarOrden(id);
    this.cargando.set(false);
    if (!r.ok) await this.avisar(r);
  }

  /**
   * LA RECEPCION, EN UNA SOLA PANTALLA.
   *
   * Antes eran tres o cuatro avisos encadenados -cliente, sobre que, que dijo-
   * y quien los rellenaba no podia volver atras sin empezar de nuevo. Es el
   * momento con mas prisa del dia, con el cliente delante: pedirlo todo de una
   * vez, con sus etiquetas, es lo menos que puede hacer la pantalla.
   */
  private async crear() {
    this.cargando.set(false);
    const clientes = await (window as any).electronAPI?.getCustomers?.();
    const lista: any[] = clientes?.data ?? clientes ?? [];
    if (!lista.length) {
      await Swal.fire({
        icon: 'info', title: 'Primero, un cliente',
        text: 'Una orden de servicio es de alguien. Da de alta al cliente y vuelve.',
      });
      void this.router.navigate(['/dashboard/clientes']);
      return;
    }

    this.opcClientes = lista.map(c => ({
      valor: c.id,
      etiqueta: c.customerName ?? '(sin nombre)',
      nota: c.mobile || c.phone || undefined,
      busca: String(c.customerCode ?? ''),
    }));
    this.formNueva = { clienteId: null, reportado: '' };
    this.opcActivos = [];
    this.formActivo = { activoId: null };
    this.formActivoNuevo = {
      clase: this.giro.giro().activo.tipo ?? 'OTRO',
      etiqueta: '', identificador: '', marca: '', modelo: '', anio: '', color: '',
    };
    this.errorModal.set('');
    this.dialogo.set('nueva');
  }

  /** Al elegir cliente se traen sus cosas, si este giro trabaja sobre algo. */
  async alElegirCliente(clienteId: number | null) {
    this.formNueva.clienteId = clienteId;
    this.opcActivos = [];
    this.formActivo = { activoId: null };
    if (!clienteId || !this.giro.usaActivos) return;

    const suyos = await this.srv.activos({ clienteId: Number(clienteId), soloActivos: true });
    this.opcActivos = (suyos.ok ? suyos.datos : []).map(a => ({
      valor: a.id,
      etiqueta: a.label ?? '(sin nombre)',
      nota: a.identifier || undefined,
    }));
    this.opcActivos.push({
      valor: 'nuevo',
      etiqueta: this.giro.textos.registrarActivo || 'Registrar uno nuevo',
      nota: 'No está en la lista',
    });
    /* Si solo tiene uno, viene elegido: es el caso mayoritario y ahorra el
       unico clic que nunca aporta informacion. */
    if (this.opcActivos.length === 2) this.formActivo.activoId = this.opcActivos[0].valor;
  }

  async confirmarNueva() {
    if (!this.formNueva.clienteId) { this.errorModal.set('Elige el cliente.'); return; }
    const clienteId = Number(this.formNueva.clienteId);

    let activoId: number | null = null;
    if (this.giro.usaActivos && this.formActivo.activoId === 'nuevo') {
      const etiqueta = this.formActivoNuevo.etiqueta.trim();
      if (!etiqueta) { this.errorModal.set('Ponle un nombre para reconocerlo.'); return; }
      this.guardando.set(true);
      const alta = await this.srv.guardarActivo({
        clienteId,
        clase: this.formActivoNuevo.clase || 'OTRO',
        etiqueta,
        identificador: this.formActivoNuevo.identificador.trim() || null,
        marca: this.formActivoNuevo.marca.trim() || null,
        modelo: this.formActivoNuevo.modelo.trim() || null,
        anioOEdad: this.formActivoNuevo.anio.trim() || null,
        color: this.formActivoNuevo.color.trim() || null,
      });
      this.guardando.set(false);
      if (!alta.ok) { this.errorModal.set(alta.error || 'No se pudo guardar.'); return; }
      activoId = Number(alta.datos[0]?.id) || null;
    } else if (this.giro.usaActivos && this.formActivo.activoId != null) {
      activoId = Number(this.formActivo.activoId);
    }

    /* Se exige solo donde es CENTRAL. En mantenimiento a veces no hay equipo
       de por medio, y bloquear la recepcion por eso seria inventar un
       requisito que el negocio no tiene. */
    if (this.giro.activoCentral && activoId == null) {
      this.errorModal.set(`Indica ${this.giro.activoSingular.toLowerCase()}.`);
      return;
    }

    this.guardando.set(true);
    const r = await this.srv.crearOrden({
      clienteId, activoId, reportado: this.formNueva.reportado.trim() || null,
    });
    this.guardando.set(false);
    if (!r.ok) { this.errorModal.set(r.error || 'No se pudo abrir la orden.'); return; }
    this.cerrarDialogo();
    void this.router.navigate(['/dashboard/ordenes-de-servicio/orden', r.datos!.cabecera.id],
      { replaceUrl: true });
  }

  /** Cancelar la recepción vuelve al tablero: no deja media orden abierta. */
  cancelarNueva() {
    this.cerrarDialogo();
    this.volver();
  }

  /**
   * Sobre que se trabaja, en un modal y sin salir de la orden.
   *
   * Se ofrece lo que el cliente ya tiene registrado y, si no tiene nada o es
   * otra cosa, se da de alta ahi mismo: mandar a otra pantalla con el cliente
   * delante del mostrador es perder la orden a medias.
   */
  async cambiarActivo() {
    const o = this.orden();
    if (!o) return;
    if (!this.puedeCambiarActivo(o)) return;

    const suyos = await this.srv.activos({ clienteId: o.cabecera.customer_id, soloActivos: true });
    this.opcActivos = (suyos.ok ? suyos.datos : []).map(a => ({
      valor: a.id,
      etiqueta: a.label ?? '(sin nombre)',
      nota: a.identifier || undefined,
    }));
    this.opcActivos.push({
      valor: 'nuevo',
      etiqueta: this.giro.textos.registrarActivo || 'Registrar uno nuevo',
      nota: 'No está en la lista',
    });

    this.formActivo = { activoId: o.cabecera.customer_asset_id ?? null };
    this.formActivoNuevo = {
      clase: this.giro.giro().activo.tipo ?? 'OTRO',
      etiqueta: '', identificador: '', marca: '', modelo: '', anio: '', color: '',
    };
    this.errorModal.set('');
    this.dialogo.set('activo');
  }

  async confirmarActivo() {
    const o = this.orden();
    if (!o) return;

    let activoId: number | null = null;

    if (this.formActivo.activoId === 'nuevo') {
      const etiqueta = this.formActivoNuevo.etiqueta.trim();
      if (!etiqueta) { this.errorModal.set('Ponle un nombre para reconocerlo.'); return; }
      this.guardando.set(true);
      const alta = await this.srv.guardarActivo({
        clienteId: o.cabecera.customer_id,
        clase: this.formActivoNuevo.clase || 'OTRO',
        etiqueta,
        identificador: this.formActivoNuevo.identificador.trim() || null,
        marca: this.formActivoNuevo.marca.trim() || null,
        modelo: this.formActivoNuevo.modelo.trim() || null,
        anioOEdad: this.formActivoNuevo.anio.trim() || null,
        color: this.formActivoNuevo.color.trim() || null,
      });
      this.guardando.set(false);
      if (!alta.ok) { this.errorModal.set(alta.error || 'No se pudo guardar.'); return; }
      activoId = Number(alta.datos[0]?.id) || null;
    } else if (this.formActivo.activoId != null) {
      activoId = Number(this.formActivo.activoId);
    }

    if (activoId == null) { this.errorModal.set(`Elige ${this.giro.activoSingular.toLowerCase()}.`); return; }

    this.guardando.set(true);
    const r = await this.srv.actualizarOrden({ id: o.cabecera.id, activoId });
    this.guardando.set(false);
    if (!r.ok) {
      /* El procedimiento se niega con un codigo propio cuando la orden ya no
         admite el cambio. Se traduce aqui, porque «ACTIVO_BLOQUEADO» no le
         dice nada a nadie en el mostrador. */
      this.errorModal.set(/ACTIVO_BLOQUEADO/.test(String(r.error))
        ? this.porQueNoActivo(o)
        : (r.error || 'No se pudo guardar.'));
      return;
    }
    this.cerrarDialogo();
  }

  /**
   * CUANDO SE PUEDE CAMBIAR SOBRE QUE SE TRABAJA.
   *
   * Mientras la orden esta recibida y nadie se ha comprometido. En cuanto el
   * cliente autorizo un presupuesto, alguien empezo a trabajar, la orden
   * termino o se cobro, cambiarlo deja de ser una correccion de captura y pasa
   * a ser reescribir un trabajo que ya ocurrio: un presupuesto autorizado que
   * no corresponde a nada y una comision cobrada sobre otra cosa.
   *
   * La misma regla vive en `sp_service_order_update`. Aqui esta para poder
   * explicarla antes de pulsar; alli esta para que sea verdad.
   */
  puedeCambiarActivo(o: Orden): boolean {
    if (!this.giro.usaActivos || !this.puedeOperar) return false;
    if (o.cabecera.sale_id) return false;
    if (o.cabecera.status !== 'ABIERTA' && o.cabecera.status !== 'BORRADOR') return false;
    if (o.cabecera.authorized_at) return false;
    return !o.lineas.some(l => l.status === 'EN_PROCESO' || l.status === 'HECHA');
  }

  porQueNoActivo(o: Orden): string {
    const que = this.giro.activoSingular.toLowerCase();
    if (o.cabecera.sale_id) return `La orden ya se cobró: el ${que} queda como quedó registrado.`;
    if (o.cabecera.authorized_at) return `El cliente ya autorizó un presupuesto sobre este ${que}.`;
    if (o.lineas.some(l => l.status === 'EN_PROCESO' || l.status === 'HECHA')) {
      return `Ya hay trabajo hecho sobre este ${que}.`;
    }
    return `Esta orden ya avanzó: el ${que} no se cambia.`;
  }


  // --------------------------------------------------------- autorizacion
  /**
   * Si esta orden espera una autorizacion AHORA.
   *
   * Dos casos: nunca se autorizo, o se autorizo y despues cambio la
   * cotizacion. Fuera de esos dos, el boton no aparece: verlo debajo de una
   * orden ya autorizada invita a autorizar dos veces la misma cosa, y eso
   * ensucia el historial de lo unico que tiene valor probatorio.
   */
  esperaAutorizacion(o: Orden): boolean {
    if (!this.editable(o) || !this.puedeOperar || o.cabecera.total <= 0) return false;
    return !o.cabecera.authorized_at || !!o.cabecera.needs_reauthorization;
  }

  /** Reautorizar no es autorizar: el texto lo dice. */
  textoAutorizar(o: Orden): string {
    return o.cabecera.authorized_at ? 'Registrar la nueva autorización' : 'Registrar autorización';
  }

  /**
   * Cuanto pesa la autorizacion en ESTE giro.
   *
   * En un taller manda: se diagnostica, se cotiza y no se toca nada hasta el
   * «si». En una barberia el precio de un corte se conoce al agendar, y pedir
   * una autorizacion por cada corte convierte el boton en un tramite que se
   * pulsa sin leer. El motor es el mismo; lo que cambia es si se reclama.
   */
  get autorizacionMandaAqui(): boolean { return this.giro.autorizacionRequerida; }
  get autorizacionDiscreta(): boolean { return this.giro.autorizacionDiscreta; }

  // ------------------------------------------------------------- estados
  editable(o: Orden): boolean {
    return o.cabecera.status !== 'CANCELADA' && !o.cabecera.sale_id;
  }

  puedeCobrar(o: Orden): boolean {
    return !o.cabecera.sale_id
      && o.cabecera.status !== 'CANCELADA'
      && o.cabecera.total > 0;
  }

  /** Un botón apagado sin motivo no responde a la única pregunta que se le hace. */
  porQueNoCobrar(o: Orden): string {
    if (o.cabecera.sale_id) return 'Ya se cobró con la venta ' + o.cabecera.sale_id + '.';
    if (o.cabecera.status === 'CANCELADA') return 'Esta orden está cancelada.';
    if (o.cabecera.total <= 0) return 'Añade lo que se va a cobrar.';
    return '';
  }

  pasos(o: Orden): { nombre: string; estado: EstadoPaso }[] {
    const orden: EstadoOrden[] = ['ABIERTA', 'EN_PROCESO', 'TERMINADA', 'ENTREGADA'];
    const nombres = ['Recibida', 'En proceso', 'Terminada', 'Entregada'];
    if (o.cabecera.status === 'CANCELADA') {
      return [{ nombre: 'Cancelada', estado: 'activo' }];
    }
    const actual = orden.indexOf(o.cabecera.status as EstadoOrden);
    return nombres.map((nombre, i) => ({
      nombre,
      estado: i < actual ? 'hecho' : i === actual ? 'activo' : 'pendiente',
    }));
  }

  precioCambio(l: LineaOrden): boolean {
    return Number(l.current_price) !== Number(l.unit_price_snapshot);
  }

  // -------------------------------------------------------------- acciones
  /**
   * Anadir trabajo o material. Abre EL modal y lo deja listo.
   *
   * El catalogo se carga aqui y no al abrir la pantalla: la mayoria de las
   * veces que se mira una orden no se le anade nada, y traer el catalogo de
   * productos entero por si acaso es trabajo que nadie pidio.
   */
  async agregar(clase: 'SERVICIO' | 'PRODUCTO') {
    const o = this.orden();
    if (!o) return;

    this.claseLinea = clase;
    this.formLinea = { productoId: null, cantidad: 1, profesionalId: null };
    this.opcProfesionales = [];
    this.errorModal.set('');

    if (clase === 'SERVICIO') {
      const r = await this.srv.catalogo({ soloActivos: true });
      if (!r.ok || !r.datos.length) {
        await Swal.fire({
          icon: 'info', title: 'Todavía no hay servicios',
          text: 'Da de alta lo que cobra tu negocio en Servicios › Catálogo.',
        });
        return;
      }
      this.opcCatalogo = r.datos.map(s2 => ({
        valor: s2.product_id,
        etiqueta: s2.nombre ?? '(sin nombre)',
        nota: `${this.moneda(s2.price)} · ${s2.duration_minutes ?? 0} min`,
        busca: String(s2.part_number ?? ''),
        precio: s2.price,
      } as WxOpcion));
    } else {
      const p = await (window as any).electronAPI?.getActiveProducts?.();
      const prods: any[] = p?.data ?? p ?? [];
      /* `product_name`, NO `nombre`.
         El procedimiento de inventario devuelve la columna con ese alias desde
         siempre, y aqui se leia `nombre`: el desplegable de refacciones
         ensenaba «undefined» en cada fila. No era un dato que faltara en la
         base -estaba entero- sino un nombre de columna mal copiado, que es el
         tipo de fallo que solo se ve pulsando el boton. */
      this.opcCatalogo = prods
        .filter(x => String(x.inventory_mode ?? '') !== 'NONE')
        .map(x => ({
          valor: x.id,
          etiqueta: String(x.product_name ?? x.nombre ?? '(sin nombre)'),
          nota: `${this.moneda(Number(x.price) || 0)} · ${this.existencias(x)}`,
          busca: String(x.part_number ?? ''),
          precio: Number(x.price) || 0,
        } as WxOpcion));

      if (!this.opcCatalogo.length) {
        await Swal.fire({
          icon: 'info',
          title: `Todavía no hay ${this.giro.material.plural.toLowerCase()}`,
          text: 'Da de alta en Inventario lo que se cobra aparte del trabajo.',
        });
        return;
      }
    }

    this.dialogo.set('linea');
  }

  /** Cuando cambia el servicio elegido, se ofrece quien puede hacerlo. */
  async alElegirServicio(productoId: number | null) {
    this.formLinea.productoId = productoId;
    this.formLinea.profesionalId = null;
    this.opcProfesionales = [];
    if (this.claseLinea !== 'SERVICIO' || !productoId) return;

    const pr = await this.srv.profesionales({ soloActivos: true, servicioId: Number(productoId) });
    this.opcProfesionales = (pr.ok ? pr.datos : []).map(x => ({
      valor: x.id,
      etiqueta: x.full_name ?? '(sin nombre)',
      nota: x.title || undefined,
    }));
  }

  async confirmarLinea() {
    const o = this.orden();
    if (!o || !this.formLinea.productoId) {
      this.errorModal.set('Elige qué se añade.');
      return;
    }
    const cant = Number(this.formLinea.cantidad);
    if (!(cant > 0)) { this.errorModal.set('La cantidad tiene que ser mayor que cero.'); return; }

    this.guardando.set(true);
    const r = await this.srv.agregarLinea({
      ordenId: o.cabecera.id,
      productoId: Number(this.formLinea.productoId),
      cantidad: cant,
      profesionalId: this.formLinea.profesionalId ? Number(this.formLinea.profesionalId) : null,
    });
    this.guardando.set(false);
    if (!r.ok) { this.errorModal.set(r.error || 'No se pudo añadir.'); return; }
    this.cerrarDialogo();
  }

  async cambiarEstadoLinea(l: LineaOrden, estado: string) {
    if (estado === l.status) return;
    const r = await this.srv.actualizarLinea({ lineaId: l.id, estado });
    if (!r.ok) await this.avisar(r);
  }

  async quitarLinea(l: LineaOrden) {
    /* No se borra: se cancela. Borrarla escondería que se cotizó y se quitó,
       que es justo la conversación que acaba habiendo en el mostrador. */
    const c = await Swal.fire({
      icon: 'question', title: 'Quitar del presupuesto',
      text: `«${l.name_snapshot}» dejará de sumar, pero quedará en el historial de la orden.`,
      showCancelButton: true, confirmButtonText: 'Quitar', cancelButtonText: 'Dejarla',
    });
    if (!c.isConfirmed) return;
    const r = await this.srv.actualizarLinea({ lineaId: l.id, estado: 'CANCELADA' });
    if (!r.ok) await this.avisar(r);
  }

  /**
   * Registrar la autorizacion del cliente.
   *
   * El boton que lleva aqui solo existe cuando hace falta: ver «Registrar
   * autorizacion» debajo de una orden ya autorizada es como se acaba
   * autorizando dos veces la misma cosa.
   */
  autorizar() {
    const o = this.orden();
    if (!o) return;
    this.formAutorizar = { nombre: o.cabecera.customer_name, via: 'MOSTRADOR' };
    this.errorModal.set('');
    this.dialogo.set('autorizar');
  }

  async confirmarAutorizacion() {
    const o = this.orden();
    if (!o) return;
    const nombre = this.formAutorizar.nombre.trim();
    if (!nombre) { this.errorModal.set('Anota quién autoriza.'); return; }

    this.guardando.set(true);
    const r = await this.srv.autorizar(o.cabecera.id, nombre, this.formAutorizar.via);
    this.guardando.set(false);
    if (!r.ok) { this.errorModal.set(r.error || 'No se pudo registrar.'); return; }
    this.cerrarDialogo();
  }

  async cambiarEstado(estado: EstadoOrden) {
    const o = this.orden();
    if (!o) return;
    const r = await this.srv.cambiarEstado(o.cabecera.id, estado);
    if (!r.ok) await this.avisar(r);
  }

  editarDatos() {
    const o = this.orden();
    if (!o) return;
    this.formDatos = {
      diagnostico: o.cabecera.diagnosis ?? '',
      notas: o.cabecera.notes ?? '',
    };
    this.errorModal.set('');
    this.dialogo.set('datos');
  }

  async confirmarDatos() {
    const o = this.orden();
    if (!o) return;
    this.guardando.set(true);
    const r = await this.srv.actualizarOrden({
      id: o.cabecera.id,
      diagnostico: this.formDatos.diagnostico.trim() || null,
      notas: this.formDatos.notas.trim() || null,
    });
    this.guardando.set(false);
    if (!r.ok) { this.errorModal.set(r.error || 'No se pudo guardar.'); return; }
    this.cerrarDialogo();
  }

  async cancelar() {
    const o = this.orden();
    if (!o) return;
    const { value: motivo } = await Swal.fire({
      title: 'Cancelar la orden', input: 'text',
      inputPlaceholder: '¿Por qué? El cliente se arrepintió, no hay refacción…',
      showCancelButton: true, confirmButtonText: 'Cancelar la orden', cancelButtonText: 'Volver',
      inputValidator: (v) => (v && v.trim() ? null : 'Anota por qué se cancela'),
    });
    if (!motivo) return;
    const r = await this.srv.cancelarOrden(o.cabecera.id, motivo);
    if (!r.ok) await this.avisar(r);
  }

  /**
   * Cobrar lleva a la venta de siempre, con la orden en el bolsillo.
   *
   * No se cobra desde aquí: la venta valida el turno, renueva el arriendo de
   * la caja, mueve el inventario y aplica fidelización. Estrenar una segunda
   * forma de cobrar habría sido crear un camino que se separa del primero en
   * la siguiente entrega.
   */
  async cobrar() {
    const o = this.orden();
    if (!o) return;
    const previa = await this.srv.cobroPrevia(o.cabecera.id);
    if (!previa.ok || !previa.datos.resumen?.can_charge) {
      await Swal.fire({
        icon: 'info', title: 'Todavía no',
        text: previa.datos?.resumen?.blocked_reason || previa.error || 'No se puede cobrar.',
      });
      return;
    }

    if (previa.datos.resumen.needs_reauthorization) {
      const c = await Swal.fire({
        icon: 'warning', title: 'Sin autorizar',
        text: 'El cliente no ha aprobado este importe. ¿Cobrar de todas formas?',
        showCancelButton: true, confirmButtonText: 'Cobrar igual', cancelButtonText: 'Registrar autorización',
      });
      if (!c.isConfirmed) { await this.autorizar(); return; }
    }

    void this.router.navigate(['/dashboard/venta'], {
      queryParams: { ordenServicio: o.cabecera.id },
    });
  }

  // -------------------------------------------------------------- textos
  etiquetaEstado(s: string): string {
    return ({
      BORRADOR: 'Borrador', ABIERTA: 'Recibida', EN_PROCESO: 'En proceso',
      TERMINADA: 'Terminada', ENTREGADA: 'Entregada', CANCELADA: 'Cancelada',
    } as Record<string, string>)[s] ?? s;
  }
  claseEstado(s: string): string {
    return ({
      BORRADOR: 'mute', ABIERTA: 'info', EN_PROCESO: 'info',
      TERMINADA: 'ok', ENTREGADA: 'mute', CANCELADA: 'danger',
    } as Record<string, string>)[s] ?? 'mute';
  }
  etiquetaCobro(s: string): string {
    return ({ SIN_COBRAR: 'Sin cobrar', POR_COBRAR: 'A crédito', PAGADA: 'Pagada' } as Record<string, string>)[s] ?? s;
  }
  claseCobro(s: string): string {
    return ({ SIN_COBRAR: 'mute', POR_COBRAR: 'warn', PAGADA: 'ok' } as Record<string, string>)[s] ?? 'mute';
  }
  viaTexto(v: string | null): string {
    return ({ MOSTRADOR: 'en el mostrador', TELEFONO: 'por teléfono', WHATSAPP: 'por mensaje' } as Record<string, string>)[v ?? ''] ?? (v ?? '');
  }
  /** Una cantidad de dinero, escrita como se escribe en el resto de Wybix. */
  moneda(v: number): string {
    return (Number(v) || 0).toLocaleString('es-MX',
      { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 });
  }

  /**
   * Las existencias de un producto, dichas como son.
   *
   * Un servicio no tiene existencias: no esta agotado, es que la pregunta no
   * aplica. Decir «0 pza» de una afinacion es informacion falsa con formato
   * de dato.
   */
  existencias(x: any): string {
    if (String(x?.inventory_mode ?? '') === 'NONE') return 'Servicio';
    const n = Number(x?.available_units ?? x?.stock ?? 0);
    const uom = String(x?.base_uom ?? 'pza');
    return `${n} ${uom}`;
  }

  textoEvento(e: EventoOrden): string {
    const base = ({
      ABIERTA: 'Orden abierta',
      LINEA_ANADIDA: 'Añadido',
      LINEA_QUITADA: 'Quitado',
      LINEA_HECHA: 'Terminado',
      LINEA_CAMBIADA: 'Cambiado',
      LINEA_NOTA: 'Nota en línea',
      DIAGNOSTICO: 'Diagnóstico',
      ACTIVO_CAMBIADO: 'Cambió sobre qué se trabaja',
      AUTORIZADA: 'Autorizada',
      REAUTORIZADA: 'Reautorizada',
      ESTADO: 'Estado',
      COBRADA: 'Cobrada',
      CANCELADA: 'Cancelada',
    } as Record<string, string>)[e.event_type] ?? e.event_type;
    const extra = e.detail ? `: ${e.detail}` : (e.to_status ? `: ${this.etiquetaEstado(e.to_status)}` : '');
    return base + extra;
  }

  volver() { void this.router.navigate(['/dashboard/ordenes-de-servicio']); }

  /** El conflicto de versión se explica; el resto se dice tal cual. */
  private async avisar(r: { error?: string; motivo?: string }) {
    if (r.motivo === 'CONFLICTO_DE_VERSION') {
      const c = await Swal.fire({
        icon: 'warning', title: 'Alguien más la cambió',
        text: r.error, showCancelButton: true,
        confirmButtonText: 'Ver lo último', cancelButtonText: 'Seguir aquí',
      });
      if (c.isConfirmed) {
        const id = this.orden()?.cabecera?.id;
        if (id) await this.cargar(id);
      }
      return;
    }
    await Swal.fire({ icon: 'error', title: 'No se pudo', text: r.error });
  }
}
