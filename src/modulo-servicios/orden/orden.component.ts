import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import Swal from 'sweetalert2';
import { AuthService, PAQUETES } from '../../services/auth.service';
import {
  EstadoOrden, EventoOrden, LineaOrden, Orden, ServiciosService,
} from '../servicios.service';
/* El formulario del activo se comparte con su pantalla: dos copias del mismo
   formulario se separan en cuanto una gana un campo. */
import { ServiciosActivos } from '../activos/activos.component';

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
  imports: [CommonModule, FormsModule],
  templateUrl: './orden.component.html',
  styleUrls: ['../servicios.css', './orden.component.css'],
})
export class ServiciosOrden {
  private readonly srv = inject(ServiciosService);
  private readonly router = inject(Router);
  private readonly ruta = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);

  readonly orden = this.srv.orden;
  readonly cargando = signal(true);
  readonly cajon = signal(false);

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

  /** Una orden nueva pide lo mínimo: el cliente. Lo demás llega después. */
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

    const opciones = Object.fromEntries(lista.map(c => [String(c.id), c.customerName]));
    const { value: clienteId } = await Swal.fire({
      title: 'Nueva orden', input: 'select', inputOptions: opciones,
      inputPlaceholder: 'Elige el cliente', showCancelButton: true,
      confirmButtonText: 'Continuar', cancelButtonText: 'Cancelar',
    });
    if (!clienteId) { this.volver(); return; }

    /* Sobre qué se trabaja. En un taller es lo primero que se sabe —llega el
       coche— y sin ello la orden queda a nombre de una persona sin decir de
       qué se trata. Si el cliente no tiene nada registrado, se registra aquí
       mismo: mandarlo a otra pantalla con el cliente delante es perder la
       orden a medias. */
    const activoId = await this.elegirActivo(Number(clienteId));

    const { value: reportado } = await Swal.fire({
      title: '¿Qué dijo el cliente?', input: 'textarea',
      inputPlaceholder: 'Hace un ruido al frenar…',
      showCancelButton: true, confirmButtonText: 'Abrir orden', cancelButtonText: 'Cancelar',
    });
    if (reportado === undefined) { this.volver(); return; }

    const r = await this.srv.crearOrden({ clienteId: Number(clienteId), activoId, reportado });
    if (!r.ok) { await this.avisar(r); this.volver(); return; }
    void this.router.navigate(['/dashboard/ordenes-de-servicio/orden', r.datos!.cabecera.id], { replaceUrl: true });
  }

  /**
   * Sobre qué se trabaja: se elige el que ya tiene, o se registra uno nuevo.
   *
   * Devuelve `null` si no hay ninguno y no se quiso registrar. Es válido: una
   * consulta a domicilio o un trabajo sin objeto de por medio no necesitan
   * activo, y exigirlo obligaría a inventarse uno.
   */
  private async elegirActivo(clienteId: number): Promise<number | null> {
    const suyos = await this.srv.activos({ clienteId, soloActivos: true });
    const lista = suyos.ok ? suyos.datos : [];

    const NUEVO = '__nuevo__';
    const opciones: Record<string, string> = {};
    for (const a of lista) {
      opciones[String(a.id)] = a.identifier ? `${a.label} · ${a.identifier}` : a.label;
    }
    opciones[NUEVO] = lista.length ? '+ Registrar otro' : '+ Registrar el primero';

    const { value } = await Swal.fire({
      title: '¿Sobre qué se trabaja?',
      input: 'select',
      inputOptions: opciones,
      inputPlaceholder: lista.length ? 'Elige' : 'Todavía no tiene nada registrado',
      showCancelButton: true,
      confirmButtonText: 'Siguiente',
      cancelButtonText: 'Sin especificar',
    });
    if (!value) return null;
    if (value !== NUEVO) return Number(value);

    const { value: datos } = await Swal.fire({
      title: 'Registrar',
      html: ServiciosActivos.formulario(null),
      focusConfirm: false, showCancelButton: true, confirmButtonText: 'Guardar',
      preConfirm: () => ServiciosActivos.leerFormulario(),
    });
    if (!datos) return null;

    const r = await this.srv.guardarActivo({ clienteId, ...(datos as any) });
    if (!r.ok) {
      await Swal.fire({ icon: 'error', title: 'No se pudo guardar', text: r.error });
      return null;
    }
    return Number(r.datos[0]?.id) || null;
  }

  /** Cambia sobre qué se trabaja en una orden ya abierta. */
  async cambiarActivo() {
    const o = this.orden();
    if (!o) return;
    const activoId = await this.elegirActivo(o.cabecera.customer_id);
    if (activoId == null) return;
    const r = await this.srv.actualizarOrden({ id: o.cabecera.id, activoId });
    if (!r.ok) await this.avisar(r);
  }

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
  async agregar(clase: 'SERVICIO' | 'PRODUCTO') {
    const o = this.orden();
    if (!o) return;

    let lista: any[] = [];
    if (clase === 'SERVICIO') {
      const r = await this.srv.catalogo({ soloActivos: true });
      lista = r.datos.map(s => ({ id: s.product_id, nombre: s.nombre, precio: s.price }));
      if (!lista.length) {
        await Swal.fire({
          icon: 'info', title: 'Todavía no hay servicios',
          text: 'Da de alta lo que cobra tu negocio en Servicios › Catálogo.',
        });
        return;
      }
    } else {
      const p = await (window as any).electronAPI?.getActiveProducts?.();
      const prods: any[] = p?.data ?? p ?? [];
      lista = prods.map(x => ({ id: x.id, nombre: x.nombre, precio: x.price }));
    }

    const opciones = Object.fromEntries(lista.map(x => [String(x.id), `${x.nombre}`]));
    const { value: productoId } = await Swal.fire({
      title: clase === 'SERVICIO' ? 'Añadir servicio' : 'Añadir refacción',
      input: 'select', inputOptions: opciones, inputPlaceholder: 'Elige',
      showCancelButton: true, confirmButtonText: 'Siguiente',
    });
    if (!productoId) return;

    const { value: cantidad } = await Swal.fire({
      title: 'Cantidad', input: 'number', inputValue: 1,
      inputAttributes: { min: '0.01', step: '0.01' },
      showCancelButton: true, confirmButtonText: 'Siguiente',
    });
    if (!cantidad) return;

    let profesionalId: number | null = null;
    if (clase === 'SERVICIO') {
      const pr = await this.srv.profesionales({ soloActivos: true, servicioId: Number(productoId) });
      if (pr.datos.length) {
        const ops = Object.fromEntries(pr.datos.map(x => [String(x.id), x.full_name]));
        const { value } = await Swal.fire({
          title: '¿Quién lo hace?', input: 'select', inputOptions: ops,
          inputPlaceholder: 'Sin asignar por ahora',
          showCancelButton: true, confirmButtonText: 'Añadir',
        });
        profesionalId = value ? Number(value) : null;
      }
    }

    const r = await this.srv.agregarLinea({
      ordenId: o.cabecera.id, productoId: Number(productoId),
      cantidad: Number(cantidad), profesionalId,
    });
    if (!r.ok) await this.avisar(r);
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

  async autorizar() {
    const o = this.orden();
    if (!o) return;
    const { value } = await Swal.fire({
      title: 'Registrar autorización',
      html: `<p style="font-size:14px;color:var(--wx-text-muted);margin:0 0 10px">
               El cliente aprueba
               <b>${o.cabecera.total.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}</b>.
             </p>
             <input id="aut-nombre" class="swal2-input" placeholder="Quién autoriza"
                    value="${o.cabecera.customer_name}">
             <select id="aut-via" class="swal2-select">
               <option value="MOSTRADOR">En el mostrador</option>
               <option value="TELEFONO">Por teléfono</option>
               <option value="WHATSAPP">Por mensaje</option>
             </select>`,
      focusConfirm: false, showCancelButton: true, confirmButtonText: 'Registrar',
      preConfirm: () => {
        const n = (document.getElementById('aut-nombre') as HTMLInputElement)?.value.trim();
        const v = (document.getElementById('aut-via') as HTMLSelectElement)?.value;
        if (!n) { Swal.showValidationMessage('Anota quién autoriza'); return false; }
        return { n, v };
      },
    });
    if (!value) return;
    const r = await this.srv.autorizar(o.cabecera.id, (value as any).n, (value as any).v);
    if (!r.ok) await this.avisar(r);
  }

  async cambiarEstado(estado: EstadoOrden) {
    const o = this.orden();
    if (!o) return;
    const r = await this.srv.cambiarEstado(o.cabecera.id, estado);
    if (!r.ok) await this.avisar(r);
  }

  async editarDatos() {
    const o = this.orden();
    if (!o) return;
    const { value } = await Swal.fire({
      title: 'Diagnóstico y datos',
      html: `<textarea id="os-diag" class="swal2-textarea" placeholder="Qué encontramos">${o.cabecera.diagnosis ?? ''}</textarea>
             <textarea id="os-notas" class="swal2-textarea" placeholder="Notas internas">${o.cabecera.notes ?? ''}</textarea>`,
      focusConfirm: false, showCancelButton: true, confirmButtonText: 'Guardar',
      preConfirm: () => ({
        diagnostico: (document.getElementById('os-diag') as HTMLTextAreaElement)?.value.trim() || null,
        notas: (document.getElementById('os-notas') as HTMLTextAreaElement)?.value.trim() || null,
      }),
    });
    if (!value) return;
    const r = await this.srv.actualizarOrden({ id: o.cabecera.id, ...(value as any) });
    if (!r.ok) await this.avisar(r);
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
  textoEvento(e: EventoOrden): string {
    const base = ({
      ABIERTA: 'Orden abierta',
      LINEA_ANADIDA: 'Añadido',
      LINEA_QUITADA: 'Quitado',
      LINEA_HECHA: 'Terminado',
      LINEA_CAMBIADA: 'Cambiado',
      LINEA_NOTA: 'Nota en línea',
      DIAGNOSTICO: 'Diagnóstico',
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
