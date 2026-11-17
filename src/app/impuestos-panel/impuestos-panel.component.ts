import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';

/**
 * IMPUESTOS ADEMÁS DEL IVA (0083): el catálogo.
 *
 * IEPS por tasa (alimentos 8%, alcohol, energizantes…), IEPS por cuota
 * (pesos por litro de refresco, por cigarro) e impuestos locales (hospedaje).
 * Los de cuota se siembran apagados y sin valor: la cuota cambia cada año y
 * la captura el negocio. Cambiar una tasa vale para las ventas de ahora en
 * adelante; las pasadas guardaron la suya. No se borran: se apagan.
 *
 * Qué producto lleva cuál se marca en la ficha del producto (Inventario).
 */
interface Impuesto {
  id: number | null; clave?: string; nombre: string; clase: 'IEPS' | 'LOCAL'; factor: 'Tasa' | 'Cuota';
  tasa: number | null; cuota: number | null; unidad: string | null; en_base_iva: boolean; nota: string | null;
  activo: boolean; sistema: boolean; productos: number;
  /** Lo que se escribe: la tasa en % (8), no en fracción (0.08). */
  pct?: number | null;
}

@Component({
  selector: 'app-impuestos-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrls: ['../panel-controls.css'],
  styles: [`
    .imp-grupo{margin-top:1rem;font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--wx-text-muted);}
    .imp-row{display:grid;grid-template-columns:1fr auto auto;align-items:center;gap:.6rem;padding:.7rem 0;border-bottom:1px solid var(--wx-edge);}
    .imp-nombre{min-width:0;}
    .imp-nombre b{display:block;font-weight:600;}
    .imp-nombre input{width:100%;border:1px solid transparent;background:transparent;border-radius:var(--wx-radius-xs);padding:.3rem .45rem;color:var(--wx-text);font-weight:600;}
    .imp-nombre input:hover,.imp-nombre input:focus{border-color:var(--wx-edge);background:var(--wx-surface);}
    .imp-meta{font-size:.75rem;color:var(--wx-text-muted);}
    .imp-valor{display:flex;align-items:center;gap:.3rem;white-space:nowrap;}
    .imp-valor input{width:84px;text-align:right;}
    .imp-inactivo .imp-nombre b{color:var(--wx-text-muted);font-weight:500;}
    .imp-nuevo{display:grid;grid-template-columns:1fr auto auto auto;gap:.5rem;margin-top:1rem;align-items:center;}
    .imp-seg{display:inline-flex;border:1px solid var(--wx-edge);border-radius:var(--wx-radius-xs);overflow:hidden;}
    .imp-seg button{border:0;background:transparent;padding:.35rem .6rem;color:var(--wx-text);cursor:pointer;}
    .imp-seg button.sel{background:var(--wx-rail,#0F1B2D);color:var(--wx-rail-ink,#fff);}
    @media (max-width:560px){.imp-row{grid-template-columns:1fr auto}.imp-row .sw{grid-column:2}.imp-nuevo{grid-template-columns:1fr 1fr}}
  `],
  template: `
  <div class="panel-content" data-guide="impuestos-panel">
    <div class="section-title"><i class="ph ph-percent"></i> Impuestos además del IVA</div>
    <p class="hint" style="margin-bottom:.5rem;">
      El IVA de cada producto sigue en su ficha. Aquí está el IEPS (por tasa o por cuota) y los impuestos locales.
      El precio de venta ya los incluye: Wybix los separa para que la ganancia no cuente impuestos como si fueran tuyos.
      Las cuotas cambian cada año: captura la vigente y verifica las tasas con tu contador.
    </p>

    <ng-container *ngFor="let g of grupos">
      <div class="imp-grupo">{{ g.titulo }}</div>
      <div class="imp-row" *ngFor="let i of g.items" [class.imp-inactivo]="!i.activo" data-guide="impuesto" [attr.data-guide-clave]="i.clave">
        <div class="imp-nombre">
          <b *ngIf="i.sistema">{{ i.nombre }}</b>
          <input *ngIf="!i.sistema" [(ngModel)]="i.nombre" [name]="'impn' + i.id" maxlength="80" (blur)="guardar(i)" (keydown.enter)="$any($event.target).blur()">
          <div class="imp-meta">
            {{ i.factor === 'Tasa' ? 'Por tasa' : 'Por cuota, pesos por ' + (i.unidad || 'unidad') }}
            · {{ i.productos }} {{ i.productos === 1 ? 'producto' : 'productos' }}
            <ng-container *ngIf="!i.en_base_iva"> · fuera de la base del IVA</ng-container>
            <ng-container *ngIf="i.nota"> · {{ i.nota }}</ng-container>
          </div>
        </div>
        <label class="imp-valor">
          <ng-container *ngIf="i.factor === 'Tasa'">
            <input class="form-control" type="number" step="0.01" min="0" [(ngModel)]="i.pct" [name]="'impt' + i.id" (blur)="guardar(i)"
                   data-guide="impuesto-valor" [attr.aria-label]="'Tasa de ' + i.nombre"> %
          </ng-container>
          <ng-container *ngIf="i.factor === 'Cuota'">
            $ <input class="form-control" type="number" step="0.0001" min="0" [(ngModel)]="i.cuota" [name]="'impc' + i.id" (blur)="guardar(i)"
                     data-guide="impuesto-valor" [attr.aria-label]="'Cuota de ' + i.nombre">
          </ng-container>
        </label>
        <label class="sw" [attr.title]="i.activo ? 'Apagar' : 'Encender'">
          <input type="checkbox" [checked]="i.activo" (change)="alternar(i)" data-guide="impuesto-activo" [attr.aria-label]="(i.activo ? 'Apagar ' : 'Encender ') + i.nombre">
          <span class="sl"></span>
        </label>
      </div>
    </ng-container>

    <div class="imp-grupo">Agregar uno propio</div>
    <div class="imp-nuevo">
      <input class="form-control" [(ngModel)]="nuevo.nombre" name="impNuevo" maxlength="80" placeholder="Nombre (ej. IEPS bebidas con edulcorante)">
      <div class="imp-seg" role="group" aria-label="Clase">
        <button type="button" [class.sel]="nuevo.clase === 'IEPS'" (click)="nuevo.clase = 'IEPS'">IEPS</button>
        <button type="button" [class.sel]="nuevo.clase === 'LOCAL'" (click)="nuevo.clase = 'LOCAL'">Local</button>
      </div>
      <div class="imp-seg" role="group" aria-label="Cómo se calcula">
        <button type="button" [class.sel]="nuevo.factor === 'Tasa'" (click)="nuevo.factor = 'Tasa'">%</button>
        <button type="button" [class.sel]="nuevo.factor === 'Cuota'" (click)="nuevo.factor = 'Cuota'">$ por unidad</button>
      </div>
      <input class="form-control" type="number" step="0.01" min="0" [(ngModel)]="nuevo.valor" name="impNuevoValor"
             [placeholder]="nuevo.factor === 'Tasa' ? 'Tasa %' : 'Cuota $'" style="width:110px">
      <input class="form-control" *ngIf="nuevo.factor === 'Cuota'" [(ngModel)]="nuevo.unidad" name="impNuevoUnidad" maxlength="20" placeholder="Unidad (litro, pieza…)">
      <button class="btn-primary" type="button" (click)="crear()" [disabled]="!nuevo.nombre.trim() || !(nuevo.valor > 0) || guardando" data-guide="impuesto-agregar">
        <i class="ph ph-plus"></i> Agregar
      </button>
    </div>
  </div>
  `,
})
export class ImpuestosPanelComponent implements OnInit {
  impuestos: Impuesto[] = [];
  grupos: { titulo: string; items: Impuesto[] }[] = [];
  nuevo = { nombre: '', clase: 'IEPS' as 'IEPS' | 'LOCAL', factor: 'Tasa' as 'Tasa' | 'Cuota', valor: null as any, unidad: '' };
  guardando = false;
  private originales = new Map<number, string>();

