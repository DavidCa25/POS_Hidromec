import { Injectable } from '@angular/core';

/*
 * xlsx-js-style y jsPDF pesan ~600 kB juntos y solo hacen falta al pulsar
 * "Exportar". Se importan dentro del metodo que los usa, asi que viven en su
 * propio chunk y ninguna pantalla los paga por el simple hecho de inyectar
 * este servicio.
 */

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

  private static readonly MARCA_POR_DEFECTO = 'Wybix';

  /**
   * Nombre del negocio para encabezado, pie y nombre de archivo.
   *
   * Se lee de la configuracion real (la que edita Configuracion > Negocio).
   * Antes usaba `??`, que no cubre la cadena vacia: un negocio con el campo en
   * blanco producia una cabecera vacia en vez de caer al valor por defecto.
   * Ahora se descarta cualquier valor que quede vacio al recortarlo.
   */
  private async negocio(): Promise<string> {
    try {
      const cfg = await this.api?.getConfig?.();
      const c = cfg?.data ?? cfg ?? {};
      for (const v of [c.business_name, c.businessName, c.nombre, c.name]) {
        const t = String(v ?? '').trim();
        if (t) return t;
      }
    } catch { /* sin configuracion accesible */ }
    return ReportService.MARCA_POR_DEFECTO;
  }

  /** Texto a fragmento seguro para nombre de archivo. */
  private aSlug(t: string): string {
    return t.toLowerCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
  }
  private fmtMoney(n: any): string {
    return '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  private hoyStr(): string {
    return new Date().toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' });
  }
  private baseName(cfg: ReportConfig, negocio?: string): string {
    const t = this.aSlug(cfg.filename || cfg.titulo || 'reporte');
    const n = negocio ? this.aSlug(negocio) : '';
    const fecha = new Date().toISOString().slice(0, 10);
    // El negocio va delante: al juntar exportaciones de varias sucursales en
    // una carpeta, el archivo dice de quien es sin abrirlo.
    return [n, t, fecha].filter(Boolean).join('_');
  }

  /**
   * Saca la funcion de un modulo CommonJS importado dinamicamente.
   *
   * QUE SE ROMPIO
   * -------------
   * `const { default: autoTable } = await import('jspdf-autotable')` asume UNA
   * forma de interoperabilidad. `jspdf-autotable` es un bundle UMD de webpack,
   * y segun como lo procese el empaquetador el resultado puede llegar como la
   * funcion suelta, como `{ default: fn }` o como `{ default: { default: fn } }`.
   * En la aplicacion empaquetada llegaba envuelto una vez de mas: `autoTable`
   * era un objeto y llamarlo reventaba con "g is not a function" -el nombre
   * minificado de la variable-. En `ng serve` no pasaba, y por eso el defecto
   * solo se veia en el instalador.
   *
   * Esto no adivina: prueba las formas posibles y falla con un mensaje que se
   * puede leer si ninguna sirve.
   */
  private static callable(mod: any, nombre: string): any {
    const candidatos = [mod, mod?.default, mod?.default?.default];
    const fn = candidatos.find(c => typeof c === 'function');
    if (!fn) throw new Error(`No se pudo cargar ${nombre}: el modulo no expone una funcion.`);
    return fn;
  }

  /** Igual, para un valor exportado con nombre (jsPDF). */
  private static named(mod: any, nombre: string): any {
    const candidatos = [mod?.[nombre], mod?.default?.[nombre], mod?.default, mod];
    const fn = candidatos.find(c => typeof c === 'function');
    if (!fn) throw new Error(`No se pudo cargar ${nombre}.`);
    return fn;
  }

  /**
   * Entrega el archivo al usuario.
   *
   * QUE SE ROMPIO
   * -------------
   * `doc.save()` y `XLSX.writeFile()` crean un Blob y disparan un
   * `<a download>`. Eso es del navegador: la aplicacion empaquetada sirve la
   * pagina por `file://`, donde esa descarga no llega a ninguna parte. El
   * usuario pulsaba Exportar y no ocurria nada visible -sin error, sin
   * archivo-, que es exactamente lo que se reporto en "Exportar lista".
   *
   * Con Electron delante se pide donde guardar y se escribe el archivo de
   * verdad. Fuera de Electron -o si el canal no existiera- se conserva la
   * descarga del navegador, para no perder un camino que ya funcionaba.
   */
  private async entregar(bytes: ArrayBuffer | Uint8Array, nombre: string, ext: string,
                         etiqueta: string, respaldo: () => void): Promise<void> {
    const guardar = this.api?.guardarArchivo;
    if (typeof guardar !== 'function') { respaldo(); return; }

    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let binario = '';
    // En trozos: `String.fromCharCode(...u8)` desborda la pila con archivos
    // grandes, y un reporte de inventario completo lo es.
    for (let i = 0; i < u8.length; i += 0x8000) {
      binario += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + 0x8000)) as any);
    }

    const r = await guardar({
      suggestedName: nombre,
      extension: ext,
      base64: btoa(binario),
      title: `Guardar ${etiqueta}`,
      filters: [{ name: etiqueta, extensions: [ext] }],
    });
    if (r && r.success === false) throw new Error(r.error || 'No se pudo guardar el archivo.');
  }

  // ================= EXCEL =================
  async exportExcel(cfg: ReportConfig) {
    const mod: any = await import('xlsx-js-style');
    // Mismo problema de interoperabilidad que autoTable: segun el
    // empaquetador, `utils` puede colgar del modulo o de su `default`.
    const XLSX: any = mod?.utils ? mod : (mod?.default?.utils ? mod.default : mod);
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

    const nombre = this.baseName(cfg, negocio);
    const bytes: Uint8Array = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    await this.entregar(bytes, nombre, 'xlsx', 'Hoja de calculo',
                        () => XLSX.writeFile(wb, nombre + '.xlsx'));
  }

  // ================= PDF =================
  async exportPdf(cfg: ReportConfig) {
    const [modPdf, modTabla] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]);
    const jsPDF = ReportService.named(modPdf, 'jsPDF');
    const autoTable = ReportService.callable(modTabla, 'jspdf-autotable');
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

    const nombre = this.baseName(cfg, negocio);
    await this.entregar(doc.output('arraybuffer'), nombre, 'pdf', 'Documento PDF',
                        () => doc.save(nombre + '.pdf'));
  }
}
