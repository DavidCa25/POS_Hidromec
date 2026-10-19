import { ChangeDetectorRef, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CatalogService } from '../core';
import { WxOpcion, WxSelectComponent } from '../app/wx-select/wx-select.component';
import { WxMultiSelectComponent } from '../app/wx-multi-select/wx-multi-select.component';

/*
 * FIDELIZACIÓN > PUNTOS (0064).
 *
 * Lo acumulable: cómo se ganan los puntos, qué se canjea con ellos, las
 * tarjetas de sellos y el saldo de cada cliente. Ganar, canjear y revertir
 * pasan en la caja (la venta y la devolución); aquí se configura, se mira y,
 * con motivo, se ajusta.
 *
 * «Puntos vigentes» es lo que el negocio le debe a sus clientes: se enseña
 * arriba a propósito.
 */

interface Config { enabled: boolean; per_amount: number | null; points_per: number; visit_points: number; expiry_months: number | null; }
interface Resumen {
  dados_mes: number; canjeados_mes: number; vigentes: number; clientes_con_saldo: number;
  sellos_mes: number; tarjetas_mes: number; descuento_mes: number;
}
interface Tarjeta {
  id: number; uuid: string; name: string; stamps_required: number; reward_product_id: number | null; reward_product_name: string | null;
  active: boolean; origin: string; clientes: number; productos: { id: number; nombre: string }[];
}
interface Recompensa {
  id: number; name: string; kind: string; product_name: string | null; amount: number | null; discount_pct: number | null;
  points_cost: number | null; active: boolean; canjes: number;
}
interface Cliente { id: number; cliente: string; telefono: string | null; puntos: number; sellos: { tarjeta: string; requeridos: number; sellos: number }[]; ultimo: string; }
interface Movimiento {
  id: number; created_at: string; program: 'POINTS' | 'STAMPS'; tarjeta: string | null; delta: number; kind: string; reason: string | null;
  sale_id: number | null; refund_id: number | null; recompensa: string | null; amount: number | null; usuario: string | null; note: string | null; origin: string;
}
interface DraftTarjeta { id: number | null; nombre: string; sellos: number; productoPremio: number | null; activo: boolean; productos: string[]; }

