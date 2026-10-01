import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { EgresosService, ConceptoEgreso } from '../../core';

/**
 * CONCEPTOS DE EGRESO: Renta, Luz, Uber, Didi, Gas... los que use el negocio.
 *
 * Se crean, se renombran, se activan o desactivan y se ordenan sin tocar
 * codigo. No se borran: un concepto con egresos pasados se DESACTIVA y su
 * historial sigue en los reportes. "Pago al personal" es del sistema: se
 * puede renombrar y mover, no desactivar (es lo que liga un egreso a una
 * persona).
 */
@Component({
  selector: 'app-conceptos-egreso-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrls: ['../panel-controls.css'],
  styles: [`
    .cep-row{display:flex;align-items:center;gap:.6rem;padding:.7rem 0;border-bottom:1px solid var(--wx-edge);}
    .cep-orden{display:flex;flex-direction:column;}
    .cep-orden button{background:none;border:0;padding:0 .2rem;color:var(--wx-text-muted);cursor:pointer;line-height:1;}
    .cep-orden button:disabled{opacity:.3;cursor:default;}
    .cep-nombre{flex:1;min-width:0;}
    .cep-nombre input{width:100%;border:1px solid transparent;background:transparent;border-radius:var(--wx-radius-xs);padding:.3rem .45rem;color:var(--wx-text);font-weight:600;}
    .cep-nombre input:hover,.cep-nombre input:focus{border-color:var(--wx-edge);background:var(--wx-surface);}
    .cep-meta{font-size:.75rem;color:var(--wx-text-muted);padding-left:.45rem;}
    .cep-inactivo .cep-nombre input{color:var(--wx-text-muted);font-weight:500;}
    .cep-nuevo{display:flex;gap:.5rem;margin-top:1rem;}
    .cep-nuevo input{flex:1;}
  `],
  template: `
  <div class="panel-content">
    <div class="section-title"><i class="ph ph-receipt"></i> Conceptos de egreso</div>
    <p class="hint" style="margin-bottom:.5rem;">
      En qué gasta tu negocio: renta, luz, Uber, Didi, gas… Aparecen al registrar un egreso y en los reportes.
      Un concepto que ya se usó no se borra: se desactiva y su historial se conserva.
    </p>

    <div class="cep-row" *ngFor="let c of conceptos; let i = index; let ultimo = last; let primero = first" [class.cep-inactivo]="!c.active">
      <div class="cep-orden">
        <button type="button" [disabled]="primero || moviendo" (click)="mover(c, -1)" [attr.aria-label]="'Subir ' + c.name"><i class="ph ph-caret-up"></i></button>
        <button type="button" [disabled]="ultimo || moviendo" (click)="mover(c, 1)" [attr.aria-label]="'Bajar ' + c.name"><i class="ph ph-caret-down"></i></button>
      </div>
      <div class="cep-nombre">
        <input [(ngModel)]="c.name" [name]="'cep' + c.id" maxlength="60" (blur)="renombrar(c)" (keydown.enter)="$any($event.target).blur()">
        <div class="cep-meta">
          <span *ngIf="c.kind === 'PERSONAL'">Del sistema · liga el pago a una persona</span>
          <span *ngIf="c.kind !== 'PERSONAL'">{{ c.usos }} {{ c.usos === 1 ? 'egreso' : 'egresos' }}</span>
        </div>
      </div>
      <label class="sw" [attr.title]="c.is_system ? 'Concepto del sistema: no se desactiva' : (c.active ? 'Desactivar' : 'Activar')">
        <input type="checkbox" [checked]="c.active" [disabled]="c.is_system" (change)="alternar(c)">
        <span class="sl"></span>
      </label>
    </div>

    <div class="cep-nuevo">
      <input class="form-control" [(ngModel)]="nuevo" name="cepNuevo" maxlength="60" placeholder="Nuevo concepto (ej. Uber)" (keydown.enter)="crear()">
      <button class="btn-primary" type="button" (click)="crear()" [disabled]="!nuevo.trim() || guardando">
        <i class="ph ph-plus"></i> Agregar
      </button>
    </div>
  </div>
  `,
})
export class ConceptosEgresoPanelComponent implements OnInit {
  private readonly egresos = inject(EgresosService);
  conceptos: ConceptoEgreso[] = [];
  private originales = new Map<number, string>();
  nuevo = '';
  guardando = false;
  moviendo = false;

  async ngOnInit() { await this.cargar(); }

  private async cargar() {
    this.conceptos = await this.egresos.conceptos(true);
    this.originales = new Map(this.conceptos.map(c => [c.id, c.name]));
  }

  private async error(r: { ok: boolean; error?: string }) {
    await Swal.fire({ icon: 'error', title: 'No se guardó', text: r.error || 'No se pudo guardar.' });
    await this.cargar();
  }

  async crear() {
    const name = this.nuevo.trim();
    if (!name || this.guardando) return;
    this.guardando = true;
    const r = await this.egresos.guardarConcepto({ name });
    this.guardando = false;
    if (!r.ok) return this.error(r);
    this.nuevo = '';
    await this.cargar();
  }

  async renombrar(c: ConceptoEgreso) {
    const name = c.name.trim();
    if (name === this.originales.get(c.id)) return;
    if (!name) { c.name = this.originales.get(c.id) ?? c.name; return; }
    const r = await this.egresos.guardarConcepto({ id: c.id, name, active: c.active });
    if (!r.ok) return this.error(r);
    this.originales.set(c.id, name);
  }

  async alternar(c: ConceptoEgreso) {
    const r = await this.egresos.guardarConcepto({ id: c.id, name: c.name, active: !c.active });
    if (!r.ok) return this.error(r);
    c.active = !c.active;
  }

  async mover(c: ConceptoEgreso, dir: -1 | 1) {
    this.moviendo = true;
    const r = await this.egresos.moverConcepto(c.id, dir);
    this.moviendo = false;
    if (!r.ok) return this.error(r);
    await this.cargar();
  }
}
