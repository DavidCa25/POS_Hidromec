import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import * as XLSX from 'xlsx';
import { ImportadorProductos } from '../importador-productos/importador-productos.component';
import { AuthService } from '../../services/auth.service';

type Tab = 'productos' | 'clientes' | 'proveedores' | 'ventas';

interface Prev {
  fila: number;
  valida: boolean;
  errores: string[];
  data: any;
}

@Component({
  selector: 'app-migracion',
  standalone: true,
  imports: [CommonModule, FormsModule, ImportadorProductos],
  templateUrl: './migracion.component.html',
  styleUrls: ['./migracion.component.css']
})
export class Migracion implements OnInit {
  tab: Tab = 'productos';

  private get api() { return (window as any).electronAPI; }
  constructor(private auth: AuthService) {}

  // Para cruzar ventas contra productos existentes
  private partNumbers = new Set<string>();

  async ngOnInit() { await this.cargarPartNumbers(); }

  private async cargarPartNumbers() {
    try {
      const prods = await this.api?.getActiveProducts?.();
      const rows = Array.isArray(prods?.recordset) ? prods.recordset : (Array.isArray(prods) ? prods : []);
      this.partNumbers = new Set(rows.map((p: any) => this.norm(p.part_number ?? p.partNumber)).filter((x: string) => x));
    } catch { /* sin productos aun */ }
  }

  cambiarTab(t: Tab) { this.tab = t; }

