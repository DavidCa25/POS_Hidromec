import { Injectable } from '@angular/core';

export type RolUsuario = 'admin' | 'cajero' | 'consulta';

export interface UsuarioSesion {
  id: number;
  nombre: string;
  rol: RolUsuario;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {

  private usuario: UsuarioSesion | null = null;

  constructor() {
    const storedUser = localStorage.getItem('usuarioActual');
    if (storedUser) {
      try {
        this.usuario = JSON.parse(storedUser) as UsuarioSesion;
      } catch {
        this.usuario = null;
      }
    }
  }

  login(id: number, nombre: string, rol: RolUsuario) {
    this.usuario = { id, nombre, rol };
    localStorage.setItem('usuarioActual', JSON.stringify(this.usuario));
  }

  logout() {
    this.usuario = null;
    localStorage.removeItem('usuarioActual');
  }

  get usuarioActual(): UsuarioSesion | null {
    return this.usuario;
  }

  get usuarioActualId(): number | null {
    return this.usuario ? this.usuario.id : null;
  }

  get usuarioActualRol(): RolUsuario | null {
    return this.usuario ? this.usuario.rol : null;
  }

  get esAdmin(): boolean {
    return this.usuario?.rol === 'admin';
  }

  get puedeAbrirCajon(): boolean {
    const rol = this.usuario?.rol;
    return rol === 'admin' || rol === 'cajero';
  }

  get puedeRegistrarVenta(): boolean {
    const rol = this.usuario?.rol;
    return rol === 'admin' || rol === 'cajero';
  }
}
