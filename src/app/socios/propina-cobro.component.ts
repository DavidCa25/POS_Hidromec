import { Component, EventEmitter, Input, OnChanges, OnInit, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CapabilityService, SociosService, dinero } from '../../core';

export interface PropinaElegida { monto: number; metodo: 'EFECTIVO' | 'TARJETA'; }

/**
 * LA PROPINA EN EL COBRO (0079). Retail y Touch la usan igual.
 *
 * Solo con la aplicacion Propinas activada y un pago de contado en efectivo o
 * tarjeta: la propina se cobra por el mismo medio que la cuenta. Con otro
 * medio (credito, dividido, plataforma) no se ofrece; no hay forma honesta
 * de saber por donde llego.
 *
 * No toca el total de la venta: la propina no es venta. Emite lo elegido y
 * SaleService la manda al cobro, que la registra despues del COMMIT.
 */
@Component({
  selector: 'app-propina-cobro',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <fieldset class="prop" *ngIf="visible" data-guide="propina-cobro">
      <legend>Propina <small>(no es venta)</small></legend>
      <div class="prop__ops" role="radiogroup" aria-label="Propina">
        <button type="button" role="radio" class="prop__op" [class.on]="!monto()" [attr.aria-checked]="!monto()" (click)="elegir(0)">Sin propina</button>
        <button type="button" role="radio" class="prop__op" *ngFor="let p of sugeridas()" [class.on]="pct() === p"
                [attr.aria-checked]="pct() === p" (click)="elegirPct(p)" [attr.data-guide-clave]="p">
          {{ p }} %<small>{{ dinero(redondo(total * p / 100)) }}</small>
        </button>
        <label class="prop__otra">
          <span>Otra</span>
          <input type="number" min="0" step="0.5" [ngModel]="otra()" (ngModelChange)="elegirOtra($event)"
                 aria-label="Otra cantidad de propina" data-guide="propina-otra">
        </label>
      </div>
      <p class="prop__nota" *ngIf="monto()">
        {{ metodo === 'EFECTIVO' ? 'Cobra' : 'Pasa en la terminal' }} {{ dinero(total + monto()) }}: {{ dinero(total) }} de la cuenta y {{ dinero(monto()) }} de propina.
      </p>
    </fieldset>`,
  styles: [`
    .prop { border: 1px solid var(--wx-edge); border-radius: 12px; padding: 10px 12px; margin: 12px 0 0; }
    .prop legend { float: none; width: auto; padding: 0 6px; margin: 0; font-size: var(--wx-text-sm); font-weight: 600; }
    .prop legend small { color: var(--wx-text-muted); font-weight: 400; }
    .prop__ops { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .prop__op { min-height: 44px; padding: 4px 12px; border-radius: 10px; border: 1px solid var(--wx-edge-strong);
      background: var(--wx-surface); color: var(--wx-text); font: 500 var(--wx-text-sm) var(--wx-font); cursor: pointer;
      display: inline-flex; flex-direction: column; align-items: center; justify-content: center; }
    .prop__op small { font-size: var(--wx-text-xs); color: var(--wx-text-muted); font-family: var(--wx-font-mono); }
    .prop__op.on { border-color: var(--wx-user-accent); box-shadow: inset 0 0 0 1px var(--wx-user-accent); font-weight: 600; }
    .prop__op:focus-visible, .prop__otra input:focus-visible { outline: 2px solid var(--wx-user-accent); outline-offset: 2px; }
    .prop__otra { display: inline-flex; align-items: center; gap: 6px; font-size: var(--wx-text-sm); }
    .prop__otra input { width: 96px; height: 44px; padding: 0 10px; border-radius: 10px; border: 1px solid var(--wx-edge-strong);
      background: var(--wx-surface); color: var(--wx-text); text-align: right; font: 400 var(--wx-text-base) var(--wx-font-mono); }
    .prop__nota { margin: 8px 0 0; font-size: var(--wx-text-sm); color: var(--wx-text-muted); }
  `],
})
export class PropinaCobroComponent implements OnInit, OnChanges {
  private readonly caps = inject(CapabilityService);
  private readonly svc = inject(SociosService);
  readonly dinero = dinero;

  /** Total de la cuenta (sin propina). */
  @Input() total = 0;
  /** Medio de pago de la cuenta. */
  @Input() metodo = '';
  @Output() cambio = new EventEmitter<PropinaElegida | null>();

  sugeridas = signal<number[]>([10, 15, 20]);
  monto = signal(0);
  pct = signal<number | null>(null);
  otra = signal<number | null>(null);

  get visible(): boolean { return this.caps.propinas && (this.metodo === 'EFECTIVO' || this.metodo === 'TARJETA') && this.total > 0; }

  async ngOnInit(): Promise<void> {
    if (!this.caps.propinas) return;
    const r = await this.svc.configPropinas();
    if (r.ok && r.data?.sugeridas) {
      const s = String(r.data.sugeridas).split(',').map(Number).filter(n => n > 0);
      if (s.length) this.sugeridas.set(s);
    }
  }

  /** Cambia el total o el medio: un % se recalcula; con otro medio no hay propina. */
  ngOnChanges(): void {
    if (!this.visible) { if (this.monto()) this.elegir(0); return; }
    if (this.pct() != null) this.elegirPct(this.pct()!);
    else this.emitir();
  }

  redondo(n: number): number { return Math.round(n * 100) / 100; }

  elegir(m: number): void { this.pct.set(null); this.otra.set(null); this.monto.set(m); this.emitir(); }
  elegirPct(p: number): void { this.pct.set(p); this.otra.set(null); this.monto.set(this.redondo(this.total * p / 100)); this.emitir(); }
  elegirOtra(v: any): void {
    const n = Math.max(0, Number(v) || 0);
    this.pct.set(null); this.otra.set(n || null); this.monto.set(this.redondo(n)); this.emitir();
  }

  private emitir(): void {
    const m = this.monto();
    this.cambio.emit(m > 0 && this.visible ? { monto: m, metodo: this.metodo as 'EFECTIVO' | 'TARJETA' } : null);
  }
}