  // ---------- Helpers compartidos ----------
  private norm(s: any): string {
    return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  }
  private aTxt(v: any): string { return String(v ?? '').trim(); }
  private aNum(v: any): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).replace(/,/g, '').trim());
    return isNaN(n) ? null : n;
  }
  private pick(row: any, re: RegExp): any {
    const key = Object.keys(row).find(k => re.test(this.norm(k)));
    return key != null ? row[key] : '';
  }
  private async leerHoja(file: File, cellDates = false): Promise<any[]> {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates });
    const hoja = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(hoja, { defval: '', raw: true });
  }
  private plantilla(archivo: string, headers: string[], ejemplos: any[][], notas: string[]) {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...ejemplos]);
    ws['!cols'] = headers.map(() => ({ wch: 18 }));
    const hojaNotas = XLSX.utils.aoa_to_sheet([['Instrucciones'], ...notas.map(n => [n])]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Datos');
    XLSX.utils.book_append_sheet(wb, hojaNotas, 'Instrucciones');
    XLSX.writeFile(wb, archivo);
  }
  private parseFecha(v: any): Date | null {
    if (v instanceof Date && !isNaN(v.getTime())) return v;
    const s = this.aTxt(v);
    if (!s) return null;
    // dd/mm/yyyy o dd-mm-yyyy
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m) {
      const yy = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      const d = new Date(yy, Number(m[2]) - 1, Number(m[1]));
      return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  // =====================================================
  //  CLIENTES
  // =====================================================
  cliArchivo = ''; cliFilas: Prev[] = []; cliListo = false; cliCargando = false; cliImportando = false;
  get cliValidas() { return this.cliFilas.filter(f => f.valida).length; }
  get cliError() { return this.cliFilas.filter(f => !f.valida).length; }

  plantillaClientes() {
    this.plantilla('plantilla_clientes_wybix.xlsx',
      ['Codigo', 'Nombre*', 'Telefono', 'RFC', 'Email', 'Limite credito', 'Dias credito', 'Saldo inicial'],
      [['C001', 'Juan Perez', '4771234567', 'PEPJ800101ABC', 'juan@correo.com', 5000, 30, 0]],
      ['Nombre es OBLIGATORIO.', 'Codigo es opcional (si se repite se omite).',
       'Limite y dias de credito son opcionales (para clientes con credito).',
       'Saldo inicial: lo que el cliente ya te debe hoy (opcional).']);
  }

  async onClientes(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0]; if (!file) return;
    this.cliArchivo = file.name; this.cliCargando = true; this.cliListo = false; this.cliFilas = [];
    try {
      const json = await this.leerHoja(file);
      const vistos = new Set<string>();
      this.cliFilas = json.map((row, i) => {
        const name = this.aTxt(this.pick(row, /nombre|name|cliente/));
        const code = this.aTxt(this.pick(row, /codigo|code|clave/));
        const data = {
          code: code || null,
          name,
          phone: this.aTxt(this.pick(row, /telefono|tel|phone|celular/)) || null,
          tax_id: this.aTxt(this.pick(row, /rfc|tax/)) || null,
          email: this.aTxt(this.pick(row, /email|correo/)) || null,
          credit_limit: this.aNum(this.pick(row, /limite|credito|credit/)) ?? 0,
          terms_days: this.aNum(this.pick(row, /dias|plazo|terms/)) ?? 0,
          balance: this.aNum(this.pick(row, /saldo|balance|adeudo|debe/)) ?? 0
        };
        const errores: string[] = [];
        if (!name) errores.push('Falta Nombre');
        const nk = this.norm(name);
        if (name) { if (vistos.has(nk)) errores.push('Nombre repetido en el archivo'); else vistos.add(nk); }
        return { fila: i + 2, valida: errores.length === 0, errores, data };
      });
      this.cliListo = true;
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'No se pudo leer', text: e?.message || 'Archivo invalido.' });
    } finally { this.cliCargando = false; input.value = ''; }
  }

  async importarClientes() {
    const rows = this.cliFilas.filter(f => f.valida).map(f => f.data);
    if (!rows.length) { await Swal.fire({ icon: 'info', title: 'Nada que importar' }); return; }
    this.cliImportando = true;
    try {
      const res = await this.api?.importCustomers?.({ rows });
      if (!res?.success) throw new Error(res?.error || 'No se pudo importar.');
      const d = res.data || {};
      await Swal.fire({ icon: 'success', title: 'Clientes importados',
        html: `Nuevos: <b>${d.inserted ?? 0}</b><br>Omitidos: <b>${d.skipped ?? 0}</b><br>Errores: <b>${d.errors ?? 0}</b>` });
      this.cliFilas = []; this.cliArchivo = ''; this.cliListo = false;
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'Fallo la importacion.' });
    } finally { this.cliImportando = false; }
  }

  // =====================================================
  //  PROVEEDORES  (el esquema actual solo guarda el nombre)
  // =====================================================
  provArchivo = ''; provFilas: Prev[] = []; provListo = false; provCargando = false; provImportando = false;
  get provValidas() { return this.provFilas.filter(f => f.valida).length; }
  get provError() { return this.provFilas.filter(f => !f.valida).length; }

  plantillaProveedores() {
    this.plantilla('plantilla_proveedores_wybix.xlsx',
      ['Nombre*', 'Telefono', 'Correo', 'RFC'],
      [['Distribuidora del Bajio', '4771112233', 'ventas@distribuidora.com', 'DBA010101ABC'],
       ['Refacciones ABC', '', '', '']],
      ['Nombre es OBLIGATORIO.', 'Telefono, Correo y RFC son opcionales.',
       'Si el nombre ya existe se omite.']);
  }

  async onProveedores(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0]; if (!file) return;
    this.provArchivo = file.name; this.provCargando = true; this.provListo = false; this.provFilas = [];
    try {
      const json = await this.leerHoja(file);
      const vistos = new Set<string>();
      this.provFilas = json.map((row, i) => {
        const name = this.aTxt(this.pick(row, /nombre|name|proveedor|razon/));
        const errores: string[] = [];
        if (!name) errores.push('Falta Nombre');
        const nk = this.norm(name);
        if (name) { if (vistos.has(nk)) errores.push('Nombre repetido en el archivo'); else vistos.add(nk); }
        const telefono = this.aTxt(this.pick(row, /telefono|tel|phone|celular/)) || null;
        const correo = this.aTxt(this.pick(row, /correo|email|mail/)) || null;
        const rfc = this.aTxt(this.pick(row, /rfc|tax/)) || null;
        return { fila: i + 2, valida: errores.length === 0, errores, data: { name, telefono, correo, rfc } };
      });
      this.provListo = true;
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'No se pudo leer', text: e?.message || 'Archivo invalido.' });
    } finally { this.provCargando = false; input.value = ''; }
  }

  async importarProveedores() {
    const rows = this.provFilas.filter(f => f.valida).map(f => f.data);
    if (!rows.length) { await Swal.fire({ icon: 'info', title: 'Nada que importar' }); return; }
    this.provImportando = true;
    try {
      const res = await this.api?.importSuppliers?.({ rows });
      if (!res?.success) throw new Error(res?.error || 'No se pudo importar.');
      const d = res.data || {};
      await Swal.fire({ icon: 'success', title: 'Proveedores importados',
        html: `Nuevos: <b>${d.inserted ?? 0}</b><br>Omitidos: <b>${d.skipped ?? 0}</b><br>Errores: <b>${d.errors ?? 0}</b>` });
      this.provFilas = []; this.provArchivo = ''; this.provListo = false;
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'Fallo la importacion.' });
    } finally { this.provImportando = false; }
  }

  // =====================================================
  //  VENTAS (historicas, una fila por partida)
  // =====================================================
  venArchivo = ''; venFilas: Prev[] = []; venListo = false; venCargando = false; venImportando = false;
  get venValidas() { return this.venFilas.filter(f => f.valida).length; }
  get venError() { return this.venFilas.filter(f => !f.valida).length; }
  get venFolios() { return new Set(this.venFilas.filter(f => f.valida).map(f => f.data.ext_folio)).size; }
  get venSinProducto() { return this.venFilas.filter(f => f.errores.includes('Producto no encontrado')).length; }
  get venErrores() { return this.venFilas.filter(f => !f.valida); }

  plantillaVentas() {
    this.plantilla('plantilla_ventas_wybix.xlsx',
      ['Folio*', 'Fecha*', 'No. Parte*', 'Cantidad*', 'Precio', 'Metodo pago'],
      [['1001', '2025-01-03', 'ACE-10W40', 2, 189.90, 'EFECTIVO'],
       ['1001', '2025-01-03', 'FIL-A1', 1, 95.00, 'EFECTIVO']],
      ['Una fila por PRODUCTO vendido. Se agrupan por Folio para armar cada venta.',
       'El No. Parte debe existir ya en tus productos (importalos primero).',
       'Fecha: formato AAAA-MM-DD o DD/MM/AAAA.',
       'Son ventas HISTORICAS: no mueven inventario ni caja.',
       'Los folios ya migrados no se vuelven a importar.']);
  }

  async onVentas(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0]; if (!file) return;
    this.venArchivo = file.name; this.venCargando = true; this.venListo = false; this.venFilas = [];
    try {
      const json = await this.leerHoja(file, true);
      this.venFilas = json.map((row, i) => {
        const ext_folio = this.aTxt(this.pick(row, /folio|ticket|venta/));
        const part_number = this.aTxt(this.pick(row, /parte|part|sku|codigo|clave/));
        const fecha = this.parseFecha(this.pick(row, /fecha|date/));
        const quantity = this.aNum(this.pick(row, /cantidad|cant|qty/));
        const unit_price = this.aNum(this.pick(row, /precio|price|importe/));
        const payment_method = this.aTxt(this.pick(row, /metodo|pago|forma/)) || null;

        const errores: string[] = [];
        if (!ext_folio) errores.push('Falta Folio');
        if (!fecha) errores.push('Fecha invalida');
        if (!part_number) errores.push('Falta No. Parte');
        else if (!this.partNumbers.has(this.norm(part_number))) errores.push('Producto no encontrado');
        if (quantity == null || quantity <= 0) errores.push('Cantidad invalida');

        const data = {
          ext_folio,
          sale_date: fecha ? fecha.toISOString() : null,
          part_number,
          quantity,
          unit_price: unit_price ?? 0,
          payment_method
        };
        return { fila: i + 2, valida: errores.length === 0, errores, data };
      });
      this.venListo = true;
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'No se pudo leer', text: e?.message || 'Archivo invalido.' });
    } finally { this.venCargando = false; input.value = ''; }
  }

  async importarVentas() {
    const userId = this.auth?.usuarioActualId ?? 0;
    if (!userId) { await Swal.fire({ icon: 'warning', title: 'Inicia sesion', text: 'Necesitas estar dentro para asignar las ventas.' }); return; }
    const rows = this.venFilas.filter(f => f.valida).map(f => f.data);
    if (!rows.length) { await Swal.fire({ icon: 'info', title: 'Nada que importar' }); return; }

    const conf = await Swal.fire({
      icon: 'question', title: `Importar ${this.venFolios} ventas`,
      html: `Con <b>${this.venValidas}</b> partidas. Son historicas: no mueven inventario ni caja.`,
      showCancelButton: true, confirmButtonText: 'Importar', cancelButtonText: 'Cancelar'
    });
    if (!conf.isConfirmed) return;

    this.venImportando = true;
    try {
      const res = await this.api?.importSales?.({ rows, user_id: userId });
      if (!res?.success) throw new Error(res?.error || 'No se pudo importar.');
      const d = res.data || {};
      await Swal.fire({ icon: 'success', title: 'Ventas importadas',
        html: `Ventas creadas: <b>${d.sales_created ?? 0}</b><br>Partidas: <b>${d.details_created ?? 0}</b><br>` +
              `Sin producto: <b>${d.unmatched_lines ?? 0}</b><br>Folios ya migrados (omitidos): <b>${d.folios_omitidos ?? 0}</b>` });
      this.venFilas = []; this.venArchivo = ''; this.venListo = false;
      await this.cargarPartNumbers();
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'Fallo la importacion.' });
    } finally { this.venImportando = false; }
  }
}
