import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import Swal from 'sweetalert2';
import { AuthService, PAQUETES } from '../services/auth.service';
import { WxSelectComponent, WxOpcion } from '../app/wx-select/wx-select.component';
import { WxDateComponent } from '../app/wx-date/wx-date.component';
import {
  EgresosService, ConceptoEgreso, FilaEgreso, FormaEgreso, PeriodoPago, ReporteEgresos,
  FORMAS_EGRESO, PERIODOS_PAGO, etiquetaForma, rangoEgresos, fechaLocal,
} from '../core';

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
  imports: [CommonModule, FormsModule, WxSelectComponent, WxDateComponent],
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
