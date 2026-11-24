import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService, PAQUETES } from '../../services/auth.service';
import { Lote, SaludService } from '../salud.service';

/**
 * CADUCIDADES: los lotes con existencia, el que vence primero arriba.
 *
 * Lo caducado no se vende: la caja ya no lo descuenta de ese lote (FEFO
 * salta los caducados). Aquí se retira con un ajuste que deja motivo, para
 * que el libro de control cuadre.
 */
@Component({
  selector: 'app-salud-caducidades',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrls: ['../../modulo-servicios/servicios.css', '../salud.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="srv-pagina">
    <header class="srv-cab">
      <div>
        <h1>Caducidades</h1>
        <p class="srv-sub">Lotes con existencia. El que caduca primero es el que la caja vende primero.</p>
      </div>
    </header>

    <div class="srv-tabs" role="tablist">
      <button type="button" class="srv-tab" *ngFor="let o of plazos" [class.activo]="dias() === o.dias"
              (click)="cambiar(o.dias)" [attr.data-guide]="'salud-plazo-' + (o.dias ?? 'todos')">{{ o.texto }}</button>
    </div>

    <p class="srv-error" *ngIf="error()">{{ error() }}</p>

    <div class="srv-tabla-wrap">
      <table class="srv-tabla" data-guide="salud-lotes">
        <thead><tr><th>Producto</th><th>Lote</th><th>Caducidad</th><th class="ta-r">Quedan</th><th>Estado</th><th *ngIf="responsable"></th></tr></thead>
        <tbody>
          <tr *ngFor="let l of lotes(); trackBy: track" [attr.data-guide-clave]="l.lote">
            <td><b>{{ l.nombre }}</b><div class="srv-hint">{{ l.part_number }}</div></td>
            <td class="mono">{{ l.lote }}</td>
            <td>{{ l.caducidad | date:'dd/MM/yyyy' }}</td>
            <td class="ta-r mono">{{ l.cantidad | number:'1.0-3' }}</td>
            <td>
              <span class="srv-badge srv-badge--danger" *ngIf="l.caducado">Caducado</span>
              <span class="srv-badge srv-badge--warn" *ngIf="!l.caducado && l.dias_restantes <= 90">Vence en {{ l.dias_restantes }} días</span>
              <span class="srv-badge srv-badge--ok" *ngIf="!l.caducado && l.dias_restantes > 90">Vigente</span>
            </td>
            <td *ngIf="responsable" class="ta-r">
              <button type="button" class="btn srv-sm" (click)="abrir(l)" data-guide="salud-lote-ajustar">Ajustar</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="srv-vacio" *ngIf="!cargando() && !lotes().length">
        <i class="ph ph-check-circle" style="font-size:2rem"></i>
        <p>No hay lotes en este plazo.</p>
      </div>
    </div>
  </div>

  <div class="modal fade show d-block srv-modal" *ngIf="ajuste() as a" role="dialog" aria-modal="true" aria-labelledby="aj-t">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content rounded-4">
        <div class="modal-header border-0 pb-1">
          <h5 class="modal-title fw-bold m-0" id="aj-t">Ajustar lote {{ a.lote.lote }}</h5>
          <button type="button" class="btn-close" (click)="ajuste.set(null)" aria-label="Cerrar"></button>
        </div>
        <div class="modal-body px-4 pt-1 pb-4">
          <p class="srv-paso">{{ a.lote.nombre }} · hoy quedan {{ a.lote.cantidad | number:'1.0-3' }}.
            Bajar a 0 retira el lote; queda como merma en el libro con el motivo.</p>
          <div class="srv-campos">
            <div>
              <label class="form-label" for="aj-q">Quedan en realidad</label>
              <input id="aj-q" class="form-control" type="number" min="0" [(ngModel)]="a.cantidad" data-guide="salud-ajuste-cantidad">
            </div>
            <div>
              <label class="form-label" for="aj-m">Motivo</label>
              <input id="aj-m" class="form-control" [(ngModel)]="a.nota" placeholder="Caducado, retirado del anaquel" data-guide="salud-ajuste-motivo">
            </div>
          </div>
          <p class="srv-error" *ngIf="errorDialogo()">{{ errorDialogo() }}</p>
          <div class="d-flex justify-content-end gap-2 mt-4">
            <button type="button" class="btn" (click)="ajuste.set(null)">Cancelar</button>
            <button type="button" class="btn btn-primary" (click)="guardar()" [disabled]="guardando()" data-guide="salud-ajuste-guardar">
              {{ guardando() ? 'Guardando…' : 'Guardar ajuste' }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
  `,
})
export class SaludCaducidades implements OnInit {
  private readonly salud = inject(SaludService);
  private readonly auth = inject(AuthService);

  readonly plazos = [
    { dias: 30, texto: '30 días' }, { dias: 90, texto: '90 días' },
    { dias: 180, texto: '6 meses' }, { dias: null as number | null, texto: 'Todos' },
  ];
  readonly dias = signal<number | null>(90);
  readonly lotes = signal<Lote[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly ajuste = signal<{ lote: Lote; cantidad: number; nota: string } | null>(null);
  readonly guardando = signal(false);
  readonly errorDialogo = signal<string | null>(null);

  get responsable(): boolean { return this.auth.puede(PAQUETES.SALUD_FARMACIA); }

  ngOnInit(): void { void this.cargar(); }

  cambiar(d: number | null): void { this.dias.set(d); void this.cargar(); }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    const r = await this.salud.lotes({ dias: this.dias() });
    this.cargando.set(false);
    if (!r.ok) { this.error.set(r.error || 'No se pudieron cargar los lotes.'); return; }
    this.error.set(null);
    this.lotes.set(r.datos);
  }

  abrir(l: Lote): void {
    this.errorDialogo.set(null);
    this.ajuste.set({ lote: l, cantidad: l.caducado ? 0 : l.cantidad, nota: l.caducado ? 'Caducado, retirado del anaquel' : '' });
  }

  async guardar(): Promise<void> {
    const a = this.ajuste();
    if (!a || this.guardando()) return;
    if (!a.nota.trim()) { this.errorDialogo.set('Escribe el motivo del ajuste.'); return; }
    this.guardando.set(true);
    const r = await this.salud.ajustarLote({ loteId: a.lote.lote_id, cantidad: Number(a.cantidad), nota: a.nota });
    this.guardando.set(false);
    if (!r.ok) { this.errorDialogo.set(r.error || 'No se pudo ajustar.'); return; }
    this.ajuste.set(null);
    await this.cargar();
  }

  track = (_: number, l: Lote) => l.lote_id;
}