  private get api() { return (window as any).electronAPI; }

  async ngOnInit() { await this.cargar(); }

  private async cargar() {
    const r = await this.api?.impuestosListar?.({ todos: true });
    this.impuestos = (r?.success ? r.data : []).map((x: any): Impuesto => ({
      id: Number(x.id), clave: x.clave, nombre: String(x.nombre), clase: x.clase, factor: x.factor,
      tasa: x.tasa != null ? Number(x.tasa) : null, cuota: x.cuota != null ? Number(x.cuota) : null,
      unidad: x.unidad ?? null, en_base_iva: !!x.en_base_iva, nota: x.nota ?? null, activo: !!x.activo, sistema: !!x.sistema,
      productos: Number(x.productos) || 0, pct: x.tasa != null ? Math.round(Number(x.tasa) * 1_000_000) / 10_000 : null,
    }));
    this.grupos = [
      { titulo: 'IEPS', items: this.impuestos.filter((i) => i.clase === 'IEPS') },
      { titulo: 'Locales', items: this.impuestos.filter((i) => i.clase === 'LOCAL') },
    ].filter((g) => g.items.length);
    this.originales = new Map(this.impuestos.map((i) => [Number(i.id), this.firma(i)]));
  }

  private firma(i: Impuesto) { return JSON.stringify([i.nombre, i.pct, i.cuota, i.activo]); }

