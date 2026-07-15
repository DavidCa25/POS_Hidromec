import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import * as XLSX from 'xlsx';

interface FilaImport {
  fila: number;
  part_number: string;
  name: string;
  brand_name: string;
  category_name: string;
  price: number | null;
  stock: number | null;
  bar_code: string | null;
  clave_prod_serv: string | null;
  clave_unidad: string | null;
  valida: boolean;
  errores: string[];
  marcaNueva: boolean;
  categoriaNueva: boolean;
}

@Component({
  selector: 'app-importador-productos',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './importador-productos.component.html',
  styleUrls: ['./importador-productos.component.css']
})
export class ImportadorProductos implements OnInit {
  private get api() { return (window as any).electronAPI; }

  // Catalogos existentes (para validar y detectar altas)
  private marcasExist = new Set<string>();
  private categoriasExist = new Set<string>();
  private partNumbersExist = new Set<string>();
  private barCodesExist = new Set<string>();

  filas: FilaImport[] = [];
  nombreArchivo = '';
  cargando = false;
  importando = false;
  procesado = false;

  // Resumen para la vista previa
  get totalFilas(): number { return this.filas.length; }
  get validas(): number { return this.filas.filter(f => f.valida).length; }
  get conError(): number { return this.filas.filter(f => !f.valida).length; }
  get marcasNuevas(): string[] {
    return [...new Set(this.filas.filter(f => f.valida && f.marcaNueva).map(f => f.brand_name))];
  }
  get categoriasNuevas(): string[] {
    return [...new Set(this.filas.filter(f => f.valida && f.categoriaNueva).map(f => f.category_name))];
  }
  get filasError(): FilaImport[] { return this.filas.filter(f => !f.valida); }

  async ngOnInit() {
    await this.cargarCatalogos();
  }

