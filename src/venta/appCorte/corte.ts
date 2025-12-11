import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgIf, NgFor, CurrencyPipe, DatePipe, NgClass} from '@angular/common';
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
}

interface UserOption {
  id: number;
  usuario: string;
  rol: string;
}

@Component({
  selector: 'app-corte',
  templateUrl: './corte.html',
  standalone: true,
  imports: [RouterOutlet, FormsModule, NgIf, NgFor, CurrencyPipe, DatePipe, NgClass],
  styleUrls: ['./corte.css']
})
export class Corte {
  hoy = new Date();

  usuarios: UserOption[] = [];
  selectedUserId: number | null = null;

  showCloseModal = false;
  cashDelivered: number | null = null;
  closeNotes = '';

  // UI: mostrar/ocultar filtros
  showFilters = true;
  loading = false;

  // Filtros
  preset: 'HOY'|'AYER'|'SEMANA'|null = 'HOY';
  desdeStr = '';   // YYYY-MM-DD
  hastaStr = '';   // YYYY-MM-DD
  onlyOpen = true;

  // Datos respuesta
  movimientos: CashMovementRow[] = [];
  summary: Summary = { total_entradas: 0, total_salidas: 0, neto: 0 };

  constructor(private auth: AuthService) {
    this.setPreset('HOY');
  }
  ngOnInit(){
    this.cargarUsuariosActivos();
  }

  private toStr(d: Date){ return d.toISOString().slice(0,10); }
  private startOfWeek(d: Date){
    const x = new Date(d);
    const dow = x.getDay();                 // 0=Dom
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

  editarFiltros(){ this.showFilters = true; }

  limpiar(){
    this.preset = null;
    this.desdeStr = '';
    this.hastaStr = '';
    this.movimientos = [];
    this.summary = { total_entradas: 0, total_salidas: 0, neto: 0 };
    this.showFilters = true;
  }

  async consultar(){
    if (!this.selectedUserId) {
      console.warn('Selecciona un usuario para consultar el corte.');
      return;
    }

    this.loading = true;
    try {
      const payload = {
        start_date: this.desdeStr || null,
        end_date:   this.hastaStr || null,
        user_id:    this.selectedUserId,
        typee:      null,
        only_open:  this.onlyOpen ? 1 : 0,
        closure_id: null
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
        console.error(res?.error || 'Respuesta inválida');
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
    return Number(((this.summary?.neto ?? 0)).toFixed(2));
  }
  get cashDiff(): number {
    const d = (this.cashDelivered ?? 0) - this.cashExpected;
    return Number(d.toFixed(2));
  }

  abrirModalCierre() {
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
        text: 'Debes elegir el usuario al que le vas a hacer el corte.'
      });
      return;
    }

    if (this.cashDelivered == null) {
      await Swal.fire({
        icon: 'warning',
        title: 'Falta efectivo entregado',
        text: 'Captura el efectivo entregado por el cajero.'
      });
      return;
    }

    const cierreFecha = this.hastaStr || this.desdeStr || new Date().toISOString().slice(0,10);

    try {
      const resp = await (window as any).electronAPI.closeShift(
        this.selectedUserId,          
        this.cashDelivered,
        cierreFecha
      );

      if (!resp?.success) {
        await Swal.fire({
          icon: 'error',
          title: 'No se pudo cerrar el turno',
          text: resp?.error || 'Ocurrió un error al registrar el cierre.'
        });
        return;
      }

      const data = resp.data || {};
      await Swal.fire({
        icon: 'success',
        title: 'Corte registrado',
        html: `
          <div style="text-align:left">
            <div><b>Cajero:</b> ${this.selectedUserName}</div>
            <div><b>Fecha:</b> ${data.closure_date || cierreFecha}</div>
            <div><b>Efectivo esperado:</b> $${(data.cash_expected ?? this.cashExpected).toFixed(2)}</div>
            <div><b>Efectivo entregado:</b> $${(data.cash_delivered ?? this.cashDelivered).toFixed(2)}</div>
            <div><b>Diferencia:</b> $${(data.difference ?? this.cashDiff).toFixed(2)}</div>
          </div>
        `
      });

      this.showCloseModal = false;
      await this.consultar();  
    } catch (e: any) {
      console.error('closeShift:', e);
      await Swal.fire({
        icon: 'error',
        title: 'Error inesperado',
        text: e?.message || 'Ocurrió un error al registrar el cierre.'
      });
    }
  }


  private async cargarUsuariosActivos() {
    try {
      const res = await (window as any).electronAPI.getActiveUsers();
      if (res?.success) {
        this.usuarios = res.data || [];
      } else {
        console.error('No se pudieron cargar usuarios', res?.error);
      }
    } catch (e) {
      console.error('Error getActiveUsers:', e);
    }
  }

  get selectedUserName(): string {
    const u = this.usuarios.find(x => x.id === this.selectedUserId);
    return u ? u.usuario : '';
  }
}
