import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private usuario: { id: number; nombre: string } | null = null;

  constructor() {
    // Si ya había sesión, recuperarla
    const storedUser = localStorage.getItem('usuarioActual');
    if (storedUser) {
      this.usuario = JSON.parse(storedUser);
    }
  }

  login(id: number, nombre: string) {
    this.usuario = { id, nombre };
    localStorage.setItem('usuarioActual', JSON.stringify(this.usuario));
  }

  logout() {
    this.usuario = null;
    localStorage.removeItem('usuarioActual');
  }

  get usuarioActual() {
    return this.usuario;
  }

  get usuarioActualId(): number | null {
    return this.usuario ? this.usuario.id : null;
  }
}
