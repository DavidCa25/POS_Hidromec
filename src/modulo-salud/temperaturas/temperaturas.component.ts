import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WxSelectComponent, WxOpcion } from '../../app/wx-select/wx-select.component';
import { SaludService, Temperatura } from '../salud.service';

/** Los rangos que se vigilan: el local a no más de 30 °C y el refrigerador de 2 a 8 °C. */
const RANGOS: Record<string, [number, number]> = { LOCAL: [-40, 30], REFRIGERADOR: [2, 8] };

/**
 * TEMPERATURAS: la bitácora que piden las guías de verificación de farmacias
 * (dos lecturas al día, con quién la tomó). Anotar es del turno: lo puede
 * hacer quien vende.
 */
@Component({
  selector: 'app-salud-temperaturas',
  standalone: true,
  imports: [CommonModule, FormsModule, WxSelectComponent],
  styleUrls: ['../../modulo-servicios/servicios.css', '../salud.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="srv-pagina">
    <header class="srv-cab">
      <div>
        <h1>Temperaturas</h1>
        <p class="srv-sub">Local a no más de 30 °C. Refrigerador de 2 a 8 °C. Anota dos lecturas al día.</p>
      </div>
    </header>

    <section class="srv-tarjeta">
      <h2>Nueva lectura</h2>
      <div class="srv-barra">
        <wx-select [opciones]="equipos" [(ngModel)]="equipo" data-guide="salud-temp-equipo" style="min-width: 200px"></wx-select>
        <input class="form-control ctl" type="number" step="0.1" [(ngModel)]="grados" placeholder="°C"
               style="max-width: 120px" data-guide="salud-temp-grados" (keydown.enter)="guardar()">
        <button type="button" class="btn btn-primary" (click)="guardar()" [disabled]="guardando() || grados == null"
                data-guide="salud-temp-guardar">Anotar</button>
        <span class="srv-alerta" *ngIf="fueraDeRango(equipo, grados)">Fuera de rango</span>
      </div>
      <p class="srv-error" *ngIf="error()">{{ error() }}</p>
    </section>

    <div class="srv-tabla-wrap">
      <table class="srv-tabla" data-guide="salud-temperaturas">
        <thead><tr><th>Fecha</th><th>Equipo</th><th class="ta-r">°C</th><th>Quién</th></tr></thead>
        <tbody>
          <tr *ngFor="let t of lecturas(); trackBy: track">
            <td class="mono">{{ t.at | date:'dd/MM/yy HH:mm' }}</td>
            <td>{{ t.equipo === 'LOCAL' ? 'Local' : 'Refrigerador' }}</td>
            <td class="ta-r mono"><span [class.srv-alerta]="fueraDeRango(t.equipo, t.grados)">{{ t.grados | number:'1.1-1' }}</span></td>
            <td>{{ t.usuario || '—' }}</td>
          </tr>
        </tbody>
      </table>
      <div class="srv-vacio" *ngIf="!lecturas().length"><p>Sin lecturas en los últimos 30 días.</p></div>
    </div>
    <p class="srv-hint">{{ fuera() }} lectura(s) fuera de rango en 30 días.</p>
  </div>
  `,
})
export class SaludTemperaturas implements OnInit {
  private readonly salud = inject(SaludService);

  readonly equipos: WxOpcion[] = [
    { valor: 'LOCAL', etiqueta: 'Local' },
    { valor: 'REFRIGERADOR', etiqueta: 'Refrigerador' },
  ];
  equipo = 'LOCAL';
  grados: number | null = null;
  readonly lecturas = signal<Temperatura[]>([]);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  readonly fuera = computed(() => this.lecturas().filter((t) => this.fueraDeRango(t.equipo, t.grados)).length);

  ngOnInit(): void { void this.cargar(); }

  fueraDeRango(equipo: string, g: number | null): boolean {
    if (g == null || Number.isNaN(Number(g))) return false;
    const [min, max] = RANGOS[equipo] ?? [-40, 60];
    return Number(g) < min || Number(g) > max;
  }

  async cargar(): Promise<void> {
    const r = await this.salud.temperaturas(30);
    if (r.ok) this.lecturas.set(r.datos);
  }

  async guardar(): Promise<void> {
    if (this.grados == null || this.guardando()) return;
    this.guardando.set(true);
    const r = await this.salud.guardarTemperatura({ equipo: this.equipo, grados: Number(this.grados) });
    this.guardando.set(false);
    if (!r.ok) { this.error.set(r.error || 'No se pudo guardar.'); return; }
    this.error.set(null);
    this.grados = null;
    await this.cargar();
  }

  track = (_: number, t: Temperatura) => t.id;
}
