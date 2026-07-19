import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';

interface Usuario { id: number; usuario: string; rol: string; active: boolean | number; creation_date?: string; }

@Component({
  selector: 'app-usuarios-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrls: ['../panel-controls.css'],
  styles: [`
    .u-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;}
    .u-table{width:100%;border-collapse:collapse;}
    .u-table th{text-align:left;font-size:.78rem;text-transform:uppercase;letter-spacing:.03em;color:#94a3b8;padding:.5rem .6rem;border-bottom:1px solid #eef2f6;}
    .u-table th.right,.u-table td.right{text-align:right;}
    .u-table td{padding:.7rem .6rem;border-bottom:1px solid #f4f6f9;vertical-align:middle;}
    .u-name{font-weight:700;color:#0f172a;}
    .u-rol-wrap{position:relative;display:inline-block;}
    .u-badge{border:1px solid #e2e8f0;background:#f8fafc;border-radius:999px;padding:.3rem .7rem;font-weight:700;font-size:.82rem;cursor:pointer;display:inline-flex;align-items:center;gap:.35rem;color:#334155;}
    .u-badge.rol-admin{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8;}
    .u-badge.rol-supervisor{background:#f5f3ff;border-color:#ddd6fe;color:#6d28d9;}
    .u-badge.rol-cajero{background:#f0fdf4;border-color:#bbf7d0;color:#15803d;}
    .u-menu{position:absolute;top:calc(100% + 4px);left:0;z-index:40;background:#fff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 10px 25px rgba(0,0,0,.12);overflow:hidden;min-width:150px;}
    .u-menu-opt{padding:.6rem .9rem;cursor:pointer;font-size:.9rem;color:#334155;}
    .u-menu-opt:hover{background:#f1f5f9;}
    .u-estado{font-weight:700;color:#16a34a;font-size:.85rem;}
    .u-estado.off{color:#94a3b8;}
    .u-act{border:none;background:#f1f5f9;color:#475569;width:34px;height:34px;border-radius:9px;cursor:pointer;margin-left:.35rem;}
    .u-act:hover{background:#e2e8f0;color:#0f172a;}
    .u-modal{position:fixed;inset:0;background:rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;z-index:1100;}
    .u-dialog{background:#fff;padding:1.4rem 1.5rem;border-radius:20px;width:96%;max-width:420px;}
    .u-dialog h3{margin:0 0 1rem;font-size:1.3rem;font-weight:800;color:#0f172a;}
    .u-rolsel{width:100%;text-align:left;display:flex;justify-content:space-between;align-items:center;cursor:pointer;}
    .u-modal-actions{display:flex;gap:.6rem;justify-content:flex-end;margin-top:1.4rem;}
  `],
  template: `
  <div class="panel-content">
    <div class="u-head">
      <div class="section-title" style="margin:0;"><i class="bi bi-person-badge"></i> Usuarios y permisos</div>
      <button class="btn-primary" type="button" (click)="nuevo()"><i class="bi bi-plus-lg"></i> Nuevo usuario</button>
    </div>

    <p class="hint" *ngIf="cargando">Cargando usuarios...</p>

    <table class="u-table" *ngIf="!cargando">
      <thead><tr><th>Usuario</th><th>Rol</th><th>Estado</th><th class="right">Acciones</th></tr></thead>
      <tbody>
        <tr *ngFor="let u of usuarios">
          <td class="u-name">{{ u.usuario }}</td>
          <td>
            <div class="u-rol-wrap">
              <button class="u-badge rol-{{ u.rol }}" (click)="toggleRol(u.id)">
                {{ rolLabel(u.rol) }} <i class="bi bi-chevron-down"></i>
              </button>
              <div class="u-menu" *ngIf="menuRolId === u.id">
                <div class="u-menu-opt" *ngFor="let r of roles" (click)="cambiarRol(u, r.key)">{{ r.label }}</div>
              </div>
            </div>
          </td>
          <td><span class="u-estado" [class.off]="!u.active">{{ u.active ? 'Activo' : 'Inactivo' }}</span></td>
          <td class="right">
            <button class="u-act" type="button" (click)="resetPassword(u)" title="Cambiar contraseña"><i class="bi bi-key"></i></button>
            <button class="u-act" type="button" (click)="toggleActivo(u)" [title]="u.active ? 'Desactivar' : 'Activar'">
              <i class="bi" [ngClass]="u.active ? 'bi-person-dash' : 'bi-person-check'"></i>
            </button>
          </td>
        </tr>
        <tr *ngIf="usuarios.length === 0"><td colspan="4" style="text-align:center;color:#94a3b8;padding:1.5rem;">Sin usuarios</td></tr>
      </tbody>
    </table>
  </div>

  <!-- Modal nuevo usuario -->
  <div class="u-modal" *ngIf="showNuevo">
    <div class="u-dialog">
      <h3>Nuevo usuario</h3>
      <label class="lbl">Usuario</label>
      <input class="ctl" [(ngModel)]="form.usuario" placeholder="cajero1" [disabled]="guardando">
      <label class="lbl" style="margin-top:.7rem;">Contraseña</label>
      <input class="ctl" type="password" [(ngModel)]="form.password" placeholder="Mínimo 6 caracteres" [disabled]="guardando">
      <label class="lbl" style="margin-top:.7rem;">Rol</label>
      <div class="u-rol-wrap" style="width:100%;">
        <button class="ctl u-rolsel" type="button" (click)="rolNuevoOpen = !rolNuevoOpen">
          {{ rolLabel(form.rol) }} <i class="bi bi-chevron-down"></i>
        </button>
        <div class="u-menu" *ngIf="rolNuevoOpen" style="width:100%;">
          <div class="u-menu-opt" *ngFor="let r of roles" (click)="form.rol = r.key; rolNuevoOpen = false">{{ r.label }}</div>
        </div>
      </div>
      <div class="u-modal-actions">
        <button class="btn-outline" type="button" (click)="cerrarNuevo()" [disabled]="guardando">Cancelar</button>
        <button class="btn-primary" type="button" (click)="guardarNuevo()" [disabled]="guardando">{{ guardando ? 'Creando...' : 'Crear usuario' }}</button>
      </div>
    </div>
  </div>
  `
})
export class UsuariosPanelComponent implements OnInit {
  private get api() { return (window as any).electronAPI; }

