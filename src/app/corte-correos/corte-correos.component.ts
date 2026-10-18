import { Component, AfterViewInit, OnDestroy, ElementRef, EventEmitter, Input, Output, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WxDateComponent } from '../wx-date/wx-date.component';
import { WxCargandoComponent } from '../wx-cargando/wx-cargando.component';
import { WxMenuComponent, WxMenuOpcion } from '../wx-menu/wx-menu.component';
import { ReportService } from '../../services/report.service';

/** Un corte cerrado con el estado de su correo (sp_cash_closure_email_list). */
interface CorteCorreo {
  id: number; opened_at: string; closed_at: string; register_name: string | null; cashier: string | null;
  total: number | null; difference: number | null;
  email_status: 'SIN_ENVIAR' | 'PENDIENTE' | 'ENVIANDO' | 'ENVIADO' | 'ERROR';
  sent_at: string | null; attempts: number | null; recipients: number | null; last_error: string | null;
}

const ESTADOS: Record<CorteCorreo['email_status'], string> = {
  SIN_ENVIAR: 'Sin enviar', PENDIENTE: 'Pendiente', ENVIANDO: 'Enviando…', ENVIADO: 'Enviado', ERROR: 'No salió',
};

const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/*
 * CORREOS DE CORTES (0061).
 *
 * Cada corte cerrado con su bandera de correo. Un corte ENVIADO no tiene
 * botón: ya les llegó a los dueños y no se vuelve a mandar, ni aquí ni en
 * "Enviar pendientes" (que solo toma lo que no salió, hasta 30 por vez).
 * A quién se manda lo decide la nube: los dueños del negocio en Owner.
 */