@Component({
  selector: 'app-puntos-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, WxSelectComponent, WxMultiSelectComponent],
  styleUrls: ['./loyalty-admin.css'],
  template: `
  <div class="loy-sec" data-guide="puntos-admin">
    <div class="loy-sec__head">
      <div>
        <h2>Puntos y sellos</h2>
        <p class="loy-sub">El cliente junta al comprar y canjea en caja. Lo vigente es lo que el negocio le debe.</p>
      </div>
    </div>

    <p class="loy-error" *ngIf="error() as e"><i class="ph ph-warning-circle"></i> {{ e }}</p>

    <div class="loy-cards" *ngIf="resumen() as k">
      <article class="loy-card">
        <span class="loy-card__k">Puntos vigentes</span>
        <strong class="loy-card__v">{{ k.vigentes | number }}</strong>
        <span class="loy-card__n">{{ k.clientes_con_saldo }} {{ k.clientes_con_saldo === 1 ? 'cliente' : 'clientes' }} con saldo</span>
      </article>
      <article class="loy-card">
        <span class="loy-card__k">Dados este mes</span>
        <strong class="loy-card__v">{{ k.dados_mes | number }}</strong>
        <span class="loy-card__n">{{ k.canjeados_mes | number }} canjeados</span>
      </article>
      <article class="loy-card">
        <span class="loy-card__k">Sellos este mes</span>
        <strong class="loy-card__v">{{ k.sellos_mes | number }}</strong>
        <span class="loy-card__n">{{ k.tarjetas_mes }} {{ k.tarjetas_mes === 1 ? 'tarjeta canjeada' : 'tarjetas canjeadas' }}</span>
      </article>
      <article class="loy-card">
        <span class="loy-card__k">Descuento por canjes</span>
        <strong class="loy-card__v">{{ k.descuento_mes | currency:'MXN':'symbol-narrow':'1.0-0' }}</strong>
        <span class="loy-card__n">este mes, a precio de lista</span>
      </article>
    </div>

    <!-- ------------------------------------------------- cómo se ganan -->
    <h3 class="loy-h3">Cómo se ganan los puntos</h3>
    <form class="loy-form" *ngIf="cfg as c" (ngSubmit)="guardarConfig()" data-guide="puntos-config">
      <div class="loy-checks" style="margin-top:0">
        <label class="loy-check"><input type="checkbox" [(ngModel)]="c.enabled" name="pAct"><span>Dar puntos a los clientes</span></label>
      </div>
      <div class="loy-form__grid" *ngIf="c.enabled">
        <label class="loy-f">
          <span>Puntos</span>
          <input class="ctl" type="number" min="1" [(ngModel)]="c.points_per" name="pPor">
        </label>
        <label class="loy-f">
          <span>Por cada (pesos)</span>
          <input class="ctl" type="number" min="0" step="1" [(ngModel)]="c.per_amount" name="pCada" placeholder="Sin puntos por compra">
        </label>
        <label class="loy-f">
          <span>Por visita (una al día)</span>
          <input class="ctl" type="number" min="0" [(ngModel)]="c.visit_points" name="pVis">
        </label>
        <label class="loy-f">
          <span>Caducan tras (meses sin comprar)</span>
          <input class="ctl" type="number" min="1" max="120" [(ngModel)]="c.expiry_months" name="pCad" placeholder="No caducan">
        </label>
      </div>
      <p class="loy-nota" *ngIf="c.enabled">
        <i class="ph ph-info"></i> {{ ejemplo() }}
      </p>
      <p class="loy-nota loy-nota--mal" *ngIf="problemaConfig() as e"><i class="ph ph-warning-circle"></i> {{ e }}</p>
      <div class="btn-row">
        <button class="btn-primary" type="submit" [disabled]="guardando()"><i class="ph ph-check"></i> Guardar</button>
      </div>
    </form>

    <!-- --------------------------------------------- catálogo de canje -->
    <h3 class="loy-h3">Qué se canjea con puntos</h3>
    <p class="loy-sub">Ponle costo a una recompensa para que la caja la ofrezca. Las recompensas se crean en <b>Recompensas</b>.</p>
    <div class="loy-tabla" *ngIf="recompensas().length; else sinRecompensas">
      <table class="wx-tabla">
        <thead><tr><th>Recompensa</th><th>Qué da</th><th class="num">Costo (puntos)</th><th class="num">Canjes</th><th></th></tr></thead>
        <tbody>
          <tr *ngFor="let r of recompensas()" [class.apagada]="!r.points_cost" data-guide="puntos-recompensa" [attr.data-guide-clave]="r.id">
            <td>{{ r.name }}</td>
            <td>{{ queDa(r) }}</td>
            <td class="num"><input class="ctl loy-peso" type="number" min="1" [(ngModel)]="costos[r.id]" [name]="'cst' + r.id" placeholder="—"></td>
            <td class="num">{{ r.canjes }}</td>
            <td class="acciones">
              <button class="btn-ghost btn-sm" type="button" (click)="guardarCosto(r)" [disabled]="(costos[r.id] ?? null) === (r.points_cost ?? null)">Guardar</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <ng-template #sinRecompensas><p class="loy-hint">Aún no hay recompensas de producto, monto o porcentaje.</p></ng-template>

    <!-- --------------------------------------------- tarjetas de sellos -->
    <div class="loy-sec__head">
      <h3 class="loy-h3">Tarjetas de sellos</h3>
      <button class="btn-outline btn-sm" type="button" (click)="nuevaTarjeta()" data-guide="sellos-nueva"><i class="ph ph-plus"></i> Nueva tarjeta</button>
    </div>
    <form class="loy-form" *ngIf="tarjeta() as d" (ngSubmit)="guardarTarjeta()" data-guide="sellos-form">
      <div class="loy-form__grid">
        <label class="loy-f loy-f--wide">
          <span>Nombre</span>
          <input class="ctl" type="text" [(ngModel)]="d.nombre" name="tNom" maxlength="80" placeholder="Café 9 + 1">
        </label>
        <label class="loy-f">
          <span>Sellos para llenarla</span>
          <input class="ctl" type="number" min="2" max="100" [(ngModel)]="d.sellos" name="tSel">
        </label>
        <label class="loy-f">
          <span>Al llenarla se regala</span>
          <wx-select [opciones]="opcPremio()" [(ngModel)]="d.productoPremio" name="tPre" [buscable]="true"></wx-select>
        </label>
        <div class="loy-f loy-f--wide">
          <span class="loy-f__lbl">Productos que sellan</span>
          <wx-multi-select etiqueta="Productos que sellan" [opciones]="opcProductos()" [(values)]="d.productos"></wx-multi-select>
        </div>
      </div>
      <p class="loy-nota"><i class="ph ph-info"></i> Un sello por unidad cobrada. Lo regalado en $0 no sella.</p>
      <p class="loy-nota loy-nota--mal" *ngIf="problemaTarjeta() as e"><i class="ph ph-warning-circle"></i> {{ e }}</p>
      <div class="loy-checks"><label class="loy-check"><input type="checkbox" [(ngModel)]="d.activo" name="tAct"><span>Activa</span></label></div>
      <div class="btn-row">
        <button class="btn-primary" type="submit" [disabled]="guardando()"><i class="ph ph-check"></i> Guardar</button>
        <button class="btn-ghost" type="button" (click)="tarjeta.set(null)">Cancelar</button>
      </div>
    </form>
    <div class="loy-tabla" *ngIf="tarjetas().length; else sinTarjetas">
      <table class="wx-tabla">
        <thead><tr><th>Tarjeta</th><th>Sellan</th><th>Regalo</th><th class="num">Clientes</th><th></th></tr></thead>
        <tbody>
          <tr *ngFor="let t of tarjetas()" [class.apagada]="!t.active" [attr.data-guide-clave]="t.uuid">
            <td>{{ t.name }}<small>{{ t.stamps_required }} sellos{{ t.origin === 'REMOTE' ? ' · de otra sucursal' : '' }}</small></td>
            <td>{{ nombres(t.productos) }}</td>
            <td>{{ t.reward_product_name || 'Cualquiera de la tarjeta' }}</td>
            <td class="num">{{ t.clientes }}</td>
            <td class="acciones"><button class="btn-ghost btn-sm" type="button" (click)="editarTarjeta(t)"><i class="ph ph-pencil-simple"></i> Editar</button></td>
          </tr>
        </tbody>
      </table>
    </div>
    <ng-template #sinTarjetas><p class="loy-hint" *ngIf="!tarjeta()">Sin tarjetas. Ejemplo: «Café 9 + 1», 9 sellos, sellan los cafés.</p></ng-template>

    <!-- ------------------------------------------------------ clientes -->
    <h3 class="loy-h3">Clientes</h3>
    <div class="loy-filtros">
      <input class="ctl" type="search" placeholder="Nombre o teléfono" [(ngModel)]="buscar" (keyup.enter)="cargar()" (search)="cargar()" data-guide="puntos-buscar">
    </div>
    <div class="loy-tabla" *ngIf="clientes().length; else sinClientes">
      <table class="wx-tabla">
        <thead><tr><th>Cliente</th><th class="num">Puntos</th><th>Sellos</th><th>Último movimiento</th><th></th></tr></thead>
        <tbody>
          <ng-container *ngFor="let c of clientes()">
            <tr data-guide="puntos-cliente" [attr.data-guide-clave]="c.id">
              <td>{{ c.cliente }}<small>{{ c.telefono || 'Sin teléfono' }}</small></td>
              <td class="num" [class.neg]="c.puntos < 0">{{ c.puntos | number }}</td>
              <td><span *ngFor="let s of c.sellos; let last = last">{{ s.tarjeta }} {{ s.sellos }}/{{ s.requeridos }}{{ last ? '' : ' · ' }}</span></td>
              <td>{{ c.ultimo | date:'d MMM y HH:mm':'UTC':'es-MX' }}</td>
              <td class="acciones">
                <button class="btn-ghost btn-sm" type="button" (click)="abrir(c)">{{ abierto()?.id === c.id ? 'Cerrar' : 'Historial' }}</button>
              </td>
            </tr>
            <tr *ngIf="abierto()?.id === c.id" class="pts-detalle">
              <td colspan="5">
                <form class="pts-ajuste" (ngSubmit)="ajustar(c)" data-guide="puntos-ajuste">
                  <wx-select [opciones]="opcPrograma()" [(ngModel)]="ajuste.programa" name="aPro"></wx-select>
                  <input class="ctl" type="number" [(ngModel)]="ajuste.cantidad" name="aCan" placeholder="+10 o -10">
                  <input class="ctl" type="text" [(ngModel)]="ajuste.nota" name="aNot" maxlength="200" placeholder="Motivo (obligatorio)">
                  <button class="btn-outline btn-sm" type="submit" [disabled]="guardando()">Ajustar</button>
                </form>
                <p class="loy-nota loy-nota--mal" *ngIf="problemaAjuste() as e"><i class="ph ph-warning-circle"></i> {{ e }}</p>
                <table class="wx-tabla pts-hist">
                  <tbody>
                    <tr *ngFor="let m of historial()">
                      <td>{{ m.created_at | date:'d MMM y HH:mm':'UTC':'es-MX' }}</td>
                      <td>{{ describir(m) }}<small *ngIf="m.note">{{ m.note }}</small></td>
                      <td>{{ m.program === 'POINTS' ? 'Puntos' : m.tarjeta }}</td>
                      <td class="num" [class.neg]="m.delta < 0">{{ m.delta > 0 ? '+' : '' }}{{ m.delta }}</td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </ng-container>
        </tbody>
      </table>
    </div>
    <ng-template #sinClientes>
      <p class="loy-hint" *ngIf="!cargando()">{{ buscar ? 'Nadie coincide.' : 'Aún nadie tiene puntos ni sellos.' }}</p>
    </ng-template>
  </div>`,
  styles: [`
    .loy-tabla th.num, .loy-tabla td.num { padding-right: 18px; }
    td.neg { color: var(--wx-danger); }
    .pts-detalle > td { background: var(--wx-sunken); }
    .pts-ajuste { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 8px; }
    .pts-ajuste wx-select { min-width: 170px; }
    .pts-ajuste input[type=number] { width: 110px; }
    .pts-ajuste input[type=text] { flex: 1; min-width: 200px; }
    .pts-hist td { padding-top: 4px; padding-bottom: 4px; }
  `],
})
export class PuntosAdmin implements OnInit {
  private readonly catalog = inject(CatalogService);
  private readonly cd = inject(ChangeDetectorRef);
  private get api() { return (window as any).electronAPI; }

