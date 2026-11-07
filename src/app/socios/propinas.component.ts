import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { ConfigPropinas, REPARTOS_PROPINA, SociosService, dinero, fechaLocal } from '../../core';
import { AuthService, PAQUETES } from '../../services/auth.service';
import { RegisterService } from '../../services/register.service';
import { WxDateComponent } from '../wx-date/wx-date.component';
import { WxSelectComponent, WxOpcion } from '../wx-select/wx-select.component';

/*
 * PROPINAS (0079). docs/socios.md 2.
 *
 * Lo pendiente de ESTA caja y cuanto le tocaria a cada quien (calculado por
 * SQL sin guardar nada); "Pagar" lo reparte de verdad: una salida del cajon
 * por persona. Debajo, el historial y, para el administrador, las reglas.
 */
@Component({
  selector: 'app-propinas',
  standalone: true,
  imports: [CommonModule, FormsModule, WxDateComponent, WxSelectComponent],
  templateUrl: './propinas.component.html',
  styleUrls: ['./socios.css'],
})
export class PropinasComponent implements OnInit {
  private readonly svc = inject(SociosService);
  private readonly auth = inject(AuthService);
  private readonly register = inject(RegisterService);
  readonly dinero = dinero;
  readonly REPARTOS = REPARTOS_PROPINA;

  cargando = signal(false);
  pagando = signal(false);
  error = signal('');
  pendiente = signal<{ reparto: any; lineas: any[] } | null>(null);
  historial = signal<{ propinas: any[]; repartos: any[]; lineas: any[] } | null>(null);
  config = signal<ConfigPropinas | null>(null);
  desde = signal(fechaLocal(new Date(Date.now() - 6 * 864e5)));
  hasta = signal(fechaLocal());

  form = { reparto: 'HORAS', sugeridas: '10,15,20', comisionPct: 0, comisionA: 'NEGOCIO' };
  readonly opcionesReparto: WxOpcion[] = REPARTOS_PROPINA.map(r => ({ valor: r.id, etiqueta: r.nombre }));
  readonly opcionesComision: WxOpcion[] = [
    { valor: 'NEGOCIO', etiqueta: 'La absorbe el negocio' },
    { valor: 'PROPINA', etiqueta: 'Se descuenta de la propina' },
  ];

  get puedeConfigurar(): boolean { return this.auth.puede(PAQUETES.CONFIGURACION_ADMINISTRAR); }
  nombreReparto(id: string): string { return REPARTOS_PROPINA.find(r => r.id === id)?.nombre ?? id; }
  lineasDe(reparto: number): any[] { return (this.historial()?.lineas ?? []).filter(l => l.reparto_id === reparto); }

  async ngOnInit(): Promise<void> {
    const c = await this.svc.configPropinas();
    if (c.ok && c.data) {
      this.config.set(c.data);
      this.form = { reparto: c.data.reparto, sugeridas: c.data.sugeridas, comisionPct: Number(c.data.comision_pct), comisionA: c.data.comision_a };
    }
    await Promise.all([this.cargarPendiente(), this.cargarHistorial()]);
  }

  async cargarPendiente(): Promise<void> {
    this.cargando.set(true);
    const r = await this.svc.repartirPropinas(this.register.registerId, false);
    this.cargando.set(false);
    if (r.ok) this.pendiente.set(r.data); else this.error.set(r.error);
  }

  async cargarHistorial(): Promise<void> {
    const r = await this.svc.historialPropinas(this.desde(), this.hasta());
    if (r.ok) this.historial.set(r.data); else this.error.set(r.error);
  }

  async pagar(): Promise<void> {
    const p = this.pendiente();
    if (!p?.reparto || !(Number(p.reparto.neto) > 0)) return;
    const conf = await Swal.fire({
      icon: 'question', title: `Pagar ${dinero(p.reparto.neto)} de propinas`,
      html: p.lineas.map(l => `${l.usuario}: <b>${dinero(l.monto)}</b>`).join('<br>') +
            '<br><br>Sale del cajón de esta caja, una salida por persona.',
      showCancelButton: true, confirmButtonText: 'Pagar', cancelButtonText: 'Cancelar',
    });
    if (!conf.isConfirmed) return;
    this.pagando.set(true);
    const r = await this.svc.repartirPropinas(this.register.registerId, true);
    this.pagando.set(false);
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se pudo pagar', text: r.error }); return; }
    await Swal.fire({ icon: 'success', title: 'Propinas pagadas', timer: 1500, showConfirmButton: false });
    await Promise.all([this.cargarPendiente(), this.cargarHistorial()]);
  }

  async guardarConfig(): Promise<void> {
    const sugeridas = String(this.form.sugeridas).split(',').map(x => Number(x.trim())).filter(x => x > 0);
    const r = await this.svc.guardarPropinas({ reparto: this.form.reparto, sugeridas, comisionPct: Number(this.form.comisionPct) || 0, comisionA: this.form.comisionA });
    if (!r.ok) { this.error.set(r.error); return; }
    this.config.set(r.data);
    this.error.set('');
    await Swal.fire({ icon: 'success', title: 'Reglas guardadas', timer: 1300, showConfirmButton: false });
    await this.cargarPendiente();
  }
}
