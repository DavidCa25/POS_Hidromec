import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-login',
  standalone: true,
  templateUrl: './login.html',
  imports: [FormsModule],
  styleUrls: ['./login.css']
})
export class Login {
  usuario = '';
  contrasena = '';
  mensaje = '';

  constructor(private router: Router) {}

  async onLogin(event: Event) {
    event.preventDefault();
    const resultado = await (window as any).electronAPI.iniciarSesion(this.usuario, this.contrasena);
    if (resultado && resultado.success) {
      this.router.navigate(['/dashboard/estadisticas']);
    } else {
      this.mensaje = resultado.message || 'Usuario o contraseña inválidos';
    }
  }
}
