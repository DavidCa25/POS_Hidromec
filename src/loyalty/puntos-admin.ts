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
  styleUrls: ['./loyalty-admin.css', './fidelizacion-a.css'],
  template: `
  <div class="fa" data-guide="puntos-admin">
    <p class="loy-error" *ngIf="error() as e"><i class="ph ph-warning-circle"></i> {{ e }}</p>

    <section class="fa-kpis" *ngIf="resumen() as k" aria-label="Indicadores de puntos y sellos">
      <article class="fa-kpi">
        <span class="fa-k">Puntos vigentes</span>
        <strong class="fa-v">{{ k.vigentes | number }}</strong>
        <span class="fa-n">lo que le debes a {{ k.clientes_con_saldo }} {{ k.clientes_con_saldo === 1 ? 'cliente' : 'clientes' }}</span>
      </article>
      <article class="fa-kpi">
        <span class="fa-k">Dados este mes</span>
        <strong class="fa-v">{{ k.dados_mes | number }}</strong>
        <span class="fa-n">{{ k.canjeados_mes | number }} canjeados</span>
      </article>
      <article class="fa-kpi">
        <span class="fa-k">Sellos este mes</span>
        <strong class="fa-v">{{ k.sellos_mes | number }}</strong>
        <span class="fa-n">{{ k.tarjetas_mes }} {{ k.tarjetas_mes === 1 ? 'tarjeta llena canjeada' : 'tarjetas llenas canjeadas' }}</span>
      </article>
      <article class="fa-kpi">
        <span class="fa-k">Regalado por canjes</span>
        <strong class="fa-v">{{ k.descuento_mes | currency:'MXN':'symbol-narrow':'1.0-0' }}</strong>
        <span class="fa-n">este mes, a precio de lista</span>
      </article>
    </section>

    <div class="fa-cols">
      <div class="fa-main">
        <div class="fa-dos">
          <!-- Cómo se ganan -->
          <form class="fa-card" *ngIf="cfg as c" (ngSubmit)="guardarConfig()" data-guide="puntos-config">
            <div class="fa-head">
              <h2>Cómo se ganan</h2>
              <label class="fa-interruptor"><input type="checkbox" [(ngModel)]="c.enabled" name="pAct"><span>{{ c.enabled ? 'Encendido' : 'Apagado' }}</span></label>
            </div>
            <div class="fa-reglas" [class.apagada]="!c.enabled">
              <div class="fa-frase">
                <span class="fa-step"><button type="button" aria-label="Menos puntos" (click)="c.points_per = max(1, c.points_per - 1)">−</button>
                  <input type="number" min="1" [(ngModel)]="c.points_per" name="pPor" aria-label="Puntos">
                  <button type="button" aria-label="Más puntos" (click)="c.points_per = c.points_per + 1">+</button></span>
                {{ c.points_per === 1 ? 'punto' : 'puntos' }} por cada
                <span class="fa-step fa-step--precio"><input type="number" min="0" step="1" [(ngModel)]="c.per_amount" name="pCada" aria-label="Pesos de compra" placeholder="—"></span>
                de compra
              </div>
              <div class="fa-frase">+
                <span class="fa-step"><button type="button" aria-label="Menos" (click)="c.visit_points = max(0, c.visit_points - 1)">−</button>
                  <input type="number" min="0" [(ngModel)]="c.visit_points" name="pVis" aria-label="Puntos por visita">
                  <button type="button" aria-label="Más" (click)="c.visit_points = c.visit_points + 1">+</button></span>
                por visita, una vez al día
              </div>
              <div class="fa-frase">Caducan si no compra en
                <span class="fa-step"><input type="number" min="1" max="120" [(ngModel)]="c.expiry_months" name="pCad" aria-label="Meses para caducar" placeholder="—"></span>
                {{ c.expiry_months ? 'meses' : 'meses (vacío: no caducan)' }}
              </div>
            </div>
            <p class="fa-ejemplo" *ngIf="c.enabled"><span class="fa-chip cy">Ejemplo</span> {{ ejemplo() }}</p>
            <p class="loy-nota loy-nota--mal" *ngIf="problemaConfig() as e"><i class="ph ph-warning-circle"></i> {{ e }}</p>
            <div class="fa-pie"><button class="btn-primary" type="submit" [disabled]="guardando()"><i class="ph ph-check"></i> Guardar</button></div>
          </form>

          <!-- Qué se canjea -->
          <section class="fa-card">
            <div class="fa-head"><h2>Qué se canjea</h2></div>
            <ul class="fa-canjes" *ngIf="recompensas().length; else sinRecompensas">
              <li class="fa-canje" *ngFor="let r of recompensas()" [class.sin]="!r.points_cost" data-guide="puntos-recompensa" [attr.data-guide-clave]="r.id">
                <label class="fa-costo" [class.sin]="!costos[r.id]"><span class="fa-sr">Costo en puntos de {{ r.name }}</span>
                  <input type="number" min="1" [(ngModel)]="costos[r.id]" [name]="'cst' + r.id" placeholder="—"><span>pts</span></label>
                <span class="fa-canje__tx"><strong>{{ r.name }}</strong><small>{{ queDa(r) }}{{ r.points_cost ? '' : ' · no está a la venta con puntos' }}</small></span>
                <button *ngIf="(costos[r.id] ?? null) !== (r.points_cost ?? null)" class="btn-outline btn-sm" type="button" (click)="guardarCosto(r)">Guardar</button>
                <small *ngIf="(costos[r.id] ?? null) === (r.points_cost ?? null)" class="fa-n">{{ r.canjes }} {{ r.canjes === 1 ? 'canje' : 'canjes' }}</small>
              </li>
            </ul>
            <ng-template #sinRecompensas><p class="fa-sub">Aún no hay recompensas de producto, monto o porcentaje.</p></ng-template>
            <p class="fa-sub" style="margin-top: 10px;">Ponle costo para que la caja la ofrezca. Las recompensas se crean en <b>Recompensas</b>.</p>
          </section>
        </div>

        <!-- Tarjetas de sellos -->
        <section class="fa-card">
          <div class="fa-head"><h2>Tarjetas de sellos</h2>
            <button class="btn-outline btn-sm" type="button" (click)="nuevaTarjeta()" data-guide="sellos-nueva"><i class="ph ph-plus"></i> Nueva tarjeta</button></div>
          <div class="fa-sellos">
            <article class="fa-sello" *ngFor="let t of tarjetas()" [class.off]="!t.active" [attr.data-guide-clave]="t.uuid">
              <div class="fa-sello__cab"><strong>{{ t.name }}</strong>
                <span class="fa-chip" [class.ok]="t.active" [class.neu]="!t.active">{{ t.active ? 'Activa' : 'Pausada' }}</span></div>
              <div class="fa-sello__puntos" [attr.aria-label]="t.stamps_required + ' sellos y el regalo'">
                <i *ngFor="let n of rango(t.stamps_required)"></i><i class="premio"></i>
              </div>
              <small>Sellan {{ nombres(t.productos) }} · regalo: {{ t.reward_product_name || 'cualquiera de la tarjeta' }}</small>
              <div class="fa-sello__cab"><small>{{ t.clientes }} {{ t.clientes === 1 ? 'cliente' : 'clientes' }} con sellos{{ t.origin === 'REMOTE' ? ' · de otra sucursal' : '' }}</small>
                <button class="btn-ghost btn-sm" type="button" (click)="editarTarjeta(t)"><i class="ph ph-pencil-simple"></i> Editar</button></div>
            </article>
            <button type="button" class="fa-sello--nuevo" (click)="nuevaTarjeta()"><i class="ph ph-plus"></i> Crear tarjeta de sellos</button>
          </div>
        </section>

        <!-- Clientes -->
        <section class="fa-card fa-card--tabla">
          <div class="fa-head fa-head--pad"><h2>Clientes</h2>
            <label class="fa-buscar"><span class="fa-sr">Buscar cliente</span>
              <input class="ctl" type="search" placeholder="Nombre o teléfono" [(ngModel)]="buscar" (keyup.enter)="cargar()" (search)="cargar()" data-guide="puntos-buscar"></label></div>
          <div class="fa-tabla" *ngIf="clientes().length; else sinClientes">
            <table>
              <thead><tr><th>Cliente</th><th class="fa-der">Puntos</th><th>Sellos</th><th>Último movimiento</th><th></th></tr></thead>
              <tbody>
                <ng-container *ngFor="let c of clientes()">
                  <tr data-guide="puntos-cliente" [attr.data-guide-clave]="c.id" [class.abierta]="abierto()?.id === c.id">
                    <td><strong>{{ c.cliente }}</strong><small>{{ c.telefono || 'Sin teléfono' }}</small></td>
                    <td class="fa-num fa-der" [class.neg]="c.puntos < 0"><strong>{{ c.puntos | number }}</strong></td>
                    <td><span *ngFor="let s of c.sellos; let last = last">{{ s.tarjeta }} <span class="fa-num">{{ s.sellos }}/{{ s.requeridos }}</span>
                      <span class="fa-chip ok" *ngIf="s.sellos >= s.requeridos">llena</span>{{ last ? '' : ' · ' }}</span></td>
                    <td>{{ c.ultimo | date:'d MMM y, HH:mm':'UTC':'es-MX' }}</td>
                    <td class="fa-der"><button class="btn-ghost btn-sm" type="button" (click)="abrir(c)">{{ abierto()?.id === c.id ? 'Cerrar' : 'Historial' }}</button></td>
                  </tr>
                  <tr *ngIf="abierto()?.id === c.id" class="abierta">
                    <td colspan="5">
                      <form class="fa-ajuste" (ngSubmit)="ajustar(c)" data-guide="puntos-ajuste">
                        <wx-select [opciones]="opcPrograma()" [(ngModel)]="ajuste.programa" name="aPro"></wx-select>
                        <input class="ctl" type="number" [(ngModel)]="ajuste.cantidad" name="aCan" placeholder="+10 o −10" aria-label="Cantidad">
                        <input class="ctl" type="text" [(ngModel)]="ajuste.nota" name="aNot" maxlength="200" placeholder="Motivo (obligatorio)" aria-label="Motivo">
                        <button class="btn-outline btn-sm" type="submit" [disabled]="guardando()">Ajustar</button>
                      </form>
                      <p class="loy-nota loy-nota--mal" *ngIf="problemaAjuste() as e"><i class="ph ph-warning-circle"></i> {{ e }}</p>
                      <ol class="fa-hist pts-hist">
                        <li *ngFor="let m of historial()">
                          <span><strong>{{ describir(m) }}</strong><small>{{ m.created_at | date:'d MMM, HH:mm':'UTC':'es-MX' }} · {{ m.program === 'POINTS' ? 'Puntos' : m.tarjeta }}{{ m.note ? ' · ' + m.note : '' }}</small></span>
                          <span class="fa-num" [class.mas]="m.delta > 0" [class.menos]="m.delta < 0">{{ m.delta > 0 ? '+' : '−' }}{{ abs(m.delta) }}</span>
                        </li>
                      </ol>
                    </td>
                  </tr>
                </ng-container>
              </tbody>
            </table>
          </div>
          <ng-template #sinClientes>
            <p class="loy-hint fa-pad" *ngIf="!cargando()">{{ buscar ? 'Nadie coincide.' : 'Aún nadie tiene puntos ni sellos.' }}</p>
          </ng-template>
        </section>
      </div>

      <!-- Editor de tarjeta -->
      <aside class="fa-card fa-editor" *ngIf="tarjeta() as d" aria-label="Editar tarjeta de sellos">
        <form (ngSubmit)="guardarTarjeta()" data-guide="sellos-form">
          <div class="fa-head"><h2>{{ d.id ? d.nombre || 'Tarjeta' : 'Nueva tarjeta' }}</h2><span class="fa-chip cy">{{ d.id ? 'Editando' : 'Nueva' }}</span></div>
          <fieldset>
            <legend class="fa-k">1 · La tarjeta</legend>
            <label class="loy-f"><span>Nombre</span><input class="ctl" type="text" [(ngModel)]="d.nombre" name="tNom" maxlength="80" placeholder="Café 9 + 1"></label>
            <div class="fa-frase">Se llena con
              <span class="fa-step"><button type="button" aria-label="Menos" (click)="d.sellos = max(2, d.sellos - 1)">−</button>
                <input type="number" min="2" max="100" [(ngModel)]="d.sellos" name="tSel" aria-label="Sellos para llenarla">
                <button type="button" aria-label="Más" (click)="d.sellos = min(100, d.sellos + 1)">+</button></span>
              sellos</div>
          </fieldset>
          <fieldset>
            <legend class="fa-k">2 · Qué sella</legend>
            <wx-multi-select etiqueta="Productos que sellan" placeholder="Agregar producto" [opciones]="opcProductos()" [(values)]="d.productos"></wx-multi-select>
            <small class="fa-n">Un sello por unidad cobrada. Lo regalado en $0 no sella.</small>
          </fieldset>
          <fieldset>
            <legend class="fa-k">3 · Qué regala</legend>
            <wx-select [opciones]="opcPremio()" [(ngModel)]="d.productoPremio" name="tPre" [buscable]="true"></wx-select>
            <label class="loy-check"><input type="checkbox" [(ngModel)]="d.activo" name="tAct"><span>Activa</span></label>
          </fieldset>
          <div class="fa-preview" aria-label="Vista de la tarjeta">
            <span class="fa-k">Así la ve la caja</span>
            <div class="fa-preview__caja">
              <span class="fa-preview__cab"><strong>{{ d.nombre || 'Tu tarjeta' }}</strong><small>{{ d.sellos }}/{{ d.sellos }}</small></span>
              <div class="fa-sello__puntos"><i class="on" *ngFor="let n of rango(d.sellos)"></i></div>
              <span class="fa-preview__btn"><i class="ph ph-seal-check" aria-hidden="true"></i> Canjear {{ nombrePremio(d) }}</span>
            </div>
          </div>
          <p class="loy-nota loy-nota--mal" *ngIf="problemaTarjeta() as e"><i class="ph ph-warning-circle"></i> {{ e }}</p>
          <div class="fa-pie">
            <button class="btn-ghost" type="button" (click)="tarjeta.set(null)">Cancelar</button>
            <button class="btn-primary" type="submit" [disabled]="guardando()"><i class="ph ph-check"></i> Guardar tarjeta</button>
          </div>
        </form>
      </aside>
    </div>
  </div>`,
  styles: [`
    td.neg { color: var(--wx-danger); }
    .fa-reglas.apagada { opacity: .5; }
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
  readonly max = Math.max;
  readonly min = Math.min;
  readonly abs = Math.abs;
  rango(n: number): number[] { return Array.from({ length: Math.max(0, Math.min(Number(n) || 0, 30)) }, (_, i) => i); }
  nombrePremio(d: DraftTarjeta): string {
    if (d.productoPremio) return this.catalog.vendibles().find(p => p.id === d.productoPremio)?.product_name ?? 'el regalo';
    return 'el regalo';
  }
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
    const txt = partes.length ? partes.join(' y ').replace(/^u/, 'U') + '.' : 'Di cuánto se gana por compra, por visita o ambos.';
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

  /** De dónde viene un movimiento: su venta, otra sucursal o nada. */
  private donde(m: Movimiento & { location_name?: string | null }): string {
    if (m.sale_id) return ` · venta #${m.sale_id}`;
    if (m.origin === 'REMOTE') return ` · ${m.location_name || 'otra sucursal'}`;
    return '';
  }

  describir(m: Movimiento): string {
    switch (m.kind) {
      case 'EARN': return (m.reason === 'VISIT' ? 'Visita' : 'Compra') + this.donde(m);
      case 'REDEEM': return `Canje${m.recompensa ? ' · ' + m.recompensa : ''}` + this.donde(m);
      case 'REVERSE': return 'Devolución' + this.donde(m);
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
