import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import Swal from 'sweetalert2';
import { AuthService, PAQUETES } from '../services/auth.service';
import { WxSelectComponent, WxOpcion } from '../app/wx-select/wx-select.component';
import { WxDateComponent } from '../app/wx-date/wx-date.component';
import { WxMenuComponent, WxMenuOpcion } from '../app/wx-menu/wx-menu.component';
import { ReportService, ReportConfig, ReportColumn, ReportSeccion } from '../services/report.service';
import {
  EgresosService, ConceptoEgreso, FilaEgreso, FormaEgreso, PeriodoPago, ReporteEgresos,
  FORMAS_EGRESO, PERIODOS_PAGO, etiquetaForma, rangoEgresos, fechaLocal,
} from '../core';
import { FechaSqlPipe } from '../core';

type Preset = 'HOY' | 'SEMANA' | 'MES' | 'MES_ANTERIOR' | 'RANGO';

/**
 * EGRESOS y PAGOS AL PERSONAL.
 *
 * Un solo componente con dos vistas, porque es un solo modelo: un pago al
 * personal ES un egreso de concepto "Pago al personal". La ruta dice cual:
 *
 *   /dashboard/egresos          todos los egresos: registrar los que no salen
 *                               del cajon (la renta por transferencia), ver el
 *                               historial y el reporte por concepto.
 *   /dashboard/pagos-personal   la vista del personal: elegir a la persona, su
 *                               historial, cuanto se le ha pagado.
 *
 * No hay reglas aqui: que un egreso en efectivo necesite turno, de que caja
 * salga, que exige un pago al personal, lo decide SQL.
 *
 * "PAGOS FIJOS" (renta, internet, gas...): se registran a mano. Para no
 * capturar lo mismo cada mes, cada fila tiene "Repetir", que abre el
 * formulario con el mismo concepto, monto y forma de pago; nada se registra
 * sin que la persona lo confirme. No hay recordatorios ni egresos automaticos
 * en esta version.
 */
@Component({
  selector: 'app-egresos',
  standalone: true,
  imports: [FechaSqlPipe, CommonModule, FormsModule, WxSelectComponent, WxDateComponent, WxMenuComponent],
  templateUrl: './egresos.html',
  styleUrls: ['../app/proveedores/proveedores.component.css', './egresos.css'],
})
export class Egresos implements OnInit {
  private readonly egresos = inject(EgresosService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);

  readonly personal: boolean = this.route.snapshot.data?.['modo'] === 'personal';
  readonly formas = FORMAS_EGRESO;
  readonly periodos = PERIODOS_PAGO;
  readonly etiquetaForma = etiquetaForma;
  hoy = new Date();

  // ---------------------------------------------------------------- datos
  conceptos: ConceptoEgreso[] = [];
  personas: WxOpcion[] = [];
  reporte: ReporteEgresos | null = null;
  cargando = false;
  error = '';

  // --------------------------------------------------------------- filtros
  preset: Preset = 'MES';
  desde = '';
  hasta = '';
  fConcepto: number | null = null;
  fPersona: number | null = null;
  fForma: FormaEgreso | null = null;
  fCancelados = false;

  // ------------------------------------------------------------ formulario
  formAbierto = false;
  guardando = false;
  form = this.formVacio();

  get puedeRegistrar(): boolean { return this.auth.puede(PAQUETES.VENTAS_SUPERVISAR); }
  get titulo(): string { return this.personal ? 'Pagos al personal' : 'Egresos'; }
  get conceptoPersonal(): ConceptoEgreso | undefined { return this.conceptos.find(c => c.kind === 'PERSONAL'); }

  get opcionesConcepto(): WxOpcion[] {
    return this.conceptos.filter(c => c.active).map(c => ({ valor: c.id, etiqueta: c.name }));
  }
  get opcionesConceptoFiltro(): WxOpcion[] {
    return [{ valor: null, etiqueta: 'Todos los conceptos' },
      ...this.conceptos.map(c => ({ valor: c.id, etiqueta: c.name, nota: c.active ? undefined : 'inactivo' }))];
  }
  get opcionesPersonaFiltro(): WxOpcion[] { return [{ valor: null, etiqueta: 'Todo el personal' }, ...this.personas]; }
  get opcionesFormaFiltro(): WxOpcion[] {
    return [{ valor: null, etiqueta: 'Todas las formas' }, ...this.formas.map(f => ({ valor: f.valor, etiqueta: f.etiqueta }))];
  }
  get formEsPersonal(): boolean {
    return this.personal || this.conceptos.find(c => c.id === this.form.category_id)?.kind === 'PERSONAL';
  }
  get maxConcepto(): number { return Math.max(1, ...(this.reporte?.porConcepto ?? []).map(c => Number(c.total))); }
  get maxPersona(): number { return Math.max(1, ...(this.reporte?.porPersona ?? []).map(c => Number(c.total))); }

