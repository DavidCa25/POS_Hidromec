import {
  ChangeDetectorRef, Component, EventEmitter, Input, Output, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { CustomerDisplayService, DynamicPending, LoyaltyAward, LoyaltyService } from '../core';
import { DinamicaJuego } from './dinamica-juego';

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
  imports: [CommonModule, DinamicaJuego],
  templateUrl: './premios-venta.html',
  styleUrls: ['./premios-venta.css'],
})
export class PremiosVenta {
  private readonly loyalty = inject(LoyaltyService);
  private readonly display = inject(CustomerDisplayService);
  private readonly cd = inject(ChangeDetectorRef);

  /**
   * Los premios de la venta. Al asignarse se empujan a la pantalla del
   * cliente: es el momento en que el cliente sigue delante.
   */
  @Input() set premios(v: LoyaltyAward[] | null | undefined) {
    this._premios = v ?? [];
    this.jugando.set(false);
    this.pendiente.set(null);
    this.sinIntento.set(null);
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
   * La dinamica con todos sus datos: nombre, instruccion y objetivo.
   *
   * El premio de la venta solo trae el token. El resto se pide con
   * sp_dynamic_pending, que ademas comprueba que el intento siga vivo y sin
   * caducar: asi no se abre un juego que SQL va a rechazar al enviarlo.
   */
  pendiente = signal<DynamicPending | null>(null);
  preparando = signal(false);

  jugando = signal(false);

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

  /**
   * Abrir el juego.
   *
   * `sp_dynamic_pending` trae la definicion completa Y comprueba que el
   * intento siga vivo: asi no se abre un cronometro que SQL va a rechazar al
   * enviarlo. El juego en si lo pinta `app-dinamica-juego`, la misma pieza que
   * usa la vista previa del administrador.
   */
  async abrirDinamica(): Promise<void> {
    if (!this.dinamica || !this.saleId) return;
    this.preparando.set(true);
    try {
      const [p] = await this.loyalty.dinamicasPendientes(this.saleId);
      if (!p) {
        this.sinIntento.set('Esta dinámica ya no está disponible.');
        this.jugando.set(true);
        return;
      }
      this.sinIntento.set(null);
      this.pendiente.set(p);
      this.jugando.set(true);
    } finally {
      this.preparando.set(false);
      this.cd.detectChanges();
    }
  }

  /** Por que no se pudo abrir el juego, si es que no se pudo. */
  sinIntento = signal<string | null>(null);

  /** El juego termino: se vuelve a la lista de premios con el resultado. */
  alTerminarJuego(): void {
    this.cd.detectChanges();
  }

  cerrar(): void {
    this.cerrado.emit();
  }
}
