import { Component, EventEmitter, OnInit, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { AuthService, PAQUETES } from '../../services/auth.service';
import { WxSelectComponent, WxOpcion } from '../../app/wx-select/wx-select.component';
import { WxDateComponent } from '../../app/wx-date/wx-date.component';
import {
  ShiftService, EgresosService, ConceptoEgreso, FormaEgreso, PeriodoPago, FORMAS_EGRESO, PERIODOS_PAGO,
} from '../../core';

/**
 * SALIDA DE DINERO DE LA CAJA: Retiro · Pago a proveedor · Gasto.
 *
 * Un solo componente para Retail (F10) y Touch (boton "Salida de efectivo"):
 * las dos cajas sacan dinero igual, asi que no hay dos modales que puedan
 * desalinearse.
 *
 * Quien lo muestra comprueba ANTES que haya turno abierto (cada caja tiene su
 * forma de pedir abrirlo). De todos modos SQL lo vuelve a exigir: una salida
 * en efectivo sin turno se rechaza alli, no aqui.
 */
@Component({
  selector: 'app-salida-efectivo',
  standalone: true,
  imports: [CommonModule, FormsModule, WxSelectComponent, WxDateComponent],
  templateUrl: './salida-efectivo.component.html',
  styleUrls: ['./salida-efectivo.component.css'],
})
export class SalidaEfectivo implements OnInit {
  @Output() cerrado = new EventEmitter<void>();
  private readonly auth = inject(AuthService);
  private readonly shift = inject(ShiftService);

  // Salida de efectivo (F10). Tres cosas distintas que salen del cajon:
  //   RETIRO     dinero que cambia de lugar (al dueno, al banco): no es gasto.
  //   PROVEEDOR  pago a proveedor: va a su cuenta por la puerta unica.
  //   GASTO      egreso del negocio (renta, luz, un Uber, pago al personal).
  cashOutTipo: 'RETIRO' | 'PROVEEDOR' | 'GASTO' = 'RETIRO';
  cashOutAmount: number | null = null;
  cashOutNote = '';
  cashOutSupplierId: number | null = null;
  cashOutProveedores: WxOpcion[] = [];
  cashOutGuardando = false;
  // Gasto
  private readonly egresos = inject(EgresosService);
  readonly formasEgreso = FORMAS_EGRESO;
  readonly periodosPago = PERIODOS_PAGO;
  gastoConceptos: ConceptoEgreso[] = [];
  gastoConceptoId: number | null = null;
  gastoForma: FormaEgreso = 'EFECTIVO';
  gastoPersonaId: number | null = null;
  gastoPersonas: WxOpcion[] = [];
  gastoPeriodo: PeriodoPago = 'DIA';
  gastoDesde: string | null = null;
  gastoHasta: string | null = null;

  /* Gasto y pago a proveedor sacan dinero del negocio: los hace quien
     responde del turno (y las compras, quien opera inventario). El retiro
     simple sigue abierto al Operador, como siempre. */
  get puedeGasto(): boolean { return this.auth.puede(PAQUETES.VENTAS_SUPERVISAR); }
  get puedePagarProveedor(): boolean { return this.auth.puede(PAQUETES.INVENTARIO_OPERAR); }
  get gastoConceptoOpciones(): WxOpcion[] {
    return this.gastoConceptos.map(c => ({ valor: c.id, etiqueta: c.name }));
  }
  get gastoEsPersonal(): boolean {
    return this.gastoConceptos.find(c => c.id === this.gastoConceptoId)?.kind === 'PERSONAL';
  }

  async ngOnInit() {
    await this.cargarDatosSalida();
  }

  cerrar() { this.cerrado.emit(); }

  elegirTipoSalida(t: 'RETIRO' | 'PROVEEDOR' | 'GASTO') {
    if (t === 'GASTO' && !this.puedeGasto) return;
    if (t === 'PROVEEDOR' && !this.puedePagarProveedor) return;
    this.cashOutTipo = t;
  }

  private async cargarDatosSalida() {
    try {
      const api = (window as any).electronAPI;
      if (this.puedePagarProveedor) {
        const rs = await api?.getSuppliers?.();
        const rows = Array.isArray(rs?.recordset) ? rs.recordset : (Array.isArray(rs) ? rs : []);
        this.cashOutProveedores = rows.map((x: any) => ({ valor: Number(x.id), etiqueta: x.nombre ?? x.name ?? '' }));
      }
      if (this.puedeGasto) {
        this.gastoConceptos = await this.egresos.conceptos();
        this.gastoPersonas = (await this.egresos.personal())
          .filter(p => p.active)
          .map(p => ({ valor: p.id, etiqueta: p.usuario, nota: p.rol }));
      }
    } catch { /* las listas quedan vacias y el modal lo dice */ }
  }

  async confirmar() {
    if (this.cashOutGuardando) return;

    const amount = Number(this.cashOutAmount ?? 0);
    const nota = this.cashOutNote.trim();
    if (!(amount > 0)) {
      await Swal.fire({ icon: 'error', title: 'Monto inválido', text: 'El monto debe ser mayor a cero.' });
      return;
    }
    if (this.cashOutTipo === 'RETIRO' && !nota) {
      await Swal.fire({ icon: 'warning', title: 'Nota requerida', text: 'Escribe para qué es el retiro (por ejemplo: "al banco").' });
      return;
    }
    if (this.cashOutTipo === 'PROVEEDOR' && !this.cashOutSupplierId) {
      await Swal.fire({ icon: 'warning', title: 'Elige proveedor', text: 'Selecciona el proveedor al que le pagas.' });
      return;
    }
    if (this.cashOutTipo === 'GASTO') {
      if (!this.gastoConceptoId) {
        await Swal.fire({ icon: 'warning', title: 'Elige el concepto', text: 'Selecciona en qué se gastó (Renta, Luz, Uber...).' });
        return;
      }
      if (this.gastoEsPersonal && !this.gastoPersonaId) {
        await Swal.fire({ icon: 'warning', title: '¿A quién se le paga?', text: 'Elige a la persona del personal.' });
        return;
      }
      if (this.gastoEsPersonal && this.gastoPeriodo === 'OTRO' && (!this.gastoDesde || !this.gastoHasta)) {
        await Swal.fire({ icon: 'warning', title: 'Indica el periodo', text: 'Para "otro periodo" elige desde y hasta qué fecha se paga.' });
        return;
      }
    }

    this.cashOutGuardando = true;
    try {
      let resp: any;
      let titulo = 'Salida registrada';
      let texto = 'El retiro se registró y aparecerá en el corte como retiro.';
      if (this.cashOutTipo === 'RETIRO') {
        resp = await this.shift.registerCashOut(amount, nota);
      } else if (this.cashOutTipo === 'PROVEEDOR') {
        resp = await this.shift.paySupplierCash({ supplier_id: this.cashOutSupplierId!, amount, note: nota });
        titulo = 'Pago a proveedor registrado';
        texto = 'Se abonó a la cuenta del proveedor y salió del cajón.';
      } else {
        const r = await this.egresos.registrar({
          category_id: this.gastoConceptoId!,
          amount,
          payment_method: this.gastoForma,
          note: nota || null,
          staff_user_id: this.gastoEsPersonal ? this.gastoPersonaId : null,
          period_kind: this.gastoEsPersonal ? this.gastoPeriodo : null,
          period_from: this.gastoEsPersonal && this.gastoPeriodo === 'OTRO' ? this.gastoDesde : null,
          period_to: this.gastoEsPersonal && this.gastoPeriodo === 'OTRO' ? this.gastoHasta : null,
        });
        resp = { success: r.ok, error: r.error };
        titulo = this.gastoEsPersonal ? 'Pago al personal registrado' : 'Gasto registrado';
        texto = this.gastoForma === 'EFECTIVO'
          ? 'Salió del cajón y aparecerá en el corte con su concepto.'
          : 'Quedó registrado. No sale del cajón, así que no cambia el corte.';
      }

      if (resp?.success) {
        this.cerrado.emit();
        await Swal.fire({ icon: 'success', title: titulo, text: texto });
      } else {
        const sinApi = /API no disponible|no está disponible/.test(resp?.error || '');
        await Swal.fire({ icon: 'error', title: sinApi ? 'No disponible' : 'No se pudo registrar', text: resp?.error || 'No se pudo registrar la salida.' });
      }
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error inesperado', text: e?.message || 'Ocurrió un error al registrar la salida.' });
    } finally {
      this.cashOutGuardando = false;
    }
  }
}
