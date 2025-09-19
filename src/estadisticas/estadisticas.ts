import { DecimalPipe, CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { NgControl } from '@angular/forms';
import { NgApexchartsModule } from 'ng-apexcharts';

interface TopProductRow {
  product_name?: string;
  total_sold?: number;
}

@Component({
  selector: 'app-estadisticas',
  templateUrl: './estadisticas.html',
  styleUrls: ['./estadisticas.css'],
  standalone: true,
  imports: [NgApexchartsModule, DecimalPipe, CommonModule]
})



export class Estadisticas {
  // === KPIs que usa el HTML ===
  topProductName: string = '—';   // Producto más vendido (histórico)
  topProductQty: number = 0;      // Cantidad vendida
  totalSalesMonth: number = 0;    // Ventas del mes (MXN)
  totalSalesToday: number = 0;    // Ventas de hoy (MXN)
  totalOrders: number = 0;        // Órdenes del mes

  // === (Tus charts de ejemplo pueden quedarse) ===
  public areaChartSeries = [{ name: 'Unique Visitors', data: [0, 90, 50, 120, 60, 220, 160] }];
  public areaChartOptions: Partial<any> = {
    chart: { type: 'area', height: 270, toolbar: { show: false } },
    dataLabels: { enabled: false },
    stroke: { curve: 'smooth', width: 2, colors: ['#228be6'] },
    fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.1, stops: [0, 90, 100], colorStops: [] } },
    xaxis: { categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] },
    yaxis: { min: 0 },
    grid: { borderColor: '#ececec' }
  };
  public barChartSeries = [{ name: 'Income', data: [1000, 1500, 1200, 800, 1100, 900, 1300] }];
  public barChartOptions: Partial<any> = {
    chart: { type: 'bar', height: 270, toolbar: { show: false } },
    plotOptions: { bar: { borderRadius: 8, columnWidth: '45%' } },
    dataLabels: { enabled: false },
    xaxis: { categories: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] },
    yaxis: { min: 0 },
    grid: { borderColor: '#ececec' },
    colors: ['#31c4be']
  };

  async ngOnInit() {
    await this.loadKPIs();
  }

  private asNumber(x: any): number {
    const n = Number(x);
    return Number.isFinite(n) ? n : 0;
  }

  private async loadKPIs() {
    try {
      const [
        topRes,
        monthRes,
        todayRes,
        ordersRes
      ] = await Promise.all([
        (window as any).electronAPI.getTopSellingProducts(),
        (window as any).electronAPI.getSalesMonthly(),
        (window as any).electronAPI.getSalesDayly(),
        (window as any).electronAPI.getTotalOrders()
      ]);

      // 1) Producto más vendido (histórico)
      const topRows: TopProductRow[] = Array.isArray(topRes?.data) ? topRes.data : [];
      if (topRows.length) {
        // usa el nombre correcto según tu columna (product_name o nombre)
        this.topProductName = (topRows[0] as any).product_name ?? (topRows[0] as any).nombre ?? '—';
        this.topProductQty  = this.asNumber(topRows[0].total_sold);
      } else {
        this.topProductName = '—';
        this.topProductQty  = 0;
      }

      // 2) Total ventas del mes -> res.data[0].total_sales
      const monthRow = monthRes?.data?.[0] ?? {};
      this.totalSalesMonth = this.asNumber(monthRow.total_sales);

      // 3) Total ventas de hoy -> res.data[0].total_sales_today
      const todayRow = todayRes?.data?.[0] ?? {};
      this.totalSalesToday = this.asNumber(todayRow.total_sales_today);

      // 4) Total órdenes del mes -> res.data[0].total_orders
      const ordersRow = ordersRes?.data?.[0] ?? {};
      this.totalOrders = this.asNumber(ordersRow.total_orders);

    } catch (err) {
      console.error('❌ loadKPIs:', err);
      this.topProductName = '—';
      this.topProductQty = 0;
      this.totalSalesMonth = 0;
      this.totalSalesToday = 0;
      this.totalOrders = 0;
    }
  }
}
