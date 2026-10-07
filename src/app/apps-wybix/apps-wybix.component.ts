import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, Type, inject, signal } from '@angular/core';
import { NgComponentOutlet, NgFor, NgIf } from '@angular/common';
import { AuthService, PAQUETES } from '../../services/auth.service';
import { APPS_WYBIX, AppWybix, AppsWybixService, DESCARGAS_WYBIX } from './apps-wybix.service';

@Component({
  selector: 'wx-apps-wybix', standalone: true,
  imports: [NgIf, NgFor, NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './apps-wybix.component.html', styleUrls: ['./apps-wybix.component.css'],
})
export class AppsWybixComponent implements AfterViewInit, OnDestroy {
  readonly apps = inject(AppsWybixService);
  readonly opciones = APPS_WYBIX;
  private readonly auth = inject(AuthService);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  readonly paso = signal<1 | 2>(1);
  readonly plataforma = signal<'android'|'web'>('android');
  readonly qr = signal<string | null>(null);
  readonly error = signal('');
  readonly mensaje = signal('');
  readonly vinculacion = signal<Type<unknown> | null>(null);
  readonly cargando = signal(false);
  readonly izquierda = signal(12);
  readonly abajo = signal(110);
  private revision = 0;
  private viva = true;

  get elegida() { return this.opciones.find(a => a.id === this.apps.app()); }
  get enlace() { return DESCARGAS_WYBIX[this.apps.app() ?? 'owner'] + (this.plataforma() === 'web' ? '&platform=web' : ''); }
  async cambiarPlataforma(p: 'android'|'web') { this.plataforma.set(p); await this.verPaso(1); }
  get puedeVincular() { return this.auth.puede(PAQUETES.CONFIGURACION_ADMINISTRAR); }

  ngAfterViewInit() {
    this.colocar();
    this.host.nativeElement.querySelector<HTMLButtonElement>('.apps__panel button')?.focus();
    if (this.apps.app()) void this.elegir(this.apps.app()!);
  }
  ngOnDestroy() { this.viva = false; ++this.revision; }

  @HostListener('window:resize') colocar() {
    const r = this.apps.ancla?.getBoundingClientRect();
    this.izquierda.set(Math.max(12, Math.min((r?.right ?? window.innerWidth - 24) - 390, window.innerWidth - 402)));
    this.abajo.set(r && r.top > window.innerHeight / 2 ? Math.max(24, window.innerHeight - r.top + 18) : 24);
  }

  async elegir(id: AppWybix) {
    this.apps.app.set(id);
    await this.verPaso(1);
  }
  volver() { ++this.revision; this.apps.app.set(null); this.vinculacion.set(null); this.error.set(''); this.mensaje.set(''); }

  async verPaso(paso: 1 | 2) {
    const revision = ++this.revision;
    this.paso.set(paso); this.error.set(''); this.mensaje.set(''); this.qr.set(null); this.vinculacion.set(null);
    this.cargando.set(true);
    try {
      if (paso === 1) {
        const modulo = await import('qrcode');
        const QRCode = modulo.default ?? modulo;
        const qr = await QRCode.toDataURL(this.enlace, { width: 280, margin: 2, color: { dark: '#0F1826', light: '#FFFFFF' } });
        if (this.viva && revision === this.revision) this.qr.set(qr);
      } else if (this.apps.app() === 'owner' && this.puedeVincular) {
        const m = await import('../pairing-qr-panel/pairing-qr.component');
        if (this.viva && revision === this.revision) this.vinculacion.set(m.PairingQr);
      }
    } catch { if (revision === this.revision) this.error.set('No se pudo cargar. Intenta otra vez.'); }
    finally { if (this.viva && revision === this.revision) this.cargando.set(false); }
  }

  async copiar() {
    try { await navigator.clipboard.writeText(this.enlace); this.mensaje.set('Enlace de descarga copiado.'); }
    catch { this.error.set('No se pudo copiar. Selecciona el enlace para copiarlo.'); }
  }
  async abrirEnlace(e: MouseEvent) {
    const api = (window as any).electronAPI;
    if (!api?.openExternal) return;
    e.preventDefault();
    try { const r = await api.openExternal(this.enlace); if (r?.ok === false) this.error.set('No se pudo abrir el navegador. Copia el enlace de descarga.'); }
    catch { this.error.set('No se pudo abrir el navegador. Copia el enlace de descarga.'); }
  }

  @HostListener('document:keydown', ['$event']) teclado(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.apps.cerrar(); }
    if (e.key !== 'Tab') return;
    const botones = [...this.host.nativeElement.querySelectorAll<HTMLElement>('.apps__panel button, .apps__panel a[href], .apps__panel input, .apps__panel select')].filter(b => !(b as HTMLButtonElement).disabled && b.getClientRects().length > 0);
    const primero = botones[0], ultimo = botones.at(-1);
    if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo?.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero?.focus(); }
  }
}
