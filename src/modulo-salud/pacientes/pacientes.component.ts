import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { PacienteLista, SaludService, edad } from '../salud.service';
import { FichaPacienteComponent, FichaGuardada } from '../ficha/ficha-paciente.component';

/**
 * PACIENTES: buscar a la persona y entrar a su expediente.
 *
 * Busca entre TODOS los clientes, no solo los que ya tienen ficha: quien
 * compraba en el mostrador y hoy entra a consulta ya existe, y darlo de alta
 * otra vez duplicaría su historial de compras y su crédito.
 */
@Component({
  selector: 'app-salud-pacientes',
  standalone: true,
  imports: [CommonModule, FormsModule, FichaPacienteComponent],
  styleUrls: ['../../modulo-servicios/servicios.css', '../salud.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="srv-pagina">
    <header class="srv-cab">
      <div>
        <h1>Pacientes</h1>
        <p class="srv-sub">Cada apertura de un expediente queda registrada en su bitácora.</p>
      </div>
      <button type="button" class="btn btn-primary" (click)="nuevo()" data-guide="salud-paciente-nuevo">
        <i class="ph ph-user-plus"></i> Nuevo paciente</button>
    </header>

    <div class="srv-barra">
      <input class="form-control ctl" type="search" [(ngModel)]="buscar" (ngModelChange)="alEscribir()"
             placeholder="Nombre, teléfono o CURP" data-guide="salud-buscar-paciente" autofocus>
    </div>
    <p class="srv-error" *ngIf="error()">{{ error() }}</p>

    <div class="srv-tabla-wrap">
      <table class="srv-tabla" data-guide="salud-pacientes">
        <thead><tr><th>Nombre</th><th>Edad</th><th>Teléfono</th><th>Alergias</th><th>Última atención</th><th></th></tr></thead>
        <tbody>
          <tr *ngFor="let p of lista(); trackBy: track" class="srv-fila" tabindex="0"
              [attr.data-guide-clave]="p.nombre" (click)="abrir(p)" (keydown.enter)="abrir(p)">
            <td><b>{{ p.nombre }}</b><div class="srv-hint" *ngIf="p.curp">{{ p.curp }}</div></td>
            <td>{{ edadDe(p.fecha_nacimiento) ?? '—' }}</td>
            <td>{{ p.telefono || '—' }}</td>
            <td><span class="srv-badge srv-badge--danger" *ngIf="p.alergias">{{ p.alergias }}</span></td>
            <td>{{ p.ultima_atencion ? (p.ultima_atencion | date:'dd/MM/yyyy') : '—' }}</td>
            <td>
              <span class="srv-badge srv-badge--mute" *ngIf="!p.es_paciente">Cliente sin expediente</span>
              <span class="srv-badge srv-badge--warn" *ngIf="p.es_paciente && !p.con_consentimiento">Sin consentimiento</span>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="srv-vacio" *ngIf="!cargando() && !lista().length">
        <i class="ph ph-identification-card" style="font-size:2rem"></i>
        <p>{{ buscar ? 'Nadie coincide con esa búsqueda.' : 'Todavía no hay pacientes.' }}</p>
      </div>
    </div>
  </div>

  <app-salud-ficha-paciente *ngIf="alta()" [customerId]="null" (cerrar)="alta.set(false)" (guardada)="creado($event)"></app-salud-ficha-paciente>
  `,
})
export class SaludPacientes implements OnInit, OnDestroy {
  private readonly salud = inject(SaludService);
  private readonly router = inject(Router);

  buscar = '';
  readonly lista = signal<PacienteLista[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly alta = signal(false);
  private temporizador: ReturnType<typeof setTimeout> | null = null;
  private pedido = 0;

  readonly edadDe = edad;

  ngOnInit(): void { void this.cargar(); }
  ngOnDestroy(): void { if (this.temporizador) clearTimeout(this.temporizador); }

  alEscribir(): void {
    if (this.temporizador) clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => void this.cargar(), 250);
  }

  async cargar(): Promise<void> {
    const yo = ++this.pedido;
    this.cargando.set(true);
    const r = await this.salud.pacientes(this.buscar);
    if (yo !== this.pedido) return;
    this.cargando.set(false);
    if (!r.ok) { this.error.set(r.error || 'No se pudo buscar.'); return; }
    this.error.set(null);
    this.lista.set(r.datos);
  }

  nuevo(): void { this.alta.set(true); }

  abrir(p: PacienteLista): void { void this.router.navigate(['/dashboard/salud/paciente', p.customer_id]); }

  creado(e: FichaGuardada): void {
    this.alta.set(false);
    void this.router.navigate(['/dashboard/salud/paciente', e.customerId]);
  }

  track = (_: number, p: PacienteLista) => p.customer_id;
}
