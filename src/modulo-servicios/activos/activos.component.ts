import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WxOpcion, WxSelectComponent } from '../../app/wx-select/wx-select.component';
import Swal from 'sweetalert2';
import { AuthService, PAQUETES } from '../../services/auth.service';
import { ActivoCliente, ServiciosService } from '../servicios.service';
import { GiroServiciosService, PresetActivo } from '../../core';

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
  imports: [CommonModule, FormsModule, WxSelectComponent],
  styleUrls: ['../servicios.css'],
  template: `
  <div class="srv-pagina">
    <header class="srv-cab">
      <div>
        <h1>{{ giro.activoPlural }}</h1>
        <p class="srv-sub">Lo que tus clientes traen a trabajar.</p>
      </div>
      <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap" *ngIf="puedeOperar">
        <button class="btn" (click)="asistente()">Vincular clientes</button>
        <button class="btn btn-primary" (click)="editar(null)">Nuevo</button>
      </div>
    </header>

    <div class="srv-barra">
      <input class="ctl" type="search"
             [placeholder]="giro.activoIdentificador + ', nombre o cliente…'"
             [ngModel]="busqueda()" (ngModelChange)="buscar($event)"
             [attr.aria-label]="'Buscar por ' + giro.activoIdentificador + ', nombre o cliente'" />
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
            <th style="width:140px">{{ giro.activoIdentificador }}</th>
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

  <!-- ------------------------------------------------ alta y edición -->
  <div class="modal fade show d-block srv-modal" *ngIf="dialogo()"
       role="dialog" aria-modal="true" aria-labelledby="ac-t">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content rounded-4">
        <div class="modal-header border-0 pb-1">
          <h5 class="modal-title fw-bold m-0" id="ac-t">
            {{ form.clienteId && editandoAlgo ? 'Editar' : giro.textos.registrarActivo || 'Nuevo registro' }}
          </h5>
          <button type="button" class="btn-close" (click)="cerrarDialogo()" aria-label="Cerrar"></button>
        </div>
        <div class="modal-body px-4 pt-1 pb-4">

          <p class="srv-paso" *ngIf="enAsistente">
            Cliente {{ indice + 1 }} de {{ pendientes.length }} · {{ hechos }} registrado(s)
          </p>

          <label class="form-label" for="ac-cli">De quién es</label>
          <wx-select id="ac-cli" [opciones]="opcClientes" [buscable]="true"
                     placeholder="Elige el cliente" textoBusqueda="Buscar cliente…"
                     [disabled]="enAsistente" [(ngModel)]="form.clienteId"></wx-select>

          <div class="srv-campos mt-3">
            <div *ngIf="opcClases.length > 1">
              <label class="form-label" for="ac-clase">Qué es</label>
              <wx-select id="ac-clase" [opciones]="opcClases" [(ngModel)]="form.clase"></wx-select>
            </div>
            <div>
              <label class="form-label" for="ac-label2">Cómo se le llama</label>
              <input id="ac-label2" class="form-control" [(ngModel)]="form.etiqueta"
                     [placeholder]="giro.giro().activo.ejemplo || 'Para reconocerlo'">
            </div>
            <div>
              <label class="form-label" for="ac-id2">{{ giro.activoIdentificador }}</label>
              <input id="ac-id2" class="form-control" [(ngModel)]="form.identificador"
                     [placeholder]="giro.giro().activo.ejemploIdentificador">
            </div>
            <div>
              <label class="form-label" for="ac-marca2">Marca</label>
              <input id="ac-marca2" class="form-control" [(ngModel)]="form.marca">
            </div>
            <div>
              <label class="form-label" for="ac-modelo2">Modelo</label>
              <input id="ac-modelo2" class="form-control" [(ngModel)]="form.modelo">
            </div>
            <div>
              <label class="form-label" for="ac-anio2">Año o edad</label>
              <input id="ac-anio2" class="form-control" [(ngModel)]="form.anio">
            </div>
            <div>
              <label class="form-label" for="ac-color2">Color</label>
              <input id="ac-color2" class="form-control" [(ngModel)]="form.color">
            </div>
          </div>

          <label class="form-label mt-3" for="ac-notas2">Notas</label>
          <input id="ac-notas2" class="form-control" [(ngModel)]="form.notas"
                 placeholder="Lo que conviene recordar la próxima vez">

          <p class="srv-error" *ngIf="errorModal()" role="alert">{{ errorModal() }}</p>

          <div class="d-flex justify-content-end gap-2 mt-4" *ngIf="!enAsistente">
            <button type="button" class="btn btn-outline-secondary" (click)="cerrarDialogo()">Cancelar</button>
            <button type="button" class="btn btn-primary" [disabled]="guardando()"
                    (click)="confirmar()">{{ guardando() ? 'Guardando…' : 'Guardar' }}</button>
          </div>

          <div class="d-flex justify-content-end gap-2 mt-4" *ngIf="enAsistente">
            <button type="button" class="btn btn-outline-secondary" (click)="cerrarDialogo()">Parar aquí</button>
            <button type="button" class="btn btn-outline-secondary" [disabled]="guardando()"
                    (click)="siguientePendiente(false)">Saltar</button>
            <button type="button" class="btn btn-primary" [disabled]="guardando()"
                    (click)="siguientePendiente(true)">
              {{ guardando() ? 'Guardando…' : 'Guardar y seguir' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
  `,
})
export class ServiciosActivos {
  /* El vocabulario de esta pantalla no es fijo: en un taller son vehículos con
     placa y en un taller de electrónicos son equipos con número de serie. Lo
     decide el giro, y la tabla de debajo es la misma. */
  readonly giro = inject(GiroServiciosService);

