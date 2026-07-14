import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { AuthService } from '../../services/auth.service';

interface Prov { id: number; nombre: string; telefono: string | null; correo: string | null; owed: number; open: number; }
interface OpenPurchase { purchase_id: number; datee: string; total: number; balance: number; payment_status: string; }
interface Payment { id: number; purchase_id: number; datee: string; amount: number; payment_method: string; note: string; }

@Component({
  selector: 'app-proveedores',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './proveedores.component.html',
  styleUrls: ['./proveedores.component.css']
})
export class Proveedores implements OnInit {
  private get api() { return (window as any).electronAPI; }
  constructor(private auth: AuthService) {}

  hoy = new Date();
  metodos = ['EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'CHEQUE'];

  proveedores: Prov[] = [];
  cargando = false;
  search = '';
  preset: 'todos' | 'con_deuda' = 'todos';

  // Modal de pago
  showModal = false;
  sel: Prov | null = null;
  openPurchases: OpenPurchase[] = [];
  payments: Payment[] = [];
  cargandoDetalle = false;
  selPurchase: OpenPurchase | null = null;
  monto: number | null = null;
  metodo = 'EFECTIVO';
  nota = '';
  pagando = false;

  get kpiTotal() { return this.proveedores.length; }
  get kpiConDeuda() { return this.proveedores.filter(p => p.owed > 0).length; }
  get kpiDeudaTotal() { return this.proveedores.reduce((s, p) => s + (p.owed || 0), 0); }
  get view(): Prov[] {
    const q = this.search.trim().toLowerCase();
    let arr = this.proveedores;
    if (q) arr = arr.filter(p => (p.nombre || '').toLowerCase().includes(q) || (p.telefono || '').includes(q));
    if (this.preset === 'con_deuda') arr = arr.filter(p => p.owed > 0);
    return arr;
  }

  async ngOnInit() { await this.cargar(); }

  money(n: number): string {
    return '$ ' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  async cargar() {
    this.cargando = true;
    try {
      const acc = await this.api?.getSuppliersAccount?.();
      const rows = acc?.success ? (acc.data || []) : [];
      this.proveedores = rows.map((r: any) => ({
        id: Number(r.supplier_id),
        nombre: r.nombre ?? '',
        telefono: r.telefono ?? null,
        correo: r.correo ?? null,
        owed: Number(r.owed ?? 0),
        open: Number(r.open_purchases ?? 0)
      }));
    } catch {
      this.proveedores = [];
    } finally {
      this.cargando = false;
    }
  }

  async abrir(p: Prov) {
    this.sel = p;
    this.showModal = true;
    this.openPurchases = [];
    this.payments = [];
    this.selPurchase = null;
    this.monto = null;
    this.metodo = 'EFECTIVO';
    this.nota = '';
    this.cargandoDetalle = true;
    try {
      const res = await this.api?.getSupplierAccountDetail?.({ supplier_id: p.id });
      if (res?.success) {
        this.openPurchases = res.data?.openPurchases ?? [];
        this.payments = res.data?.payments ?? [];
      }
    } catch { /* sin detalle */ }
    finally { this.cargandoDetalle = false; }
  }

  cerrar() { this.showModal = false; this.sel = null; }

  seleccionar(op: OpenPurchase) { this.selPurchase = op; this.monto = op.balance; }

  async confirmar() {
    if (!this.sel || !this.selPurchase) { await Swal.fire({ icon: 'info', title: 'Elige una compra', text: 'Selecciona la compra a pagar.' }); return; }
    const m = Number(this.monto || 0);
    if (!(m > 0)) { await Swal.fire({ icon: 'warning', title: 'Monto invalido' }); return; }
    if (m > this.selPurchase.balance) { await Swal.fire({ icon: 'warning', title: 'Monto alto', text: 'No puede ser mayor al saldo.' }); return; }

    this.pagando = true;
    try {
      const res = await this.api?.registerSupplierPayment?.({
        user_id: this.auth?.usuarioActualId ?? 0,
        supplier_id: this.sel.id,
        purchase_id: this.selPurchase.purchase_id,
        amount: m,
        payment_method: this.metodo,
        note: this.nota.trim() || null
      });
      if (!res?.success) throw new Error(res?.error || 'No se pudo registrar el pago.');
      await Swal.fire({ icon: 'success', title: 'Pago registrado', timer: 1100, showConfirmButton: false });
      const id = this.sel.id;
      await this.abrir(this.sel);
      await this.cargar();
      const upd = this.proveedores.find(p => p.id === id);
      if (upd) this.sel = upd;
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'Fallo el pago.' });
    } finally {
      this.pagando = false;
    }
  }
}
