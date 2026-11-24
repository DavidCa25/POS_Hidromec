import { ChangeDetectionStrategy, Component, EventEmitter, OnInit, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SaludService } from '../salud.service';

/**
 * MIS DATOS DE FIRMA.
 *
 * Una receta lleva el nombre de quien la expide, su cédula profesional y la
 * institución que expidió el título; si hay especialidad, también su cédula
 * (Reglamento de Insumos para la Salud, art. 29). Un resultado de laboratorio
 * o de imagen lo valida un profesional con cédula.
 *
 * Cada persona captura LOS SUYOS: la cédula es de la persona, no del
 * negocio. Al firmar se copian al documento; cambiarlos después no altera
 * lo ya firmado.
 */
@Component({
  selector: 'app-salud-mis-datos',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrls: ['../../modulo-servicios/servicios.css', '../salud.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="modal fade show d-block srv-modal" role="dialog" aria-modal="true" aria-labelledby="md-t">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content rounded-4">
        <div class="modal-header border-0 pb-1">
          <h5 class="modal-title fw-bold m-0" id="md-t">Mis datos de firma</h5>
          <button type="button" class="btn-close" (click)="cerrar.emit()" aria-label="Cerrar"></button>
        </div>
        <div class="modal-body px-4 pt-1 pb-4">
          <p class="srv-paso">Salen en tus recetas y en los resultados que valides. Lo que ya firmaste no cambia.</p>
          <p class="srv-paso" *ngIf="cargando()">Cargando…</p>
          <div class="srv-campos" *ngIf="!cargando()">
            <div style="grid-column: 1 / -1">
              <label class="form-label" for="md-n">Nombre completo, como aparece en tu título</label>
              <input id="md-n" class="form-control" [(ngModel)]="f.nombre" autocomplete="off" data-guide="salud-firma-nombre">
            </div>
            <div>
              <label class="form-label" for="md-c">Cédula profesional</label>
              <input id="md-c" class="form-control" [(ngModel)]="f.cedula" inputmode="numeric" maxlength="20" data-guide="salud-firma-cedula">
            </div>
            <div>
              <label class="form-label" for="md-i">Institución que expidió el título</label>
              <input id="md-i" class="form-control" [(ngModel)]="f.institucion" placeholder="UNAM, IPN, UANL…" data-guide="salud-firma-institucion">
            </div>
            <div>
              <label class="form-label" for="md-e">Especialidad <span class="srv-opcional">(opcional)</span></label>
              <input id="md-e" class="form-control" [(ngModel)]="f.especialidad" placeholder="Pediatría, Radiología…">
            </div>
            <div>
              <label class="form-label" for="md-ce">Cédula de especialidad <span class="srv-opcional">(opcional)</span></label>
              <input id="md-ce" class="form-control" [(ngModel)]="f.cedulaEspecialidad" inputmode="numeric" maxlength="20">
            </div>
          </div>
          <p class="srv-error" *ngIf="error()">{{ error() }}</p>
          <div class="d-flex justify-content-end gap-2 mt-4">
            <button type="button" class="btn" (click)="cerrar.emit()">Cancelar</button>
            <button type="button" class="btn btn-primary" (click)="guardar()" [disabled]="guardando() || cargando()" data-guide="salud-firma-guardar">
              {{ guardando() ? 'Guardando…' : 'Guardar' }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
  `,
})
export class MisDatosFirmaComponent implements OnInit {
  private readonly salud = inject(SaludService);
  @Output() cerrar = new EventEmitter<void>();
  @Output() guardados = new EventEmitter<void>();

  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  f = { nombre: '', cedula: '', institucion: '', especialidad: '', cedulaEspecialidad: '' };

  async ngOnInit(): Promise<void> {
    const r = await this.salud.profesional();
    const p = r.datos;
    if (p) {
      this.f = {
        nombre: p.nombre ?? '', cedula: p.cedula ?? '', institucion: p.institucion ?? '',
        especialidad: p.especialidad ?? '', cedulaEspecialidad: p.cedula_especialidad ?? '',
      };
    }
    this.cargando.set(false);
  }

  async guardar(): Promise<void> {
    if (this.guardando()) return;
    if (!this.f.nombre.trim()) { this.error.set('Escribe tu nombre completo.'); return; }
    if (!/^[0-9A-Za-z-]{5,20}$/.test(this.f.cedula.replace(/\s/g, ''))) {
      this.error.set('La cédula profesional tiene de 5 a 20 letras o números.');
      return;
    }
    this.guardando.set(true);
    const r = await this.salud.guardarProfesional(this.f);
    this.guardando.set(false);
    if (!r.ok) { this.error.set(r.error || 'No se pudieron guardar tus datos.'); return; }
    this.guardados.emit();
    this.cerrar.emit();
  }
}
