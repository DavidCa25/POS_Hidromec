import { DecimalPipe, CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import Swal from 'sweetalert2';
import { ReportService, ReportConfig, ReportColumn, ReportSeccion } from '../services/report.service';
import { WxMenuComponent, WxMenuOpcion } from '../app/wx-menu/wx-menu.component';
import { RouterLink } from '@angular/router';
import { NgApexchartsModule } from 'ng-apexcharts';
import { ActividadHorariaComponent } from './actividad-horaria/actividad-horaria.component';
import { fechaLocal } from '../core';

type Seg = 'ventas' | 'clientes' | 'productos' | 'caja' | 'horarios';
type ViewMode = 'week' | 'month';

@Component({
  selector: 'app-estadisticas',
  templateUrl: './estadisticas.html',
  styleUrls: ['./estadisticas.css'],
  standalone: true,
  imports: [NgApexchartsModule, DecimalPipe, CommonModule, ActividadHorariaComponent, RouterLink, WxMenuComponent]
})
export class Estadisticas {
  seg: Seg = 'ventas';
  private get api() { return (window as any).electronAPI; }

  // ---- Ventas ----
  totalSalesMonth = 0;
  totalSalesToday = 0;
  totalOrders = 0;
  viewMode: ViewMode = 'week';
  salesByPayment: { payment_method: string; tickets: number; total: number }[] = [];
  get ticketPromedio(): number { return this.totalOrders > 0 ? this.totalSalesMonth / this.totalOrders : 0; }

  // ---- Clientes ----
  cliActivos = 0;
  cliNuevos = 0;
  cliConCompras = 0;
  topCustomers: { nombre: string; compras: number; total: number }[] = [];

  // ---- Productos ----
  topProductName = '—';
  topProductQty = 0;
  topProducts: { nombre: string; total_sold: number }[] = [];
  deadProducts: { nombre: string; stock: number; price: number }[] = [];

  // ---- Caja / utilidad ----
  profitTotalWeek = 0;
  cashEntradas = 0;
  cashSalidas = 0;
  cashPagosProv = 0;
  cashRetiros = 0;
  cashEgresos = 0;

  // ---- Charts ----
  areaChartSeries = [{ name: 'Ventas', data: [] as number[] }];
  areaChartOptions: any = {
    chart: { type: 'area', height: 280, toolbar: { show: false } },
    dataLabels: { enabled: false },
    stroke: { curve: 'smooth', width: 2 },
    colors: ['#2563eb'],
    fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.35, opacityTo: 0.05, stops: [0, 90, 100] } },
    xaxis: { categories: [] as string[] },
    yaxis: { min: 0 },
    grid: { borderColor: '#eef2f7' }
  };

  profitChartSeries = [{ name: 'Utilidad', data: [] as number[] }];
  profitChartOptions: any = {
    chart: { type: 'bar', height: 280, toolbar: { show: false } },
    plotOptions: { bar: { borderRadius: 8, columnWidth: '45%' } },
    dataLabels: { enabled: false },
    xaxis: { categories: [] as string[] },
    // 0062: con el costo congelado un día puede perder; sin `min: 0` se ve.
    grid: { borderColor: '#eef2f7' },
    colors: ['#10b981']
  };

  async ngOnInit() {
    await Promise.all([
      this.loadVentas(),
      this.loadClientes(),
      this.loadProductos(),
      this.loadCaja()
    ]);
  }

  segChange(s: Seg) { this.seg = s; }

  /* ------------------------------------------------------- exportar
     El tablero completo con lo que ya está cargado: indicadores, series de
     las gráficas como tablas y los rankings. Una hoja de Excel por cada uno. */
  private readonly reportes = inject(ReportService);
  readonly opcionesExportar: WxMenuOpcion[] = [
    { valor: 'pdf', etiqueta: 'PDF', icono: 'ph ph-file-pdf' },
    { valor: 'excel', etiqueta: 'Excel', icono: 'ph ph-file-xls' },
  ];

  async exportar(tipo: 'pdf' | 'excel') {
    const $ = (header: string, key: string): ReportColumn => ({ header, key, width: 16, money: true });
    const serie = (cats: string[], datos: number[]) => cats.map((c, i) => ({ dia: c, valor: datos[i] ?? 0 }));
    const totalPagos = this.salesByPayment.reduce((s, p) => s + p.total, 0);
    const cfg: ReportConfig = {
      titulo: 'Estadísticas',
      subtitulo: new Date().toLocaleDateString('es-MX', { dateStyle: 'long' }),
      columns: [], rows: [],
      filename: 'estadisticas',
      secciones: ([
        {
          titulo: 'Indicadores',
          columns: [{ header: 'Indicador', key: 'k', width: 34 }, { header: 'Valor', key: 'v', width: 18, align: 'right' }],
          rows: [
            { k: 'Ventas del mes', v: this.money(this.totalSalesMonth) },
            { k: 'Ventas de hoy', v: this.money(this.totalSalesToday) },
            { k: 'Tickets del mes', v: String(this.totalOrders) },
            { k: 'Ticket promedio', v: this.money(this.ticketPromedio) },
            { k: 'Clientes activos', v: String(this.cliActivos) },
            { k: 'Clientes nuevos (30 días)', v: String(this.cliNuevos) },
            { k: 'Clientes con compras', v: String(this.cliConCompras) },
            { k: 'Producto más vendido', v: `${this.topProductName} (${this.topProductQty})` },
            { k: 'Utilidad de la semana', v: this.money(this.profitTotalWeek) },
          ],
        },
        {
          titulo: this.viewMode === 'week' ? 'Ventas de los últimos 7 días' : 'Ventas del mes por día',
          columns: [{ header: 'Día', key: 'dia', width: 14 }, $('Ventas', 'valor')],
          rows: serie(this.areaChartOptions.xaxis?.categories ?? [], this.areaChartSeries[0]?.data ?? []),
        },
        {
          titulo: 'Por forma de pago (30 días)',
          columns: [{ header: 'Forma de pago', key: 'payment_method', width: 22 }, { header: 'Tickets', key: 'tickets', num: true, width: 10 }, $('Total', 'total'), { header: '%', key: 'pct', pct: true, width: 8 }],
          rows: this.salesByPayment.map(p => ({ ...p, pct: totalPagos ? (100 * p.total) / totalPagos : 0 })),
          totals: { total: totalPagos },
        },
        {
          titulo: 'Utilidad de la semana',
          nota: 'Venta sin IVA menos el costo congelado de cada producto vendido.',
          columns: [{ header: 'Día', key: 'dia', width: 14 }, $('Utilidad', 'valor')],
          rows: serie(this.profitChartOptions.xaxis?.categories ?? [], this.profitChartSeries[0]?.data ?? []),
          totals: { valor: this.profitTotalWeek },
        },
        {
          titulo: 'Caja (30 días)',
          columns: [{ header: 'Concepto', key: 'k', width: 26 }, $('Importe', 'v')],
          rows: [
            { k: 'Entradas de efectivo', v: this.cashEntradas }, { k: 'Salidas de efectivo', v: this.cashSalidas },
            { k: 'Pagos a proveedores', v: this.cashPagosProv }, { k: 'Retiros', v: this.cashRetiros }, { k: 'Egresos', v: this.cashEgresos },
          ],
        },
        {
          titulo: 'Clientes que más compran',
          columns: [{ header: 'Cliente', key: 'nombre', width: 30 }, { header: 'Compras', key: 'compras', num: true, width: 10 }, $('Total', 'total')],
          rows: this.topCustomers,
        },
        {
          titulo: 'Más vendidos',
          columns: [{ header: 'Producto', key: 'nombre', width: 34 }, { header: 'Vendidos', key: 'total_sold', num: true, width: 12 }],
          rows: this.topProducts,
        },
        {
          titulo: 'Sin rotación',
          nota: 'Productos que nunca se han vendido.',
          columns: [{ header: 'Producto', key: 'nombre', width: 34 }, { header: 'Existencia', key: 'stock', num: true, width: 12 }, $('Precio', 'price')],
          rows: this.deadProducts,
        },
      ] as ReportSeccion[]).filter(s => s.rows.length),
    };
    try {
      if (tipo === 'excel') await this.reportes.exportExcel(cfg);
      else await this.reportes.exportPdf(cfg);
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'No se pudo exportar', text: e?.message || 'Intenta de nuevo.' });
    }
  }

  private asNumber(x: any): number { const n = Number(x); return Number.isFinite(n) ? n : 0; }
  money(n: number): string { return '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  private getCurrentWeekRange(): { from: string; to: string } {
    const today = new Date();
    const day = today.getDay();
    const diffToMonday = (day + 6) % 7;
    const fromDate = new Date(today); fromDate.setDate(today.getDate() - diffToMonday);
    const toDate = new Date(fromDate); toDate.setDate(fromDate.getDate() + 6);
    return { from: fechaLocal(fromDate), to: fechaLocal(toDate) };
  }

  // Barras horizontales (porcentaje relativo al maximo)
  pct(v: number, max: number): number { return max > 0 ? Math.max(3, Math.round((v / max) * 100)) : 0; }
  get maxPayment() { return Math.max(1, ...this.salesByPayment.map(p => this.asNumber(p.total))); }
  get maxTopCustomer() { return Math.max(1, ...this.topCustomers.map(c => this.asNumber(c.total))); }
  get maxTopProduct() { return Math.max(1, ...this.topProducts.map(p => this.asNumber(p.total_sold))); }

  // ================= VENTAS =================
  async loadVentas() {
    try {
      const [monthRes, todayRes, ordersRes, payRes] = await Promise.all([
        this.api.getSalesMonthly(), this.api.getSalesDayly(), this.api.getTotalOrders(),
        this.api.salesByPayment?.({ days: 30 })
      ]);
      this.totalSalesMonth = this.asNumber(monthRes?.data?.[0]?.total_sales);
      this.totalSalesToday = this.asNumber(todayRes?.data?.[0]?.total_sales_today);
      this.totalOrders = this.asNumber(ordersRes?.data?.[0]?.total_orders);
      this.salesByPayment = (payRes?.success ? (payRes.data || []) : []).map((r: any) => ({
        payment_method: r.payment_method ?? '—', tickets: this.asNumber(r.tickets), total: this.asNumber(r.total)
      }));
      await this.loadSalesChart();
    } catch (e) { console.error('loadVentas', e); }
  }

  async setViewMode(m: ViewMode) { if (this.viewMode === m) return; this.viewMode = m; await this.loadSalesChart(); }

  private async loadSalesChart() {
    try {
      const fn = this.viewMode === 'week' ? this.api.getDailySalesLast7Days : this.api.getDailySalesCurrentMonth;
      const res = await fn();
      const rows = Array.isArray(res?.data) ? res.data : [];
      const cats: string[] = [], data: number[] = [];
      for (const r of rows) {
        const d = new Date(r.sale_date);
        cats.push(this.viewMode === 'week' ? d.toLocaleDateString('es-MX', { weekday: 'short' }) : String(d.getDate()));
        data.push(this.asNumber(r.total_sales));
      }
      this.areaChartOptions = { ...this.areaChartOptions, xaxis: { ...(this.areaChartOptions.xaxis || {}), categories: cats } };
      this.areaChartSeries = [{ name: 'Ventas', data }];
    } catch (e) { console.error('loadSalesChart', e); }
  }

  // ================= CLIENTES =================
  async loadClientes() {
    try {
      const [kpiRes, topRes] = await Promise.all([
        this.api.customersKpis?.(), this.api.topCustomers?.({ limit: 10 })
      ]);
      const k = kpiRes?.data || {};
      this.cliActivos = this.asNumber(k.activos);
      this.cliNuevos = this.asNumber(k.nuevos_30d);
      this.cliConCompras = this.asNumber(k.con_compras);
      this.topCustomers = (topRes?.success ? (topRes.data || []) : []).map((r: any) => ({
        nombre: r.nombre ?? '—', compras: this.asNumber(r.compras), total: this.asNumber(r.total)
      }));
    } catch (e) { console.error('loadClientes', e); }
  }

  // ================= PRODUCTOS =================
  async loadProductos() {
    try {
      const [topRes, deadRes] = await Promise.all([
        this.api.getTopSellingProducts(), this.api.deadProducts?.({ limit: 15 })
      ]);
      const rows = Array.isArray(topRes?.data) ? topRes.data : [];
      this.topProducts = rows.map((r: any) => ({ nombre: r.product_name ?? r.nombre ?? '—', total_sold: this.asNumber(r.total_sold) }));
      if (this.topProducts.length) { this.topProductName = this.topProducts[0].nombre; this.topProductQty = this.topProducts[0].total_sold; }
      this.deadProducts = (deadRes?.success ? (deadRes.data || []) : []).map((r: any) => ({
        nombre: r.nombre ?? '—', stock: this.asNumber(r.stock), price: this.asNumber(r.price)
      }));
    } catch (e) { console.error('loadProductos', e); }
  }

  // ================= CAJA / UTILIDAD =================
  async loadCaja() {
    try {
      const { from, to } = this.getCurrentWeekRange();
      const [profRes, cashRes] = await Promise.all([
        this.api.getProfitOverview(from, to), this.api.cashSummary?.({ days: 30 })
      ]);
      const rows = Array.isArray(profRes?.data) ? profRes.data : [];
      const cats: string[] = [], data: number[] = []; let total = 0;
      for (const r of rows) {
        const fecha = r.datee || r.fecha || r.date;
        const profit = this.asNumber(r.profit ?? r.total_profit);
        cats.push(new Date(fecha).toLocaleDateString('es-MX', { weekday: 'short' }));
        data.push(profit); total += profit;
      }
      this.profitTotalWeek = total;
      this.profitChartSeries = [{ name: 'Utilidad', data }];
      this.profitChartOptions = { ...this.profitChartOptions, xaxis: { ...(this.profitChartOptions.xaxis || {}), categories: cats } };

      const c = cashRes?.data || {};
      this.cashEntradas = this.asNumber(c.entradas);
      this.cashSalidas = this.asNumber(c.salidas);
      this.cashPagosProv = this.asNumber(c.pagos_proveedores);
      this.cashRetiros = this.asNumber(c.retiros);
      this.cashEgresos = this.asNumber(c.egresos);
    } catch (e) { console.error('loadCaja', e); }
  }
}
