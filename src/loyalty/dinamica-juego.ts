import {
  ChangeDetectorRef, Component, EventEmitter, Input, OnDestroy, Output, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  CustomerDisplayService, LoyaltyService, ResultadoDinamica, WheelSegment,
  aciertaTiming, segundosDe,
} from '../core';

/*
 * El puente entre una dinamica y la pantalla del cliente.
 *
 * ESTE COMPONENTE NO PINTA EL JUEGO. Antes lo hacia, y el resultado eran dos
 * ruletas jugables a la vez: una en la caja y otra en la pantalla del cliente.
 * La experiencia pertenece a UNA pantalla, la del cliente; aqui solo queda el
 * estado, para que quien administra sepa que esta pasando.
 *
 * REPARTO DE RESPONSABILIDADES
 *   PANTALLA DEL CLIENTE  presenta, anima y recoge la intencion del cliente.
 *   ESTE COMPONENTE       lanza la partida, escucha esa intencion y la
 *                         convierte en una jugada.
 *   SQL                   decide, persiste y entrega el premio.
 *
 * MODOS
 *   LIVE     hay token: decide `sp_dynamic_play`.
 *   PREVIEW  no hay intento, asi que no hay nada que SQL pueda decidir. El
 *            espejo de `core/dinamicas` aplica la MISMA regla sobre los
 *            mismos enteros, y no se otorga nada.
 */
export type ModoJuego = 'LIVE' | 'PREVIEW';

export interface DefinicionJugable {
  name: string;
  description: string | null;
  type: string;
  target_value: number | null;
  reward_name?: string | null;
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
  @Input() token: string | null = null;
  @Input() segmentos: WheelSegment[] = [];

  @Input() set definicion(d: DefinicionJugable | null) {
    this._def = d;
    if (d) this.lanzar();
  }
  get definicion(): DefinicionJugable | null { return this._def; }
  private _def: DefinicionJugable | null = null;

  @Output() terminado = new EventEmitter<ResultadoDinamica>();
  @Output() cerrado = new EventEmitter<void>();

  /** Que esta pasando, para quien administra. No es el juego: es su estado. */
  fase = signal<'LISTA' | 'JUGANDO' | 'GIRANDO' | 'RESULTADO'>('LISTA');
  resultado = signal<ResultadoDinamica | null>(null);
  ocupado = signal(false);

  private escuchando = false;

  ngOnDestroy(): void {
    // La pantalla del cliente vuelve a lo suyo: dejarla con una partida a
    // medias seria dejar un cronometro parado delante de alguien.
    try { this.display.idle(); } catch { /* noop */ }
  }

  get esPreview(): boolean { return this.modo === 'PREVIEW'; }
  get esRuleta(): boolean { return (this._def?.type || '') === 'WHEEL'; }

  private get sectores(): WheelSegment[] {
    return (this.segmentos || []).filter(s => s.active);
  }

  /** Lo que se puede ganar, en palabras. Va ANTES del juego. */
  private premios(): string[] {
    if (this.esRuleta) {
      return this.sectores
        .filter(s => s.outcome !== 'NONE')
        .map(s => s.outcome === 'REWARD'
          ? (s.reward_name || s.label)
          : `${s.quantity} boleto${s.quantity === 1 ? '' : 's'} de ${s.raffle_name || 'la rifa'}`);
    }
    const p = this._def?.reward_name;
    return p ? [p] : [];
  }

  private get reto(): string {
    if (this.esRuleta) return '¿Te atreves a probar tu suerte?';
    const o = Number(this._def?.target_value);
    return Number.isFinite(o) && o > 0
      ? 'Detén el cronómetro exactamente en'
      : (this._def?.description || '¿Te atreves?');
  }

  /** Manda la partida a la pantalla del cliente y se queda escuchando. */
  private lanzar(): void {
    this.fase.set('LISTA');
    this.resultado.set(null);
    this.ocupado.set(false);
    this.empujar('LISTA');

    if (!this.escuchando) {
      this.escuchando = true;
      this.display.alPulsarCliente(a => this.alPulsar(a));
    }
  }

