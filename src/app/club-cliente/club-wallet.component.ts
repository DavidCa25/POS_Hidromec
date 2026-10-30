import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as QRCode from 'qrcode';
import { ADDON } from '../marca/addon';
import type { TarjetaWallet } from '../marca/marca';
import { CustomerDisplayService } from '../../core/customer-display.service';
import { WxCargandoComponent } from '../wx-cargando/wx-cargando.component';

/*
 * TARJETA DEL CLUB EN WALLET (0066).
 *
 * La caja pide a la nube el pase del cliente (uno por teléfono) y enseña su
 * enlace como QR: aquí, para el cajero, y en la pantalla del cliente, que es
 * donde el cliente lo escanea con su teléfono. El pase se guarda en Apple
 * Wallet o Google Wallet y se actualiza solo cuando cambian sus puntos,
 * sellos o membresía.
 *
 * La marca del pase sale del hueco `tarjetaWallet` del addon (si lo hay): la
 * caja convierte el logo a PNG y lo manda junto con los colores.
 */
@Component({
  selector: 'app-club-wallet',
  standalone: true,
  imports: [CommonModule, WxCargandoComponent],
  template: `<dialog #dialog class="wx-dialogo wl" (cancel)="cerrar()" aria-labelledby="wl-titulo" data-guide="club-wallet-dialogo">
    <header>
      <h3 id="wl-titulo">Tarjeta del Club en Wallet</h3>
    </header>
    <div class="wl__carga" *ngIf="busy" role="status"><wx-cargando [size]="28" alt="Preparando la tarjeta"></wx-cargando> Preparando la tarjeta…</div>
    <p role="alert" class="wl__error" *ngIf="error">{{ error }}</p>
    <ng-container *ngIf="qr">
      <div class="wl__cuerpo">
        <img class="wl__qr" [src]="qr" alt="Código QR de la tarjeta del Club" data-guide="club-wallet-qr">
        <div>
          <b>{{ nombre }}</b>
          <p class="wl__tenue">Que lo escanee con la cámara de su teléfono{{ enPantalla ? ' (también está en su pantalla)' : '' }}. Elige Apple Wallet o Google Wallet y queda guardada; sus puntos y sellos se actualizan solos.</p>
          <p class="wl__tenue">En caja, su tarjeta se lee con el escáner como cualquier código.</p>
        </div>
      </div>
      <p class="wl__copiado" role="status" *ngIf="copiado">Enlace copiado.</p>
    </ng-container>
    <footer>
      <button type="button" class="btn btn-light" *ngIf="url" (click)="copiar()" data-guide="club-wallet-copiar">Copiar enlace</button>
      <button type="button" class="btn btn-primary" (click)="cerrar()">Listo</button>
    </footer>
  </dialog>`,
  styles: [`
    .wl { width: min(520px, 92vw); padding: 24px; }
    .wl::backdrop { background: var(--wx-dialogo-velo); }
    header, footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    footer { margin-top: 20px; justify-content: flex-end; }
    .wl__cuerpo { display: flex; gap: 18px; align-items: center; margin-top: 8px; }
    .wl__qr { width: 176px; height: 176px; flex: none; border-radius: var(--wx-radius-md); background: #fff; padding: 8px; image-rendering: pixelated; }
    .wl__tenue { color: var(--wx-text-muted); font-size: var(--wx-text-sm); margin: 6px 0 0; }
    .wl__carga { display: flex; align-items: center; gap: 10px; color: var(--wx-text-muted); }
    .wl__error { color: var(--wx-danger); }
    .wl__copiado { color: var(--wx-success-ink); font-size: var(--wx-text-sm); margin: 10px 0 0; }
    @media (max-width: 480px) { .wl__cuerpo { flex-direction: column; } }
  `],
})
export class ClubWalletComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) customerId!: number;
  @Output() close = new EventEmitter<void>();
  @ViewChild('dialog') dialog!: ElementRef<HTMLDialogElement>;
  private readonly pantalla = inject(CustomerDisplayService);
  busy = true;
  error = '';
  qr = '';
  url = '';
  nombre = '';
  copiado = false;
  enPantalla = false;

  ngAfterViewInit() {
    this.dialog.nativeElement.showModal();
    void this.emitir();
  }
  ngOnDestroy() {
    if (this.enPantalla) this.pantalla.finWallet();
    this.dialog?.nativeElement.close();
  }

  cerrar() { this.close.emit(); }

  private async emitir() {
    try {
      const marca = ADDON?.tarjetaWallet ? await marcaPng(ADDON.tarjetaWallet) : null;
      const r = await (window as any).electronAPI.clubWalletEmitir({ customerId: this.customerId, marca });
      if (!r?.success) throw Error(r?.error || 'No se pudo preparar la tarjeta.');
      this.url = r.data.url;
      this.nombre = r.data.nombre || '';
      this.qr = await QRCode.toDataURL(this.url, { errorCorrectionLevel: 'M', margin: 1, width: 352 });
      this.pantalla.showWallet({ qr: this.qr, nombre: this.nombre });
      this.enPantalla = true;
    } catch (e: any) {
      this.error = e.message;
    } finally {
      this.busy = false;
    }
  }

  async copiar() {
    try { await navigator.clipboard.writeText(this.url); this.copiado = true; } catch { this.error = 'No se pudo copiar el enlace.'; }
  }
}

/** Logo del hueco -> PNG (480×150, transparente) e icono (87×87 sobre el fondo de la marca). */
async function marcaPng(t: TarjetaWallet): Promise<Record<string, string | null>> {
  const base = { fondo: t.fondo, texto: t.texto, etiqueta: t.etiqueta, logo_png: null as string | null, icon_png: null as string | null };
  if (!t.logo) return base;
  try {
    const img = new Image();
    img.src = t.logo;
    await img.decode();
    const pintar = (w: number, h: number, margen: number, fondo: string | null) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d')!;
      if (fondo) { g.fillStyle = fondo; g.fillRect(0, 0, w, h); }
      const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      const k = Math.min((w - 2 * margen) / iw, (h - 2 * margen) / ih);
      g.drawImage(img, (w - iw * k) / 2, (h - ih * k) / 2, iw * k, ih * k);
      return c.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
    };
    return { ...base, logo_png: pintar(480, 150, 6, null), icon_png: pintar(87, 87, 8, t.fondo) };
  } catch {
    return base; // sin logo, el pase sale con sus colores y el nombre del negocio
  }
}