  async ngOnInit() {
    this.aplicarPreset('MES', false);
    const [conceptos, personas] = await Promise.all([
      this.egresos.conceptos(true),
      this.puedeRegistrar || this.personal ? this.egresos.personal() : Promise.resolve([]),
    ]);
    this.conceptos = conceptos;
    this.personas = personas.map(p => ({ valor: p.id, etiqueta: p.usuario, nota: p.active ? p.rol : 'inactivo' }));
    await this.consultar();
  }

  aplicarPreset(p: Preset, recargar = true) {
    this.preset = p;
    if (p !== 'RANGO') {
      const r = rangoEgresos(p);
      this.desde = r.desde;
      this.hasta = r.hasta;
    }
    if (recargar) this.consultar();
  }

  async consultar() {
    this.cargando = true;
    this.error = '';
    const r = await this.egresos.listar({
      date_from: this.desde || null,
      date_to: this.hasta || null,
      category_id: this.personal ? null : this.fConcepto,
      staff_user_id: this.fPersona,
      payment_method: this.fForma,
      only_staff: this.personal,
      include_voided: this.fCancelados,
    });
    this.cargando = false;
    if (!r.ok) { this.error = r.error || 'No se pudo consultar.'; this.reporte = null; return; }
    this.reporte = r.data!;
  }