  private payload(i: Impuesto, activo = i.activo) {
    const tasa = i.factor === 'Tasa' && i.pct != null && Number(i.pct) > 0 ? Number(i.pct) / 100 : null;
    const cuota = i.factor === 'Cuota' && i.cuota != null && Number(i.cuota) > 0 ? Number(i.cuota) : null;
    return { id: i.id, nombre: i.nombre.trim(), clase: i.clase, factor: i.factor, tasa, cuota, unidad: i.unidad,
             enBaseIva: i.en_base_iva, nota: i.nota, activo };
  }

  private async error(texto?: string) {
    await Swal.fire({ icon: 'error', title: 'No se guardó', text: texto || 'No se pudo guardar.' });
    await this.cargar();
  }

  async guardar(i: Impuesto) {
    if (this.firma(i) === this.originales.get(Number(i.id))) return;
    if (!i.nombre.trim()) { await this.cargar(); return; }
    /* Sin valor no puede quedar encendido: se apaga solo y se dice. */
    const p = this.payload(i);
    if (p.activo && p.tasa == null && p.cuota == null) p.activo = false;
    const r = await this.api?.impuestosGuardar?.(p);
    if (!r?.success) return this.error(r?.error);
    await this.cargar();
  }

  async alternar(i: Impuesto) {
    const p = this.payload(i, !i.activo);
    if (p.activo && p.tasa == null && p.cuota == null) {
      await Swal.fire({ icon: 'info', title: 'Falta el valor', text: i.factor === 'Tasa' ? 'Escribe la tasa antes de encenderlo.' : 'Escribe la cuota vigente antes de encenderlo.' });
      await this.cargar();
      return;
    }
    const r = await this.api?.impuestosGuardar?.(p);
    if (!r?.success) return this.error(r?.error);
    await this.cargar();
  }

  async crear() {
    const n = this.nuevo;
    if (!n.nombre.trim() || !(Number(n.valor) > 0) || this.guardando) return;
    this.guardando = true;
    const r = await this.api?.impuestosGuardar?.({
      nombre: n.nombre.trim(), clase: n.clase, factor: n.factor,
      tasa: n.factor === 'Tasa' ? Number(n.valor) / 100 : null, cuota: n.factor === 'Cuota' ? Number(n.valor) : null,
      unidad: n.factor === 'Cuota' ? (n.unidad.trim() || null) : null, activo: true,
    });
    this.guardando = false;
    if (!r?.success) return this.error(r?.error);
    this.nuevo = { nombre: '', clase: 'IEPS', factor: 'Tasa', valor: null, unidad: '' };
    await this.cargar();
  }
}
