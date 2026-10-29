import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import {
  AsistenciaService, DIAS_SEMANA, DiaAsistencia, FechaSqlPipe, HorarioDia, PREGUNTAS_ASISTENCIA,
  PersonaAsistencia, ReglasAsistencia, fechaLocal, horasMin, moverDias, reglasDeFila,
} from '../../core';
import { AuthService, PAQUETES } from '../../services/auth.service';
import { ReportService } from '../../services/report.service';
import { WxAvatarComponent } from '../wx-avatar/wx-avatar.component';
import { WxDateComponent } from '../wx-date/wx-date.component';
import { WxTimeComponent } from '../wx-time/wx-time.component';
import { WxSelectComponent, WxOpcion } from '../wx-select/wx-select.component';

/*
 * ASISTENCIA (0071): las horas del equipo.
 *
 *   Semana    la tabla: persona x dia, con horas, extra, retardos y lo que
 *             hay que revisar. Tocar una fila abre sus jornadas.
 *   Horarios  el horario de cada persona: contra el se cuentan la extra (por
 *             la hora de salida) y los retardos.
 *   Reglas    las respuestas que se dieron al activar.
 *
 * Aqui no se calcula nada: los minutos los da sp_asistencia_resumen. Esta
 * pantalla suma la semana y pinta. No calcula pagos.
 */

interface Celda {
  fecha: string;
  horas: string;
  vacia: boolean;
  libre: boolean;
  chips: { texto: string; tipo: 'extra' | 'retardo' | 'revisar' | 'abierta' | 'corregida' }[];
}
interface Fila {
  persona: PersonaAsistencia;
  horario: string;
  celdas: Celda[];
  trabajado: number;
  extra: number;
  retardos: number;
  revisar: number;
}
interface DiaHorarioEdit { weekday: number; nombre: string; trabaja: boolean; entrada: string; salida: string; descansoMin: number; }

@Component({
  selector: 'app-asistencia',
  standalone: true,
  imports: [CommonModule, FormsModule, FechaSqlPipe, WxAvatarComponent, WxDateComponent, WxTimeComponent, WxSelectComponent],
  templateUrl: './asistencia.component.html',
  styleUrls: ['./asistencia.component.css'],
})
export class AsistenciaComponent implements OnInit {
  private readonly svc = inject(AsistenciaService);
  private readonly auth = inject(AuthService);
  private readonly reportes = inject(ReportService);

  readonly horas = horasMin;
  readonly preguntas = PREGUNTAS_ASISTENCIA;
  readonly puedeReglas = this.auth.puede(PAQUETES.CONFIGURACION_ADMINISTRAR);

