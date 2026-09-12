import {
  ChangeDetectorRef, Component, EventEmitter, Input, OnDestroy, Output, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  CustomerDisplayService, LoyaltyService, ResultadoDinamica,
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

  @Output() terminado = new EventEmitter<ResultadoDinamica>();
  @Output() cerrado = new EventEmitter<void>();

  corriendo = signal(false);
  centesimas = signal(0);
  enviando = signal(false);
  resultado = signal<ResultadoDinamica | null>(null);

  private t0 = 0;
  private raf: any = null;
  private ultimoPush = 0;

  ngOnDestroy(): void { this.pararReloj(); }

  get esPreview(): boolean { return this.modo === 'PREVIEW'; }
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
