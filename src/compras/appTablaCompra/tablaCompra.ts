import { Component, OnInit, LOCALE_ID } from '@angular/core';
import { NgIf, NgFor, DatePipe, CurrencyPipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { WxSelectComponent, WxOpcion } from '../../app/wx-select/wx-select.component';
import { WxTablaBarraComponent } from '../../app/wx-tabla/wx-tabla-barra.component';
import { EstadoTabla, WxItem } from '../../app/wx-tabla/tabla-estado';

interface RawRow {
  purchase_id: number;
  datee?: string;
  date_iso?: string;
  user_name: string;
  total: number;
  tax_rate: number;
  tax_amount: number;
  balance?: number;
  payment_status?: string;
  supplier_name: string;

  purchase_detail_id: number;
  product_name: string;
  part_number?: string;
  quantity: number;
  unitary_price: number;
  subtotal: number;

  /** En que se compro y cuanto entro al inventario, en unidad base. */
  presentation_name?: string | null;
  factor_to_base?: number;
  base_quantity?: number;
  base_uom?: string;
}

interface PurchaseDetail {
  product_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  /** "4 Bolsa 400g -> 1600 g", cuando la compra no fue en unidad base. */
  conversion: string;
}

interface PurchaseRow {
  id: number;
  date: string;
  user_name: string;
  total: number;
  tax_rate: number;
  tax_amount: number;
  balance: number;
  paymentStatus: string;
  supplierLabel: string;
  /** Los distintos proveedores vistos en la compra. Normalmente, uno. */
  proveedores: Set<string>;
  details: PurchaseDetail[];
}

type PageToken = number | '...';

@Component({
  selector: 'app-tabla-compra',
  standalone: true,
  templateUrl: './tablaCompra.html',
  styleUrls: ['./tablaCompra.css'],
  imports: [WxTablaBarraComponent, NgIf, NgFor, DatePipe, CurrencyPipe, DecimalPipe, FormsModule, RouterLink, WxSelectComponent],
  providers: [{ provide: LOCALE_ID, useValue: 'es-MX' }]
})
export class TablaCompra implements OnInit {
  loading = false;
  /** Mismas opciones de siempre, en el formato del selector Wybix. */
  get opcionesPagina(): WxOpcion[] {
    return this.pageSizeOptions.map(n => ({ valor: n, etiqueta: String(n) }));
  }

  expanded = new Set<number>();

  compras: PurchaseRow[] = [];

  filterText = '';
  currentPage = 1;

  pageSizeOptions: number[] = [10, 25, 50, 100];
  pageSize = 10;

  /** Descriptor de la tabla. La logica vive en EstadoTabla, compartida. */
  readonly tabla = new EstadoTabla('compras', [
    { clave: 'id', titulo: 'ID', obligatoria: true },
    { clave: 'proveedor', titulo: 'Proveedor', filtrable: true, agrupable: true,
      valor: (c) => c.supplierLabel || 'Sin proveedor' },
    { clave: 'fecha', titulo: 'Fecha' },
    { clave: 'mes', titulo: 'Mes', ocultaPorDefecto: true, agrupable: true,
      valor: (c) => new Date(c.date).toLocaleDateString('es-MX', { year: 'numeric', month: 'long' }) },
    { clave: 'total', titulo: 'Total' },
    { clave: 'pago', titulo: 'Pago', filtrable: true, agrupable: true,
      valor: (c) => c.paymentStatus === 'PAGADO' ? 'Pagada'
                  : c.paymentStatus === 'PARCIAL' ? 'Parcial' : 'Por pagar' },
    { clave: 'usuario', titulo: 'Usuario', ocultaPorDefecto: true, filtrable: true, agrupable: true,
      valor: (c) => c.user_name || '—' },
    { clave: 'acciones', titulo: 'Acciones', obligatoria: true },
  ]);

  ngOnInit(){ this.cargarCompras(); }

  constructor(private router: Router) {}

  async cargarCompras(){
    this.loading = true;
    try{
      const res = await (window as any).electronAPI.getPurchases();
      const rows: RawRow[] = Array.isArray(res?.data)
        ? res.data
        : Array.isArray(res?.recordset)
          ? res.recordset
          : [];

      rows.forEach((r: any) => {
        r.purchase_id   = r.purchase_id ?? r.id ?? r.purchaseId;
        r.date_iso      = r.date_iso ?? r.datee ?? r.date;
        r.unitary_price = r.unitary_price ?? r.unit_price;
        r.subtotal      = r.subtotal ?? r.line_subtotal ?? (Number(r.quantity ?? 0) * Number(r.unitary_price ?? 0));
      });

      const map = new Map<number, PurchaseRow>();
      for(const r of rows){
        if(!r.purchase_id) continue;

        if(!map.has(r.purchase_id)){
          map.set(r.purchase_id, {
            id: r.purchase_id,
            date: r.date_iso ?? new Date().toISOString(),
            user_name: r.user_name,
            total: Number(r.total ?? 0),
            tax_rate: Number(r.tax_rate ?? 0),
            tax_amount: Number(r.tax_amount ?? 0),
            balance: Number(r.balance ?? 0),
            paymentStatus: (r.payment_status || 'PENDIENTE').toUpperCase(),
            supplierLabel: '',
            proveedores: new Set<string>(),
            details: []
          });
        }

        const grp = map.get(r.purchase_id)!;

        // El proveedor viene de la cabecera y es el mismo en todas las filas
        // de la compra. Las compras anteriores a "una compra, un proveedor"
        // pueden mezclarlos: por eso se juntan y se cuentan. Se lee ANTES de
        // descartar la fila sin partida: una compra vacia tambien lo tiene.
        if (r.supplier_name) grp.proveedores.add(r.supplier_name);

        // Con LEFT JOIN, una compra sin partidas trae una fila con el detalle
        // en blanco. Aparece en la lista, pero sin inventarle una partida.
        if (r.purchase_detail_id == null) continue;

        grp.details.push({
          product_name: r.product_name || '—',
          quantity: Number(r.quantity ?? 0),
          unit_price: Number(r.unitary_price ?? 0),
          line_total: Number(r.subtotal ?? 0),
          conversion: TablaCompra.conversion(r)
        });
      }

      this.compras = Array.from(map.values()).map(g => {
        const nombres = [...g.proveedores];
        g.supplierLabel = nombres.length === 0 ? '—'
                        : nombres.length === 1 ? nombres[0]
                        : `Múltiples (${nombres.length})`;
        return g;
      });

      this.currentPage = 1;
      this.expanded.clear();

    } catch(e){
      console.error('❌ getPurchases:', e);
      this.compras = [];
      this.currentPage = 1;
      this.expanded.clear();
    } finally {
      this.loading = false;
    }
  }

  get comprasFiltradas(): PurchaseRow[] {
    const f = (this.filterText || '').toLowerCase().trim();
    if(!f) return this.compras;

    return this.compras.filter(c => {
      const id = String(c.id);
      const prov = (c.supplierLabel || '').toLowerCase();
      const usr = (c.user_name || '').toLowerCase();
      return id.includes(f) || prov.includes(f) || usr.includes(f);
    });
  }

  /** Lo buscado, ya pasado por los filtros de la barra. */
  get comprasVisibles(): PurchaseRow[] { return this.tabla.filtrar(this.comprasFiltradas); }

  /** Filas y cabeceras de grupo en una sola lista: se pagina esto. */
  get itemsTabla(): WxItem[] { return this.tabla.aplanar(this.comprasVisibles); }

  get totalItems(): number {
    return this.itemsTabla.length;
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.totalItems / this.pageSize));
  }

  get pageFrom(): number {
    if (this.totalItems === 0) return 0;
    return (this.currentPage - 1) * this.pageSize + 1;
  }

  get pageTo(): number {
    return Math.min(this.totalItems, this.currentPage * this.pageSize);
  }

  get pagedCompras(): WxItem[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.itemsTabla.slice(start, start + this.pageSize);
  }

  onFilterChange() {
    this.currentPage = 1;
    this.expanded.clear();
  }

  setPageSize(v: any) {
    const n = Number(v);
    this.pageSize = Number.isFinite(n) && n > 0 ? n : 10;
    this.currentPage = 1;
    this.expanded.clear();
  }

  prevPage() {
    this.currentPage = Math.max(1, this.currentPage - 1);
    this.expanded.clear();
  }

  nextPage() {
    this.currentPage = Math.min(this.totalPages, this.currentPage + 1);
    this.expanded.clear();
  }

  goToPage(page: number) {
    const p = Math.max(1, Math.min(this.totalPages, Number(page)));
    this.currentPage = p;
    this.expanded.clear();
  }

  onPageTokenClick(token: PageToken) {
    if (token === '...') return;
    this.goToPage(token);
  }

  get pages(): PageToken[] {
    const total = this.totalPages;
    const cur = this.currentPage;
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

    const out: PageToken[] = [];
    out.push(1);

    const left = Math.max(2, cur - 1);
    const right = Math.min(total - 1, cur + 1);

    if (left > 2) out.push('...');

    for (let p = left; p <= right; p++) out.push(p);

    if (right < total - 1) out.push('...');

    out.push(total);
    return out;
  }

  /**
   * "Bolsa 400g -> 1600 g": en que se compro y cuanto entro al inventario.
   * Vacia cuando la compra fue en unidad base, que es el caso de Retail.
   */
  private static conversion(r: RawRow): string {
    const factor = Number(r.factor_to_base ?? 1);
    if (!(factor > 1)) return '';
    const base = Number(r.base_quantity ?? (Number(r.quantity ?? 0) * factor));
    const uom = r.base_uom || 'pza';
    return r.presentation_name ? `${r.presentation_name} -> ${base} ${uom}` : `${base} ${uom}`;
  }

  /** Etiqueta y color del estado de pago, para la columna nueva. */
  etiquetaPago(c: PurchaseRow): string {
    switch (c.paymentStatus) {
      case 'PAGADO':  return 'Pagada';
      case 'PARCIAL': return 'Parcial';
      default:        return 'Por pagar';
    }
  }

  clasePago(c: PurchaseRow): string {
    switch (c.paymentStatus) {
      case 'PAGADO':  return 'pago-chip pago-chip--ok';
      case 'PARCIAL': return 'pago-chip pago-chip--medio';
      default:        return 'pago-chip pago-chip--debe';
    }
  }

  trackByCompraId(_i: number, c: PurchaseRow) { return c.id; }

  toggle(id: number){
    if(this.expanded.has(id)) this.expanded.delete(id);
    else this.expanded.add(id);
  }
  isOpen(id: number){ return this.expanded.has(id); }

  // Actions
  editar(_c: PurchaseRow){ console.log('Editar', _c); }
  async eliminar(_c: PurchaseRow){ console.log('Eliminar', _c); }

  agregarCompra(){ this.router.navigate(['/dashboard/registrarCompra']); }
}
