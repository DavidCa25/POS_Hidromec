import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MisDatosFirmaComponent } from './profesional/mis-datos-firma.component';
import { CapabilityService, GiroSaludService } from '../core';
import { AuthService, PAQUETES } from '../services/auth.service';

/**
 * LA CARCASA DE SALUD.
 *
 * Una entrada en el menú, pestañas propias: como Servicios. Qué pestañas
 * hay lo decide el GIRO (farmacia, clínica, dental) y lo que la persona
 * puede hacer: quien vende ve la farmacia; el expediente, solo quien tiene
 * SALUD_EXPEDIENTE.
 *
 * La agenda NO se duplica: es la de Servicios, que la clínica enciende con el
 * giro. Aquí solo se enlaza.
 */
@Component({
  selector: 'app-salud-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, MisDatosFirmaComponent],
  styleUrls: ['../modulo-servicios/servicios.css', './salud.css'],
  template: `
  <div class="srv-shell">
    <nav class="srv-nav" aria-label="Salud">
      <ng-container *ngIf="farmacia">
        <a routerLink="farmacia" routerLinkActive="activo" class="srv-nav-a" data-guide="salud-tab-farmacia">
          <i class="ph ph-pill"></i> Farmacia
        </a>
        <a routerLink="caducidades" routerLinkActive="activo" class="srv-nav-a" data-guide="salud-tab-caducidades">
          <i class="ph ph-hourglass-medium"></i> Caducidades
        </a>
        <a routerLink="libro" routerLinkActive="activo" class="srv-nav-a" data-guide="salud-tab-libro" *ngIf="responsable">
          <i class="ph ph-book-open-text"></i> Libro de control
        </a>
        <a routerLink="temperaturas" routerLinkActive="activo" class="srv-nav-a" data-guide="salud-tab-temperaturas">
          <i class="ph ph-thermometer"></i> Temperaturas
        </a>
      </ng-container>
      <ng-container *ngIf="clinica || estudios">
        <a routerLink="pacientes" routerLinkActive="activo" class="srv-nav-a" data-guide="salud-tab-pacientes">
          <i class="ph ph-identification-card"></i> Pacientes
        </a>
        <ng-container *ngIf="estudios">
          <a routerLink="estudios" routerLinkActive="activo" [routerLinkActiveOptions]="{ exact: true }" class="srv-nav-a" data-guide="salud-tab-estudios">
            <i class="ph ph-flask"></i> Estudios
          </a>
          <a routerLink="estudios/catalogo" routerLinkActive="activo" class="srv-nav-a" data-guide="salud-tab-catalogo-estudios" *ngIf="administraCatalogo">
            <i class="ph ph-list-checks"></i> Catálogo de estudios
          </a>
        </ng-container>
        <a routerLink="/dashboard/ordenes-de-servicio/agenda" class="srv-nav-a" *ngIf="caps.servicios">
          <i class="ph ph-calendar-dots"></i> Agenda
        </a>
      </ng-container>
      <!-- Quien firma recetas o valida resultados captura aquí su cédula. -->
      <button type="button" class="srv-nav-a sl-firma" *ngIf="clinica || estudios" (click)="misDatos = true" data-guide="salud-mis-datos">
        <i class="ph ph-signature"></i> Mis datos de firma
      </button>
    </nav>
    <app-salud-mis-datos *ngIf="misDatos" (cerrar)="misDatos = false"></app-salud-mis-datos>
    <div class="srv-shell-cuerpo">
      <router-outlet></router-outlet>
    </div>
  </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .srv-shell { display: flex; flex-direction: column; height: 100%; min-height: 0; }
    .srv-nav { display: flex; gap: 2px; flex-wrap: wrap; flex: none; padding: 0 16px;
      background: var(--wx-surface); border-bottom: 1px solid var(--wx-edge); }
    .srv-nav-a { display: inline-flex; align-items: center; gap: 7px; padding: 11px 13px; text-decoration: none;
      color: var(--wx-text-muted); font-size: var(--wx-text-sm); border-bottom: 2px solid transparent; margin-bottom: -1px; }
    .srv-nav-a:hover { color: var(--wx-text); }
    .sl-firma { margin-left: auto; background: none; border: 0; border-bottom: 2px solid transparent; cursor: pointer; font: inherit; font-size: var(--wx-text-sm); }
    .srv-nav-a.activo { color: var(--wx-user-accent-text, var(--wx-accent-text));
      border-bottom-color: var(--wx-user-accent, var(--wx-accent)); font-weight: 500; }
    .srv-shell-cuerpo { flex: 1; min-height: 0; overflow: auto; }
  `],
})
export class SaludShell {
  readonly caps = inject(CapabilityService);
  private readonly giro = inject(GiroSaludService);
  private readonly auth = inject(AuthService);

  get farmacia(): boolean { return this.giro.farmacia() && this.auth.puede(PAQUETES.VENTAS_OPERAR); }
  get responsable(): boolean { return this.auth.puede(PAQUETES.SALUD_FARMACIA); }
  get clinica(): boolean { return this.giro.clinica() && this.auth.puede(PAQUETES.SALUD_EXPEDIENTE); }
  get estudios(): boolean { return this.giro.estudios() && this.auth.puede(PAQUETES.SALUD_EXPEDIENTE); }
  get administraCatalogo(): boolean { return this.auth.puede(PAQUETES.SERVICIOS_ADMINISTRAR); }
  misDatos = false;
}
