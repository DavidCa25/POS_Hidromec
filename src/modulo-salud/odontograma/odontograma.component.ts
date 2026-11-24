import { ChangeDetectionStrategy, Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MarcaDental, SaludService } from '../salud.service';

type Cara = 'O' | 'M' | 'D' | 'V' | 'L';

interface Estado { id: string; texto: string; color: string; todoElDiente: boolean; }

/** Lo que se puede marcar. Los de diente completo se guardan con cara «T». */
const ESTADOS: Estado[] = [
  { id: 'CARIES', texto: 'Caries', color: '#ef4444', todoElDiente: false },
  { id: 'OBTURADO', texto: 'Obturado', color: '#3b82f6', todoElDiente: false },
  { id: 'SELLADOR', texto: 'Sellador', color: '#22c55e', todoElDiente: false },
  { id: 'FRACTURA', texto: 'Fractura', color: '#f97316', todoElDiente: false },
  { id: 'ENDODONCIA', texto: 'Endodoncia', color: '#a855f7', todoElDiente: true },
  { id: 'CORONA', texto: 'Corona', color: '#f59e0b', todoElDiente: true },
  { id: 'IMPLANTE', texto: 'Implante', color: '#64748b', todoElDiente: true },
  { id: 'AUSENTE', texto: 'Ausente', color: '#cbd5e1', todoElDiente: true },
  { id: 'EXTRACCION', texto: 'Extracción indicada', color: '#cbd5e1', todoElDiente: true },
  { id: 'SANO', texto: 'Sano (borrar)', color: '#ffffff', todoElDiente: false },
];

/* Numeración FDI, en el orden en que se dibuja (derecha del paciente a la izquierda). */
const PERMANENTES = { arriba: [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28],
                      abajo: [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38] };
const TEMPORALES = { arriba: [55, 54, 53, 52, 51, 61, 62, 63, 64, 65],
                     abajo: [85, 84, 83, 82, 81, 71, 72, 73, 74, 75] };

const T = 40;      // lado del diente
const GAP = 8;     // separación
const M = 14;      // margen

/**
 * ODONTOGRAMA (NOM-013-SSA2-2015).
 *
 * Cada diente es un cuadro con sus cinco caras. Se elige un estado en la
 * paleta y se toca la cara (o el diente, si el estado es de diente
 * completo). Lo marcado queda PENDIENTE hasta «Guardar»: así una visita es
 * un solo registro en el historial, no cuarenta.
 *
 * El historial nunca se reescribe: el odontograma de hoy es la última marca
 * de cada diente y cara (sp_salud_odontograma_get).
 */
