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
  styleUrls: ['./loyalty-admin.css'],
  template: `
  <div class="loy-sec" data-guide="club-admin">
    <div class="loy-sec__head">
      <div>
        <h2>Club</h2>
        <p class="loy-sub">Membresía de pago con un beneficio al día. Se afilia y se renueva cobrando en caja.</p>
      </div>
      <div class="loy-acciones-head">
        <button class="btn-ghost" type="button" *ngIf="nube()" (click)="sincronizar()" [disabled]="sincronizando()" data-guide="club-sincronizar">
          <i class="ph ph-arrows-clockwise"></i> {{ sincronizando() ? 'Sincronizando…' : 'Traer de otras sucursales' }}
        </button>
        <button class="btn-primary" type="button" (click)="nuevoPlan()" data-guide="club-nuevo-plan">
          <i class="ph ph-plus"></i> Nuevo plan
        </button>
      </div>
    </div>

    <p class="loy-error" *ngIf="error() as e"><i class="ph ph-warning-circle"></i> {{ e }}</p>

    <div class="loy-cards" *ngIf="resumen() as k">
      <article class="loy-card">
        <span class="loy-card__k">Socios activos</span>
        <strong class="loy-card__v">{{ k.activos }}</strong>
        <span class="loy-card__n">{{ k.por_vencer }} vencen en 7 días · {{ k.vencidas }} vencidas</span>
      </article>
      <article class="loy-card">
        <span class="loy-card__k">Cobrado este mes</span>
        <strong class="loy-card__v">{{ k.ingreso_mes | currency:'MXN':'symbol-narrow':'1.0-0' }}</strong>
        <span class="loy-card__n">{{ k.pagos_mes }} {{ k.pagos_mes === 1 ? 'pago' : 'pagos' }} de membresía</span>
      </article>
      <article class="loy-card">
        <span class="loy-card__k">Beneficios dados</span>
        <strong class="loy-card__v">{{ k.beneficios_mes }}</strong>
        <span class="loy-card__n">costo {{ k.costo_beneficios_mes | currency:'MXN':'symbol-narrow':'1.0-0' }} este mes</span>
      </article>
      <article class="loy-card" [class.loy-card--ojo]="k.dobles_pendientes > 0">
        <span class="loy-card__k">Canjes dobles</span>
        <strong class="loy-card__v">{{ k.dobles_pendientes }}</strong>
        <span class="loy-card__n">por revisar</span>
      </article>
    </div>

    <!-- ------------------------------------------------ formulario plan -->
    <form class="loy-form" *ngIf="plan() as d" (ngSubmit)="guardarPlan()" data-guide="club-plan-form">
      <div class="loy-form__grid">
        <label class="loy-f loy-f--wide">
          <span>Nombre</span>
          <input class="ctl" type="text" [(ngModel)]="d.nombre" name="cNom" maxlength="80" placeholder="Club del café">
        </label>
        <label class="loy-f loy-f--wide">
          <span>Producto con el que se cobra</span>
          <wx-select [opciones]="productosCobro()" [(ngModel)]="d.productoCobro" name="cProd"
                     [buscable]="true" placeholder="Elegir producto"></wx-select>
        </label>
        <label class="loy-f">
          <span>Días que cubre un pago</span>
          <input class="ctl" type="number" min="1" max="366" [(ngModel)]="d.dias" name="cDias">
        </label>
        <label class="loy-f">
          <span>Beneficios por día</span>
          <input class="ctl" type="number" min="1" max="20" [(ngModel)]="d.limiteDiario" name="cLim">
        </label>
        <label class="loy-f">
          <span>Días de gracia</span>
          <input class="ctl" type="number" min="0" max="30" [(ngModel)]="d.gracia" name="cGra">
        </label>
        <div class="loy-f loy-f--wide">
          <span class="loy-f__lbl">Qué se puede dar gratis</span>
          <wx-multi-select etiqueta="Productos del beneficio" [opciones]="productosBeneficio()" [(values)]="d.productos"></wx-multi-select>
        </div>
      </div>

      <p class="loy-nota">
        <i class="ph ph-info"></i>
        El producto de cobro debe ser un servicio (sin inventario) y único para este plan. Venderlo a un cliente lo afilia o le suma {{ d.dias }} días.
      </p>
      <p class="loy-nota loy-nota--mal" *ngIf="problema() as e"><i class="ph ph-warning-circle"></i> {{ e }}</p>

      <div class="loy-checks">
        <label class="loy-check"><input type="checkbox" [(ngModel)]="d.activo" name="cAct"><span>Se puede afiliar</span></label>
      </div>
      <div class="btn-row">
        <button class="btn-primary" type="submit" [disabled]="guardando()"><i class="ph ph-check"></i> Guardar</button>
        <button class="btn-ghost" type="button" (click)="plan.set(null)">Cancelar</button>
      </div>
    </form>

    <!-- ------------------------------------------------------ planes -->
    <h3 class="loy-h3">Planes</h3>
    <div class="loy-tabla" *ngIf="planes().length; else sinPlanes">
      <table class="wx-tabla">
        <thead><tr><th>Plan</th><th>Cobro</th><th class="num">Precio</th><th>Beneficio</th><th class="num">Socios</th><th></th></tr></thead>
        <tbody>
          <tr *ngFor="let p of planes()" [class.apagada]="!p.active" [attr.data-guide-clave]="p.uuid">
            <td>{{ p.name }}<small>{{ p.period_days }} días · {{ p.grace_days }} de gracia{{ p.origin === 'REMOTE' ? ' · de otra sucursal' : '' }}</small></td>
            <td>{{ p.sale_product_name || '—' }}</td>
            <td class="num">{{ (p.price ?? 0) | currency:'MXN':'symbol-narrow':'1.0-2' }}</td>
            <td>{{ p.daily_limit }} al día<small>{{ nombresProductos(p) }}</small></td>
            <td class="num">{{ p.socios_activos }}</td>
            <td class="acciones">
              <button class="btn-ghost btn-sm" type="button" (click)="editarPlan(p)"><i class="ph ph-pencil-simple"></i> Editar</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <ng-template #sinPlanes>
      <div class="loy-vacio" *ngIf="!cargando()">
        <i class="ph ph-coffee"></i>
        <h3>Todavía no hay planes</h3>
        <p>Crea un producto de servicio («Membresía mensual») y después un plan que diga qué se regala cada día.</p>
      </div>
    </ng-template>

    <!-- ------------------------------------------------------ dobles -->
    <ng-container *ngIf="dobles().length">
      <h3 class="loy-h3">Canjes dobles <span class="loy-count">{{ resumen()?.dobles_pendientes ?? 0 }} por revisar</span></h3>
      <p class="loy-sub">Se dio el beneficio dos veces el mismo día en sucursales sin conexión. Las dos ventas quedan; revisa y anota qué pasó.</p>
      <div class="loy-tabla">
        <table class="wx-tabla">
          <thead><tr><th>Cliente</th><th>Cuándo</th><th>Dónde</th><th>Producto</th><th>Revisión</th><th></th></tr></thead>
          <tbody>
            <tr *ngFor="let r of dobles()" [class.apagada]="!!r.reviewed_at" data-guide="club-doble" [attr.data-guide-clave]="r.id">
              <td>{{ r.cliente }}<small>{{ r.plan_name }}</small></td>
              <td>{{ r.created_at | date:'d MMM HH:mm':'UTC':'es-MX' }}</td>
              <td>{{ r.sucursal }}</td>
              <td>{{ r.units }} × {{ r.product_name }}<small *ngIf="r.sale_id">Venta #{{ r.sale_id }}</small></td>
              <td><ng-container *ngIf="r.reviewed_at; else pendiente">{{ r.revisado_por || 'Revisado' }}<small>{{ r.review_note }}</small></ng-container>
                  <ng-template #pendiente><span class="loy-pill">Pendiente</span></ng-template></td>
              <td class="acciones">
                <button *ngIf="!r.reviewed_at" class="btn-ghost btn-sm" type="button" (click)="revisar(r)"><i class="ph ph-check"></i> Revisar</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </ng-container>

    <!-- ------------------------------------------------------ socios -->
    <h3 class="loy-h3">Socios</h3>
    <div class="loy-filtros">
      <input class="ctl" type="search" placeholder="Nombre o teléfono" [(ngModel)]="buscar" (keyup.enter)="cargar()" (search)="cargar()" data-guide="club-buscar">
      <wx-select [opciones]="opcEstado" [(ngModel)]="estado" (ngModelChange)="cargar()" placeholder="Todos"></wx-select>
    </div>
    <div class="loy-tabla" *ngIf="socios().length; else sinSocios">
      <table class="wx-tabla">
        <thead><tr><th>Cliente</th><th>Plan</th><th>Estado</th><th>Pagado hasta</th><th class="num">Beneficios del mes</th><th></th></tr></thead>
        <tbody>
          <tr *ngFor="let s of socios()" [class.apagada]="s.estado === 'CANCELADA'" data-guide="club-socio" [attr.data-guide-clave]="s.id" [attr.data-guide-estado]="s.estado">
            <td>{{ s.cliente }}<small>{{ s.telefono || 'Sin teléfono' }}</small></td>
            <td>{{ s.plan_name }}</td>
            <td><span class="loy-estado" [class.si]="s.estado === 'ACTIVA'" [class.ojo]="s.estado === 'POR_VENCER'" [class.mal]="s.estado === 'VENCIDA'">{{ etiquetaEstado[s.estado] }}</span></td>
            <td>{{ s.paid_until ? (s.paid_until | date:'d MMM y':'UTC':'es-MX') : '—' }}</td>
            <td class="num">{{ s.beneficios_mes }}</td>
            <td class="acciones">
              <button *ngIf="s.estado !== 'CANCELADA'" class="btn-ghost btn-sm" type="button" (click)="cancelar(s)">Cancelar</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <ng-template #sinSocios>
      <p class="loy-hint" *ngIf="!cargando()">{{ buscar || estado ? 'Nadie coincide con la búsqueda.' : 'Aún no hay socios. Se afilian en caja, al elegir al cliente.' }}</p>
    </ng-template>
  </div>`,
  styles: [`
    .loy-card--ojo { border-color: var(--wx-warning); }
    .loy-estado.ojo { background: var(--wx-warning-soft); color: var(--wx-warning-ink); }
    .loy-estado.mal { background: var(--wx-danger-soft); color: var(--wx-danger-ink); }
    .loy-filtros wx-select { min-width: 180px; }
    .loy-tabla th.num, .loy-tabla td.num { padding-right: 18px; }
  `],
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
  readonly opcEstado: WxOpcion[] = [
    { valor: null, etiqueta: 'Todos' },
    { valor: 'ACTIVA', etiqueta: 'Activas' },
    { valor: 'POR_VENCER', etiqueta: 'Por vencer' },
    { valor: 'VENCIDA', etiqueta: 'Vencidas' },
    { valor: 'CANCELADA', etiqueta: 'Canceladas' },
  ];
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
