import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';

type Cliente = {
  id: number;
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
    CommonModule,                      // ngIf, ngFor, ngClass y pipes básicos
    DatePipe,                          // (opcional, con CommonModule basta)
    DecimalPipe                        // (opcional)
  ],
  styleUrls: ['./clientes.css']
})
export class Clientes {
  // ------- Mock de datos -------
  clientes: Cliente[] = [
    { id: 1, name: 'María López', phone: '477-111-2233', email: 'maria@mail.com', creditLimit: 3000, termsDays: 15, balance: 0,    overdueCount: 0, active: true },
    { id: 2, name: 'Carlos Pérez', phone: '477-222-3344', email: 'carlos@mail.com', creditLimit: 5000, termsDays: 30, balance: 950, overdueCount: 0, active: true },
    { id: 3, name: 'Doña Chuy Tiendita', phone: '477-333-4455', email: 'chuy@mail.com', creditLimit: 8000, termsDays: 30, balance: 2200, overdueCount: 2, active: true },
    { id: 4, name: 'Ana Torres', phone: '477-555-6677', email: 'ana@mail.com', creditLimit: 2000, termsDays: 7,  balance: 0,    overdueCount: 0, active: false },
  ];

  get activosCount() {
    return this.clientes.filter(c => c.active).length;
  }

  // ------- Filtros / presets -------
  search = '';
  estado: 'todos' | 'activos' | 'inactivos' = 'todos';
  preset: 'todos' | 'con_saldo' | 'vencidos' = 'todos';

  // ------- Modal -------
  showModal = false;
  editing: Cliente | null = null;
  form: Partial<Cliente> = {};

  hoy = new Date();

  // ----- KPIs -----
  get kpiTotal()     { return this.clientes.length; }
  get kpiConSaldo()  { return this.clientes.filter(c => c.balance > 0).length; }
  get kpiVencidos()  { return this.clientes.filter(c => c.overdueCount > 0).length; }
  get kpiSaldoTotal(){ return this.clientes.reduce((s,c)=> s + (c.balance>0?c.balance:0), 0); }

  // ----- Vista filtrada -----
  get clientesView(): Cliente[] {
    let rows = [...this.clientes];

    // texto
    const q = this.search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(c =>
        c.name.toLowerCase().includes(q) ||
        (c.phone ?? '').toLowerCase().includes(q) ||
        (c.email ?? '').toLowerCase().includes(q)
      );
    }

    // estado activo/inactivo
    if (this.estado === 'activos')   rows = rows.filter(c => c.active);
    if (this.estado === 'inactivos') rows = rows.filter(c => !c.active);

    // presets
    if (this.preset === 'con_saldo') rows = rows.filter(c => c.balance > 0);
    if (this.preset === 'vencidos')  rows = rows.filter(c => c.overdueCount > 0);

    // orden sugerido: vencidos primero, luego mayor saldo
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
    this.form = { creditLimit: 0, termsDays: 0, balance: 0, overdueCount: 0, active: true };
    this.showModal = true;
  }
  editar(c: Cliente) {
    this.editing = c;
    this.form = { ...c };
    this.showModal = true;
  }
  guardar() {
    if (!this.form.name) return;
    if (this.editing) {
      Object.assign(this.editing, this.form);
    } else {
      const id = Math.max(0, ...this.clientes.map(x => x.id)) + 1;
      this.clientes.unshift({
        id,
        name: this.form.name!,
        phone: this.form.phone ?? '',
        email: this.form.email ?? '',
        creditLimit: this.form.creditLimit ?? 0,
        termsDays: this.form.termsDays ?? 0,
        balance: this.form.balance ?? 0,
        overdueCount: this.form.overdueCount ?? 0,
        active: this.form.active ?? true
      });
    }
    this.cerrarModal();
  }
  cerrarModal(){ this.showModal = false; }

  // Acción de “abonar” (solo UI de demo)
  abonar(c: Cliente) {
    const pago = 100; // demo
    c.balance = Math.max(0, c.balance - pago);
    if (c.balance === 0) c.overdueCount = 0;
  }
}
