import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WxSelectComponent, WxOpcion } from '../../app/wx-select/wx-select.component';
import { Estudio, Modalidad, ParametroLab, SaludService, TipoEstudio } from '../salud.service';
import { MODALIDADES } from './modalidades';

interface Formulario {
  productId: number | null; nombre: string; precio: number | null; iva: string;
  tipo: TipoEstudio; modalidad: Modalidad | null; preparacion: string; muestra: string; entregaHoras: number | null;
  parametros: ParametroLab[];
}

/**
 * EL CATÁLOGO DE ESTUDIOS.
 *
 * Cada estudio es un servicio (se cobra en la caja) con su ficha: de
 * laboratorio, con sus parámetros y valores de referencia; o de imagen, con
 * su modalidad. El IVA se elige aquí: un laboratorio o un gabinete privado
 * cobra 16%; los honorarios de un médico persona física son exentos.
 */
@Component({
  selector: 'app-salud-catalogo-estudios',
  standalone: true,
  imports: [CommonModule, FormsModule, WxSelectComponent],
  styleUrls: ['../../modulo-servicios/servicios.css', '../salud.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="srv-pagina">
    <header class="srv-cab">
      <div>
        <h1>Catálogo de estudios</h1>
        <p class="srv-sub">Lo que ofreces, con su precio, su preparación y sus valores de referencia.</p>
      </div>
      <button type="button" class="btn btn-primary" (click)="nuevo()" data-guide="estudios-catalogo-nuevo">
        <i class="ph ph-plus"></i> Nuevo estudio</button>
    </header>
    <p class="srv-error" *ngIf="error()">{{ error() }}</p>

    <div class="srv-tabla-wrap">
      <table class="srv-tabla" data-guide="estudios-catalogo">
        <thead><tr><th>Estudio</th><th>Tipo</th><th>Entrega</th><th>IVA</th><th class="text-end">Precio</th></tr></thead>
        <tbody>
          <tr *ngFor="let e of lista(); trackBy: track" class="srv-fila" tabindex="0" [attr.data-guide-clave]="e.nombre"
              (click)="editar(e)" (keydown.enter)="editar(e)">
            <td><b>{{ e.nombre }}</b><div class="srv-hint" *ngIf="e.tipo === 'LAB'">{{ e.parametros.length }} parámetros</div></td>
            <td>{{ etiquetaTipo(e) }}</td>
            <td>{{ e.entrega_horas != null ? e.entrega_horas + ' h' : '—' }}</td>
            <td>{{ e.iva_exento ? 'Exento' : (e.tasa_iva * 100) + '%' }}</td>
            <td class="text-end">{{ e.precio | currency:'MXN':'symbol-narrow' }}</td>
          </tr>
        </tbody>
      </table>
      <div class="srv-vacio" *ngIf="!cargando() && !lista().length">
        <i class="ph ph-list-checks" style="font-size:2rem"></i>
        <p>Todavía no hay estudios. Empieza por los que más haces.</p>
      </div>
    </div>
  </div>

  <div class="modal fade show d-block srv-modal" role="dialog" aria-modal="true" aria-labelledby="ce-t" *ngIf="form() as f">
    <div class="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable">
      <div class="modal-content rounded-4">
        <div class="modal-header border-0 pb-1">
          <h5 class="modal-title fw-bold m-0" id="ce-t">{{ f.productId ? f.nombre : 'Nuevo estudio' }}</h5>
          <button type="button" class="btn-close" (click)="form.set(null)" aria-label="Cerrar"></button>
        </div>
        <div class="modal-body px-4 pt-1 pb-4">
          <div class="srv-campos">
            <div style="grid-column: 1 / -1">
              <label class="form-label" for="ce-n">Nombre</label>
              <input id="ce-n" class="form-control" [(ngModel)]="f.nombre" placeholder="Biometría hemática, Tele de tórax…" data-guide="estudio-cat-nombre">
            </div>
            <div>
              <label class="form-label" for="ce-tipo">Tipo</label>
              <wx-select id="ce-tipo" [opciones]="opcTipo" [(ngModel)]="f.tipo" data-guide="estudio-cat-tipo"></wx-select>
            </div>
            <div *ngIf="f.tipo === 'IMAGEN'">
              <label class="form-label" for="ce-mod">Modalidad</label>
              <wx-select id="ce-mod" [opciones]="opcModalidad" [(ngModel)]="f.modalidad" data-guide="estudio-cat-modalidad"></wx-select>
            </div>
            <div>
              <label class="form-label" for="ce-p">Precio (con IVA)</label>
              <input id="ce-p" class="form-control" type="number" min="0" step="0.5" [(ngModel)]="f.precio" data-guide="estudio-cat-precio">
            </div>
            <div>
              <label class="form-label" for="ce-iva">IVA</label>
              <wx-select id="ce-iva" [opciones]="opcIva" [(ngModel)]="f.iva" data-guide="estudio-cat-iva"></wx-select>
            </div>
            <div *ngIf="f.tipo === 'LAB'">
              <label class="form-label" for="ce-m">Muestra <span class="srv-opcional">(opcional)</span></label>
              <input id="ce-m" class="form-control" [(ngModel)]="f.muestra" placeholder="Sangre venosa, orina…">
            </div>
            <div>
              <label class="form-label" for="ce-h">Entrega en horas <span class="srv-opcional">(opcional)</span></label>
              <input id="ce-h" class="form-control" type="number" min="0" [(ngModel)]="f.entregaHoras">
            </div>
            <div style="grid-column: 1 / -1">
              <label class="form-label" for="ce-pr">Preparación del paciente <span class="srv-opcional">(opcional)</span></label>
              <input id="ce-pr" class="form-control" [(ngModel)]="f.preparacion" placeholder="Ayuno de 8 horas…">
            </div>
          </div>

          <ng-container *ngIf="f.tipo === 'LAB'">
            <h6 class="mt-4 mb-2">Parámetros y valores de referencia</h6>
            <div class="sl-param-fila srv-hint"><span>Clave</span><span>Nombre</span><span>Unidad</span><span>Mínimo</span><span>Máximo</span><span></span></div>
            <div class="sl-param-fila" *ngFor="let p of f.parametros; let i = index">
              <input class="form-control form-control-sm" [(ngModel)]="p.clave" maxlength="20" [attr.data-guide]="'estudio-param-clave-' + i">
              <input class="form-control form-control-sm" [(ngModel)]="p.nombre" [attr.data-guide]="'estudio-param-nombre-' + i">
              <input class="form-control form-control-sm" [(ngModel)]="p.unidad">
              <input class="form-control form-control-sm" type="number" [(ngModel)]="p.min" [attr.data-guide]="'estudio-param-min-' + i">
              <input class="form-control form-control-sm" type="number" [(ngModel)]="p.max" [attr.data-guide]="'estudio-param-max-' + i">
              <button type="button" class="btn srv-sm" (click)="quitarParametro(i)" aria-label="Quitar parámetro"><i class="ph ph-x"></i></button>
            </div>
            <button type="button" class="btn srv-sm" (click)="agregarParametro()" data-guide="estudio-param-agregar">
              <i class="ph ph-plus"></i> Parámetro</button>
          </ng-container>

          <p class="srv-error" *ngIf="errorForm()">{{ errorForm() }}</p>
          <div class="d-flex justify-content-end gap-2 mt-4">
            <button type="button" class="btn" (click)="form.set(null)">Cancelar</button>
            <button type="button" class="btn btn-primary" (click)="guardar()" [disabled]="guardando()" data-guide="estudio-cat-guardar">
              {{ guardando() ? 'Guardando…' : 'Guardar' }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
  `,
})
export class SaludCatalogoEstudios implements OnInit {
  private readonly salud = inject(SaludService);

  readonly lista = signal<Estudio[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly form = signal<Formulario | null>(null);
  readonly guardando = signal(false);
  readonly errorForm = signal<string | null>(null);

  readonly opcTipo: WxOpcion[] = [{ valor: 'LAB', etiqueta: 'Laboratorio' }, { valor: 'IMAGEN', etiqueta: 'Imagen' }];
  readonly opcModalidad: WxOpcion[] = MODALIDADES.map((m) => ({ valor: m.valor, etiqueta: m.etiqueta }));
  /* Mismo trío que Inventario (0088): 16%, tasa 0 y exento son tres cosas en la factura. */
  readonly opcIva: WxOpcion[] = [
    { valor: '16', etiqueta: '16%', nota: 'Laboratorio o gabinete privado' },
    { valor: '0', etiqueta: '0%' },
    { valor: 'EX', etiqueta: 'Exento', nota: 'Honorarios de un médico persona física' },
  ];

  async ngOnInit(): Promise<void> { await this.cargar(); }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    const r = await this.salud.estudiosCatalogo();
    this.cargando.set(false);
    if (!r.ok) { this.error.set(r.error || 'No se pudo leer el catálogo.'); return; }
    this.error.set(null);
    this.lista.set(r.datos);
  }

  nuevo(): void {
    this.errorForm.set(null);
    this.form.set({
      productId: null, nombre: '', precio: null, iva: '16', tipo: 'LAB', modalidad: null, preparacion: '', muestra: '',
      entregaHoras: 24, parametros: [{ clave: '', nombre: '', unidad: '', min: null, max: null, texto: null }],
    });
  }

  editar(e: Estudio): void {
    this.errorForm.set(null);
    this.form.set({
      productId: e.product_id, nombre: e.nombre, precio: Number(e.precio),
      iva: e.iva_exento ? 'EX' : Number(e.tasa_iva) === 0 ? '0' : '16',
      tipo: e.tipo, modalidad: e.modalidad, preparacion: e.preparacion ?? '', muestra: e.muestra ?? '',
      entregaHoras: e.entrega_horas, parametros: e.parametros.map((p) => ({ ...p })),
    });
  }

  agregarParametro(): void { this.form()!.parametros.push({ clave: '', nombre: '', unidad: '', min: null, max: null, texto: null }); }
  quitarParametro(i: number): void { this.form()!.parametros.splice(i, 1); }

  async guardar(): Promise<void> {
    const f = this.form();
    if (!f || this.guardando()) return;
    if (!f.nombre.trim()) { this.errorForm.set('Escribe el nombre del estudio.'); return; }
    if (f.precio == null || f.precio < 0) { this.errorForm.set('Escribe el precio.'); return; }
    if (f.tipo === 'IMAGEN' && !f.modalidad) { this.errorForm.set('Elige la modalidad.'); return; }
    const parametros = f.tipo === 'LAB'
      ? f.parametros.filter((p) => p.clave?.trim() || p.nombre?.trim())
          .map((p) => ({ ...p, clave: p.clave.trim().toUpperCase(), nombre: p.nombre.trim(), unidad: p.unidad?.trim() || null }))
      : [];
    if (f.tipo === 'LAB' && !parametros.length) { this.errorForm.set('Agrega al menos un parámetro.'); return; }
    this.guardando.set(true);
    const r = await this.salud.guardarEstudio({
      productId: f.productId, nombre: f.nombre.trim(), precio: Number(f.precio),
      tasaIva: f.iva === '16' ? 0.16 : 0, ivaExento: f.iva === 'EX',
      tipo: f.tipo, modalidad: f.tipo === 'IMAGEN' ? f.modalidad : null, preparacion: f.preparacion, muestra: f.muestra,
      entregaHoras: f.entregaHoras, parametros,
    });
    this.guardando.set(false);
    if (!r.ok) { this.errorForm.set(r.error || 'No se pudo guardar.'); return; }
    this.form.set(null);
    await this.cargar();
  }

  etiquetaTipo(e: Estudio): string { return e.tipo === 'LAB' ? 'Laboratorio' : (MODALIDADES.find((m) => m.valor === e.modalidad)?.etiqueta ?? 'Imagen'); }
  track = (_: number, e: Estudio) => e.product_id;
}
