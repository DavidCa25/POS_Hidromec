import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-crear-usuario',
  standalone: true,
  templateUrl: './sign_up.html',
  imports: [FormsModule, CommonModule],
  styleUrls: ['../login/login.css'] 
})
export class CrearUsuarioComponent {
  usuario = '';
  contrasena = '';
  confirmarContrasena = '';
  rol: 'admin' | 'supervisor' | 'cajero' = 'cajero';

  mensaje = '';
  advertencia = '';
  mostrarContrasena = false;
  mostrarConfirmacion = false;
  cargando = false;

  /* Los tres roles que el backend acepta. "Solo consulta" estaba aqui y no
     existia en ninguna otra capa: su canal no tenia handler, asi que nunca
     llego a crearse ninguno. */
  rolesOpciones = [
    { value: 'admin',      label: 'Administrador' },
    { value: 'supervisor', label: 'Encargado' },
    { value: 'cajero',     label: 'Operador' }
  ];

  constructor(
    private router: Router,
  ) {}

  async onCrearCuenta(event: Event) {
    event.preventDefault();
    this.mensaje = '';
    this.advertencia = '';

    if (!this.usuario.trim() || !this.contrasena.trim() || !this.confirmarContrasena.trim()) {
      this.advertencia = '⚠️ Todos los campos son obligatorios.';
      return;
    }

    if (this.contrasena.length < 4) {
      this.advertencia = '⚠️ La contraseña debe tener al menos 4 caracteres.';
      return;
    }

    if (this.contrasena !== this.confirmarContrasena) {
      this.advertencia = '⚠️ Las contraseñas no coinciden.';
      return;
    }

    this.cargando = true;

    try {
      const resultado = await (window as any).electronAPI.crearUsuario(
        this.usuario,
        this.contrasena,
        this.rol
      );

      if (resultado && resultado.success) {
        this.mensaje = '✅ Usuario creado correctamente. Ahora puedes iniciar sesión.';
        setTimeout(() => {
          this.router.navigate(['/login']);
        }, 1500);
      } else {
        this.mensaje = resultado?.message || 'Ocurrió un error al crear el usuario.';
      }
    } catch (e: any) {
      console.error('❌ Error al crear usuario:', e);
      this.mensaje = e?.message || 'Error inesperado al crear el usuario.';
    } finally {
      this.cargando = false;
    }
  }

  onInputChange() {
    this.mensaje = '';
    this.advertencia = '';
  }

  toggleMostrarContrasena() {
    this.mostrarContrasena = !this.mostrarContrasena;
  }

  toggleMostrarConfirmacion() {
    this.mostrarConfirmacion = !this.mostrarConfirmacion;
  }

  irALogin() {
    this.router.navigate(['/login']);
  }
}
