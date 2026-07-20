import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { ReportService, ReportConfig } from '../services/report.service';

interface Reorden { id: number; nombre: string; stock: number; vendido_ventana: number; prom_diario: number; dias_restantes: number; sugerido: number; }

@Component({
  selector: 'app-alertas',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styles: [`
    .al-wrap{padding:1.5rem;max-width:1100px;margin:0 auto;}
    .al-title{font-size:1.7rem;font-weight:800;color:#0f172a;margin:0;}
    .al-sub{color:#64748b;margin:.2rem 0 1.2rem;}
    .al-card{background:#fff;border:1px solid #eef2f6;border-radius:18px;padding:1.3rem 1.4rem;box-shadow:0 4px 14px rgba(0,0,0,.04);margin-bottom:1.1rem;}
    .al-card-head{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.8rem;margin-bottom:1rem;}
    .al-card-title{font-size:1.12rem;font-weight:800;color:#0f172a;display:flex;align-items:center;gap:.55rem;}
    .al-card-title i{color:#2563EB;}
    .al-count{background:#eff6ff;color:#1d4ed8;border-radius:999px;padding:.1rem .6rem;font-size:.8rem;font-weight:800;margin-left:.2rem;}
    .al-count.crit{background:#fee2e2;color:#dc2626;}
    .al-controls{display:flex;align-items:center;gap:.6rem;}
    .al-sel-wrap{position:relative;}
    .al-sel{border:1px solid #e2e8f0;background:#f8fafc;border-radius:10px;padding:.5rem .8rem;font-weight:600;color:#334155;cursor:pointer;display:flex;align-items:center;gap:.4rem;}
    .al-menu{position:absolute;top:calc(100% + 4px);right:0;background:#fff;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 10px 25px rgba(0,0,0,.12);z-index:30;min-width:120px;overflow:hidden;}
    .al-menu-opt{padding:.55rem .9rem;cursor:pointer;font-size:.9rem;}
    .al-menu-opt:hover{background:#f1f5f9;}
    .al-btn{border:1px solid #e2e8f0;background:#fff;border-radius:10px;padding:.5rem .8rem;font-weight:600;color:#334155;cursor:pointer;}
    .al-btn:hover{background:#f8fafc;}
    .al-btn:disabled{opacity:.5;cursor:default;}
    .al-table{width:100%;border-collapse:collapse;}
    .al-table th{text-align:left;font-size:.76rem;text-transform:uppercase;letter-spacing:.03em;color:#94a3b8;padding:.5rem .6rem;border-bottom:1px solid #eef2f6;}
    .al-table th.r,.al-table td.r{text-align:right;}
    .al-table td{padding:.6rem;border-bottom:1px solid #f4f6f9;}
    .al-name{font-weight:700;color:#0f172a;}
    .mono{font-family:monospace;color:#64748b;}
    .pill{display:inline-block;border-radius:999px;padding:.15rem .6rem;font-weight:800;font-size:.82rem;}
    .pill.crit{background:#fee2e2;color:#dc2626;}
    .pill.warn{background:#fef3c7;color:#d97706;}
    .pill.ok{background:#dcfce7;color:#16a34a;}
    .sug{font-weight:800;color:#1d4ed8;}
    .al-empty{display:flex;align-items:center;gap:.6rem;color:#16a34a;padding:1.2rem .4rem;font-weight:600;}
    .al-empty i{font-size:1.2rem;}
    .al-load{color:#94a3b8;padding:1.2rem;text-align:center;}
    .scroll{max-height:320px;overflow:auto;}
  `],
  template: `
  <div class="al-wrap">
    <h2 class="al-title">Alertas</h2>
    <p class="al-sub">Wybix vigila tu negocio y te avisa antes de que sea un problema.</p>

    <!-- 1. REORDEN INTELIGENTE -->
    <div class="al-card">
      <div class="al-card-head">
        <div class="al-card-title"><i class="bi bi-box-seam"></i> Reorden inteligente
          <span class="al-count" *ngIf="reorden.length">{{ reorden.length }}</span>
        </div>
        <div class="al-controls">
          <span style="color:#64748b;font-size:.88rem;">Se acaba en</span>
          <div class="al-sel-wrap">
            <div class="al-sel" (click)="menuDias = !menuDias">≤ {{ diasAlerta }} días <i class="bi bi-chevron-down"></i></div>
            <div class="al-menu" *ngIf="menuDias">
              <div class="al-menu-opt" *ngFor="let d of opcionesDias" (click)="setDias(d)">≤ {{ d }} días</div>
            </div>
          </div>
          <button class="al-btn" (click)="exportarReorden('excel')" [disabled]="!reorden.length" title="Excel"><i class="bi bi-file-earmark-excel"></i></button>
          <button class="al-btn" (click)="exportarReorden('pdf')" [disabled]="!reorden.length" title="PDF"><i class="bi bi-file-earmark-pdf"></i></button>
        </div>
      </div>
      <div class="al-load" *ngIf="cargandoReorden">Analizando ventas...</div>
      <div *ngIf="!cargandoReorden">
        <div class="al-empty" *ngIf="!reorden.length"><i class="bi bi-check-circle-fill"></i> Nada se acaba en los próximos {{ diasAlerta }} días.</div>
        <div class="scroll" *ngIf="reorden.length">
          <table class="al-table">
            <thead><tr><th>Producto</th><th class="r">Stock</th><th class="r">Vende/día</th><th class="r">Se acaba en</th><th class="r">Pedir</th></tr></thead>
            <tbody>
              <tr *ngFor="let f of reorden">
                <td class="al-name">{{ f.nombre }}</td>
                <td class="r">{{ f.stock }}</td>
                <td class="r">{{ f.prom_diario }}</td>
                <td class="r"><span class="pill" [ngClass]="urgencia(f.dias_restantes)">{{ f.dias_restantes }} {{ f.dias_restantes === 1 ? 'día' : 'días' }}</span></td>
                <td class="r sug">{{ f.sugerido }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- STOCK BAJO -->
    <div class="al-card">
      <div class="al-card-head">
        <div class="al-card-title"><i class="bi bi-battery-half"></i> Stock bajo
          <span class="al-count" *ngIf="lowStock.length">{{ lowStock.length }}</span>
        </div>
        <div class="al-controls">
          <span style="color:#64748b;font-size:.88rem;">Mínimo</span>
          <div class="al-sel-wrap">
            <div class="al-sel" (click)="menuMin = !menuMin">≤ {{ minStock }} <i class="bi bi-chevron-down"></i></div>
            <div class="al-menu" *ngIf="menuMin">
              <div class="al-menu-opt" *ngFor="let n of opcionesMin" (click)="setMin(n)">≤ {{ n }}</div>
            </div>
          </div>
        </div>
      </div>
      <p class="al-sub" style="margin:.3rem 0 .8rem;">Productos con pocas piezas, sin importar qué tan rápido se vendan.</p>
      <div class="al-load" *ngIf="cargandoLow">Revisando stock...</div>
      <div *ngIf="!cargandoLow">
        <div class="al-empty" *ngIf="!lowStock.length"><i class="bi bi-check-circle-fill"></i> Ningún producto por debajo de {{ minStock }}.</div>
        <div class="scroll" *ngIf="lowStock.length">
          <table class="al-table">
            <thead><tr><th>Producto</th><th>No. parte</th><th class="r">Stock</th></tr></thead>
            <tbody>
              <tr *ngFor="let a of lowStock">
                <td class="al-name">{{ a.nombre }}</td>
                <td class="mono">{{ a.part_number || '-' }}</td>
                <td class="r"><span class="pill" [ngClass]="a.stock <= 1 ? 'crit' : 'warn'">{{ a.stock }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- 2. AGOTADOS -->
    <div class="al-card">
      <div class="al-card-title"><i class="bi bi-x-octagon"></i> Productos agotados
        <span class="al-count crit" *ngIf="agotados.length">{{ agotados.length }}</span>
      </div>
      <div class="al-load" *ngIf="cargandoAgotados">Revisando stock...</div>
      <div *ngIf="!cargandoAgotados">
        <div class="al-empty" *ngIf="!agotados.length"><i class="bi bi-check-circle-fill"></i> Ningún producto activo está en cero.</div>
        <div class="scroll" *ngIf="agotados.length">
          <table class="al-table">
            <thead><tr><th>Producto</th><th>No. parte</th><th class="r">Stock</th></tr></thead>
            <tbody>
              <tr *ngFor="let a of agotados">
                <td class="al-name">{{ a.nombre }}</td>
                <td class="mono">{{ a.part_number || '-' }}</td>
                <td class="r"><span class="pill crit">{{ a.stock }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- 3. SIN ROTACIÓN (muertos) -->
    <div class="al-card">
      <div class="al-card-title"><i class="bi bi-snow"></i> Productos sin rotación
        <span class="al-count" *ngIf="muertos.length">{{ muertos.length }}</span>
      </div>
      <p class="al-sub" style="margin:.3rem 0 .8rem;">Sin ventas recientes: dinero congelado en el estante.</p>
      <div class="al-load" *ngIf="cargandoMuertos">Buscando productos sin movimiento...</div>
      <div *ngIf="!cargandoMuertos">
        <div class="al-empty" *ngIf="!muertos.length"><i class="bi bi-check-circle-fill"></i> Todos tus productos tienen movimiento.</div>
        <div class="scroll" *ngIf="muertos.length">
          <table class="al-table">
            <thead><tr><th>Producto</th><th class="r">Stock</th></tr></thead>
            <tbody>
              <tr *ngFor="let m of muertos">
                <td class="al-name">{{ m.nombre || m.product_name || '-' }}</td>
                <td class="r">{{ m.stock ?? '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- 4. VENTAS EN $0 (robo hormiga) -->
    <div class="al-card">
      <div class="al-card-title"><i class="bi bi-exclamation-triangle"></i> Ventas en $0
        <span class="al-count crit" *ngIf="ventasCero.length">{{ ventasCero.length }}</span>
      </div>
      <p class="al-sub" style="margin:.3rem 0 .8rem;">Ventas registradas en cero pesos en los últimos 30 días. Revísalas.</p>
      <div class="al-load" *ngIf="cargandoCero">Revisando ventas...</div>
      <div *ngIf="!cargandoCero">
        <div class="al-empty" *ngIf="!ventasCero.length"><i class="bi bi-check-circle-fill"></i> Sin ventas en $0. Todo normal.</div>
        <div class="scroll" *ngIf="ventasCero.length">
          <table class="al-table">
            <thead><tr><th>Folio</th><th>Fecha</th><th>Cajero</th></tr></thead>
            <tbody>
              <tr *ngFor="let v of ventasCero">
                <td class="al-name">#{{ v.id }}</td>
                <td>{{ v.datee | date:'dd/MM/yyyy HH:mm' }}</td>
                <td>{{ v.usuario || '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- 5. DESCUADRE EN CAJA (robo hormiga) -->
    <div class="al-card">
      <div class="al-card-title"><i class="bi bi-cash-stack"></i> Descuadre en corte de caja
        <span class="al-count crit" *ngIf="descuadres.length">{{ descuadres.length }}</span>
      </div>
      <p class="al-sub" style="margin:.3rem 0 .8rem;">Cortes donde lo entregado no cuadra con lo esperado (posible faltante).</p>
      <div class="al-load" *ngIf="cargandoDescuadre">Revisando cortes...</div>
      <div *ngIf="!cargandoDescuadre">
        <div class="al-empty" *ngIf="!descuadres.length"><i class="bi bi-check-circle-fill"></i> Todos los cortes cuadran.</div>
        <div class="scroll" *ngIf="descuadres.length">
          <table class="al-table">
            <thead><tr><th>Fecha</th><th>Cajero</th><th class="r">Esperado</th><th class="r">Entregado</th><th class="r">Diferencia</th></tr></thead>
            <tbody>
              <tr *ngFor="let c of descuadres">
                <td>{{ c.create_date | date:'dd/MM/yyyy' }}</td>
                <td class="al-name">{{ c.user_name || '-' }}</td>
                <td class="r">{{ money(c.cash_expected) }}</td>
                <td class="r">{{ money(c.cash_delivered) }}</td>
                <td class="r"><span class="pill" [ngClass]="c.difference < 0 ? 'crit' : 'warn'">{{ money(c.difference) }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- 6. DEVOLUCIONES POR CAJERO (robo hormiga) -->
    <div class="al-card">
      <div class="al-card-title"><i class="bi bi-arrow-counterclockwise"></i> Devoluciones por cajero
        <span class="al-count" *ngIf="devoluciones.length">{{ devoluciones.length }}</span>
      </div>
      <p class="al-sub" style="margin:.3rem 0 .8rem;">Quién hace más devoluciones. Un número muy alto vale la pena revisarlo.</p>
      <div class="al-load" *ngIf="cargandoDevol">Contando devoluciones...</div>
      <div *ngIf="!cargandoDevol">
        <div class="al-empty" *ngIf="!devoluciones.length"><i class="bi bi-check-circle-fill"></i> Sin devoluciones registradas.</div>
        <div class="scroll" *ngIf="devoluciones.length">
          <table class="al-table">
            <thead><tr><th>Cajero</th><th class="r">Devoluciones</th><th class="r">Monto</th></tr></thead>
            <tbody>
              <tr *ngFor="let d of devoluciones">
                <td class="al-name">{{ d.usuario || '-' }}</td>
                <td class="r">{{ d.num_devoluciones }}</td>
                <td class="r">{{ money(d.monto) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- 7. CRÉDITO VENCIDO (cobranza) -->
    <div class="al-card">
      <div class="al-card-title"><i class="bi bi-calendar-x"></i> Crédito vencido
        <span class="al-count crit" *ngIf="vencidos.length">{{ vencidos.length }}</span>
      </div>
      <p class="al-sub" style="margin:.3rem 0 .8rem;">Clientes que te deben y ya se pasaron de la fecha de pago.</p>
      <div class="al-load" *ngIf="cargandoVencidos">Revisando cuentas por cobrar...</div>
      <div *ngIf="!cargandoVencidos">
        <div class="al-empty" *ngIf="!vencidos.length"><i class="bi bi-check-circle-fill"></i> Nadie tiene crédito vencido.</div>
        <div class="scroll" *ngIf="vencidos.length">
          <table class="al-table">
            <thead><tr><th>Cliente</th><th class="r">Deuda vencida</th><th class="r">Días</th><th class="r">Facturas</th></tr></thead>
            <tbody>
              <tr *ngFor="let v of vencidos">
                <td class="al-name">{{ nombreCliente(v.customer_id) }}</td>
                <td class="r">{{ money(v.deuda_vencida) }}</td>
                <td class="r"><span class="pill crit">{{ v.dias_vencido }}</span></td>
                <td class="r">{{ v.facturas }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
  `
})
export class Alertas implements OnInit {
  private get api() { return (window as any).electronAPI; }

