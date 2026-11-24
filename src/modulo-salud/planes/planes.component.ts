import { ChangeDetectionStrategy, Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';
import { WxSelectComponent, WxOpcion } from '../../app/wx-select/wx-select.component';
import { Plan, PlanItem, SaludService } from '../salud.service';

interface Fila { fase: number; diente: number | null; productId: number | null; procedimiento: string; precio: number | null; }

/**
 * PLANES DE TRATAMIENTO.
 *
 * Se arma con los servicios del catálogo (lo que de verdad se cobra) o con
 * texto libre y precio. ACEPTARLO lo vuelve una orden de servicio: se cobra
 * en la caja con el flujo de siempre —abonos, crédito, factura— y el plan
 * guarda su avance procedimiento por procedimiento.
 *
 * Aceptado ya no se reescribe: lo que el paciente aceptó es lo que se cobra.
 */
@Component({
  selector: 'app-salud-planes',
  standalone: true,
  imports: [CommonModule, FormsModule, WxSelectComponent],
  styleUrls: ['../../modulo-servicios/servicios.css', '../salud.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <section class="d-flex flex-column gap-3">
    <div class="d-flex align-items-center">
      <h2 class="m-0" style="font-size: var(--wx-text-md)">Planes de tratamiento</h2>
      <button type="button" class="btn btn-primary ms-auto" (click)="nuevo()" *ngIf="!editando()" data-guide="plan-nuevo">
        <i class="ph ph-plus"></i> Nuevo plan</button>
    </div>
    <p class="srv-error" *ngIf="error()">{{ error() }}</p>

    <!-- ------------------------------------------------------ editor -->
    <div class="srv-tarjeta d-flex flex-column gap-2" *ngIf="editando()" data-guide="plan-editor">
      <label class="form-label" for="pl-t">Nombre del plan</label>
      <input id="pl-t" class="form-control" [(ngModel)]="titulo" placeholder="Rehabilitación superior" data-guide="plan-titulo">
      <div class="srv-tabla-wrap mt-2">
        <table class="srv-tabla">
          <thead><tr><th style="width:70px">Fase</th><th style="width:90px">Diente</th><th>Procedimiento</th><th style="width:130px" class="ta-r">Precio</th><th></th></tr></thead>
          <tbody>
            <tr *ngFor="let f of filas; let i = index">
              <td><input class="form-control ctl srv-sm" type="number" min="1" max="9" [(ngModel)]="f.fase"></td>
              <td><input class="form-control ctl srv-sm" type="number" min="11" max="85" [(ngModel)]="f.diente" [attr.data-guide]="'plan-diente-' + i"></td>
              <td>
                <wx-select [opciones]="opcServicios()" [buscable]="true" placeholder="Servicio del catálogo o escribe abajo"
                           [ngModel]="f.productId" (ngModelChange)="elegirServicio(f, $event)" [attr.data-guide]="'plan-servicio-' + i"></wx-select>
                <input class="form-control ctl srv-sm mt-1" [(ngModel)]="f.procedimiento" placeholder="Procedimiento"
                       [attr.data-guide]="'plan-proc-' + i">
              </td>
              <td><input class="form-control ctl srv-sm ta-r" type="number" min="0" step="0.01" [(ngModel)]="f.precio" [attr.data-guide]="'plan-precio-' + i"></td>
              <td><button type="button" class="btn srv-ghost srv-sm" (click)="quitar(i)" aria-label="Quitar"><i class="ph ph-x"></i></button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="d-flex align-items-center gap-2 flex-wrap">
        <button type="button" class="btn srv-sm" (click)="agregar()" data-guide="plan-agregar"><i class="ph ph-plus"></i> Procedimiento</button>
        <span class="srv-importe ms-auto m-0"><span>Total</span>&nbsp;<b>{{ totalEditor() | currency:'MXN':'symbol-narrow' }}</b></span>
      </div>
      <div class="d-flex justify-content-end gap-2">
        <button type="button" class="btn" (click)="editando.set(false)">Cancelar</button>
        <button type="button" class="btn btn-primary" (click)="guardar()" [disabled]="guardando()" data-guide="plan-guardar">
          {{ guardando() ? 'Guardando…' : 'Guardar plan' }}</button>
      </div>
    </div>

    <!-- ------------------------------------------------------- lista -->
    <div class="srv-tarjeta" *ngFor="let p of planes(); trackBy: track" [attr.data-guide-clave]="p.titulo" [attr.data-guide-estado]="p.estado">
      <div class="d-flex align-items-center gap-2 flex-wrap">
        <h2 class="m-0">{{ p.titulo }}</h2>
        <span class="srv-badge" [ngClass]="badge(p.estado)">{{ etiqueta(p.estado) }}</span>
        <span class="srv-hint">{{ p.hechos }}/{{ p.procedimientos }} hechos · {{ p.total | currency:'MXN':'symbol-narrow' }}</span>
        <div class="ms-auto d-flex gap-2">
          <ng-container *ngIf="p.estado === 'PROPUESTO'">
            <button type="button" class="btn srv-sm" (click)="editar(p)">Editar</button>
            <button type="button" class="btn srv-danger srv-sm" (click)="cancelar(p)">Cancelar</button>
            <button type="button" class="btn btn-primary srv-sm" (click)="aceptar(p)" data-guide="plan-aceptar">Aceptar plan</button>
          </ng-container>
          <button type="button" class="btn btn-primary srv-sm" *ngIf="p.orden_id && p.estado !== 'CANCELADO'" (click)="cobrar(p)"
                  data-guide="plan-cobrar"><i class="ph ph-cash-register"></i> Cobrar</button>
        </div>
      </div>
      <table class="srv-tabla mt-2">
        <tbody>
          <tr *ngFor="let it of p.items">
            <td style="width:70px" class="srv-dim">Fase {{ it.fase }}</td>
            <td style="width:90px">{{ it.diente ? 'Diente ' + it.diente : '' }}</td>
            <td>{{ it.procedimiento }}</td>
            <td class="ta-r mono">{{ it.precio | currency:'MXN':'symbol-narrow' }}</td>
            <td style="width:110px" class="ta-r">
              <label class="d-inline-flex align-items-center gap-1" *ngIf="p.estado === 'ACEPTADO' || p.estado === 'TERMINADO'">
                <input type="checkbox" [checked]="it.estado === 'HECHO'" (change)="hecho(it, $any($event.target).checked)"
                       [attr.data-guide]="'plan-hecho-' + it.id"> Hecho
              </label>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="srv-vacio" *ngIf="!planes().length && !editando()"><p>Sin planes de tratamiento.</p></div>
  </section>
  `,
})
export class PlanesComponent implements OnInit {
  private readonly salud = inject(SaludService);
  private readonly router = inject(Router);
  @Input({ required: true }) customerId!: number;

  readonly planes = signal<Plan[]>([]);
  readonly servicios = signal<{ product_id: number; nombre: string; price: number }[]>([]);
  readonly opcServicios = computed<WxOpcion[]>(() => this.servicios().map((s) => ({
    valor: s.product_id, etiqueta: s.nombre, nota: `$${Number(s.price).toFixed(2)}`,
  })));
  readonly editando = signal(false);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  private editandoId: number | null = null;
  titulo = '';
  filas: Fila[] = [];

  async ngOnInit(): Promise<void> {
    const [p, s] = await Promise.all([this.salud.planes(this.customerId), this.salud.serviciosCatalogo()]);
    if (p.ok) this.planes.set(p.datos);
    if (s.ok) this.servicios.set(s.datos);
  }

  async cargar(): Promise<void> {
    const r = await this.salud.planes(this.customerId);
    if (r.ok) this.planes.set(r.datos);
    else this.error.set(r.error || 'No se pudieron cargar los planes.');
  }

  totalEditor(): number { return this.filas.reduce((s, f) => s + (Number(f.precio) || 0), 0); }

  nuevo(): void {
    this.editandoId = null;
    this.titulo = '';
    this.filas = [{ fase: 1, diente: null, productId: null, procedimiento: '', precio: null }];
    this.error.set(null);
    this.editando.set(true);
  }

  editar(p: Plan): void {
    this.editandoId = p.id;
    this.titulo = p.titulo;
    this.filas = p.items.map((i) => ({ fase: i.fase, diente: i.diente, productId: i.product_id ?? null, procedimiento: i.procedimiento, precio: i.precio }));
    this.editando.set(true);
  }

  agregar(): void {
    const ult = this.filas[this.filas.length - 1];
    this.filas = [...this.filas, { fase: ult?.fase ?? 1, diente: null, productId: null, procedimiento: '', precio: null }];
  }
  quitar(i: number): void { this.filas = this.filas.filter((_, j) => j !== i); }

  elegirServicio(f: Fila, id: number | null): void {
    f.productId = id;
    const s = this.servicios().find((x) => x.product_id === id);
    if (s) { f.procedimiento = s.nombre; if (f.precio == null) f.precio = Number(s.price); }
  }

  async guardar(): Promise<void> {
    if (this.guardando()) return;
    const items: PlanItem[] = this.filas
      .filter((f) => f.procedimiento.trim())
      .map((f) => ({ fase: Number(f.fase) || 1, diente: f.diente ? Number(f.diente) : null, procedimiento: f.procedimiento.trim(),
                     productId: f.productId, precio: Number(f.precio) || 0 }));
    if (!this.titulo.trim() || !items.length) { this.error.set('Pon nombre al plan y al menos un procedimiento.'); return; }
    this.guardando.set(true);
    const r = await this.salud.guardarPlan({ id: this.editandoId, customerId: this.customerId, titulo: this.titulo, items });
    this.guardando.set(false);
    if (!r.ok) { this.error.set(r.error || 'No se pudo guardar el plan.'); return; }
    this.error.set(null);
    this.editando.set(false);
    await this.cargar();
  }

  async aceptar(p: Plan): Promise<void> {
    const ok = await Swal.fire({
      icon: 'question', title: `¿El paciente acepta «${p.titulo}»?`,
      text: `Se abre una orden de servicio por ${p.total.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })} para cobrarla en la caja, en una o varias visitas. Ya no se podrá cambiar el plan.`,
      showCancelButton: true, confirmButtonText: 'Aceptar plan', cancelButtonText: 'Todavía no',
    });
    if (!ok.isConfirmed) return;
    const r = await this.salud.aceptarPlan(p.id);
    if (!r.ok) { this.error.set(r.error || 'No se pudo aceptar el plan.'); return; }
    await this.cargar();
  }

  async cancelar(p: Plan): Promise<void> {
    const ok = await Swal.fire({ icon: 'warning', title: `¿Cancelar «${p.titulo}»?`, text: 'Se queda en el historial del paciente.',
      showCancelButton: true, confirmButtonText: 'Cancelar plan', cancelButtonText: 'No', confirmButtonColor: '#dc2626' });
    if (!ok.isConfirmed) return;
    const r = await this.salud.estadoPlan(p.id, 'CANCELADO');
    if (!r.ok) { this.error.set(r.error || 'No se pudo cancelar.'); return; }
    await this.cargar();
  }

  async hecho(it: PlanItem, valor: boolean): Promise<void> {
    if (!it.id) return;
    const r = await this.salud.itemHecho(it.id, valor);
    if (!r.ok) this.error.set(r.error || 'No se pudo marcar.');
    await this.cargar();
  }

  /** A la caja, con la orden ya cargada: el mismo camino que cobra una orden de servicio. */
  cobrar(p: Plan): void {
    void this.router.navigate(['/dashboard/venta'], { queryParams: { ordenServicio: p.orden_id } });
  }

  etiqueta(e: Plan['estado']): string {
    return { PROPUESTO: 'Propuesto', ACEPTADO: 'En tratamiento', TERMINADO: 'Terminado', CANCELADO: 'Cancelado' }[e];
  }
  badge(e: Plan['estado']): string {
    return { PROPUESTO: 'srv-badge--info', ACEPTADO: 'srv-badge--warn', TERMINADO: 'srv-badge--ok', CANCELADO: 'srv-badge--mute' }[e];
  }
  track = (_: number, p: Plan) => p.id;
}
