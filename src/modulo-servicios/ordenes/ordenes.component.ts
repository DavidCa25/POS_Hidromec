import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import Swal from 'sweetalert2';
import { AuthService, PAQUETES } from '../../services/auth.service';
import { OrdenResumen, ServiciosService } from '../servicios.service';

/**
 * EL TABLERO DE ÓRDENES.
 *
 * La pregunta que responde es «¿qué tengo dentro?», y esa pregunta son varios
 * estados a la vez, no uno. Por eso los filtros son una fila de pestañas con
 * conteo y no un desplegable: lo que hace falta es ver de un vistazo cuántas
 * hay en cada sitio, sobre todo cuántas esperan autorización, que son las que
 * están paradas costando dinero.
 *
 * LA REAUTORIZACIÓN SE VE ANTES QUE NADA
 * --------------------------------------
 * Una orden cuyo presupuesto cambió después de que el cliente lo aprobara es
 * la que más caro sale: se sigue trabajando sobre algo que nadie autorizó. Se
 * marca en la fila y tiene su propio filtro.
 */
@Component({
  selector: 'app-servicios-ordenes',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  styleUrls: ['../servicios.css'],
  template: `
  <div class="srv-pagina">
    <header class="srv-cab">
      <div>
        <h1>Órdenes de servicio</h1>
        <p class="srv-sub">El trabajo que hay dentro, y cómo va.</p>
      </div>
      <button class="btn btn-primary" (click)="nueva()" *ngIf="puedeOperar">
        <i class="ph ph-plus"></i> Nueva orden
      </button>
    </header>

    <nav class="srv-tabs" role="tablist">
      <button *ngFor="let t of tabs"
              class="srv-tab" [class.activo]="filtro() === t.id"
              role="tab" [attr.aria-selected]="filtro() === t.id"
              (click)="cambiarFiltro(t.id)">
        {{ t.label }}
        <span class="srv-tab-n" *ngIf="conteo(t.id) as n">{{ n }}</span>
      </button>
    </nav>

    <div class="srv-barra">
      <input class="ctl" type="search" placeholder="Folio, cliente, placa…"
             [ngModel]="busqueda()" (ngModelChange)="buscar($event)"
             aria-label="Buscar órdenes" />
      <span class="srv-hint" *ngIf="cargando()">Buscando…</span>
    </div>

    <div class="srv-tabla-wrap">
      <table class="srv-tabla">
        <thead>
          <tr>
            <th style="width:104px">Folio</th>
            <th>Cliente</th>
            <th>Sobre qué</th>
            <th style="width:150px">Estado</th>
            <th style="width:104px">Avance</th>
            <th class="ta-r" style="width:110px">Total</th>
            <th style="width:120px">Cobro</th>
            <th style="width:120px">Recibida</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let o of ordenes(); trackBy: porId" (click)="abrir(o)" tabindex="0"
              (keydown.enter)="abrir(o)" class="srv-fila">
            <td class="mono">{{ o.folio }}</td>
            <td>
              {{ o.customer_name }}
              <div class="srv-alerta" *ngIf="o.needs_reauthorization && o.status !== 'CANCELADA'">
                Sin autorizar
              </div>
            </td>
            <td class="srv-dim">
              {{ o.asset_label || '—' }}
              <span class="mono" *ngIf="o.asset_identifier"> · {{ o.asset_identifier }}</span>
            </td>
            <td><span class="srv-badge" [class]="'srv-badge--' + claseEstado(o.status)">{{ etiqueta(o.status) }}</span></td>
            <td class="srv-dim mono">{{ o.lines_done }}/{{ o.lines_count }}</td>
            <td class="ta-r mono">{{ o.total | currency:'MXN':'symbol-narrow' }}</td>
            <td>
              <span class="srv-badge" [class]="'srv-badge--' + claseCobro(o.economic_status)">
                {{ etiquetaCobro(o.economic_status) }}
              </span>
            </td>
            <td class="srv-dim">{{ o.opened_at | date:'d MMM, HH:mm':undefined:'es-MX' }}</td>
          </tr>
        </tbody>
      </table>

      <div class="srv-vacio" *ngIf="!cargando() && ordenes().length === 0">
        <p *ngIf="busqueda()">Nada coincide con «{{ busqueda() }}».</p>

        <!--
          Primer uso: el módulo se acaba de encender y no hay nada.

          Una pantalla vacía con un botón «Abrir la primera orden» deja a quien
          la ve sin saber que antes hace falta un catálogo. No es un recorrido
          ni un tutorial: son los tres pasos, con su enlace, y desaparece solo
          en cuanto hay catálogo. Un aviso que no se va deja de leerse.
        -->
        <ng-container *ngIf="!busqueda() && sinCatalogo()">
          <p><b>Servicios está encendido. Faltan dos cosas para usarlo.</b></p>
          <ol class="srv-pasos">
            <li>
              <b>Di qué cobras por trabajo.</b>
              Una afinación, un corte, una consulta.
              <a routerLink="../catalogo" *ngIf="puedeAdministrar">Ir al catálogo</a>
              <span class="srv-dim" *ngIf="!puedeAdministrar">Lo hace un encargado.</span>
            </li>
            <li>
              <b>Di quién lo hace.</b>
              No necesitan usuario de Wybix.
              <a routerLink="../profesionales" *ngIf="puedeAdministrar">Ir a profesionales</a>
              <span class="srv-dim" *ngIf="!puedeAdministrar">Lo hace un encargado.</span>
            </li>
            <li>
              <b>Abre una orden cuando entre trabajo.</b>
              Podrás cotizarla después, cuando sepas qué hay que hacer.
            </li>
          </ol>
        </ng-container>

        <ng-container *ngIf="!busqueda() && !sinCatalogo()">
          <p><b>Aquí aparece el trabajo que entra.</b></p>
          <p class="srv-sub">Abre una orden cuando recibas algo: el coche, la mascota, el equipo.
             Podrás cotizarlo después, cuando sepas qué hay que hacerle.</p>
          <button class="btn btn-primary" (click)="nueva()" *ngIf="puedeOperar">Abrir la primera orden</button>
        </ng-container>
      </div>
    </div>
  </div>
  `,
})
export class ServiciosOrdenes {
  private readonly srv = inject(ServiciosService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  readonly ordenes = signal<OrdenResumen[]>([]);
  readonly cargando = signal(false);
  readonly filtro = signal<string>('dentro');
  readonly busqueda = signal('');
  private readonly conteos = signal<Record<string, number>>({});

  get puedeOperar(): boolean { return this.auth.puede(PAQUETES.SERVICIOS_OPERAR); }
  get puedeAdministrar(): boolean { return this.auth.puede(PAQUETES.SERVICIOS_ADMINISTRAR); }

  /**
   * El modulo esta encendido pero todavia no hay nada que ofrecer.
   *
   * `null` mientras no se sabe: sin esto, la pantalla parpadea entre los dos
   * mensajes en cuanto tarda la consulta, que es peor que no decir nada.
   */
  private readonly hayCatalogo = signal<boolean | null>(null);
  sinCatalogo(): boolean { return this.hayCatalogo() === false; }

  /**
   * «Dentro» es el filtro por omisión, y no «todas», porque el tablero se abre
   * para trabajar: lo entregado el mes pasado no ayuda a decidir nada hoy.
   */
  readonly tabs = [
    { id: 'dentro', label: 'Dentro', estados: ['ABIERTA', 'EN_PROCESO'] },
    { id: 'sin-autorizar', label: 'Sin autorizar', estados: ['ABIERTA', 'EN_PROCESO'] },
    { id: 'terminadas', label: 'Por cobrar', estados: ['TERMINADA'] },
    { id: 'entregadas', label: 'Entregadas', estados: ['ENTREGADA'] },
    { id: 'todas', label: 'Todas', estados: [] as string[] },
  ];

  porId = (_: number, o: OrdenResumen) => o.id;
  conteo(id: string): number { return this.conteos()[id] ?? 0; }

  constructor() { void this.cargar(); }

  /**
   * Se pregunta por el catálogo sólo cuando el tablero salió vacío, y una sola
   * vez. Un negocio con órdenes dentro no necesita que se le pregunte nada: la
   * consulta sería una llamada por cada vez que abre la pantalla para saber
   * algo que ya no le va a cambiar el mensaje.
   */
  private async mirarCatalogo() {
    if (this.hayCatalogo() !== null) return;
    const r = await this.srv.catalogo({ soloActivos: true });
    /* Si la consulta falla se asume que sí hay: es peor decirle a quien lleva
       meses trabajando que le falta montar el catálogo. */
    this.hayCatalogo.set(r.ok ? r.datos.length > 0 : true);
  }

  cambiarFiltro(id: string) { this.filtro.set(id); void this.cargar(); }

  private temporizador: any = null;
  buscar(v: string) {
    this.busqueda.set(v);
    /* Se espera a que dejen de teclear: una consulta por pulsación llena la
       red de preguntas que nadie llega a leer. */
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => void this.cargar(), 250);
  }

