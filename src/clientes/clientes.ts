import { Component, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import Swal from 'sweetalert2';

type Cliente = {
  id: number;
  code?: string;
  name: string;
  phone?: string;
  email?: string;
  creditLimit: number;
  termsDays: number;
  balance: number;
  overdueCount: number;
  active: boolean;
};

@Component({
  selector: 'app-clientes',
  templateUrl: './clientes.html',
  imports: [
    RouterOutlet,
    FormsModule,
    CommonModule,
    DatePipe,
    DecimalPipe
  ],
  styleUrls: ['./clientes.css']
})
export class Clientes implements OnInit {

  clientes: Cliente[] = [];
  loading = false;
  error: string | undefined = undefined;

  // ------- Filtros / presets -------
  search = '';
  estado: 'todos' | 'activos' | 'inactivos' = 'todos';
  preset: 'todos' | 'con_saldo' | 'vencidos' = 'todos';

  // ------- Modal -------
  showModal = false;
  editing: Cliente | null = null;
  form: Partial<Cliente> = {};

  hoy = new Date();

  async ngOnInit() {
    await this.loadClientes();
  }

  // ===== CARGA DESDE BD =====
  private async loadClientes() {
    const api = (window as any).electronAPI;
    if (!api || !api.getCustomers) {
      console.warn('Electron API no disponible. ¿Estás corriendo con ng serve?');
      this.error = 'No hay conexión con Electron/DB.';
      return;
    }

    try {
      this.loading = true;
      this.error = undefined;

      const res = await api.getCustomers();

      if (!res?.success) {
        this.error = res?.error || 'Error al cargar clientes.';
        await Swal.fire({
          icon: 'error',
          title: 'Error',
          text: this.error || 'Error al cargar clientes.',
        });
        return;
      }

      this.clientes = (res.data || []).map((row: any) => ({
        id: row.id,
        code: row.code,
        name: row.customerName,
        phone: row.phone,
        email: row.email,
        creditLimit: Number(row.credit_limit ?? 0),
        termsDays: Number(row.terms_days ?? 0),
        // De momento estos son “demo” hasta que tengas SP de saldos
        balance: Number(row.balance ?? 0),
        overdueCount: Number(row.overdueCount ?? 0),
        active: !!row.active,
      }));
    } catch (e: any) {
      console.error(e);
      this.error = e?.message || 'Error desconocido al cargar clientes.';
      await Swal.fire({
        icon: 'error',
        title: 'Error inesperado',
        text: this.error || 'Error desconocido al cargar clientes.',
      });
    } finally {
      this.loading = false;
    }
  }

  // ----- KPIs -----
  get kpiTotal()      { return this.clientes.length; }
  get kpiConSaldo()   { return this.clientes.filter(c => c.balance > 0).length; }
  get kpiVencidos()   { return this.clientes.filter(c => c.overdueCount > 0).length; }
  get kpiSaldoTotal() { return this.clientes.reduce((s,c)=> s + (c.balance>0?c.balance:0), 0); }
  get activosCount()  { return this.clientes.filter(c => c.active).length; }

  // ----- Vista filtrada -----
  get clientesView(): Cliente[] {
    let rows = [...this.clientes];

    const q = this.search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(c =>
        c.name.toLowerCase().includes(q) ||
        (c.phone ?? '').toLowerCase().includes(q) ||
        (c.email ?? '').toLowerCase().includes(q)
      );
    }

    if (this.estado === 'activos')   rows = rows.filter(c => c.active);
    if (this.estado === 'inactivos') rows = rows.filter(c => !c.active);

    if (this.preset === 'con_saldo') rows = rows.filter(c => c.balance > 0);
    if (this.preset === 'vencidos')  rows = rows.filter(c => c.overdueCount > 0);

    rows.sort((a,b) => (b.overdueCount - a.overdueCount) || (b.balance - a.balance));
    return rows;
  }

  // ----- Helpers -----
  badgeEstado(c: Cliente): { text: string; cls: string } {
    if (c.overdueCount > 0) return { text: 'Vencido', cls: 'badge tarjeta' };
    if (c.balance > 0)      return { text: 'Con saldo', cls: 'badge transfer' };
    return { text: 'Al corriente', cls: 'badge efectivo' };
  }

  // ----- UI Actions -----
  setPreset(p: 'todos'|'con_saldo'|'vencidos') { this.preset = p; }

  nuevo() {
    this.editing = null;
    this.form = {
      creditLimit: 0,
      termsDays: 0,
      balance: 0,
      overdueCount: 0,
      active: true
    };
    this.showModal = true;
  }

  editar(c: Cliente) {
    this.editing = c;
    this.form = { ...c };
    this.showModal = true;
  }

  async guardar() {
    if (!this.form.name) {
      await Swal.fire({
        icon: 'error',
        title: 'Falta información',
        text: 'El nombre del cliente es obligatorio.',
      });
      return;
    }

    const api = (window as any).electronAPI;
    if (!api || (!api.createCustomer && !api.updateCustomer)) {
      await Swal.fire({
        icon: 'error',
        title: 'Modo demo',
        text: 'No hay conexión con Electron/DB (¿quizá estás en ng serve?).',
      });
      return;
    }

    try {
      if (this.editing) {
        // ===== UPDATE =====
        const res = await api.updateCustomer(
          this.editing.id,
          this.form.code ?? '',
          this.form.name!,
          this.form.email ?? '',
          this.form.phone ?? '',
          this.form.creditLimit ?? 0,
          this.form.termsDays ?? 0,
          this.form.active ?? true
        );

        if (!res?.success) {
          await Swal.fire({
            icon: 'error',
            title: 'Error al actualizar',
            text: res?.error || 'No se pudo actualizar el cliente.',
          });
          return;
        }

        Object.assign(this.editing, this.form);

        await Swal.fire({
          icon: 'success',
          title: 'Cliente actualizado',
          text: 'Los cambios se guardaron correctamente.',
          timer: 1800,
          showConfirmButton: false,
          timerProgressBar: true
        });

      } else {
        // ===== CREATE =====
        const res = await api.createCustomer(
          this.form.code ?? null,
          this.form.name!,
          this.form.email ?? '',
          this.form.phone ?? '',
          this.form.creditLimit ?? 0,
          this.form.termsDays ?? 0,
          this.form.active ?? true
        );

        if (!res?.success) {
          await Swal.fire({
            icon: 'error',
            title: 'Error al guardar',
            text: res?.error || 'No se pudo crear el cliente.',
          });
          return;
        }

        const id = res.id;

        this.clientes.unshift({
          id,
          code: this.form.code ?? '',
          name: this.form.name!,
          phone: this.form.phone ?? '',
          email: this.form.email ?? '',
          creditLimit: this.form.creditLimit ?? 0,
          termsDays: this.form.termsDays ?? 0,
          balance: this.form.balance ?? 0,
          overdueCount: this.form.overdueCount ?? 0,
          active: this.form.active ?? true
        });

        await Swal.fire({
          icon: 'success',
          title: 'Cliente agregado',
          text: 'Se guardó correctamente.',
          timer: 1800,
          showConfirmButton: false,
          timerProgressBar: true
        });
      }

      this.cerrarModal();

    } catch (e: any) {
      console.error(e);
      await Swal.fire({
        icon: 'error',
        title: 'Error inesperado',
        text: e?.message || 'Ocurrió un error inesperado.',
      });
    }
  }

  cerrarModal() { this.showModal = false; }

  abonar(c: Cliente) {
    const pago = 100; // demo
    c.balance = Math.max(0, c.balance - pago);
    if (c.balance === 0) c.overdueCount = 0;
  }
}
