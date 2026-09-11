import { Injectable, inject, signal } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { RegisterService } from '../services/register.service';
import { ElectronBridge } from './electron-bridge.service';
import { ShiftState } from './models';

const SIN_TURNO: ShiftState = { open: false, id: null, openedAt: null, openingCash: 0 };

/**
 * Turno de la caja actual: apertura, estado y salidas de efectivo.
 *
 * Retail y Touch comparten la regla "no se cobra en efectivo sin turno
 * abierto en esta caja". El cierre (corte) sigue en su pantalla propia hasta
 * que se migre (Strangler).
 */
@Injectable({ providedIn: 'root' })
export class ShiftService {
  private readonly bridge = inject(ElectronBridge);
  private readonly auth = inject(AuthService);
  private readonly register = inject(RegisterService);

  readonly shift = signal<ShiftState>({ ...SIN_TURNO });
  private checking: Promise<boolean> | null = null;

  get isOpen(): boolean { return this.shift().open; }

  private get userId(): number | null { return this.auth.usuarioActualId; }

  /**
   * Consulta el turno abierto de ESTA caja. Devuelve true si hay turno.
   * Sin electronAPI (ng serve) no bloquea, igual que antes.
   */
  async refresh(): Promise<boolean> {
    const api = this.bridge.api;
    if (!api?.getOpenShift) return true;
    if (this.checking) return this.checking;
    this.checking = (async () => {
      try {
        const resp = await api.getOpenShift({ user_id: this.userId, register_id: this.register.registerId });
        if (!resp?.success) { this.shift.set({ ...SIN_TURNO }); return false; }
        const row = resp.data;
        const isOpen = !!row?.id && row.closed_at == null;
        if (!isOpen) { this.shift.set({ ...SIN_TURNO }); return false; }
        this.setFromRow(row);
        return true;
      } catch {
        this.shift.set({ ...SIN_TURNO });
        return false;
      } finally {
        this.checking = null;
      }
    })();
    return this.checking;
  }

  /**
   * Confirma con SQL que esta caja tiene turno abierto.
   *
   * Antes devolvia `true` en cuanto el estado en memoria decia "abierto", y
   * ese atajo es justo lo que fallaba: un turno cerrado desde el Corte, desde
   * otra ventana o desde otra caja de la red seguia dando permiso para cobrar.
   * Un turno no es un dato de la sesion, es un hecho de la base.
   *
   * Se llama al empezar un cobro o una salida de efectivo -una vez por
   * operacion-, no al agregar cada linea al carrito: ese camino se protege
   * antes con el estado en memoria, para no consultar en cada lectura del
   * escaner.
   */
  async ensureOpen(): Promise<boolean> {
    return this.refresh();
  }

  async open(openingCash: number, note: string | null): Promise<{ ok: boolean; error?: string }> {
    const api = this.bridge.api;
    if (!api?.openShift) return { ok: false, error: 'No se pudo abrir turno (API no disponible).' };
    const opening_cash = Number(openingCash ?? 0);
    if (opening_cash < 0) return { ok: false, error: 'El fondo inicial no puede ser negativo.' };
    try {
      const resp = await api.openShift({
        user_id: this.userId,
        opening_cash,
        opening_note: (note || '').trim() || null,
        opening_user_id: this.userId,
        register_id: this.register.registerId,
      });
      if (!resp?.success) return { ok: false, error: resp?.error || 'Ocurrió un error al abrir el turno.' };
      const row = resp.data ?? resp.recordset?.[0] ?? null;
      if (row) this.setFromRow(row); else await this.refresh();
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Ocurrió un error al abrir el turno.' };
    }
  }

  /** Salida de efectivo del turno (WITHDRAW). Devuelve la respuesta cruda. */
  async registerCashOut(amount: number, note: string): Promise<any> {
    const api = this.bridge.api;
    if (!api?.registerCashMovement) return { success: false, error: 'No se pudo registrar la salida de efectivo (API no disponible).' };
    return api.registerCashMovement({
      user_id: this.userId,
      typee: 'WITHDRAW',
      amount,
      note,
      register_id: this.register.registerId,
    });
  }

  /** Pago a proveedor ligado a una salida de efectivo. */
  async paySupplier(payload: { supplier_id: number; amount: number; note: string; cash_movement_id: number | null }): Promise<void> {
    await this.bridge.api?.paySupplier?.({
      ...payload,
      user_id: this.userId,
      payment_method: 'EFECTIVO',
    });
  }

  clear(): void { this.shift.set({ ...SIN_TURNO }); }

  private setFromRow(row: any): void {
    this.shift.set({
      open: true,
      id: row?.id ?? row?.shift_id ?? row?.closure_id ?? null,
      openedAt: row?.opened_at ? new Date(row.opened_at) : null,
      openingCash: Number(row?.opening_cash ?? row?.openingCash ?? 0),
    });
  }
}