  readonly pestana = signal<'semana' | 'horarios' | 'reglas'>('semana');
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);

  /** Lunes de la semana que se ve, YYYY-MM-DD. */
  readonly lunes = signal(lunesDe(fechaLocal()));
  readonly dias = computed(() => Array.from({ length: 7 }, (_, i) => moverDias(this.lunes(), i)));
  readonly domingo = computed(() => this.dias()[6]);

  readonly personas = signal<PersonaAsistencia[]>([]);
  readonly registros = signal<DiaAsistencia[]>([]);
  readonly horarios = signal<HorarioDia[]>([]);
  readonly reglas = signal<ReglasAsistencia | null>(null);

  readonly filas = computed<Fila[]>(() => {
    const por = new Map<string, DiaAsistencia>();
    for (const r of this.registros()) por.set(`${r.user_id}|${String(r.dia).slice(0, 10)}`, r);
    return this.personas().map(p => {
      const suyos = this.horarios().filter(h => h.user_id === p.user_id);
      const celdas = this.dias().map((fecha, i): Celda => {
        const r = por.get(`${p.user_id}|${fecha}`);
        const libre = suyos.length > 0 && !suyos.some(h => h.weekday === i + 1);
        if (!r) return { fecha, horas: '—', vacia: true, libre, chips: [] };
        const chips: Celda['chips'] = [];
        if (r.revisar) chips.push({ texto: 'Revisar', tipo: 'revisar' });
        if (r.abierta) chips.push({ texto: 'Trabajando', tipo: 'abierta' });
        if (r.extra_min > 0) chips.push({ texto: `+${horasMin(r.extra_min)}`, tipo: 'extra' });
        if (r.retardo_min > 0) chips.push({ texto: `Retardo ${r.retardo_min}`, tipo: 'retardo' });
        if (r.corregida && !r.revisar) chips.push({ texto: 'Corregida', tipo: 'corregida' });
        return { fecha, horas: r.revisar && !r.trabajado_min ? 'Sin salida' : horasMin(r.trabajado_min), vacia: false, libre, chips };
      });
      const deEl = this.registros().filter(r => r.user_id === p.user_id);
      return {
        persona: p,
        horario: resumenHorario(suyos),
        celdas,
        trabajado: deEl.reduce((a, r) => a + (r.trabajado_min || 0), 0),
        extra: deEl.reduce((a, r) => a + (r.extra_min || 0), 0),
        retardos: deEl.filter(r => r.retardo_min > 0).length,
        revisar: deEl.filter(r => r.revisar).length,
      };
    });
  });

  readonly totales = computed(() => this.filas().reduce((t, f) => ({
    trabajado: t.trabajado + f.trabajado, extra: t.extra + f.extra,
    retardos: t.retardos + f.retardos, revisar: t.revisar + f.revisar,
  }), { trabajado: 0, extra: 0, retardos: 0, revisar: 0 }));

  readonly sinHorario = computed(() => this.personas().filter(p => !this.horarios().some(h => h.user_id === p.user_id)).length);

  async ngOnInit(): Promise<void> {
    await Promise.all([this.cargar(), this.cargarReglas()]);
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    const r = await this.svc.resumen(this.lunes(), this.domingo());
    if (r.ok) {
      this.personas.set(r.data.personas);
      this.registros.set(r.data.dias);
      this.horarios.set(r.data.horarios);
    } else {
      this.error.set(r.error);
    }
    this.cargando.set(false);
  }

  private async cargarReglas(): Promise<void> {
    const r = await this.svc.reglas();
    if (r.ok && r.data) this.reglas.set(reglasDeFila(r.data));
  }

  semana(delta: number): void {
    this.lunes.set(moverDias(this.lunes(), delta * 7));
    this.cargar();
  }
  hoy(): void { this.lunes.set(lunesDe(fechaLocal())); this.cargar(); }
  esEstaSemana = computed(() => this.lunes() === lunesDe(fechaLocal()));

  etiquetaDia(fecha: string, i: number): string {
    return `${DIAS_SEMANA[i].slice(0, 3)} ${Number(fecha.slice(8, 10))}`;
  }

  // ================================================================ detalle
  readonly detalle = signal<{ persona: PersonaAsistencia; jornadas: any[]; descansos: any[]; correcciones: any[] } | null>(null);
  readonly corrigiendo = signal<{ jornadaId: number | null; fechaE: string; horaE: string; fechaS: string; horaS: string; motivo: string; abierta: boolean } | null>(null);
  readonly guardando = signal(false);
  esYo(p: PersonaAsistencia): boolean { return this.auth.usuarioActualId === p.user_id; }

  async abrirDetalle(p: PersonaAsistencia): Promise<void> {
    const r = await this.svc.jornadas(p.user_id, this.lunes(), this.domingo());
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se pudieron abrir sus jornadas', text: r.error }); return; }
    this.detalle.set({ persona: p, ...r.data });
  }
  cerrarDetalle(): void { this.detalle.set(null); this.corrigiendo.set(null); }

  descansosDe(jornadaId: number): any[] {
    return (this.detalle()?.descansos ?? []).filter(d => d.jornada_id === jornadaId);
  }
  correccionesDe(jornadaId: number): any[] {
    return (this.detalle()?.correcciones ?? []).filter(c => c.jornada_id === jornadaId);
  }

  corregir(j: any | null): void {
    const hoy = fechaLocal();
    const e = j ? String(j.entrada_en) : `${hoy}T00:00:00`;
    const s = j?.salida_en ? String(j.salida_en) : null;
    this.corrigiendo.set({
      jornadaId: j?.id ?? null,
      fechaE: e.slice(0, 10), horaE: j ? e.slice(11, 16) : '',
      fechaS: (s ?? e).slice(0, 10), horaS: s ? s.slice(11, 16) : '',
      motivo: '',
      abierta: j?.estado === 'ABIERTA',
    });
  }

  async guardarCorreccion(): Promise<void> {
    const c = this.corrigiendo();
    const d = this.detalle();
    if (!c || !d) return;
    if (!c.fechaE || !c.horaE) { await Swal.fire({ icon: 'warning', title: 'Indica la entrada' }); return; }
    if (!c.abierta && (!c.fechaS || !c.horaS)) { await Swal.fire({ icon: 'warning', title: 'Indica la salida' }); return; }
    if (c.motivo.trim().length < 3) { await Swal.fire({ icon: 'warning', title: 'Escribe el motivo' }); return; }
    this.guardando.set(true);
    const r = await this.svc.corregir({
      jornadaId: c.jornadaId, personaId: d.persona.user_id,
      entrada: `${c.fechaE}T${c.horaE}`,
      salida: c.fechaS && c.horaS ? `${c.fechaS}T${c.horaS}` : null,
      motivo: c.motivo.trim(),
    });
    this.guardando.set(false);
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se pudo corregir', text: r.error }); return; }
    this.corrigiendo.set(null);
    await Promise.all([this.abrirDetalle(d.persona), this.cargar()]);
  }

  // =============================================================== horarios
  readonly editando = signal<PersonaAsistencia | null>(null);
  readonly semanaEdit = signal<DiaHorarioEdit[]>([]);
  readonly copiarDe = signal<number | null>(null);
  readonly opcionesCopiar = computed<WxOpcion[]>(() => this.personas()
    .filter(p => p.user_id !== this.editando()?.user_id && this.horarios().some(h => h.user_id === p.user_id))
    .map(p => ({ valor: p.user_id, etiqueta: p.usuario, nota: resumenHorario(this.horarios().filter(h => h.user_id === p.user_id)) })));

  resumenDe(p: PersonaAsistencia): string {
    return resumenHorario(this.horarios().filter(h => h.user_id === p.user_id)) || 'Sin horario';
  }

  editarHorario(p: PersonaAsistencia): void {
    this.editando.set(p);
    this.copiarDe.set(null);
    this.semanaEdit.set(semanaDe(this.horarios().filter(h => h.user_id === p.user_id)));
  }

  plantilla(entrada: string, salida: string): void {
    this.semanaEdit.set(DIAS_SEMANA.map((nombre, i) => ({
      weekday: i + 1, nombre, trabaja: i < 6, entrada, salida, descansoMin: 30,
    })));
  }

  copiar(userId: number | null): void {
    this.copiarDe.set(userId);
    if (userId) this.semanaEdit.set(semanaDe(this.horarios().filter(h => h.user_id === userId)));
  }

  horasDelDia(d: DiaHorarioEdit): string {
    if (!d.trabaja || !d.entrada || !d.salida) return '—';
    const [eh, em] = d.entrada.split(':').map(Number);
    const [sh, sm] = d.salida.split(':').map(Number);
    let min = (sh * 60 + sm) - (eh * 60 + em);
    if (min <= 0) min += 24 * 60;
    return horasMin(min - (Number(d.descansoMin) || 0));
  }

  readonly totalSemanaEdit = computed(() => this.semanaEdit().reduce((a, d) => {
    const t = this.horasDelDia(d);
    if (t === '—') return a;
    const [h, m] = t.split(':').map(Number);
    return a + h * 60 + m;
  }, 0));

  actualizarDia(i: number, cambio: Partial<DiaHorarioEdit>): void {
    this.semanaEdit.update(s => s.map((d, k) => (k === i ? { ...d, ...cambio } : d)));
  }

  async guardarHorario(): Promise<void> {
    const p = this.editando();
    if (!p) return;
    const dias = this.semanaEdit().filter(d => d.trabaja);
    if (dias.some(d => !d.entrada || !d.salida)) {
      await Swal.fire({ icon: 'warning', title: 'Falta una hora', text: 'Cada día que trabaja necesita su entrada y su salida.' });
      return;
    }
    this.guardando.set(true);
    const r = await this.svc.guardarHorario(p.user_id, dias.map(d => ({
      weekday: d.weekday, entrada: d.entrada, salida: d.salida, descansoMin: Number(d.descansoMin) || 0,
    })));
    this.guardando.set(false);
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se pudo guardar', text: r.error }); return; }
    this.horarios.update(hs => [...hs.filter(h => h.user_id !== p.user_id), ...r.data.map(h => ({ ...h, user_id: p.user_id }))]);
    await Swal.fire({ icon: 'success', title: 'Horario guardado', timer: 1400, showConfirmButton: false });
    this.editando.set(null);
    this.cargar();
  }

  // ================================================================= reglas
  readonly reglasEdit = signal<ReglasAsistencia | null>(null);
  editarReglas(): void { this.reglasEdit.set({ ...(this.reglas() as ReglasAsistencia) }); }
  responder(clave: keyof ReglasAsistencia, valor: boolean): void {
    this.reglasEdit.update(r => (r ? { ...r, [clave]: valor } : r));
  }
  async guardarReglas(): Promise<void> {
    const r = this.reglasEdit();
    if (!r) return;
    this.guardando.set(true);
    const res = await this.svc.guardarReglas(r);
    this.guardando.set(false);
    if (!res.ok) { await Swal.fire({ icon: 'error', title: 'No se pudieron guardar', text: res.error }); return; }
    this.reglas.set(reglasDeFila(res.data));
    this.reglasEdit.set(null);
    await this.cargar();
  }

  // =============================================================== exportar
  async exportar(formato: 'excel' | 'pdf'): Promise<void> {
    const cols = [
      { header: 'Persona', key: 'persona', width: 22 },
      ...this.dias().map((f, i) => ({ header: this.etiquetaDia(f, i), key: `d${i}`, width: 10, align: 'right' as const })),
      { header: 'Total', key: 'total', width: 10, align: 'right' as const },
      { header: 'Extra', key: 'extra', width: 10, align: 'right' as const },
      { header: 'Retardos', key: 'retardos', width: 10, align: 'right' as const },
    ];
    const filas = this.filas().map(f => ({
      persona: f.persona.usuario,
      ...Object.fromEntries(f.celdas.map((c, i) => [`d${i}`, c.vacia ? '' : c.horas + (c.chips.find(x => x.tipo === 'extra') ? ` (${c.chips.find(x => x.tipo === 'extra')!.texto})` : '')])),
      total: horasMin(f.trabajado), extra: horasMin(f.extra), retardos: f.retardos,
    }));
    const nombre = new Map(this.personas().map(p => [p.user_id, p.usuario]));
    const detalle = this.registros().map(r => ({
      persona: nombre.get(r.user_id) ?? r.user_id, dia: String(r.dia).slice(0, 10),
      entrada: r.entrada ? String(r.entrada).slice(11, 16) : '', salida: r.salida ? String(r.salida).slice(11, 16) : '',
      trabajado: horasMin(r.trabajado_min), descanso: horasMin(r.descanso_min), extra: horasMin(r.extra_min),
      retardo: r.retardo_min || '', nota: r.revisar ? 'Sin salida' : r.abierta ? 'Trabajando' : r.corregida ? 'Corregida' : '',
    }));
    const cfg = {
      titulo: 'Asistencia',
      subtitulo: `Semana del ${this.lunes()} al ${this.domingo()} · horas trabajadas y extra (no incluye pagos)`,
      filename: `asistencia_${this.lunes()}`,
      columns: cols, rows: filas,
      secciones: [
        { titulo: 'Semana', columns: cols, rows: filas },
        { titulo: 'Detalle por día', columns: [
          { header: 'Persona', key: 'persona', width: 20 }, { header: 'Día', key: 'dia', width: 12 },
          { header: 'Entrada', key: 'entrada', width: 9 }, { header: 'Salida', key: 'salida', width: 9 },
          { header: 'Trabajado', key: 'trabajado', width: 10, align: 'right' as const },
          { header: 'Descanso', key: 'descanso', width: 10, align: 'right' as const },
          { header: 'Extra', key: 'extra', width: 9, align: 'right' as const },
          { header: 'Retardo (min)', key: 'retardo', width: 12, align: 'right' as const },
          { header: 'Nota', key: 'nota', width: 14 },
        ], rows: detalle },
      ],
    };
    if (formato === 'excel') await this.reportes.exportExcel(cfg as any);
    else await this.reportes.exportPdf(cfg as any);
  }
}