  async cargar() {
    this.cargando.set(true);
    const tab = this.tabs.find(t => t.id === this.filtro())!;
    const r = await this.srv.ordenes({
      estados: tab.estados,
      busqueda: this.busqueda() || undefined,
    });
    this.cargando.set(false);
    if (!r.ok) {
      await Swal.fire({ icon: 'error', title: 'No se pudo cargar', text: r.error });
      return;
    }
    const filas = this.filtro() === 'sin-autorizar'
      ? r.datos.filter(o => o.needs_reauthorization)
      : r.datos;
    this.ordenes.set(filas);
    if (filas.length === 0 && !this.busqueda()) void this.mirarCatalogo();
    void this.recontar();
  }

  /** Los números de las pestañas: una sola consulta amplia, no cinco. */
  private async recontar() {
    const r = await this.srv.ordenes({ top: 500 });
    if (!r.ok) return;
    const t = r.datos;
    this.conteos.set({
      dentro: t.filter(o => o.status === 'ABIERTA' || o.status === 'EN_PROCESO').length,
      'sin-autorizar': t.filter(o => o.needs_reauthorization && o.status !== 'CANCELADA' && o.status !== 'ENTREGADA').length,
      terminadas: t.filter(o => o.status === 'TERMINADA').length,
      entregadas: t.filter(o => o.status === 'ENTREGADA').length,
      todas: t.length,
    });
  }

