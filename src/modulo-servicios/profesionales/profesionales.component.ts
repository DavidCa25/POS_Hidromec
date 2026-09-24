import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { AuthService, PAQUETES } from '../../services/auth.service';
import { Ausencia, Franja, horaDeFranja, Profesional, ServiciosService } from '../servicios.service';
import { WxOpcion, WxSelectComponent } from '../../app/wx-select/wx-select.component';
import { WxTimeComponent } from '../../app/wx-time/wx-time.component';
import { WxDateComponent } from '../../app/wx-date/wx-date.component';
import { hoyLocal } from '../../core';

const DIAS = ['', 'Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/**
 * QUIÉN HACE EL TRABAJO.
 *
 * Un profesional es un dato del negocio, como un proveedor: «Mecánico» o
 * «Estilista» describen un oficio, no un permiso. Enlazarlo con un usuario de
 * Wybix es opcional y no le da acceso a nada: sirve para saber quién atendió y
 * para que vea su propia agenda. Lo que puede hacer lo sigue decidiendo su rol.
 *
 * EL HORARIO ES DE LA SEMANA, NO DE UN DÍA
 * ----------------------------------------
 * Se edita entero porque así se piensa. Y admite varias franjas por día: la
 * comida existe, y un rango único obligaría a decir que el taller abre a las
 * nueve y cierra a las siete de un tirón.
 */
@Component({
  selector: 'app-servicios-profesionales',
  standalone: true,
  imports: [CommonModule, FormsModule, WxSelectComponent, WxTimeComponent, WxDateComponent],
  styleUrls: ['../servicios.css'],
  template: `
  <div class="srv-pagina">
    <header class="srv-cab">
      <div>
        <h1>Profesionales</h1>
        <p class="srv-sub">Quién hace el trabajo, cuándo trabaja y cuánto comisiona.</p>
      </div>
      <button class="btn btn-primary" (click)="editar(null)" *ngIf="puedeAdministrar">
        Nuevo profesional
      </button>
    </header>

    <div class="srv-tabla-wrap">
      <table class="srv-tabla">
        <thead>
          <tr>
            <th>Nombre</th>
            <th style="width:150px">Puesto</th>
            <th style="width:160px">Usuario de Wybix</th>
            <th class="ta-c" style="width:150px" title="Se aplica cuando el servicio no tiene una propia.">Comisión predeterminada</th>
            <th class="ta-c" style="width:130px">Servicios</th>
            <th class="ta-c" style="width:120px">Trabajo abierto</th>
            <th style="width:210px"></th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let p of profesionales(); trackBy: porId" [style.opacity]="p.active ? 1 : .55">
            <td>
              <span style="display:inline-flex;align-items:center;gap:8px">
                <span class="prof-color" [style.background]="p.color || 'var(--wx-edge-strong)'"></span>
                {{ p.full_name }}
              </span>
              <div class="srv-alerta" *ngIf="!p.active">De baja</div>
            </td>
            <td class="srv-dim">{{ p.title || '—' }}</td>
            <td class="srv-dim">{{ p.user_name || 'Sin usuario' }}</td>
            <td class="ta-c mono">{{ p.default_commission_pct }}%</td>
            <td class="ta-c srv-dim">{{ p.services_count === 0 ? 'Todos' : p.services_count }}</td>
            <td class="ta-c mono">{{ p.open_lines }}</td>
            <td style="text-align:right" *ngIf="puedeAdministrar">
              <button class="btn srv-sm" (click)="editar(p)">Editar</button>
              <button class="btn srv-sm" (click)="verHorario(p)">Horario</button>
              <button class="btn srv-sm srv-ghost" (click)="alternar(p)">
                {{ p.active ? 'Dar de baja' : 'Reactivar' }}
              </button>
            </td>
            <td *ngIf="!puedeAdministrar"></td>
          </tr>
        </tbody>
      </table>

      <div class="srv-vacio" *ngIf="!cargando() && profesionales().length === 0">
        <p><b>Todavía no hay nadie dado de alta.</b></p>
        <p class="srv-sub">Añade a quien hace el trabajo. No necesitan usuario de Wybix:
           el mecánico que no toca la caja no necesita credenciales.</p>
        <button class="btn btn-primary" (click)="editar(null)" *ngIf="puedeAdministrar">
          Dar de alta al primero
        </button>
      </div>
    </div>

    <!-- ------------------------------------------------------------ horario -->
    <section class="srv-tarjeta" *ngIf="verHorarioDe() as p">
      <h2>Horario de {{ p.full_name }}</h2>

      <div class="srv-tabla-wrap" style="border:none">
        <table class="srv-tabla">
          <thead>
            <tr><th style="width:140px">Día</th><th style="width:130px">Desde</th>
                <th style="width:130px">Hasta</th><th style="width:60px"></th></tr>
          </thead>
          <tbody>
            <tr *ngFor="let f of franjas(); let i = index">
              <td>
                <wx-select class="wx-sel-compacto" [opciones]="opcDias" [(ngModel)]="f.weekday"></wx-select>
              </td>
              <td><wx-time class="wx-sel-compacto" [(ngModel)]="f.starts_at" [limpiable]="false"></wx-time></td>
              <td><wx-time class="wx-sel-compacto" [(ngModel)]="f.ends_at" [limpiable]="false"></wx-time></td>
              <td><button class="btn srv-sm srv-ghost" (click)="quitarFranja(i)" aria-label="Quitar franja">×</button></td>
            </tr>
            <tr *ngIf="franjas().length === 0">
              <td colspan="4" class="srv-dim" style="padding:16px;text-align:center">
                Sin horario declarado: la agenda no podrá proponer huecos para esta persona.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button class="btn srv-sm" (click)="agregarFranja()">+ Franja</button>
        <button class="btn btn-primary srv-sm" (click)="guardarHorario(p)">Guardar horario</button>
        <button class="btn srv-sm" (click)="nuevaAusencia(p)">+ Ausencia</button>
        <button class="btn srv-sm srv-ghost" (click)="verHorarioDe.set(null)" style="margin-left:auto">Cerrar</button>
      </div>

      <div *ngIf="ausencias().length" style="margin-top:14px">
        <h2 style="font-size:var(--wx-text-sm)">Ausencias</h2>
        <div *ngFor="let a of ausencias()" class="srv-dim"
             style="display:flex;gap:10px;align-items:center;padding:4px 0;font-size:var(--wx-text-sm)">
          <span class="mono">{{ a.starts_at | date:'d MMM HH:mm':undefined:'es-MX' }} → {{ a.ends_at | date:'d MMM HH:mm':undefined:'es-MX' }}</span>
          <span>{{ a.reason || 'Sin motivo' }}</span>
          <button class="btn srv-sm srv-ghost" (click)="borrarAusencia(a, p)" style="margin-left:auto">Quitar</button>
        </div>
      </div>
    </section>
  </div>

  <!-- ---------------------------------------------- alta de profesional -->
  <div class="modal fade show d-block srv-modal" *ngIf="dialogo() === 'profesional'"
       role="dialog" aria-modal="true" aria-labelledby="pr-t">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content rounded-4">
        <div class="modal-header border-0 pb-1">
          <h5 class="modal-title fw-bold m-0" id="pr-t">{{ tituloProfesional }}</h5>
          <button type="button" class="btn-close" (click)="cerrarDialogo()" aria-label="Cerrar"></button>
        </div>
        <div class="modal-body px-4 pt-1 pb-4">

          <div class="srv-campos">
            <div>
              <label class="form-label" for="pr-n">Nombre completo</label>
              <input id="pr-n" class="form-control" [(ngModel)]="form.nombre" placeholder="Quién atiende">
            </div>
            <div>
              <label class="form-label" for="pr-p">Puesto</label>
              <input id="pr-p" class="form-control" [(ngModel)]="form.puesto"
                     placeholder="Mecánico, estilista, técnico…">
            </div>
            <div>
              <label class="form-label" for="pr-t2">Teléfono</label>
              <input id="pr-t2" class="form-control" [(ngModel)]="form.telefono">
            </div>
            <div>
              <label class="form-label" for="pr-c">Comisión predeterminada</label>
              <div class="srv-conunidad">
                <input id="pr-c" class="form-control" type="number" min="0" max="100" step="0.01"
                       [(ngModel)]="form.comisionPct">
                <span class="srv-unidad">%</span>
              </div>
              <div class="hint">La usa un servicio que no tenga la suya.</div>
            </div>
          </div>

          <label class="form-label mt-3" for="pr-u">Usuario de Wybix</label>
          <wx-select id="pr-u" [opciones]="opcUsuarios" placeholder="Sin usuario de Wybix"
                     [(ngModel)]="form.usuarioId"></wx-select>
          <div class="hint">
            Enlazarlo sirve para saber quién atendió. <b>No le da ningún permiso</b>:
            eso lo sigue decidiendo su rol. Un profesional sin usuario es lo normal.
          </div>

          <label class="form-label mt-3" for="pr-col">Color en la agenda</label>
          <input id="pr-col" class="form-control srv-color" type="color" [(ngModel)]="form.color">

          <p class="srv-error" *ngIf="errorModal()" role="alert">{{ errorModal() }}</p>

          <div class="d-flex justify-content-end gap-2 mt-4">
            <button type="button" class="btn btn-outline-secondary" (click)="cerrarDialogo()">Cancelar</button>
            <button type="button" class="btn btn-primary" [disabled]="guardando()"
                    (click)="confirmarProfesional()">{{ guardando() ? 'Guardando…' : 'Guardar' }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ------------------------------------------------------- ausencia -->
  <div class="modal fade show d-block srv-modal" *ngIf="dialogo() === 'ausencia'"
       role="dialog" aria-modal="true" aria-labelledby="au-t">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content rounded-4">
        <div class="modal-header border-0 pb-1">
          <h5 class="modal-title fw-bold m-0" id="au-t">Ausencia de {{ nombreAusencia }}</h5>
          <button type="button" class="btn-close" (click)="cerrarDialogo()" aria-label="Cerrar"></button>
        </div>
        <div class="modal-body px-4 pt-1 pb-4">

          <div class="srv-campos">
            <div>
              <label class="form-label" for="au-d1">Desde el día</label>
              <wx-date id="au-d1" [(ngModel)]="formAusencia.desde" [limpiable]="false"></wx-date>
            </div>
            <div>
              <label class="form-label" for="au-h1">A las</label>
              <wx-time id="au-h1" [(ngModel)]="formAusencia.horaDesde" [limpiable]="false"></wx-time>
            </div>
            <div>
              <label class="form-label" for="au-d2">Hasta el día</label>
              <wx-date id="au-d2" [(ngModel)]="formAusencia.hasta" [limpiable]="false"></wx-date>
            </div>
            <div>
              <label class="form-label" for="au-h2">A las</label>
              <wx-time id="au-h2" [(ngModel)]="formAusencia.horaHasta" [limpiable]="false"></wx-time>
            </div>
          </div>

          <label class="form-label mt-3" for="au-m2">Motivo</label>
          <input id="au-m2" class="form-control" [(ngModel)]="formAusencia.motivo"
                 placeholder="Vacaciones, incapacidad…">
          <div class="hint">Las citas que queden dentro no se cancelan solas: se avisan para llamar.</div>

          <p class="srv-error" *ngIf="errorModal()" role="alert">{{ errorModal() }}</p>

          <div class="d-flex justify-content-end gap-2 mt-4">
            <button type="button" class="btn btn-outline-secondary" (click)="cerrarDialogo()">Cancelar</button>
            <button type="button" class="btn btn-primary" [disabled]="guardando()"
                    (click)="confirmarAusencia()">{{ guardando() ? 'Guardando…' : 'Guardar' }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
  `,
  styles: [`
    .prof-color { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex: none; }
  `],
})
export class ServiciosProfesionales {
  /**
   * Los días, con el número que usa SQL Server: 1 = domingo.
   *
   * No se renumera aquí: `DATEPART(WEEKDAY)` los devuelve así y el horario se
   * guarda con ese número. Traducirlo en la pantalla y no en la base es cómo
   * un horario acaba corrido un día.
   */
  /* Los modales, con el mismo marcado que el resto de Wybix. */
  readonly dialogo = signal<'profesional' | 'ausencia' | null>(null);
  readonly guardando = signal(false);
  readonly errorModal = signal('');
  private editando: Profesional | null = null;
  private ausenciaDe: Profesional | null = null;
  opcUsuarios: WxOpcion[] = [];
  form = {
    nombre: '', puesto: '', telefono: '',
    comisionPct: 0 as number, usuarioId: null as number | null, color: '#45B3C3',
  };
  formAusencia = { desde: '', horaDesde: '09:00', hasta: '', horaHasta: '18:00', motivo: '' };

  get tituloProfesional(): string {
    return this.editando ? 'Editar profesional' : 'Nuevo profesional';
  }
  get nombreAusencia(): string { return this.ausenciaDe?.full_name ?? ''; }

  cerrarDialogo() {
    this.dialogo.set(null);
    this.errorModal.set('');
    this.guardando.set(false);
    this.editando = null;
    this.ausenciaDe = null;
  }

  readonly opcDias = [
    { valor: 1, etiqueta: 'Domingo' }, { valor: 2, etiqueta: 'Lunes' },
    { valor: 3, etiqueta: 'Martes' }, { valor: 4, etiqueta: 'Miércoles' },
    { valor: 5, etiqueta: 'Jueves' }, { valor: 6, etiqueta: 'Viernes' },
    { valor: 7, etiqueta: 'Sábado' },
  ];

  private readonly srv = inject(ServiciosService);
  private readonly auth = inject(AuthService);

  readonly profesionales = signal<Profesional[]>([]);
  readonly cargando = signal(false);
  readonly verHorarioDe = signal<Profesional | null>(null);
  readonly franjas = signal<Franja[]>([]);
  readonly ausencias = signal<Ausencia[]>([]);
  readonly dias = DIAS;

  get puedeAdministrar(): boolean { return this.auth.puede(PAQUETES.SERVICIOS_ADMINISTRAR); }
  porId = (_: number, p: Profesional) => p.id;

  constructor() { void this.cargar(); }

  async cargar() {
    this.cargando.set(true);
    const r = await this.srv.profesionales({ soloActivos: false });
    this.cargando.set(false);
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se pudo cargar', text: r.error }); return; }
    this.profesionales.set(r.datos);
  }

  /**
   * Alta y edición de quien hace el trabajo.
   *
   * La distinción que esta pantalla tiene que dejar clara: PROFESIONAL no es
   * USUARIO. El profesional es quien atiende; el usuario es quien opera Wybix.
   * Enlazarlos sirve para saber quién hizo qué, y no da ni un permiso. Un
   * profesional sin usuario es lo normal, no un dato incompleto.
   */
  async editar(p: Profesional | null) {
    const usuarios = await (window as any).electronAPI?.usersList?.();
    const lista: any[] = usuarios?.data ?? [];
    this.opcUsuarios = [
      { valor: null, etiqueta: 'Sin usuario de Wybix', nota: 'No entra al sistema' },
      ...lista.map(u => ({ valor: u.id, etiqueta: u.usuario ?? '(sin nombre)', nota: u.rol || undefined })),
    ];

    this.editando = p;
    this.form = {
      nombre: p?.full_name ?? '',
      puesto: p?.title ?? '',
      telefono: p?.phone ?? '',
      comisionPct: p?.default_commission_pct ?? 0,
      usuarioId: p?.user_id ?? null,
      color: p?.color ?? '#45B3C3',
    };
    this.errorModal.set('');
    this.dialogo.set('profesional');
  }

  async confirmarProfesional() {
    if (!this.form.nombre.trim()) { this.errorModal.set('Ponle un nombre.'); return; }
    const pct = Number(this.form.comisionPct);
    if (!(pct >= 0 && pct <= 100)) { this.errorModal.set('La comisión va de 0 a 100.'); return; }

    this.guardando.set(true);
    const r = await this.srv.guardarProfesional({
      id: this.editando?.id ?? null,
      nombre: this.form.nombre.trim(),
      puesto: this.form.puesto.trim() || null,
      telefono: this.form.telefono.trim() || null,
      comisionPct: pct,
      usuarioId: this.form.usuarioId ? Number(this.form.usuarioId) : null,
      color: this.form.color || null,
    });
    this.guardando.set(false);
    if (!r.ok) { this.errorModal.set(r.error || 'No se pudo guardar.'); return; }
    this.cerrarDialogo();
    await this.cargar();
  }

  async alternar(p: Profesional) {
    const r = await this.srv.activarProfesional(p.id, !p.active);
    if (!r.ok) {
      /* El mensaje trae el número de trabajos sin terminar: decirlo con la
         cifra delante es más útil que un «no se puede» a secas. */
      await Swal.fire({ icon: 'warning', title: 'Todavía no', text: r.error });
      return;
    }
    await this.cargar();
  }

  async verHorario(p: Profesional) {
    this.verHorarioDe.set(p);
    const r = await this.srv.horario(p.id);
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se pudo cargar', text: r.error }); return; }
    /* El <input type="time"> sólo entiende "HH:MM". Recortar los cinco
       primeros caracteres de lo que llega daba "1970-", y el campo salía
       vacío: el horario guardado parecía perdido cada vez que se abría. */
    this.franjas.set(r.datos.franjas.map(f => ({
      ...f,
      starts_at: horaDeFranja(f.starts_at),
      ends_at: horaDeFranja(f.ends_at),
    })));
    this.ausencias.set(r.datos.ausencias);
  }

  agregarFranja() {
    this.franjas.set([...this.franjas(), { weekday: 2, starts_at: '09:00', ends_at: '18:00' }]);
  }
  quitarFranja(i: number) {
    this.franjas.set(this.franjas().filter((_, n) => n !== i));
  }

  async guardarHorario(p: Profesional) {
    const franjas = this.franjas().map(f => ({
      weekday: Number(f.weekday), startsAt: f.starts_at, endsAt: f.ends_at,
    }));
    const r = await this.srv.guardarHorario(p.id, franjas as any);
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se pudo guardar', text: r.error }); return; }
    await Swal.fire({ icon: 'success', title: 'Horario guardado', timer: 1200, showConfirmButton: false });
    await this.verHorario(p);
  }

  /** Ausencia: vacaciones, incapacidad, un día fuera. */
  nuevaAusencia(p: Profesional) {
    this.ausenciaDe = p;
    const hoy = hoyLocal();
    this.formAusencia = { desde: hoy, horaDesde: '09:00', hasta: hoy, horaHasta: '18:00', motivo: '' };
    this.errorModal.set('');
    this.dialogo.set('ausencia');
  }

  async confirmarAusencia() {
    const p = this.ausenciaDe;
    if (!p) return;
    const a = this.formAusencia;
    if (!a.desde || !a.hasta) { this.errorModal.set('Pon las dos fechas.'); return; }
    const desde = `${a.desde}T${a.horaDesde}`;
    const hasta = `${a.hasta}T${a.horaHasta}`;
    if (hasta <= desde) { this.errorModal.set('Tiene que terminar después de empezar.'); return; }

    const value = { profesionalId: p.id, desde, hasta, motivo: a.motivo.trim() || null };
    this.guardando.set(true);
    const r = await this.srv.guardarAusencia(value);
    this.guardando.set(false);
    if (!r.ok) { this.errorModal.set(r.error || 'No se pudo guardar.'); return; }
    this.cerrarDialogo();

    /* Las citas que quedan dentro NO se cancelan: se avisan. A esas personas
       hay que llamarlas, y decidirlo por el negocio sería peor. */
    const afectadas = r.datos.citasAfectadas ?? [];
    if (afectadas.length) {
      await Swal.fire({
        icon: 'warning',
        title: `${afectadas.length} cita(s) dentro de la ausencia`,
        html: '<p style="font-size:14px">Siguen agendadas. Hay que llamar a estas personas:</p>'
          + '<div style="text-align:left;font-size:13px">'
          + afectadas.map(c => `· ${c.customer_name} — ${new Date(c.starts_at).toLocaleString('es-MX')}`
              + (c.customer_mobile || c.customer_phone ? ` · ${c.customer_mobile || c.customer_phone}` : ''))
              .join('<br>')
          + '</div>',
      });
    }
    await this.verHorario(p);
  }

  async borrarAusencia(a: Ausencia, p: Profesional) {
    const c = await Swal.fire({
      icon: 'question', title: 'Quitar la ausencia',
      text: 'Esas horas vuelven a estar disponibles en la agenda.',
      showCancelButton: true, confirmButtonText: 'Quitar',
    });
    if (!c.isConfirmed) return;
    const r = await this.srv.borrarAusencia(a.id);
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se pudo', text: r.error }); return; }
    await this.verHorario(p);
  }
}