  money(v: any): string {
    return Number(v ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  }

  /* ------------------------------------------------------- exportar
     El periodo consultado, con sus mismos filtros: detalle y totales por
     concepto, persona y forma de pago (una hoja de Excel por cada uno). */
  private readonly reportes = inject(ReportService);
  readonly opcionesExportar: WxMenuOpcion[] = [
    { valor: 'pdf', etiqueta: 'PDF', icono: 'ph ph-file-pdf' },
    { valor: 'excel', etiqueta: 'Excel', icono: 'ph ph-file-xls' },
  ];

  async exportar(tipo: 'pdf' | 'excel') {
    const r = this.reporte;
    if (!r) return;
    const $ = (header: string, key: string): ReportColumn => ({ header, key, width: 14, money: true });
    const fecha = (x: string | null) => (x ? String(x).slice(0, 10).split('-').reverse().join('/') : '');
    const vigentes = r.filas.filter(f => !f.voided_at);
    const secciones: ReportSeccion[] = [
      {
        titulo: this.titulo,
        nota: this.fCancelados ? 'Incluye cancelados (marcados); no suman al total.' : undefined,
        columns: [
          { header: 'Fecha', key: 'fecha', width: 11 }, { header: 'Concepto', key: 'category_name', width: 22 },
          { header: this.personal ? 'Persona' : 'Beneficiario', key: 'quien', width: 20 }, { header: 'Periodo', key: 'periodo', width: 20 },
          { header: 'Forma de pago', key: 'forma', width: 14 }, { header: 'Caja', key: 'register_name', width: 12 },
          { header: 'Registró', key: 'user_name', width: 14 }, { header: 'Nota', key: 'nota', width: 28 }, $('Monto', 'amount'),
        ],
        rows: r.filas.map(f => ({
          ...f, fecha: fecha(f.expense_date), quien: f.staff_name || f.beneficiary || '', periodo: this.periodo(f),
          forma: this.etiquetaForma(f.payment_method),
          nota: [f.note, f.voided_at ? `CANCELADO: ${f.void_reason || ''}` : ''].filter(Boolean).join(' · '),
        })),
        totals: { amount: vigentes.reduce((a, f) => a + Number(f.amount || 0), 0) },
      },
      {
        titulo: 'Por concepto',
        columns: [{ header: 'Concepto', key: 'category_name', width: 26 }, { header: 'Tipo', key: 'tipo', width: 12 }, { header: 'Registros', key: 'egresos', num: true, width: 10 }, $('Total', 'total')],
        rows: r.porConcepto.map(c => ({ ...c, tipo: c.category_kind === 'PERSONAL' ? 'Personal' : 'Egreso' })),
        totals: { total: r.porConcepto.reduce((a, c) => a + Number(c.total || 0), 0) },
      },
      {
        titulo: 'Por persona',
        columns: [{ header: 'Persona', key: 'staff_name', width: 26 }, { header: 'Pagos', key: 'pagos', num: true, width: 10 }, $('Total', 'total')],
        rows: r.porPersona,
        totals: { total: r.porPersona.reduce((a, c) => a + Number(c.total || 0), 0) },
      },
      {
        titulo: 'Por forma de pago',
        columns: [{ header: 'Forma de pago', key: 'forma', width: 20 }, { header: 'Registros', key: 'egresos', num: true, width: 10 }, $('Total', 'total')],
        rows: r.porForma.map(p => ({ ...p, forma: this.etiquetaForma(p.payment_method) })),
        totals: { total: r.porForma.reduce((a, c) => a + Number(c.total || 0), 0) },
      },
    ].filter(s => s.rows.length);
    const cfg: ReportConfig = {
      titulo: this.titulo,
      subtitulo: `${fecha(this.desde) || 'inicio'} a ${fecha(this.hasta) || 'hoy'}`,
      columns: [], rows: [], secciones,
      meta: [`Total ${this.money(r.total?.total)} · salió del cajón ${this.money(r.total?.del_cajon)} · ${r.total?.egresos ?? 0} registros`],
      filename: `${this.personal ? 'pagos-personal' : 'egresos'}_${this.desde || ''}_${this.hasta || ''}`,
    };
    try {
      if (tipo === 'excel') await this.reportes.exportExcel(cfg);
      else await this.reportes.exportPdf(cfg);
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'No se pudo exportar', text: e?.message || 'Intenta de nuevo.' });
    }
  }
  periodo(f: FilaEgreso): string {
    if (!f.period_kind) return '';
    const d = (x: string | null) => (x ? String(x).slice(0, 10) : '');
    const et = this.periodos.find(p => p.valor === f.period_kind)?.etiqueta ?? f.period_kind;
    return d(f.period_from) === d(f.period_to) ? `${et} ${d(f.period_from)}` : `${et} ${d(f.period_from)} → ${d(f.period_to)}`;
  }

  // ------------------------------------------------------------ formulario
  private formVacio() {
    return {
      category_id: null as number | null,
      amount: null as number | null,
      payment_method: 'TRANSFERENCIA' as FormaEgreso,
      expense_date: fechaLocal(new Date()) as string | null,
      note: '',
      beneficiary: '',
      staff_user_id: null as number | null,
      period_kind: 'SEMANA' as PeriodoPago,
      period_from: null as string | null,
      period_to: null as string | null,
    };
  }

  abrirFormulario(base?: FilaEgreso) {
    this.form = this.formVacio();
    if (this.personal) this.form.category_id = this.conceptoPersonal?.id ?? null;
    if (base) {
      /* "Repetir": mismo concepto, monto, forma de pago y persona. La fecha es
         la de hoy y el periodo se vuelve a elegir: nada se registra solo. */
      this.form.category_id = base.category_id;
      this.form.amount = Number(base.amount);
      this.form.payment_method = base.payment_method;
      this.form.beneficiary = base.beneficiary ?? '';
      this.form.staff_user_id = base.staff_user_id;
      if (base.period_kind) this.form.period_kind = base.period_kind;
    }
    this.formAbierto = true;
  }
  cerrarFormulario() { this.formAbierto = false; }

  async guardar() {
    const f = this.form;
    const falta = !f.category_id ? 'Elige el concepto.'
      : !(Number(f.amount) > 0) ? 'El monto debe ser mayor a cero.'
      : this.formEsPersonal && !f.staff_user_id ? 'Elige a quién se le paga.'
      : this.formEsPersonal && f.period_kind === 'OTRO' && (!f.period_from || !f.period_to) ? 'Indica desde y hasta qué fecha se paga.'
      : '';
    if (falta) { await Swal.fire({ icon: 'warning', title: 'Falta un dato', text: falta }); return; }

    this.guardando = true;
    const r = await this.egresos.registrar({
      category_id: f.category_id!,
      amount: Number(f.amount),
      payment_method: f.payment_method,
      /* En efectivo sale HOY del cajon: la fecha la pone SQL. */
      expense_date: f.payment_method === 'EFECTIVO' ? null : f.expense_date,
      note: f.note?.trim() || null,
      beneficiary: this.formEsPersonal ? null : (f.beneficiary?.trim() || null),
      staff_user_id: this.formEsPersonal ? f.staff_user_id : null,
      period_kind: this.formEsPersonal ? f.period_kind : null,
      period_from: this.formEsPersonal && f.period_kind !== 'SEMANA' ? f.period_from : null,
      period_to: this.formEsPersonal && f.period_kind === 'OTRO' ? f.period_to : null,
    });
    this.guardando = false;
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se registró', text: r.error }); return; }
    this.formAbierto = false;
    await Swal.fire({
      icon: 'success',
      title: this.formEsPersonal ? 'Pago registrado' : 'Egreso registrado',
      text: f.payment_method === 'EFECTIVO' ? 'Salió del cajón de esta caja y aparecerá en su corte.' : 'No sale del cajón: el corte no cambia.',
      timer: 1800, showConfirmButton: false,
    });
    await this.consultar();
  }

  async cancelar(f: FilaEgreso) {
    const { value: motivo } = await Swal.fire({
      title: 'Cancelar egreso',
      text: f.payment_method === 'EFECTIVO'
        ? `El dinero (${this.money(f.amount)}) vuelve al cajón del mismo turno. No se borra: queda marcado como cancelado.`
        : 'No se borra: queda marcado como cancelado y deja de contar en los reportes.',
      input: 'text', inputPlaceholder: '¿Por qué se cancela?',
      showCancelButton: true, confirmButtonText: 'Cancelar egreso', cancelButtonText: 'Volver',
      inputValidator: (v) => (!v?.trim() ? 'Escribe el motivo.' : null),
    });
    if (!motivo) return;
    const r = await this.egresos.cancelar(f.id, String(motivo).trim());
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se canceló', text: r.error }); return; }
    await this.consultar();
  }
}
