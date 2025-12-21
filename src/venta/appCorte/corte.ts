import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgIf, NgFor, CurrencyPipe, DatePipe, NgClass } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import Swal from 'sweetalert2';

type TipoMov = 'SALE' | 'DEPOSIT' | 'WITHDRAW' | 'REFUND' | string;

interface CashMovementRow {
  id: number;
  datee: string | Date;
  user_id: number;
  user_name: string;
  typee: TipoMov;
  amount: number;
  reference_id: number | null;
  reference: string | null;
  note: string | null;
  closure_id: number | null;
}

interface Summary {
  total_entradas: number;
  total_salidas: number;
  neto: number;
  opening_cash?: number;
  cash_expected?: number;
}

interface UserOption {
  id: number;
  usuario: string;
  rol: string;
}

type Mode = 'TURNO' | 'DIA';

@Component({
  selector: 'app-corte',
  templateUrl: './corte.html',
  standalone: true,
  imports: [RouterOutlet, FormsModule, NgIf, NgFor, CurrencyPipe, DatePipe, NgClass],
  styleUrls: ['./corte.css']
})
export class Corte {
  hoy = new Date();

  // Wizard control
  currentStep = 1;

  usuarios: UserOption[] = [];
  selectedUserId: number | null = null;

  showCloseModal = false;
  cashDelivered: number | null = null;
  closeNotes = '';

  closing = false;

  showFilters = true;
  loading = false;

  // Modo: TURNO (para cerrar) vs DIA (reporte)
  mode: Mode = 'TURNO';

  // Filtros (para DIA / reportes)
  preset: 'HOY'|'AYER'|'SEMANA'|null = 'HOY';
  desdeStr = '';
  hastaStr = '';

  // TURNO
  onlyOpen = true;
  openShiftId: number | null = null;
  openShiftOpenedAt: Date | null = null;
  openShiftOpeningCash = 0;

  movimientos: CashMovementRow[] = [];
  summary: Summary = { total_entradas: 0, total_salidas: 0, neto: 0 };

  constructor(private auth: AuthService) {
    this.setPreset('HOY');
  }

  async ngOnInit() {
    await this.cargarUsuariosActivos();
  }

  private toStr(d: Date){ return d.toISOString().slice(0,10); }

  private startOfWeek(d: Date){
    const x = new Date(d);
    const dow = x.getDay();
    const diff = (dow === 0 ? -6 : 1) - dow;
    x.setDate(x.getDate() + diff);
    x.setHours(0,0,0,0);
    return x;
  }

  setPreset(p: 'HOY'|'AYER'|'SEMANA'){
    this.preset = p;
    const today = new Date(); today.setHours(0,0,0,0);

    if (p === 'HOY'){
      this.desdeStr = this.toStr(today);
      this.hastaStr = this.toStr(today);
    } else if (p === 'AYER'){
      const y = new Date(today); y.setDate(y.getDate()-1);
      this.desdeStr = this.toStr(y);
      this.hastaStr = this.toStr(y);
    } else {
      const ini = this.startOfWeek(today);
      this.desdeStr = this.toStr(ini);
      this.hastaStr = this.toStr(today);
    }
  }

  // ===== WIZARD NAVIGATION =====
  async selectUser(userId: number) {
    this.selectedUserId = userId;
    await this.onUserChange();
  }

  nextStep() {
    if (this.currentStep < 3) {
      this.currentStep++;
    }
  }

  prevStep() {
    if (this.currentStep > 1) {
      this.currentStep--;
    }
  }

  async selectMode(mode: Mode) {
    this.mode = mode;
    if (mode === 'TURNO') {
      this.onlyOpen = true;
      if (this.selectedUserId) {
        await this.fetchOpenShiftForSelectedUser();
      }
    } else {
      this.setPreset('HOY');
    }
  }

  get canConsult(): boolean {
    if (!this.selectedUserId) return false;
    if (this.mode === 'TURNO') {
      return !!this.openShiftId;
    }
    return true;
  }

  get canClose(): boolean {
    if (!this.selectedUserId) return false;
    if (this.mode === 'TURNO') {
      return !!this.openShiftId;
    }
    return true;
  }

  editarFiltros(){
    this.showFilters = true;
    this.currentStep = 1;
  }