  roles = [
    { key: 'admin', label: 'Administrador' },
    { key: 'supervisor', label: 'Supervisor' },
    { key: 'cajero', label: 'Cajero' },
  ];

  usuarios: Usuario[] = [];
  cargando = false;
  menuRolId: number | null = null;

  showNuevo = false;
  guardando = false;
  rolNuevoOpen = false;
  form = { usuario: '', password: '', rol: 'cajero' };

  async ngOnInit() { await this.cargar(); }

  rolLabel(k: string): string { return this.roles.find(r => r.key === k)?.label ?? k; }

  async cargar() {
    this.cargando = true;
    try {
      const r = await this.api?.usersList?.();
      this.usuarios = r?.success ? (r.data || []) : [];
    } catch {
      this.usuarios = [];
    } finally {
      this.cargando = false;
    }
  }

  toggleRol(id: number) { this.menuRolId = this.menuRolId === id ? null : id; }

  async cambiarRol(u: Usuario, rol: string) {
    this.menuRolId = null;
    if (u.rol === rol) return;
    const r = await this.api?.usersUpdateRole?.({ id: u.id, rol });
    if (r?.success) { await this.cargar(); }
    else await Swal.fire({ icon: 'error', title: 'No se pudo', text: r?.error || 'Error al cambiar el rol.' });
  }

  async resetPassword(u: Usuario) {
    const { value: pass } = await Swal.fire({
      title: `Nueva contraseña de ${u.usuario}`,
      input: 'password',
      inputPlaceholder: 'Mínimo 6 caracteres',
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      inputValidator: (v) => (!v || v.length < 6) ? 'Mínimo 6 caracteres' : undefined
    });
    if (!pass) return;
    const r = await this.api?.usersResetPassword?.({ id: u.id, password: pass });
    if (r?.success) await Swal.fire({ icon: 'success', title: 'Contraseña actualizada', timer: 1200, showConfirmButton: false });
    else await Swal.fire({ icon: 'error', title: 'No se pudo', text: r?.error || 'Error.' });
  }

  async toggleActivo(u: Usuario) {
    const r = await this.api?.usersSetActive?.({ id: u.id, active: !u.active });
    if (r?.success) await this.cargar();
    else await Swal.fire({ icon: 'error', title: 'No se pudo', text: r?.error || 'Error.' });
  }

  nuevo() { this.form = { usuario: '', password: '', rol: 'cajero' }; this.rolNuevoOpen = false; this.showNuevo = true; }
  cerrarNuevo() { this.showNuevo = false; }

  async guardarNuevo() {
    if (this.form.usuario.trim().length < 3) { await Swal.fire({ icon: 'warning', title: 'Usuario muy corto', text: 'Mínimo 3 caracteres.' }); return; }
    if (this.form.password.length < 6) { await Swal.fire({ icon: 'warning', title: 'Contraseña muy corta', text: 'Mínimo 6 caracteres.' }); return; }
    this.guardando = true;
    try {
      const r = await this.api?.usersCreate?.({ usuario: this.form.usuario.trim(), password: this.form.password, rol: this.form.rol });
      if (!r?.success) throw new Error(r?.error || 'No se pudo crear.');
      this.showNuevo = false;
      await Swal.fire({ icon: 'success', title: 'Usuario creado', timer: 1200, showConfirmButton: false });
      await this.cargar();
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'No se pudo crear el usuario.' });
    } finally {
      this.guardando = false;
    }
  }
}