  /**
   * Lo que el cliente pulso.
   *
   * Llega como intencion. `STOP_TIMING` trae las centesimas que se estaban
   * MOSTRANDO, que es exactamente lo que hay que juzgar; nunca un "he ganado".
   */
  private async alPulsar(a: { tipo: string; centesimas?: number }): Promise<void> {
    if (!this._def) return;

    if (a?.tipo === 'START_TIMING') {
      this.fase.set('JUGANDO');
      this.cd.detectChanges();
      return;
    }

    if (a?.tipo === 'STOP_TIMING') {
      await this.resolver(async () => {
        const c = Number(a.centesimas) || 0;
        if (this.esPreview) {
          const gana = aciertaTiming(c, this._def!.target_value);
          return this.dePrueba(gana, gana ? (this._def!.reward_name || 'Premio') : null);
        }
        return this.loyalty.jugar(this.token!, segundosDe(c));
      });
      return;
    }

    if (a?.tipo === 'SPIN') {
      await this.resolver(async () => {
        if (this.esPreview) {
          const s = DinamicaJuego.sorteoDePrueba(this.sectores);
          const r = this.dePrueba(s.outcome !== 'NONE',
            s.outcome === 'NONE' ? null : (s.reward_name || s.raffle_name || s.label));
          r.segmento_id = s.id;
          r.segmento = s.label;
          return r;
        }
        // La ruleta no pregunta nada al renderer: decide el servidor.
        return this.loyalty.jugar(this.token!, 0);
      }, true);
    }
  }

  /**
   * Pide el veredicto y lo lleva a la pantalla.
   *
   * En la ruleta hay un paso mas: primero se anima HACIA el sector que ya
   * salio, y el resultado se ensena cuando la rueda para. Al reves, el angulo
   * seria quien reparte los premios.
   */
  private async resolver(pedir: () => Promise<ResultadoDinamica>, girar = false): Promise<void> {
    if (this.ocupado()) return;
    this.ocupado.set(true);
    let r: ResultadoDinamica;
    try {
      r = await pedir();
    } catch (e: any) {
      r = {
        ok: false, motivo: 'ERROR', resultado: null, codigo: null, premio: null,
        mensaje: e?.message || 'No se pudo jugar.',
      };
    }
    this.resultado.set(r);

    if (girar && r.ok) {
      const i = this.sectores.findIndex(s => s.id === r.segmento_id);
      this.fase.set('GIRANDO');
      this.empujar('GIRANDO', r, i >= 0 ? i : 0);
      this.cd.detectChanges();
      // Lo que tarda la rueda en frenar, mas un respiro.
      window.setTimeout(() => this.terminar(r), 5400);
      return;
    }
    this.terminar(r);
  }

  private terminar(r: ResultadoDinamica): void {
    this.fase.set('RESULTADO');
    this.ocupado.set(false);
    this.empujar('RESULTADO', r);
    this.terminado.emit(r);
    this.cd.detectChanges();
  }

  private empujar(fase: 'LISTA' | 'JUGANDO' | 'GIRANDO' | 'RESULTADO',
                  r?: ResultadoDinamica, ganadorIndice?: number): void {
    const d = this._def;
    if (!d) return;
    this.display.showDinamica({
      tipo: this.esRuleta ? 'WHEEL' : 'TIMING',
      fase,
      nombre: d.name || 'Dinámica',
      reto: fase === 'LISTA' ? this.reto : (d.name || ''),
      premios: fase === 'LISTA' ? this.premios() : [],
      objetivo: Number(d.target_value) || null,
      sectores: this.esRuleta ? this.sectores.map(s => s.label) : undefined,
      ganadorIndice: ganadorIndice ?? null,
      gano: r ? r.resultado === 'WIN' : undefined,
      mensaje: r ? (r.resultado === 'WIN' ? '¡GANASTE!' : r.ok ? 'CASI' : r.mensaje) : undefined,
      premioGanado: r?.premio ?? null,
      codigo: r?.codigo ?? null,
    });
  }

  /** Un resultado de prueba. No toca nada: ni intentos, ni premios. */
  private dePrueba(gana: boolean, premio: string | null): ResultadoDinamica {
    return {
      ok: true, motivo: 'PREVIEW', resultado: gana ? 'WIN' : 'LOSE',
      codigo: null, premio: gana ? premio : null,
      mensaje: gana ? '¡Ganaste!' : 'Casi',
    };
  }

  /** Sorteo por peso, SOLO para la vista previa. Mismo metodo que el servidor. */
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

  reiniciar(): void { this.lanzar(); }
  cerrar(): void { this.cerrado.emit(); }
}
