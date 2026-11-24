import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WxSelectComponent, WxOpcion } from '../../app/wx-select/wx-select.component';
import { WxDateComponent } from '../../app/wx-date/wx-date.component';
import { Antecedentes, FichaPaciente, SaludService, hoyIso } from '../salud.service';

export interface FichaGuardada { customerId: number; }

/**
 * LA FICHA DEL PACIENTE: alta y edición, en un solo diálogo.
 *
 * El consentimiento para tratar sus datos de salud se pide aquí, al dar de
 * alta, porque sin él no se escribe nada clínico (LFPDPPP 2025: datos
 * sensibles, consentimiento expreso). Una vez dado, se queda con su fecha.
 *
 * `version` viaja de ida y vuelta: si otro cambió la ficha mientras tanto,
 * la base no la pisa y aquí se dice.
 */
@Component({
  selector: 'app-salud-ficha-paciente',
  standalone: true,
  imports: [CommonModule, FormsModule, WxSelectComponent, WxDateComponent],
  styleUrls: ['../../modulo-servicios/servicios.css', '../salud.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="modal fade show d-block srv-modal" role="dialog" aria-modal="true" aria-labelledby="fp-t">
    <div class="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable">
      <div class="modal-content rounded-4">
        <div class="modal-header border-0 pb-1">
          <h5 class="modal-title fw-bold m-0" id="fp-t">{{ ficha ? 'Ficha de ' + f.nombre : 'Nuevo paciente' }}</h5>
          <button type="button" class="btn-close" (click)="cerrar.emit()" aria-label="Cerrar"></button>
        </div>
        <div class="modal-body px-4 pt-1 pb-4">
          <div class="srv-campos">
            <div style="grid-column: 1 / -1">
              <label class="form-label" for="fp-n">Nombre completo</label>
              <input id="fp-n" class="form-control" [(ngModel)]="f.nombre" data-guide="salud-pac-nombre" autocomplete="off">
            </div>
            <div>
              <label class="form-label" for="fp-fn">Fecha de nacimiento</label>
              <wx-date id="fp-fn" [(ngModel)]="f.fechaNacimiento" [max]="hoy" data-guide="salud-pac-nacimiento"></wx-date>
            </div>
            <div>
              <label class="form-label" for="fp-s">Sexo</label>
              <wx-select id="fp-s" [opciones]="opcSexo" [(ngModel)]="f.sexo" data-guide="salud-pac-sexo"></wx-select>
            </div>
            <div>
              <label class="form-label" for="fp-t2">Teléfono</label>
              <input id="fp-t2" class="form-control" [(ngModel)]="f.telefono" inputmode="tel" data-guide="salud-pac-telefono">
            </div>
            <div>
              <label class="form-label" for="fp-c">CURP <span class="srv-opcional">(opcional)</span></label>
              <input id="fp-c" class="form-control text-uppercase" maxlength="18" [(ngModel)]="f.curp">
            </div>
            <div>
              <label class="form-label" for="fp-e">Correo <span class="srv-opcional">(opcional)</span></label>
              <input id="fp-e" class="form-control" type="email" [(ngModel)]="f.email">
            </div>
            <div>
              <label class="form-label" for="fp-g">Grupo sanguíneo <span class="srv-opcional">(opcional)</span></label>
              <wx-select id="fp-g" [opciones]="opcGrupo" [(ngModel)]="f.grupoSanguineo"></wx-select>
            </div>
            <div style="grid-column: 1 / -1">
              <label class="form-label" for="fp-a">Alergias</label>
              <input id="fp-a" class="form-control" [(ngModel)]="f.alergias" placeholder="Penicilina, sulfas… (vacío si no tiene)"
                     data-guide="salud-pac-alergias">
            </div>
            <div>
              <label class="form-label" for="fp-tu">Tutor <span class="srv-opcional">(si es menor)</span></label>
              <input id="fp-tu" class="form-control" [(ngModel)]="f.tutor">
            </div>
            <div>
              <label class="form-label" for="fp-ce">Contacto de emergencia</label>
              <input id="fp-ce" class="form-control" [(ngModel)]="f.contactoEmergencia" placeholder="Nombre y teléfono">
            </div>
          </div>

          <details class="mt-3" [open]="!!ficha">
            <summary class="form-label">Antecedentes</summary>
            <div class="srv-campos mt-2">
              <div *ngFor="let a of camposAntecedentes">
                <label class="form-label" [for]="'fp-an-' + a.clave">{{ a.texto }}</label>
                <textarea class="form-control" rows="2" [id]="'fp-an-' + a.clave" [(ngModel)]="f.antecedentes[a.clave]"></textarea>
              </div>
            </div>
          </details>

          <div class="srv-alta" *ngIf="!ficha?.consentimiento_at">
            <label class="d-inline-flex align-items-start gap-2">
              <input type="checkbox" [(ngModel)]="f.consentimiento" data-guide="salud-pac-consentimiento" style="margin-top: 4px">
              <span>El paciente (o su tutor) <b>autoriza por escrito</b> el tratamiento de sus datos de salud conforme al
                aviso de privacidad del consultorio. Sin esta autorización no se puede escribir su expediente.</span>
            </label>
          </div>
          <p class="srv-paso mt-3" *ngIf="ficha?.consentimiento_at">
            <i class="ph ph-seal-check"></i> Consentimiento registrado el {{ ficha?.consentimiento_at | date:'dd/MM/yyyy' }}.
          </p>

          <p class="srv-error" *ngIf="error()">{{ error() }}</p>
          <div class="d-flex justify-content-end gap-2 mt-4">
            <button type="button" class="btn" (click)="cerrar.emit()">Cancelar</button>
            <button type="button" class="btn btn-primary" (click)="guardar()" [disabled]="guardando()" data-guide="salud-pac-guardar">
              {{ guardando() ? 'Guardando…' : (ficha ? 'Guardar cambios' : 'Dar de alta') }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
  `,
})
export class FichaPacienteComponent implements OnInit {
  private readonly salud = inject(SaludService);

  /** null = alta. Con ficha, edición. */
  @Input() customerId: number | null = null;
  @Input() ficha: FichaPaciente | null = null;
  @Output() cerrar = new EventEmitter<void>();
  @Output() guardada = new EventEmitter<FichaGuardada>();

  readonly hoy = hoyIso();
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);

  readonly opcSexo: WxOpcion[] = [
    { valor: 'F', etiqueta: 'Mujer' }, { valor: 'M', etiqueta: 'Hombre' }, { valor: 'X', etiqueta: 'Otro / prefiere no decir' },
  ];
  readonly opcGrupo: WxOpcion[] = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'].map((g) => ({ valor: g, etiqueta: g }));
  readonly camposAntecedentes: { clave: keyof Antecedentes; texto: string }[] = [
    { clave: 'heredofamiliares', texto: 'Heredofamiliares' },
    { clave: 'patologicos', texto: 'Personales patológicos' },
    { clave: 'noPatologicos', texto: 'Personales no patológicos' },
    { clave: 'ginecoObstetricos', texto: 'Gineco-obstétricos' },
    { clave: 'medicamentos', texto: 'Medicamentos que toma' },
  ];

  f = {
    nombre: '', telefono: '', email: '', fechaNacimiento: '', curp: '', sexo: null as string | null,
    tutor: '', contactoEmergencia: '', grupoSanguineo: null as string | null, alergias: '',
    antecedentes: {} as Antecedentes, consentimiento: false,
  };

  ngOnInit(): void {
    const x = this.ficha;
    if (!x) return;
    this.f = {
      nombre: x.nombre ?? '', telefono: x.telefono ?? '', email: x.email ?? '',
      fechaNacimiento: x.fecha_nacimiento ? String(x.fecha_nacimiento).slice(0, 10) : '',
      curp: x.curp ?? '', sexo: x.sexo, tutor: x.tutor ?? '', contactoEmergencia: x.contacto_emergencia ?? '',
      grupoSanguineo: x.grupo_sanguineo, alergias: x.alergias ?? '', antecedentes: { ...(x.antecedentes ?? {}) },
      consentimiento: !!x.consentimiento_at,
    };
  }

  async guardar(): Promise<void> {
    if (this.guardando()) return;
    if (!this.f.nombre.trim()) { this.error.set('Escribe el nombre del paciente.'); return; }
    if (!this.ficha?.consentimiento_at && !this.f.consentimiento) {
      this.error.set('Sin la autorización del paciente no se puede abrir su expediente.');
      return;
    }
    this.guardando.set(true);
    const limpios = Object.fromEntries(Object.entries(this.f.antecedentes).filter(([, v]) => String(v ?? '').trim()));
    const r = await this.salud.guardarPaciente({
      ...this.f,
      customerId: this.customerId ?? this.ficha?.customer_id ?? null,
      curp: this.f.curp.trim().toUpperCase(),
      antecedentes: Object.keys(limpios).length ? limpios : null,
      version: this.ficha?.version ?? null,
    });
    this.guardando.set(false);
    if (!r.ok || !r.datos) { this.error.set(r.error || 'No se pudo guardar la ficha.'); return; }
    this.guardada.emit({ customerId: r.datos });
  }
}
