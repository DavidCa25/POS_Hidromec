import {
  ChangeDetectionStrategy, Component, OnInit, computed, signal,
} from '@angular/core';
import { CurrencyPipe, DecimalPipe, NgClass, NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WxDateComponent } from '../../app/wx-date/wx-date.component';
import { fechaLocal, hoyLocal, moverDias } from '../../core';

type Periodo = 'hoy' | 'semana' | 'mes' | 'rango';
type Medida = 'tickets' | 'ingresos' | 'promedio';

interface Celda { dia: number; hora: number; tickets: number; ingresos: number; }
interface PorHora { hora: number; tickets: number; ingresos: number; }
interface PorDia { dia: number; tickets: number; ingresos: number; dias_calendario: number; }
interface PorFecha { fecha: string; dia: number; tickets: number; ingresos: number; }

const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

/**
 * ACTIVIDAD POR HORA.
 *
 * Para contestar tres preguntas concretas, no para llenar un tablero:
 *
 *   ¿A que hora tengo mas clientes?        la hora pico y las barras por hora
 *   ¿Que viernes son mas fuertes?          el ranking de fechas de UN dia
 *   ¿Necesito mas personal de 8 a 10?      el mapa dia x hora, en PROMEDIO
 *                                          por dia, que es lo que se compara
 *                                          con un turno
 *
 * Los numeros salen de `sp_report_actividad_horaria`: la hora de una venta es
 * la del cobro, el ingreso va neto de reembolsos, y el promedio divide entre
 * los dias del calendario -tambien los que no vendieron-.
 */
@Component({
  selector: 'app-actividad-horaria',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, FormsModule, CurrencyPipe, DecimalPipe, WxDateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './actividad-horaria.component.html',
  styleUrls: ['./actividad-horaria.component.css'],
})
export class ActividadHorariaComponent implements OnInit {
  readonly dias = DIAS;
  readonly diasCortos = DIAS_CORTOS;

  readonly periodo = signal<Periodo>('semana');
  readonly medida = signal<Medida>('tickets');
  readonly diaRanking = signal(4); // viernes
  desde = moverDias(hoyLocal(), -6);
  hasta = hoyLocal();

  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly resumen = signal<{ tickets: number; ingresos: number; dias: number } | null>(null);
  readonly celdas = signal<Celda[]>([]);
  readonly porHora = signal<PorHora[]>([]);
  readonly porDia = signal<PorDia[]>([]);
  readonly porFecha = signal<PorFecha[]>([]);

  private get api(): any { return (window as any).wybix; }

  ngOnInit(): void { void this.elegir('semana'); }

  /** Los atajos fijan el rango; «Rango» deja elegirlo. */
  async elegir(p: Periodo): Promise<void> {
    this.periodo.set(p);
    const hoy = hoyLocal();
    if (p === 'hoy') { this.desde = hoy; this.hasta = hoy; }
    if (p === 'semana') { this.desde = moverDias(hoy, -6); this.hasta = hoy; }
    if (p === 'mes') {
      const d = new Date(`${hoy}T00:00:00`);
      this.desde = fechaLocal(new Date(d.getFullYear(), d.getMonth(), 1));
      this.hasta = hoy;
    }
    if (p !== 'rango') await this.leer();
  }

  async leer(): Promise<void> {
    if (!this.desde || !this.hasta) return;
    this.cargando.set(true);
    try {
      const r = await this.api?.reportes?.actividadHoraria({ desde: this.desde, hasta: this.hasta });
      if (!r?.success) { this.error.set(r?.error || 'No se pudo calcular la actividad.'); return; }
      this.error.set(null);
      const [res = [], celdas = [], horas = [], dias = [], fechas = []] = r.sets || [];
      const num = (x: any) => Number(x || 0);
      this.resumen.set({ tickets: num(res[0]?.tickets), ingresos: num(res[0]?.ingresos), dias: num(res[0]?.dias) });
      this.celdas.set(celdas.map((c: any) => ({ dia: c.dia, hora: c.hora, tickets: num(c.tickets), ingresos: num(c.ingresos) })));
      this.porHora.set(horas.map((h: any) => ({ hora: h.hora, tickets: num(h.tickets), ingresos: num(h.ingresos) })));
      this.porDia.set(dias.map((d: any) => ({ dia: d.dia, tickets: num(d.tickets), ingresos: num(d.ingresos), dias_calendario: num(d.dias_calendario) })));
      this.porFecha.set(fechas.map((f: any) => ({
        fecha: typeof f.fecha === 'string' ? f.fecha.slice(0, 10) : fechaLocal(new Date(f.fecha)),
        dia: f.dia, tickets: num(f.tickets), ingresos: num(f.ingresos),
      })));
    } finally {
      this.cargando.set(false);
    }
  }

