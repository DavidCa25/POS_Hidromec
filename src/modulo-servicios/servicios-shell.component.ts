import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService, PAQUETES } from '../services/auth.service';
import { GiroServiciosService } from '../core';

/**
 * LA CARCASA DEL MÓDULO.
 *
 * Cuatro pantallas que son partes de lo mismo: el trabajo, lo que se ofrece,
 * quién lo hace y cuánto generó. Viven bajo una sola entrada de menú con
 * pestañas propias, y no como cuatro entradas sueltas en el rail lateral, por
 * una razón concreta: el rail ya tiene dieciocho entradas y cuatro más lo
 * convierten en una lista que hay que leer entera para encontrar nada.
 *
 * CADA PESTAÑA PREGUNTA POR SU PAQUETE
 * ------------------------------------
 * Un Operador ve Órdenes y Agenda —su trabajo—, y no ve Catálogo ni
 * Profesionales, que son la estructura del módulo. Es cortesía: el proceso
 * principal lo vuelve a comprobar antes de ejecutar cada canal.
 *
 * Y CADA PESTAÑA PREGUNTA POR EL GIRO
 * -----------------------------------
 * Una barbería no tiene nada que registrar aparte de la persona que viene, y
 * una pestaña «Vehículos» en su menú es ruido permanente. Un taller que no da
 * citas no necesita la agenda. El giro decide cuáles se ofrecen y cómo se
 * llaman —«Vehículos» o «Equipos», no «Sobre qué»—, y ninguna de las dos
 * decisiones borra nada: cambiar de giro las devuelve.
 */
@Component({
  selector: 'app-servicios-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  styleUrls: ['./servicios.css'],
  template: `
  <div class="srv-shell">
    <nav class="srv-nav" aria-label="Servicios">
      <a routerLink="ordenes" routerLinkActive="activo" class="srv-nav-a">
        <i class="ph ph-clipboard-text"></i> Órdenes
      </a>
      <a routerLink="agenda" routerLinkActive="activo" class="srv-nav-a" *ngIf="giro.usaAgenda">
        <i class="ph ph-calendar-blank"></i> Agenda
      </a>
      <a routerLink="activos" routerLinkActive="activo" class="srv-nav-a" *ngIf="giro.usaActivos">
        <i class="ph {{ giro.giro().icono }}"></i> {{ giro.activoPlural }}
      </a>
      <a routerLink="catalogo" routerLinkActive="activo" class="srv-nav-a" *ngIf="puedeAdministrar">
        <i class="ph ph-list-checks"></i> Catálogo
      </a>
      <a routerLink="profesionales" routerLinkActive="activo" class="srv-nav-a" *ngIf="puedeAdministrar">
        <i class="ph ph-users-three"></i> Profesionales
      </a>
      <a routerLink="comisiones" routerLinkActive="activo" class="srv-nav-a" *ngIf="puedeVerReportes">
        <i class="ph ph-chart-bar"></i> Comisiones
      </a>
    </nav>
    <div class="srv-shell-cuerpo">
      <router-outlet></router-outlet>
    </div>
  </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .srv-shell { display: flex; flex-direction: column; height: 100%; min-height: 0; }
    .srv-nav {
      display: flex; gap: 2px; flex-wrap: wrap; flex: none;
      padding: 0 16px; background: var(--wx-surface);
      border-bottom: 1px solid var(--wx-edge);
    }
    .srv-nav-a {
      display: inline-flex; align-items: center; gap: 7px;
      padding: 11px 13px; text-decoration: none;
      color: var(--wx-text-muted); font-size: var(--wx-text-sm);
      border-bottom: 2px solid transparent; margin-bottom: -1px;
    }
    .srv-nav-a:hover { color: var(--wx-text); }
    .srv-nav-a.activo {
      color: var(--wx-user-accent-text, var(--wx-accent-text));
      border-bottom-color: var(--wx-user-accent, var(--wx-accent));
      font-weight: 500;
    }
    .srv-shell-cuerpo { flex: 1; min-height: 0; overflow: auto; }
  `],
})
export class ServiciosShell {
  readonly giro = inject(GiroServiciosService);

  private readonly auth = inject(AuthService);
  get puedeAdministrar(): boolean { return this.auth.puede(PAQUETES.SERVICIOS_ADMINISTRAR); }
  get puedeVerReportes(): boolean { return this.auth.puede(PAQUETES.REPORTES_VER); }
}
