import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';

interface Prov { id: number; nombre: string; telefono: string | null; correo: string | null; rfc: string | null; total_paid: number; }
interface Payment { id: number; purchase_id: number | null; datee: string; amount: number; payment_method: string; note: string; }

@Component({
  selector: 'app-proveedores',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './proveedores.component.html',
  styleUrls: ['./proveedores.component.css']
})
export class Proveedores implements OnInit {
  private get api() { return (window as any).electronAPI; }

  hoy = new Date();
  proveedores: Prov[] = [];
  cargando = false;
  search = '';

  // Alta / edicion
  showForm = false;
  guardando = false;
  form = { id: 0, nombre: '', telefono: '', correo: '', rfc: '' };

  // Historial de pagos
  showHist = false;
  sel: Prov | null = null;
  payments: Payment[] = [];
  cargandoHist = false;

  get kpiTotal() { return this.proveedores.length; }
  get kpiTotalPagado() { return this.proveedores.reduce((s, p) => s + (p.total_paid || 0), 0); }
  get view(): Prov[] {
    const q = this.search.trim().toLowerCase();
    if (!q) return this.proveedores;
    return this.proveedores.filter(p =>
      (p.nombre || '').toLowerCase().includes(q) ||
      (p.telefono || '').includes(q) ||
      (p.rfc || '').toLowerCase().includes(q));
  }

  money(n: number): string {
    return '$ ' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  async ngOnInit() { await this.cargar(); }

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
        rfc: r.rfc ?? null,
        total_paid: Number(r.total_paid ?? 0)
      }));
    } catch {
      this.proveedores = [];
    } finally {
      this.cargando = false;
    }
  }

  nuevo() { this.form = { id: 0, nombre: '', telefono: '', correo: '', rfc: '' }; this.showForm = true; }
  editar(p: Prov) { this.form = { id: p.id, nombre: p.nombre, telefono: p.telefono || '', correo: p.correo || '', rfc: p.rfc || '' }; this.showForm = true; }
  cerrarForm() { this.showForm = false; }

  async guardar() {
    if (!this.form.nombre.trim()) { await Swal.fire({ icon: 'warning', title: 'Falta el nombre' }); return; }
    this.guardando = true;
    try {
      const res = await this.api?.supplierSave?.({
        id: this.form.id || null,
        nombre: this.form.nombre.trim(),
        telefono: this.form.telefono.trim() || null,
        correo: this.form.correo.trim() || null,
        rfc: this.form.rfc.trim().toUpperCase() || null
      });
      if (!res?.success) throw new Error(res?.error || 'No se pudo guardar.');
      this.showForm = false;
      await Swal.fire({ icon: 'success', title: this.form.id ? 'Proveedor actualizado' : 'Proveedor agregado', timer: 1100, showConfirmButton: false });
      await this.cargar();
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'Fallo al guardar.' });
    } finally {
      this.guardando = false;
    }
  }

  async verHistorial(p: Prov) {
    this.sel = p; this.showHist = true; this.payments = []; this.cargandoHist = true;
    try {
      const res = await this.api?.getSupplierAccountDetail?.({ supplier_id: p.id });
      if (res?.success) this.payments = res.data?.payments ?? [];
    } catch { /* sin historial */ }
    finally { this.cargandoHist = false; }
  }
  cerrarHist() { this.showHist = false; this.sel = null; }
}
