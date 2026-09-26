import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';

interface Capacidad { id: string; nombre: string; disponible: boolean; aplicaWybix: boolean; motivo: string | null; detalle: string; }
interface Auditoria {
  windows: { nombre: string; edicion: string; build: string; version: string; usuario: string; enAdministradores: boolean; elevado: boolean };
  capacidades: Capacidad[];
  activo: boolean;
  rutas: { respaldo: string; restaurarManual: string };
  bloquea: string[];
  ejecutable: string;
  sandbox: boolean;
  estado: { aplicadoEn?: string; permitidos?: string[]; respaldo?: string; restaurarManual?: string } | null;
}

/**
 * MODO TERMINAL.
 *
 * Primero se AUDITA -que Windows es, que cuenta, que se puede hacer aqui- y
 * se explica que se bloqueara. Activar pide una confirmacion explicita y el
 * permiso de administrador de Windows. Restaurar esta siempre a un boton, y
 * ademas queda un script para hacerlo sin Wybix.
 */
@Component({
  selector: 'app-modo-terminal-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrls: ['../panel-controls.css'],
  template: `
  <div class="panel-content mt">
    <div class="section-title"><i class="ph ph-lock-key"></i> Modo terminal</div>
    <p class="hint">Usar este equipo solo para operar: desde el escritorio solo se abren las aplicaciones permitidas.
      Se hace con directivas oficiales de Windows, con respaldo y vuelta atrás.</p>

    <p class="mt-aviso" *ngIf="cargando">Revisando Windows…</p>
    <p class="mt-aviso mt-aviso--mal" *ngIf="error">{{ error }}</p>

    <ng-container *ngIf="a">
      <span class="mt-arenero" *ngIf="a.sandbox">Modo de prueba: se escribe en un arenero, no en Windows.</span>

      <!-- ----------------------------------------------------- este equipo -->
      <div class="mt-equipo">
        <div><small>Windows</small><b>{{ a.windows.nombre }}</b><span>{{ a.windows.version }} · build {{ a.windows.build }}</span></div>
        <div><small>Cuenta</small><b>{{ a.windows.usuario }}</b>
          <span>{{ a.windows.enAdministradores ? 'Administrador' : 'Usuario estándar' }}</span></div>
      </div>

      <!-- ------------------------------------------------ que hay aqui -->
      <div class="section-title" style="margin-top:1.1rem;"><i class="ph ph-list-checks"></i> Lo que permite este Windows</div>
      <ul class="mt-caps">
        <li *ngFor="let c of a.capacidades" [class.no]="!c.disponible">
          <i class="ph" [class.ph-check-circle]="c.disponible" [class.ph-minus-circle]="!c.disponible" aria-hidden="true"></i>
          <span>
            <b>{{ c.nombre }}</b> <em *ngIf="c.aplicaWybix">· lo aplica Wybix</em>
            <small>{{ c.disponible ? c.detalle : c.motivo }}</small>
          </span>
        </li>
      </ul>

      <!-- --------------------------------------------------------- activo -->
      <div class="mt-activo" *ngIf="a.activo">
        <b><i class="ph ph-lock-key"></i> Activo en esta cuenta</b>
        <span *ngIf="a.estado?.aplicadoEn">Desde {{ a.estado?.aplicadoEn | date:'d MMM y, HH:mm' }}</span>
        <span *ngIf="a.estado?.permitidos?.length">Permitidas: {{ a.estado?.permitidos?.join(', ') }}</span>
        <span>Respaldo: <code>{{ a.rutas.respaldo }}</code></span>
        <span>Si Wybix no abriera, un administrador puede ejecutar <code>{{ a.rutas.restaurarManual }}</code> desde otra cuenta.</span>
        <button type="button" class="btn-primary mt-btn" (click)="restaurar()" [disabled]="trabajando">
          {{ trabajando ? 'Restaurando…' : 'Restaurar configuración' }}
        </button>
      </div>

      <!-- --------------------------------------------------------- activar -->
      <ng-container *ngIf="!a.activo">
        <div class="section-title" style="margin-top:1.1rem;"><i class="ph ph-sliders"></i> Qué se permitirá</div>
        <label class="mt-op"><input type="checkbox" [(ngModel)]="permitirExcel" (change)="auditar()" name="mt-excel"> También Excel</label>
        <label class="mt-op"><input type="checkbox" [(ngModel)]="bloquearTaskMgr" (change)="auditar()" name="mt-tm">
          Quitar también el Administrador de tareas <small>(sin él, cerrar una aplicación colgada requiere otra cuenta)</small></label>

        <div class="mt-bloquea">
          <b>Qué pasará</b>
          <ul><li *ngFor="let l of a.bloquea">{{ l }}</li></ul>
        </div>

        <p class="mt-aviso" *ngIf="a.windows.enAdministradores && !a.sandbox">
          <i class="ph ph-warning"></i> Esta es una cuenta de administrador. Lo recomendable es una cuenta estándar de Windows
          dedicada a la caja, y dejar la de administrador para mantenimiento.
        </p>

        <label class="mt-op mt-confirma">
          <input type="checkbox" [(ngModel)]="entiendo" name="mt-ok">
          Entiendo qué se bloqueará y que puedo restaurarlo desde aquí o con el script de respaldo.
        </label>

        <button type="button" class="btn-primary mt-btn" (click)="activar()"
                [disabled]="!puedeActivar || !entiendo || trabajando">
          {{ trabajando ? 'Esperando el permiso de Windows…' : 'Activar modo terminal' }}
        </button>
        <p class="hint" *ngIf="!puedeActivar">{{ motivoNoActivar }}</p>
      </ng-container>
    </ng-container>
  </div>
  `,
  styles: [`
    .mt .hint { margin-bottom: .6rem; }
    .mt-arenero { display: inline-block; margin-bottom: .8rem; padding: 3px 10px; border-radius: 999px;
      background: var(--wx-info-soft); color: var(--wx-info); font-size: var(--wx-text-xs); font-weight: 600; }
    .mt-equipo { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .mt-equipo > div { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px;
      background: var(--wx-sunken); border-radius: var(--wx-radius-md); }
    .mt-equipo small { color: var(--wx-text-dim); font-size: var(--wx-text-xs); }
    .mt-equipo span { color: var(--wx-text-muted); font-size: var(--wx-text-sm); }
    .mt-caps { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
    .mt-caps li { display: flex; gap: 10px; align-items: flex-start; }
    .mt-caps li > i { font-size: 20px; color: var(--wx-success); margin-top: 1px; }
    .mt-caps li.no > i { color: var(--wx-text-dim); }
    .mt-caps span { display: flex; flex-direction: column; }
    .mt-caps em { font-style: normal; color: var(--wx-accent-text); font-size: var(--wx-text-xs); }
    .mt-caps small { color: var(--wx-text-muted); font-size: var(--wx-text-xs); }
    .mt-op { display: flex; align-items: flex-start; gap: 8px; margin: 6px 0; cursor: pointer; }
    .mt-op small { color: var(--wx-text-dim); }
    .mt-bloquea { margin: 12px 0; padding: 12px 14px; border-radius: var(--wx-radius-md); background: var(--wx-sunken); }
    .mt-bloquea ul { margin: 6px 0 0; padding-left: 18px; color: var(--wx-text-muted); font-size: var(--wx-text-sm); }
    .mt-aviso { display: flex; gap: 8px; align-items: flex-start; color: var(--wx-warning); font-size: var(--wx-text-sm); }
    .mt-aviso--mal { color: var(--wx-danger); }
    .mt-confirma { margin-top: 12px; font-weight: 500; }
    .mt-btn { margin-top: 10px; }
    .mt-activo { display: flex; flex-direction: column; gap: 6px; margin-top: 1rem; padding: 14px 16px;
      border: 1px solid var(--wx-accent-line); background: var(--wx-accent-soft); border-radius: var(--wx-radius-md);
      font-size: var(--wx-text-sm); }
    .mt-activo code { font-size: 12px; word-break: break-all; }
    @media (max-width: 720px) { .mt-equipo { grid-template-columns: 1fr; } }
  `],
})
export class ModoTerminalPanelComponent implements OnInit {
  private readonly cd = inject(ChangeDetectorRef);
  private get api(): any { return (window as any).wybix?.terminal; }

