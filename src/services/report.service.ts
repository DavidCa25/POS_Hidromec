import { Injectable } from '@angular/core';
import { fechaDeSql, hoyLocal, zonaDeSql } from '../core';

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
  /** Porcentaje 0-100 (margen, participación): "12.3%" y numérico en Excel. */
  pct?: boolean;
  /** Cantidad: numérica en Excel, alineada a la derecha. */
  num?: boolean;
}

/** Una tabla de un reporte de varias partes (estado de resultados, corte...). */
export interface ReportSeccion {
  titulo: string;
  nota?: string;
  columns: ReportColumn[];
  /** Una fila con `__total: true` sale en negritas (subtotales). */
  rows: any[];
  totals?: Partial<Record<string, number>>;
}

export interface ReportConfig {
  titulo: string;
  subtitulo?: string;
  /* Reporte de UNA tabla: columns + rows (+ totals). */
  columns: ReportColumn[];
  rows: any[];
  totals?: Record<string, number>;
  meta?: string[];
  filename?: string;
  /**
   * Reporte de VARIAS tablas. Si viene, sustituye a columns/rows: en Excel
   * cada sección es una hoja; en PDF van una tras otra con su título.
   */
  secciones?: ReportSeccion[];
}

/**
 * Fecha (y hora) de SQL Server para un reporte.
 *
 * `mssql` lee un DATETIME —hora de pared, sin zona— como si fuera UTC: las
 * 09:35 de la caja llegan como 09:35Z. Formatearlo en la zona del equipo lo
 * corre seis horas (sale 03:35). Aquí se lee en UTC, que es devolverle su
 * hora de pared. Un texto sin zona ("2026-10-18T09:35:00") se trata igual.
 */