  cfg: Config | null = null;
  readonly resumen = signal<Resumen | null>(null);
  readonly tarjetas = signal<Tarjeta[]>([]);
  readonly recompensas = signal<Recompensa[]>([]);
  readonly clientes = signal<Cliente[]>([]);
  readonly historial = signal<Movimiento[]>([]);
  readonly abierto = signal<Cliente | null>(null);
  readonly tarjeta = signal<DraftTarjeta | null>(null);
  readonly cargando = signal(false);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  readonly problemaConfig = signal<string | null>(null);
  readonly problemaTarjeta = signal<string | null>(null);
  readonly problemaAjuste = signal<string | null>(null);
  costos: Record<number, number | null> = {};
  buscar = '';
  ajuste: { programa: string; cantidad: number | null; nota: string } = { programa: 'POINTS', cantidad: null, nota: '' };

  readonly opcProductos = computed<WxOpcion[]>(() =>
    this.catalog.vendibles().map(p => ({ valor: String(p.id), etiqueta: p.product_name, nota: '$' + Number(p.price).toFixed(2) })));
  readonly opcPremio = computed<WxOpcion[]>(() => [
    { valor: null, etiqueta: 'Cualquiera de la tarjeta' },
    ...this.catalog.vendibles().map(p => ({ valor: p.id, etiqueta: p.product_name, nota: '$' + Number(p.price).toFixed(2) })),
  ]);
  readonly opcPrograma = computed<WxOpcion[]>(() => [
    { valor: 'POINTS', etiqueta: 'Puntos' },
    ...this.tarjetas().filter(t => t.active).map(t => ({ valor: 'C' + t.id, etiqueta: 'Sellos · ' + t.name })),
  ]);

