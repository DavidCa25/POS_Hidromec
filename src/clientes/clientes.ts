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

type ClienteVenta = {
  id: number;
  datee: string;
  total: number;
  paid_amount: number;
  balance: number;
  due_date: string | null;
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

  // ------- Modal Nuevo/Editar -------
  showModal = false;
  editing: Cliente | null = null;
  form: Partial<Cliente> = {};

  // ------- Modal Abono -------
  showAbonoModal = false;
  abonoCliente: Cliente | null = null;
  ventasCliente: ClienteVenta[] = [];
  selectedSaleId: number | null = null;
  abonoAmount: number | null = null;
  abonoPaymentMethod: 'EFECTIVO' | 'TARJETA' | 'TRANSFERENCIA' = 'EFECTIVO';
  abonoNote: string = '';
  loadingVentas = false;
  savingAbono = false;

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

  // ===== ABONOS =====
  async abonar(c: Cliente) {
  this.abonoCliente = c;
  this.showAbonoModal = true;
  this.ventasCliente = [];
  this.selectedSaleId = null;
  this.abonoAmount = null;
  this.abonoPaymentMethod = 'EFECTIVO';
  this.abonoNote = '';

  await this.loadVentasCliente(c.id);

  if (!this.loadingVentas && this.ventasCliente.length === 0) {
    await Swal.fire({
      icon: 'info',
      title: 'Sin saldo pendiente',
      text: 'Este cliente no tiene ventas a crédito con saldo por cobrar.',
    });
    this.cerrarAbonoModal();
  }
}


  private async loadVentasCliente(customerId: number) {
    const api = (window as any).electronAPI;
    if (!api || !api.getCustomerOpenSales) {
      console.warn('getCustomerOpenSales no disponible');
      return;
    }

    try {
      this.loadingVentas = true;
      const resp = await api.getCustomerOpenSales(customerId);

      if (!resp?.success) {
        await Swal.fire({
          icon: 'error',
          title: 'Error al cargar ventas',
          text: resp?.error || 'No se pudieron obtener las ventas a crédito del cliente.',
        });
        return;
      }

      this.ventasCliente = (resp.data || []).map((r: any) => ({
        id: r.id,
        datee: r.datee,
        total: Number(r.total ?? 0),
        paid_amount: Number(r.paid_amount ?? 0),
        balance: Number(r.balance ?? 0),
        due_date: r.due_date
      }));

      if (this.ventasCliente.length > 0) {
        this.selectedSaleId = this.ventasCliente[0].id;
        this.abonoAmount = this.ventasCliente[0].balance;
      }

    } catch (e: any) {
      console.error('❌ loadVentasCliente:', e);
      await Swal.fire({
        icon: 'error',
        title: 'Error inesperado',
        text: e?.message || 'Ocurrió un error al cargar las ventas a crédito.',
      });
    } finally {
      this.loadingVentas = false;
    }
  }

  cerrarAbonoModal() {
    this.showAbonoModal = false;
    this.abonoCliente = null;
    this.ventasCliente = [];
    this.selectedSaleId = null;
    this.abonoAmount = null;
    this.abonoNote = '';
  }

  async confirmarAbono() {
    if (!this.abonoCliente) return;

    if (!this.selectedSaleId) {
      await Swal.fire({
        icon: 'error',
        title: 'Selecciona una venta',
        text: 'Debes elegir a qué venta aplicar el abono.',
      });
      return;
    }

    if (this.abonoAmount == null || this.abonoAmount <= 0) {
      await Swal.fire({
        icon: 'error',
        title: 'Monto inválido',
        text: 'El monto del abono debe ser mayor a 0.',
      });
      return;
    }

    const venta = this.ventasCliente.find(v => v.id === this.selectedSaleId);
    if (!venta) {
      await Swal.fire({
        icon: 'error',
        title: 'Venta no encontrada',
        text: 'No se encontró la venta seleccionada.',
      });
      return;
    }

    if (this.abonoAmount > venta.balance) {
      await Swal.fire({
        icon: 'error',
        title: 'Monto mayor al saldo',
        text: `El monto no puede ser mayor al saldo pendiente (${venta.balance.toFixed(2)}).`,
      });
      return;
    }

    const api = (window as any).electronAPI;
    if (!api || !api.registerCustomerPayment) {
      await Swal.fire({
        icon: 'error',
        title: 'No disponible',
        text: 'No se puede registrar el abono (Electron no disponible).',
      });
      return;
    }

    try {
      this.savingAbono = true;

      const userId = 1;

      const resp = await api.registerCustomerPayment(
        this.abonoCliente.id,
        this.selectedSaleId,
        this.abonoAmount,
        userId,
        this.abonoPaymentMethod,
        this.abonoNote || null
      );

      if (!resp?.success) {
        await Swal.fire({
          icon: 'error',
          title: 'Error al registrar abono',
          text: resp?.error || 'No se pudo registrar el abono.',
        });
        return;
      }

      await Swal.fire({
        icon: 'success',
        title: 'Abono registrado',
        text: 'El abono se aplicó correctamente.',
        timer: 1700,
        showConfirmButton: false,
        timerProgressBar: true
      });

      await this.loadClientes();
      this.cerrarAbonoModal();

    } catch (e: any) {
      console.error('❌ confirmarAbono:', e);
      await Swal.fire({
        icon: 'error',
        title: 'Error inesperado',
        text: e?.message || 'Ocurrió un error al registrar el abono.',
      });
    } finally {
      this.savingAbono = false;
    }
  }
}