@Component({
  selector: 'app-salud-odontograma',
  standalone: true,
  imports: [CommonModule],
  styleUrls: ['../../modulo-servicios/servicios.css', '../salud.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <section class="srv-tarjeta d-flex flex-column gap-3">
    <div class="d-flex align-items-center gap-2 flex-wrap">
      <h2 class="m-0">Odontograma</h2>
      <div class="srv-tabs ms-auto">
        <button type="button" class="srv-tab" [class.activo]="!temporales()" (click)="temporales.set(false)">Permanentes</button>
        <button type="button" class="srv-tab" [class.activo]="temporales()" (click)="temporales.set(true)">Temporales</button>
      </div>
    </div>

    <div class="sl-paleta" role="radiogroup" aria-label="Estado a marcar">
      <button type="button" *ngFor="let e of estados" role="radio" [attr.aria-checked]="estado().id === e.id"
              [class.activo]="estado().id === e.id" (click)="estado.set(e)" [attr.data-guide]="'odonto-estado-' + e.id">
        <span class="sl-muestra" [style.background]="e.color"></span>{{ e.texto }}
      </button>
    </div>

    <svg class="sl-odonto" [attr.viewBox]="'0 0 ' + ancho() + ' ' + alto" role="img" aria-label="Odontograma" data-guide="odontograma">
      <g *ngFor="let d of dientes()" [attr.transform]="'translate(' + d.x + ',' + d.y + ')'" [attr.data-diente]="d.n">
        <text class="num" [attr.x]="t / 2" [attr.y]="d.arriba ? -4 : t + 12">{{ d.n }}</text>
        <polygon *ngFor="let c of caras" class="cara" [attr.points]="puntos(c, d.n, d.arriba)"
                 [ngClass]="claseDe(d.n, c)" (click)="tocar(d.n, c)"
                 [attr.data-guide]="'diente-' + d.n + '-' + c"></polygon>
        <ng-container [ngSwitch]="completo(d.n)">
          <g *ngSwitchCase="'X'"><line class="x" x1="2" y1="2" [attr.x2]="t - 2" [attr.y2]="t - 2"></line>
            <line class="x" [attr.x1]="t - 2" y1="2" x2="2" [attr.y2]="t - 2"></line></g>
          <circle *ngSwitchCase="'O'" class="aro" [attr.cx]="t / 2" [attr.cy]="t / 2" [attr.r]="t / 2 + 2"></circle>
          <line *ngSwitchCase="'E'" class="x" style="stroke:#a855f7" [attr.x1]="t / 2" [attr.y1]="d.arriba ? -2 : t + 2" [attr.x2]="t / 2" [attr.y2]="t / 2"></line>
          <rect *ngSwitchCase="'I'" class="aro" style="stroke:#64748b" x="-2" y="-2" [attr.width]="t + 4" [attr.height]="t + 4"></rect>
        </ng-container>
      </g>
    </svg>

    <div class="d-flex align-items-center gap-2 flex-wrap">
      <span class="srv-hint">{{ pendientes().length }} marca(s) sin guardar · cada visita se guarda como un registro.</span>
      <button type="button" class="btn ms-auto" (click)="descartar()" [disabled]="!pendientes().length">Descartar</button>
      <button type="button" class="btn btn-primary" (click)="guardar()" [disabled]="!pendientes().length || guardando()"
              data-guide="odonto-guardar">{{ guardando() ? 'Guardando…' : 'Guardar visita' }}</button>
    </div>
    <p class="srv-error" *ngIf="error()">{{ error() }}</p>

    <details *ngIf="historial().length">
      <summary class="srv-hint">Historial ({{ historial().length }})</summary>
      <ul class="mt-2" style="font-size: var(--wx-text-sm)">
        <li *ngFor="let h of historial()">{{ h.at | date:'dd/MM/yyyy' }} · Diente {{ h.diente }}{{ h.cara !== 'T' ? ' ' + h.cara : '' }} ·
          {{ textoDe(h.estado) }}{{ h.usuario ? ' · ' + h.usuario : '' }}</li>
      </ul>
    </details>
  </section>
  `,
})
export class OdontogramaComponent implements OnInit {
  private readonly salud = inject(SaludService);
  @Input({ required: true }) customerId!: number;

  readonly estados = ESTADOS;
  readonly caras: Cara[] = ['V', 'L', 'M', 'D', 'O'];
  readonly t = T;
  readonly alto = M * 2 + T * 2 + 40;

  readonly temporales = signal(false);
  readonly estado = signal<Estado>(ESTADOS[0]);
  /** diente-cara -> estado guardado (lo actual). */
  private readonly guardado = signal<Map<string, string>>(new Map());
  /** diente-cara -> estado por guardar. */
  private readonly pendiente = signal<Map<string, string>>(new Map());
  readonly historial = signal<MarcaDental[]>([]);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);

  readonly pendientes = computed(() => [...this.pendiente().entries()]);

  readonly dientes = computed(() => {
    const juego = this.temporales() ? TEMPORALES : PERMANENTES;
    const fila = (lista: number[], arriba: boolean) => lista.map((n, i) => ({
      n, arriba, x: M + i * (T + GAP) + (i >= lista.length / 2 ? GAP * 2 : 0), y: arriba ? M + 6 : M + T + 34,
    }));
    return [...fila(juego.arriba, true), ...fila(juego.abajo, false)];
  });
  readonly ancho = computed(() => {
    const n = this.temporales() ? 10 : 16;
    return M * 2 + n * (T + GAP) + GAP * 2;
  });

  async ngOnInit(): Promise<void> { await this.cargar(); }

  async cargar(): Promise<void> {
    const r = await this.salud.odontograma(this.customerId);
    if (!r.ok) { this.error.set(r.error || 'No se pudo cargar el odontograma.'); return; }
    this.guardado.set(new Map(r.datos.actual.map((m) => [`${m.diente}-${m.cara}`, m.estado])));
    this.historial.set(r.datos.historial);
  }

  /** La cara M queda hacia la línea media: a la derecha en los cuadrantes 1, 4, 5 y 8. */
  puntos(c: Cara, n: number, arriba: boolean): string {
    const q = Math.floor(n / 10);
    const mesialDerecha = [1, 4, 5, 8].includes(q);
    const lado = (c === 'M') === mesialDerecha ? 'der' : 'izq';
    const a = T * 0.3, b = T * 0.7;
    const arribaCara = arriba ? 'V' : 'L';
    if (c === 'O') return `${a},${a} ${b},${a} ${b},${b} ${a},${b}`;
    if ((c === 'V' || c === 'L') && c === arribaCara) return `0,0 ${T},0 ${b},${a} ${a},${a}`;
    if (c === 'V' || c === 'L') return `${a},${b} ${b},${b} ${T},${T} 0,${T}`;
    return lado === 'izq' ? `0,0 ${a},${a} ${a},${b} 0,${T}` : `${T},0 ${T},${T} ${b},${b} ${b},${a}`;
  }

  private actual(n: number, c: string): string | undefined {
    return this.pendiente().get(`${n}-${c}`) ?? this.guardado().get(`${n}-${c}`);
  }

  claseDe(n: number, c: Cara): Record<string, boolean> {
    const e = this.actual(n, c);
    const pend = this.pendiente().has(`${n}-${c}`);
    return { [`st-${e}`]: !!e && e !== 'SANO', sel: pend };
  }

  /** El símbolo de diente completo: X ausente/extracción, aro corona, línea endodoncia, cuadro implante. */
  completo(n: number): string | null {
    const e = this.actual(n, 'T');
    if (e === 'AUSENTE' || e === 'EXTRACCION') return 'X';
    if (e === 'CORONA') return 'O';
    if (e === 'ENDODONCIA') return 'E';
    if (e === 'IMPLANTE') return 'I';
    return null;
  }

  tocar(n: number, c: Cara): void {
    const e = this.estado();
    const p = new Map(this.pendiente());
    if (e.todoElDiente) {
      p.set(`${n}-T`, e.id);
    } else if (e.id === 'SANO') {
      /* «Sano» limpia esa cara y, si el diente tenía un estado completo, también ese. */
      p.set(`${n}-${c}`, 'SANO');
      if (this.actual(n, 'T') && this.actual(n, 'T') !== 'SANO') p.set(`${n}-T`, 'SANO');
    } else {
      p.set(`${n}-${c}`, e.id);
    }
    this.pendiente.set(p);
  }

  descartar(): void { this.pendiente.set(new Map()); }

  async guardar(): Promise<void> {
    if (!this.pendientes().length || this.guardando()) return;
    const marcas: MarcaDental[] = this.pendientes().map(([k, estado]) => {
      const [diente, cara] = k.split('-');
      return { diente: Number(diente), cara, estado };
    });
    this.guardando.set(true);
    const r = await this.salud.marcar(this.customerId, marcas);
    this.guardando.set(false);
    if (!r.ok) { this.error.set(r.error || 'No se pudo guardar.'); return; }
    this.error.set(null);
    this.pendiente.set(new Map());
    await this.cargar();
  }

  textoDe(id: string): string { return ESTADOS.find((e) => e.id === id)?.texto ?? id; }
}
