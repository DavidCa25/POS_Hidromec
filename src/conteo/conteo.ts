import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';

interface Prod { id: number; product_name?: string; nombre?: string; part_number?: string; stock: number; bar_code?: string; }

@Component({
  selector: 'app-conteo',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styles: [`
    /* El margen exterior lo pone el shell compartido. */
    .ct-header{
      background: linear-gradient(135deg, var(--inv-main, #1f2e86) 0%, color-mix(in srgb, var(--inv-main, #1f2e86) 97%, white 3%) 100%);
      border-radius: 24px; padding: 2rem; margin-bottom: 1.25rem;
      box-shadow: var(--wx-shadow-raised);
      display: flex; justify-content: space-between; align-items: center; position: relative; overflow: hidden; flex-wrap: wrap; gap: 1rem;
    }
    .ct-header::before{ content:''; position:absolute; top:-50%; right:-10%; width:420px; height:420px; background:radial-gradient(circle, rgba(255,255,255,.12) 0%, transparent 70%); border-radius:50%; }
    .ct-hleft{ position: relative; z-index: 1; }
    .ct-htitle{ display:flex; align-items:center; gap:1rem; margin-bottom:.35rem; }
    .ct-htitle i{ font-size:2.4rem; color: #fff; opacity:.95; }
    .ct-htitle h1{ font-size:2.4rem; font-weight: 600; color: #fff; margin:0; letter-spacing:-.5px; font-family: var(--wx-font); }
    .ct-hsub{ color:rgba(255,255,255,.85); margin:0 0 0 3.4rem; font-family: var(--wx-font); }
    .ct-hright{ position:relative; z-index:1; display:flex; align-items:center; gap:.7rem; flex-wrap:wrap; }
    .ct-chip{ background:rgba(255,255,255,.18); color: #fff; border-radius:999px; padding:.45rem .95rem; font-weight: 600; font-size:.9rem; }
    .ct-chip.diff{ background: var(--wx-warning-soft); color: var(--wx-warning); }
    .btn-apply{ background: var(--wx-surface); color: var(--inv-main,#1f2e86); border:none; border-radius:12px; padding:.7rem 1.2rem; font-weight: 600; cursor:pointer; display:inline-flex; align-items:center; gap:.4rem; }
    .btn-apply:hover{ filter:brightness(.96); }
    .btn-apply:disabled{ opacity:.55; cursor:default; }

    /* Caja, radio, sombra y padding los pone el shell compartido (table.css). */
    .ct-search{ width:100%; border:1.5px solid var(--inv-border, rgba(0,0,0,.08)); border-radius:14px; padding:.85rem 1.1rem; font-size:1rem; outline:none; margin-bottom:1rem; background: var(--wx-surface); }
    .ct-search:focus{ border-color: var(--inv-main,#1f2e86); }

    .ct-scroll{ max-height:58vh; overflow:auto; border-radius:16px; background: var(--wx-surface); box-shadow:0 2px 10px rgba(0,0,0,.04); }
    .ct-table{ width:100%; border-collapse:collapse; }
    /* Medidas y color de cabecera los pone el sistema compartido (table.css).
     Aqui solo queda lo propio de esta pantalla. */
    .ct-table thead th{ text-align:left; }
    .ct-table thead th.r{ text-align:right; }
    .ct-table tbody td{ border-bottom: 1px solid var(--wx-edge-soft); }
    
    .ct-table td.r{ text-align:right; }
    .ct-name{ font-weight: 600; color: var(--wx-text); }
    .mono{ font-family: var(--wx-font-mono); color: var(--wx-text-muted); font-size:.85rem; }
    .ct-in{ width:90px; border: 1.5px solid var(--wx-edge); border-radius:10px; padding:.45rem .55rem; text-align:right; font-size:1rem; outline:none; }
    .ct-in:focus{ border-color: var(--inv-main,#1f2e86); }
    .pill{ display:inline-block; border-radius:999px; padding:.15rem .6rem; font-weight: 600; font-size:.85rem; }
    .pill.crit{ background: var(--wx-danger-soft); color: var(--wx-danger); }
    .pill.ok{ background: var(--wx-success-soft); color: var(--wx-success); }
    .pill.zero{ background: var(--wx-sunken); color: var(--wx-text-muted); }
    .ct-empty{ text-align:center; color: var(--wx-text-dim); padding:2rem; }

    /* ===== Modo oscuro ===== */
    :host-context(html.dark) .ct-scroll{ background: var(--wx-surface); box-shadow:none; }
    :host-context(html.dark) .ct-table tbody td{ border-color: var(--wx-edge-soft); }
    :host-context(html.dark) 
    :host-context(html.dark) .ct-name{ color: var(--wx-text); }
    :host-context(html.dark) .mono{ color: var(--wx-text-dim); }
    :host-context(html.dark) .ct-in{ background: var(--wx-sunken); color: var(--wx-text); border-color: var(--wx-edge-strong); }
    :host-context(html.dark) .ct-search{ background: var(--wx-sunken); color: var(--wx-text); border-color: var(--wx-edge-strong); }
  `],
  template: `
  <div class="ct-wrap">

    <div class="ct-header">
      <div class="ct-hleft">
        <div class="ct-htitle"><i class="ph ph-clipboard-text"></i><h1>Conteo físico</h1></div>
        <p class="ct-hsub">Cuenta lo que hay en el estante y Wybix ajusta el inventario.</p>
      </div>
      <div class="ct-hright">
        <span class="ct-chip">{{ contados }} contados</span>
        <span class="ct-chip diff" *ngIf="conDiferencia">{{ conDiferencia }} con diferencia</span>
        <button class="btn-apply" (click)="aplicar()" [disabled]="guardando || conDiferencia === 0">
          <i class="ph ph-check-circle"></i> {{ guardando ? 'Aplicando...' : 'Aplicar ajustes' }}
        </button>
      </div>
    </div>

    <div class="ct-card">
      <input class="ct-search" [(ngModel)]="filtro" placeholder="Buscar producto, número de parte o código de barras...">

      <div class="ct-scroll">
        <table class="ct-table">
          <thead>
            <tr><th>Producto</th><th>No. parte</th><th class="r">Sistema</th><th class="r">Físico</th><th class="r">Diferencia</th></tr>
          </thead>
          <tbody>
            <tr *ngFor="let p of vista">
              <td class="ct-name">{{ p.product_name || p.nombre }}</td>
              <td class="mono">{{ p.part_number || '-' }}</td>
              <td class="r">{{ p.stock }}</td>
              <td class="r"><input class="ct-in" type="number" min="0" [(ngModel)]="conteo[p.id]"></td>
              <td class="r">
                <span class="pill" *ngIf="diff(p) !== null" [ngClass]="diff(p) === 0 ? 'zero' : (diff(p)! < 0 ? 'crit' : 'ok')">
                  {{ diff(p)! > 0 ? '+' : '' }}{{ diff(p) }}
                </span>
              </td>
            </tr>
            <tr *ngIf="!cargando && vista.length === 0"><td colspan="5" class="ct-empty">Sin resultados</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
  `
})
export class Conteo implements OnInit {
  private get api() { return (window as any).electronAPI; }

