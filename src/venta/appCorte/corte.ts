import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgIf, NgFor, CurrencyPipe, DatePipe, NgClass} from '@angular/common';

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

@Component({
  selector: 'app-corte',
  templateUrl: './corte.html',
  standalone: true,
  imports: [RouterOutlet, FormsModule, NgIf, NgFor, CurrencyPipe, DatePipe, NgClass],
  styleUrls: ['./corte.css']
})
export class Corte {
  hoy = new Date();

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

  constructor() {
    this.setPreset('HOY');
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
    this.loading = true;
    try {
      const payload = {
        start_date: this.desdeStr || null,
        end_date:   this.hastaStr || null,
        user_id:    null,
        typee:      null,
        only_open:  this.onlyOpen ? 1 : 0,
        closure_id: null
      };

      const res = await (window as any).electronAPI.getCashMovements(payload);

      if (res?.success) {
        const rows: CashMovementRow[] = (res.data?.rows ?? []).map((r: any) => ({
          ...r,
          datee: new Date(r.datee) // para DatePipe
        }));
        this.movimientos = rows;
        this.summary = res.data?.summary ?? { total_entradas: 0, total_salidas: 0, neto: 0 };

        // ocultar filtros tras consultar
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

  // Abrir/cerrar modal
  abrirModalCierre() {
    this.cashDelivered = null;
    this.closeNotes = '';
    this.showCloseModal = true;
  }
  cerrarModalCierre() {
    this.showCloseModal = false;
  }
  confirmarCierrePreview() {
    console.log('🧾 Preview cierre:', {
      start_date: this.desdeStr || this.hoy.toISOString().slice(0,10),
      end_date:   this.hastaStr || this.hoy.toISOString().slice(0,10),
      only_open:  this.onlyOpen ? 1 : 0,
      expected:   this.cashExpected,
      delivered:  this.cashDelivered,
      diff:       this.cashDiff,
      notes:      this.closeNotes
    });
    this.showCloseModal = false;
  }
}