  a: Auditoria | null = null;
  cargando = true;
  error: string | null = null;
  trabajando = false;
  permitirExcel = false;
  bloquearTaskMgr = false;
  entiendo = false;

  get puedeActivar(): boolean {
    return !!this.a?.capacidades.find(c => c.id === 'politicas-usuario')?.disponible;
  }
  get motivoNoActivar(): string {
    return this.a?.capacidades.find(c => c.id === 'politicas-usuario')?.motivo || '';
  }

  async ngOnInit() { await this.auditar(); }

  async auditar() {
    const r = await this.api?.auditar({ permitirExcel: this.permitirExcel, bloquearTaskMgr: this.bloquearTaskMgr });
    this.cargando = false;
    if (!r?.success) { this.error = r?.error || 'No se pudo revisar Windows.'; this.cd.detectChanges(); return; }
    this.error = null;
    this.a = r.data;
    this.cd.detectChanges();
  }

  async activar() {
    if (!this.puedeActivar || !this.entiendo) return;
    this.trabajando = true;
    this.cd.detectChanges();
    try {
      const r = await this.api.activar({ permitirExcel: this.permitirExcel, bloquearTaskMgr: this.bloquearTaskMgr });
      if (!r?.success) { await Swal.fire({ icon: 'error', title: 'No se activó', text: r?.error }); return; }
      await Swal.fire({
        icon: 'success', title: 'Modo terminal activado',
        text: 'Cierra sesión de Windows y vuelve a entrar para que surta efecto.',
      });
      this.entiendo = false;
      await this.auditar();
    } finally {
      this.trabajando = false;
      this.cd.detectChanges();
    }
  }

  async restaurar() {
    const ok = await Swal.fire({
      icon: 'question', title: '¿Restaurar la configuración?',
      text: 'Cada directiva vuelve al valor exacto que tenía antes de activarlo.',
      showCancelButton: true, confirmButtonText: 'Restaurar', cancelButtonText: 'Cancelar',
    });
    if (!ok.isConfirmed) return;
    this.trabajando = true;
    this.cd.detectChanges();
    try {
      const r = await this.api.restaurar();
      if (!r?.success) { await Swal.fire({ icon: 'error', title: 'No se restauró', text: r?.error }); return; }
      await Swal.fire({ icon: 'success', title: 'Configuración restaurada',
        text: 'Cierra sesión de Windows y vuelve a entrar para verlo.' });
      await this.auditar();
    } finally {
      this.trabajando = false;
      this.cd.detectChanges();
    }
  }
}