  private readonly srv = inject(ServiciosService);
  private readonly auth = inject(AuthService);

  readonly activos = signal<ActivoCliente[]>([]);
  readonly cargando = signal(false);
  readonly busqueda = signal('');
  readonly verRetirados = signal(false);
  readonly clases = CLASES;

  /* El modal: mismo marcado que la orden y la agenda. */
  readonly dialogo = signal(false);
  readonly guardando = signal(false);
  readonly errorModal = signal('');
  private editando: ActivoCliente | null = null;
  /** El recorrido del asistente: a quién le falta y por dónde vamos. */
  pendientes: any[] = [];
  indice = 0;
  hechos = 0;
  get enAsistente(): boolean { return this.pendientes.length > 0; }
  get clienteActual(): string { return this.pendientes[this.indice]?.customerName ?? ''; }
  opcClientes: WxOpcion[] = [];
  form = {
    clienteId: null as number | null,
    clase: 'OTRO', etiqueta: '', identificador: '',
    marca: '', modelo: '', anio: '', color: '', notas: '',
  };

  /** Las clases que ofrece ESTE giro, no las cinco de siempre. */
  get opcClases(): WxOpcion[] {
    const permitidas = this.giro.tiposDeActivo;
    return CLASES
      .filter(c => !permitidas.length || permitidas.includes(c.valor))
      .map(c => ({ valor: c.valor, etiqueta: c.etiqueta ?? '', nota: c.ejemplo || undefined }));
  }


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


  /**
   * Alta y edición, en UN modal con sus etiquetas.
   *
   * Eran dos avisos encadenados —primero de quién es, después los datos— con
   * siete campos sin etiqueta, sólo con textos de ayuda que desaparecen al
   * escribir, y un `<select>` del sistema operativo que ofrecía vehículo,
   * mascota, equipo e inmueble en todos los giros. Ahora las clases las
   * decide el giro y los campos dicen cómo se llaman aquí.
   */
  async editar(a: ActivoCliente | null) {
    this.editando = a;
    this.opcClientes = (await this.listaClientes()).map(c => ({
      valor: c.id,
      etiqueta: c.customerName ?? '(sin nombre)',
      nota: c.mobile || c.phone || undefined,
    }));
    if (!this.opcClientes.length) {
      await Swal.fire({
        icon: 'info', title: 'Primero, un cliente',
        text: `${this.giro.activoSingular} es de alguien. Da de alta al cliente y vuelve.`,
      });
      return;
    }

    const v = this.giro.giro().activo;
    this.form = {
      clienteId: a?.customer_id ?? null,
      clase: a?.kind ?? v.tipo ?? 'OTRO',
      etiqueta: a?.label ?? '',
      identificador: a?.identifier ?? '',
      marca: a?.brand ?? '',
      modelo: a?.model ?? '',
      anio: a?.year_or_age ?? '',
      color: a?.color ?? '',
      notas: a?.notes ?? '',
    };
    this.errorModal.set('');
    this.dialogo.set(true);
  }