  limpiar(){
    this.preset = null;
    this.desdeStr = '';
    this.hastaStr = '';
    this.onlyOpen = true;
    this.selectedUserId = null;
    this.mode = 'TURNO';

    this.openShiftId = null;
    this.openShiftOpenedAt = null;
    this.openShiftOpeningCash = 0;

    this.movimientos = [];
    this.summary = { total_entradas: 0, total_salidas: 0, neto: 0 };
    this.showFilters = true;
    this.currentStep = 1;
  }

  async onUserChange() {
    this.openShiftId = null;
    this.openShiftOpenedAt = null;
    this.openShiftOpeningCash = 0;

    if (this.mode === 'TURNO' && this.selectedUserId) {
      await this.fetchOpenShiftForSelectedUser();
    }
  }

  private async fetchOpenShiftForSelectedUser(): Promise<boolean> {
    const api = (window as any).electronAPI;
    if (!api?.getOpenShift) return false;
    if (!this.selectedUserId) return false;

    const resp = await api.getOpenShift({ user_id: this.selectedUserId });

    if (!resp?.success) return false;

    const row = resp.data;
    const isOpen = !!row?.id && (row.closed_at == null);

    if (!isOpen) {
      this.openShiftId = null;
      this.openShiftOpenedAt = null;
      this.openShiftOpeningCash = 0;
      return false;
    }

    this.openShiftId = Number(row.id);
    this.openShiftOpenedAt = row.opened_at ? new Date(row.opened_at) : null;
    this.openShiftOpeningCash = Number(row.opening_cash ?? 0);
    return true;
  }

  async consultar(){
    if (!this.selectedUserId) {
      await Swal.fire({
        icon: 'warning',
        title: 'Selecciona cajero',
        text: 'Elige un cajero para consultar.',
        confirmButtonColor: '#10b981'
      });
      return;
    }

    this.loading = true;
    try {
      if (this.mode === 'TURNO') {
        const ok = await this.fetchOpenShiftForSelectedUser();
        if (!ok || !this.openShiftId) {
          this.movimientos = [];
          this.summary = { total_entradas: 0, total_salidas: 0, neto: 0 };
          await Swal.fire({
            icon: 'info',
            title: 'Sin turno abierto',
            text: 'Este cajero no tiene un turno abierto para cerrar.',
            confirmButtonColor: '#10b981'
          });
          return;
        }
      }

      const payload = {
        start_date: this.mode === 'DIA' ? (this.desdeStr || null) : null,
        end_date:   this.mode === 'DIA' ? (this.hastaStr || null) : null,
        user_id:    this.selectedUserId,
        typee:      null,
        closure_id: this.mode === 'TURNO' ? this.openShiftId : null,
        only_open:  this.mode === 'TURNO' ? 1 : (this.onlyOpen ? 1 : 0),
      };

      const res = await (window as any).electronAPI.getCashMovements(payload);

      if (res?.success) {
        const rows: CashMovementRow[] = (res.data?.rows ?? []).map((r: any) => ({
          ...r,
          datee: new Date(r.datee)
        }));
        this.movimientos = rows;
        this.summary = res.data?.summary ?? { total_entradas: 0, total_salidas: 0, neto: 0 };
        this.showFilters = false;
      } else {
        this.movimientos = [];
        this.summary = { total_entradas: 0, total_salidas: 0, neto: 0 };
      }
    } catch (e) {
      console.error('❌ getCashMovements:', e);
      this.movimientos = [];
      this.summary = { total_entradas: 0, total_salidas: 0, neto: 0 };
    } finally {
      this.loading = false;
    }
  }

  get cashExpected(): number {
    const fromDb = (this.summary as any)?.cash_expected;
    if (fromDb != null) return Number(Number(fromDb).toFixed(2));

    const opening = Number((this.summary as any)?.opening_cash ?? this.openShiftOpeningCash ?? 0);
    const neto = Number(this.summary?.neto ?? 0);
    return Number((opening + neto).toFixed(2));
  }


  get cashDiff(): number {
    const d = (this.cashDelivered ?? 0) - this.cashExpected;
    return Number(d.toFixed(2));
  }

  abrirModalCierre() {
    if (this.mode !== 'TURNO') {
      Swal.fire({
        icon: 'info',
        title: 'Modo reporte',
        text: 'Para cerrar un turno, cambia a modo TURNO.',
        confirmButtonColor: '#10b981'
      });
      return;
    }
    this.cashDelivered = null;
    this.closeNotes = '';
    this.showCloseModal = true;
  }

  cerrarModalCierre() {
    this.showCloseModal = false;
  }

