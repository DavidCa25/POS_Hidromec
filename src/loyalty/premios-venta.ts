import {
  ChangeDetectorRef, Component, EventEmitter, Input, OnDestroy, Output, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  CustomerDisplayService, DynamicPending, LoyaltyAward, LoyaltyService, ResultadoDinamica,
} from '../core';

/*
 * Lo que la venta acaba de ganar, en la pantalla de la caja.
 *
 * Una sola pieza para Retail y para Touch. Las dos experiencias cobran por
 * SaleService.checkout(), que ya devuelve los premios: si cada una pintara
 * los suyos habria dos sitios donde arreglar el mismo fallo y solo uno se
 * arreglaria.
 *
 * La dinamica se juega AQUI, en el equipo, y se refleja en la pantalla del
 * cliente. La pantalla del cliente es un segundo monitor sin entrada: pedirle
 * al cliente que pulse alli seria pedirle que pulse una foto.
 *
 * El cronometro lo mide el navegador -no hay otra forma de medir un reflejo-
 * pero quien decide si eso es ganar o perder es SQL, con el intento marcado
 * en la misma transaccion.
 */
@Component({
  selector: 'app-premios-venta',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './premios-venta.html',
  styleUrls: ['./premios-venta.css'],
})
export class PremiosVenta implements OnDestroy {
  private readonly loyalty = inject(LoyaltyService);
  private readonly display = inject(CustomerDisplayService);
  private readonly cd = inject(ChangeDetectorRef);

  /**
   * Los premios de la venta. Al asignarse se empujan a la pantalla del
   * cliente: es el momento en que el cliente sigue delante.
   */
  @Input() set premios(v: LoyaltyAward[] | null | undefined) {
    this._premios = v ?? [];
    this.resultado.set(null);
    this.jugando.set(false);
    if (this._premios.length) {
      this.display.showPremios(this._premios.map(p => ({
        tipo: p.tipo, nombre: p.nombre, codigo: p.codigo, numero: p.numero,
      })));
    }
  }
  get premios(): LoyaltyAward[] { return this._premios; }
  private _premios: LoyaltyAward[] = [];

  /** La venta que se acaba de cobrar. Hace falta para pedir la dinamica. */
  @Input() saleId: number | null = null;

  @Output() cerrado = new EventEmitter<void>();

  /**
   * La dinamica con todos sus datos: nombre, instruccion, objetivo y margen.
   *
   * El premio de la venta solo trae el token. El resto se pide con
   * sp_dynamic_pending, que ademas comprueba que el intento siga vivo y sin
   * caducar: asi no se abre un juego que SQL va a rechazar al enviarlo.
   */
  pendiente = signal<DynamicPending | null>(null);
  preparando = signal(false);

  jugando = signal(false);
  corriendo = signal(false);
  transcurrido = signal(0);
  enviando = signal(false);
  resultado = signal<ResultadoDinamica | null>(null);

  private t0 = 0;
  private raf: any = null;
  /** Ultimo valor empujado a la pantalla de cliente, para no saturar el IPC. */
  private ultimoPush = 0;

  ngOnDestroy(): void {
    this.pararReloj();
  }

  /** La dinamica pendiente de esta venta, si la hay. */
  get dinamica(): LoyaltyAward | null {
    return this._premios.find(p => p.tipo === 'DYNAMIC' && !!p.token) ?? null;
  }

  /** Los premios que ya son firmes: todo lo que no haya que jugarse. */
  get ganados(): LoyaltyAward[] {
    return this._premios.filter(p => p.tipo !== 'DYNAMIC');
  }

  icono(p: LoyaltyAward): string {
    switch (p.tipo) {
      case 'REWARD': return 'ph-gift';
      case 'COUPON': return 'ph-ticket';
      case 'DYNAMIC': return 'ph-game-controller';
      case 'RAFFLE_ENTRY': return 'ph-confetti';
      default: return 'ph-star';
    }
  }

  etiqueta(p: LoyaltyAward): string {
    switch (p.tipo) {
      case 'REWARD': return 'Recompensa';
      case 'COUPON': return 'Cupón para su próxima visita';
      case 'RAFFLE_ENTRY': return 'Boleto de rifa';
      case 'DYNAMIC': return 'Dinámica';
      default: return '';
    }
  }