export function fechaSql(v: any, conHora = true): string {
  const d = fechaDeSql(v);
  if (!d) return '';
  const timeZone = zonaDeSql(v);
  return conHora
    ? d.toLocaleString('es-MX', { timeZone, dateStyle: 'short', timeStyle: 'short' })
    : d.toLocaleDateString('es-MX', { timeZone });
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
    const v = Number(n || 0);
    // El signo va antes del simbolo: -$113.60, no $-113.60.
    return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  /**
   * La fuente estandar de jsPDF solo trae WinAnsi: el signo menos tipografico
   * (U+2212) o una flecha salen como basura y desordenan el renglon. En el PDF
   * se cambian por su equivalente ASCII; Excel los conserva.
   */
  private pdfTxt(t: any): string {
    return String(t ?? '').replace(/−/g, '-').replace(/→/g, '->').replace(/…/g, '...');
  }
  private hoyStr(): string {
    return new Date().toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' });
  }
  private baseName(cfg: ReportConfig, negocio?: string): string {
    const t = this.aSlug(cfg.filename || cfg.titulo || 'reporte');
    const n = negocio ? this.aSlug(negocio) : '';
    const fecha = hoyLocal();
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

  /** Las tablas del reporte: las secciones, o la tabla única de siempre. */
  private secciones(cfg: ReportConfig): ReportSeccion[] {
    const s = (cfg.secciones || []).filter(x => x.columns?.length);
    return s.length ? s : [{ titulo: '', columns: cfg.columns, rows: cfg.rows, totals: cfg.totals }];
  }
  private numerica(c: ReportColumn) { return !!(c.money || c.pct || c.num); }
  /** Lo que se escribe en el PDF para un valor de esa columna. */
  private texto(c: ReportColumn, v: any): string {
    const vacio = v === '' || v == null;
    if (c.money) return vacio ? '' : this.fmtMoney(v);
    if (c.pct) return vacio || !Number.isFinite(Number(v)) ? '—' : `${Number(v).toFixed(1)}%`;
    if (c.num) return vacio ? '' : Number(v).toLocaleString('es-MX', { maximumFractionDigits: 2 });
    return this.pdfTxt(v);
  }
  /** Nombre de hoja válido para Excel: 31 caracteres, sin []:*?/\ y sin repetirse. */
  private nombreHoja(t: string, usados: Set<string>): string {
    const base = (t || 'Reporte').replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Reporte';
    let n = base, i = 2;
    while (usados.has(n.toLowerCase())) n = `${base.slice(0, 28)} ${i++}`;
    usados.add(n.toLowerCase());
    return n;
  }

  // ================= EXCEL =================
  async exportExcel(cfg: ReportConfig) {
    const mod: any = await import('xlsx-js-style');
    // Mismo problema de interoperabilidad que autoTable: segun el
    // empaquetador, `utils` puede colgar del modulo o de su `default`.
    const XLSX: any = mod?.utils ? mod : (mod?.default?.utils ? mod.default : mod);
    const negocio = await this.negocio();
    const wb = XLSX.utils.book_new();
    const usados = new Set<string>();

    // Una hoja por seccion. Todas repiten el encabezado: una hoja suelta
    // (copiada a otro libro, impresa) sigue diciendo de quien y de cuando es.
    this.secciones(cfg).forEach((sec, si) => {
      const cols = sec.columns;
      const ncol = Math.max(cols.length, 1);
      const aoa: any[][] = [];
      aoa.push([negocio]);
      aoa.push([cfg.titulo + (cfg.subtitulo ? '  —  ' + cfg.subtitulo : '')]);
      aoa.push(['Generado: ' + this.hoyStr()]);
      const metaDesde = aoa.length;
      if (si === 0) (cfg.meta || []).forEach(m => aoa.push([m]));
      const metaHasta = aoa.length;
      let tituloRow = -1, notaRow = -1;
      if (sec.titulo) { aoa.push([]); tituloRow = aoa.length; aoa.push([sec.titulo]); }
      if (sec.nota) { notaRow = aoa.length; aoa.push([sec.nota]); }
      aoa.push([]);
      const headerRow = aoa.length;
      aoa.push(cols.map(c => c.header));
      const dataStart = aoa.length;
      sec.rows.forEach(row => aoa.push(cols.map(c => {
        const v = row[c.key];
        if (this.numerica(c)) return v === '' || v == null || !Number.isFinite(Number(v)) ? '' : Number(v);
        return v ?? '';
      })));
      let totalsRow = -1;
      if (sec.totals) {
        totalsRow = aoa.length;
        aoa.push(cols.map((c, i) => i === 0 ? 'TOTAL'
          : (sec.totals && (c.key in sec.totals!) ? Number(sec.totals![c.key] ?? 0) : '')));
      }

      const ws: any = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = cols.map(c => ({ wch: c.width ?? Math.max(12, c.header.length + 3) }));
      const unir = (r: number) => ({ s: { r, c: 0 }, e: { r, c: ncol - 1 } });
      ws['!merges'] = [unir(0), unir(1), unir(2)];
      for (let r = metaDesde; r < metaHasta; r++) ws['!merges'].push(unir(r));
      if (tituloRow >= 0) ws['!merges'].push(unir(tituloRow));
      if (notaRow >= 0) ws['!merges'].push(unir(notaRow));

      const set = (rr: number, cc: number, st: any) => {
        const ref = XLSX.utils.encode_cell({ r: rr, c: cc });
        if (ws[ref]) ws[ref].s = st;
      };
      // Cantidades en formato General: '#,##0.##' deja un punto colgando en los enteros ("1.").
      const formato = (c: ReportColumn) => c.money ? '$#,##0.00' : c.pct ? '0.0"%"' : undefined;
      const alinear = (c: ReportColumn) => c.align ?? (this.numerica(c) ? 'right' : 'left');

      set(0, 0, { font: { bold: true, sz: 16, color: { rgb: '0F172A' } } });
      set(1, 0, { font: { bold: true, sz: 12, color: { rgb: this.BRAND } } });
      set(2, 0, { font: { sz: 9, color: { rgb: '64748B' } } });
      for (let r = metaDesde; r < metaHasta; r++) set(r, 0, { font: { sz: 9, color: { rgb: '64748B' } } });
      if (tituloRow >= 0) set(tituloRow, 0, { font: { bold: true, sz: 12, color: { rgb: '0F172A' } } });
      if (notaRow >= 0) set(notaRow, 0, { font: { italic: true, sz: 9, color: { rgb: '64748B' } } });

      cols.forEach((c, i) => set(headerRow, i, {
        font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
        fill: { fgColor: { rgb: this.BRAND } },
        alignment: { horizontal: alinear(c), vertical: 'center' },
        border: this.BORDER
      }));

      sec.rows.forEach((row, ri) => {
        const rr = dataStart + ri;
        cols.forEach((c, ci) => {
          const st: any = { alignment: { horizontal: alinear(c) }, border: this.BORDER };
          const f = formato(c); if (f) st.numFmt = f;
          if (row?.__total) { st.font = { bold: true }; st.fill = { fgColor: { rgb: 'EEF2F7' } }; }
          else if (ri % 2 === 1) st.fill = { fgColor: { rgb: 'F8FAFC' } };
          set(rr, ci, st);
        });
      });

      if (totalsRow >= 0) cols.forEach((c, ci) => {
        const st: any = {
          font: { bold: true },
          alignment: { horizontal: alinear(c) },
          border: { ...this.BORDER, top: { style: 'medium', color: { rgb: this.BRAND } } }
        };
        const f = formato(c); if (f) st.numFmt = f;
        set(totalsRow, ci, st);
      });

      XLSX.utils.book_append_sheet(wb, ws, this.nombreHoja(sec.titulo || cfg.titulo, usados));
    });

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
    const secciones = this.secciones(cfg);
    const landscape = secciones.some(sec => sec.columns.length > 5);
    const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const M = 40;

    doc.setFillColor(this.BRAND_RGB[0], this.BRAND_RGB[1], this.BRAND_RGB[2]);
    doc.rect(0, 0, W, 8, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(15, 23, 42);
    doc.text(negocio, M, 42);
    doc.setFontSize(12); doc.setTextColor(this.BRAND_RGB[0], this.BRAND_RGB[1], this.BRAND_RGB[2]);
    doc.text(this.pdfTxt(cfg.titulo + (cfg.subtitulo ? '   ·   ' + cfg.subtitulo : '')), M, 62);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(100, 116, 139);
    let y = 78;
    doc.text('Generado: ' + this.hoyStr(), M, y);
    (cfg.meta || []).forEach(m => {
      for (const linea of doc.splitTextToSize(this.pdfTxt(m), W - 2 * M)) { y += 12; doc.text(linea, M, y); }
    });
    y += 14;

    for (const sec of secciones) {
      const cols = sec.columns;
      if (sec.titulo || sec.nota) {
        // Un titulo no se queda solo al pie de la pagina.
        if (y > H - 110) { doc.addPage(); y = 50; }
        if (sec.titulo) {
          y += 10;
          doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(15, 23, 42);
          doc.text(this.pdfTxt(sec.titulo), M, y);
        }
        if (sec.nota) {
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(100, 116, 139);
          for (const linea of doc.splitTextToSize(this.pdfTxt(sec.nota), W - 2 * M)) { y += 11; doc.text(linea, M, y); }
        }
        y += 8;
      }
      const head = [cols.map(c => this.pdfTxt(c.header))];
      const body = sec.rows.map(row => cols.map(c => this.texto(c, row[c.key])));
      const foot = sec.totals ? [cols.map((c, i) => i === 0 ? 'TOTAL'
        : (sec.totals && (c.key in sec.totals!) ? this.texto(c, sec.totals![c.key]) : ''))] : undefined;
      const columnStyles: any = {};
      cols.forEach((c, i) => columnStyles[i] = { halign: c.align ?? (this.numerica(c) ? 'right' : 'left') });
      const negritas = new Set(sec.rows.map((r, i) => (r?.__total ? i : -1)).filter(i => i >= 0));

      autoTable(doc, {
        head, body, foot,
        startY: y,
        margin: { left: M, right: M },
        theme: 'striped',
        styles: { fontSize: 9, cellPadding: 6, lineColor: [230, 232, 236], lineWidth: 0.5 },
        headStyles: { fillColor: this.BRAND_RGB, textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' },
        columnStyles,
        didParseCell: (d: any) => {
          if (d.section === 'body' && negritas.has(d.row.index)) {
            d.cell.styles.fontStyle = 'bold';
            d.cell.styles.fillColor = [238, 242, 247];
          }
        },
      });
      y = ((doc as any).lastAutoTable?.finalY ?? y) + 18;
    }

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