  abrir(o: OrdenResumen) { void this.router.navigate(['/dashboard/ordenes-de-servicio/orden', o.id]); }
  nueva() { void this.router.navigate(['/dashboard/ordenes-de-servicio/orden', 'nueva']); }

  etiqueta(s: string): string {
    return ({
      BORRADOR: 'Borrador', ABIERTA: 'Recibida', EN_PROCESO: 'En proceso',
      TERMINADA: 'Terminada', ENTREGADA: 'Entregada', CANCELADA: 'Cancelada',
    } as Record<string, string>)[s] ?? s;
  }
  claseEstado(s: string): string {
    return ({
      BORRADOR: 'mute', ABIERTA: 'info', EN_PROCESO: 'info',
      TERMINADA: 'ok', ENTREGADA: 'mute', CANCELADA: 'mute',
    } as Record<string, string>)[s] ?? 'mute';
  }
  etiquetaCobro(s: string): string {
    return ({ SIN_COBRAR: 'Sin cobrar', POR_COBRAR: 'A crédito', PAGADA: 'Pagada' } as Record<string, string>)[s] ?? s;
  }
  claseCobro(s: string): string {
    return ({ SIN_COBRAR: 'mute', POR_COBRAR: 'warn', PAGADA: 'ok' } as Record<string, string>)[s] ?? 'mute';
  }
}
