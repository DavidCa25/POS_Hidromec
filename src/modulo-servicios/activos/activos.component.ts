import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { AuthService, PAQUETES } from '../../services/auth.service';
import { ActivoCliente, ServiciosService } from '../servicios.service';

/** Las clases que la pantalla ofrece. La base acepta cualquiera: sin CHECK. */
const CLASES: { valor: string; etiqueta: string; ejemplo: string }[] = [
  { valor: 'VEHICULO', etiqueta: 'Vehículo', ejemplo: 'Jetta 2018 gris' },
  { valor: 'MASCOTA', etiqueta: 'Mascota', ejemplo: 'Rocky' },
  { valor: 'EQUIPO', etiqueta: 'Equipo', ejemplo: 'Compresor 2' },
  { valor: 'INMUEBLE', etiqueta: 'Inmueble', ejemplo: 'Local Centro' },
  { valor: 'OTRO', etiqueta: 'Otro', ejemplo: '' },
];

/**
 * SOBRE QUÉ SE TRABAJA.
 *
 * El coche del taller, la mascota del veterinario, la máquina del técnico. Es
 * la misma cosa —«sobre qué se trabaja»— y por eso es una sola pantalla y una
 * sola tabla, no una por giro.
 *
 * SE BUSCA POR LA PLACA, NO POR EL NOMBRE
 * ---------------------------------------
 * En un taller llega el coche, no llega el nombre. La búsqueda mira la placa,
 * el número de serie y la etiqueta a la vez, y la fila enseña de quién es. Al
 * revés —encontrar primero al cliente y luego su coche— son dos pantallas para
 * una pregunta.
 *
 * VINCULAR LO QUE YA HABÍA
 * ------------------------
 * Un negocio que lleva años en Retail tiene su lista de clientes y ningún
 * activo, porque hasta hoy no existían. El asistente recorre esa lista y deja
 * registrar el coche de cada uno sin salir de la pantalla: es el trabajo de un
 * rato que, hecho a mano cliente por cliente, no se hace nunca.
 */
@Component({
  selector: 'app-servicios-activos',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrls: ['../servicios.css'],
  template: `
  <div class="srv-pagina">
    <header class="srv-cab">
      <div>
        <h1>Sobre qué se trabaja</h1>
        <p class="srv-sub">Los coches, las mascotas o los equipos de tus clientes.</p>
      </div>
      <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap" *ngIf="puedeOperar">
        <button class="btn" (click)="asistente()">Vincular clientes</button>
        <button class="btn btn-primary" (click)="editar(null)">Nuevo</button>
      </div>
    </header>

    <div class="srv-barra">
      <input class="ctl" type="search" placeholder="Placa, serie o nombre…"
             [ngModel]="busqueda()" (ngModelChange)="buscar($event)"
             aria-label="Buscar por placa, serie o nombre" />
      <label class="srv-hint" style="display:flex;align-items:center;gap:6px">
        <input type="checkbox" [ngModel]="verRetirados()"
               (ngModelChange)="verRetirados.set($event); cargar()" />
        Ver retirados
      </label>
      <span class="srv-hint" *ngIf="cargando()">Buscando…</span>
    </div>

    <div class="srv-tabla-wrap">
      <table class="srv-tabla">
        <thead>
          <tr>
            <th style="width:120px">Clase</th>
            <th>Cómo se le llama</th>
            <th style="width:140px">Placa / serie</th>
            <th>Cliente</th>
            <th style="width:170px">Marca y modelo</th>
            <th class="ta-c" style="width:90px">Órdenes</th>
            <th style="width:170px"></th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let a of activos(); trackBy: porId" [style.opacity]="a.active ? 1 : .55">
            <td class="srv-dim">{{ etiquetaClase(a.kind) }}</td>
            <td>
              {{ a.label }}
              <div class="srv-alerta" *ngIf="!a.active">Retirado</div>
              <div class="srv-dim" style="font-size:var(--wx-text-xs)" *ngIf="a.notes">{{ a.notes }}</div>
            </td>
            <td class="mono">{{ a.identifier || '—' }}</td>
            <td>{{ a.customer_name }}</td>
            <td class="srv-dim">
              {{ a.brand || '' }} {{ a.model || '' }}
              <span *ngIf="a.year_or_age"> · {{ a.year_or_age }}</span>
              <span *ngIf="!a.brand && !a.model && !a.year_or_age">—</span>
            </td>
            <td class="ta-c mono">{{ a.orders_count }}</td>
            <td style="text-align:right" *ngIf="puedeOperar">
              <button class="btn srv-sm" (click)="editar(a)">Editar</button>
              <button class="btn srv-sm srv-ghost" (click)="alternar(a)">
                {{ a.active ? 'Retirar' : 'Reactivar' }}
              </button>
            </td>
            <td *ngIf="!puedeOperar"></td>
          </tr>
        </tbody>
      </table>

      <div class="srv-vacio" *ngIf="!cargando() && activos().length === 0">
        <p *ngIf="busqueda()">Nada coincide con «{{ busqueda() }}».</p>
        <ng-container *ngIf="!busqueda()">
          <p><b>Todavía no hay nada registrado.</b></p>
          <p class="srv-sub">Registra el coche, la mascota o el equipo de cada cliente.
             Así una orden sabe sobre qué se trabajó, y el historial queda por
             coche y no sólo por persona.</p>
          <div style="display:flex;gap:8px" *ngIf="puedeOperar">
            <button class="btn" (click)="asistente()">Vincular clientes que ya tienes</button>
            <button class="btn btn-primary" (click)="editar(null)">Registrar el primero</button>
          </div>
        </ng-container>
      </div>
    </div>
  </div>
  `,
})
export class ServiciosActivos {
  private readonly srv = inject(ServiciosService);
  private readonly auth = inject(AuthService);