  async confirmarCierreReal() {
    if (!this.selectedUserId) {
      await Swal.fire({
        icon: 'warning',
        title: 'Selecciona un cajero',
        text: 'Debes elegir el usuario al que le vas a hacer el corte.',
        confirmButtonColor: '#10b981'
      });
      return;
    }

    if (!this.openShiftId) {
      await Swal.fire({
        icon: 'warning',
        title: 'Sin turno abierto',
        text: 'No hay turno abierto detectado para cerrar.',
        confirmButtonColor: '#10b981'
      });
      return;
    }

    if (this.cashDelivered == null) {
      await Swal.fire({
        icon: 'warning',
        title: 'Falta efectivo entregado',
        text: 'Captura el efectivo entregado por el cajero.',
        confirmButtonColor: '#10b981'
      });
      return;
    }
    this.closing = true;

    const userId = Number(this.selectedUserId);
    const closureId = Number(this.openShiftId);

    if (!Number.isFinite(userId) || userId <= 0) {
      await Swal.fire({ icon: 'error', title: 'user_id inválido', text: String(this.selectedUserId) });
      return;
    }
    if (!Number.isFinite(closureId) || closureId <= 0) {
      await Swal.fire({ icon: 'error', title: 'closure_id inválido', text: String(this.openShiftId) });
      return;
    }
    try {
      const resp = await (window as any).electronAPI.closeShift({
        closure_id: closureId,
        user_id: userId,
        cash_delivered: Number(this.cashDelivered),
        note: (this.closeNotes || '').trim() || null
      });

      if (!resp?.success) {
        await Swal.fire({
          icon: 'error',
          title: 'No se pudo cerrar el turno',
          text: resp?.error || 'Ocurrió un error al registrar el cierre.',
          confirmButtonColor: '#10b981'
        });
        return;
      }

      const data = resp.data || {};
      await Swal.fire({
        icon: 'success',
        title: '¡Corte registrado exitosamente!',
        html: `
          <div style="text-align:left; background: #f8fafc; padding: 1.5rem; border-radius: 12px; margin-top: 1rem;">
            <div style="margin-bottom: 0.75rem; display: flex; justify-content: space-between;">
              <span style="font-weight: 600; color: #64748b;">Cajero:</span>
              <span style="font-weight: 700;">${this.selectedUserName}</span>
            </div>
            <div style="margin-bottom: 0.75rem; display: flex; justify-content: space-between;">
              <span style="font-weight: 600; color: #64748b;">Turno ID:</span>
              <span style="font-weight: 700;">#${this.openShiftId}</span>
            </div>
            <div style="margin-bottom: 0.75rem; display: flex; justify-content: space-between;">
              <span style="font-weight: 600; color: #64748b;">Efectivo esperado:</span>
              <span style="font-weight: 700;">$${(data.cash_expected ?? this.cashExpected).toFixed(2)}</span>
            </div>
            <div style="margin-bottom: 0.75rem; display: flex; justify-content: space-between;">
              <span style="font-weight: 600; color: #64748b;">Efectivo entregado:</span>
              <span style="font-weight: 700;">$${(data.cash_delivered ?? this.cashDelivered).toFixed(2)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding-top: 0.75rem; border-top: 2px solid #e2e8f0;">
              <span style="font-weight: 700; color: #0f172a;">Diferencia:</span>
              <span style="font-weight: 800; font-size: 1.2rem; color: ${(data.difference ?? this.cashDiff) >= 0 ? '#16a34a' : '#dc2626'};">
                $${(data.difference ?? this.cashDiff).toFixed(2)}
              </span>
            </div>
          </div>
        `,
        confirmButtonColor: '#10b981'
      });
      
      this.showCloseModal = false;
      this.openShiftId = null;
      this.openShiftOpenedAt = null;
      this.openShiftOpeningCash = 0;

      await this.consultar();
    } catch (e: any) {
      console.error('closeShift:', e);
      await Swal.fire({
        icon: 'error',
        title: 'Error inesperado',
        text: e?.message || 'Ocurrió un error al registrar el cierre.',
        confirmButtonColor: '#10b981'
      });
    }
  }

  private async cargarUsuariosActivos() {
    try {
      const res = await (window as any).electronAPI.getActiveUsers();
      if (res?.success) this.usuarios = res.data || [];
      else console.error('No se pudieron cargar usuarios', res?.error);
    } catch (e) {
      console.error('Error getActiveUsers:', e);
    }
  }

  get selectedUserName(): string {
    const u = this.usuarios.find(x => x.id === this.selectedUserId);
    return u ? u.usuario : '';
  }
}