import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WxDateComponent } from '../wx-date/wx-date.component';
import { WxCargandoComponent } from '../wx-cargando/wx-cargando.component';
import { ReportService, ReportConfig, ReportColumn } from '../../services/report.service';
import { WxMenuComponent, WxMenuOpcion } from '../wx-menu/wx-menu.component';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { nombrePlataforma } from '../../../shared/plataformas';

/** Un periodo de sp_income_statement (resultado 1). */
interface Resumen {
  periodo: 'ACTUAL' | 'ANTERIOR'; desde: string; hasta: string; tickets: number; descuentos: number;
  ventas_cobradas: number; devoluciones_cobradas: number; iva_trasladado: number; ventas_netas: number;
  costo_ventas: number; utilidad_bruta: number; mermas: number; ajustes_inventario: number;
  egresos_generales: number; pagos_personal: number; utilidad_operacion: number;
  renglones_costo_estimado: number; ventas_sin_costo: number;
  /* 0069: lo que descontaron las plataformas (liquidaciones confirmadas). */
  descuentos_plataforma: number; comisiones_plataforma: number;
  iva_comisiones_plataforma: number; retenciones_plataforma: number;
}
/** 0069: utilidad por canal de venta (resultado 7). */
interface Canal {
  canal: string; nombre: string; plataforma: string | null; tickets: number; ventas: number;
  descuentos_plataforma: number; ventas_netas: number; costo: number; comisiones_plataforma: number;
  utilidad: number; margen: number | null; retenciones_plataforma: number; sin_liquidar: boolean;
}
interface Datos {
  actual: Resumen; anterior: Resumen;
  egresos: { kind: string; concepto: string; total: number; movimientos: number; total_anterior: number }[];
  categorias: { categoria: string; ventas_netas: number; costo: number; comisiones_plataforma: number; utilidad: number; margen: number | null }[];
  dias: { dia: string; ventas_netas: number; costo_ventas: number; gastos: number; utilidad: number }[];
  productos: Producto[]; perdidas: Producto[];
  canales: Canal[];
}
interface Producto { id: number; producto: string; cantidad: number; ventas_netas: number; costo: number; utilidad: number; margen: number | null; costo_estimado: number; }

/** Un renglón del estado: signo con el que se lee y si es un subtotal. */
interface Renglon { etiqueta: string; clave: keyof Resumen; signo: 1 | -1; total?: boolean; nota?: string; plataforma?: boolean; }

const RENGLONES: Renglon[] = [
  { etiqueta: 'Ventas cobradas', clave: 'ventas_cobradas', signo: 1, nota: 'Con IVA, ya con descuentos y promociones' },
  { etiqueta: 'Devoluciones', clave: 'devoluciones_cobradas', signo: -1 },
  { etiqueta: 'IVA trasladado', clave: 'iva_trasladado', signo: -1, nota: 'Es del SAT, no del negocio' },
  { etiqueta: 'Promociones y reembolsos de plataformas', clave: 'descuentos_plataforma', signo: -1, nota: 'Lo que Uber Eats, Didi o Rappi descontaron, sin IVA', plataforma: true },
  { etiqueta: 'Ventas netas', clave: 'ventas_netas', signo: 1, total: true },
  { etiqueta: 'Costo de lo vendido', clave: 'costo_ventas', signo: -1, nota: 'El costo de cada producto el día que se vendió' },
  { etiqueta: 'Utilidad bruta', clave: 'utilidad_bruta', signo: 1, total: true },
  { etiqueta: 'Mermas de producto terminado', clave: 'mermas', signo: -1, nota: 'Lo que se tiró' },
  { etiqueta: 'Faltantes de inventario', clave: 'ajustes_inventario', signo: -1, nota: 'Ajustes por conteo, al costo actual' },
  { etiqueta: 'Egresos', clave: 'egresos_generales', signo: -1, nota: 'Renta, luz, servicios…' },
  { etiqueta: 'Pagos al personal', clave: 'pagos_personal', signo: -1 },
  { etiqueta: 'Comisiones de plataformas', clave: 'comisiones_plataforma', signo: -1, nota: 'Sin IVA; su IVA es acreditable', plataforma: true },
  { etiqueta: 'Utilidad de operación', clave: 'utilidad_operacion', signo: 1, total: true },
];

