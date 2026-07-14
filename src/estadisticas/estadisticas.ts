import { DecimalPipe, CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { NgApexchartsModule } from 'ng-apexcharts';

type Seg = 'ventas' | 'clientes' | 'productos' | 'caja';
type ViewMode = 'week' | 'month';

@Component({
  selector: 'app-estadisticas',
  templateUrl: './estadisticas.html',
  styleUrls: ['./estadisticas.css'],
  standalone: true,
  imports: [NgApexchartsModule, DecimalPipe, CommonModule]
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
    yaxis: { min: 0 },
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

  private asNumber(x: any): number { const n = Number(x); return Number.isFinite(n) ? n : 0; }
  money(n: number): string { return '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  private getCurrentWeekRange(): { from: string; to: string } {
    const today = new Date();
    const day = today.getDay();
    const diffToMonday = (day + 6) % 7;
    const fromDate = new Date(today); fromDate.setDate(today.getDate() - diffToMonday);
    const toDate = new Date(fromDate); toDate.setDate(fromDate.getDate() + 6);
    return { from: fromDate.toISOString().slice(0, 10), to: toDate.toISOString().slice(0, 10) };
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
    } catch (e) { console.error('loadCaja', e); }
  }
}