  // Reorden
  reorden: Reorden[] = [];
  cargandoReorden = false;
  diasAlerta = 7;
  opcionesDias = [3, 7, 15, 30];
  menuDias = false;

  // Otras alertas
  lowStock: any[] = []; cargandoLow = false; minStock = 3; opcionesMin = [3, 5, 10]; menuMin = false;
  agotados: any[] = []; cargandoAgotados = false;
  muertos: any[] = []; cargandoMuertos = false;
  ventasCero: any[] = []; cargandoCero = false;
  descuadres: any[] = []; cargandoDescuadre = false;
  devoluciones: any[] = []; cargandoDevol = false;
  vencidos: any[] = []; cargandoVencidos = false;
  private clientesMap: Record<number, string> = {};

  constructor(private reports: ReportService) {}

  async ngOnInit() {
    await Promise.all([
      this.cargarReorden(), this.cargarLow(), this.cargarAgotados(), this.cargarMuertos(), this.cargarCero(),
      this.cargarDescuadre(), this.cargarDevoluciones(), this.cargarVencidos()
    ]);
  }

  async cargarLow() {
    this.menuMin = false;
    this.cargandoLow = true;
    try {
      const r = await this.api?.alertsLowStock?.({ min: this.minStock });
      this.lowStock = r?.success ? (r.data || []) : [];
    } catch { this.lowStock = []; } finally { this.cargandoLow = false; }
  }
  setMin(n: number) { this.minStock = n; this.cargarLow(); }

