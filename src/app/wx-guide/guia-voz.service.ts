import { Injectable, signal } from '@angular/core';

/**
 * LA VOZ DE WYBIX: el texto aparece como si alguien lo estuviera diciendo.
 *
 * No a velocidad de maquina de escribir fija, que se lee robotica: cada letra
 * tarda un poco distinto -la variacion sale de su POSICION, nunca del azar, asi
 * que dos veces el mismo texto suena igual- y la puntuacion respira: una coma
 * es una pausa corta, un punto una pausa de verdad.
 *
 * Tocar mientras escribe completa la frase; el que decide cuando seguir es
 * quien lee. Con «reducir movimiento» no hay letra a letra: la frase aparece
 * entera, de una vez.
 *
 * `completo` lleva siempre la frase entera: es lo que se anuncia a un lector de
 * pantalla, una vez, en lugar de deletrearla caracter a caracter.
 */
@Injectable({ providedIn: 'root' })
export class GuiaVozService {
  readonly texto = signal('');
  readonly completo = signal('');
  readonly escribiendo = signal(false);

  private turno = 0;
  private reloj: any = null;
  private terminar: (() => void) | null = null;
  /** Suelta a quien espera la frase si se cancela: nadie se queda esperando una frase que no va a terminar. */
  private soltar: (() => void) | null = null;
  private pausada = false;
  private alReanudar: (() => void) | null = null;

  private calma(): boolean {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
  }

  /** Dice la frase. Resuelve cuando se termino de ver (sola o tocada). */
  decir(frase: string): Promise<void> {
    this.cancelar();
    const mio = ++this.turno;
    this.completo.set(frase);
    if (this.calma() || !frase) {
      this.texto.set(frase);
      this.escribiendo.set(false);
      return Promise.resolve();
    }
    this.texto.set('');
    this.escribiendo.set(true);
    return new Promise<void>((resolve) => {
      this.soltar = resolve;
      this.terminar = () => {
        if (mio !== this.turno) return;
        clearTimeout(this.reloj);
        this.texto.set(frase);
        this.escribiendo.set(false);
        this.terminar = null;
        this.soltar = null;
        resolve();
      };
      let n = 0;
      const tick = () => {
        if (mio !== this.turno) return;
        if (this.pausada) { this.alReanudar = tick; return; }
        n++;
        this.texto.set(frase.slice(0, n));
        if (n >= frase.length) { this.terminar?.(); return; }
        this.reloj = setTimeout(tick, this.ritmo(frase, n - 1));
      };
      this.reloj = setTimeout(tick, 60);
    });
  }

  /** Cuanto espera despues del caracter `i`. */
  private ritmo(frase: string, i: number): number {
    const c = frase[i];
    const sig = frase[i + 1] ?? ' ';
    if ('.!?…'.includes(c) && sig === ' ') return 310;
    if (',;:'.includes(c)) return 150;
    if (c === '—') return 160;
    if (c === ' ') return 14;
    return 22 + ((i * 7) % 11);
  }

  /** «Muéstramelo ya.» */
  completar(): boolean {
    if (!this.escribiendo()) return false;
    this.terminar?.();
    return true;
  }

  cancelar() {
    this.turno++;
    clearTimeout(this.reloj);
    this.terminar = null;
    this.alReanudar = null;
    this.escribiendo.set(false);
    const soltar = this.soltar;
    this.soltar = null;
    soltar?.();
  }

  pausar() { this.pausada = true; }

  reanudar() {
    this.pausada = false;
    const f = this.alReanudar;
    this.alReanudar = null;
    if (f) f();
  }

  callar() {
    this.cancelar();
    this.texto.set('');
    this.completo.set('');
  }
}
