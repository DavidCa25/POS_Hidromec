import { Component, OnInit } from '@angular/core';
import { NgIf, NgFor, NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';

export interface User {
  id: number;
  usuario: string;
  rol: string;
  active?: boolean;
}

export interface UserPayload {
  id?: number;
  usuario: string;
  contrasena?: string;
  rol: string;
}

export interface ElectronUsersAPI {
  getActiveUsers: () => Promise<{ success: boolean; data: User[]; error?: string }>;
  addUser: (payload: UserPayload) => Promise<{ success: boolean; error?: string }>;
  updateUser: (payload: UserPayload) => Promise<{ success: boolean; error?: string }>;
}

@Component({
  selector: 'app-usuarios-panel',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, FormsModule],
  templateUrl: './usuarios-panel.component.html',
  styleUrls: ['./usuarios-panel.component.css']
})
export class UsuariosPanelComponent implements OnInit {
  usuarios: User[] = [];
  loading: boolean = false;
  saving: boolean = false;

  // Estado del modal y formulario
  showUserModal: boolean = false;
  editingUserId: number | null = null;
  
  userForm: UserPayload = {
    usuario: '',
    contrasena: '',
    rol: 'CAJERO'
  };

  // Opciones y estado del dropdown personalizado
  rolesPermitidos: string[] = ['CAJERO', 'SUPERVISOR', 'ADMIN'];
  roleOpen: boolean = false;

  private get api(): ElectronUsersAPI {
    return (window as unknown as { electronAPI: ElectronUsersAPI }).electronAPI;
  }

  async ngOnInit(): Promise<void> {
    await this.cargarUsuarios();
  }

  async cargarUsuarios(): Promise<void> {
    if (!this.api?.getActiveUsers) return;

    this.loading = true;
    try {
      const res = await this.api.getActiveUsers();
      if (res?.success && res.data) {
        this.usuarios = res.data;
      }
    } catch (error: unknown) {
      console.error('Error cargando usuarios:', error);
    } finally {
      this.loading = false;
    }
  }

  abrirModalNuevo(): void {
    this.editingUserId = null;
    this.userForm = { usuario: '', contrasena: '', rol: 'CAJERO' };
    this.roleOpen = false;
    this.showUserModal = true;
  }

  abrirModalEditar(u: User): void {
    this.editingUserId = u.id;
    // Si la contraseña va vacía, el backend/SP debe ignorar la actualización de contraseña
    this.userForm = { usuario: u.usuario, contrasena: '', rol: u.rol, id: u.id };
    this.roleOpen = false;
    this.showUserModal = true;
  }

  cerrarModal(): void {
    this.showUserModal = false;
    this.roleOpen = false;
  }

  // Lógica del Dropdown Personalizado
  toggleRoleSelect(): void {
    this.roleOpen = !this.roleOpen;
  }

  seleccionarRol(rol: string): void {
    this.userForm.rol = rol;
    this.roleOpen = false;
  }

  cerrarDropdown(): void {
    if (this.roleOpen) {
      this.roleOpen = false;
    }
  }

  async guardarUsuario(): Promise<void> {
    const usuarioLimpio = this.userForm.usuario.trim();
    const passLimpia = this.userForm.contrasena?.trim() || '';

    if (!usuarioLimpio) {
      await Swal.fire('Requerido', 'El nombre de usuario es obligatorio', 'warning');
      return;
    }
    
    if (!this.editingUserId && !passLimpia) {
      await Swal.fire('Requerido', 'La contraseña es obligatoria para usuarios nuevos', 'warning');
      return;
    }

    const payload: UserPayload = {
      ...this.userForm,
      usuario: usuarioLimpio,
      contrasena: passLimpia
    };

    this.saving = true;
    try {
      let res;
      if (this.editingUserId) {
        res = await this.api.updateUser(payload);
      } else {
        res = await this.api.addUser(payload);
      }

      if (res?.success) {
        await Swal.fire('Guardado', 'Usuario guardado correctamente', 'success');
        this.cerrarModal();
        await this.cargarUsuarios();
      } else {
        await Swal.fire('Error', res?.error || 'No se pudo guardar el usuario', 'error');
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Error desconocido al guardar';
      await Swal.fire('Error', msg, 'error');
    } finally {
      this.saving = false;
    }
  }
}