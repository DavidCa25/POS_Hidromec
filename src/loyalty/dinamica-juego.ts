import {
  ChangeDetectorRef, Component, EventEmitter, Input, OnDestroy, Output, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  CustomerDisplayService, LoyaltyService, ResultadoDinamica, WheelSegment,
  aciertaTiming, centesimasDe, segundosDe, textoCentesimas,
} from '../core';

/*
 * El juego de una dinamica. UNA sola implementacion.
 *
 * La usan las dos situaciones:
 *
 *   LIVE     nace de una venta, tiene token, y QUIEN DECIDE ES SQL. La caja
 *            manda cuando se paro; nunca si gano.
 *   PREVIEW  la abre el administrador para ver como se ve. No hay intento que
 *            jugar, asi que no hay nada que SQL pueda decidir: el veredicto lo
 *            calcula el espejo de `core/dinamicas`, que compara los MISMOS
 *            enteros que compara SQL. No consume intentos, no crea premios,
 *            no toca ninguna metrica.
 *
 * Hacer dos componentes -uno "de verdad" y otro "de prueba"- habria sido
 * garantizar que se separan: el de prueba dejaria de parecerse al real justo
 * cuando mas falta hiciera que se pareciera.
 */
export type ModoJuego = 'LIVE' | 'PREVIEW';

export interface DefinicionJugable {
  name: string;
  description: string | null;
  type: string;
  target_value: number | null;
}

@Component({
  selector: 'app-dinamica-juego',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dinamica-juego.html',
  styleUrls: ['./dinamica-juego.css'],
})
export class DinamicaJuego implements OnDestroy {
  private readonly loyalty = inject(LoyaltyService);
  private readonly display = inject(CustomerDisplayService);
  private readonly cd = inject(ChangeDetectorRef);

  @Input() modo: ModoJuego = 'LIVE';
  /** Solo en LIVE: identifica el intento concreto que se esta jugando. */
  @Input() token: string | null = null;

  @Input() set definicion(d: DefinicionJugable | null) {
    this._def = d;
    this.reiniciar();
  }
  get definicion(): DefinicionJugable | null { return this._def; }
  private _def: DefinicionJugable | null = null;

  /** Los sectores, cuando el juego es una ruleta. */
  @Input() segmentos: WheelSegment[] = [];

  @Output() terminado = new EventEmitter<ResultadoDinamica>();
  @Output() cerrado = new EventEmitter<void>();

  corriendo = signal(false);
  centesimas = signal(0);
  enviando = signal(false);
  resultado = signal<ResultadoDinamica | null>(null);

  // ------------------------------------------------------------- ruleta
  girando = signal(false);
  /** Giro acumulado en grados. Solo estetica: no decide nada. */
  angulo = signal(0);

  private t0 = 0;
  private raf: any = null;
  private ultimoPush = 0;

  ngOnDestroy(): void { this.pararReloj(); }

  get esPreview(): boolean { return this.modo === 'PREVIEW'; }
  get esRuleta(): boolean { return (this._def?.type || '') === 'WHEEL'; }

  /** Los sectores que de verdad se pintan. */
  get sectores(): WheelSegment[] {
    return (this.segmentos || []).filter(s => s.active);
  }

  /**
   * La rueda como degradado conico.
   *
   * Sectores iguales en tamano aunque los pesos sean distintos: la rueda
   * anuncia CUANTOS resultados hay, no como de probable es cada uno.
   * Dibujarlos proporcionales al peso delataria de un vistazo que el sector
   * bueno es una rendija, y ademas invitaria a leer el angulo como si fuera
   * el que decide -que es justo lo que no decide-.
   */
  get fondoRueda(): string {
    const n = this.sectores.length;
    if (!n) return 'var(--wx-sunken)';
    const paso = 360 / n;
    const colores = ['var(--wx-accent)', 'var(--wx-accent-soft)'];
    const tramos = this.sectores.map((_, i) =>
      `${colores[i % 2]} ${i * paso}deg ${(i + 1) * paso}deg`);
    return `conic-gradient(${tramos.join(', ')})`;
  }

