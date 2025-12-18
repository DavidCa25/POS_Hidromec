import { Component } from "@angular/core";
import Swal from "sweetalert2";
import { FormsModule } from '@angular/forms';
import { Router, RouterOutlet } from '@angular/router';
import { NgIf, NgFor, DatePipe, CurrencyPipe } from "@angular/common";

interface SaleRow {
  id: number;
  datee: string;
  user_name?: string;
  customer_name?: string;
  payment_method: string;
  total: number;
  paid_amount: number;
  due_date?: string;
}

@Component({
  selector: "app-tabla-venta",
  templateUrl: "./tablaVenta.html",
  styleUrls: ["./tablaVenta.css"],
  imports: [NgIf, NgFor, DatePipe, CurrencyPipe, FormsModule, RouterOutlet],
})
export class TablaVentaComponent {
  today = new Date();

  loading = false;
  sales: SaleRow[] = [];

  showExportModal = false;
  exportMode: "DIA" | "RANGO" = "DIA";
  exportDay: string | null = null;
  exportFrom: string | null = null;
  exportTo: string | null = null;

  async ngOnInit() {
    await this.loadSales();
  }

  private money(n: any): number {
    const x = Number(n);
    return Number.isFinite(x) ? x : 0;
  }

  calcCambio(s: SaleRow): number {
    const total = this.money(s.total);
    const paid = this.money(s.paid_amount);
    const c = paid - total;
    return c > 0 ? c : 0;
  }

  async loadSales(start_date: string | null = null, end_date: string | null = null) {
    const api = (window as any).electronAPI;
    if (!api?.getSales) {
      await Swal.fire("No disponible", "electronAPI.getSales no existe.", "error");
      return;
    }

    try {
      this.loading = true;
      const resp = await api.getSales({ start_date, end_date });
      if (!resp?.success) throw new Error(resp?.error || "Error al cargar ventas");
      this.sales = resp.data ?? [];
    } catch (e: any) {
      console.error(e);
      await Swal.fire("Error", e?.message || "No se pudieron cargar las ventas.", "error");
      this.sales = [];
    } finally {
      this.loading = false;
    }
  }

  async verPdfVenta(saleId: number) {
    const api = (window as any).electronAPI;
    if (!api?.generateSalePdf) {
      await Swal.fire("No disponible", "electronAPI.generateSalePdf no existe.", "error");
      return;
    }

    try {
      const resp = await api.generateSalePdf(saleId);
      if (!resp?.success) throw new Error(resp?.error || "No se pudo generar PDF");
      await Swal.fire("Listo", "PDF generado/abierto correctamente.", "success");
    } catch (e: any) {
      console.error(e);
      await Swal.fire("Error", e?.message || "Error al generar PDF.", "error");
    }
  }

  abrirExportModal() {
    this.exportMode = "DIA";
    this.exportDay = null;
    this.exportFrom = null;
    this.exportTo = null;
    this.showExportModal = true;
  }

  cerrarExportModal() {
    this.showExportModal = false;
  }

  async exportarPdfs() {
    const api = (window as any).electronAPI;
    if (!api?.exportSalesPdf) {
      await Swal.fire("No disponible", "electronAPI.exportSalesPdf no existe.", "error");
      return;
    }

    let start_date: string | null = null;
    let end_date: string | null = null;

    if (this.exportMode === "DIA") {
      if (!this.exportDay) {
        await Swal.fire("Falta fecha", "Selecciona el día.", "warning");
        return;
      }
      start_date = this.exportDay;
      end_date = this.exportDay;
    } else {
      if (!this.exportFrom || !this.exportTo) {
        await Swal.fire("Faltan fechas", "Selecciona desde y hasta.", "warning");
        return;
      }
      start_date = this.exportFrom;
      end_date = this.exportTo;
    }
    
    this.showExportModal = false;

    Swal.fire({
      title: "Generando PDF…",
      html: "Por favor espera. Al terminar se abrirá automáticamente.",
      allowOutsideClick: false,
      allowEscapeKey: false,
      didOpen: () => {
        Swal.showLoading();
      },
    });

    try {
      const resp = await api.exportSalesPdf({ start_date, end_date });

      if (!resp?.success) throw new Error(resp?.error || "No se pudo exportar");

      Swal.update({
        title: "Abriendo PDF…",
        html: "Un momento…",
      });

      Swal.close();

      this.showExportModal = false;
      await Swal.fire("Listo", `Reporte generado y abierto.`, "success");
    } catch (e: any) {
      console.error(e);
      Swal.close();
      await Swal.fire("Error", e?.message || "Error al exportar PDFs.", "error");
    }
  }
  
}
