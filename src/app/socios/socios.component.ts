import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';
import { FilaSocio, Socio, SociosService, dinero, fechaLocal } from '../../core';
import { AuthService, PAQUETES } from '../../services/auth.service';
import { RegisterService } from '../../services/register.service';
import { WxAvatarComponent } from '../wx-avatar/wx-avatar.component';
import { WxDateComponent } from '../wx-date/wx-date.component';
import { WxSelectComponent, WxOpcion } from '../wx-select/wx-select.component';

/*
 * SOCIOS (0079). docs/socios.md.
 *
 *   Periodo        lo de cada socio desde la ultima liquidacion hasta hoy, y
 *                  liquidar.
 *   Por corte      el conteo de cada caja: lo que le toca a cada socio de
 *                  cada corte.
 *   Liquidaciones  las cerradas, con su detalle.
 *   Movimientos    retiros, pagos y aportaciones.
 *
 * Los numeros salen de SQL (sp_socios_*). Aqui solo se pintan.
 */
type Pestana = 'periodo' | 'cortes' | 'liquidaciones' | 'movimientos';

@Component({
  selector: 'app-socios',
  standalone: true,
  imports: [CommonModule, FormsModule, WxAvatarComponent, WxDateComponent, WxSelectComponent],
  templateUrl: './socios.component.html',
  styleUrls: ['./socios.css'],
})
export class SociosComponent implements OnInit {
  private readonly svc = inject(SociosService);
  private readonly auth = inject(AuthService);
  private readonly register = inject(RegisterService);
  private readonly router = inject(Router);
  readonly dinero = dinero;
  /** Lo que se resta, con su signo; un cero sin signo. */
  resta(n: number): string { return Number(n) ? `−${dinero(n)}` : dinero(0); }

  pestana = signal<Pestana>('periodo');
  cargando = signal(false);
  error = signal('');
  socios = signal<Socio[]>([]);
  periodo = signal<FilaSocio[]>([]);
  cortes = signal<any[]>([]);
  liquidaciones = signal<any[]>([]);
  detalle = signal<{ liquidacion: any; lineas: any[] } | null>(null);
  movimientos = signal<any[]>([]);

  desde = signal(fechaLocal(new Date(Date.now() - 6 * 864e5)));
  hasta = signal(fechaLocal());

  mov = { socioId: null as number | null, tipo: 'RETIRO', monto: null as number | null, metodo: 'EFECTIVO', nota: '' };
  readonly opcionesTipo: WxOpcion[] = [
    { valor: 'RETIRO', etiqueta: 'Retiro', nota: 'se lleva dinero a cuenta de lo suyo' },
    { valor: 'PAGO', etiqueta: 'Pago de saldo', nota: 'el negocio le paga lo que le debe' },
    { valor: 'APORTACION', etiqueta: 'Aportación', nota: 'mete dinero suyo al negocio' },
  ];
  readonly opcionesMetodo: WxOpcion[] = [
    { valor: 'EFECTIVO', etiqueta: 'Efectivo', nota: 'pasa por el cajón' },
    { valor: 'TRANSFERENCIA', etiqueta: 'Transferencia' },
    { valor: 'OTRO', etiqueta: 'Otro' },
  ];
  readonly opcionesSocio = computed<WxOpcion[]>(() => this.socios().filter(s => s.activo).map(s => ({ valor: s.id, etiqueta: s.nombre })));

  get puedeConfigurar(): boolean { return this.auth.puede(PAQUETES.CONFIGURACION_ADMINISTRAR); }

  readonly totales = computed(() => {
    const p = this.periodo();
    const s = (k: keyof FilaSocio) => p.reduce((a, x) => a + (Number(x[k]) || 0), 0);
    return { vendido: s('vendido'), resultado: s('resultado'), saldo: s('saldo_final') };
  });
  readonly rango = computed(() => this.periodo()[0] ? `${this.periodo()[0].desde.slice(0, 10)} a ${this.periodo()[0].hasta.slice(0, 10)}` : '');

