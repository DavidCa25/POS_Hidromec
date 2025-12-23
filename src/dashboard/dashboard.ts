import { Component, HostListener  } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgClass, NgIf, NgFor, DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { Subscription } from 'rxjs';
import { UpdaterService, UpdateStatus } from '../services/updater.service';
import { ThemeService } from '../services/theme.service';

type AppNotification = {
  id: string;
  type: 'update';
  title: string;
  message: string;
  action?: 'download' | 'install';
  subtype?: 'available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  percent?: number;
  createdAt: number;
  read: boolean;
};

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.html',
  imports: [RouterOutlet, FormsModule, RouterLink, RouterLinkActive, NgClass, NgIf, NgFor, DecimalPipe],
  styleUrls: ['./dashboard.css']
})

export class Dashboard {
  menuOpen = true;
  isMobile = false;
  showOverlay = false;
  isOperacionesOpen = false;
  isUserDropdownOpen = false;
  isOperacionesCompraOpen = false;
  themeOpen = false;

  invColors = [
    { name: 'Azul', value: '#1f2e86' },
    { name: 'Verde', value: '#00662f' },
    { name: 'Navy->Gold', value: '#0b1b4d' },
    { name: 'Café', value: '#6b3f2a' },
  ];

  currentInvColor = '#1f2e86';

  userName: string = 'Usuario';

  notifOpen = false;
  notifications: AppNotification[] = [];
  unreadCount = 0;

  private sub?: Subscription;

  constructor(private router: Router, public auth: AuthService, private updater: UpdaterService, private theme: ThemeService) {}

  @HostListener('window:resize')
  onResize() {
    this.isMobile = window.innerWidth < 900;
    this.menuOpen = !this.isMobile; 
    this.showOverlay = this.isMobile && this.menuOpen;
  }
  ngOnInit() { this.onResize();if (this.auth.usuarioActual?.nombre) {
      this.userName = this.auth.usuarioActual.nombre;
      this.currentInvColor = this.theme.getInvMainSnapshot();

      this.updater.checkForUpdates();
    }

    const uid = this.auth.usuarioActualId;
    if (uid != null) {
      (window as any).electronAPI.getUserById(uid)
        .then((res: any) => {
          if (res?.usuario) this.userName = res.usuario;
        })
        .catch(() => {/* silencioso */});
    }

    this.sub = this.updater.getUpdateStatus$().subscribe((status) => {
      if (!status) return;
      this.handleUpdateNotification(status);
    });

  }

  toggleTheme() {
    this.themeOpen = !this.themeOpen;
    this.notifOpen = false;
  }

  setInvTheme(color: string) {
    this.currentInvColor = color;
    this.theme.setInvMain(color);
    this.themeOpen = false;
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }

  private handleUpdateNotification(status: UpdateStatus) {
    if (!['available', 'downloaded', 'downloading', 'checking', 'not-available', 'error'].includes(status.type)) {
      return;
    }

    const id = `update:${status.type}:${status.version ?? 'na'}`;

    const existing = this.notifications.find(n => n.id === id);

    const title =
      status.type === 'available' ? 'Actualización disponible' :
      status.type === 'downloaded' ? 'Actualización lista para instalar' :
      status.type === 'downloading' ? 'Descargando actualización…' :
      status.type === 'checking' ? 'Buscando actualizaciones…' :
      status.type === 'not-available' ? 'Sin actualizaciones' :
      'Error de actualización';

    const message =
      status.message ??
      (status.type === 'available'
        ? `Hay una nueva versión ${status.version}`
        : status.type === 'downloaded'
        ? `Versión ${status.version} descargada`
        : status.type === 'downloading'
        ? `Progreso: ${Math.round(status.percent ?? 0)}%`
        : status.type === 'checking'
        ? 'Buscando actualizaciones…'
        : status.type === 'not-available'
        ? 'El sistema está actualizado'
        : 'Ocurrió un error al actualizar');

    const action =
      status.type === 'available' ? 'download' :
      status.type === 'downloaded' ? 'install' :
      undefined;

    if (existing) {
      existing.title = title;
      existing.message = message;
      existing.action = action;
      existing.version = status.version;
      existing.percent = status.percent;
      existing.subtype = status.type as any;  
      existing.createdAt = Date.now();
      existing.read = false;
    } else {
      this.notifications.unshift({
        id,
        type: 'update',
        subtype: status.type as any,       
        title,
        message,
        action,
        version: status.version,
        percent: status.percent,
        createdAt: Date.now(),
        read: false
      });
    }

    this.recalcUnread();
  }

  private recalcUnread() {
    this.unreadCount = this.notifications.filter(n => !n.read).length;
  }

  toggleNotif() {
    this.notifOpen = !this.notifOpen;
    if (this.notifOpen) {
      this.markAllAsRead();
    }
  }

  markAllAsRead() {
    this.notifications.forEach(n => n.read = true);
    this.recalcUnread();
  }

  onNotifAction(n: AppNotification) {
    if (n.action === 'download' && (window as any).electronAPI?.downloadUpdate) {
      (window as any).electronAPI.downloadUpdate();
      n.read = true;
      this.recalcUnread();
    }

    if (n.action === 'install' && (window as any).electronAPI?.installUpdate) {
      (window as any).electronAPI.installUpdate();
      n.read = true;
      this.recalcUnread();
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

  crearUsuario() {
    this.router.navigate(['/sign_up']);
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
    const themeWrapper = document.getElementById('theme-wrapper');
    if (themeWrapper && !themeWrapper.contains(event.target as Node)) {
      this.themeOpen = false;
    }
  }

}