@Component({
  selector: 'app-corte-correos',
  standalone: true,
  imports: [CommonModule, FormsModule, CurrencyPipe, DatePipe, WxDateComponent, WxCargandoComponent, WxMenuComponent],
  template: `<dialog #dialog class="wx-dialogo cc" (cancel)="cerrar()" aria-labelledby="cc-titulo">
    <header class="cc-cab">
      <div>
        <h3 id="cc-titulo">Correos de cortes</h3>
        <p class="cc-sub">El detalle de cada corte llega al correo de los dueños del negocio en Wybix Owner.</p>
      </div>
      <button type="button" class="btn btn-light" (click)="cerrar()" [disabled]="enviandoLote()" aria-label="Cerrar"><i class="ph ph-x"></i></button>
    </header>

    <div class="cc-filtros">
      <label>Desde<wx-date [ngModel]="desde()" (ngModelChange)="desde.set($event || desde()); cargar()" [max]="hasta()" [limpiable]="false"></wx-date></label>
      <label>Hasta<wx-date [ngModel]="hasta()" (ngModelChange)="hasta.set($event || hasta()); cargar()" [min]="desde()" [max]="hoy" [limpiable]="false"></wx-date></label>
      <div class="cc-resumen" aria-live="polite">
        <span><b>{{ enviados() }}</b> enviados</span>
        <span [class.cc-hay]="pendientes()"><b>{{ pendientes() }}</b> sin enviar</span>
      </div>
    </div>

    <p *ngIf="!nube()" class="cc-aviso" role="status"><i class="ph ph-cloud-slash"></i>Esta caja no está vinculada con Wybix en la nube. Los cortes quedan sin enviar hasta que la vincules en Configuración.</p>
    <p *ngIf="error()" class="cc-error" role="alert">{{ error() }}</p>
    <p *ngIf="aviso()" class="cc-ok" role="status">{{ aviso() }}</p>

    <div class="cc-lista">
      <div *ngIf="cargando()" class="cc-vacio"><wx-cargando [size]="20" alt="Cargando cortes"></wx-cargando></div>
      <div *ngIf="!cargando() && !cortes().length" class="cc-vacio">No hay cortes cerrados en estas fechas.</div>
      <table *ngIf="!cargando() && cortes().length">
        <thead><tr><th>Corte</th><th>Cerrado</th><th class="der">Vendido</th><th class="der">Diferencia</th><th>Correo</th><th></th></tr></thead>
        <tbody>
          <tr *ngFor="let c of cortes()">
            <td><b>#{{ c.id }}</b><div class="cc-tenue">{{ c.register_name || 'Caja' }} · {{ c.cashier || '—' }}</div></td>
            <td>{{ c.closed_at | date:'dd/MM/yy HH:mm':'UTC' }}</td>
            <td class="der">{{ (c.total ?? 0) | currency:'MXN':'symbol-narrow' }}</td>
            <td class="der" [class.cc-falta]="(c.difference ?? 0) <= -0.01" [class.cc-sobra]="(c.difference ?? 0) >= 0.01">{{ (c.difference ?? 0) | currency:'MXN':'symbol-narrow' }}</td>
            <td>
              <span class="cc-chip" [attr.data-estado]="c.email_status">{{ etiqueta(c.email_status) }}</span>
              <div class="cc-tenue" *ngIf="c.email_status === 'ENVIADO'">{{ c.sent_at | date:'dd/MM HH:mm':'UTC' }} · {{ c.recipients || 0 }} destinatario{{ c.recipients === 1 ? '' : 's' }}</div>
              <div class="cc-tenue cc-falta" *ngIf="c.email_status === 'ERROR' && c.last_error" [title]="c.last_error">{{ c.last_error }}</div>
            </td>
            <td class="der">
              <button *ngIf="c.email_status !== 'ENVIADO'" type="button" class="btn btn-outline-primary btn-sm"
                      [disabled]="!nube() || enviandoLote() || enviandoUno() === c.id || c.email_status === 'ENVIANDO'" (click)="enviarUno(c)">
                {{ enviandoUno() === c.id ? 'Enviando…' : 'Enviar' }}
              </button>
              <i *ngIf="c.email_status === 'ENVIADO'" class="ph ph-check-circle cc-listo" aria-label="Ya enviado"></i>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="cc-pie">
      <span class="cc-tenue">Los cortes ya enviados no se vuelven a mandar.</span>
      <wx-menu etiqueta="Exportar lista" icono="ph ph-download-simple" variante="neutral" [opciones]="opcionesExportar"
               [deshabilitado]="cargando() || !cortes().length" (elegir)="exportar($any($event))"></wx-menu>
      <button type="button" class="btn btn-primary" [disabled]="!nube() || !pendientes() || enviandoLote() || cargando()" (click)="enviarPendientes()">
        <wx-cargando *ngIf="enviandoLote()" [size]="14" alt=""></wx-cargando>
        <i *ngIf="!enviandoLote()" class="ph ph-paper-plane-tilt"></i>
        {{ enviandoLote() ? 'Enviando…' : 'Enviar pendientes (' + Math.min(pendientes(), 30) + ')' }}
      </button>
    </footer>
  </dialog>`,
  styles: [`
    .cc { width: min(860px, 96vw); max-height: 92vh; padding: 22px; display: flex; flex-direction: column; gap: 14px; }
    .cc[open] { display: flex; }
    .cc::backdrop { background: var(--wx-dialogo-velo); }
    .cc-cab { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
    .cc-cab h3 { margin: 0; color: var(--wx-dialogo-cabecera); }
    .cc-sub, .cc-tenue { color: var(--wx-dialogo-tenue); font-size: var(--wx-text-sm); margin: 2px 0 0; }
    .cc-filtros { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }
    .cc-filtros label { display: flex; flex-direction: column; gap: 4px; font-size: var(--wx-text-sm); color: var(--wx-dialogo-tenue); min-width: 170px; }
    .cc-resumen { margin-left: auto; display: flex; gap: 16px; font-size: var(--wx-text-sm); color: var(--wx-dialogo-tenue); }
    .cc-resumen b { color: var(--wx-dialogo-texto); font-size: var(--wx-text-base); }
    .cc-resumen .cc-hay b { color: var(--wx-warning-ink); }
    .cc-aviso, .cc-error, .cc-ok { margin: 0; padding: 10px 12px; border-radius: var(--wx-radius-sm); font-size: var(--wx-text-sm); display: flex; gap: 8px; align-items: center; }
    .cc-aviso { background: var(--wx-warning-soft); color: var(--wx-warning-ink); }
    .cc-error { background: var(--wx-danger-soft); color: var(--wx-danger-ink); }
    .cc-ok { background: var(--wx-success-soft); color: var(--wx-success-ink); }
    .cc-lista { overflow: auto; min-height: 160px; border: 1px solid var(--wx-dialogo-borde); border-radius: var(--wx-radius-sm); }
    .cc-vacio { display: grid; place-items: center; min-height: 160px; color: var(--wx-dialogo-tenue); }
    table { width: 100%; border-collapse: collapse; font-size: var(--wx-text-sm); }
    th { position: sticky; top: 0; background: var(--wx-dialogo-elevado); text-align: left; font-weight: 600; color: var(--wx-dialogo-tenue); padding: 8px 10px; border-bottom: 1px solid var(--wx-dialogo-borde); }
    td { padding: 9px 10px; border-bottom: 1px solid var(--wx-edge-soft); vertical-align: top; }
    .der { text-align: right; white-space: nowrap; }
    .cc-falta { color: var(--wx-danger-ink); }
    .cc-sobra { color: var(--wx-warning-ink); }
    .cc-tenue.cc-falta { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cc-chip { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: var(--wx-text-xs); font-weight: 600; background: var(--wx-sunken); color: var(--wx-dialogo-tenue); }
    .cc-chip[data-estado='ENVIADO'] { background: var(--wx-success-soft); color: var(--wx-success-ink); }
    .cc-chip[data-estado='ERROR'] { background: var(--wx-danger-soft); color: var(--wx-danger-ink); }
    .cc-chip[data-estado='SIN_ENVIAR'], .cc-chip[data-estado='PENDIENTE'] { background: var(--wx-warning-soft); color: var(--wx-warning-ink); }
    .cc-listo { color: var(--wx-success); font-size: 20px; }
    .cc-pie { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
    .cc-pie .btn { display: inline-flex; align-items: center; gap: 8px; }
    .cc-pie wx-menu { margin-left: auto; }
  `],
})
export class CorteCorreosComponent implements AfterViewInit, OnDestroy {
  @Input() registerId: number | null = null;
  @Output() close = new EventEmitter<void>();
  @ViewChild('dialog') dialog!: ElementRef<HTMLDialogElement>;

