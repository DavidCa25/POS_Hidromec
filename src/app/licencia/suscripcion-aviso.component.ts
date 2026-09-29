import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { LicenseService } from '../../services/license.service';

const RENOVAR_URL = 'https://wybix-landing.vercel.app/licencia';

/*
 * AVISOS DE SUSCRIPCIÓN. Uno solo, deliberado, en vez de veinte errores
 * sueltos por la aplicación:
 *
 *   GRACE       «Tu suscripción venció. Te quedan N días de funcionamiento
 *               completo.» Nada se bloquea todavía.
 *   SALE_ONLY   Modo Venta Esencial: se vende; lo demás vuelve al renovar.
 *   Refrescar   el certificado necesita validarse pronto (sin Internet: importar).
 *   Renovó      «El inventario no se actualizó durante la Venta Esencial»:
 *               cuántas ventas y de qué fecha a qué fecha. No se corrige nada
 *               solo; se recomienda un conteo.
 *
 * Mismo patrón que el aviso de prueba: una pastilla que se pliega, sin tapar
 * «Cobrar».
 */
@Component({
  selector: 'app-suscripcion-aviso',
  standalone: true,
  imports: [CommonModule, DatePipe],
  template: `
  @if (revision(); as r) {
    <div class="sa-velo" role="dialog" aria-modal="true" aria-labelledby="sa-inv-t">
      <div class="sa-hoja">
        <span class="sa-ic"><i class="ph ph-clipboard-text" aria-hidden="true"></i></span>
        <h2 id="sa-inv-t">Inventario requiere revisión</h2>
        <p>El inventario no se actualizó durante el periodo de Venta Esencial
          @if (r.ventas) { ({{ r.ventas }} {{ r.ventas === 1 ? 'venta' : 'ventas' }}, del {{ r.desde | date:'longDate' }} al {{ r.hasta | date:'longDate' }}) }.
        </p>
        <p>Te recomendamos hacer un conteo de inventario antes de volver a confiar en las existencias. Puedes seguir vendiendo mientras tanto.</p>
        <button type="button" class="sa-btn" (click)="descartar()">Entendido</button>
      </div>
    </div>
  }

  @if (mensaje(); as m) {
    @if (!plegada()) {
      <div class="sa-chip" [class.fuerte]="m.fuerte" role="status">
        <i class="ph" [ngClass]="m.icono" aria-hidden="true"></i>
        <span class="sa-txt"><strong>{{ m.titulo }}</strong> {{ m.texto }}</span>
        <button type="button" class="sa-accion" (click)="renovar()">Renovar</button>
        @if (m.importar) {
          <button type="button" class="sa-accion sa-sec" (click)="importar()">Importar licencia</button>
        }
        <button type="button" class="sa-min" (click)="plegada.set(true)" aria-label="Minimizar el aviso">
          <i class="ph ph-caret-right" aria-hidden="true"></i>
        </button>
      </div>
    } @else {
      <button type="button" class="sa-tab" [class.fuerte]="m.fuerte" (click)="plegada.set(false)"
              [attr.aria-label]="m.titulo + '. Mostrar aviso'" [title]="m.titulo">
        <i class="ph" [ngClass]="m.icono" aria-hidden="true"></i>
      </button>
    }
  }
  `,
  styles: [`
    .sa-chip{position:fixed;right:18px;bottom:18px;z-index:1500;display:flex;align-items:center;gap:.6rem;max-width:min(720px,calc(100vw - 36px));
      background: var(--wx-navy-600);color:#fff;border-radius:18px;padding:.55rem .5rem .55rem 1rem;box-shadow: var(--wx-shadow-menu);font-size:.88rem;line-height:1.35;
      animation: sa-entra var(--wx-dur-state) var(--wx-ease-out) both;}
    .sa-chip.fuerte{background:#7c2d12;}
    .sa-chip > i{color: var(--wx-cyan-400);font-size:1.1rem;flex:0 0 auto;}
    .sa-chip.fuerte > i{color:#fdba74;}
    .sa-txt{flex:1;min-width:0;}
    .sa-txt strong{font-weight:600;}
    .sa-accion{flex:0 0 auto;border:0;border-radius:999px;padding:.4rem .9rem;background:#fff;color:#0F2A3F;font-weight:600;cursor:pointer;}
    .sa-sec{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.4);}
    .sa-accion:active{transform:scale(.97);}
    .sa-min{flex:0 0 auto;width:30px;height:30px;border:0;border-radius:50%;background:rgba(255,255,255,.12);color:#fff;cursor:pointer;}
    .sa-tab{position:fixed;right:0;bottom:84px;z-index:1500;width:34px;height:40px;border:0;border-radius:12px 0 0 12px;background: var(--wx-navy-600);color:#fff;cursor:pointer;}
    .sa-tab.fuerte{background:#7c2d12;}
    .sa-velo{position:fixed;inset:0;z-index:2100;background: var(--wx-scrim);display:flex;align-items:center;justify-content:center;padding:1rem;}
    .sa-hoja{width:min(460px,100%);background: var(--wx-surface);color: var(--wx-text);border-radius:18px;padding:1.6rem;box-shadow: var(--wx-shadow-dialog);text-align:center;}
    .sa-hoja h2{margin:.6rem 0 .4rem;font-size:1.2rem;font-weight:600;}
    .sa-hoja p{margin:0 0 .8rem;color: var(--wx-text-muted);font-size:.92rem;line-height:1.45;}
    .sa-ic{display:inline-flex;width:52px;height:52px;border-radius:50%;align-items:center;justify-content:center;background: var(--wx-warning-soft);color: var(--wx-warning);font-size:1.5rem;}
    .sa-btn{margin-top:.4rem;width:100%;border:0;border-radius:12px;padding:.8rem;background: var(--wx-accent);color: var(--wx-accent-ink);font-weight:600;cursor:pointer;}
    @keyframes sa-entra{from{opacity:0;transform:translateY(8px) scale(.98);}to{opacity:1;transform:none;}}
    @media (prefers-reduced-motion: reduce){.sa-chip{animation:none;}}
  `]
})
export class SuscripcionAvisoComponent implements OnInit {
  private readonly license = inject(LicenseService);
  readonly plegada = signal(false);
  readonly revision = signal<{ ventas: number; desde: string; hasta: string } | null>(null);

