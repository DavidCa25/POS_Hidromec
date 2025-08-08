import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

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

  constructor(private router: Router) {}

  async onLogin(event: Event) {
    event.preventDefault();

    if (!this.usuario.trim() || !this.contrasena.trim()) {
      this.advertencia = '⚠️ Ambos campos son obligatorios.';
      return;
    }

    this.advertencia = '';


    const resultado = await (window as any).electronAPI.iniciarSesion(this.usuario, this.contrasena);
    if (resultado && resultado.success) {
      localStorage.setItem('usuario', JSON.stringify(resultado.data));
      const usuario = JSON.parse(localStorage.getItem('usuario') || '{}');
      console.log(usuario.rol);
      this.router.navigate(['/dashboard/estadisticas']);
    } else {
      this.mensaje = resultado.message || 'Usuario o contraseña inválidos';
    }
  }

  onInputChange() {
    this.mensaje = '';
    this.advertencia = ''
  }
}
