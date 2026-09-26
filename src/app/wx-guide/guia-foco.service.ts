import { Injectable } from '@angular/core';
import type { Driver } from 'driver.js';

/**
 * EL FOCO: Driver.js, invisible.
 *
 * Driver hace tres cosas y solo tres: oscurece la pantalla dejando un hueco
 * sobre el elemento, lo lleva a la vista y lo mantiene encuadrado si la
 * pagina se mueve. Su globo, sus botones y su «Next / Previous» NO se usan:
 * lo que habla es el presentador de Wybix. Se le pide cada paso por separado
 * (`highlight`), asi que el recorrido lo lleva nuestro motor, no el suyo.
 *
 * Los colores salen de los tokens (`--wx-guide-velo` en tokens.css) y el
 * marco del hueco lo dibuja la hoja de Wybix Guide, no la de Driver.
 */
@Injectable({ providedIn: 'root' })
export class GuiaFocoService {
  private d: Driver | null = null;
  private fuera: (() => void) | null = null;
  /* Driver se descarga la primera vez que hace falta: una caja que nunca abre
     un recorrido no lo paga. */
  private libreria: Promise<typeof import('driver.js')> | null = null;
  private turno = 0;

  /** Lo llama el motor: que hacer si tocan fuera del hueco. */
  alTocarFuera(f: (() => void) | null) { this.fuera = f; }

  private calma(): boolean {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
  }

  private async motor(): Promise<Driver> {
    if (this.d) return this.d;
    this.libreria ??= import('driver.js');
    const { driver } = await this.libreria;
    if (this.d) return this.d;
    const velo = getComputedStyle(document.documentElement).getPropertyValue('--wx-guide-velo').trim() || 'rgb(6, 11, 17)';
    this.d = driver({
      animate: !this.calma(),
      smoothScroll: !this.calma(),
      overlayColor: velo,
      overlayOpacity: 0.58,
      stagePadding: 8,
      stageRadius: 12,
      allowClose: false,
      allowKeyboardControl: false,
      disableActiveInteraction: false,
      showButtons: [],
      popoverClass: 'wx-guide-driver',
      overlayClickBehavior: () => this.fuera?.(),
    });
    return this.d;
  }

  /** Enciende el foco sobre el elemento. Sin elemento, no hay velo. */
  async resaltar(el: Element | null): Promise<void> {
    const mio = ++this.turno;
    if (!el) { this.apagar(); return; }
    const d = await this.motor();
    /* Si mientras se descargaba se pidio otro foco (o ninguno), gana el ultimo. */
    if (mio !== this.turno || !el.isConnected) return;
    d.highlight({ element: el });
    /* Driver quita la marca del objetivo anterior por su estado interno; si un
       paso llega antes de que termine la transicion del anterior, la marca se
       queda en los dos. Solo puede haber UN objetivo. */
    document.querySelectorAll('.driver-active-element').forEach((x) => {
      if (x !== el) x.classList.remove('driver-active-element', 'driver-no-interaction');
    });
  }

  /** Vuelve a encuadrar (el elemento se movio o cambio de tamaño). */
  reencuadrar() { this.d?.refresh(); }

  apagar() {
    this.turno++;
    if (!this.d) return;
    try { this.d.destroy(); } catch { /* ya estaba */ }
    this.d = null;
  }
}
