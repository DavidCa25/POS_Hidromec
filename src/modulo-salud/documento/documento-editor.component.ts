import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnDestroy, OnInit, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Diagnostico, Documento, SaludService, TipoDocumento } from '../salud.service';
import { DefinicionDocumento, LineaReceta, SIGNOS, definicion, faltante } from '../documentos';
import { MisDatosFirmaComponent } from '../profesional/mis-datos-firma.component';

/**
 * EL EDITOR DE UN DOCUMENTO DEL EXPEDIENTE.
 *
 * Dos pasos, como en papel: se escribe (BORRADOR, se puede corregir y
 * guardar cuantas veces haga falta) y se FIRMA. Firmado ya no cambia; lo que
 * haya que corregir va en una adenda desde la línea de tiempo.
 *
 * Solo su autor ve el borrador como editable: la base lo exige igual.
 */
@Component({
  selector: 'app-salud-documento-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, MisDatosFirmaComponent],
  styleUrls: ['../../modulo-servicios/servicios.css', '../salud.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <section class="srv-tarjeta d-flex flex-column gap-3" data-guide="doc-editor" [attr.data-guide-estado]="tipo">
    <div class="d-flex align-items-center gap-2">
      <h2 class="m-0"><i class="ph {{ def.icono }}"></i> {{ documento ? 'Editar ' + def.nombre.toLowerCase() : def.nombre }}</h2>
      <span class="srv-badge srv-badge--info ms-2">Borrador</span>
      <button type="button" class="btn srv-ghost srv-sm ms-auto" (click)="cerrar.emit()" aria-label="Cerrar"><i class="ph ph-x"></i></button>
    </div>

    <ng-container *ngFor="let c of def.campos">
      <div class="srv-campo" [ngSwitch]="c.tipo">
        <label [for]="'dc-' + c.clave">{{ c.texto }}<span *ngIf="c.obligatorio"> *</span></label>

        <input *ngSwitchCase="'texto'" class="form-control" [id]="'dc-' + c.clave" [(ngModel)]="contenido[c.clave]"
               [attr.data-guide]="'doc-' + c.clave">

        <textarea *ngSwitchCase="'area'" class="form-control" rows="3" [id]="'dc-' + c.clave" [(ngModel)]="contenido[c.clave]"
                  [attr.data-guide]="'doc-' + c.clave"></textarea>

        <div *ngSwitchCase="'vitales'" class="srv-form-fila">
          <div class="srv-campo" *ngFor="let s of signos">
            <label [for]="'dv-' + s.clave">{{ s.texto }} <span class="srv-opcional">{{ s.unidad }}</span></label>
            <input class="form-control ctl srv-sm" [id]="'dv-' + s.clave" [(ngModel)]="contenido['vitales'][s.clave]"
                   [attr.data-guide]="'doc-vital-' + s.clave">
          </div>
        </div>

        <div *ngSwitchCase="'medicamentos'" class="d-flex flex-column gap-2">
          <div class="srv-form-fila" *ngFor="let l of contenido['medicamentos']; let i = index">
            <input class="form-control ctl srv-sm" [(ngModel)]="l.medicamento" placeholder="Medicamento y presentación" [attr.data-guide]="'rx-med-' + i">
            <input class="form-control ctl srv-sm" [(ngModel)]="l.dosis" placeholder="Dosis" [attr.data-guide]="'rx-dosis-' + i">
            <input class="form-control ctl srv-sm" [(ngModel)]="l.via" placeholder="Vía (oral…)">
            <input class="form-control ctl srv-sm" [(ngModel)]="l.frecuencia" placeholder="Cada cuánto" [attr.data-guide]="'rx-frec-' + i">
            <input class="form-control ctl srv-sm" [(ngModel)]="l.duracion" placeholder="Por cuántos días">
            <input class="form-control ctl srv-sm" [(ngModel)]="l.cantidad" placeholder="Cantidad a surtir">
          </div>
          <button type="button" class="btn srv-sm align-self-start" (click)="agregarMedicamento()" data-guide="rx-agregar">
            <i class="ph ph-plus"></i> Medicamento</button>
        </div>
        <span class="srv-ayuda" *ngIf="c.ayuda">{{ c.ayuda }}</span>
      </div>
    </ng-container>

    <!-- -------------------------------------------------- diagnósticos -->
    <div class="srv-campo" *ngIf="def.diagnosticos">
      <label for="dc-dx">Diagnósticos (CIE-10)</label>
      <div class="sl-dx">
        <span class="srv-badge" *ngFor="let d of diagnosticos(); let i = index" [ngClass]="d.principal ? 'srv-badge--info' : 'srv-badge--mute'">
          <b *ngIf="d.cie10">{{ d.cie10 }}</b> {{ d.descripcion }}
          <button type="button" class="btn srv-ghost srv-sm p-0 ms-1" (click)="quitarDx(i)" aria-label="Quitar"><i class="ph ph-x"></i></button>
        </span>
      </div>
      <div class="sl-dx-buscador">
        <input id="dc-dx" class="form-control" [(ngModel)]="buscaDx" (ngModelChange)="buscarDx()" (keydown.enter)="dxLibre()"
               placeholder="Busca por código o nombre; Enter agrega el texto sin código" autocomplete="off" data-guide="doc-dx">
        <ul class="sl-dx-sug" *ngIf="sugerencias().length" role="listbox">
          <li *ngFor="let s of sugerencias()">
            <button type="button" (click)="agregarDx(s.codigo, s.descripcion)" [attr.data-guide]="'dx-' + s.codigo"><code>{{ s.codigo }}</code> {{ s.descripcion }}</button>
          </li>
        </ul>
      </div>
    </div>

    <p class="srv-error" *ngIf="error()">{{ error() }}</p>
    <div class="d-flex justify-content-end gap-2 flex-wrap">
      <button type="button" class="btn srv-danger" *ngIf="documento" (click)="descartar()" [disabled]="ocupado()">Descartar borrador</button>
      <button type="button" class="btn" (click)="guardar(false)" [disabled]="ocupado()" data-guide="doc-guardar">Guardar borrador</button>
      <button type="button" class="btn btn-primary" (click)="guardar(true)" [disabled]="ocupado()" data-guide="doc-firmar">
        <i class="ph ph-signature"></i> Firmar</button>
    </div>
    <p class="srv-hint m-0">Firmado ya no se puede cambiar ni borrar; se corrige con una adenda.</p>
    <!-- Una receta sin cédula no se firma: se piden aquí y se vuelve a firmar. -->
    <app-salud-mis-datos *ngIf="pedirCedula()" (cerrar)="pedirCedula.set(false)" (guardados)="guardar(true)"></app-salud-mis-datos>
  </section>
  `,
})
export class DocumentoEditorComponent implements OnInit, OnDestroy {
  private readonly salud = inject(SaludService);

  @Input({ required: true }) pacienteId!: number;
  @Input({ required: true }) tipo!: TipoDocumento;
  /** Un borrador existente; sin él, documento nuevo. */
  @Input() documento: Documento | null = null;
  @Output() cerrar = new EventEmitter<void>();
  @Output() guardado = new EventEmitter<{ id: number; firmado: boolean }>();

  def!: DefinicionDocumento;
  readonly signos = SIGNOS;
  contenido: Record<string, any> = {};
  readonly diagnosticos = signal<Diagnostico[]>([]);
  readonly sugerencias = signal<{ codigo: string; descripcion: string }[]>([]);
  readonly ocupado = signal(false);
  /** La firma pidió cédula (SIN_CEDULA): se abre «Mis datos de firma». */
  readonly pedirCedula = signal(false);
  readonly error = signal<string | null>(null);
  buscaDx = '';
  private temporizador: ReturnType<typeof setTimeout> | null = null;
  private idActual: number | null = null;

  ngOnInit(): void {
    this.def = definicion(this.tipo);
    this.idActual = this.documento?.id ?? null;
    const base = this.documento?.contenido ?? {};
    this.contenido = { ...base, vitales: { ...(base.vitales ?? {}) } };
    if (this.def.campos.some((c) => c.tipo === 'medicamentos')) {
      this.contenido['medicamentos'] = (base.medicamentos as LineaReceta[] | undefined)?.map((l) => ({ ...l })) ?? [];
      if (!this.contenido['medicamentos'].length) this.agregarMedicamento();
    }
    this.diagnosticos.set(this.documento?.diagnosticos?.map((d) => ({ ...d })) ?? []);
  }

  ngOnDestroy(): void { if (this.temporizador) clearTimeout(this.temporizador); }

  agregarMedicamento(): void {
    this.contenido['medicamentos'] = [...(this.contenido['medicamentos'] ?? []),
      { medicamento: '', dosis: '', via: 'Oral', frecuencia: '', duracion: '', cantidad: '' } satisfies LineaReceta];
  }

  buscarDx(): void {
    if (this.temporizador) clearTimeout(this.temporizador);
    const q = this.buscaDx.trim();
    if (q.length < 2) { this.sugerencias.set([]); return; }
    this.temporizador = setTimeout(async () => {
      const r = await this.salud.cie10(q);
      if (r.ok && this.buscaDx.trim() === q) this.sugerencias.set(r.datos);
    }, 200);
  }

  agregarDx(cie10: string | null, descripcion: string): void {
    const lista = this.diagnosticos();
    if (lista.some((d) => (cie10 && d.cie10 === cie10) || d.descripcion === descripcion)) return;
    this.diagnosticos.set([...lista, { cie10, descripcion, principal: lista.length === 0 }]);
    this.buscaDx = '';
    this.sugerencias.set([]);
  }

  dxLibre(): void {
    const t = this.buscaDx.trim();
    if (!t) return;
    const primera = this.sugerencias()[0];
    if (primera) this.agregarDx(primera.codigo, primera.descripcion);
    else this.agregarDx(null, t);
  }

  quitarDx(i: number): void {
    const lista = this.diagnosticos().filter((_, j) => j !== i);
    if (lista.length && !lista.some((d) => d.principal)) lista[0] = { ...lista[0], principal: true };
    this.diagnosticos.set(lista);
  }

  /** Lo que se guarda: sin renglones vacíos ni signos sin valor. */
  private limpio(): Record<string, any> {
    const c: Record<string, any> = {};
    for (const [k, v] of Object.entries(this.contenido)) {
      if (k === 'vitales') {
        const vit = Object.fromEntries(Object.entries(v ?? {}).filter(([, x]) => String(x ?? '').trim()));
        if (Object.keys(vit).length) c[k] = vit;
      } else if (k === 'medicamentos') {
        c[k] = (v as LineaReceta[]).filter((l) => l.medicamento?.trim());
      } else if (String(v ?? '').trim()) c[k] = String(v).trim();
    }
    return c;
  }

  async guardar(firmar: boolean): Promise<void> {
    if (this.ocupado()) return;
    const contenido = this.limpio();
    if (firmar) {
      const falta = faltante(this.def, contenido);
      if (falta) { this.error.set(`Falta «${falta}» para poder firmar.`); return; }
    }
    this.ocupado.set(true);
    const r = await this.salud.guardarDocumento({
      id: this.idActual, pacienteId: this.pacienteId, tipo: this.tipo, titulo: this.def.nombre,
      contenido, diagnosticos: this.def.diagnosticos ? this.diagnosticos() : [],
    });
    if (!r.ok || !r.datos) { this.ocupado.set(false); this.error.set(r.error || 'No se pudo guardar.'); return; }
    this.idActual = r.datos;
    if (firmar) {
      const f = await this.salud.firmar(r.datos);
      if (!f.ok) {
        this.ocupado.set(false);
        if (f.motivo === 'SIN_CEDULA') { this.error.set(null); this.pedirCedula.set(true); return; }
        this.error.set(f.error || 'Se guardó, pero no se pudo firmar.');
        return;
      }
    }
    this.ocupado.set(false);
    this.guardado.emit({ id: r.datos, firmado: firmar });
  }

  async descartar(): Promise<void> {
    if (!this.idActual || this.ocupado()) return;
    this.ocupado.set(true);
    const r = await this.salud.descartar(this.idActual);
    this.ocupado.set(false);
    if (!r.ok) { this.error.set(r.error || 'No se pudo descartar.'); return; }
    this.cerrar.emit();
  }
}
