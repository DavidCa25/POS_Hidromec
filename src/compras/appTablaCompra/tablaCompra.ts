import { Component, OnInit, LOCALE_ID } from '@angular/core';
import { NgIf, NgFor, DatePipe, CurrencyPipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

interface RawRow {
  purchase_id: number;
  datee?: string;
  date_iso?: string;
  user_name: string;
  total: number;
  tax_rate: number;
  tax_amount: number;

  purchase_detail_id: number;
  product_name: string;
  quantity: number;
  unitary_price: number;
  subtotal: number;
  supplier_name: string;
}

interface PurchaseDetail {
  product_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  supplier_name: string;
}

interface PurchaseRow {
  id: number;
  date: string;
  user_name: string;
  total: number;
  tax_rate: number;
  tax_amount: number;
  supplierLabel: string;
  details: PurchaseDetail[];
}

type PageToken = number | '...';

@Component({
  selector: 'app-tabla-compra',
  standalone: true,
  templateUrl: './tablaCompra.html',
  styleUrls: ['./tablaCompra.css'],
  imports: [NgIf, NgFor, DatePipe, CurrencyPipe, DecimalPipe, FormsModule, RouterLink],
  providers: [{ provide: LOCALE_ID, useValue: 'es-MX' }]
})
export class TablaCompra implements OnInit {
  loading = false;
  expanded = new Set<number>();

  compras: PurchaseRow[] = [];

  filterText = '';
  currentPage = 1;

  pageSizeOptions: number[] = [10, 25, 50, 100];
  pageSize = 10;

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
            supplierLabel: '',
            details: []
          });
        }

        const grp = map.get(r.purchase_id)!;
        grp.details.push({
          product_name: r.product_name,
          quantity: Number(r.quantity ?? 0),
          unit_price: Number(r.unitary_price ?? 0),
          line_total: Number(r.subtotal ?? 0),
          supplier_name: r.supplier_name
        });
      }

      this.compras = Array.from(map.values()).map(g => {
        const uniq = Array.from(new Set(g.details.map(d => d.supplier_name).filter(Boolean)));
        g.supplierLabel = uniq.length <= 1 ? (uniq[0] || '—') : `Múltiples (${uniq.length})`;
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

  get totalItems(): number {
    return this.comprasFiltradas.length;
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

  get pagedCompras(): PurchaseRow[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.comprasFiltradas.slice(start, start + this.pageSize);
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