  /** El codigo o el numero: lo unico que el cliente tiene que llevarse. */
  codigo(p: LoyaltyAward): string | null {
    if (p.codigo) return p.codigo;
    if (p.numero != null) return `Boleto ${p.numero}`;
    return null;
  }

  // -------------------------------------------------------- la dinamica
  async abrirDinamica(): Promise<void> {
    if (!this.dinamica || !this.saleId) return;
    this.preparando.set(true);
    try {
      const [p] = await this.loyalty.dinamicasPendientes(this.saleId);
      if (!p) {
        // El intento ya no esta disponible (caducado o jugado en otro sitio).
        // Se dice, en vez de abrir un cronometro que no va a contar para nada.
        this.resultado.set({
          ok: false, motivo: 'sin-intento', resultado: null, codigo: null, premio: null,
          mensaje: 'Esta dinámica ya no está disponible.',
        });
        this.jugando.set(true);
        return;
      }
      this.pendiente.set(p);
      this.resultado.set(null);
      this.transcurrido.set(0);
      this.corriendo.set(false);
      this.jugando.set(true);
      this.empujarCrono(false);
    } finally {
      this.preparando.set(false);
      this.cd.detectChanges();
    }
  }

  arrancar(): void {
    if (this.corriendo()) return;
    this.transcurrido.set(0);
    this.t0 = performance.now();
    this.corriendo.set(true);
    this.ultimoPush = 0;
    this.tic();
  }

  /**
   * El bucle del cronometro.
   *
   * `requestAnimationFrame` y no `setInterval`: un cronometro que el cliente
   * esta mirando tiene que ir al ritmo de la pantalla, no al de un temporizador
   * que se desfasa.
   */
  private tic = (): void => {
    if (!this.corriendo()) return;
    const s = (performance.now() - this.t0) / 1000;
    this.transcurrido.set(s);
    // A la pantalla del cliente, ~20 veces por segundo. A 60 serian 60 IPC
    // por segundo para mover dos decimales que el ojo no distingue.
    if (s - this.ultimoPush >= 0.05) { this.ultimoPush = s; this.empujarCrono(true); }
    this.cd.detectChanges();
    this.raf = requestAnimationFrame(this.tic);
  };

  private pararReloj(): void {
    this.corriendo.set(false);
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; }
  }

  /**
   * Parar y enviar.
   *
   * El valor viaja a SQL y SQL decide. El boton se bloquea con `enviando`
   * porque el procedure marca el intento con un UPDATE condicional: un
   * segundo envio no premiaria dos veces, pero devolveria "ya jugado" y eso
   * es un susto que no hace falta dar.
   */
  async parar(): Promise<void> {
    if (!this.corriendo() || this.enviando()) return;
    this.pararReloj();
    const segundos = this.transcurrido();
    this.empujarCrono(false);

    const d = this.pendiente();
    if (!d?.token) return;

    this.enviando.set(true);
    try {
      const r = await this.loyalty.jugar(d.token, Number(segundos.toFixed(3)));
      this.resultado.set(r);
      this.display.showResultadoDinamica({
        gano: r.resultado === 'WIN',
        mensaje: r.mensaje,
        premio: r.premio,
        codigo: r.codigo,
      });
    } catch (e: any) {
      this.resultado.set({
        ok: false, motivo: 'error', resultado: null, codigo: null, premio: null,
        mensaje: e?.message || 'No se pudo enviar el resultado.',
      });
    } finally {
      this.enviando.set(false);
      this.cd.detectChanges();
    }
  }

  private empujarCrono(corriendo: boolean): void {
    const d = this.pendiente();
    if (!d) return;
    this.display.showDinamica({
      nombre: d.name || 'Dinámica',
      instruccion: d.description ?? null,
      objetivo: this.objetivo,
      margen: this.margen,
      transcurrido: this.transcurrido(),
      corriendo,
    });
  }

  /** A qué segundo hay que apuntar. Lo dice la definicion, no esta pantalla. */
  get objetivo(): number | null {
    const n = Number(this.pendiente()?.target_value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  get margen(): number | null {
    const n = Number(this.pendiente()?.tolerance);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  cerrar(): void {
    this.pararReloj();
    this.cerrado.emit();
  }
}
