import { ChangeDetectorRef, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { CatalogService } from '../core';
import { WxOpcion, WxSelectComponent } from '../app/wx-select/wx-select.component';
import { WxMultiSelectComponent } from '../app/wx-multi-select/wx-multi-select.component';

/*
 * FIDELIZACIÓN > CLUB (0063).
 *
 * Membresías de cobro mensual con un beneficio al día. Aquí solo se
 * configura y se revisa: afiliar, renovar y dar el beneficio pasan en la
 * caja, como una venta (sp_register_sale -> sp_membership_apply_sale).
 *
 * Los «canjes dobles» son el precio de dejar canjear sin conexión: dos
 * sucursales dieron el café del mismo día antes de enterarse una de otra. No
 * se anulan solos; alguien los revisa y deja una nota.
 */

interface PlanAdmin {
  id: number; uuid: string; name: string; sale_product_id: number | null; sale_product_name: string | null; price: number | null;
  period_days: number; daily_limit: number; grace_days: number; active: boolean; origin: 'LOCAL' | 'REMOTE';
  socios_activos: number; productos: { id: number; nombre: string }[];
}
interface Socio {
  id: number; customer_id: number; cliente: string; telefono: string | null; plan_name: string; paid_until: string | null;
  origin: string; estado: 'ACTIVA' | 'POR_VENCER' | 'VENCIDA' | 'CANCELADA'; beneficios_mes: number; ultimo_canje: string | null;
}
interface Doble {
  id: number; redeem_date: string; created_at: string; units: number; product_name: string; origin: string; sucursal: string;
  sale_id: number | null; cliente: string; plan_name: string; reviewed_at: string | null; revisado_por: string | null; review_note: string | null;
}
interface Resumen {
  activos: number; por_vencer: number; vencidas: number; ingreso_mes: number; pagos_mes: number;
  beneficios_mes: number; costo_beneficios_mes: number; dobles_pendientes: number;
}
interface DraftPlan {
  id: number | null; nombre: string; productoCobro: number | null; dias: number; limiteDiario: number; gracia: number;
  activo: boolean; productos: string[];
}

@Component({
  selector: 'app-club-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, WxSelectComponent, WxMultiSelectComponent],
  styleUrls: ['./loyalty-admin.css', './fidelizacion-a.css'],
  template: `
  <div class="fa" data-guide="club-admin">
    <p class="loy-error" *ngIf="error() as e"><i class="ph ph-warning-circle"></i> {{ e }}</p>

    <!-- Indicadores -->
    <section class="fa-kpis" *ngIf="resumen() as k" aria-label="Indicadores del Club">
      <article class="fa-kpi">
        <span class="fa-k">Socios activos</span>
        <strong class="fa-v">{{ k.activos }}</strong>
        <span class="fa-n">{{ k.por_vencer }} vencen esta semana · {{ k.vencidas }} vencidas</span>
      </article>
      <article class="fa-kpi">
        <span class="fa-k">Cobrado este mes</span>
        <strong class="fa-v">{{ k.ingreso_mes | currency:'MXN':'symbol-narrow':'1.0-0' }}</strong>
        <span class="fa-n">{{ k.pagos_mes }} {{ k.pagos_mes === 1 ? 'pago' : 'pagos' }} de membresía</span>
      </article>
      <article class="fa-kpi">
        <span class="fa-k">Beneficios dados</span>
        <strong class="fa-v">{{ k.beneficios_mes }}</strong>
        <span class="fa-n">te costaron {{ k.costo_beneficios_mes | currency:'MXN':'symbol-narrow':'1.0-0' }}</span>
      </article>
      <article class="fa-kpi" [class.fa-kpi--ojo]="k.dobles_pendientes > 0">
        <span class="fa-k">Canjes dobles</span>
        <strong class="fa-v">{{ k.dobles_pendientes }}</strong>
        <span class="fa-n">por revisar</span>
      </article>
    </section>

    <div class="fa-cols">
      <div class="fa-main">
        <!-- Planes -->
        <section class="fa-card">
          <div class="fa-head">
            <h2>Planes</h2>
            <div class="fa-acts">
              <button class="btn-ghost btn-sm" type="button" *ngIf="nube()" (click)="sincronizar()" [disabled]="sincronizando()" data-guide="club-sincronizar">
                <i class="ph ph-arrows-clockwise"></i> {{ sincronizando() ? 'Sincronizando…' : 'Traer de otras sucursales' }}
              </button>
              <button class="btn-outline btn-sm" type="button" (click)="nuevoPlan()" data-guide="club-nuevo-plan"><i class="ph ph-plus"></i> Nuevo plan</button>
            </div>
          </div>
          <div class="fa-planes" *ngIf="planes().length; else sinPlanes">
            <button type="button" class="fa-plan" *ngFor="let p of planes()" (click)="editarPlan(p)"
                    [class.on]="plan()?.id === p.id" [class.off]="!p.active" [attr.data-guide-clave]="p.uuid" data-guide="club-plan">
              <span class="fa-plan__top"><strong>{{ p.name }}</strong>
                <span class="fa-chip" [class.ok]="p.active" [class.neu]="!p.active">{{ p.active ? 'Afiliando' : 'Pausado' }}</span></span>
              <span class="fa-plan__precio">{{ (p.price ?? 0) | currency:'MXN':'symbol-narrow':'1.0-2' }} <small>/ {{ p.period_days }} días</small></span>
              <span class="fa-plan__det">{{ p.daily_limit }} al día · {{ nombresProductos(p) }} · {{ p.grace_days ? p.grace_days + ' días de gracia' : 'sin gracia' }}</span>
              <span class="fa-plan__pie"><span class="fa-chip neu">{{ p.socios_activos }} {{ p.socios_activos === 1 ? 'socio' : 'socios' }}</span>
                <span class="fa-chip cy" *ngIf="plan()?.id === p.id">Editando</span>
                <span class="fa-chip neu" *ngIf="p.origin === 'REMOTE'">De otra sucursal</span></span>
            </button>
          </div>
          <ng-template #sinPlanes>
            <div class="loy-vacio" *ngIf="!cargando()">
              <i class="ph ph-coffee"></i>
              <h3>Todavía no hay planes</h3>
              <p>Crea un producto de servicio («Membresía mensual») y después un plan que diga qué se regala cada día.</p>
            </div>
          </ng-template>
        </section>

        <!-- Canjes dobles -->
        <section class="fa-card fa-card--ojo" *ngIf="dobles().length">
          <div class="fa-head"><h2>Canjes dobles <span class="fa-chip ojo">{{ resumen()?.dobles_pendientes ?? 0 }} por revisar</span></h2></div>
          <p class="fa-sub">Se dio el beneficio dos veces el mismo día en sucursales sin conexión. Las dos ventas quedan; revisa y anota qué pasó.</p>
          <div class="fa-tabla">
            <table>
              <thead><tr><th>Cliente</th><th>Cuándo</th><th>Dónde</th><th>Producto</th><th>Revisión</th><th></th></tr></thead>
              <tbody>
                <tr *ngFor="let r of dobles()" [class.apagada]="!!r.reviewed_at" data-guide="club-doble" [attr.data-guide-clave]="r.id">
                  <td><strong>{{ r.cliente }}</strong><small>{{ r.plan_name }}</small></td>
                  <td>{{ r.created_at | date:'d MMM HH:mm':'UTC':'es-MX' }}</td>
                  <td>{{ r.sucursal }}</td>
                  <td>{{ r.units }} × {{ r.product_name }}<small *ngIf="r.sale_id">Venta #{{ r.sale_id }}</small></td>
                  <td><ng-container *ngIf="r.reviewed_at; else pendiente">{{ r.revisado_por || 'Revisado' }}<small>{{ r.review_note }}</small></ng-container>
                      <ng-template #pendiente><span class="fa-chip ojo">Pendiente</span></ng-template></td>
                  <td class="fa-der"><button *ngIf="!r.reviewed_at" class="btn-ghost btn-sm" type="button" (click)="revisar(r)">Revisar</button></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- Socios -->
        <section class="fa-card fa-card--tabla">
          <div class="fa-head fa-head--pad">
            <h2>Socios</h2>
            <div class="fa-acts">
              <div class="fa-seg" role="group" aria-label="Filtrar socios">
                <button type="button" *ngFor="let o of segmentos()" [class.on]="estado === o.valor" (click)="filtrar(o.valor)">
                  {{ o.etiqueta }}<span *ngIf="o.n != null"> {{ o.n }}</span>
                </button>
              </div>
              <label class="fa-buscar"><span class="fa-sr">Buscar socio</span>
                <input class="ctl" type="search" placeholder="Nombre o teléfono" [(ngModel)]="buscar" (keyup.enter)="cargar()" (search)="cargar()" data-guide="club-buscar"></label>
            </div>
          </div>
          <div class="fa-tabla" *ngIf="socios().length; else sinSocios">
            <table>
              <thead><tr><th>Cliente</th><th>Plan</th><th>Estado</th><th>Pagado hasta</th><th class="fa-der">Este mes</th><th></th></tr></thead>
              <tbody>
                <tr *ngFor="let s of socios()" [class.apagada]="s.estado === 'CANCELADA'" data-guide="club-socio" [attr.data-guide-clave]="s.id" [attr.data-guide-estado]="s.estado">
                  <td><strong>{{ s.cliente }}</strong><small>{{ s.telefono || 'Sin teléfono' }}</small></td>
                  <td>{{ s.plan_name }}</td>
                  <td><span class="fa-chip" [class.ok]="s.estado === 'ACTIVA'" [class.ojo]="s.estado === 'POR_VENCER'" [class.mal]="s.estado === 'VENCIDA'" [class.neu]="s.estado === 'CANCELADA'">{{ etiquetaEstado[s.estado] }}</span></td>
                  <td class="fa-num">{{ s.paid_until ? (s.paid_until | date:'d MMM':'UTC':'es-MX') : '—' }}</td>
                  <td class="fa-num fa-der">{{ s.beneficios_mes }}</td>
                  <td class="fa-der"><button *ngIf="s.estado !== 'CANCELADA'" class="btn-ghost btn-sm" type="button" (click)="cancelar(s)">Cancelar</button></td>
                </tr>
              </tbody>
            </table>
          </div>
          <ng-template #sinSocios>
            <p class="loy-hint fa-pad" *ngIf="!cargando()">{{ buscar || estado ? 'Nadie coincide con la búsqueda.' : 'Aún no hay socios. Se afilian en caja, al elegir al cliente.' }}</p>
          </ng-template>
        </section>
      </div>

      <!-- Editor del plan -->
      <aside class="fa-card fa-editor" *ngIf="plan() as d" aria-label="Editar plan">
        <form (ngSubmit)="guardarPlan()" data-guide="club-plan-form">
          <div class="fa-head"><h2>{{ d.id ? d.nombre || 'Plan' : 'Nuevo plan' }}</h2><span class="fa-chip cy">{{ d.id ? 'Editando' : 'Nuevo' }}</span></div>

          <fieldset>
            <legend class="fa-k">1 · Qué cobras</legend>
            <label class="loy-f"><span>Nombre del plan</span>
              <input class="ctl" type="text" [(ngModel)]="d.nombre" name="cNom" maxlength="80" placeholder="Club del café"></label>
            <label class="loy-f"><span>Producto con el que se cobra</span>
              <wx-select [opciones]="productosCobro()" [(ngModel)]="d.productoCobro" name="cProd" [buscable]="true" placeholder="Elegir producto"></wx-select></label>
            <div class="loy-f"><span class="loy-f__lbl">Cada pago cubre</span>
              <div class="fa-opc">
                <button type="button" *ngFor="let n of [15, 30]" [class.on]="d.dias === n" (click)="d.dias = n">{{ n }} días</button>
                <label class="fa-otro" [class.on]="d.dias !== 15 && d.dias !== 30"><span class="fa-sr">Otro número de días</span>
                  <input type="number" min="1" max="366" [(ngModel)]="d.dias" name="cDias"> días</label>
              </div>
            </div>
          </fieldset>

          <fieldset>
            <legend class="fa-k">2 · Qué recibe</legend>
            <div class="fa-frase">Al día:
              <span class="fa-step"><button type="button" aria-label="Menos" (click)="d.limiteDiario = max(1, d.limiteDiario - 1)">−</button>
                <input type="number" min="1" max="20" [(ngModel)]="d.limiteDiario" name="cLim" aria-label="Beneficios por día">
                <button type="button" aria-label="Más" (click)="d.limiteDiario = min(20, d.limiteDiario + 1)">+</button></span>
              de cualquiera de estos:</div>
            <wx-multi-select etiqueta="Productos del beneficio" placeholder="Agregar producto" [opciones]="productosBeneficio()" [(values)]="d.productos"></wx-multi-select>
          </fieldset>

          <fieldset>
            <legend class="fa-k">3 · Si se atrasa</legend>
            <div class="fa-frase">Le sigues dando el beneficio
              <span class="fa-step"><button type="button" aria-label="Menos" (click)="d.gracia = max(0, d.gracia - 1)">−</button>
                <input type="number" min="0" max="30" [(ngModel)]="d.gracia" name="cGra" aria-label="Días de gracia">
                <button type="button" aria-label="Más" (click)="d.gracia = min(30, d.gracia + 1)">+</button></span>
              días</div>
            <label class="loy-check"><input type="checkbox" [(ngModel)]="d.activo" name="cAct"><span>Se puede afiliar en caja</span></label>
          </fieldset>

          <div class="fa-preview" aria-label="Vista de la caja">
            <span class="fa-k">Así lo ve la caja</span>
            <div class="fa-preview__caja">
              <span class="fa-preview__cab"><span class="fa-chip ok">{{ d.nombre || 'Tu plan' }}</span><small>hasta {{ hasta(d) | date:'d MMM':'':'es-MX' }}</small></span>
              <span class="fa-preview__btn"><i class="ph ph-coffee" aria-hidden="true"></i> Dar {{ beneficio(d) }} de hoy</span>
            </div>
            <small>{{ resumenPlan(d) }}</small>
          </div>

          <p class="loy-nota loy-nota--mal" *ngIf="problema() as e"><i class="ph ph-warning-circle"></i> {{ e }}</p>
          <div class="fa-pie">
            <button class="btn-ghost" type="button" (click)="plan.set(null)">Cancelar</button>
            <button class="btn-primary" type="submit" [disabled]="guardando()"><i class="ph ph-check"></i> Guardar plan</button>
          </div>
        </form>
      </aside>
    </div>
  </div>`,
})
export class ClubAdmin implements OnInit {
  private readonly catalog = inject(CatalogService);
  private readonly cd = inject(ChangeDetectorRef);
  private get api() { return (window as any).electronAPI; }

  readonly resumen = signal<Resumen | null>(null);
  readonly planes = signal<PlanAdmin[]>([]);
  readonly socios = signal<Socio[]>([]);
  readonly dobles = signal<Doble[]>([]);
  readonly nube = signal(false);
  readonly cargando = signal(false);
  readonly guardando = signal(false);
  readonly sincronizando = signal(false);
  readonly error = signal<string | null>(null);
  readonly problema = signal<string | null>(null);
  readonly plan = signal<DraftPlan | null>(null);

  buscar = '';
  estado: string | null = null;
  readonly max = Math.max;
  readonly min = Math.min;
  /** Los filtros de socios, con su cuenta cuando el resumen la tiene. */
  readonly segmentos = computed(() => {
    const k = this.resumen();
    return [
      { valor: null as string | null, etiqueta: 'Todos', n: null as number | null },
      { valor: 'ACTIVA', etiqueta: 'Activas', n: k ? k.activos : null },
      { valor: 'POR_VENCER', etiqueta: 'Por vencer', n: k ? k.por_vencer : null },
      { valor: 'VENCIDA', etiqueta: 'Vencidas', n: k ? k.vencidas : null },
      { valor: 'CANCELADA', etiqueta: 'Canceladas', n: null },
    ];
  });
  readonly etiquetaEstado: Record<Socio['estado'], string> = { ACTIVA: 'Activa', POR_VENCER: 'Por vencer', VENCIDA: 'Vencida', CANCELADA: 'Cancelada' };

  /* El cobro es un servicio: un pago no descuenta inventario. */
  readonly productosCobro = computed<WxOpcion[]>(() =>
    this.catalog.vendibles().filter(p => (p.inventory_mode ?? 'NONE') === 'NONE')
      .map(p => ({ valor: p.id, etiqueta: p.product_name, nota: '$' + Number(p.price).toFixed(2) })));
  readonly productosBeneficio = computed<WxOpcion[]>(() =>
    this.catalog.vendibles().map(p => ({ valor: String(p.id), etiqueta: p.product_name, nota: '$' + Number(p.price).toFixed(2) })));

  async ngOnInit(): Promise<void> {
    await Promise.all([this.cargar(), this.catalog.load()]);
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const r = await this.api?.clubAdmin?.({ buscar: this.buscar.trim() || null, estado: this.estado });
      if (!r?.success) throw Error(r?.error || 'No se pudo leer el Club.');
      this.resumen.set(r.data.resumen);
      this.planes.set(r.data.planes);
      this.socios.set(r.data.socios);
      this.dobles.set(r.data.dobles);
      this.nube.set(!!r.data.nube);
      this.error.set(null);
    } catch (e: any) {
      this.error.set(e?.message || 'Error.');
    } finally {
      this.cargando.set(false);
      this.cd.detectChanges();
    }
  }

  filtrar(e: string | null): void {
    this.estado = e;
    void this.cargar();
  }

  /** Lo que el cajero leerá en el botón: el producto si es uno solo, «café» si son varios. */
  beneficio(d: DraftPlan): string {
    if (d.productos.length !== 1) return 'café';
    return this.catalog.vendibles().find(p => String(p.id) === d.productos[0])?.product_name ?? 'beneficio';
  }
  /** Hasta cuándo quedaría pagado si se afilia hoy. */
  hasta(d: DraftPlan): Date {
    const h = new Date();
    h.setDate(h.getDate() + Math.max(1, Number(d.dias) || 30) - 1);
    return h;
  }
  resumenPlan(d: DraftPlan): string {
    const prod = this.catalog.vendibles().find(p => p.id === d.productoCobro);
    const precio = prod ? '$' + Number(prod.price).toFixed(0) : 'el precio del producto';
    return `Paga ${precio} cada ${d.dias} días y recibe ${d.limiteDiario} al día${d.gracia ? ', con ' + d.gracia + ' días de gracia' : ''}.`;
  }

  nombresProductos(p: PlanAdmin): string {
    return p.productos.map(x => x.nombre).join(', ') || 'Sin productos';
  }

  nuevoPlan(): void {
    this.problema.set(null);
    this.plan.set({ id: null, nombre: '', productoCobro: null, dias: 30, limiteDiario: 1, gracia: 3, activo: true, productos: [] });
  }

  editarPlan(p: PlanAdmin): void {
    this.problema.set(null);
    this.plan.set({ id: p.id, nombre: p.name, productoCobro: p.sale_product_id, dias: p.period_days, limiteDiario: p.daily_limit,
                    gracia: p.grace_days, activo: !!p.active, productos: p.productos.map(x => String(x.id)) });
  }

  async guardarPlan(): Promise<void> {
    const d = this.plan();
    if (!d) return;
    if (!d.nombre.trim()) return this.problema.set('Ponle nombre al plan.');
    if (!d.productoCobro) return this.problema.set('Elige el producto con el que se cobra.');
    if (!d.productos.length) return this.problema.set('Elige al menos un producto del beneficio.');
    this.guardando.set(true);
    try {
      const r = await this.api.clubPlanGuardar({ ...d, nombre: d.nombre.trim(), productos: d.productos.map(Number) });
      if (!r?.success) throw Error(r?.error || 'No se pudo guardar.');
      this.plan.set(null);
      await this.cargar();
    } catch (e: any) {
      this.problema.set(e?.message || 'Error.');
    } finally {
      this.guardando.set(false);
      this.cd.detectChanges();
    }
  }

  async cancelar(s: Socio): Promise<void> {
    const conf = await Swal.fire({
      icon: 'question',
      title: `¿Cancelar la membresía de ${s.cliente}?`,
      text: 'Deja de recibir el beneficio. Lo ya pagado no se devuelve desde aquí; para eso, devuelve la venta.',
      showCancelButton: true, confirmButtonText: 'Cancelar membresía', cancelButtonText: 'Volver',
    });
    if (conf.isConfirmed) await this.gestionar('CANCELAR', s.id, null);
  }

  async revisar(r: Doble): Promise<void> {
    const res = await Swal.fire({
      title: 'Revisar canje doble',
      text: `${r.cliente} recibió el beneficio dos veces el ${r.redeem_date.slice(0, 10)}.`,
      input: 'text', inputPlaceholder: 'Qué pasó (opcional)', inputAttributes: { maxlength: '200' },
      showCancelButton: true, confirmButtonText: 'Marcar revisado', cancelButtonText: 'Volver',
    });
    if (res.isConfirmed) await this.gestionar('REVISAR', r.id, String(res.value ?? '').trim() || null);
  }

  private async gestionar(accion: 'CANCELAR' | 'REVISAR', id: number, nota: string | null): Promise<void> {
    const r = await this.api.clubGestionar({ accion, id, nota });
    if (!r?.success) {
      await Swal.fire({ icon: 'error', title: 'No se pudo', text: r?.error || 'Error.' });
      return;
    }
    await this.cargar();
  }

  async sincronizar(): Promise<void> {
    this.sincronizando.set(true);
    try {
      const r = await this.api.clubSincronizar();
      if (!r?.success) throw Error(r?.error || 'No se pudo sincronizar.');
      await this.cargar();
    } catch (e: any) {
      this.error.set(e?.message || 'Error.');
    } finally {
      this.sincronizando.set(false);
      this.cd.detectChanges();
    }
  }
}
