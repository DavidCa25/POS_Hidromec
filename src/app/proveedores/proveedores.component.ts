import { Component, OnInit } from '@angular/core';
import { WxTablaBarraComponent } from '../wx-tabla/wx-tabla-barra.component';
import { EstadoTabla, WxItem } from '../wx-tabla/tabla-estado';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { ReportService, ReportConfig } from '../../services/report.service';

interface Prov {
  id: number; nombre: string; telefono: string | null; correo: string | null; rfc: string | null;
  total_paid: number;
  /** Lo comprado y lo que se debe. El saldo sale de `purchase.balance`, la
      MISMA fuente que la columna Pago de la Tabla de compras: restar
      comprado - pagado inventaria deudas que nadie registro. */
  total_comprado: number;
  saldo_pendiente: number;
  compras_pendientes: number;
}
interface Payment { id: number; purchase_id: number | null; datee: string; amount: number; payment_method: string; note: string; }

@Component({
  selector: 'app-proveedores',
  standalone: true,
  imports: [WxTablaBarraComponent, CommonModule, FormsModule],
  templateUrl: './proveedores.component.html',
  styleUrls: ['./proveedores.component.css']
})
export class Proveedores implements OnInit {
  private get api() { return (window as any).electronAPI; }

  constructor(private reports: ReportService) {}

  hoy = new Date();
  proveedores: Prov[] = [];
  cargando = false;
  search = '';
  expOpen = false;

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
  get kpiTotalComprado() { return this.proveedores.reduce((s, p) => s + (p.total_comprado || 0), 0); }
  get kpiSaldo() { return this.proveedores.reduce((s, p) => s + (p.saldo_pendiente || 0), 0); }
  get kpiConDeuda() { return this.proveedores.filter(p => (p.saldo_pendiente || 0) > 0).length; }
  /**
   * Descriptor de la tabla. Proveedores usa `tabla-corte`, no
   * `castrol-table`: la barra funciona igual porque solo comparte el ESTADO,
   * no el marcado. No hace falta reescribir la tabla para unificarla.
   */
  readonly tabla = new EstadoTabla('proveedores', [
    { clave: 'nombre', titulo: 'Proveedor', obligatoria: true },
    { clave: 'contacto', titulo: 'Contacto' },
    { clave: 'rfc', titulo: 'RFC', ocultaPorDefecto: true },
    { clave: 'total_comprado', titulo: 'Comprado' },
    { clave: 'total_paid', titulo: 'Pagado' },
    { clave: 'saldo_pendiente', titulo: 'Por pagar' },
    { clave: 'estado', titulo: 'Estado', ocultaPorDefecto: true, filtrable: true, agrupable: true,
      valor: (p) => (p.saldo_pendiente || 0) > 0 ? 'Con saldo' : 'Al corriente' },
    { clave: 'acciones', titulo: 'Acciones', obligatoria: true },
  ]);

  /** Lo buscado, ya filtrado por la barra, y aplanado con sus grupos. */
  get items(): WxItem[] { return this.tabla.aplanar(this.tabla.filtrar(this.view)); }

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
        total_paid: Number(r.total_paid ?? 0),
        total_comprado: Number(r.total_comprado ?? 0),
        saldo_pendiente: Number(r.saldo_pendiente ?? 0),
        compras_pendientes: Number(r.compras_pendientes ?? 0)
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

  private cfgReporte(): ReportConfig {
    return {
      titulo: 'Proveedores',
      subtitulo: 'Directorio y pagos',
      columns: [
        { header: 'Proveedor', key: 'nombre', width: 30 },
        { header: 'Telefono', key: 'telefono', width: 16 },
        { header: 'Correo', key: 'correo', width: 28 },
        { header: 'RFC', key: 'rfc', width: 16 },
        { header: 'Total comprado', key: 'total_comprado', width: 16, align: 'right', money: true },
        { header: 'Total pagado', key: 'total_paid', width: 16, align: 'right', money: true },
        { header: 'Saldo', key: 'saldo_pendiente', width: 16, align: 'right', money: true }
      ],
      rows: this.view.map(p => ({
        nombre: p.nombre, telefono: p.telefono || '-', correo: p.correo || '-',
        rfc: p.rfc || '-', total_comprado: p.total_comprado,
        total_paid: p.total_paid, saldo_pendiente: p.saldo_pendiente
      })),
      totals: { total_comprado: this.kpiTotalComprado, total_paid: this.kpiTotalPagado, saldo_pendiente: this.kpiSaldo },
      filename: 'proveedores'
    };
  }

  async exportar(tipo: 'pdf' | 'excel') {
    this.expOpen = false;
    const cfg = this.cfgReporte();
    try {
      if (tipo === 'excel') await this.reports.exportExcel(cfg);
      else await this.reports.exportPdf(cfg);
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error al exportar', text: e?.message || 'No se pudo generar el archivo.' });
    }
  }
}
