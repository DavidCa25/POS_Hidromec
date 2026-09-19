import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { ServiciosService } from '../servicios.service';
import { WxDateComponent } from '../../app/wx-date/wx-date.component';

/**
 * COMISIONES: CUÁNTO GENERÓ CADA PERSONA.
 *
 * ESTO NO ES NÓMINA
 * -----------------
 * No hay pagos, ni periodos cerrados, ni descuentos, ni liquidaciones. Quedó
 * explícitamente fuera del alcance, y meterlo a medias sería peor que no
 * tenerlo: una pantalla que dice «pagado» sin que nadie haya pagado nada es
 * una fuente de discusiones, no una herramienta.
 *
 * Lo que hay es el dato del que sale cualquier liquidación, y el detalle para
 * revisarlo cuando alguien no está de acuerdo con el total.
 *
 * SOLO CUENTA LO COBRADO
 * ----------------------
 * Una comisión se devenga al cobrar la orden, no al terminarla. Un trabajo
 * hecho y sin cobrar no ha generado nada todavía, y enseñarlo como generado
 * sería prometer dinero que aún no entró.
 */
@Component({
  selector: 'app-servicios-comisiones',
  standalone: true,
  imports: [CommonModule, FormsModule, WxDateComponent],
  styleUrls: ['../servicios.css'],
  template: `
  <div class="srv-pagina">
    <header class="srv-cab">
      <div>
        <h1>Comisiones</h1>
        <p class="srv-sub">Lo que generó cada persona en trabajos ya cobrados.</p>
      </div>
    </header>

    <div class="srv-barra">
      <div class="srv-campo">
        <label for="com-d">Desde</label>
        <wx-date id="com-d" [(ngModel)]="desde" placeholder="Desde" [limpiable]="false"></wx-date>
      </div>
      <div class="srv-campo">
        <label for="com-h">Hasta</label>
        <wx-date id="com-h" [(ngModel)]="hasta" placeholder="Hasta" [limpiable]="false"></wx-date>
      </div>
      <button class="btn btn-primary" (click)="cargar()" style="align-self:flex-end">Ver</button>
      <span class="srv-hint" *ngIf="cargando()">Calculando…</span>
    </div>

    <div class="srv-tabla-wrap">
      <table class="srv-tabla">
        <thead>
          <tr>
            <th>Profesional</th>
            <th style="width:150px">Puesto</th>
            <th class="ta-c" style="width:100px">Órdenes</th>
            <th class="ta-c" style="width:100px">Líneas</th>
            <th class="ta-r" style="width:130px">Base</th>
            <th class="ta-r" style="width:130px">Comisión</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let p of porPersona()" class="srv-fila" (click)="verDetalle(p)">
            <td>{{ p.professional_name }}</td>
            <td class="srv-dim">{{ p.title || '—' }}</td>
            <td class="ta-c mono">{{ p.ordenes }}</td>
            <td class="ta-c mono">{{ p.lineas }}</td>
            <td class="ta-r mono srv-dim">{{ p.base | currency:'MXN':'symbol-narrow' }}</td>
            <td class="ta-r mono" style="font-weight:600">{{ p.comision | currency:'MXN':'symbol-narrow' }}</td>
          </tr>
          <tr *ngIf="porPersona().length">
            <td colspan="5" style="text-align:right;font-weight:600">Total</td>
            <td class="ta-r mono" style="font-weight:700">{{ total() | currency:'MXN':'symbol-narrow' }}</td>
          </tr>
        </tbody>
      </table>

      <div class="srv-vacio" *ngIf="!cargando() && porPersona().length === 0">
        <p><b>No hay comisiones en este periodo.</b></p>
        <p class="srv-sub">Una comisión se devenga al COBRAR la orden. El trabajo hecho y
           sin cobrar todavía no ha generado nada.</p>
      </div>
    </div>

    <section class="srv-tarjeta" *ngIf="detalleDe() as quien">
      <h2>Detalle de {{ quien }}</h2>
      <div class="srv-tabla-wrap" style="border:none">
        <table class="srv-tabla">
          <thead>
            <tr>
              <th style="width:130px">Cuándo</th>
              <th style="width:110px">Orden</th>
              <th>Concepto</th>
              <th>Cliente</th>
              <th class="ta-r" style="width:120px">Base</th>
              <th class="ta-c" style="width:70px">%</th>
              <th class="ta-r" style="width:120px">Comisión</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let d of detalle()">
              <td class="srv-dim">{{ d.earned_at | date:'d MMM HH:mm':undefined:'es-MX' }}</td>
              <td class="mono">{{ d.order_folio }}</td>
              <td>{{ d.concepto }}</td>
              <td class="srv-dim">{{ d.customer_name }}</td>
              <td class="ta-r mono srv-dim">{{ d.base_amount | currency:'MXN':'symbol-narrow' }}</td>
              <td class="ta-c mono">{{ d.pct }}</td>
              <td class="ta-r mono">{{ d.amount | currency:'MXN':'symbol-narrow' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <button class="btn srv-sm srv-ghost" (click)="detalleDe.set(null)" style="margin-top:10px">Cerrar</button>
    </section>
  </div>
  `,
})
export class ServiciosComisiones {
  private readonly srv = inject(ServiciosService);

  readonly porPersona = signal<any[]>([]);
  readonly detalleTodo = signal<any[]>([]);
  readonly detalle = signal<any[]>([]);
  readonly detalleDe = signal<string | null>(null);
  readonly cargando = signal(false);

  /** Por omisión, el mes en curso: es el periodo que se mira de verdad. */
  desde = this.primerDiaDelMes();
  hasta = this.hoy();

  constructor() { void this.cargar(); }

  private hoy(): string { return new Date().toISOString().slice(0, 10); }
  private primerDiaDelMes(): string {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  }

  total(): number {
    return this.porPersona().reduce((s, p) => s + Number(p.comision || 0), 0);
  }

  async cargar() {
    this.cargando.set(true);
    const r = await this.srv.comisiones({ desde: this.desde, hasta: this.hasta });
    this.cargando.set(false);
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se pudo cargar', text: r.error }); return; }
    this.porPersona.set(r.datos.porPersona);
    this.detalleTodo.set(r.datos.detalle);
    this.detalleDe.set(null);
  }

  verDetalle(p: any) {
    this.detalleDe.set(p.professional_name);
    this.detalle.set(this.detalleTodo().filter(d => d.professional_id === p.professional_id));
  }
}
