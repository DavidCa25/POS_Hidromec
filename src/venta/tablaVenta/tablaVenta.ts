import { Component } from "@angular/core";
import Swal from "sweetalert2";
import { FormsModule } from "@angular/forms";
import { RouterOutlet } from "@angular/router";
import { NgIf, NgFor, DatePipe, CurrencyPipe, NgClass } from "@angular/common";

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

type PageToken = number | "...";

@Component({
  selector: "app-tabla-venta",
  templateUrl: "./tablaVenta.html",
  styleUrls: ["./tablaVenta.css"],
  standalone: true,
  imports: [NgIf, NgFor, NgClass, DatePipe, CurrencyPipe, FormsModule, RouterOutlet],
})
export class TablaVentaComponent {
  loading = false;
  sales: SaleRow[] = [];

  filterText = "";
  pageSizeOptions: number[] = [10, 25, 50, 100];
  pageSize = 10;
  currentPage = 1;

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

  trackBySaleId = (_: number, s: SaleRow) => s.id;

  private norm(v: any) {
    return String(v ?? "").toLowerCase().trim();
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

      this.currentPage = 1;
    } catch (e: any) {
      console.error(e);
      await Swal.fire("Error", e?.message || "No se pudieron cargar las ventas.", "error");
      this.sales = [];
      this.currentPage = 1;
    } finally {
      this.loading = false;
    }
  }
  onFilterChange() {
    this.currentPage = 1;
  }

  get filteredSales(): SaleRow[] {
    const q = this.norm(this.filterText);
    if (!q) return this.sales;

    return this.sales.filter(s => {
      const haystack = [
        s.id,
        s.datee,
        s.user_name,
        s.customer_name,
        s.payment_method,
        s.total,
        s.paid_amount,
        s.due_date
      ].map(this.norm).join(" | ");

      return haystack.includes(q);
    });
  }

  get totalItems() {
    return this.filteredSales.length;
  }

  get totalPages() {
    return Math.max(1, Math.ceil(this.totalItems / this.pageSize));
  }

  get pageFrom() {
    if (this.totalItems === 0) return 0;
    return (this.currentPage - 1) * this.pageSize + 1;
  }

  get pageTo() {
    if (this.totalItems === 0) return 0;
    return Math.min(this.currentPage * this.pageSize, this.totalItems);
  }

  get pagedSales(): SaleRow[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredSales.slice(start, start + this.pageSize);
  }

  setPageSize(size: number) {
    this.pageSize = Number(size) || 10;
    this.currentPage = 1;
  }

  goToPage(page: number) {
    const p = Math.max(1, Math.min(this.totalPages, Number(page) || 1));
    this.currentPage = p;
  }

  prevPage() {
    if (this.currentPage > 1) this.currentPage--;
  }

  nextPage() {
    if (this.currentPage < this.totalPages) this.currentPage++;
  }

  get pages(): PageToken[] {
    const total = this.totalPages;
    const current = this.currentPage;

    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }

    const out: PageToken[] = [];
    const left = Math.max(2, current - 1);
    const right = Math.min(total - 1, current + 1);

    out.push(1);

    if (left > 2) out.push("...");

    for (let p = left; p <= right; p++) out.push(p);

    if (right < total - 1) out.push("...");

    out.push(total);
    return out;
  }

  onPageTokenClick(p: PageToken) {
    if (p === "...") return;
    this.goToPage(p);
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
      didOpen: () => Swal.showLoading(),
    });

    try {
      const resp = await api.exportSalesPdf({ start_date, end_date });
      if (!resp?.success) throw new Error(resp?.error || "No se pudo exportar");

      Swal.close();
      await Swal.fire("Listo", `Reporte generado y abierto.`, "success");
    } catch (e: any) {
      console.error(e);
      Swal.close();
      await Swal.fire("Error", e?.message || "Error al exportar PDFs.", "error");
    }
  }
}