  async confirmar() {
    if (!this.form.clienteId) { this.errorModal.set('Elige de quién es.'); return; }
    if (!this.form.etiqueta.trim()) { this.errorModal.set('Ponle un nombre para reconocerlo.'); return; }

    this.guardando.set(true);
    const r = await this.srv.guardarActivo({
      id: this.editando?.id ?? null,
      clienteId: Number(this.form.clienteId),
      clase: this.form.clase || 'OTRO',
      etiqueta: this.form.etiqueta.trim(),
      identificador: this.form.identificador.trim() || null,
      marca: this.form.marca.trim() || null,
      modelo: this.form.modelo.trim() || null,
      anioOEdad: this.form.anio.trim() || null,
      color: this.form.color.trim() || null,
      notas: this.form.notas.trim() || null,
    });
    this.guardando.set(false);
    if (!r.ok) { this.errorModal.set(r.error || 'No se pudo guardar.'); return; }
    this.cerrarDialogo();
    await this.cargar();
  }

  get editandoAlgo(): boolean { return this.editando !== null; }

  cerrarDialogo() {
    this.dialogo.set(false);
    this.errorModal.set('');
    this.guardando.set(false);
    this.editando = null;
    this.pendientes = [];
    this.indice = 0;
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
  /**
   * VINCULAR DE UNA SENTADA A QUIEN YA ESTABA.
   *
   * Un negocio que enciende Servicios ya tiene clientes, y ninguno tiene nada
   * registrado porque hasta hoy no existía. El asistente los recorre y va
   * dando de alta uno por uno, sin salir de la pantalla ni volver a elegir el
   * cliente cada vez.
   *
   * Es el MISMO modal del alta, con el contador y los dos botones de avance.
   * Antes eran avisos encadenados con el formulario dentro, y salirse a mitad
   * perdía lo escrito.
   */
  async asistente() {
    const clientes = await this.listaClientes();
    const conActivo = new Set(this.activos().map(a => a.customer_id));
    this.pendientes = clientes.filter(c => !conActivo.has(c.id));

    if (!this.pendientes.length) {
      await Swal.fire({
        icon: 'success',
        title: 'No queda nadie por vincular',
        text: `Todos tus clientes ya tienen al menos ${this.giro.activoSingular.toLowerCase()} registrado.`,
      });
      return;
    }

    this.indice = 0;
    this.hechos = 0;
    this.prepararPendiente();
    this.errorModal.set('');
    this.dialogo.set(true);
  }

  /** Deja el formulario listo para el cliente que toca ahora. */
  private prepararPendiente() {
    const c = this.pendientes[this.indice];
    this.editando = null;
    this.form = {
      clienteId: c?.id ?? null,
      clase: this.giro.giro().activo.tipo ?? 'OTRO',
      etiqueta: '', identificador: '', marca: '', modelo: '', anio: '', color: '', notas: '',
    };
  }

  /** Guarda lo de este cliente y pasa al siguiente. */
  async siguientePendiente(guardar: boolean) {
    if (guardar) {
      if (!this.form.etiqueta.trim()) { this.errorModal.set('Ponle un nombre para reconocerlo.'); return; }
      this.guardando.set(true);
      const r = await this.srv.guardarActivo({
        clienteId: Number(this.form.clienteId),
        clase: this.form.clase || 'OTRO',
        etiqueta: this.form.etiqueta.trim(),
        identificador: this.form.identificador.trim() || null,
        marca: this.form.marca.trim() || null,
        modelo: this.form.modelo.trim() || null,
        anioOEdad: this.form.anio.trim() || null,
        color: this.form.color.trim() || null,
        notas: this.form.notas.trim() || null,
      });
      this.guardando.set(false);
      if (!r.ok) { this.errorModal.set(r.error || 'No se pudo guardar.'); return; }
      this.hechos++;
    }

    this.errorModal.set('');
    this.indice++;
    if (this.indice >= this.pendientes.length) {
      const n = this.hechos;
      this.cerrarDialogo();
      await this.cargar();
      await Swal.fire({
        icon: 'success',
        title: n ? `Listo: ${n} registrado(s)` : 'Sin cambios',
        text: 'Puedes volver a abrir el asistente cuando quieras: te ofrecerá sólo los que falten.',
      });
      return;
    }
    this.prepararPendiente();
  }

  private async listaClientes(): Promise<any[]> {
    try {
      const r = await (window as any).electronAPI?.getCustomers?.();
      return r?.data ?? r ?? [];
    } catch { return []; }
  }
}