  async ngOnInit(): Promise<void> {
    await Promise.all([this.cargar(), this.catalog.load()]);
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const r = await this.api?.puntosAdmin?.({ buscar: this.buscar.trim() || null });
      if (!r?.success) throw Error(r?.error || 'No se pudieron leer los puntos.');
      const c = r.data.config;
      this.cfg = c ? { enabled: !!c.enabled, per_amount: c.per_amount != null ? Number(c.per_amount) : null, points_per: Number(c.points_per),
                       visit_points: Number(c.visit_points), expiry_months: c.expiry_months ?? null } : null;
      this.resumen.set(r.data.resumen);
      this.tarjetas.set(r.data.tarjetas);
      this.recompensas.set(r.data.recompensas);
      this.costos = Object.fromEntries(r.data.recompensas.map((x: Recompensa) => [x.id, x.points_cost]));
      this.clientes.set(r.data.clientes);
      this.error.set(null);
    } catch (e: any) {
      this.error.set(e?.message || 'Error.');
    } finally {
      this.cargando.set(false);
      this.cd.detectChanges();
    }
  }

  ejemplo(): string {
    const c = this.cfg;
    if (!c) return '';
    const partes: string[] = [];
    if (c.per_amount) {
      const en200 = Math.floor(200 / c.per_amount) * (c.points_per || 1);
      partes.push(`una compra de $200 da ${en200} ${en200 === 1 ? 'punto' : 'puntos'}`);
    }
    if (c.visit_points) partes.push(`la primera compra del día suma ${c.visit_points} más`);
    const txt = partes.length ? 'Ejemplo: ' + partes.join(' y ') + '.' : 'Di cuánto se gana por compra, por visita o ambos.';
    return txt + (c.expiry_months ? ` Caducan si el cliente no compra en ${c.expiry_months} ${c.expiry_months === 1 ? 'mes' : 'meses'}.` : '');
  }

  async guardarConfig(): Promise<void> {
    const c = this.cfg;
    if (!c) return;
    this.guardando.set(true);
    try {
      const r = await this.api.puntosConfigGuardar({ activo: c.enabled, cadaMonto: c.per_amount, puntos: c.points_per, porVisita: c.visit_points, caducaMeses: c.expiry_months });
      if (!r?.success) throw Error(r?.error || 'No se pudo guardar.');
      this.problemaConfig.set(null);
      await this.cargar();
    } catch (e: any) {
      this.problemaConfig.set(e?.message || 'Error.');
    } finally { this.guardando.set(false); this.cd.detectChanges(); }
  }

  queDa(r: Recompensa): string {
    if (r.kind === 'FREE_PRODUCT') return `${r.product_name || 'Producto'} gratis`;
    if (r.kind === 'AMOUNT') return `$${Number(r.amount ?? 0).toFixed(2)} de descuento`;
    return `${Number(r.discount_pct ?? 0)}% de descuento`;
  }

  async guardarCosto(r: Recompensa): Promise<void> {
    const v = this.costos[r.id];
    const res = await this.api.puntosCosto({ recompensaId: r.id, costo: v ? Number(v) : null });
    if (!res?.success) { this.error.set(res?.error || 'No se pudo guardar.'); this.cd.detectChanges(); return; }
    await this.cargar();
  }

  nombres(ps: { nombre: string }[]): string { return ps.map(p => p.nombre).join(', ') || '—'; }

  nuevaTarjeta(): void {
    this.problemaTarjeta.set(null);
    this.tarjeta.set({ id: null, nombre: '', sellos: 10, productoPremio: null, activo: true, productos: [] });
  }
  editarTarjeta(t: Tarjeta): void {
    this.problemaTarjeta.set(null);
    this.tarjeta.set({ id: t.id, nombre: t.name, sellos: t.stamps_required, productoPremio: t.reward_product_id, activo: !!t.active,
                       productos: t.productos.map(p => String(p.id)) });
  }
  async guardarTarjeta(): Promise<void> {
    const d = this.tarjeta();
    if (!d) return;
    if (!d.nombre.trim()) return this.problemaTarjeta.set('Ponle nombre a la tarjeta.');
    if (!d.productos.length) return this.problemaTarjeta.set('Elige qué productos sellan.');
    this.guardando.set(true);
    try {
      const r = await this.api.puntosTarjetaGuardar({ ...d, nombre: d.nombre.trim(), productos: d.productos.map(Number) });
      if (!r?.success) throw Error(r?.error || 'No se pudo guardar.');
      this.tarjeta.set(null);
      await this.cargar();
    } catch (e: any) {
      this.problemaTarjeta.set(e?.message || 'Error.');
    } finally { this.guardando.set(false); this.cd.detectChanges(); }
  }

  async abrir(c: Cliente): Promise<void> {
    if (this.abierto()?.id === c.id) { this.abierto.set(null); return; }
    this.abierto.set(c);
    this.historial.set([]);
    this.problemaAjuste.set(null);
    this.ajuste = { programa: 'POINTS', cantidad: null, nota: '' };
    const r = await this.api.puntosHistorial({ customerId: c.id });
    if (this.abierto()?.id !== c.id) return;
    this.historial.set(r?.success ? r.data : []);
    this.cd.detectChanges();
  }

  describir(m: Movimiento): string {
    switch (m.kind) {
      case 'EARN': return m.reason === 'VISIT' ? `Visita · venta #${m.sale_id}` : `Compra · venta #${m.sale_id}`;
      case 'REDEEM': return `Canje${m.recompensa ? ' · ' + m.recompensa : ''} · venta #${m.sale_id}`;
      case 'REVERSE': return `Devolución · venta #${m.sale_id}`;
      case 'EXPIRE': return 'Caducaron';
      case 'ADJUST': return `Ajuste${m.usuario ? ' de ' + m.usuario : ''}`;
      default: return m.kind;
    }
  }

  async ajustar(c: Cliente): Promise<void> {
    const a = this.ajuste;
    if (!a.cantidad) return this.problemaAjuste.set('Escribe cuánto sumar o restar.');
    if (!a.nota.trim()) return this.problemaAjuste.set('Escribe el motivo del ajuste.');
    this.guardando.set(true);
    try {
      const r = await this.api.puntosAjustar({ customerId: c.id, cantidad: a.cantidad, nota: a.nota.trim(),
                                               tarjetaId: a.programa.startsWith('C') ? Number(a.programa.slice(1)) : null });
      if (!r?.success) throw Error(r?.error || 'No se pudo ajustar.');
      const abierto = c.id;
      await this.cargar();
      const nuevo = this.clientes().find(x => x.id === abierto);
      this.abierto.set(null);
      if (nuevo) await this.abrir(nuevo);
    } catch (e: any) {
      this.problemaAjuste.set(e?.message || 'Error.');
    } finally { this.guardando.set(false); this.cd.detectChanges(); }
  }
}
