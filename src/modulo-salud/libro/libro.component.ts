import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WxDateComponent } from '../../app/wx-date/wx-date.component';
import { MovimientoLibro, ROMANOS, SaludService, hoyIso } from '../salud.service';

/**
 * LIBRO DE CONTROL: el auxiliar para llenar el libro autorizado.
 *
 * Entradas y salidas de controlados (fracciones I a III) o de antibióticos,
 * con lote, receta y saldo corrido. NO sustituye al libro foliado mientras
 * COFEPRIS no acepte el electrónico (docs/giro-salud.md §3.1): por eso se
 * imprime y se exporta, que es como se usa para pasarlo al libro.
 */
@Component({
  selector: 'app-salud-libro',
  standalone: true,
  imports: [CommonModule, FormsModule, WxDateComponent],
  styleUrls: ['../../modulo-servicios/servicios.css', '../salud.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="srv-pagina sl-imprimible">
    <header class="srv-cab">
      <div>
        <h1>Libro de control · {{ tipo() === 'CONTROLADOS' ? 'Controlados' : 'Antibióticos' }}</h1>
        <p class="srv-sub">Del {{ desde | date:'dd/MM/yyyy' }} al {{ hasta | date:'dd/MM/yyyy' }}. Auxiliar para el libro autorizado.</p>
      </div>
      <div class="d-flex gap-2 sl-no-imprimir">
        <button type="button" class="btn" (click)="exportar()" [disabled]="!movs().length" data-guide="salud-libro-exportar">
          <i class="ph ph-file-csv"></i> Exportar</button>
        <button type="button" class="btn btn-primary" (click)="imprimir()" [disabled]="!movs().length"><i class="ph ph-printer"></i> Imprimir</button>
      </div>
    </header>

    <div class="srv-barra sl-no-imprimir">
      <div class="srv-tabs" role="tablist">
        <button type="button" class="srv-tab" [class.activo]="tipo() === 'CONTROLADOS'" (click)="cambiar('CONTROLADOS')"
                data-guide="salud-libro-controlados">Controlados (I–III)</button>
        <button type="button" class="srv-tab" [class.activo]="tipo() === 'ANTIBIOTICOS'" (click)="cambiar('ANTIBIOTICOS')"
                data-guide="salud-libro-antibioticos">Antibióticos</button>
      </div>
      <wx-date [(ngModel)]="desde" [max]="hasta" [limpiable]="false" (ngModelChange)="cargar()"></wx-date>
      <wx-date [(ngModel)]="hasta" [min]="desde" [limpiable]="false" (ngModelChange)="cargar()"></wx-date>
    </div>

    <p class="srv-error" *ngIf="error()">{{ error() }}</p>

    <div class="srv-tabla-wrap">
      <table class="srv-tabla" data-guide="salud-libro">
        <thead><tr>
          <th>Fecha</th><th>Producto</th><th>Lote</th><th class="ta-r">Entrada</th><th class="ta-r">Salida</th>
          <th class="ta-r">Saldo</th><th>Receta</th><th>Quién</th>
        </tr></thead>
        <tbody>
          <tr *ngFor="let m of movs(); trackBy: track" [attr.data-guide-estado]="m.tipo">
            <td class="mono">{{ m.at | date:'dd/MM/yy HH:mm' }}</td>
            <td><b>{{ m.nombre }}</b><div class="srv-hint">{{ m.sustancia_activa }}{{ m.fraccion ? ' · Fr. ' + romanos[m.fraccion] : '' }}</div></td>
            <td class="mono">{{ m.lote || 'Sin lote' }}<div class="srv-hint" *ngIf="m.caducidad">Cad. {{ m.caducidad | date:'MM/yyyy' }}</div></td>
            <td class="ta-r mono">{{ m.entrada ? (m.entrada | number:'1.0-3') : '' }}</td>
            <td class="ta-r mono">{{ m.salida ? (m.salida | number:'1.0-3') : '' }}</td>
            <td class="ta-r mono"><b>{{ m.saldo | number:'1.0-3' }}</b></td>
            <td>
              <ng-container *ngIf="m.medico; else sinRx">
                {{ m.medico }} · Céd. {{ m.cedula }}
                <div class="srv-hint">{{ m.fecha_receta | date:'dd/MM/yyyy' }} · {{ m.retenida ? 'Retenida' : 'Sellada' }} · Venta {{ m.sale_id }}</div>
              </ng-container>
              <ng-template #sinRx><span class="srv-dim">{{ m.nota || (m.tipo === 'ENTRADA' ? 'Entrada' : '—') }}</span></ng-template>
            </td>
            <td>{{ m.usuario || '—' }}</td>
          </tr>
        </tbody>
      </table>
      <div class="srv-vacio" *ngIf="!cargando() && !movs().length">
        <i class="ph ph-book-open-text" style="font-size:2rem"></i>
        <p>Sin movimientos en este periodo.</p>
      </div>
    </div>
  </div>
  `,
})
export class SaludLibro implements OnInit {
  private readonly salud = inject(SaludService);

  readonly romanos = ROMANOS;
  readonly tipo = signal<'CONTROLADOS' | 'ANTIBIOTICOS'>('CONTROLADOS');
  readonly movs = signal<MovimientoLibro[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  hasta = hoyIso();
  desde = this.hasta.slice(0, 8) + '01';

  ngOnInit(): void { void this.cargar(); }

  cambiar(t: 'CONTROLADOS' | 'ANTIBIOTICOS'): void { this.tipo.set(t); void this.cargar(); }

  async cargar(): Promise<void> {
    if (!this.desde || !this.hasta) return;
    this.cargando.set(true);
    const r = await this.salud.libro({ desde: this.desde, hasta: this.hasta, tipo: this.tipo() });
    this.cargando.set(false);
    if (!r.ok) { this.error.set(r.error || 'No se pudo cargar el libro.'); return; }
    this.error.set(null);
    this.movs.set(r.datos);
  }

  imprimir(): void { window.print(); }

  /** CSV con BOM: Excel en español lo abre con acentos sin preguntar. */
  exportar(): void {
    const col = ['Fecha', 'Producto', 'Sustancia', 'Fracción', 'Lote', 'Caducidad', 'Entrada', 'Salida', 'Saldo',
      'Médico', 'Cédula', 'Fecha receta', 'Receta', 'Venta', 'Nota', 'Usuario'];
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const filas = this.movs().map((m) => [
      m.at, m.nombre, m.sustancia_activa, m.fraccion ? ROMANOS[m.fraccion] : '', m.lote ?? 'Sin lote', m.caducidad,
      m.entrada || '', m.salida || '', m.saldo, m.medico, m.cedula, m.fecha_receta,
      m.medico ? (m.retenida ? 'Retenida' : 'Sellada') : '', m.sale_id, m.nota, m.usuario,
    ].map(q).join(','));
    const blob = new Blob(['﻿' + [col.map(q).join(','), ...filas].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `libro-${this.tipo().toLowerCase()}-${this.desde}-a-${this.hasta}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  track = (_: number, m: MovimientoLibro) => m.movimiento_id;
}