  /** Donde cae la etiqueta de cada sector. */
  anguloEtiqueta(i: number): number {
    const n = this.sectores.length || 1;
    return (360 / n) * i + (360 / n) / 2;
  }
  get textoCrono(): string { return textoCentesimas(this.centesimas()); }

  get objetivoTexto(): string {
    const n = Number(this._def?.target_value);
    return Number.isFinite(n) && n > 0 ? n.toFixed(2) : '';
  }

  reiniciar(): void {
    this.pararReloj();
    this.centesimas.set(0);
    this.resultado.set(null);
    this.enviando.set(false);
    this.empujar(false);
  }

  arrancar(): void {
    if (this.corriendo() || this.enviando()) return;
    this.centesimas.set(0);
    this.resultado.set(null);
    this.t0 = performance.now();
    this.ultimoPush = 0;
    this.corriendo.set(true);
    this.tic();
  }

  /**
   * `requestAnimationFrame` y no `setInterval`: un cronometro que alguien esta
   * mirando tiene que ir al ritmo de la pantalla, no al de un temporizador que
   * se desfasa.
   */
  private tic = (): void => {
    if (!this.corriendo()) return;
    const c = centesimasDe(performance.now() - this.t0);
    this.centesimas.set(c);
    // A la pantalla del cliente ~20 veces por segundo: a 60 serian 60 IPC por
    // segundo para mover dos decimales que el ojo no distingue.
    if (c - this.ultimoPush >= 5) { this.ultimoPush = c; this.empujar(true); }
    this.cd.detectChanges();
    this.raf = requestAnimationFrame(this.tic);
  };

