import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ClubService } from '../../core/club.service';
import { WxMenuComponent, WxMenuOpcion } from '../wx-menu/wx-menu.component';
import { ClubWalletComponent } from './club-wallet.component';

/*
 * TARJETA DEL CLUB (0063 · variante A aprobada).
 *
 * Vive donde ya se elige al cliente: dentro de «Cliente asignado» en Venta y
 * bajo «Cliente» en la Cuenta de Touch. Dice en una línea si la membresía
 * está activa, si ya tomó su beneficio de hoy, y ofrece lo único que toca:
 * dar el café, renovar o afiliar. Todo es sobre el carrito; la cotización y
 * SQL deciden.
 *
 * 0064: debajo, en la misma tarjeta, sus puntos y sellos: el saldo, el
 * catálogo de canje y las tarjetas de sellos (llena = se canjea).
 *
 * 0066: «Tarjeta en Wallet» le da al cliente su tarjeta del Club en Apple
 * Wallet o Google Wallet (club-wallet.component).
 */
@Component({
  selector: 'app-club-cliente',
  standalone: true,
  imports: [CommonModule, WxMenuComponent, ClubWalletComponent],
  template: `
  <ng-container *ngIf="club.cliente()">
    <div class="club" [class.club--touch]="touch" *ngIf="club.membresia() as m; else sinSocio" data-guide="club-tarjeta" [attr.data-guide-estado]="m.estado">
      <div class="club__cab">
        <span class="chip" [class.ok]="m.estado === 'ACTIVA'" [class.bad]="m.estado === 'VENCIDA'" [class.neu]="m.estado === 'CANCELADA'">
          {{ m.plan_name }}<ng-container *ngIf="m.estado !== 'ACTIVA'"> · {{ m.estado === 'VENCIDA' ? 'vencida' : 'cancelada' }}</ng-container>
        </span>
        <span class="tenue" *ngIf="m.paid_until">{{ m.estado === 'VENCIDA' ? 'venció' : 'hasta' }} {{ m.paid_until | date:'d MMM':'UTC':'es-MX' }}</span>
      </div>

      <ng-container *ngIf="m.estado === 'ACTIVA' || club.cobraMembresia()">
        <div class="club__fila ok" *ngIf="club.aplicado() as a">
          <span class="club__ic"><i class="ph ph-coffee" aria-hidden="true"></i> Beneficio de hoy</span><span class="chip ok">En el ticket</span>
          <button type="button" class="club__link" (click)="club.quitarBeneficio()">Quitar</button>
        </div>
        <div class="club__error" *ngIf="!club.aplicado() && club.pedido() && club.errorCotizacion() as e" role="alert">
          {{ e }} <button type="button" class="club__link" (click)="club.quitarBeneficio()">Quitar</button>
        </div>
        <ng-container *ngIf="!club.pedido()">
          <div class="club__acciones" *ngIf="m.disponibles_hoy > 0; else yaUso">
            <button type="button" class="b pri" data-guide="club-dar" (click)="club.darBeneficio()"><i class="ph ph-coffee" aria-hidden="true"></i> Dar {{ beneficio() }} de hoy</button>
            <wx-menu *ngIf="club.productos().length > 1" etiqueta="Elegir" icono="ph ph-caret-down" variante="neutral" [soloIcono]="true"
                     [opciones]="opcionesProductos()" (elegir)="club.darBeneficio($any($event))"></wx-menu>
          </div>
          <ng-template #yaUso>
            <div class="tenue">Ya usó su beneficio de hoy<ng-container *ngIf="m.ultimo_canje"> · {{ m.ultimo_canje | date:'HH:mm':'UTC' }}</ng-container><ng-container *ngIf="m.ultimo_canje_en"> en {{ m.ultimo_canje_en }}</ng-container>.</div>
          </ng-template>
        </ng-container>
      </ng-container>

      <ng-container *ngIf="m.estado !== 'ACTIVA' && !club.cobraMembresia()">
        <span class="tenue">{{ m.estado === 'VENCIDA' ? 'No puede usar su beneficio hasta renovar.' : 'La membresía está cancelada.' }}</span>
        <button type="button" class="b dark" data-guide="club-renovar" (click)="club.renovar()">
          {{ m.estado === 'VENCIDA' ? 'Renovar' : 'Reactivar' }} {{ (m.sale_product_price ?? 0) | currency:'MXN':'symbol-narrow':'1.0-2' }}{{ m.disponibles_hoy > 0 ? ' y dar ' + beneficio() : '' }}
        </button>
      </ng-container>
      <span class="tenue" *ngIf="club.cobraMembresia() && m.estado !== 'ACTIVA'">La renovación va en esta cuenta.</span>
    </div>

    <ng-template #sinSocio>
      <div class="club club--vacio" [class.club--touch]="touch" *ngIf="club.planes().length">
        <ng-container *ngIf="!club.cobraMembresia(); else enCuenta">
          <button *ngIf="club.planes().length === 1" type="button" class="b out" data-guide="club-afiliar" (click)="club.afiliar(club.planes()[0].id)">
            + Afiliar al {{ club.planes()[0].name }} · {{ club.planes()[0].sale_product_price | currency:'MXN':'symbol-narrow':'1.0-2' }}
          </button>
          <wx-menu *ngIf="club.planes().length > 1" etiqueta="Afiliar al Club" icono="ph ph-plus" variante="neutral"
                   [opciones]="opcionesPlanes()" (elegir)="club.afiliar($any($event))"></wx-menu>
        </ng-container>
        <ng-template #enCuenta><span class="tenue">La afiliación va en esta cuenta.</span></ng-template>
      </div>
    </ng-template>

    <!-- 0064 · puntos y sellos -->
    <div class="club club--pts" [class.club--touch]="touch" *ngIf="club.puntosActivos() || conSellos().length" data-guide="puntos-tarjeta">
      <div class="club__cab" *ngIf="club.puntosActivos()">
        <span class="chip pts"><i class="ph ph-star" aria-hidden="true"></i> {{ club.saldo() | number }} {{ club.saldo() === 1 ? 'punto' : 'puntos' }}</span>
        <span class="tenue" *ngIf="club.puntos()?.resumen?.vencen as v">vencen {{ v | date:'d MMM y':'UTC':'es-MX' }}</span>
        <span class="club__sp"></span>
        <wx-menu *ngIf="!club.canje()?.rewardId && club.recompensas().length" etiqueta="Canjear" icono="ph ph-gift" variante="neutral"
                 [opciones]="opcionesRecompensas()" (elegir)="club.canjearRecompensa($any($event))" data-guide="puntos-canjear"></wx-menu>
      </div>
      <div class="club__fila ok" *ngIf="club.aplicadoPuntos() as a" data-guide="puntos-aplicado">
        <span class="club__ic"><i class="ph ph-gift" aria-hidden="true"></i> {{ a.nombre }}</span>
        <span class="chip ok">−{{ a.costo }} pts</span>
        <button type="button" class="club__link" (click)="club.quitarCanjePuntos()">Quitar</button>
      </div>

      <div class="sello" *ngFor="let t of conSellos()" data-guide="sellos-tarjeta" [attr.data-guide-clave]="t.uuid">
        <div class="sello__cab">
          <span>{{ t.name }}</span>
          <span class="tenue">{{ t.sellos }}/{{ t.stamps_required }}</span>
        </div>
        <div class="sello__puntos" [attr.aria-label]="t.sellos + ' de ' + t.stamps_required + ' sellos'">
          <i *ngFor="let n of rango(t.stamps_required)" [class.on]="n < t.sellos"></i>
        </div>
        <div class="club__fila ok" *ngIf="club.canje()?.cardId === t.id && club.aplicadoSellos() as a; else sinCanjeSello">
          <span class="club__ic"><i class="ph ph-seal-check" aria-hidden="true"></i> Tarjeta canjeada</span>
          <span class="chip ok">En el ticket</span>
          <button type="button" class="club__link" (click)="club.quitarCanjeSellos()">Quitar</button>
        </div>
        <ng-template #sinCanjeSello>
          <button *ngIf="t.sellos >= t.stamps_required && club.canje()?.cardId !== t.id" type="button" class="b pri" data-guide="sellos-canjear"
                  (click)="club.canjearTarjeta(t.id)">
            <i class="ph ph-seal-check" aria-hidden="true"></i> Canjear {{ t.reward_product_name || 'el regalo' }}
          </button>
        </ng-template>
      </div>

      <div class="club__error" *ngIf="club.canje() && !club.aplicadoPuntos() && !club.aplicadoSellos() && club.errorCanje() as e" role="alert">
        {{ e }} <button type="button" class="club__link" (click)="club.quitarCanjePuntos(); club.quitarCanjeSellos()">Quitar</button>
      </div>
    </div>

    <!-- 0066 · tarjeta en Wallet -->
    <button type="button" class="club__wallet" [class.club--touch]="touch" data-guide="club-wallet" *ngIf="conClub()" (click)="wallet = true">
      <i class="ph ph-wallet" aria-hidden="true"></i> Tarjeta en Wallet
    </button>
    <app-club-wallet *ngIf="wallet" [customerId]="club.cliente()!.id" (close)="wallet = false"></app-club-wallet>
  </ng-container>`,
  styles: [`
    .club { margin-top: 8px; padding: 9px 10px; border: 1px solid var(--wx-edge); border-radius: var(--wx-radius-md); display: grid; gap: 7px; font-size: var(--wx-text-sm); background: var(--wx-surface); }
    .club--touch { margin: 0 16px 12px; padding: 11px 12px; font-size: var(--wx-text-base); }
    .club--vacio { border-style: dashed; }
    .club__sp { flex: 1; }
    .chip.pts { background: var(--wx-accent-soft); color: var(--wx-accent-text); gap: 5px; }
    .sello { display: grid; gap: 5px; padding-top: 6px; border-top: 1px dashed var(--wx-edge); }
    .sello__cab { display: flex; justify-content: space-between; font-weight: 600; }
    .sello__puntos { display: flex; flex-wrap: wrap; gap: 4px; }
    .sello__puntos i { width: 12px; height: 12px; border-radius: 50%; border: 1.5px solid var(--wx-edge-strong); }
    .sello__puntos i.on { background: var(--wx-accent); border-color: var(--wx-accent); }
    .club--touch .sello__puntos i { width: 16px; height: 16px; }
    .club__cab { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .club__fila { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: var(--wx-radius-sm); }
    .club__fila.ok { background: var(--wx-success-soft); }
    .club__fila > span:first-child { flex: 1 0 auto; white-space: nowrap; }
    .club__ic { display: inline-flex; align-items: center; gap: 5px; }
    .club__fila { flex-wrap: wrap; }
    .club__acciones { display: flex; gap: 6px; align-items: center; }
    .club__acciones .b { flex: 1; }
    .club__error { color: var(--wx-danger); font-size: var(--wx-text-xs); }
    .club__link { border: 0; background: none; color: var(--wx-accent-text); font: inherit; font-size: var(--wx-text-xs); font-weight: 600; cursor: pointer; padding: 0 2px; }
    .tenue { color: var(--wx-text-muted); font-size: var(--wx-text-xs); }
    .chip { display: inline-flex; align-items: center; padding: 1px 9px; border-radius: 999px; font-size: var(--wx-text-xs); font-weight: 600; }
    .chip.ok { background: var(--wx-success-soft); color: var(--wx-success-ink); }
    .chip.bad { background: var(--wx-danger-soft); color: var(--wx-danger-ink); }
    .chip.neu { background: var(--wx-sunken); color: var(--wx-text-muted); }
    .b { font: inherit; font-weight: 600; border-radius: var(--wx-radius-sm); padding: 7px 10px; border: 1px solid var(--wx-edge-strong); background: var(--wx-surface); color: var(--wx-text); cursor: pointer; }
    .club--touch .b { min-height: 44px; }
    .b.pri { background: var(--wx-accent); border-color: var(--wx-accent); color: var(--wx-accent-ink); }
    .b.dark { background: var(--wx-text); border-color: var(--wx-text); color: var(--wx-surface); }
    .b.out { border-color: var(--wx-accent); color: var(--wx-accent-text); width: 100%; }
    .club__wallet { margin-top: 6px; display: inline-flex; align-items: center; gap: 6px; border: 0; background: none; padding: 2px 0; font: inherit; font-size: var(--wx-text-xs); font-weight: 600; color: var(--wx-accent-text); cursor: pointer; }
    .club__wallet.club--touch { margin: 0 16px 12px; min-height: 44px; font-size: var(--wx-text-sm); }
    .b:focus-visible, .club__link:focus-visible, .club__wallet:focus-visible { outline: none; box-shadow: var(--wx-focus-ring); }
  `],
})
export class ClubClienteComponent {
  @Input() touch = false;
  readonly club = inject(ClubService);
  /** 0066 · ¿Está abierto el diálogo de la tarjeta en Wallet? */
  wallet = false;