  /** Los cortes agrupados: una fila por corte, una columna por socio. */
  readonly tablaCortes = computed(() => {
    const filas = new Map<number, { id: number; caja: string; abierto: string; cerrado: string | null; montos: Map<number, number> }>();
    for (const c of this.cortes()) {
      const f = filas.get(c.closure_id) ?? { id: c.closure_id, caja: c.caja, abierto: c.opened_at, cerrado: c.closed_at, montos: new Map() };
      f.montos.set(c.socio_id, Number(c.le_toca));
      filas.set(c.closure_id, f);
    }
    const ids = [...new Set(this.cortes().map(c => c.socio_id))];
    const nombres = ids.map(id => this.cortes().find(c => c.socio_id === id)?.nombre ?? '');
    return { socios: ids, nombres, filas: [...filas.values()] };
  });

  async ngOnInit(): Promise<void> {
    const c = await this.svc.config();
    if (c.ok) this.socios.set(c.data.socios);
    await this.cargarPeriodo();
  }

  async cambiar(p: Pestana): Promise<void> {
    this.pestana.set(p);
    this.error.set('');
    if (p === 'periodo') await this.cargarPeriodo();
    if (p === 'cortes') await this.cargarCortes();
    if (p === 'liquidaciones') await this.cargarLiquidaciones();
    if (p === 'movimientos') await this.cargarMovimientos();
  }

  private async con<T>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, poner: (d: T) => void): Promise<void> {
    this.cargando.set(true);
    const r = await fn();
    this.cargando.set(false);
    if (r.ok) poner(r.data); else this.error.set(r.error);
  }

  cargarPeriodo() { return this.con(() => this.svc.resumen(), d => this.periodo.set(d)); }
  cargarCortes() { return this.con(() => this.svc.porCorte(this.desde(), this.hasta()), d => this.cortes.set(d)); }
  cargarLiquidaciones() { return this.con(() => this.svc.liquidaciones(), d => { this.liquidaciones.set(d); this.detalle.set(null); }); }
  cargarMovimientos() { return this.con(() => this.svc.movimientos(this.desde(), this.hasta()), d => this.movimientos.set(d)); }
  abrirLiquidacion(id: number) { return this.con(() => this.svc.liquidacion(id), d => this.detalle.set(d)); }

  /** Liquida hasta ayer: el dia de hoy todavia no termina. */
  async liquidar(): Promise<void> {
    const ayer = fechaLocal(new Date(Date.now() - 864e5));
    const conf = await Swal.fire({
      icon: 'question', title: 'Liquidar el periodo',
      html: `Se cierra el periodo <b>hasta el ${ayer}</b>. Una liquidación cerrada ya no cambia; ` +
            `pagar el saldo de cada socio es un movimiento aparte.`,
      showCancelButton: true, confirmButtonText: 'Liquidar', cancelButtonText: 'Cancelar',
    });
    if (!conf.isConfirmed) return;
    const r = await this.svc.liquidar(ayer);
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se pudo liquidar', text: r.error }); return; }
    this.detalle.set(r.data);
    this.pestana.set('liquidaciones');
    const l = await this.svc.liquidaciones();
    if (l.ok) this.liquidaciones.set(l.data);
  }

  /** Pagar el saldo de una línea de liquidación: prellena el movimiento. */
  pagarSaldo(linea: any): void {
    this.mov = { socioId: linea.socio_id, tipo: Number(linea.saldo_final) >= 0 ? 'PAGO' : 'APORTACION',
      monto: Math.abs(Number(linea.saldo_final)), metodo: 'EFECTIVO', nota: '' };
    this.cambiar('movimientos');
  }

  async registrarMovimiento(): Promise<void> {
    if (!this.mov.socioId || !(Number(this.mov.monto) > 0)) { this.error.set('Elige el socio y el monto.'); return; }
    const r = await this.svc.movimiento({
      socioId: this.mov.socioId, tipo: this.mov.tipo as any, monto: Number(this.mov.monto), metodo: this.mov.metodo,
      nota: this.mov.nota || null, registerId: this.register.registerId,
    });
    if (!r.ok) { this.error.set(r.error); return; }
    this.mov = { socioId: null, tipo: 'RETIRO', monto: null, metodo: 'EFECTIVO', nota: '' };
    this.error.set('');
    await Swal.fire({ icon: 'success', title: 'Movimiento registrado', timer: 1400, showConfirmButton: false });
    await this.cargarMovimientos();
  }

  configurar(): void { this.router.navigateByUrl('/dashboard/socios/configurar'); }
  monto(m: Map<number, number>, id: number): number { return m.get(id) ?? 0; }
}