  readonly Math = Math;
  readonly hoy = isoLocal(new Date());
  readonly desde = signal(isoLocal(new Date(Date.now() - 30 * 86400000)));
  readonly hasta = signal(this.hoy);
  readonly cortes = signal<CorteCorreo[]>([]);
  readonly nube = signal(true);
  readonly cargando = signal(false);
  readonly enviandoLote = signal(false);
  readonly enviandoUno = signal<number | null>(null);
  readonly error = signal('');
  readonly aviso = signal('');
  readonly enviados = computed(() => this.cortes().filter((c) => c.email_status === 'ENVIADO').length);
  readonly pendientes = computed(() => this.cortes().filter((c) => c.email_status !== 'ENVIADO').length);

  private get api() { return (window as any).electronAPI; }

  ngAfterViewInit() { this.dialog.nativeElement.showModal(); this.cargar(); }
  ngOnDestroy() { this.dialog?.nativeElement.close(); }

  etiqueta(e: CorteCorreo['email_status']) { return ESTADOS[e] ?? e; }

  /* Historial de cortes del periodo, para el contador: lo mismo que se ve. */
  private readonly reportes = inject(ReportService);
  readonly opcionesExportar: WxMenuOpcion[] = [
    { valor: 'pdf', etiqueta: 'PDF', icono: 'ph ph-file-pdf' },
    { valor: 'excel', etiqueta: 'Excel', icono: 'ph ph-file-xls' },
  ];
  async exportar(tipo: 'pdf' | 'excel') {
    /* mssql entrega la hora local como si fuera UTC: sus partes UTC son la hora de pared. */
    const f = (v: string | null) => (v ? new Date(v).toLocaleString('es-MX', { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' }) : '');
    const filas = this.cortes();
    const cfg = {
      titulo: 'Historial de cortes de caja',
      subtitulo: `${this.desde().split('-').reverse().join('/')} a ${this.hasta().split('-').reverse().join('/')}`,
      columns: [
        { header: 'Corte', key: 'id', num: true, width: 8 }, { header: 'Caja', key: 'register_name', width: 14 },
        { header: 'Cajero', key: 'cashier', width: 14 }, { header: 'Abrió', key: 'abrio', width: 16 }, { header: 'Cerró', key: 'cerro', width: 16 },
        { header: 'Vendido', key: 'total', money: true, width: 14 }, { header: 'Diferencia', key: 'difference', money: true, width: 14 },
        { header: 'Correo', key: 'correo', width: 22 },
      ],
      rows: filas.map(c => ({ ...c, abrio: f(c.opened_at), cerro: f(c.closed_at),
        correo: this.etiqueta(c.email_status) + (c.email_status === 'ENVIADO' ? ` · ${f(c.sent_at)}` : '') })),
      totals: { total: filas.reduce((a, c) => a + Number(c.total || 0), 0), difference: filas.reduce((a, c) => a + Number(c.difference || 0), 0) },
      meta: [`${filas.length} cortes · ${filas.filter(c => Math.abs(Number(c.difference || 0)) >= 0.01).length} con diferencia`],
      filename: `historial-cortes_${this.desde()}_${this.hasta()}`,
    };
    try {
      if (tipo === 'excel') await this.reportes.exportExcel(cfg);
      else await this.reportes.exportPdf(cfg);
    } catch (e: any) {
      this.error.set(e?.message || 'No se pudo exportar.');
    }
  }
  cerrar() { if (!this.enviandoLote()) this.close.emit(); }

  async cargar() {
    this.cargando.set(true);
    this.error.set('');
    try {
      const r = await this.api.corteCorreoLista({ desde: this.desde(), hasta: this.hasta(), registerId: this.registerId });
      if (!r?.success) throw Error(r?.error || 'No se pudieron cargar los cortes.');
      this.cortes.set(r.data ?? []);
      this.nube.set(r.nube !== false);
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.cargando.set(false);
    }
  }

  async enviarUno(c: CorteCorreo) {
    this.enviandoUno.set(c.id);
    this.error.set('');
    this.aviso.set('');
    try {
      const r = await this.api.corteCorreoEnviar({ closureId: c.id });
      if (!r?.success) throw Error(r?.error || 'No se envió el corte.');
      this.aviso.set(`Corte #${c.id} enviado a ${r.data?.recipients ?? 0} destinatario${r.data?.recipients === 1 ? '' : 's'}.`);
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.enviandoUno.set(null);
      await this.cargar();
    }
  }

  async enviarPendientes() {
    this.enviandoLote.set(true);
    this.error.set('');
    this.aviso.set('');
    try {
      const r = await this.api.corteCorreoEnviar({ pendientes: true, desde: this.desde(), hasta: this.hasta(), registerId: this.registerId });
      if (!r?.success) throw Error(r?.error || 'No se enviaron los cortes.');
      const d = r.data;
      this.aviso.set(`${d.enviados} corte${d.enviados === 1 ? '' : 's'} enviado${d.enviados === 1 ? '' : 's'}.`
        + (d.restantes ? ` Quedan ${d.restantes} sin enviar.` : ''));
      if (d.fallidos) this.error.set(`${d.fallidos} no salieron: ${d.errores?.[0]?.error ?? 'reintenta más tarde.'}`);
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.enviandoLote.set(false);
      await this.cargar();
    }
  }
}
