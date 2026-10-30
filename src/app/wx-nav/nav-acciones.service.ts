import { Injectable, computed, inject, signal } from '@angular/core';
import { CapabilityService } from '../../core';
import { NavegacionService } from './navegacion.service';

/**
 * LAS ACCIONES DE LA NAVEGACION, UNA SOLA VEZ.
 *
 * El dock y la barra lateral son la MISMA navegacion con dos disenos. Las
 * areas y los destinos ya salian de `NavegacionService`; las acciones que no
 * son un destino (Checar, Aprobaciones, Apps Wybix) vivian dentro del dock, y
 * por eso la barra lateral no las tenia: Checar se agrego al dock y faltaba en
 * la barra. Aqui viven su estado y quien las ve, y las dos formas solo las
 * pintan. `scripts/pruebas/navegacion-paridad.mjs` falla si una forma ofrece
 * algo que la otra no.
 *
 * Para agregar una accion: su estado y su regla aqui, y un boton en CADA forma
 * con el mismo `data-guide`.
 */
@Injectable({ providedIn: 'root' })
export class NavAccionesService {
  private readonly nav = inject(NavegacionService);
  private readonly caps = inject(CapabilityService);

  // ----------------------------------------------------------- checar
  /** 0071: Checar desde cualquier pantalla, con la aplicacion Asistencia activada. */
  readonly verChecar = computed(() => this.caps.capabilities().asistencia);
  readonly checarAbierto = signal(false);
  abrirChecar(): void { if (this.verChecar()) this.checarAbierto.set(true); }
  cerrarChecar(): void { this.checarAbierto.set(false); }

  // ------------------------------------------------------- apps wybix
  /** Instalar y vincular las apps de Wybix es decision del dueno: solo Administrador. */
  get verApps(): boolean { return this.nav.administrarNegocio; }

  // ----------------------------------------------------- aprobaciones
  /*
   * Si el negocio pide PIN o la app del dueno para retiros, egresos,
   * devoluciones, ajustes, compras y cajon sin venta. Solo lo ven y lo cambian
   * el Encargado y el Administrador; el proceso principal lo vuelve a exigir
   * en su canal. Apagarlas pide confirmar: cambia quien puede sacar dinero del
   * cajon, y queda en bitacora con aviso al dueno.
   */
  get verAprobaciones(): boolean { return this.nav.cambiarAprobaciones; }
  readonly aprobaciones = signal<{ activas: boolean; origen: string } | null>(null);
  readonly aprobConfirmar = signal(false);
  readonly aprobGuardando = signal(false);
  readonly aprobError = signal('');

  async cargarAprobaciones(): Promise<void> {
    this.aprobConfirmar.set(false);
    this.aprobError.set('');
    try {
      const r = await (window as any).electronAPI?.aprobacionesPolitica?.();
      this.aprobaciones.set(r?.success ? r.data : null);
      if (!r?.success) this.aprobError.set(r?.error || 'No se pudo leer.');
    } catch { this.aprobaciones.set(null); }
  }

  /** Encender es inmediato; apagar pasa por "¿Seguro?". */
  pulsarAprobaciones(): void {
    const a = this.aprobaciones();
    if (!a || this.aprobGuardando()) return;
    if (a.activas && !this.aprobConfirmar()) { this.aprobConfirmar.set(true); return; }
    void this.cambiarAprobaciones(!a.activas);
  }

  cancelarAprobaciones(): void { this.aprobConfirmar.set(false); }

  private async cambiarAprobaciones(activas: boolean): Promise<void> {
    this.aprobGuardando.set(true);
    this.aprobError.set('');
    try {
      const r = await (window as any).electronAPI?.aprobacionesCambiar?.(activas);
      if (!r?.success) { this.aprobError.set(r?.error || 'No se pudo cambiar.'); return; }
      this.aprobaciones.set(r.data);
      this.aprobConfirmar.set(false);
    } finally {
      this.aprobGuardando.set(false);
    }
  }
}