  readonly activos = signal<ActivoCliente[]>([]);
  readonly cargando = signal(false);
  readonly busqueda = signal('');
  readonly verRetirados = signal(false);
  readonly clases = CLASES;

  get puedeOperar(): boolean { return this.auth.puede(PAQUETES.SERVICIOS_OPERAR); }
  porId = (_: number, a: ActivoCliente) => a.id;

  constructor() { void this.cargar(); }

  etiquetaClase(k: string): string {
    return CLASES.find(c => c.valor === k)?.etiqueta ?? k;
  }

  private temporizador: any = null;
  buscar(v: string) {
    this.busqueda.set(v);
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => void this.cargar(), 250);
  }

  async cargar() {
    this.cargando.set(true);
    const r = await this.srv.activos({
      busqueda: this.busqueda() || undefined,
      soloActivos: !this.verRetirados(),
    });
    this.cargando.set(false);
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se pudo cargar', text: r.error }); return; }
    this.activos.set(r.datos);
  }

  /** El formulario, compartido por el alta, la edición y el asistente. */
  static formulario(a: Partial<ActivoCliente> | null, clienteFijo?: string): string {
    const opciones = CLASES.map(c =>
      `<option value="${c.valor}" ${a?.kind === c.valor ? 'selected' : ''}>${c.etiqueta}</option>`).join('');
    return `
      ${clienteFijo ? `<p style="font-size:14px;color:#617284;margin:0 0 8px">${clienteFijo}</p>` : ''}
      <select id="ac-kind" class="swal2-select">${opciones}</select>
      <input id="ac-label" class="swal2-input" placeholder="Cómo se le llama: Jetta 2018 gris"
             value="${a?.label ?? ''}">
      <input id="ac-id" class="swal2-input" placeholder="Placa, serie o chip"
             value="${a?.identifier ?? ''}">
      <input id="ac-brand" class="swal2-input" placeholder="Marca (o especie)" value="${a?.brand ?? ''}">
      <input id="ac-model" class="swal2-input" placeholder="Modelo (o raza)" value="${a?.model ?? ''}">
      <input id="ac-year" class="swal2-input" placeholder="Año o edad" value="${a?.year_or_age ?? ''}">
      <input id="ac-color" class="swal2-input" placeholder="Color" value="${a?.color ?? ''}">
      <input id="ac-notes" class="swal2-input" placeholder="Notas" value="${a?.notes ?? ''}">`;
  }

  /** Lo que el formulario dejó escrito. `null` si falta lo obligatorio. */
  static leerFormulario(): any | null {
    const v = (id: string) => (document.getElementById(id) as HTMLInputElement)?.value.trim() || null;
    const label = v('ac-label');
    if (!label) { Swal.showValidationMessage('Ponle un nombre para reconocerlo'); return null; }
    return {
      clase: (document.getElementById('ac-kind') as HTMLSelectElement)?.value || 'OTRO',
      etiqueta: label,
      identificador: v('ac-id'),
      marca: v('ac-brand'),
      modelo: v('ac-model'),
      anioOEdad: v('ac-year'),
      color: v('ac-color'),
      notas: v('ac-notes'),
    };
  }

  async editar(a: ActivoCliente | null) {
    let clienteId = a?.customer_id ?? null;

    if (!clienteId) {
      const clientes = await this.listaClientes();
      if (!clientes.length) {
        await Swal.fire({
          icon: 'info', title: 'Primero, un cliente',
          text: 'Un coche es de alguien. Da de alta al cliente y vuelve.',
        });
        return;
      }
      const opciones = Object.fromEntries(clientes.map(c => [String(c.id), c.customerName]));
      const { value } = await Swal.fire({
        title: '¿De quién es?', input: 'select', inputOptions: opciones,
        inputPlaceholder: 'Elige el cliente', showCancelButton: true, confirmButtonText: 'Siguiente',
      });
      if (!value) return;
      clienteId = Number(value);
    }

    const { value: datos } = await Swal.fire({
      title: a ? 'Editar' : 'Nuevo registro',
      html: ServiciosActivos.formulario(a),
      focusConfirm: false, showCancelButton: true, confirmButtonText: 'Guardar',
      preConfirm: () => ServiciosActivos.leerFormulario(),
    });
    if (!datos) return;

    const r = await this.srv.guardarActivo({ id: a?.id ?? null, clienteId, ...(datos as any) });
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se pudo guardar', text: r.error }); return; }
    await this.cargar();
  }

  async alternar(a: ActivoCliente) {
    const r = await this.srv.activarActivo(a.id, !a.active);
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se pudo', text: r.error }); return; }
    await this.cargar();
  }

  /**
   * EL ASISTENTE DE VINCULACIÓN.
   *
   * Un negocio que lleva años en Retail tiene cientos de clientes y ningún
   * activo, porque hasta hoy no existían. Recorrer esa lista a mano —abrir
   * cada cliente, registrar su coche, volver— es el trabajo que no se hace
   * nunca y deja el módulo a medio usar.
   *
   * Aquí se recorren los que NO tienen nada registrado, uno detrás de otro,
   * sin salir de la pantalla. Se puede saltar a cualquiera y se puede parar
   * cuando se quiera: lo hecho queda.
   */
  async asistente() {
    const clientes = await this.listaClientes();
    if (!clientes.length) {
      await Swal.fire({ icon: 'info', title: 'Todavía no hay clientes' });
      return;
    }

    const todos = await this.srv.activos({ soloActivos: false });
    const conActivo = new Set(todos.datos.map(a => a.customer_id));
    const pendientes = clientes.filter(c => !conActivo.has(c.id));

    if (!pendientes.length) {
      await Swal.fire({
        icon: 'success', title: 'Todos tus clientes ya tienen algo registrado',
        text: `${clientes.length} cliente(s), ninguno pendiente.`,
      });
      return;
    }

    const inicio = await Swal.fire({
      icon: 'question',
      title: 'Vincular clientes',
      html: `<p style="font-size:14px;line-height:1.55;margin:0">
               Tienes <b>${pendientes.length}</b> cliente(s) sin nada registrado.<br>
               Te los voy pasando uno por uno. Puedes saltar los que quieras y
               parar cuando quieras: lo que registres se guarda al momento.
             </p>`,
      showCancelButton: true, confirmButtonText: 'Empezar', cancelButtonText: 'Ahora no',
    });
    if (!inicio.isConfirmed) return;

    let hechos = 0;
    for (let i = 0; i < pendientes.length; i++) {
      const c = pendientes[i];
      const { value: datos, dismiss } = await Swal.fire({
        title: c.customerName,
        html: ServiciosActivos.formulario(null,
          `Cliente ${i + 1} de ${pendientes.length} · ${hechos} registrado(s)`),
        focusConfirm: false,
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: 'Guardar y seguir',
        denyButtonText: 'Saltar',
        cancelButtonText: 'Parar aquí',
        preConfirm: () => ServiciosActivos.leerFormulario(),
      });

      /* Parar es `cancel`; cerrar con Escape también para: en un recorrido
         largo, seguir preguntando después de un Escape es hostigar. */
      if (dismiss) break;
      if (!datos) continue;   // «Saltar»

      const r = await this.srv.guardarActivo({ clienteId: c.id, ...(datos as any) });
      if (!r.ok) {
        const seguir = await Swal.fire({
          icon: 'error', title: 'No se pudo guardar', text: r.error,
          showCancelButton: true, confirmButtonText: 'Seguir con el siguiente',
          cancelButtonText: 'Parar',
        });
        if (!seguir.isConfirmed) break;
        continue;
      }
      hechos++;
    }

    await this.cargar();
    if (hechos) {
      await Swal.fire({
        icon: 'success', title: `${hechos} registrado(s)`,
        text: 'Puedes volver a abrir el asistente cuando quieras: te ofrecerá sólo los que falten.',
      });
    }
  }

  private async listaClientes(): Promise<any[]> {
    try {
      const r = await (window as any).electronAPI?.getCustomers?.();
      return r?.data ?? r ?? [];
    } catch { return []; }
  }
}
