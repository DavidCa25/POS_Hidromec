import {
  ChangeDetectionStrategy, Component, EventEmitter, Input, OnInit, Output, computed, inject, signal,
} from '@angular/core';
import { CurrencyPipe, NgClass, NgFor, NgIf } from '@angular/common';
import { AreaSalon, MesaSalon, MesaService } from '../../core';
import { MesitaComponent } from '../mesita/mesita.component';
import { nombreDeMesa } from '../hx';

/**
 * HX-SELECTOR-MESAS — elegir la mesa sin salir de Venta.
 *
 * Lo abre «Aqui» cuando la cuenta aun no tiene mesa, y el boton Mesas de
 * Touch. Una mesa libre se abre; una ocupada trae su cuenta. Lo que ya se
 * estaba tomando pasa a la mesa (eso lo hace `MesaService.abrirMesa`).
 *
 * Es el mismo salon que la pantalla de Mesas, en pequeno: la pantalla completa
 * sigue siendo la vista general, y esta es para el uso de todos los dias.
 */
@Component({
  selector: 'hx-selector-mesas',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, CurrencyPipe, MesitaComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../hx.css'],
  template: `
  <div class="sm" role="dialog" aria-modal="true" aria-labelledby="sm-titulo" data-guide="mesas-selector">
    <header class="sm-cab">
      <div>
        <h2 id="sm-titulo">¿En qué mesa?</h2>
        <p>{{ conPedido ? 'Lo que ya tomaste pasa a la mesa.' : 'Una libre se abre; una ocupada trae su cuenta.' }}</p>
      </div>
      <button type="button" class="sm-x wx-pulsar" (click)="cerrar.emit()" aria-label="Cerrar sin elegir mesa">
        <i class="ph ph-x" aria-hidden="true"></i>
      </button>
    </header>

    <div class="wx-seg wx-seg--lg sm-areas" role="group" aria-label="Áreas" *ngIf="areas().length > 1">
      <button type="button" class="wx-seg__op" [class.on]="area() === null" [attr.aria-pressed]="area() === null"
              (click)="area.set(null)">Todas</button>
      <button type="button" class="wx-seg__op" *ngFor="let a of areas(); trackBy: porId"
              [class.on]="area() === a.id" [attr.aria-pressed]="area() === a.id" (click)="area.set(a.id)">{{ a.nombre }}</button>
    </div>

    <p class="sm-aviso" *ngIf="error()" role="alert"><i class="ph ph-warning-circle" aria-hidden="true"></i> {{ error() }}</p>
    <p class="sm-aviso" *ngIf="!cargando() && !error() && !mesas().length">Todavía no hay mesas. Créalas en Salón y estaciones.</p>

    <div class="sm-rejilla">
      <button type="button" class="sm-mesa" *ngFor="let m of visibles(); trackBy: porId"
              data-guide="mesa" [attr.data-guide-clave]="m.id" [attr.data-guide-estado]="m.estado"
              [ngClass]="'es-' + m.estado.toLowerCase()" [disabled]="ocupado != null"
              [attr.aria-label]="nombreDeMesa(m.nombre) + ', ' + etiqueta(m)"
              (click)="elegir.emit(m)">
        <hx-mesita [sillas]="m.capacidad" [estado]="m.estado.toLowerCase()" tam="sm"></hx-mesita>
        <span class="sm-mesa__nom">{{ nombreDeMesa(m.nombre) }}</span>
        <span class="sm-mesa__est">
          <i class="ph ph-circle-notch wx-latir" *ngIf="ocupado === m.id" aria-hidden="true"></i>
          {{ m.estado === 'LIBRE' ? 'Libre' : (m.total | currency:'MXN':'symbol-narrow':'1.0-0') }}
        </span>
      </button>
    </div>

    <footer class="sm-pie">
      <button type="button" class="btn-ghost" (click)="verSalon.emit()">
        <i class="ph ph-squares-four" aria-hidden="true"></i> Ver el salón completo
      </button>
      <button type="button" class="btn-outline" (click)="cerrar.emit()">Sin mesa</button>
    </footer>
  </div>
  `,
  styles: [`
    :host { display: block; width: min(760px, calc(100vw - 32px)); }
    .sm {
      display: flex; flex-direction: column; gap: 14px;
      max-height: min(86dvh, 760px);
      padding: 18px 18px 14px;
      background: var(--wx-surface); color: var(--wx-text);
      border: 1px solid var(--wx-edge); border-radius: var(--wx-radius-lg);
      box-shadow: var(--wx-shadow-dialog);
    }
    .sm-cab { display: flex; align-items: flex-start; gap: 12px; }
    .sm-cab > div { margin-right: auto; }
    .sm-cab h2 { margin: 0; font-size: 20px; font-weight: 720; letter-spacing: -0.015em; }
    .sm-cab p { margin: 3px 0 0; color: var(--wx-text-muted); font-size: var(--wx-text-sm); }
    .sm-x {
      width: 44px; height: 44px; display: grid; place-items: center; flex: 0 0 auto;
      border: 1px solid var(--wx-edge); border-radius: var(--wx-radius-md);
      background: var(--wx-raised); color: var(--wx-text); font-size: 18px; cursor: pointer;
    }
    .sm-areas { align-self: flex-start; }
    .sm-aviso { display: flex; gap: 8px; align-items: center; margin: 0; color: var(--wx-text-muted); font-size: var(--wx-text-sm); }
    .sm-rejilla {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 10px;
      overflow-y: auto; padding: 2px; min-height: 0;
    }
    .sm-mesa {
      --estado: var(--wx-edge-strong);
      display: flex; flex-direction: column; align-items: center; gap: 5px;
      min-height: 118px; padding: 12px 8px 10px;
      border: 1px solid var(--wx-edge); border-radius: var(--wx-radius-md);
      background: var(--wx-surface); color: var(--wx-text);
      font: inherit; cursor: pointer; touch-action: manipulation;
      transition: transform var(--wx-dur-press) var(--wx-ease-out), border-color var(--wx-dur-micro) var(--wx-ease-out);
    }
    .sm-mesa:active { transform: scale(0.97); }
    .sm-mesa:focus-visible { outline: none; box-shadow: var(--wx-focus-ring); }
    .sm-mesa:disabled { cursor: progress; }
    .sm-mesa hx-mesita { margin-bottom: 2px; }
    .sm-mesa__nom { font-size: 15px; font-weight: 700; letter-spacing: -0.01em; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sm-mesa__est { display: inline-flex; align-items: center; gap: 5px; color: var(--wx-text-dim); font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .sm-mesa.es-abierta { border-color: var(--wx-accent-line); background: linear-gradient(180deg, var(--wx-accent-soft), transparent 70%), var(--wx-surface); }
    .sm-mesa.es-abierta .sm-mesa__est { color: var(--wx-accent-text); }
    .sm-mesa.es-por_cobrar { border-color: color-mix(in srgb, var(--wx-warning) 45%, transparent); background: linear-gradient(180deg, var(--wx-warning-soft), transparent 70%), var(--wx-surface); }
    .sm-mesa.es-por_cobrar .sm-mesa__est { color: var(--wx-warning-ink); }
    .sm-pie { display: flex; justify-content: space-between; gap: 10px; padding-top: 12px; border-top: 1px solid var(--wx-edge-soft); }
    @media (prefers-reduced-motion: reduce) { .sm-mesa:active { transform: none; } }
  `],
})
export class SelectorMesasComponent implements OnInit {
  private readonly mesasSvc = inject(MesaService);