/** El lunes de la semana de un YYYY-MM-DD. */
function lunesDe(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00`);
  return moverDias(fecha, -((d.getDay() + 6) % 7));
}

/** "Lun–Vie 08:00–16:00 · Sáb 09:00–17:00". */
function resumenHorario(hs: HorarioDia[]): string {
  if (!hs.length) return '';
  const grupos: { desde: number; hasta: number; rango: string }[] = [];
  for (const h of [...hs].sort((a, b) => a.weekday - b.weekday)) {
    const rango = `${h.entrada}–${h.salida}`;
    const ult = grupos[grupos.length - 1];
    if (ult && ult.rango === rango && ult.hasta === h.weekday - 1) ult.hasta = h.weekday;
    else grupos.push({ desde: h.weekday, hasta: h.weekday, rango });
  }
  const corto = (w: number) => DIAS_SEMANA[w - 1].slice(0, 3);
  return grupos.map(g => `${g.desde === g.hasta ? corto(g.desde) : `${corto(g.desde)}–${corto(g.hasta)}`} ${g.rango}`).join(' · ');
}

function semanaDe(hs: HorarioDia[]): DiaHorarioEdit[] {
  return DIAS_SEMANA.map((nombre, i) => {
    const h = hs.find(x => x.weekday === i + 1);
    return { weekday: i + 1, nombre, trabaja: !!h, entrada: h?.entrada ?? '', salida: h?.salida ?? '', descansoMin: h?.descanso_min ?? 0 };
  });
}
