import { Component, HostListener  } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgClass, NgIf, NgFor, DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { Subscription } from 'rxjs';
import { UpdaterService, UpdateStatus } from '../services/updater.service';
import { ThemeService, ACCENT_PRESETS, AccentPreset } from '../services/theme.service';
import { RegisterService } from '../services/register.service';
import { ModulesService, ModulesState } from '../services/modules.service';

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
  isInventarioOpen = false;
  isDatosOpen = false;
  themeOpen = false;

  /** Paleta de acentos. Vive en ThemeService para no duplicarla. */
  readonly presets: AccentPreset[] = ACCENT_PRESETS;

  /** Color mostrado en el selector: puede ser una vista previa sin guardar. */
  colorEnEdicion = '#1F2E86';
  /** Muestra enfocada, para la navegación con flechas. */
  indicePaleta = 0;

  currentInvColor = '#1f2e86';

  userName: string = 'Usuario';

  notifOpen = false;
  notifications: AppNotification[] = [];
  unreadCount = 0;
  alertasCount = 0;

  // Módulos opcionales activos (controlan qué se ve en el menú)
  modulesState: ModulesState = { pagoServicios: false };

  private sub?: Subscription;
  private modSub?: Subscription;

  constructor(private router: Router, public auth: AuthService, private updater: UpdaterService, private theme: ThemeService, private registerService: RegisterService, public modules: ModulesService) {}

  @HostListener('window:resize')
  onResize() {
    this.isMobile = window.innerWidth < 900;
    this.menuOpen = !this.isMobile; 
    this.showOverlay = this.isMobile && this.menuOpen;
  }

  /**
   * Contexto del negocio para el pie del rail. Se lee de la misma
   * configuracion que edita Configuracion > Negocio; si aun no se ha rellenado
   * se muestra un texto neutro en vez de un hueco.
   */
  nombreNegocio = 'Wybix POS';
  appVersion = '';

  get rolTexto(): string {
    return this.auth.esAdmin ? 'Administrador' : 'Cajero';
  }

  private async cargarContexto() {
    try {
      const cfg = await (window as any).electronAPI?.getConfig?.();
      const c = cfg?.data ?? cfg ?? {};
      const n = (c.business_name ?? c.nombre ?? '').trim();
      if (n) this.nombreNegocio = n;
    } catch { /* silencioso: es contexto, no bloquea nada */ }
    try {
      const v = await (window as any).electronAPI?.getAppVersion?.();
      this.appVersion = String(v?.data ?? v ?? '').replace(/^v/, '');
    } catch { /* silencioso */ }
  }

  ngOnInit() { this.onResize(); this.cargarContexto();if (this.auth.usuarioActual?.nombre) {
      this.registerService.load();
      this.userName = this.auth.usuarioActual.nombre;
      this.currentInvColor = this.theme.getInvMainSnapshot();
      this.colorEnEdicion = this.currentInvColor.toUpperCase();

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

    this.cargarAlertas();

    // Módulos opcionales: refresca y escucha cambios (se actualiza al configurar).
    this.modSub = this.modules.mods$.subscribe(m => this.modulesState = m);
    this.modules.refresh();
  }

  async cargarAlertas() {
    try {
      const r = await (window as any).electronAPI?.alertsCounts?.({ min: 3 });
      if (r?.success) this.alertasCount = Number(r.data?.total || 0);
    } catch { /* silencioso */ }
  }

  /**
   * El popover nativo se encarga de abrir, cerrar, Escape y devolver el foco.
   * Aqui solo se sincroniza el estado del componente con lo que ya paso.
   */
  onPaletaToggle(e: { newState?: string }) {
    if (e?.newState === 'open') {
      this.colorEnEdicion = this.currentInvColor.toUpperCase();
      this.indicePaleta = Math.max(0, this.presets.findIndex(p => this.esColorActual(p.valor)));
      this.themeOpen = true;
      this.notifOpen = false;
    } else {
      this.cerrarPaleta();
    }
  }

  /** Cierra el popover desde codigo (tras elegir un color). */
  private ocultarPaleta() {
    const el = document.getElementById('paletaTablas') as any;
    if (el?.hidePopover && el.matches(':popover-open')) el.hidePopover();
  }

  get isDark(): boolean { return this.theme.isDark(); }
  toggleDark() { this.theme.toggleDark(); }

  setInvTheme(color: string) {
    this.currentInvColor = color;
    this.colorEnEdicion = color.toUpperCase();
    this.theme.setInvMain(color);
    this.themeOpen = false;
    this.ocultarPaleta();
  }

  /** ¿Es este el color aplicado ahora mismo? Compara sin importar mayúsculas. */
  esColorActual(valor: string): boolean {
    return (this.colorEnEdicion || '').toUpperCase() === (valor || '').toUpperCase();
  }

  esPreset(): boolean {
    return this.presets.some(p => this.esColorActual(p.valor));
  }

  get nombreColorActual(): string {
    return this.presets.find(p => this.esColorActual(p.valor))?.nombre ?? 'Personalizado';
  }

  /**
   * Vista previa mientras el usuario arrastra en el selector nativo.
   * Aplica el color a las tablas SIN guardarlo: así se ve el efecto real
   * antes de decidir. Si cierra sin confirmar, `cerrarPaleta` lo revierte.
   */
  previewColor(color: string) {
    this.colorEnEdicion = (color || '').toUpperCase();
    this.theme.previewInvMain(color);
  }

  /** Confirma y persiste el color personalizado. */
  confirmarColor(color: string) {
    this.setInvTheme((color || '').toUpperCase());
  }

  /** Cierra el selector descartando cualquier vista previa sin confirmar. */
  private cerrarPaleta() {
    if (!this.themeOpen) return;
    this.themeOpen = false;
    if (!this.esColorActual(this.currentInvColor)) {
      this.colorEnEdicion = this.currentInvColor.toUpperCase();
      this.theme.cancelPreview();
    }
  }

  /** Flechas, Inicio y Fin dentro de la rejilla de muestras. */
  onPaletaKey(e: KeyboardEvent) {
    const COLUMNAS = 8;
    const ultimo = this.presets.length - 1;
    let destino: number | null = null;
    if (e.key === 'ArrowRight') destino = Math.min(this.indicePaleta + 1, ultimo);
    else if (e.key === 'ArrowLeft') destino = Math.max(this.indicePaleta - 1, 0);
    else if (e.key === 'ArrowDown') destino = Math.min(this.indicePaleta + COLUMNAS, ultimo);
    else if (e.key === 'ArrowUp') destino = Math.max(this.indicePaleta - COLUMNAS, 0);
    else if (e.key === 'Home') destino = 0;
    else if (e.key === 'End') destino = ultimo;
    if (destino === null) return;
    e.preventDefault();
    this.indicePaleta = destino;
    const botones = document.querySelectorAll<HTMLElement>('.wx-palette__grid .wx-swatch');
    botones[destino]?.focus();
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
    this.modSub?.unsubscribe();
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

  toggleInventario() {
    this.isInventarioOpen = !this.isInventarioOpen;
  }

  toggleDatos() {
    this.isDatosOpen = !this.isDatosOpen;
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
      this.cerrarPaleta();
    }
  }

}