  /** Hay algo del Club que llevar en la tarjeta: un plan, su membresía, puntos o sellos. */
  conClub(): boolean {
    return !!(this.club.membresia() || this.club.planes().length || this.club.puntosActivos() || this.club.tarjetas().length);
  }

  beneficio(): string {
    const ps = this.club.productos();
    return ps.length === 1 ? ps[0].nombre : 'café';
  }
  opcionesProductos(): WxMenuOpcion[] {
    return this.club.productos().map(p => ({ valor: p.product_id, etiqueta: p.nombre }));
  }
  /** 0064 · El catálogo de canje: lo que no le alcanza se ve, desactivado, con lo que falta. */
  opcionesRecompensas(): WxMenuOpcion[] {
    return this.club.recompensas().map(r => ({
      valor: r.id, etiqueta: r.name, icono: 'ph ph-star',
      nota: r.faltan ? `faltan ${r.faltan}` : `${r.points_cost} pts`, desactivada: r.faltan > 0,
    }));
  }
  /** Solo las tarjetas en las que el cliente lleva algo: una tarjeta en 0 no le dice nada al cajero. */
  conSellos() { return this.club.tarjetas().filter(t => Number(t.sellos) !== 0 || this.club.canje()?.cardId === t.id); }
  rango(n: number): number[] { return Array.from({ length: Math.min(n, 30) }, (_, i) => i); }
  opcionesPlanes(): WxMenuOpcion[] {
    return this.club.planes().map(p => ({ valor: p.id, etiqueta: `${p.name} · $${Number(p.sale_product_price).toFixed(0)}` }));
  }
}
