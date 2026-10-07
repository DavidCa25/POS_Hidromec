import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { CapabilityService } from '../../core';
@Component({
  selector: 'wx-inventory-tabs',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: ` <nav class="inventory-tabs" aria-label="Secciones de inventario">
    <a routerLink="/dashboard/inventario" [class.on]="active === 'products'"
      ><i class="ph ph-package" aria-hidden="true"></i>Productos</a
    >
    <a
      *ngIf="admin"
      routerLink="/dashboard/inventario/ofertas"
      [class.on]="active === 'offers'"
      ><i class="ph ph-tag" aria-hidden="true"></i>Promociones y combos</a
    >
    <a
      *ngIf="admin"
      routerLink="/dashboard/inventario/ofertas"
      [queryParams]="{ view: 'prices' }"
      [class.on]="active === 'prices'"
      ><i class="ph ph-storefront" aria-hidden="true"></i>Precios por canal</a
    >
    <a *ngIf="caps.hospitality" routerLink="/dashboard/recetas"
      ><i class="ph ph-cooking-pot" aria-hidden="true"></i>Recetas</a
    >
  </nav>`,
  styles: [
    `
      :host {
        display: block;
        margin: 18px 0;
      }
      .inventory-tabs {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        padding: 10px;
        border: 1px solid var(--wx-edge);
        border-radius: 18px;
        background: var(--wx-raised);
      }
      a {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 40px;
        padding: 9px 16px;
        border: 1px solid var(--wx-edge);
        border-radius: 12px;
        color: var(--wx-text);
        background: var(--wx-surface);
        text-decoration: none;
        font-size: 14px;
        font-weight: 550;
      }
      a.on {
        background: var(--wx-cyan-500);
        border-color: var(--wx-cyan-500);
        color: var(--wx-cyan-ink);
      }
      a:focus-visible {
        outline: 2px solid var(--wx-cyan-500);
        outline-offset: 3px;
      }
      i {
        font-size: 18px;
      }
    `,
  ],
})
export class InventoryTabsComponent {
  @Input() active = 'products';
  readonly auth = inject(AuthService);
  readonly caps = inject(CapabilityService);
  get admin() {
    return this.auth.puede('CONFIGURACION_ADMINISTRAR');
  }
}
