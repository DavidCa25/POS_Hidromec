import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { AuthService, RolUsuario } from '../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  templateUrl: './login.html',
  imports: [FormsModule, CommonModule],
  styleUrls: ['./login.css']
})
export class Login {
  usuario = '';
  contrasena = '';
  mensaje = '';
  advertencia = '';
  mostrarContrasena = false;

  constructor(
    private router: Router,
    private authService: AuthService
  ) {}

  async onLogin(event: Event) {
    event.preventDefault();

    if (!this.usuario.trim() || !this.contrasena.trim()) {
      this.advertencia = '⚠️ Ambos campos son obligatorios.';
      return;
    }

    this.advertencia = '';
    this.mensaje = '';

    try {
      const resultado = await (window as any).electronAPI.iniciarSesion(
        this.usuario,
        this.contrasena
      );

      if (resultado && resultado.success && resultado.data) {
        const data = resultado.data as {
          id: number;
          usuario: string;
          rol: RolUsuario | string;
        };

        const usuarioLS = {
          id: data.id,
          nombre: data.usuario,
          rol: data.rol as RolUsuario
        };
        localStorage.setItem('usuarioActual', JSON.stringify(usuarioLS));

        this.authService.login(
          usuarioLS.id,
          usuarioLS.nombre,
          usuarioLS.rol
        );

        console.log('Login OK, rol:', usuarioLS.rol);
        if (usuarioLS.rol == 'cajero') {
          this.router.navigate(['/dashboard/venta']);
        }
        else {
          this.router.navigate(['/dashboard/estadisticas']);
        }
      } else {
        this.mensaje = resultado?.message || 'Usuario o contraseña inválidos';
      }
    } catch (e: any) {
      console.error('❌ Error en login:', e);
      this.mensaje = e?.message || 'Ocurrió un error al iniciar sesión';
    }
  }

  onInputChange() {
    this.mensaje = '';
    this.advertencia = '';
  }
}