  money(n: any): string { return '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  nombreCliente(id: number): string { return this.clientesMap[id] || ('Cliente #' + id); }

  async cargarDescuadre() {
    this.cargandoDescuadre = true;
    try {
      const r = await this.api?.alertsCashClosures?.({ dias: 30 });
      const rows = r?.success ? (r.data || []) : [];
      this.descuadres = rows.filter((c: any) => Number(c.difference) !== 0);
    } catch { this.descuadres = []; } finally { this.cargandoDescuadre = false; }
  }

  async cargarDevoluciones() {
    this.cargandoDevol = true;
    try {
      const r = await this.api?.alertsRefundsByCashier?.();
      this.devoluciones = r?.success ? (r.data || []) : [];
    } catch { this.devoluciones = []; } finally { this.cargandoDevol = false; }
  }

  async cargarVencidos() {
    this.cargandoVencidos = true;
    try {
      await this.cargarClientesMap();
      const r = await this.api?.alertsOverdueCredit?.();
      this.vencidos = r?.success ? (r.data || []) : [];
    } catch { this.vencidos = []; } finally { this.cargandoVencidos = false; }
  }

  private async cargarClientesMap() {
    try {
      const r = await this.api?.getCreditCustomers?.();
      const arr = Array.isArray(r) ? r : (Array.isArray(r?.data) ? r.data : []);
      const map: Record<number, string> = {};
      for (const c of arr) {
        const id = Number(c.id ?? c.customer_id);
        const nm = c.customerName ?? c.name ?? c.nombre ?? c.customer_name;
        if (Number.isFinite(id)) map[id] = nm || ('Cliente #' + id);
      }
      this.clientesMap = map;
    } catch { this.clientesMap = {}; }
  }

  // ---- Reorden ----
  async cargarReorden() {
    this.menuDias = false;
    this.cargandoReorden = true;
    try {
      const r = await this.api?.alertsReorder?.({ dias_alerta: this.diasAlerta });
      this.reorden = r?.success ? (r.data || []) : [];
    } catch { this.reorden = []; } finally { this.cargandoReorden = false; }
  }
  setDias(d: number) { this.diasAlerta = d; this.cargarReorden(); }
  urgencia(d: number): string { return d <= 2 ? 'crit' : d <= 5 ? 'warn' : 'ok'; }

  // ---- Agotados ----
  async cargarAgotados() {
    this.cargandoAgotados = true;
    try {
      const r = await this.api?.alertsOutOfStock?.();
      this.agotados = r?.success ? (r.data || []) : [];
    } catch { this.agotados = []; } finally { this.cargandoAgotados = false; }
  }

  // ---- Muertos (reutiliza sp_dead_products) ----
  async cargarMuertos() {
    this.cargandoMuertos = true;
    try {
      const r = await this.api?.deadProducts?.({});
      this.muertos = (r?.success ? r.data : (Array.isArray(r) ? r : r?.data)) || [];
    } catch { this.muertos = []; } finally { this.cargandoMuertos = false; }
  }

  // ---- Ventas en $0 ----
  async cargarCero() {
    this.cargandoCero = true;
    try {
      const r = await this.api?.alertsZeroSales?.({ dias: 30 });
      this.ventasCero = r?.success ? (r.data || []) : [];
    } catch { this.ventasCero = []; } finally { this.cargandoCero = false; }
  }

  async exportarReorden(tipo: 'pdf' | 'excel') {
    if (!this.reorden.length) return;
    const cfg: ReportConfig = {
      titulo: 'Lista de reorden',
      subtitulo: `Productos que se acaban en ${this.diasAlerta} días o menos`,
      columns: [
        { header: 'Producto', key: 'nombre', width: 34 },
        { header: 'Stock', key: 'stock', width: 10, align: 'right' },
        { header: 'Vende/día', key: 'prom_diario', width: 12, align: 'right' },
        { header: 'Días restantes', key: 'dias_restantes', width: 14, align: 'right' },
        { header: 'Pedir', key: 'sugerido', width: 10, align: 'right' },
      ],
      rows: this.reorden,
      filename: 'reorden'
    };
    try {
      if (tipo === 'excel') await this.reports.exportExcel(cfg);
      else await this.reports.exportPdf(cfg);
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error al exportar', text: e?.message || 'No se pudo generar el archivo.' });
    }
  }
}