  private norm(s: any): string {
    return String(s ?? '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .trim().toLowerCase();
  }

  private async cargarCatalogos() {
    try {
      const [brands, cats, prods] = await Promise.all([
        this.api?.getBrands?.() ?? [],
        this.api?.getCategories?.() ?? [],
        this.api?.getActiveProducts?.() ?? []
      ]);
      const rowsB = Array.isArray(brands?.recordset) ? brands.recordset : (Array.isArray(brands) ? brands : []);
      const rowsC = Array.isArray(cats?.recordset) ? cats.recordset : (Array.isArray(cats) ? cats : []);
      const rowsP = Array.isArray(prods?.recordset) ? prods.recordset : (Array.isArray(prods) ? prods : []);

      this.marcasExist = new Set(rowsB.map((b: any) => this.norm(b.namee ?? b.name ?? b.nombre)));
      this.categoriasExist = new Set(rowsC.map((c: any) => this.norm(c.namee ?? c.name ?? c.nombre)));
      this.partNumbersExist = new Set(rowsP.map((p: any) => this.norm(p.part_number ?? p.partNumber)));
      this.barCodesExist = new Set(
        rowsP.map((p: any) => this.norm(p.bar_code ?? p.barcode ?? p.barCode)).filter((x: string) => x)
      );
    } catch { /* sin catalogos: se valida solo dentro del archivo */ }
  }

  // ---------- Plantilla ----------
  descargarPlantilla() {
    const encabezados = [
      'No. Parte*', 'Nombre*', 'Marca', 'Categoria', 'Precio',
      'Existencia', 'Codigo de barras', 'Clave SAT ProdServ', 'Clave Unidad SAT'
    ];
    const ejemplo = [
      ['ACE-10W40', 'Aceite 10W40 1L', 'Bardahl', 'Lubricantes', 189.90, 24, '7501234567890', '15121500', 'LTR'],
      ['FIL-A1', 'Filtro de aceite A1', 'Mann', 'Filtros', 95.00, 12, '', '26111800', 'PZA']
    ];
    const ws = XLSX.utils.aoa_to_sheet([encabezados, ...ejemplo]);
    ws['!cols'] = encabezados.map(() => ({ wch: 20 }));

    const notas = XLSX.utils.aoa_to_sheet([
      ['Instrucciones'],
      ['No. Parte y Nombre son OBLIGATORIOS.'],
      ['Marca y Categoria: si no existen, se crean solas al importar.'],
      ['Si dejas Marca o Categoria vacias, se usan SIN MARCA / GENERAL.'],
      ['Precio y Existencia son opcionales (para catalogo por giro dejalos vacios).'],
      ['No repitas No. Parte ni Codigo de barras.'],
      ['Clave SAT ProdServ y Clave Unidad SAT son opcionales (facturacion).']
    ]);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Productos');
    XLSX.utils.book_append_sheet(wb, notas, 'Instrucciones');
    XLSX.writeFile(wb, 'plantilla_productos_wybix.xlsx');
  }

  // ---------- Lectura del archivo ----------
  async onFileSelected(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.nombreArchivo = file.name;
    this.cargando = true;
    this.procesado = false;
    this.filas = [];

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const hoja = wb.Sheets[wb.SheetNames[0]];
      const json: any[] = XLSX.utils.sheet_to_json(hoja, { defval: '', raw: true });

      if (!json.length) {
        await Swal.fire({ icon: 'warning', title: 'Archivo vacio', text: 'La primera hoja no tiene filas.' });
        return;
      }
      this.mapearYValidar(json);
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'No se pudo leer', text: e?.message || 'Archivo invalido.' });
    } finally {
      this.cargando = false;
      input.value = '';
    }
  }

  // Encuentra la clave real del objeto por variantes de encabezado
  private pick(row: any, claves: RegExp): any {
    const key = Object.keys(row).find(k => claves.test(this.norm(k)));
    return key != null ? row[key] : '';
  }

  private aNumero(v: any): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).replace(/,/g, '').trim());
    return isNaN(n) ? null : n;
  }

  private aTexto(v: any): string {
    return String(v ?? '').trim();
  }

  private mapearYValidar(json: any[]) {
    const pnEnArchivo = new Set<string>();
    const bcEnArchivo = new Set<string>();
    const filas: FilaImport[] = [];

    json.forEach((row, i) => {
      const part_number = this.aTexto(this.pick(row, /parte|part|sku/));
      const name = this.aTexto(this.pick(row, /nombre|descrip|producto|name/));
      const brand_name = this.aTexto(this.pick(row, /marca|brand/));
      const category_name = this.aTexto(this.pick(row, /categor/));
      const price = this.aNumero(this.pick(row, /precio|price/));
      const stock = this.aNumero(this.pick(row, /existencia|stock|cantidad/));
      const bar_code = this.aTexto(this.pick(row, /barra|barcode/)) || null;
      const clave_prod_serv = this.aTexto(this.pick(row, /prodserv|prod serv|clave sat/)) || null;
      const clave_unidad = this.aTexto(this.pick(row, /unidad/)) || null;

      const errores: string[] = [];
      if (!part_number) errores.push('Falta No. Parte');
      if (!name) errores.push('Falta Nombre');
      if (price != null && price < 0) errores.push('Precio negativo');
      if (stock != null && stock < 0) errores.push('Existencia negativa');

      const pnKey = this.norm(part_number);
      if (part_number) {
        if (pnEnArchivo.has(pnKey)) errores.push('No. Parte repetido en el archivo');
        else pnEnArchivo.add(pnKey);
        if (this.partNumbersExist.has(pnKey)) errores.push('No. Parte ya existe en el sistema');
      }
      const bcKey = this.norm(bar_code);
      if (bar_code) {
        if (bcEnArchivo.has(bcKey)) errores.push('Codigo de barras repetido en el archivo');
        else bcEnArchivo.add(bcKey);
        if (this.barCodesExist.has(bcKey)) errores.push('Codigo de barras ya existe en el sistema');
      }

      const marcaNueva = !!brand_name && !this.marcasExist.has(this.norm(brand_name));
      const categoriaNueva = !!category_name && !this.categoriasExist.has(this.norm(category_name));

      filas.push({
        fila: i + 2, // +1 encabezado, +1 base 1
        part_number, name, brand_name, category_name,
        price, stock, bar_code, clave_prod_serv, clave_unidad,
        valida: errores.length === 0,
        errores, marcaNueva, categoriaNueva
      });
    });

    this.filas = filas;
    this.procesado = true;
  }

  // ---------- Confirmar importacion ----------
  async confirmar() {
    const validas = this.filas.filter(f => f.valida);
    if (!validas.length) {
      await Swal.fire({ icon: 'info', title: 'Nada que importar', text: 'No hay filas validas.' });
      return;
    }

    const conf = await Swal.fire({
      icon: 'question',
      title: `Importar ${validas.length} productos`,
      html: `Se crearan <b>${this.marcasNuevas.length}</b> marcas y <b>${this.categoriasNuevas.length}</b> categorias nuevas.`,
      showCancelButton: true,
      confirmButtonText: 'Importar',
      cancelButtonText: 'Cancelar'
    });
    if (!conf.isConfirmed) return;

    this.importando = true;
    try {
      const rows = validas.map(f => ({
        part_number: f.part_number,
        name: f.name,
        brand_name: f.brand_name || null,
        category_name: f.category_name || null,
        price: f.price,
        stock: f.stock,
        bar_code: f.bar_code,
        clave_prod_serv: f.clave_prod_serv,
        clave_unidad: f.clave_unidad,
        objeto_impuesto: null,
        tasa_iva: null
      }));

      const res = await this.api?.importProducts?.({ rows });
      if (!res?.success) throw new Error(res?.error || 'No se pudo importar.');

      const d = res.data || {};
      await Swal.fire({
        icon: 'success',
        title: 'Importacion terminada',
        html: `Insertados: <b>${d.inserted ?? 0}</b><br>` +
              `Omitidos (duplicados): <b>${d.skipped ?? 0}</b><br>` +
              `Marcas creadas: <b>${d.brands_created ?? 0}</b><br>` +
              `Categorias creadas: <b>${d.categories_created ?? 0}</b>`
      });

      this.filas = [];
      this.nombreArchivo = '';
      this.procesado = false;
      await this.cargarCatalogos();
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error al importar', text: e?.message || 'Ocurrio un error.' });
    } finally {
      this.importando = false;
    }
  }

  limpiar() {
    this.filas = [];
    this.nombreArchivo = '';
    this.procesado = false;
  }
}
