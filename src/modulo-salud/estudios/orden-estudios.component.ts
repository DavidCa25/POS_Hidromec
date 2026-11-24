import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import Swal from 'sweetalert2';
import { WxSelectComponent, WxOpcion } from '../../app/wx-select/wx-select.component';
import { EstudioOrdenado, OrdenEstudios, ParametroLab, SaludService, edad } from '../salud.service';
import { MisDatosFirmaComponent } from '../profesional/mis-datos-firma.component';
import { BIRADS, MODALIDADES } from './modalidades';

/** Lo que se está capturando de UN estudio. */
interface Captura { valores: Record<string, string>; hallazgos: string; conclusion: string; birads: number | null; }

/**
 * UNA ORDEN DE ESTUDIOS.
 *
 * Cada estudio con su paso siguiente a la mano: marcar tomado, capturar,
 * validar. Lo validado ya no se edita (la base lo impide) y sale con quien
 * lo validó, su cédula y la huella. La orden se entrega cuando todo está
 * validado y se imprime con el membrete del establecimiento.
 *
 * La bandera de un valor fuera de rango la pone la base al guardar; aquí se
 * adelanta mientras se escribe, para que quien captura vea lo raro antes.
 */
@Component({
  selector: 'app-salud-orden-estudios',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, WxSelectComponent, MisDatosFirmaComponent],
  styleUrls: ['../../modulo-servicios/servicios.css', '../salud.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="srv-pagina sl-no-imprimir">
    <a routerLink="/dashboard/salud/estudios" class="srv-dim" style="text-decoration:none"><i class="ph ph-arrow-left"></i> Estudios</a>
    <p class="srv-error" *ngIf="error()">{{ error() }}</p>

    <ng-container *ngIf="orden() as o">
      <header class="srv-cab">
        <div>
          <h1 class="mono">{{ o.folio }}</h1>
          <p class="srv-sub">
            <a [routerLink]="['/dashboard/salud/paciente', o.paciente_id]"><b>{{ o.paciente }}</b></a>
            <span *ngIf="edadDe(o.fecha_nacimiento) !== null"> · {{ edadDe(o.fecha_nacimiento) }} años</span>
            <span *ngIf="o.medico"> · Solicita {{ o.medico }}</span>
            <span *ngIf="o.indicaciones"> · {{ o.indicaciones }}</span>
          </p>
        </div>
        <div class="d-flex gap-2 flex-wrap">
          <button type="button" class="btn" *ngIf="o.orden_id && o.orden_status !== 'ENTREGADA' && o.orden_status !== 'CANCELADA'" (click)="cobrar(o)"
                  data-guide="estudios-cobrar"><i class="ph ph-cash-register"></i> Cobrar</button>
          <button type="button" class="btn" (click)="imprimir()" [disabled]="!validados(o).length" data-guide="estudios-imprimir">
            <i class="ph ph-printer"></i> Imprimir resultados</button>
          <button type="button" class="btn btn-primary" *ngIf="o.estado === 'LISTA'" (click)="entregar(o)" data-guide="estudios-entregar">
            <i class="ph ph-hand-arrow-up"></i> Entregar</button>
          <span class="srv-badge srv-badge--mute" *ngIf="o.estado === 'ENTREGADA'">Entregada {{ o.entregado_at | date:'dd/MM/yyyy HH:mm' }}</span>
        </div>
      </header>

      <section class="sl-estudio" *ngFor="let it of o.items; trackBy: track" [attr.data-guide-clave]="it.nombre" [attr.data-guide-estado]="it.estado">
        <div class="sl-estudio__cab">
          <h3>{{ it.nombre }}</h3>
          <span class="srv-hint">{{ etiquetaTipo(it) }}</span>
          <span class="srv-badge" [ngClass]="claseEstado(it.estado)">{{ textoEstado(it.estado) }}</span>
          <div class="ms-auto d-flex gap-2" *ngIf="abierta(o)">
            <button type="button" class="btn srv-sm" *ngIf="it.estado === 'SOLICITADO'" (click)="tomado(it)" data-guide="estudio-tomado">
              <i class="ph ph-syringe"></i> {{ it.tipo === 'LAB' ? 'Muestra tomada' : 'Estudio realizado' }}</button>
            <button type="button" class="btn srv-sm" *ngIf="puedeCapturar(it) && capturando() !== it.id" (click)="empezarCaptura(it)"
                    data-guide="estudio-capturar"><i class="ph ph-pencil-simple"></i> {{ it.estado === 'CAPTURADO' ? 'Corregir' : 'Capturar' }}</button>
            <button type="button" class="btn btn-primary srv-sm" *ngIf="it.estado === 'CAPTURADO' && capturando() !== it.id" (click)="validar(it)"
                    data-guide="estudio-validar"><i class="ph ph-seal-check"></i> Validar</button>
            <button type="button" class="btn srv-sm srv-danger" *ngIf="it.estado !== 'VALIDADO' && it.estado !== 'CANCELADO'" (click)="cancelar(it)">
              Cancelar</button>
          </div>
        </div>

        <!-- -------- captura -->
        <ng-container *ngIf="capturando() === it.id && captura as c">
          <table class="sl-resultados" *ngIf="it.tipo === 'LAB'">
            <thead><tr><th>Parámetro</th><th>Resultado</th><th>Unidad</th><th>Referencia</th></tr></thead>
            <tbody>
              <tr *ngFor="let p of it.parametros">
                <td>{{ p.nombre }}</td>
                <td><input class="form-control form-control-sm" [(ngModel)]="c.valores[p.clave]" [class.sl-fuera]="!!bandera(p, c.valores[p.clave])"
                           [attr.data-guide]="'estudio-valor-' + p.clave" inputmode="decimal"></td>
                <td>{{ p.unidad || '' }}</td>
                <td>{{ referencia(p) }} <span class="sl-fuera" *ngIf="bandera(p, c.valores[p.clave]) as b">{{ b === 'A' ? '▲ alto' : '▼ bajo' }}</span></td>
              </tr>
            </tbody>
          </table>
          <div *ngIf="it.tipo === 'IMAGEN'" class="mt-2">
            <label class="form-label" [for]="'hal-' + it.id">Hallazgos</label>
            <textarea class="form-control" rows="5" [id]="'hal-' + it.id" [(ngModel)]="c.hallazgos" data-guide="estudio-hallazgos"></textarea>
            <label class="form-label mt-2" [for]="'con-' + it.id">Conclusión</label>
            <textarea class="form-control" rows="2" [id]="'con-' + it.id" [(ngModel)]="c.conclusion" data-guide="estudio-conclusion"></textarea>
            <ng-container *ngIf="it.modalidad === 'MASTOGRAFIA'">
              <label class="form-label mt-2" [for]="'bi-' + it.id">BI-RADS</label>
              <wx-select [id]="'bi-' + it.id" [opciones]="opcBirads" [(ngModel)]="c.birads" data-guide="estudio-birads"></wx-select>
            </ng-container>
          </div>
          <div class="d-flex justify-content-end gap-2 mt-3">
            <button type="button" class="btn" (click)="capturando.set(null)">Cancelar</button>
            <button type="button" class="btn btn-primary" (click)="guardarCaptura(it)" [disabled]="ocupado()" data-guide="estudio-guardar">
              Guardar resultado</button>
          </div>
        </ng-container>

        <!-- -------- resultado guardado -->
        <ng-container *ngIf="capturando() !== it.id && (it.estado === 'CAPTURADO' || it.estado === 'VALIDADO')">
          <table class="sl-resultados" *ngIf="it.tipo === 'LAB'">
            <thead><tr><th>Parámetro</th><th>Resultado</th><th>Unidad</th><th>Referencia</th></tr></thead>
            <tbody>
              <tr *ngFor="let r of it.resultados">
                <td>{{ parametro(it, r.clave)?.nombre || r.clave }}</td>
                <td [class.sl-fuera]="!!r.bandera">{{ r.valor }} {{ r.bandera === 'A' ? '▲' : r.bandera === 'B' ? '▼' : '' }}</td>
                <td>{{ parametro(it, r.clave)?.unidad || '' }}</td>
                <td>{{ referenciaDe(it, r.clave) }}</td>
              </tr>
            </tbody>
          </table>
          <div *ngIf="it.tipo === 'IMAGEN'" class="mt-2">
            <p *ngIf="it.hallazgos" style="white-space: pre-line"><b>Hallazgos.</b> {{ it.hallazgos }}</p>
            <p *ngIf="it.conclusion"><b>Conclusión.</b> {{ it.conclusion }}</p>
            <p *ngIf="it.birads !== null"><b>BI-RADS {{ it.birads }}</b> · {{ textoBirads(it.birads) }}</p>
          </div>
          <p class="srv-hint m-0" *ngIf="it.estado === 'VALIDADO'">
            <i class="ph ph-seal-check"></i> Validó {{ it.firmante?.nombre || it.validado_por }}
            <ng-container *ngIf="it.firmante?.cedula"> · Céd. Prof. {{ it.firmante?.cedula }}</ng-container>
            · {{ it.validado_at | date:'dd/MM/yyyy HH:mm' }}</p>
        </ng-container>
      </section>
    </ng-container>
  </div>

  <app-salud-mis-datos *ngIf="pedirCedula() as item" (cerrar)="pedirCedula.set(null)" (guardados)="validar(item)"></app-salud-mis-datos>

  <!-- ======================================================= IMPRESIÓN -->
  <div class="sl-imprimible sl-solo-impresion" *ngIf="orden() as o">
    <ng-container *ngFor="let it of validados(o); let primero = first">
      <div [style.page-break-before]="primero ? 'auto' : 'always'">
        <header class="sl-membrete" *ngIf="it.firmante as fm">
          <div class="sl-membrete__donde" style="text-align:left">
            <b *ngIf="fm.establecimiento">{{ fm.establecimiento }}</b>
            <span *ngIf="fm.domicilio">{{ fm.domicilio }}</span>
            <span *ngIf="fm.telefono">Tel. {{ fm.telefono }}</span>
          </div>
          <div class="sl-membrete__donde">
            <b>{{ o.folio }}</b>
            <span>{{ it.validado_at | date:'dd/MM/yyyy HH:mm' }}</span>
          </div>
        </header>
        <p><b>Paciente:</b> {{ o.paciente }}<ng-container *ngIf="edadDe(o.fecha_nacimiento) !== null"> · {{ edadDe(o.fecha_nacimiento) }} años</ng-container>
          <ng-container *ngIf="o.medico"> · <b>Solicita:</b> {{ o.medico }}</ng-container></p>
        <h2>{{ it.nombre }}</h2>
        <table class="sl-resultados" *ngIf="it.tipo === 'LAB'">
          <thead><tr><th>Parámetro</th><th>Resultado</th><th>Unidad</th><th>Valores de referencia</th></tr></thead>
          <tbody>
            <tr *ngFor="let r of it.resultados">
              <td>{{ parametro(it, r.clave)?.nombre || r.clave }}</td>
              <td [class.sl-fuera]="!!r.bandera"><b *ngIf="r.bandera; else normal">{{ r.valor }} {{ r.bandera === 'A' ? '(alto)' : '(bajo)' }}</b>
                <ng-template #normal>{{ r.valor }}</ng-template></td>
              <td>{{ parametro(it, r.clave)?.unidad || '' }}</td>
              <td>{{ referenciaDe(it, r.clave) }}</td>
            </tr>
          </tbody>
        </table>
        <ng-container *ngIf="it.tipo === 'IMAGEN'">
          <p *ngIf="it.hallazgos" style="white-space: pre-line"><b>Hallazgos.</b> {{ it.hallazgos }}</p>
          <p *ngIf="it.conclusion"><b>Conclusión.</b> {{ it.conclusion }}</p>
          <p *ngIf="it.birads !== null"><b>BI-RADS {{ it.birads }}</b> · {{ textoBirads(it.birads) }}</p>
        </ng-container>
        <p style="margin-top: 30mm">______________________________<br>{{ it.firmante?.nombre }}
          <ng-container *ngIf="it.firmante?.especialidad"><br>{{ it.firmante?.especialidad }}</ng-container>
          <br>Céd. Prof. {{ it.firmante?.cedula }}<ng-container *ngIf="it.firmante?.cedula_especialidad"> · Céd. Esp. {{ it.firmante?.cedula_especialidad }}</ng-container></p>
        <p class="sl-huella">Huella {{ it.huella }}</p>
      </div>
    </ng-container>
  </div>
  `,
})
export class SaludOrdenEstudios implements OnInit {
  private readonly salud = inject(SaludService);
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly orden = signal<OrdenEstudios | null>(null);
  readonly error = signal<string | null>(null);
  readonly capturando = signal<number | null>(null);
  readonly ocupado = signal(false);
  readonly pedirCedula = signal<EstudioOrdenado | null>(null);
  readonly opcBirads: WxOpcion[] = BIRADS.map((b) => ({ valor: b.valor, etiqueta: b.etiqueta }));
  captura: Captura | null = null;
  private id = 0;

  async ngOnInit(): Promise<void> {
    this.id = Number(this.ruta.snapshot.paramMap.get('id'));
    await this.cargar();
  }

  async cargar(): Promise<void> {
    const r = await this.salud.ordenesEstudios({ id: this.id });
    if (!r.ok) { this.error.set(r.error || 'No se pudo abrir la orden.'); return; }
    const o = r.datos[0] ?? null;
    if (!o) { this.error.set('La orden no existe.'); return; }
    this.error.set(null);
    this.orden.set(o);
  }

  abierta(o: OrdenEstudios): boolean { return o.estado === 'ABIERTA' || o.estado === 'LISTA'; }
  puedeCapturar(it: EstudioOrdenado): boolean { return ['SOLICITADO', 'TOMADO', 'CAPTURADO'].includes(it.estado); }
  validados(o: OrdenEstudios): EstudioOrdenado[] { return o.items.filter((i) => i.estado === 'VALIDADO'); }

  async tomado(it: EstudioOrdenado): Promise<void> {
    const r = await this.salud.estadoEstudio(it.id, 'TOMADO');
    if (!r.ok) { this.error.set(r.error || 'No se pudo marcar.'); return; }
    await this.cargar();
  }

  async cancelar(it: EstudioOrdenado): Promise<void> {
    const q = await Swal.fire({
      icon: 'warning', title: `Cancelar «${it.nombre}»`, text: 'El estudio ya no se hará. La orden de servicio no cambia: ajusta el cobro en la caja si hace falta.',
      showCancelButton: true, confirmButtonText: 'Cancelar estudio', cancelButtonText: 'No',
    });
    if (!q.isConfirmed) return;
    const r = await this.salud.estadoEstudio(it.id, 'CANCELADO');
    if (!r.ok) { this.error.set(r.error || 'No se pudo cancelar.'); return; }
    await this.cargar();
  }

  empezarCaptura(it: EstudioOrdenado): void {
    const valores: Record<string, string> = {};
    for (const r of it.resultados ?? []) valores[r.clave] = r.valor;
    this.captura = { valores, hallazgos: it.hallazgos ?? '', conclusion: it.conclusion ?? '', birads: it.birads };
    this.capturando.set(it.id);
  }

  async guardarCaptura(it: EstudioOrdenado): Promise<void> {
    if (!this.captura || this.ocupado()) return;
    this.ocupado.set(true);
    const c = this.captura;
    const r = await this.salud.capturarEstudio(it.tipo === 'LAB'
      ? { itemId: it.id, resultados: it.parametros.map((p) => ({ clave: p.clave, valor: String(c.valores[p.clave] ?? '').trim() })).filter((x) => x.valor) }
      : { itemId: it.id, hallazgos: c.hallazgos, conclusion: c.conclusion, birads: c.birads });
    this.ocupado.set(false);
    if (!r.ok) { this.error.set(r.error || 'No se pudo guardar el resultado.'); return; }
    this.capturando.set(null);
    this.captura = null;
    await this.cargar();
  }

  async validar(it: EstudioOrdenado): Promise<void> {
    if (this.ocupado()) return;
    this.ocupado.set(true);
    const r = await this.salud.validarEstudio(it.id);
    this.ocupado.set(false);
    if (!r.ok) {
      if (r.motivo === 'SIN_CEDULA') { this.pedirCedula.set(it); return; }
      this.error.set(r.error || 'No se pudo validar.');
      return;
    }
    this.pedirCedula.set(null);
    await this.cargar();
  }

  async entregar(o: OrdenEstudios): Promise<void> {
    const r = await this.salud.entregarEstudios(o.id);
    if (!r.ok) { this.error.set(r.error || 'No se pudo entregar.'); return; }
    await this.cargar();
  }

  cobrar(o: OrdenEstudios): void {
    void this.router.navigate(['/dashboard/venta'], { queryParams: { ordenServicio: o.orden_id } });
  }

  imprimir(): void { setTimeout(() => window.print(), 30); }

  /** La misma regla que sp_salud_estudio_capturar, para avisar mientras se escribe. */
  bandera(p: ParametroLab, valor: string | undefined): 'A' | 'B' | null {
    const v = Number(String(valor ?? '').replace(',', '.'));
    if (valor == null || String(valor).trim() === '' || !Number.isFinite(v)) return null;
    if (p.max != null && v > Number(p.max)) return 'A';
    if (p.min != null && v < Number(p.min)) return 'B';
    return null;
  }
  referencia(p: ParametroLab | undefined): string {
    if (!p) return '';
    if (p.texto) return p.texto;
    if (p.min != null && p.max != null) return `${p.min} – ${p.max}`;
    if (p.min != null) return `≥ ${p.min}`;
    if (p.max != null) return `≤ ${p.max}`;
    return '';
  }
  parametro(it: EstudioOrdenado, clave: string): ParametroLab | undefined { return it.parametros.find((p) => p.clave === clave); }
  referenciaDe(it: EstudioOrdenado, clave: string): string { return this.referencia(this.parametro(it, clave)); }
  textoBirads(n: number | null): string { return BIRADS.find((b) => b.valor === n)?.etiqueta.split('·')[1]?.trim() ?? ''; }
  etiquetaTipo(it: EstudioOrdenado): string {
    return it.tipo === 'LAB' ? 'Laboratorio' : (MODALIDADES.find((m) => m.valor === it.modalidad)?.etiqueta ?? 'Imagen');
  }
  textoEstado(e: string): string {
    return ({ SOLICITADO: 'Solicitado', TOMADO: 'Tomado', CAPTURADO: 'Por validar', VALIDADO: 'Validado', CANCELADO: 'Cancelado' } as Record<string, string>)[e] ?? e;
  }
  claseEstado(e: string): string {
    return ({ SOLICITADO: 'srv-badge--mute', TOMADO: 'srv-badge--info', CAPTURADO: 'srv-badge--warn', VALIDADO: 'srv-badge--ok', CANCELADO: 'srv-badge--mute' } as Record<string, string>)[e] ?? '';
  }
  edadDe = edad;
  track = (_: number, it: EstudioOrdenado) => it.id;
}
