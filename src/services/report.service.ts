import { Injectable } from '@angular/core';
import * as XLSX from 'xlsx-js-style';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface ReportColumn {
  header: string;
  key: string;
  width?: number;                        
  align?: 'left' | 'right' | 'center';
  money?: boolean;                    
}

export interface ReportConfig {
  titulo: string;
  subtitulo?: string;
  columns: ReportColumn[];
  rows: any[];
  totals?: Record<string, number>;        
  meta?: string[];                       
  filename?: string;
}

@Injectable({ providedIn: 'root' })
export class ReportService {
  private get api() { return (window as any).electronAPI; }
  private readonly BRAND = '2563EB';
  private readonly BRAND_RGB: [number, number, number] = [37, 99, 235];
  private readonly BORDER = {
    top: { style: 'thin', color: { rgb: 'E5E7EB' } },
    bottom: { style: 'thin', color: { rgb: 'E5E7EB' } },
    left: { style: 'thin', color: { rgb: 'E5E7EB' } },
    right: { style: 'thin', color: { rgb: 'E5E7EB' } }
  };

  private async negocio(): Promise<string> {
    try {
      const cfg = await this.api?.getConfig?.();
      const c = cfg?.data ?? cfg ?? {};
      return c.business_name ?? c.businessName ?? c.nombre ?? c.name ?? 'Wybix POS';
    } catch { return 'Wybix POS'; }
  }
  private fmtMoney(n: any): string {
    return '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  private hoyStr(): string {
    return new Date().toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' });
  }
  private baseName(cfg: ReportConfig): string {
    const t = (cfg.filename || cfg.titulo || 'reporte')
      .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    return `${t}_${new Date().toISOString().slice(0, 10)}`;
  }

  // ================= EXCEL =================
  async exportExcel(cfg: ReportConfig) {
    const negocio = await this.negocio();
    const cols = cfg.columns;
    const ncol = cols.length;

    const aoa: any[][] = [];
    aoa.push([negocio]);
    aoa.push([cfg.titulo + (cfg.subtitulo ? '  —  ' + cfg.subtitulo : '')]);
    aoa.push(['Generado: ' + this.hoyStr()]);
    (cfg.meta || []).forEach(m => aoa.push([m]));
    aoa.push([]);
    const headerRow = aoa.length;
    aoa.push(cols.map(c => c.header));
    const dataStart = aoa.length;
    cfg.rows.forEach(row => aoa.push(cols.map(c => c.money ? Number(row[c.key] ?? 0) : (row[c.key] ?? ''))));
    let totalsRow = -1;
    if (cfg.totals) {
      totalsRow = aoa.length;
      aoa.push(cols.map((c, i) => i === 0 ? 'TOTAL'
        : (cfg.totals && (c.key in cfg.totals!) ? Number(cfg.totals![c.key]) : '')));
    }

    const ws: any = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = cols.map(c => ({ wch: c.width ?? Math.max(12, c.header.length + 3) }));
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: ncol - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: ncol - 1 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: ncol - 1 } }
    ];

    const set = (rr: number, cc: number, s: any) => {
      const ref = XLSX.utils.encode_cell({ r: rr, c: cc });
      if (ws[ref]) ws[ref].s = s;
    };

    set(0, 0, { font: { bold: true, sz: 16, color: { rgb: '0F172A' } } });
    set(1, 0, { font: { bold: true, sz: 12, color: { rgb: this.BRAND } } });
    set(2, 0, { font: { sz: 9, color: { rgb: '64748B' } } });

    cols.forEach((c, i) => set(headerRow, i, {
      font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
      fill: { fgColor: { rgb: this.BRAND } },
      alignment: { horizontal: c.align ?? 'left', vertical: 'center' },
      border: this.BORDER
    }));

    cfg.rows.forEach((_, ri) => {
      const rr = dataStart + ri;
      const zebra = ri % 2 === 1;
      cols.forEach((c, ci) => {
        const s: any = {
          alignment: { horizontal: c.align ?? (c.money ? 'right' : 'left') },
          border: this.BORDER
        };
        if (c.money) s.numFmt = '$#,##0.00';
        if (zebra) s.fill = { fgColor: { rgb: 'F8FAFC' } };
        set(rr, ci, s);
      });
    });

    if (totalsRow >= 0) cols.forEach((c, ci) => {
      const s: any = {
        font: { bold: true },
        alignment: { horizontal: c.align ?? (c.money ? 'right' : 'left') },
        border: { ...this.BORDER, top: { style: 'medium', color: { rgb: this.BRAND } } }
      };
      if (c.money) s.numFmt = '$#,##0.00';
      set(totalsRow, ci, s);
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Reporte');
    XLSX.writeFile(wb, this.baseName(cfg) + '.xlsx');
  }

  // ================= PDF =================
  async exportPdf(cfg: ReportConfig) {
    const negocio = await this.negocio();
    const cols = cfg.columns;
    const landscape = cols.length > 5;
    const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const M = 40;

    doc.setFillColor(this.BRAND_RGB[0], this.BRAND_RGB[1], this.BRAND_RGB[2]);
    doc.rect(0, 0, W, 8, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(15, 23, 42);
    doc.text(negocio, M, 42);
    doc.setFontSize(12); doc.setTextColor(this.BRAND_RGB[0], this.BRAND_RGB[1], this.BRAND_RGB[2]);
    doc.text(cfg.titulo + (cfg.subtitulo ? '   ·   ' + cfg.subtitulo : ''), M, 62);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(100, 116, 139);
    let y = 78;
    doc.text('Generado: ' + this.hoyStr(), M, y);
    (cfg.meta || []).forEach(m => { y += 12; doc.text(m, M, y); });

    const head = [cols.map(c => c.header)];
    const body = cfg.rows.map(row => cols.map(c => c.money ? this.fmtMoney(row[c.key]) : String(row[c.key] ?? '')));
    let foot: any;
    if (cfg.totals) {
      foot = [cols.map((c, i) => i === 0 ? 'TOTAL'
        : (cfg.totals && (c.key in cfg.totals!) ? this.fmtMoney(cfg.totals![c.key]) : ''))];
    }

    const columnStyles: any = {};
    cols.forEach((c, i) => columnStyles[i] = { halign: c.align ?? (c.money ? 'right' : 'left') });

    autoTable(doc, {
      head, body, foot,
      startY: y + 14,
      margin: { left: M, right: M },
      theme: 'striped',
      styles: { fontSize: 9, cellPadding: 6, lineColor: [230, 232, 236], lineWidth: 0.5 },
      headStyles: { fillColor: this.BRAND_RGB, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' },
      columnStyles
    });

    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFontSize(8); doc.setTextColor(150, 150, 150);
      doc.text(negocio, M, H - 18);
      doc.text(`Pagina ${i} de ${pages}`, W - M, H - 18, { align: 'right' });
    }

    doc.save(this.baseName(cfg) + '.pdf');
  }
}