  // ---------------------------------------------------------------- lectura
  readonly ticketPromedio = computed(() => {
    const r = this.resumen();
    return r && r.tickets ? r.ingresos / r.tickets : 0;
  });

  /** Solo las horas en las que el negocio vende: 24 columnas vacias no ayudan. */
  readonly horas = computed<number[]>(() => {
    const con = this.porHora().filter(h => h.tickets > 0).map(h => h.hora);
    if (!con.length) return [];
    const ini = Math.min(...con), fin = Math.max(...con);
    return Array.from({ length: fin - ini + 1 }, (_, i) => ini + i);
  });

  readonly horaPico = computed(() => {
    const h = [...this.porHora()].sort((a, b) => b.tickets - a.tickets || b.ingresos - a.ingresos)[0];
    return h && h.tickets ? h : null;
  });

  readonly diaPico = computed(() => {
    const d = [...this.porDia()].filter(x => x.dias_calendario > 0)
      .sort((a, b) => (b.tickets / b.dias_calendario) - (a.tickets / a.dias_calendario))[0];
    return d && d.tickets ? d : null;
  });

  /** El valor de una celda, EN PROMEDIO POR DIA de ese dia de la semana. */
  valorCelda(dia: number, hora: number): number {
    const c = this.celdas().find(x => x.dia === dia && x.hora === hora);
    const n = this.porDia().find(x => x.dia === dia)?.dias_calendario || 1;
    if (!c) return 0;
    const m = this.medida();
    if (m === 'promedio') return c.tickets ? c.ingresos / c.tickets : 0;
    return (m === 'tickets' ? c.tickets : c.ingresos) / n;
  }

  private readonly maxCelda = computed(() => {
    this.medida();
    let max = 0;
    for (let d = 0; d < 7; d++) for (const h of this.horas()) max = Math.max(max, this.valorCelda(d, h));
    return max;
  });

  /** Cinco niveles, no un degradado continuo: se distinguen de un vistazo. */
  nivel(dia: number, hora: number): number {
    const v = this.valorCelda(dia, hora), max = this.maxCelda();
    if (!v || !max) return 0;
    return Math.min(5, Math.max(1, Math.ceil((v / max) * 5)));
  }

  textoCelda(dia: number, hora: number): string {
    const v = this.valorCelda(dia, hora);
    const m = this.medida();
    const valor = m === 'tickets' ? `${v.toFixed(1)} tickets por día` : `$${v.toFixed(2)}${m === 'promedio' ? ' por ticket' : ' por día'}`;
    return `${DIAS[dia]} de ${hora}:00 a ${hora + 1}:00 · ${valor}`;
  }

  // ------------------------------------------------------------------ barras
  valorHora(h: PorHora): number {
    const m = this.medida();
    const dias = this.resumen()?.dias || 1;
    if (m === 'promedio') return h.tickets ? h.ingresos / h.tickets : 0;
    return (m === 'tickets' ? h.tickets : h.ingresos) / dias;
  }

  readonly maxHora = computed(() => {
    this.medida();
    return Math.max(0, ...this.horas().map(x => this.valorHora(this.porHora()[x] ?? { hora: x, tickets: 0, ingresos: 0 })));
  });

  barra(h: number): number {
    const fila = this.porHora().find(x => x.hora === h);
    const max = this.maxHora();
    return fila && max ? (this.valorHora(fila) / max) * 100 : 0;
  }

  valorHoraDe(h: number): number {
    const fila = this.porHora().find(x => x.hora === h);
    return fila ? this.valorHora(fila) : 0;
  }

  // ------------------------------------------------------------- por dia
  promedioDia(d: PorDia): number { return d.dias_calendario ? d.tickets / d.dias_calendario : 0; }

  readonly diasOrdenados = computed(() =>
    [...this.porDia()].sort((a, b) => this.promedioDia(b) - this.promedioDia(a)));

  /** Las fechas de UN dia de la semana, de mas fuerte a mas flojo. */
  readonly ranking = computed(() =>
    this.porFecha().filter(f => f.dia === this.diaRanking())
      .sort((a, b) => b.ingresos - a.ingresos || b.tickets - a.tickets));

  fechaCorta(iso: string): string {
    const d = new Date(`${iso}T00:00:00`);
    return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  hora(h: number): string { return `${String(h).padStart(2, '0')}:00`; }
}
