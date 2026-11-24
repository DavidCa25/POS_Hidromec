import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import Swal from 'sweetalert2';
import { EstadoOrdenEstudios, Estudio, OrdenEstudios, PacienteLista, SaludService } from '../salud.service';
import { MODALIDADES } from './modalidades';

type Filtro = EstadoOrdenEstudios | 'TODAS';

/**
 * ESTUDIOS: LA LISTA DE TRABAJO DEL LABORATORIO O DEL GABINETE.
 *
 * Arriba, lo pendiente (ABIERTA) y lo listo para entregar (LISTA). Una orden
 * nueva se arma aquí: paciente con consentimiento, los estudios del
 * catálogo y quién los pide. Al crearla se abre su orden de servicio, que se
 * cobra en la caja como cualquier otra.
 *
 * Con `?paciente=ID` (desde el expediente) abre la orden nueva con ese
 * paciente ya elegido.
 */
@Component({
  selector: 'app-salud-estudios',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrls: ['../../modulo-servicios/servicios.css', '../salud.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="srv-pagina">
    <header class="srv-cab">
      <div>
        <h1>Estudios</h1>
        <p class="srv-sub">Cada estudio avanza solo: se toma, se captura y lo valida quien tiene cédula.</p>
      </div>
      <button type="button" class="btn btn-primary" (click)="abrirNueva()" data-guide="estudios-nueva">
        <i class="ph ph-plus"></i> Nueva orden</button>
    </header>

    <div class="srv-barra">
      <div class="srv-tabs m-0" role="tablist">
        <button type="button" class="srv-tab" *ngFor="let f of filtros" [class.activo]="filtro() === f.valor"
                (click)="cambiarFiltro(f.valor)" [attr.data-guide]="'estudios-filtro-' + f.valor">{{ f.texto }}</button>
      </div>
      <input class="form-control ctl" type="search" [(ngModel)]="buscar" (ngModelChange)="alEscribir()"
             placeholder="Paciente o folio" data-guide="estudios-buscar">
    </div>
    <p class="srv-error" *ngIf="error()">{{ error() }}</p>

    <div class="srv-tabla-wrap">
      <table class="srv-tabla" data-guide="estudios-lista">
        <thead><tr><th>Folio</th><th>Paciente</th><th>Estudios</th><th>Avance</th><th>Fecha</th><th>Estado</th></tr></thead>
        <tbody>
          <tr *ngFor="let o of ordenes(); trackBy: track" class="srv-fila" tabindex="0" [attr.data-guide-clave]="o.folio"
              [attr.data-guide-estado]="o.estado" (click)="abrir(o)" (keydown.enter)="abrir(o)">
            <td class="mono"><b>{{ o.folio }}</b></td>
            <td>{{ o.paciente }}</td>
            <td>{{ nombres(o) }}</td>
            <td>{{ o.validados }} de {{ o.estudios }}</td>
            <td>{{ o.created_at | date:'dd/MM/yyyy HH:mm' }}</td>
            <td><span class="srv-badge" [ngClass]="claseEstado(o.estado)">{{ textoEstado(o.estado) }}</span></td>
          </tr>
        </tbody>
      </table>
      <div class="srv-vacio" *ngIf="!cargando() && !ordenes().length">
        <i class="ph ph-flask" style="font-size:2rem"></i>
        <p>{{ buscar ? 'Ninguna orden coincide.' : 'No hay órdenes aquí.' }}</p>
      </div>
    </div>
  </div>

  <!-- =================================================== ORDEN NUEVA -->
  <div class="modal fade show d-block srv-modal" role="dialog" aria-modal="true" aria-labelledby="en-t" *ngIf="nueva()">
    <div class="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable">
      <div class="modal-content rounded-4">
        <div class="modal-header border-0 pb-1">
          <h5 class="modal-title fw-bold m-0" id="en-t">Nueva orden de estudios</h5>
          <button type="button" class="btn-close" (click)="nueva.set(false)" aria-label="Cerrar"></button>
        </div>
        <div class="modal-body px-4 pt-1 pb-4">
          <label class="form-label" for="en-p">Paciente</label>
          <ng-container *ngIf="!paciente(); else elegido">
            <input id="en-p" class="form-control" type="search" [(ngModel)]="buscarPaciente" (ngModelChange)="buscarPacientes()"
                   placeholder="Nombre, teléfono o CURP" autocomplete="off" data-guide="estudios-paciente">
            <ul class="sl-opciones" *ngIf="pacientes().length">
              <li *ngFor="let p of pacientes()">
                <button type="button" class="sl-opcion" [disabled]="!p.es_paciente || !p.con_consentimiento"
                        (click)="paciente.set(p)" [attr.data-guide-clave]="p.nombre">
                  <b>{{ p.nombre }}</b>
                  <span class="srv-hint" *ngIf="!p.es_paciente">Sin ficha: dale de alta en Pacientes</span>
                  <span class="srv-hint" *ngIf="p.es_paciente && !p.con_consentimiento">Sin consentimiento</span>
                </button>
              </li>
            </ul>
          </ng-container>
          <ng-template #elegido>
            <div class="sl-elegido"><b>{{ paciente()!.nombre }}</b>
              <button type="button" class="btn srv-sm" (click)="paciente.set(null)">Cambiar</button></div>
          </ng-template>

          <label class="form-label mt-3" for="en-b">Estudios</label>
          <input id="en-b" class="form-control" type="search" [(ngModel)]="buscarEstudio" placeholder="Buscar en el catálogo"
                 data-guide="estudios-buscar-catalogo">
          <ul class="sl-checks">
            <li *ngFor="let e of catalogoFiltrado()">
              <label>
                <input type="checkbox" [checked]="elegidos().has(e.product_id)" (change)="alternar(e.product_id)"
                       [attr.data-guide]="'estudios-elegir-' + e.product_id" [attr.data-guide-clave]="e.nombre">
                <span><b>{{ e.nombre }}</b> <span class="srv-hint">{{ etiquetaTipo(e) }}</span>
                  <span class="srv-hint d-block" *ngIf="e.preparacion">{{ e.preparacion }}</span></span>
                <span class="ms-auto">{{ e.precio | currency:'MXN':'symbol-narrow' }}</span>
              </label>
            </li>
          </ul>
          <p class="srv-hint" *ngIf="!catalogo().length">El catálogo está vacío. Da de alta los estudios en «Catálogo de estudios».</p>

          <div class="srv-campos mt-3">
            <div>
              <label class="form-label" for="en-m">Médico que lo solicita <span class="srv-opcional">(opcional)</span></label>
              <input id="en-m" class="form-control" [(ngModel)]="medico" data-guide="estudios-medico">
            </div>
            <div>
              <label class="form-label" for="en-i">Indicaciones <span class="srv-opcional">(opcional)</span></label>
              <input id="en-i" class="form-control" [(ngModel)]="indicaciones" placeholder="Diagnóstico presuntivo, urgencia…">
            </div>
          </div>

          <p class="srv-error" *ngIf="errorNueva()">{{ errorNueva() }}</p>
          <div class="d-flex justify-content-between align-items-center gap-2 mt-4">
            <b>Total {{ totalElegido() | currency:'MXN':'symbol-narrow' }}</b>
            <div class="d-flex gap-2">
              <button type="button" class="btn" (click)="nueva.set(false)">Cancelar</button>
              <button type="button" class="btn btn-primary" (click)="crear()" [disabled]="creando()" data-guide="estudios-crear">
                {{ creando() ? 'Abriendo…' : 'Abrir orden' }}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  `,
})
export class SaludEstudios implements OnInit, OnDestroy {
  private readonly salud = inject(SaludService);
  private readonly router = inject(Router);
  private readonly ruta = inject(ActivatedRoute);

  readonly filtros: { valor: Filtro; texto: string }[] = [
    { valor: 'ABIERTA', texto: 'En proceso' }, { valor: 'LISTA', texto: 'Para entregar' },
    { valor: 'ENTREGADA', texto: 'Entregadas' }, { valor: 'TODAS', texto: 'Todas' },
  ];
  readonly filtro = signal<Filtro>('ABIERTA');
  readonly ordenes = signal<OrdenEstudios[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  buscar = '';
  private tBuscar: any = null;

  // Orden nueva
  readonly nueva = signal(false);
  readonly paciente = signal<PacienteLista | null>(null);
  readonly pacientes = signal<PacienteLista[]>([]);
  readonly catalogo = signal<Estudio[]>([]);
  readonly elegidos = signal<Set<number>>(new Set());
  readonly creando = signal(false);
  readonly errorNueva = signal<string | null>(null);
  buscarPaciente = '';
  buscarEstudio = '';
  medico = '';
  indicaciones = '';
  private tPaciente: any = null;

  readonly totalElegido = computed(() =>
    this.catalogo().filter((e) => this.elegidos().has(e.product_id)).reduce((s, e) => s + Number(e.precio), 0));

  catalogoFiltrado(): Estudio[] {
    const b = this.buscarEstudio.trim().toLocaleLowerCase('es-MX');
    return b ? this.catalogo().filter((e) => e.nombre.toLocaleLowerCase('es-MX').includes(b)) : this.catalogo();
  }

  async ngOnInit(): Promise<void> {
    await this.cargar();
    const pac = Number(this.ruta.snapshot.queryParamMap.get('paciente'));
    if (pac > 0) await this.abrirNueva(pac);
  }

  ngOnDestroy(): void { clearTimeout(this.tBuscar); clearTimeout(this.tPaciente); }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    const f = this.filtro();
    const r = await this.salud.ordenesEstudios({ estado: f === 'TODAS' ? null : f, buscar: this.buscar, top: 200 });
    this.cargando.set(false);
    if (!r.ok) { this.error.set(r.error || 'No se pudieron leer las órdenes.'); return; }
    this.error.set(null);
    this.ordenes.set(r.datos);
  }

  cambiarFiltro(f: Filtro): void { this.filtro.set(f); void this.cargar(); }
  alEscribir(): void { clearTimeout(this.tBuscar); this.tBuscar = setTimeout(() => void this.cargar(), 250); }
  abrir(o: OrdenEstudios): void { void this.router.navigate(['/dashboard/salud/estudios', o.id]); }

  async abrirNueva(pacienteId?: number): Promise<void> {
    this.paciente.set(null); this.pacientes.set([]); this.elegidos.set(new Set());
    this.buscarPaciente = ''; this.buscarEstudio = ''; this.medico = ''; this.indicaciones = '';
    this.errorNueva.set(null);
    this.nueva.set(true);
    const r = await this.salud.estudiosCatalogo();
    if (r.ok) this.catalogo.set(r.datos);
    if (pacienteId) {
      /* Desde el expediente: se busca por id entre los pacientes para traer
         su estado de consentimiento, no se confía en la URL. */
      const exp = await this.salud.expediente(pacienteId);
      const f = exp.datos?.ficha;
      if (f?.es_paciente && f.consentimiento_at) {
        this.paciente.set({
          customer_id: f.customer_id, nombre: f.nombre, telefono: f.telefono, fecha_nacimiento: f.fecha_nacimiento,
          email: f.email, curp: f.curp, sexo: f.sexo, alergias: f.alergias, es_paciente: true, con_consentimiento: true,
          ultima_atencion: null,
        });
      }
    }
  }

  buscarPacientes(): void {
    clearTimeout(this.tPaciente);
    this.tPaciente = setTimeout(async () => {
      const b = this.buscarPaciente.trim();
      if (b.length < 2) { this.pacientes.set([]); return; }
      const r = await this.salud.pacientes(b);
      this.pacientes.set(r.ok ? r.datos.slice(0, 8) : []);
    }, 250);
  }

  alternar(id: number): void {
    const s = new Set(this.elegidos());
    if (s.has(id)) s.delete(id); else s.add(id);
    this.elegidos.set(s);
  }

  async crear(): Promise<void> {
    if (this.creando()) return;
    const p = this.paciente();
    if (!p) { this.errorNueva.set('Elige al paciente.'); return; }
    if (!this.elegidos().size) { this.errorNueva.set('Elige al menos un estudio.'); return; }
    this.creando.set(true);
    const r = await this.salud.crearOrdenEstudios({
      customerId: p.customer_id, estudios: [...this.elegidos()], medico: this.medico, indicaciones: this.indicaciones,
    });
    this.creando.set(false);
    if (!r.ok || !r.datos) { this.errorNueva.set(r.error || 'No se pudo abrir la orden.'); return; }
    this.nueva.set(false);
    const orden = r.datos;
    const q = await Swal.fire({
      icon: 'success', title: `Orden ${orden.folio}`,
      text: 'Se abrió su orden de servicio. ¿La cobras ahora en la caja?',
      showCancelButton: true, confirmButtonText: 'Cobrar ahora', cancelButtonText: 'Después',
    });
    if (q.isConfirmed) void this.router.navigate(['/dashboard/venta'], { queryParams: { ordenServicio: orden.ordenId } });
    else void this.router.navigate(['/dashboard/salud/estudios', orden.id]);
  }

  nombres(o: OrdenEstudios): string { return o.items.filter((i) => i.estado !== 'CANCELADO').map((i) => i.nombre).join(', '); }
  etiquetaTipo(e: Estudio): string { return e.tipo === 'LAB' ? 'Laboratorio' : (MODALIDADES.find((m) => m.valor === e.modalidad)?.etiqueta ?? 'Imagen'); }
  textoEstado(e: EstadoOrdenEstudios): string {
    return { ABIERTA: 'En proceso', LISTA: 'Para entregar', ENTREGADA: 'Entregada', CANCELADA: 'Cancelada' }[e];
  }
  claseEstado(e: EstadoOrdenEstudios): string {
    return { ABIERTA: 'srv-badge--warn', LISTA: 'srv-badge--ok', ENTREGADA: 'srv-badge--mute', CANCELADA: 'srv-badge--mute' }[e];
  }
  track = (_: number, o: OrdenEstudios) => o.id;
}
