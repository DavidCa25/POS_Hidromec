import { Component, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  AsistenciaService, EstadoAsistencia, FechaSqlPipe, TipoMarca, fechaLocal, horasMin, moverDias,
} from '../../../core';
import { WxAvatarComponent } from '../../wx-avatar/wx-avatar.component';

/**
 * CHECAR EN LA CAJA (0071).
 *
 * Checa la persona con la sesion abierta: no hay PIN ni lista de nombres, asi
 * que nadie checa por otro sin entrar con su usuario. Solo se ofrecen las
 * acciones que tocan ahora (las decide `sp_asistencia_estado`), y la hora la
 * pone el servidor, no esta caja.
 *
 * Tras marcar se cierra solo a los pocos segundos: es un paso de la llegada
 * o de la salida, no una pantalla para quedarse.
 */
@Component({
  selector: 'app-asistencia-checar',
  standalone: true,
  imports: [CommonModule, FechaSqlPipe, WxAvatarComponent],
  templateUrl: './asistencia-checar.component.html',
  styleUrls: ['./asistencia-checar.component.css'],
})
export class AsistenciaChecarComponent implements OnInit, OnDestroy {
  private readonly svc = inject(AsistenciaService);

  /** La caja desde la que se checa, para el registro. */
  @Input() registerId: number | null = null;
  /** Por que se abrio: el cobro lo pidio porque falta la entrada. */
  @Input() motivo: string | null = null;
  @Output() cerrar = new EventEmitter<void>();

  readonly estado = signal<EstadoAsistencia | null>(null);
  readonly cargando = signal(true);
  readonly enviando = signal(false);
  readonly error = signal<string | null>(null);
  readonly hecho = signal<string | null>(null);
  readonly semana = signal<{ trabajado: number; extra: number } | null>(null);
  readonly horas = horasMin;

  private cierre: any = null;

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  ngOnDestroy(): void {
    if (this.cierre) clearTimeout(this.cierre);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void { this.cerrar.emit(); }

  private async cargar(): Promise<void> {
    this.cargando.set(true);
    const r = await this.svc.estado();
    if (r.ok) this.estado.set(r.data); else this.error.set(r.error);
    this.cargando.set(false);
    await this.cargarSemana();
  }

  /** Lunes a hoy: lo que lleva esta semana, para que la persona lo vea. */
  private async cargarSemana(): Promise<void> {
    const hoy = fechaLocal();
    const d = new Date(`${hoy}T12:00:00`);
    const lunes = moverDias(hoy, -((d.getDay() + 6) % 7));
    const r = await this.svc.misHoras(lunes, hoy);
    if (!r.ok) return;
    this.semana.set({
      trabajado: r.data.dias.reduce((a, x) => a + (Number(x.trabajado_min) || 0), 0),
      extra: r.data.dias.reduce((a, x) => a + (Number(x.extra_min) || 0), 0),
    });
  }

  async marcar(tipo: TipoMarca): Promise<void> {
    if (this.enviando()) return;
    this.enviando.set(true);
    this.error.set(null);
    const r = await this.svc.marcar(tipo, this.registerId);
    this.enviando.set(false);
    if (!r.ok) { this.error.set(r.error); return; }
    this.estado.set(r.data);
    this.hecho.set({
      ENTRADA: 'Entrada registrada',
      INICIO_DESCANSO: 'Descanso iniciado',
      FIN_DESCANSO: 'De vuelta del descanso',
      SALIDA: 'Salida registrada',
    }[tipo]);
    await this.cargarSemana();
    this.cierre = setTimeout(() => this.cerrar.emit(), 4000);
  }
}