type Preset = 'MES' | 'MES_PASADO' | 'DIAS30' | 'ANIO';
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/*
 * ESTADO DE RESULTADOS (0062).
 *
 * ¿Cuánto ganó de verdad el negocio? Ventas sin IVA, menos el costo
 * CONGELADO de lo vendido, menos mermas, faltantes y egresos. Todo el
 * cálculo vive en sp_income_statement; aquí solo se presenta y se exporta.
 */
@Component({
  selector: 'app-estado-resultados',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, WxDateComponent, WxCargandoComponent, WxMenuComponent],
  templateUrl: './estado-resultados.component.html',
  styleUrls: ['./estado-resultados.component.css'],
})
export class EstadoResultadosComponent implements OnInit {
  private readonly reportes = inject(ReportService);
  private readonly ruta = inject(ActivatedRoute);
  readonly nombrePlataforma = nombrePlataforma;
  /** Los renglones de plataforma solo aparecen si el negocio vende por una
     (en el periodo o en el anterior): a quien no, no le dicen nada. */
  readonly conPlataformas = computed(() => {
    const d = this.datos();
    return !!d && (d.canales ?? []).some((c) => c.plataforma)
      || [this.datos()?.actual, this.datos()?.anterior].some((s) => s && (s.descuentos_plataforma || s.comisiones_plataforma));
  });
  readonly sinLiquidar = computed(() => (this.datos()?.canales ?? []).filter((c) => c.sin_liquidar));
  readonly nombreCanal = (c: Canal) => c.nombre;
  get renglones() { return this.conPlataformas() ? RENGLONES : RENGLONES.filter((r) => !r.plataforma); }
  readonly opcionesExportar: WxMenuOpcion[] = [
    { valor: 'pdf', etiqueta: 'PDF', icono: 'ph ph-file-pdf' },
    { valor: 'excel', etiqueta: 'Excel', icono: 'ph ph-file-xls' },
  ];
  readonly hoy = iso(new Date());
  readonly presets: { id: Preset; texto: string }[] = [
    { id: 'MES', texto: 'Este mes' }, { id: 'MES_PASADO', texto: 'Mes pasado' },
    { id: 'DIAS30', texto: 'Últimos 30 días' }, { id: 'ANIO', texto: 'Este año' },
  ];
  readonly preset = signal<Preset | null>('MES');
  readonly desde = signal(iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  readonly hasta = signal(this.hoy);
  readonly datos = signal<Datos | null>(null);
  readonly cargando = signal(false);
  readonly error = signal('');
  readonly diaActivo = signal<number | null>(null);

  readonly a = computed(() => this.datos()?.actual ?? null);
  readonly b = computed(() => this.datos()?.anterior ?? null);
  readonly totalEgresos = computed(() => (this.datos()?.egresos ?? []).reduce((s, e) => s + Number(e.total || 0), 0));
  /** Escala de las barras diarias: el mayor valor absoluto del periodo. */
  readonly escala = computed(() => Math.max(1, ...(this.datos()?.dias ?? []).map((d) => Math.abs(Number(d.utilidad) || 0))));
  readonly hayNegativos = computed(() => (this.datos()?.dias ?? []).some((d) => Number(d.utilidad) < 0));

  private get api() { return (window as any).electronAPI; }

  ngOnInit() {
    /* 0069: Liquidaciones abre el estado del periodo que se liquidó. */
    const q = this.ruta.snapshot.queryParamMap, f = /^\d{4}-\d{2}-\d{2}$/;
    const d = q.get('desde'), h = q.get('hasta');
    if (d && h && f.test(d) && f.test(h) && d <= h) {
      this.desde.set(d);
      this.hasta.set(h > this.hoy ? this.hoy : h);
      this.preset.set(null);
    }
    this.cargar();
  }

  elegir(p: Preset) {
    const h = new Date();
    let d: Date, f: Date = h;
    if (p === 'MES') d = new Date(h.getFullYear(), h.getMonth(), 1);
    else if (p === 'MES_PASADO') { d = new Date(h.getFullYear(), h.getMonth() - 1, 1); f = new Date(h.getFullYear(), h.getMonth(), 0); }
    else if (p === 'DIAS30') d = new Date(h.getFullYear(), h.getMonth(), h.getDate() - 29);
    else d = new Date(h.getFullYear(), 0, 1);
    this.preset.set(p);
    this.desde.set(iso(d));
    this.hasta.set(iso(f));
    this.cargar();
  }

  cambiarDesde(v: string | null) { if (v) { this.desde.set(v); this.preset.set(null); this.cargar(); } }
  cambiarHasta(v: string | null) { if (v) { this.hasta.set(v); this.preset.set(null); this.cargar(); } }

  async cargar() {
    this.cargando.set(true);
    this.error.set('');
    try {
      const r = await this.api.estadoResultados({ desde: this.desde(), hasta: this.hasta() });
      if (!r?.success) throw Error(r?.error || 'No se pudo calcular el estado de resultados.');
      this.datos.set(r.data);
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.cargando.set(false);
    }
  }

  dinero(n: number | null | undefined) {
    const v = Number(n || 0);
    return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  /** Lo que se ve en el estado: los renglones que restan llevan signo menos. */
  valor(r: Renglon, s: Resumen | null) { return s ? Number(s[r.clave] || 0) * (r.total ? 1 : r.signo) : 0; }
  margen(n: number, base: number) { return base ? (100 * n) / base : null; }
  /** Variación contra el periodo anterior, en %. Null si no hay contra qué comparar. */
  variacion(r: Renglon) {
    const a = Number(this.a()?.[r.clave] || 0), b = Number(this.b()?.[r.clave] || 0);
    if (!b) return null;
    return (100 * (a - b)) / Math.abs(b);
  }
  /** Si subir es bueno (ventas, utilidad) o malo (costos, gastos). */
  mejora(r: Renglon) {
    const v = this.variacion(r);
    if (v == null || Math.abs(v) < 0.5) return 'igual';
    const sube = v > 0;
    return (r.signo === 1 ? sube : !sube) ? 'mejor' : 'peor';
  }
  pct(v: number | null) { return v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`; }
  alto(v: number) { return `${Math.max(2, Math.round((Math.abs(Number(v) || 0) / this.escala()) * 100))}%`; }
  fechaCorta(d: string) { const [, m, dia] = d.split('-'); return `${dia}/${m}`; }
  periodoTexto(s: Resumen | null) { return s ? `${this.fechaCorta(s.desde)}/${s.desde.slice(0, 4)} – ${this.fechaCorta(s.hasta)}/${s.hasta.slice(0, 4)}` : ''; }

  async exportar(tipo: 'excel' | 'pdf') {
    const d = this.datos(), a = this.a(), b = this.b();
    if (!d || !a || !b) return;
    const rows = this.renglones.map((r) => ({
      concepto: (r.total ? '= ' : r.signo < 0 ? '− ' : '') + r.etiqueta,
      actual: this.valor(r, a), anterior: this.valor(r, b), variacion: this.pct(this.variacion(r)),
      __total: !!r.total,
    }));
    const m = (n: number | null) => (n == null ? '—' : `${n.toFixed(1)}%`);
    const dinero = (header: string, key: string): ReportColumn => ({ header, key, width: 16, money: true });
    const cfg: ReportConfig = {
      titulo: 'Estado de resultados',
      subtitulo: `${this.periodoTexto(a)} contra ${this.periodoTexto(b)}`,
      columns: [], rows: [],
      secciones: [
        {
          titulo: 'Estado de resultados',
          columns: [
            { header: 'Concepto', key: 'concepto', width: 38 },
            dinero('Periodo', 'actual'), dinero('Periodo anterior', 'anterior'),
            { header: 'Variación', key: 'variacion', width: 12, align: 'right' },
          ],
          rows,
        },
        {
          titulo: 'Utilidad por día',
          nota: 'Ventas netas sin IVA; gastos = mermas + faltantes + egresos del día.',
          columns: [{ header: 'Día', key: 'dia', width: 12 }, dinero('Ventas netas', 'ventas_netas'), dinero('Costo', 'costo_ventas'), dinero('Gastos', 'gastos'), dinero('Utilidad', 'utilidad')],
          rows: d.dias.map((x) => ({ ...x, dia: x.dia.split('-').reverse().join('/') })),
          totals: {
            ventas_netas: d.dias.reduce((s, x) => s + Number(x.ventas_netas || 0), 0),
            costo_ventas: d.dias.reduce((s, x) => s + Number(x.costo_ventas || 0), 0),
            gastos: d.dias.reduce((s, x) => s + Number(x.gastos || 0), 0),
            utilidad: d.dias.reduce((s, x) => s + Number(x.utilidad || 0), 0),
          },
        },
        {
          titulo: 'Egresos por concepto',
          columns: [{ header: 'Concepto', key: 'concepto', width: 28 }, { header: 'Tipo', key: 'tipo', width: 12 }, { header: 'Pagos', key: 'movimientos', num: true, width: 10 }, dinero('Periodo', 'total'), dinero('Periodo anterior', 'total_anterior')],
          rows: d.egresos.map((e) => ({ ...e, tipo: e.kind === 'PERSONAL' ? 'Personal' : 'Egreso' })),
          totals: { total: this.totalEgresos(), total_anterior: d.egresos.reduce((s, e) => s + Number(e.total_anterior || 0), 0) },
        },
        ...(d.canales?.length ? [{
          titulo: 'Por canal de venta',
          nota: 'Ventas sin IVA. Promociones, reembolsos y comisiones de plataforma salen de las liquidaciones confirmadas.',
          columns: [{ header: 'Canal', key: 'nombre', width: 22 }, { header: 'Plataforma', key: 'plat', width: 14 }, { header: 'Tickets', key: 'tickets', num: true, width: 9 },
            dinero('Ventas', 'ventas'), dinero('Promociones y reemb.', 'descuentos_plataforma'), dinero('Costo', 'costo'), dinero('Comisiones', 'comisiones_plataforma'),
            dinero('Utilidad', 'utilidad'), { header: 'Margen', key: 'margen', pct: true, width: 10 }],
          rows: d.canales.map((c) => ({ ...c, plat: c.plataforma ? nombrePlataforma(c.plataforma) + (c.sin_liquidar ? ' (sin liquidar)' : '') : '—' })),
        }] : []),
        {
          titulo: 'Por categoría',
          columns: [{ header: 'Categoría', key: 'categoria', width: 26 }, dinero('Ventas netas', 'ventas_netas'), dinero('Costo', 'costo'),
            ...(a.comisiones_plataforma ? [dinero('Comisiones de plataforma', 'comisiones_plataforma')] : []),
            dinero('Utilidad', 'utilidad'), { header: 'Margen', key: 'margen', pct: true, width: 10 }],
          rows: d.categorias,
        },
        {
          titulo: 'Productos que más dejan',
          columns: [{ header: 'Producto', key: 'producto', width: 32 }, { header: 'Vendidos', key: 'cantidad', num: true, width: 10 }, dinero('Ventas netas', 'ventas_netas'), dinero('Costo', 'costo'), dinero('Utilidad', 'utilidad'), { header: 'Margen', key: 'margen', pct: true, width: 10 }],
          rows: d.productos,
        },
        {
          titulo: 'Vendidos por debajo del costo',
          columns: [{ header: 'Producto', key: 'producto', width: 32 }, { header: 'Vendidos', key: 'cantidad', num: true, width: 10 }, dinero('Ventas netas', 'ventas_netas'), dinero('Costo', 'costo'), dinero('Pérdida', 'utilidad')],
          rows: d.perdidas,
        },
      ],
      meta: [
        `Margen bruto ${m(this.margen(a.utilidad_bruta, a.ventas_netas))} (antes ${m(this.margen(b.utilidad_bruta, b.ventas_netas))}) · margen de operación ${m(this.margen(a.utilidad_operacion, a.ventas_netas))} (antes ${m(this.margen(b.utilidad_operacion, b.ventas_netas))})`,
        `${a.tickets} tickets · descuentos otorgados ${this.dinero(a.descuentos)}`,
        'Las compras no son gasto: se vuelven costo cuando se venden.',
        ...(a.retenciones_plataforma > 0 || a.iva_comisiones_plataforma > 0 ? [`Plataformas: ${this.dinero(a.retenciones_plataforma)} de ISR e IVA retenidos y ${this.dinero(a.iva_comisiones_plataforma)} de IVA de comisiones; son impuestos acreditables, no gasto. Confírmalo con tu contador.`] : []),
        ...(a.ventas_sin_costo > 0 ? [`${this.dinero(a.ventas_sin_costo)} de ventas sin costo congelado: su utilidad es estimada.`] : []),
      ],
      filename: `estado-resultados_${a.desde}_${a.hasta}`,
    };
    try {
      if (tipo === 'excel') await this.reportes.exportExcel(cfg);
      else await this.reportes.exportPdf(cfg);
    } catch (e: any) {
      this.error.set(e?.message || 'No se pudo exportar.');
    }
  }
}