  private pararReloj(): void {
    this.corriendo.set(false);
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; }
  }

  async parar(): Promise<void> {
    if (!this.corriendo() || this.enviando()) return;
    this.pararReloj();
    this.empujar(false);
    const centesimas = this.centesimas();

    let r: ResultadoDinamica;
    if (this.esPreview) {
      // Sin intento no hay nada que SQL pueda decidir. El espejo compara los
      // mismos enteros, asi que la vista previa se comporta igual que la
      // partida de verdad, pero no otorga nada.
      const gana = aciertaTiming(centesimas, this._def?.target_value);
      r = {
        ok: true, motivo: 'PREVIEW', resultado: gana ? 'WIN' : 'LOSE',
        codigo: null, premio: null,
        mensaje: gana
          ? '¡Exacto! En una partida real, aquí se entregaría el premio.'
          : 'Esta vez no fue. En una partida real, no se entregaría nada.',
      };
      this.resultado.set(r);
    } else {
      if (!this.token) return;
      this.enviando.set(true);
      try {
        r = await this.loyalty.jugar(this.token, segundosDe(centesimas));
      } catch (e: any) {
        r = {
          ok: false, motivo: 'ERROR', resultado: null, codigo: null, premio: null,
          mensaje: e?.message || 'No se pudo enviar el resultado.',
        };
      } finally {
        this.enviando.set(false);
      }
      this.resultado.set(r);
    }

    this.display.showResultadoDinamica({
      gano: r.resultado === 'WIN',
      mensaje: r.mensaje,
      premio: r.premio,
      codigo: r.codigo,
    });
    this.terminado.emit(r);
    this.cd.detectChanges();
  }

  /**
   * Girar la ruleta.
   *
   * EL ORDEN IMPORTA: primero se pregunta y despues se anima.
   *
   * El servidor elige el sector, lo persiste y entrega el premio; la rueda
   * solo gira hasta donde ya se decidio. Si fuera al reves -animar y luego
   * mirar donde paro- el angulo seria el que reparte los premios, y tocar el
   * angulo desde el renderer bastaria para ganar siempre.
   */
  async girar(): Promise<void> {
    if (this.girando() || this.enviando()) return;
    const sectores = this.sectores;
    if (!sectores.length) return;

    this.resultado.set(null);
    this.enviando.set(true);
    let r: ResultadoDinamica;

    try {
      if (this.esPreview) {
        // Sin intento no hay nada que SQL decida. El espejo sortea por peso,
        // igual que el servidor, y no entrega nada.
        const elegido = DinamicaJuego.sorteoDePrueba(sectores);
        r = {
          ok: true, motivo: 'PREVIEW',
          resultado: elegido.outcome === 'NONE' ? 'LOSE' : 'WIN',
          codigo: null,
          premio: elegido.outcome === 'NONE' ? null : (elegido.reward_name || elegido.raffle_name),
          mensaje: elegido.outcome === 'NONE'
            ? `Salió: ${elegido.label}. En una partida real no se entregaría nada.`
            : `Salió: ${elegido.label}. En una partida real, aquí se entregaría el premio.`,
          segmento_id: elegido.id,
          segmento_orden: elegido.sort_order,
          segmento: elegido.label,
        };
      } else {
        if (!this.token) { this.enviando.set(false); return; }
        // `input_value` no se usa en la ruleta: el servidor no pregunta nada
        // al renderer, decide el solo.
        r = await this.loyalty.jugar(this.token, 0);
      }
    } catch (e: any) {
      r = {
        ok: false, motivo: 'ERROR', resultado: null, codigo: null, premio: null,
        mensaje: e?.message || 'No se pudo girar.',
      };
      this.enviando.set(false);
      this.resultado.set(r);
      this.cd.detectChanges();
      return;
    }

    this.enviando.set(false);

    if (!r.ok) { this.resultado.set(r); this.cd.detectChanges(); return; }

    // Ahora si: animar HACIA el sector que ya salio.
    const i = sectores.findIndex(s => s.id === r.segmento_id);
    const indice = i >= 0 ? i : 0;
    const paso = 360 / sectores.length;
    // Cuatro vueltas antes de parar: sin ellas el giro se lee como un salto.
    const destino = 360 * 4 + (360 - (indice * paso + paso / 2));
    this.girando.set(true);
    this.angulo.set(this.angulo() + destino);
    this.cd.detectChanges();

    window.setTimeout(() => {
      this.girando.set(false);
      this.resultado.set(r);
      this.display.showResultadoDinamica({
        gano: r.resultado === 'WIN',
        mensaje: r.mensaje,
        premio: r.premio,
        codigo: r.codigo,
      });
      this.terminado.emit(r);
      this.cd.detectChanges();
    }, 4200);
  }

  /**
   * Sorteo por peso, SOLO para la vista previa.
   *
   * Mismo metodo que usa el servidor -acumular pesos y recorrer- para que la
   * prueba se comporte como la partida de verdad. En una partida real esto no
   * se ejecuta nunca.
   */
  private static sorteoDePrueba(sectores: WheelSegment[]): WheelSegment {
    const total = sectores.reduce((a, s) => a + Math.max(0, s.weight), 0);
    if (total <= 0) return sectores[0];
    let n = Math.floor(Math.random() * total);
    for (const s of sectores) {
      n -= Math.max(0, s.weight);
      if (n < 0) return s;
    }
    return sectores[sectores.length - 1];
  }

  cerrar(): void {
    this.pararReloj();
    this.cerrado.emit();
  }

  /** El cronometro, a la pantalla del cliente (fisica y de vista previa). */
  private empujar(corriendo: boolean): void {
    const d = this._def;
    if (!d) return;
    this.display.showDinamica({
      nombre: d.name || 'Dinámica',
      instruccion: d.description ?? null,
      objetivo: Number(d.target_value) || null,
      centesimas: this.centesimas(),
      corriendo,
    });
  }
}
