import { DecimalPipe, CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { NgControl } from '@angular/forms';
import { NgApexchartsModule } from 'ng-apexcharts';

interface TopProductRow {
  product_name?: string;
  total_sold?: number;
}

interface ProfitRow {
  datee?: string;   
  profit?: number;
}

type ViewMode = 'week' | 'month';

interface DailySalesRow {
  sale_date: string; 
  total_sales: number;
}

@Component({
  selector: 'app-estadisticas',
  templateUrl: './estadisticas.html',
  styleUrls: ['./estadisticas.css'],
  standalone: true,
  imports: [NgApexchartsModule, DecimalPipe, CommonModule]
})

export class Estadisticas {
  topProductName: string = '—';  
  topProductQty: number = 0;   
  totalSalesMonth: number = 0;   
  totalSalesToday: number = 0;   
  totalOrders: number = 0;       
  viewMode: ViewMode = 'week';
  profitTotalWeek: number = 0;

  public areaChartSeries = [
    { name: 'Ventas', data: [] as number[] }
  ];

  public areaChartOptions: Partial<any> = {
    chart: { type: 'area', height: 270, toolbar: { show: false } },
    dataLabels: { enabled: false },
    stroke: { curve: 'smooth', width: 2, colors: ['#228be6'] },
    fill: {
      type: 'gradient',
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.4,
        opacityTo: 0.1,
        stops: [0, 90, 100],
        colorStops: []
      }
    },
    xaxis: {
      categories: [] as string[]
    },
    yaxis: { min: 0 },
    grid: { borderColor: '#ececec' }
  };

  public profitChartSeries = [
    { name: 'Utilidad', data: [] as number[] }
  ];
  public profitChartOptions: any = {
    chart: { type: 'bar', height: 270, toolbar: { show: false } },
    plotOptions: { bar: { borderRadius: 8, columnWidth: '45%' } },
    dataLabels: { enabled: false },
    xaxis: { categories: [] as string[] },
    yaxis: { min: 0 },
    grid: { borderColor: '#ececec' },
    colors: ['#31c4be']
  };

  async ngOnInit() {
    await Promise.all([
      this.loadKPIs(),
      this.loadDailySalesChart(),
      this.loadProfitOverviewWeek(),
    ]);
  }

  private asNumber(x: any): number {
    const n = Number(x);
    return Number.isFinite(n) ? n : 0;
  }

  private getCurrentWeekRange(): { from: string; to: string } {
    const today = new Date();
    const day = today.getDay(); 
    const diffToMonday = (day + 6) % 7; 

    const fromDate = new Date(today);
    fromDate.setDate(today.getDate() - diffToMonday);

    const toDate = new Date(fromDate);
    toDate.setDate(fromDate.getDate() + 6);

    const from = fromDate.toISOString().slice(0, 10);
    const to = toDate.toISOString().slice(0, 10);

    return { from, to };
  }

  async setViewMode(mode: ViewMode) {
    if (this.viewMode === mode) return;
    this.viewMode = mode;

    if (mode === 'week') {
      await this.loadWeeklyChart();
    } else {
      await this.loadMonthlyChart();
    }
  }

  private async loadWeeklyChart() {
    await this.loadChartGeneric(
      (window as any).electronAPI?.getDailySalesLast7Days,
      'short',    
      true        
    );
  }

  private async loadMonthlyChart() {
    await this.loadChartGeneric(
      (window as any).electronAPI?.getDailySalesCurrentMonth,
      'numeric',   
      false    
    );
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

  private async loadDailySalesChart() {
    try {
      const res = await (window as any).electronAPI.getDailySalesLast7Days();
      const rows: DailySalesRow[] = Array.isArray(res?.data) ? res.data : [];

      const categories: string[] = [];
      const data: number[] = [];

      for (const r of rows) {
        const d = new Date(r.sale_date);
        const label = d.toLocaleDateString('es-MX', {
          weekday: 'short'
        });

        categories.push(label);
        data.push(this.asNumber(r.total_sales));
      }

      this.areaChartOptions = {
        ...this.areaChartOptions,
        xaxis: { ...(this.areaChartOptions['xaxis'] || {}), categories }
      };

      this.areaChartSeries = [
        { name: 'Ventas', data }
      ];
    } catch (err) {
      console.error('❌ loadDailySalesChart:', err);
      this.areaChartSeries = [{ name: 'Ventas', data: [] }];
    }
  }

  private async loadChartGeneric(
    loaderFn: (() => Promise<any>) | undefined,
    dayLabelStyle: 'short' | 'numeric',
    fillGaps: boolean
  ) {
    try {
      if (!loaderFn) {
        console.warn('loaderFn no disponible');
        return;
      }

      const res = await loaderFn();
      const rows: DailySalesRow[] =
        Array.isArray(res?.data) ? res.data :
        Array.isArray(res?.recordset) ? res.recordset :
        [];

      if (!rows.length) {
        this.areaChartSeries = [{ name: 'Ventas', data: [] }];
        this.areaChartOptions = {
          ...this.areaChartOptions,
          xaxis: { ...(this.areaChartOptions['xaxis'] || {}), categories: [] }
        };
        return;
      }

      // Mapear a un diccionario fecha -> total
      const map = new Map<string, number>();
      for (const r of rows) {
        const d = new Date(r.sale_date);
        const key = d.toISOString().substring(0, 10); // yyyy-mm-dd
        const prev = map.get(key) || 0;
        map.set(key, prev + (Number(r.total_sales) || 0));
      }

      const categories: string[] = [];
      const data: number[] = [];

      if (fillGaps) {
        // Rellenar todos los días entre min y max
        const dates = Array.from(map.keys())
          .map(k => new Date(k))
          .sort((a, b) => a.getTime() - b.getTime());

        const start = dates[0];
        const end   = dates[dates.length - 1];

        for (
          let d = new Date(start);
          d <= end;
          d.setDate(d.getDate() + 1)
        ) {
          const key = d.toISOString().substring(0, 10);
          const val = map.get(key) || 0;

          categories.push(
            dayLabelStyle === 'short'
              ? d.toLocaleDateString('es-MX', { weekday: 'short' })
              : d.getDate().toString()
          );
          data.push(val);
        }
      } else {
        // Sólo días que existen en datos
        const keys = Array.from(map.keys()).sort();
        for (const k of keys) {
          const d = new Date(k);
          categories.push(
            dayLabelStyle === 'short'
              ? d.toLocaleDateString('es-MX', { weekday: 'short' })
              : d.getDate().toString()
          );
          data.push(map.get(k) || 0);
        }
      }

      this.areaChartOptions = {
        ...this.areaChartOptions,
        xaxis: {
          ...(this.areaChartOptions['xaxis'] || {}),
          categories
        }
      };

      this.areaChartSeries = [
        { name: 'Ventas', data }
      ];
    } catch (err) {
      console.error('❌ loadChartGeneric:', err);
    }
  }

  private async loadProfitOverviewWeek() {
    try {
      const { from, to } = this.getCurrentWeekRange();

      const res = await (window as any).electronAPI.getProfitOverview(from, to);
      const rows: ProfitRow[] = Array.isArray(res?.data) ? res.data : [];

      const categories: string[] = [];
      const data: number[] = [];
      let totalProfit = 0;

      for (const r of rows) {
        const fecha = (r as any).datee || (r as any).fecha || (r as any).date;
        const profit = this.asNumber(r.profit ?? (r as any).total_profit);

        const d = new Date(fecha);
        const label = d.toLocaleDateString('es-MX', { weekday: 'short' });

        categories.push(label);
        data.push(profit);
        totalProfit += profit;
      }

      this.profitTotalWeek = totalProfit;
      this.profitChartSeries = [{ name: 'Utilidad', data }];

      this.profitChartOptions['xaxis'] = {
        ...(this.profitChartOptions['xaxis'] || {}),
        categories
      };

    } catch (err) {
      console.error('❌ loadProfitOverviewWeek:', err);
      this.profitTotalWeek = 0;
    }
  }
}
