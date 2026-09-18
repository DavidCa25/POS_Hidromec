import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { AuthService, PAQUETES } from '../../services/auth.service';
import { Ausencia, Franja, horaDeFranja, Profesional, ServiciosService } from '../servicios.service';

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
  imports: [CommonModule, FormsModule],
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
            <th class="ta-c" style="width:110px">Comisión</th>
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
                <select class="ctl srv-sm" [(ngModel)]="f.weekday">
                  <option *ngFor="let d of dias; let n = index" [value]="n" [hidden]="n === 0">{{ d }}</option>
                </select>
              </td>
              <td><input class="ctl srv-sm" type="time" [(ngModel)]="f.starts_at"></td>
              <td><input class="ctl srv-sm" type="time" [(ngModel)]="f.ends_at"></td>
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
  `,
  styles: [`
    .prof-color { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex: none; }
  `],
})
export class ServiciosProfesionales {
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

  async editar(p: Profesional | null) {
    const usuarios = await (window as any).electronAPI?.usersList?.();
    const listaUsuarios: any[] = usuarios?.data ?? [];
    const opciones = ['<option value="">Sin usuario de Wybix</option>']
      .concat(listaUsuarios.map(u =>
        `<option value="${u.id}" ${p?.user_id === u.id ? 'selected' : ''}>${u.usuario}</option>`))
      .join('');

    const { value } = await Swal.fire({
      title: p ? 'Editar profesional' : 'Nuevo profesional',
      html: `
        <input id="pr-nombre" class="swal2-input" placeholder="Nombre completo" value="${p?.full_name ?? ''}">
        <input id="pr-puesto" class="swal2-input" placeholder="Puesto: Mecánico, Estilista…" value="${p?.title ?? ''}">
        <input id="pr-tel" class="swal2-input" placeholder="Teléfono" value="${p?.phone ?? ''}">
        <input id="pr-com" class="swal2-input" type="number" min="0" max="100" step="0.01"
               placeholder="Comisión %" value="${p?.default_commission_pct ?? 0}">
        <select id="pr-user" class="swal2-select">${opciones}</select>
        <p style="font-size:12px;color:#617284;margin:8px 12px 0;text-align:left">
          Enlazar un usuario sirve para saber quién atendió. No le da ningún permiso:
          eso lo sigue decidiendo su rol.
        </p>
        <input id="pr-color" class="swal2-input" type="color" value="${p?.color ?? '#45B3C3'}"
               style="height:38px;padding:3px">`,
      focusConfirm: false, showCancelButton: true, confirmButtonText: 'Guardar',
      preConfirm: () => {
        const nombre = (document.getElementById('pr-nombre') as HTMLInputElement)?.value.trim();
        if (!nombre) { Swal.showValidationMessage('Ponle un nombre'); return false; }
        const u = (document.getElementById('pr-user') as HTMLSelectElement)?.value;
        return {
          id: p?.id ?? null, nombre,
          puesto: (document.getElementById('pr-puesto') as HTMLInputElement)?.value.trim() || null,
          telefono: (document.getElementById('pr-tel') as HTMLInputElement)?.value.trim() || null,
          comisionPct: Number((document.getElementById('pr-com') as HTMLInputElement)?.value) || 0,
          usuarioId: u ? Number(u) : null,
          color: (document.getElementById('pr-color') as HTMLInputElement)?.value || null,
        };
      },
    });
    if (!value) return;
    const r = await this.srv.guardarProfesional(value);
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se pudo guardar', text: r.error }); return; }
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

  async nuevaAusencia(p: Profesional) {
    const { value } = await Swal.fire({
      title: 'Ausencia de ' + p.full_name,
      html: `<input id="au-d" class="swal2-input" type="datetime-local">
             <input id="au-h" class="swal2-input" type="datetime-local">
             <input id="au-m" class="swal2-input" placeholder="Motivo: vacaciones, incapacidad…">`,
      focusConfirm: false, showCancelButton: true, confirmButtonText: 'Guardar',
      preConfirm: () => {
        const d = (document.getElementById('au-d') as HTMLInputElement)?.value;
        const h = (document.getElementById('au-h') as HTMLInputElement)?.value;
        if (!d || !h) { Swal.showValidationMessage('Pon las dos fechas'); return false; }
        if (h <= d) { Swal.showValidationMessage('Tiene que terminar después de empezar'); return false; }
        return { profesionalId: p.id, desde: d, hasta: h,
                 motivo: (document.getElementById('au-m') as HTMLInputElement)?.value.trim() || null };
      },
    });
    if (!value) return;
    const r = await this.srv.guardarAusencia(value);
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se pudo guardar', text: r.error }); return; }

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
