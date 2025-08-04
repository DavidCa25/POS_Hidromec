import { DecimalPipe, CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { NgApexchartsModule } from 'ng-apexcharts';

@Component({
  selector: 'app-estadisticas',
  templateUrl: './estadisticas.html',
  styleUrls: ['./estadisticas.css'],
  standalone: true,
  imports: [NgApexchartsModule, DecimalPipe, CommonModule]
})
export class Estadisticas {
  // Tarjetas métricas
  totalPageViews = 442236;
  totalUsers = 78250;
  totalOrders = 18800;
  totalSales = 35078;

  // Área chart (Unique Visitor)
  public areaChartSeries = [
    {
      name: "Unique Visitors",
      data: [0, 90, 50, 120, 60, 220, 160]
    }
  ];
  public areaChartOptions: Partial<any> = {
    chart: {
      type: "area",
      height: 270,
      toolbar: { show: false }
    },
    dataLabels: {
      enabled: false
    },
    stroke: {
      curve: "smooth",
      width: 2,
      colors: ['#228be6']
    },
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
      categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    },
    yaxis: {
      min: 0
    },
    grid: {
      borderColor: "#ececec"
    }
  };

  // Bar chart (Income Overview)
  public barChartSeries = [
    {
      name: "Income",
      data: [1000, 1500, 1200, 800, 1100, 900, 1300]
    }
  ];
  public barChartOptions: Partial<any> = {
    chart: {
      type: "bar",
      height: 270,
      toolbar: { show: false }
    },
    plotOptions: {
      bar: {
        borderRadius: 8,
        columnWidth: '45%'
      }
    },
    dataLabels: {
      enabled: false
    },
    xaxis: {
      categories: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
    },
    yaxis: {
      min: 0
    },
    grid: {
      borderColor: "#ececec"
    },
    colors: ['#31c4be']
  };
}