  /** Si la cuenta ya tiene productos: cambia lo que se explica arriba. */
  @Input() conPedido = false;
  /** La mesa que se esta abriendo, mientras tanto. */
  @Input() ocupado: number | null = null;
  @Output() elegir = new EventEmitter<MesaSalon>();
  @Output() cerrar = new EventEmitter<void>();
  @Output() verSalon = new EventEmitter<void>();

  readonly areas = signal<AreaSalon[]>([]);
  readonly mesas = signal<MesaSalon[]>([]);
  readonly area = signal<number | null>(null);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly visibles = computed(() => {
    const a = this.area();
    return a == null ? this.mesas() : this.mesas().filter(m => m.area_id === a);
  });

  readonly nombreDeMesa = nombreDeMesa;

  async ngOnInit(): Promise<void> {
    const r = await this.mesasSvc.salon();
    this.cargando.set(false);
    if (!r.ok) { this.error.set(r.error); return; }
    this.areas.set(r.datos.areas);
    this.mesas.set(r.datos.mesas);
  }

  etiqueta(m: MesaSalon): string {
    return m.estado === 'LIBRE' ? 'libre' : m.estado === 'POR_COBRAR' ? 'por cobrar' : 'abierta';
  }

  porId = (_: number, x: { id: number }) => x.id;
}
