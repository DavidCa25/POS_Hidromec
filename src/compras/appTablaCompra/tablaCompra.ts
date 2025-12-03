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

@Component({
  selector: 'app-tabla-compra',
  standalone: true,
  templateUrl: './tablaCompra.html',
  styleUrls: ['./tablaCompra.css'],
  imports: [NgIf, NgFor, DatePipe, CurrencyPipe, DecimalPipe, FormsModule, RouterLink],
  providers: [{ provide: LOCALE_ID, useValue: 'es-MX' }]
})
export class TablaCompra implements OnInit {
  filtro = '';
  compras: PurchaseRow[] = [];
  loading = false;

  expanded = new Set<number>();

  constructor(private router: Router) {}

  ngOnInit(){ this.cargarCompras(); }

  async cargarCompras(){
    this.loading = true;
    try{
      const res = await (window as any).electronAPI.getPurchases();
      const rows: RawRow[] = Array.isArray(res?.data) ? res.data : Array.isArray(res?.recordset) ? res.recordset : [];

      // Normaliza los datos
      rows.forEach((r: any) => {
        r.purchase_id   = r.purchase_id ?? r.id ?? r.purchaseId;
        r.date_iso      = r.date_iso ?? r.datee ?? r.date;
        r.unitary_price = r.unitary_price ?? r.unit_price;
        r.subtotal      = r.subtotal ?? r.line_subtotal ?? (r.quantity * (r.unitary_price ?? 0));
      });

      // Agrupa por purchase_id
      const map = new Map<number, PurchaseRow>();
      for(const r of rows){
        if(!r.purchase_id) continue;

        if(!map.has(r.purchase_id)){
          map.set(r.purchase_id, {
            id: r.purchase_id,
            date: r.date_iso ?? new Date().toISOString(),
            user_name: r.user_name,
            total: r.total,
            tax_rate: r.tax_rate,
            tax_amount: r.tax_amount,
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

      // Etiqueta de proveedores únicos
      this.compras = Array.from(map.values()).map(g => {
        const uniq = Array.from(new Set(g.details.map(d => d.supplier_name).filter(Boolean)));
        g.supplierLabel = uniq.length <= 1 ? (uniq[0] || '—') : `Múltiples (${uniq.length})`;
        return g;
      });

    }catch(e){
      console.error('❌ sp_get_purchases:', e);
      this.compras = [];
    }finally{
      this.loading = false;
    }
  }

  get comprasFiltradas(): PurchaseRow[] {
    const f = (this.filtro || '').toLowerCase().trim();
    if(!f) return this.compras;
    return this.compras.filter(c =>
      (c.supplierLabel || '').toLowerCase().includes(f) ||
      (c.user_name || '').toLowerCase().includes(f) ||
      String(c.id).includes(f)
    );
  }

  toggle(id: number){
    if(this.expanded.has(id)) this.expanded.delete(id);
    else this.expanded.add(id);
  }

  isOpen(id: number){ return this.expanded.has(id); }

  editar(_c: PurchaseRow){ console.log('Editar', _c); }
  async eliminar(_c: PurchaseRow){ console.log('Eliminar', _c); }

  agregarCompra(){ this.router.navigate(['/dashboard/registrarCompra']); }
}