  productos: Prod[] = [];
  conteo: Record<number, number | string> = {};
  filtro = '';
  cargando = false;
  guardando = false;

  async ngOnInit() { await this.cargar(); }

  async cargar() {
    this.cargando = true;
    try {
      const r = await this.api?.getActiveProducts?.();
      this.productos = Array.isArray(r?.recordset) ? r.recordset : (Array.isArray(r) ? r : (r?.data || []));
    } catch { this.productos = []; } finally { this.cargando = false; }
  }

  get vista(): Prod[] {
    const q = this.filtro.trim().toLowerCase();
    if (!q) return this.productos;
    return this.productos.filter(p =>
      String(p.product_name ?? p.nombre ?? '').toLowerCase().includes(q) ||
      String(p.part_number ?? '').toLowerCase().includes(q) ||
      String(p.bar_code ?? '').toLowerCase().includes(q));
  }

  diff(p: Prod): number | null {
    const f = this.conteo[p.id];
    if (f === '' || f === null || f === undefined) return null;
    return Number(f) - Number(p.stock);
  }

  get contados(): number {
    return Object.values(this.conteo).filter(v => v !== '' && v !== null && v !== undefined).length;
  }
  get conDiferencia(): number {
    return this.productos.filter(p => { const d = this.diff(p); return d !== null && d !== 0; }).length;
  }

  async aplicar() {
    const items = this.productos
      .filter(p => { const d = this.diff(p); return d !== null && d !== 0; })
      .map(p => ({ product_id: p.id, fisico: Number(this.conteo[p.id]) }));

    if (!items.length) return;

    const r = await Swal.fire({
      icon: 'warning',
      title: `Aplicar ${items.length} ajuste(s)`,
      text: 'Esto actualizará el stock del sistema al valor físico contado. ¿Continuar?',
      showCancelButton: true, confirmButtonText: 'Aplicar', cancelButtonText: 'Cancelar', confirmButtonColor: '#2563EB'
    });
    if (!r.isConfirmed) return;

    this.guardando = true;
    try {
      const res = await this.api?.inventoryApplyCount?.({ items });
      if (!res?.success) throw new Error(res?.error || 'No se pudo aplicar.');
      await Swal.fire({ icon: 'success', title: 'Inventario ajustado', text: `${res.ajustados} producto(s) actualizados.`, timer: 1600, showConfirmButton: false });
      this.conteo = {};
      await this.cargar();
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'No se pudo aplicar el ajuste.' });
    } finally {
      this.guardando = false;
    }
  }
}
