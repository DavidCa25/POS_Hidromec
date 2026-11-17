import { ChangeDetectionStrategy, Component, Input, computed, signal } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';

/**
 * LA GRÁFICA DENTRO DE UN MENSAJE DE WYBIX.
 *
 *   barras  hasta 12 puntos: barras horizontales con su etiqueta y su valor
 *           (se leen en una caja angosta); más de 12 (las horas del día):
 *           columnas.
 *   linea   una serie por día: línea con el punto más alto y el más bajo.
 *
 * Sin librerías y sin animación (movimiento reducido no tiene nada que
 * apagar). Los números exactos siguen en la lista del mensaje: la gráfica es
 * para ver la forma, y se describe en `aria-label` para quien no la ve.
 */
export interface GraficaChat {
  tipo: 'barras' | 'linea';
  dinero?: boolean;
  puntos: { etiqueta: string; valor: number }[];
}

@Component({
  selector: 'wx-grafica-chat',
  standalone: true,
  imports: [NgIf, NgFor],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <figure class="wgc" *ngIf="g() as g" role="img" [attr.aria-label]="resumen()" data-guide="wybix-grafica" [attr.data-guide-estado]="g.tipo">
    <ng-container *ngIf="g.tipo === 'barras' && g.puntos.length <= 12">
      <div class="wgc__barra" *ngFor="let p of g.puntos" aria-hidden="true">
        <span class="wgc__et">{{ p.etiqueta }}</span>
        <span class="wgc__pista"><span class="wgc__lleno" [class.es-neg]="p.valor < 0" [style.width.%]="ancho(p.valor)"></span></span>
        <span class="wgc__val">{{ fmt(p.valor) }}</span>
      </div>
    </ng-container>
    <svg *ngIf="g.tipo === 'barras' && g.puntos.length > 12" class="wgc__svg" [attr.viewBox]="'0 0 ' + (g.puntos.length * 10) + ' 60'" preserveAspectRatio="none" aria-hidden="true">
      <rect *ngFor="let p of g.puntos; let i = index" [attr.x]="i * 10 + 1.5" [attr.width]="7"
            [attr.y]="56 - alto(p.valor)" [attr.height]="alto(p.valor)" rx="1.5" class="wgc__col"></rect>
    </svg>
    <div *ngIf="g.tipo === 'barras' && g.puntos.length > 12" class="wgc__eje" aria-hidden="true">
      <span>{{ g.puntos[0].etiqueta }}</span><span>{{ g.puntos[g.puntos.length - 1].etiqueta }}</span>
    </div>
    <ng-container *ngIf="g.tipo === 'linea'">
      <svg class="wgc__svg" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true">
        <polyline [attr.points]="linea()" class="wgc__linea" vector-effect="non-scaling-stroke"></polyline>
      </svg>
      <div class="wgc__eje" aria-hidden="true">
        <span>{{ g.puntos[0].etiqueta }}</span><span>{{ g.puntos[g.puntos.length - 1].etiqueta }}</span>
      </div>
    </ng-container>
  </figure>
  `,
  styles: [`
    .wgc { margin: 10px 0 2px; display: grid; gap: 4px; }
    .wgc__barra { display: grid; grid-template-columns: minmax(64px, 34%) 1fr auto; align-items: center; gap: 8px; font-size: 12px; }
    .wgc__et { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--wx-text-muted); }
    .wgc__pista { height: 8px; border-radius: 4px; background: color-mix(in srgb, var(--wx-text) 8%, transparent); overflow: hidden; }
    .wgc__lleno { display: block; height: 100%; border-radius: 4px; background: var(--wx-accent, var(--wx-text)); min-width: 2px; }
    .wgc__lleno.es-neg { background: var(--wx-danger, #d64545); }
    .wgc__val { font-family: var(--wx-font-mono); font-variant-numeric: tabular-nums; font-size: 12px; }
    .wgc__svg { width: 100%; height: 64px; display: block; }
    .wgc__col { fill: var(--wx-accent, currentColor); }
    .wgc__linea { fill: none; stroke: var(--wx-accent, currentColor); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
    .wgc__eje { display: flex; justify-content: space-between; font-size: 11px; color: var(--wx-text-muted); }
  `],
})
export class WxGraficaChatComponent {
  readonly g = signal<GraficaChat | null>(null);
  @Input() set grafica(v: GraficaChat | null | undefined) {
    this.g.set(v && Array.isArray(v.puntos) && v.puntos.length ? v : null);
  }

  private readonly maximo = computed(() => Math.max(1e-9, ...(this.g()?.puntos || []).map((p) => Math.abs(Number(p.valor) || 0))));
  private readonly minimo = computed(() => Math.min(...(this.g()?.puntos || []).map((p) => Number(p.valor) || 0)));

  ancho(v: number) { return Math.max(0, Math.min(100, (Math.abs(Number(v) || 0) / this.maximo()) * 100)); }
  alto(v: number) { return Math.max(1, (Math.max(0, Number(v) || 0) / this.maximo()) * 52); }

  fmt(v: number) {
    const n = Number(v) || 0;
    if (this.g()?.dinero) return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2 });
    return n.toLocaleString('es-MX', { maximumFractionDigits: 2 });
  }

  readonly linea = computed(() => {
    const ps = this.g()?.puntos || [];
    const max = this.maximo(), min = Math.min(0, this.minimo());
    const rango = max - min || 1;
    return ps.map((p, i) => `${ps.length === 1 ? 50 : (i / (ps.length - 1)) * 100},${56 - ((Number(p.valor) - min) / rango) * 52}`).join(' ');
  });

  readonly resumen = computed(() => {
    const g = this.g();
    if (!g) return '';
    const orden = [...g.puntos].sort((a, b) => b.valor - a.valor);
    const alto = orden[0], bajo = orden[orden.length - 1];
    return `Gráfica: el más alto es ${alto.etiqueta} con ${this.fmt(alto.valor)}${g.puntos.length > 1 ? `; el más bajo, ${bajo.etiqueta} con ${this.fmt(bajo.valor)}` : ''}.`;
  });
}
