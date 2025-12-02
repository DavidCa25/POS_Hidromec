import { Component, HostListener  } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgClass, NgIf } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.html',
  imports: [RouterOutlet, FormsModule, RouterLink, RouterLinkActive, NgClass, NgIf],
  styleUrls: ['./dashboard.css']
})
export class Dashboard {
  menuOpen = true;
  isMobile = false;
  showOverlay = false;
  isOperacionesOpen = false;
  isUserDropdownOpen = false;
  isOperacionesCompraOpen = false;

  userName: string = 'Usuario';

  constructor(private router: Router, private auth: AuthService) {}

  @HostListener('window:resize')
  onResize() {
    this.isMobile = window.innerWidth < 900;
    this.menuOpen = !this.isMobile; 
    this.showOverlay = this.isMobile && this.menuOpen;
  }
  ngOnInit() { this.onResize();if (this.auth.usuarioActual?.nombre) {
      this.userName = this.auth.usuarioActual.nombre;
    }

    const uid = this.auth.usuarioActualId;
    if (uid != null) {
      (window as any).electronAPI.getUserById(uid)
        .then((res: any) => {
          if (res?.usuario) this.userName = res.usuario;
        })
        .catch(() => {/* silencioso */});
    }
  }
  toggleMenu() {
    this.menuOpen = !this.menuOpen;
    this.showOverlay = this.isMobile && this.menuOpen;
  }

  
  toggleOperaciones() {
    this.isOperacionesOpen = !this.isOperacionesOpen;
  }

  toggleOperacionesCompra() {
    this.isOperacionesCompraOpen = !this.isOperacionesCompraOpen;
  }

  toggleUserDropdown() {
    this.isUserDropdownOpen = !this.isUserDropdownOpen;
  }

  cerrarSesion() {
    this.router.navigate(['/login']);
  }

  @HostListener('document:click', ['$event'])
  handleClickOutside(event: Event) {
    const dropdown = document.getElementById('operaciones-dropdown');
    const comprasDropdown = document.getElementById('operaciones-compra-dropdown');
    const userWrapper = document.querySelector('.dashboard-user-wrapper');
    if (!dropdown) return;
    if (!dropdown.contains(event.target as Node)) {
      this.isOperacionesOpen = false;
    }
    if (comprasDropdown && !comprasDropdown.contains(event.target as Node)) {
      this.isOperacionesCompraOpen = false;
    }
    if (userWrapper && !userWrapper.contains(event.target as Node)) {
      this.isUserDropdownOpen = false;
    }
  }

}