  readonly mensaje = computed(() => {
    const e = this.license.estadoSignal();
    if (e.modo === 'SALE_ONLY') {
      return e.motivo === 'SIN_VALIDAR'
        ? { fuerte: true, icono: 'ph-wifi-slash', importar: true, titulo: 'Tu licencia necesita validarse.',
            texto: 'Wybix sigue vendiendo. Conéctate a Internet o importa tu archivo de licencia para recuperar todas las funciones.' }
        : { fuerte: true, icono: 'ph-storefront', importar: true, titulo: 'Tu suscripción ya no está activa.',
            texto: 'Wybix sigue permitiendo ventas básicas. Renueva para recuperar Inventario, Compras, Servicios, Restaurante y las demás funciones de tu plan.' };
    }
    if (e.modo === 'GRACE') {
      const d = e.daysRemaining ?? 0;
      return { fuerte: d <= 7, icono: 'ph-clock-countdown', importar: false, titulo: 'Tu suscripción venció.',
               texto: `Te ${d === 1 ? 'queda 1 día' : `quedan ${d} días`} de funcionamiento completo. Renueva para mantener todas las funciones.` };
    }
    if (e.refrescarEnDias != null && ['ACTIVE', 'GRACE'].includes(e.modo ?? '')) {
      const d = e.refrescarEnDias;
      return { fuerte: false, icono: 'ph-arrows-clockwise', importar: true, titulo: 'Valida tu licencia pronto.',
               texto: `Conecta Wybix a Internet en ${d === 1 ? 'el próximo día' : `los próximos ${d} días`}, o importa tu archivo de licencia.` };
    }
    return null;
  });

  async ngOnInit() {
    if (!this.license.estado.revisionInventario) return;
    try {
      const r = await (window as any).electronAPI?.licenseInventoryReview?.();
      if (r?.success && r.data) this.revision.set(r.data);
    } catch { /* el aviso puede esperar al siguiente arranque */ }
  }

  async descartar() {
    this.revision.set(null);
    try { await (window as any).electronAPI?.licenseInventoryReviewDismiss?.(); } catch { /* noop */ }
  }

  renovar() {
    const api = (window as any).electronAPI;
    if (api?.openExternal) { api.openExternal(RENOVAR_URL); return; }
    try { window.open(RENOVAR_URL, '_blank'); } catch { /* noop */ }
  }

  async importar() { await this.license.importar(); }
}
