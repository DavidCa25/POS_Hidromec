import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  CambioHecho, DevolucionesService, LineaCambio, MOTIVOS_DEVOLUCION, MetodoDiferencia, Regreso, VentaDevolvible, VentaParaDevolver,
} from '../../core/devoluciones.service';
import { CatalogService } from '../../core/catalog.service';
import { AuthService } from '../../services/auth.service';
import { ReceiptViewer } from '../../app/receipt-viewer/receipt-viewer.component';

/*
 * DEVOLUCIÓN Y CAMBIO EN TOUCH (0065).
 *
 * Una hoja de Touch, con sus mismas piezas (tp-hoja, tp-res, tp-opcion,
 * tp-hoja__qty), en tres pasos:
 *
 *   1. Encontrar la venta: las de hoy de esta caja (o las del cliente de la
 *      cuenta), o tecleando el folio. Sin el ticket también se encuentra.
 *   2. Qué devuelve, el motivo (obligatorio) y qué se hace:
 *        · Regresar el dinero: dice CÓMO, antes de confirmar.
 *        · Cambiar por otro producto: elige qué se lleva; si vale más paga la
 *          diferencia, si vale menos se le regresa. Todo en una operación.
 *   3. Listo: qué hacer con el dinero y el comprobante para imprimir.
 *
 * Quién decide es SQL (sp_refund_sale / sp_exchange_sale). Si quien atiende
 * no puede devolver, el canal pide solo el PIN o la aprobación del dueño.
 */
type Paso = 'elegir' | 'devolver' | 'listo';
type Modo = 'dinero' | 'cambio';

@Component({
  selector: 'app-devolucion-touch',
  standalone: true,
  imports: [CommonModule, ReceiptViewer],
  styleUrls: ['../touch-pos.css', './devolucion-touch.css'],
  template: `
  <div class="tp-overlay" *ngIf="!imprimiendo()" (click)="cerrar.emit()">
    <div class="tp-hoja tp-hoja--dev" (click)="$event.stopPropagation()" role="dialog" aria-modal="true" aria-labelledby="tp-dev-titulo" data-guide="touch-devolucion-hoja">
      <header class="tp-hoja__head">
        <div class="tp-hoja__id">
          <span class="tp-hoja__media"><i class="ph" [class.ph-arrow-counter-clockwise]="modo() === 'dinero'" [class.ph-arrows-left-right]="modo() === 'cambio'" aria-hidden="true"></i></span>
          <div>
            <h3 id="tp-dev-titulo">{{ titulo() }}</h3>
            <p *ngIf="paso() === 'elegir'">{{ porCliente() ? 'Ventas de ' + clienteNombre : 'Ventas de hoy en esta caja' }}</p>
            <p *ngIf="paso() === 'devolver' && venta() as v">{{ v.datee | date:'d MMM, HH:mm':'UTC':'es-MX' }} · {{ v.total | currency:'MXN':'symbol-narrow':'1.2-2' }}</p>
          </div>
        </div>
        <button type="button" class="tp-iconbtn tp-iconbtn--claro" (click)="cerrar.emit()" aria-label="Cerrar">
          <i class="ph ph-x" aria-hidden="true"></i>
        </button>
      </header>

      <!-- ===================================================== 1 · ELEGIR -->
      <ng-container *ngIf="paso() === 'elegir'">
        <div class="tp-hoja__body tp-clientes">
          <div class="tp-buscador__campo">
            <i class="ph ph-hash" aria-hidden="true"></i>
            <input type="text" inputmode="numeric" data-teclado="QUANTITY" placeholder="Folio del ticket" autocomplete="off" maxlength="9"
                   aria-label="Folio del ticket" data-guide="touch-devolucion-folio"
                   [value]="folio()" (input)="folio.set($any($event.target).value)" (keyup.enter)="buscarFolio()">
            <button type="button" class="tp-iconbtn" (click)="buscarFolio()" [disabled]="!folio().trim()" aria-label="Buscar folio">
              <i class="ph ph-arrow-right" aria-hidden="true"></i>
            </button>
          </div>
          <div class="tp-opciones tp-dev-dos" *ngIf="clienteId" role="group" aria-label="Qué ventas ver">
            <button type="button" class="tp-opcion" [class.on]="porCliente()" (click)="verDe(true)"><span class="tp-opcion__n">De {{ clienteNombre }}</span></button>
            <button type="button" class="tp-opcion" [class.on]="!porCliente()" (click)="verDe(false)"><span class="tp-opcion__n">Hoy en esta caja</span></button>
          </div>
          <div class="tp-clientes__lista" role="list">
            <button type="button" class="tp-res tp-dev-venta" role="listitem" *ngFor="let s of ventas()"
                    [class.off]="s.devuelta" [disabled]="s.devuelta || cargando()" (click)="elegir(s.id)"
                    data-guide="touch-devolucion-venta" [attr.data-guide-clave]="s.id">
              <i class="ph ph-receipt" aria-hidden="true"></i>
              <span class="tp-res__n">
                <b>#{{ s.id }}</b> · {{ s.datee | date:'HH:mm':'UTC' }}{{ s.cliente ? ' · ' + s.cliente : '' }}
                <small>{{ s.devuelta ? 'Ya se devolvió todo' : s.resumen }}</small>
              </span>
              <span class="tp-res__p">{{ s.total | currency:'MXN':'symbol-narrow':'1.0-2' }}</span>
            </button>
            <p class="tp-res__vacio" *ngIf="cargando()">Buscando ventas…</p>
            <p class="tp-res__vacio" *ngIf="!cargando() && !ventas().length">{{ porCliente() ? 'Este cliente no tiene ventas en los últimos 30 días.' : 'Hoy no hay ventas en esta caja. Busca por folio.' }}</p>
          </div>
          <p class="tp-alta__error" role="alert" *ngIf="error() as e">{{ e }}</p>
        </div>
      </ng-container>

      <!-- =================================================== 2 · DEVOLVER -->
      <ng-container *ngIf="paso() === 'devolver' && venta() as v">
        <div class="tp-hoja__body">
          <section class="tp-grupo">
            <div class="tp-grupo__head"><h4>Qué devuelve</h4>
              <button type="button" class="tp-dev-todo" (click)="todo()">Todo</button></div>
            <div class="tp-dev-renglon" *ngFor="let l of v.renglones" data-guide="touch-devolucion-renglon" [attr.data-guide-clave]="l.productId">
              <span class="tp-dev-renglon__txt"><b>{{ l.nombre }}</b>
                <small>{{ l.precio | currency:'MXN':'symbol-narrow':'1.2-2' }} · puede devolver {{ l.maximo }}</small></span>
              <div class="tp-hoja__qty">
                <button type="button" (click)="cambiarCantidad(l, -1)" [disabled]="l.cantidad <= 0" [attr.aria-label]="'Menos ' + l.nombre"><i class="ph ph-minus" aria-hidden="true"></i></button>
                <span>{{ l.cantidad }}</span>
                <button type="button" (click)="cambiarCantidad(l, 1)" [disabled]="l.cantidad >= l.maximo" [attr.aria-label]="'Más ' + l.nombre"><i class="ph ph-plus" aria-hidden="true"></i></button>
              </div>
            </div>
          </section>

          <section class="tp-grupo" data-guide="touch-devolucion-motivo">
            <div class="tp-grupo__head"><h4>Motivo</h4><span class="tp-grupo__regla req">Obligatorio</span></div>
            <div class="tp-opciones" role="radiogroup" aria-label="Motivo">
              <button type="button" class="tp-opcion" role="radio" *ngFor="let m of motivos"
                      [attr.aria-checked]="motivo() === m" [class.on]="motivo() === m" (click)="motivo.set(m)">
                <span class="tp-opcion__n">{{ m }}</span>
              </button>
            </div>
            <label class="tp-nota tp-nota--campo tp-dev-nota">
              <i class="ph ph-pencil-simple" aria-hidden="true"></i>
              <input type="text" data-teclado="TEXT" maxlength="250" [placeholder]="motivo() === 'Otro' ? 'Di qué pasó (obligatorio)' : 'Nota (opcional)'"
                     [value]="nota()" (input)="nota.set($any($event.target).value)" aria-label="Nota de la devolución">
            </label>
          </section>

          <section class="tp-grupo">
            <div class="tp-grupo__head"><h4>Qué se hace</h4></div>
            <div class="tp-opciones tp-dev-dos" role="radiogroup" aria-label="Qué se hace" data-guide="touch-devolucion-modo">
              <button type="button" class="tp-opcion" role="radio" [attr.aria-checked]="modo() === 'dinero'" [class.on]="modo() === 'dinero'" (click)="modo.set('dinero')">
                <span class="tp-opcion__n">Regresar el dinero</span></button>
              <button type="button" class="tp-opcion" role="radio" [attr.aria-checked]="modo() === 'cambio'" [class.on]="modo() === 'cambio'" (click)="usarCambio()">
                <span class="tp-opcion__n">Cambiar por otro producto</span></button>
            </div>
          </section>

          <!-- Cambio: qué se lleva -->
          <section class="tp-grupo" *ngIf="modo() === 'cambio'" data-guide="touch-cambio">
            <div class="tp-grupo__head"><h4>Se lleva</h4></div>
            <div class="tp-buscador__campo">
              <i class="ph ph-magnifying-glass" aria-hidden="true"></i>
              <input type="search" data-teclado="TEXT" placeholder="Buscar producto…" autocomplete="off" maxlength="60" aria-label="Buscar producto para el cambio"
                     [value]="buscar()" (input)="buscar.set($any($event.target).value)" data-guide="touch-cambio-buscar">
            </div>
            <div class="tp-clientes__lista tp-dev-resultados" role="list" *ngIf="buscar().trim()">
              <button type="button" class="tp-res" role="listitem" *ngFor="let p of resultados()" (click)="agregar(p)" data-guide="touch-cambio-producto" [attr.data-guide-clave]="p.id">
                <i class="ph ph-plus-circle" aria-hidden="true"></i>
                <span class="tp-res__n">{{ p.product_name }}</span>
                <span class="tp-res__p">{{ p.price | currency:'MXN':'symbol-narrow':'1.2-2' }}</span>
              </button>
              <p class="tp-res__vacio" *ngIf="!resultados().length">Nada coincide.</p>
            </div>
            <div class="tp-dev-renglon" *ngFor="let l of lleva()" data-guide="touch-cambio-linea" [attr.data-guide-clave]="l.productId">
              <span class="tp-dev-renglon__txt"><b>{{ l.nombre }}</b><small>{{ l.precio | currency:'MXN':'symbol-narrow':'1.2-2' }}</small></span>
              <div class="tp-hoja__qty">
                <button type="button" (click)="cambiarLleva(l, -1)" [attr.aria-label]="'Menos ' + l.nombre"><i class="ph ph-minus" aria-hidden="true"></i></button>
                <span>{{ l.cantidad }}</span>
                <button type="button" (click)="cambiarLleva(l, 1)" [attr.aria-label]="'Más ' + l.nombre"><i class="ph ph-plus" aria-hidden="true"></i></button>
              </div>
            </div>
            <div class="tp-dev-cuenta" *ngIf="lleva().length">
              <div><span>Devuelve</span><b>{{ total() | currency:'MXN':'symbol-narrow':'1.2-2' }}</b></div>
              <div><span>Se lleva</span><b>{{ totalLleva() | currency:'MXN':'symbol-narrow':'1.2-2' }}</b></div>
              <div class="tp-dev-cuenta__dif">
                <span>{{ diferencia() > 0 ? 'Paga la diferencia' : diferencia() < 0 ? 'Se le regresa' : 'Sin diferencia' }}</span>
                <b>{{ absDif() | currency:'MXN':'symbol-narrow':'1.2-2' }}</b>
              </div>
            </div>
            <ng-container *ngIf="diferencia() > 0">
              <div class="tp-opciones tp-dev-tres" role="radiogroup" aria-label="Cómo paga la diferencia" data-guide="touch-cambio-pago">
                <button type="button" class="tp-opcion" role="radio" *ngFor="let m of metodos" [attr.aria-checked]="metodoDif() === m.id"
                        [class.on]="metodoDif() === m.id" (click)="metodoDif.set(m.id)"><span class="tp-opcion__n">{{ m.etiqueta }}</span></button>
              </div>
              <label class="tp-nota tp-nota--campo tp-dev-nota" *ngIf="metodoDif() === 'EFECTIVO'">
                <i class="ph ph-money" aria-hidden="true"></i>
                <input type="text" inputmode="decimal" data-teclado="MONEY" placeholder="¿Cuánto recibió?" [value]="recibido()"
                       (input)="recibido.set($any($event.target).value)" aria-label="Dinero recibido" data-guide="touch-cambio-recibido">
              </label>
            </ng-container>
          </section>

          <section class="tp-grupo" *ngIf="regreso().length" data-guide="touch-devolucion-regreso">
            <div class="tp-grupo__head"><h4>Cómo se le regresa</h4></div>
            <div class="tp-dev-regreso" *ngFor="let r of regreso()">
              <i class="ph" [ngClass]="icono(r.metodo)" aria-hidden="true"></i>
              <span>{{ r.texto }}</span>
              <b>{{ r.monto | currency:'MXN':'symbol-narrow':'1.2-2' }}</b>
            </div>
          </section>
          <p class="tp-alta__error" role="alert" *ngIf="error() as e">{{ e }}</p>
        </div>
        <footer class="tp-hoja__foot tp-hoja__foot--dos">
          <button type="button" class="tp-secundaria" (click)="volver()" [disabled]="guardando()">Otra venta</button>
          <button type="button" class="tp-primaria" data-guide="touch-devolucion-confirmar" [disabled]="!puedeConfirmar() || guardando()" (click)="confirmar()">
            {{ guardando() ? 'Registrando…' : textoConfirmar() }}
          </button>
        </footer>
      </ng-container>

      <!-- ====================================================== 3 · LISTO -->
      <ng-container *ngIf="paso() === 'listo'">
        <div class="tp-hoja__body">
          <div class="tp-dev-listo">
            <i class="ph ph-check-circle" aria-hidden="true"></i>
            <p>Se repuso el inventario{{ cambio() ? ' y se registró la venta del cambio #' + cambio()!.saleId : '' }}.</p>
            <p *ngIf="hecho().length || cobrado()">Haz esto con el dinero:</p>
          </div>
          <div class="tp-dev-regreso" *ngIf="cobrado() as c">
            <i class="ph" [ngClass]="icono(c.metodo)" aria-hidden="true"></i>
            <span>Cobra la diferencia ({{ c.etiqueta }}){{ c.cambio ? ' · cambio ' + (c.cambio | currency:'MXN':'symbol-narrow':'1.2-2') : '' }}</span>
            <b>{{ c.monto | currency:'MXN':'symbol-narrow':'1.2-2' }}</b>
          </div>
          <div class="tp-dev-regreso" *ngFor="let r of hecho()">
            <i class="ph" [ngClass]="icono(r.metodo)" aria-hidden="true"></i>
            <span>{{ r.texto }}</span>
            <b>{{ r.monto | currency:'MXN':'symbol-narrow':'1.2-2' }}</b>
          </div>
        </div>
        <footer class="tp-hoja__foot tp-hoja__foot--dos">
          <button type="button" class="tp-secundaria" *ngIf="refundId()" (click)="imprimiendo.set(true)" data-guide="touch-devolucion-imprimir">
            <i class="ph ph-printer" aria-hidden="true"></i> Comprobante
          </button>
          <button type="button" class="tp-primaria" (click)="cerrar.emit()" data-guide="touch-devolucion-listo">Listo</button>
        </footer>
      </ng-container>
    </div>
  </div>
  <app-receipt-viewer *ngIf="imprimiendo() && refundId()" [id]="refundId()!" document="refund" (close)="imprimiendo.set(false)"></app-receipt-viewer>`,
})
export class DevolucionTouch implements OnInit {
  /** El cliente de la cuenta: si hay, se ofrecen primero sus ventas. */
  @Input() clienteId: number | null = null;
  @Input() clienteNombre: string | null = null;
  @Output() cerrar = new EventEmitter<void>();

  private readonly dev = inject(DevolucionesService);
  private readonly auth = inject(AuthService);
  private readonly catalogo = inject(CatalogService);
  readonly motivos = MOTIVOS_DEVOLUCION;
  readonly metodos: { id: MetodoDiferencia; etiqueta: string }[] = [
    { id: 'EFECTIVO', etiqueta: 'Efectivo' }, { id: 'TARJETA', etiqueta: 'Tarjeta' }, { id: 'TRANSFERENCIA', etiqueta: 'Transferencia' },
  ];

  readonly paso = signal<Paso>('elegir');
  readonly modo = signal<Modo>('dinero');
  readonly porCliente = signal(false);
  readonly ventas = signal<VentaDevolvible[]>([]);
  readonly venta = signal<VentaParaDevolver | null>(null);
  readonly folio = signal('');
  readonly motivo = signal<string | null>(null);
  readonly nota = signal('');
  readonly lleva = signal<LineaCambio[]>([]);
  readonly buscar = signal('');
  readonly metodoDif = signal<MetodoDiferencia | null>(null);
  readonly recibido = signal('');
  readonly cargando = signal(false);
  readonly guardando = signal(false);
  readonly imprimiendo = signal(false);
  readonly error = signal<string | null>(null);
  readonly hecho = signal<Regreso[]>([]);
  readonly refundId = signal<number | null>(null);
  readonly cambio = signal<CambioHecho | null>(null);
  readonly cobrado = signal<{ metodo: string; etiqueta: string; monto: number; cambio: number } | null>(null);
  /* Los renglones se mutan en su lugar; esto obliga a recalcular. */
  private readonly version = signal(0);

  readonly total = computed(() => { this.version(); return this.dev.total(this.venta()); });
  readonly totalLleva = computed(() => this.dev.totalLleva(this.lleva()));
  readonly diferencia = computed(() => Math.round((this.totalLleva() - this.total()) * 100) / 100);
  readonly absDif = computed(() => Math.abs(this.diferencia()));
  readonly recibidoNum = computed(() => Number(String(this.recibido()).replace(/[^0-9.]/g, '')) || 0);
  readonly regreso = computed<Regreso[]>(() => {
    this.version();
    if (this.modo() === 'dinero') return this.dev.comoRegresa(this.venta());
    return this.lleva().length && this.diferencia() < 0 ? this.dev.comoRegresa(this.venta(), -this.diferencia()) : [];
  });
  readonly resultados = computed(() => {
    const t = this.buscar().trim().toLowerCase();
    if (!t) return [];
    return this.catalogo.vendibles().filter(p => p.product_name.toLowerCase().includes(t) || (p.part_number ?? '').toLowerCase().includes(t)).slice(0, 8);
  });
  readonly titulo = computed(() => {
    if (this.paso() === 'listo') return this.cambio() ? 'Cambio registrado' : 'Devolución registrada';
    const v = this.venta();
    if (!v) return 'Devolución';
    return (this.modo() === 'cambio' ? 'Cambio de la venta #' : 'Devolver de la venta #') + v.id;
  });
  readonly puedeConfirmar = computed(() => {
    if (!(this.total() > 0) || !this.motivo() || (this.motivo() === 'Otro' && !this.nota().trim())) return false;
    if (this.modo() === 'dinero') return true;
    if (!this.lleva().length) return false;
    if (this.diferencia() > 0) {
      if (!this.metodoDif()) return false;
      if (this.metodoDif() === 'EFECTIVO' && this.recibidoNum() < this.diferencia()) return false;
    }
    return true;
  });
  readonly textoConfirmar = computed(() => {
    const m = (n: number) => '$' + n.toFixed(2);
    if (this.modo() === 'dinero') return 'Devolver ' + m(this.total());
    if (this.diferencia() > 0) return 'Hacer el cambio · cobra ' + m(this.diferencia());
    if (this.diferencia() < 0) return 'Hacer el cambio · regresa ' + m(-this.diferencia());
    return 'Hacer el cambio';
  });

  async ngOnInit(): Promise<void> {
    this.porCliente.set(!!this.clienteId);
    await this.listar();
  }

  async verDe(cliente: boolean): Promise<void> {
    this.porCliente.set(cliente);
    await this.listar();
  }

  private async listar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      this.ventas.set(await this.dev.ventas(this.porCliente() ? { customerId: this.clienteId } : {}));
    } catch (e: any) {
      this.error.set(e?.message || 'No se pudieron leer las ventas.');
    } finally {
      this.cargando.set(false);
    }
  }

  async buscarFolio(): Promise<void> {
    const n = Number(this.folio().replace(/\D/g, ''));
    if (!n) return;
    await this.elegir(n);
  }

  async elegir(id: number): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const v = await this.dev.cargar(id);
      if (!v.renglones.length) { this.error.set(`De la venta #${id} ya se devolvió todo.`); return; }
      this.venta.set(v);
      this.motivo.set(null);
      this.nota.set('');
      this.modo.set('dinero');
      this.lleva.set([]);
      this.paso.set('devolver');
    } catch (e: any) {
      this.error.set(e?.message || `No se encontró la venta #${id}.`);
    } finally {
      this.cargando.set(false);
    }
  }

  cambiarCantidad(l: { cantidad: number; maximo: number }, d: number): void {
    l.cantidad = Math.min(l.maximo, Math.max(0, l.cantidad + d));
    this.version.update(x => x + 1);
  }

  todo(): void {
    for (const l of this.venta()?.renglones ?? []) l.cantidad = l.maximo;
    this.version.update(x => x + 1);
  }

  async usarCambio(): Promise<void> {
    this.modo.set('cambio');
    /* Fresco: lo que se lleva tiene que existir y con su precio de hoy. */
    await this.catalogo.load(true);
  }

  agregar(p: { id: number; product_name: string; price: number }): void {
    const ya = this.lleva().find(l => l.productId === p.id);
    if (ya) this.lleva.set(this.lleva().map(l => l === ya ? { ...l, cantidad: l.cantidad + 1 } : l));
    else this.lleva.set([...this.lleva(), { productId: p.id, nombre: p.product_name, precio: Number(p.price), cantidad: 1 }]);
    this.buscar.set('');
  }

  cambiarLleva(l: LineaCambio, d: number): void {
    const n = l.cantidad + d;
    this.lleva.set(n <= 0 ? this.lleva().filter(x => x !== l) : this.lleva().map(x => x === l ? { ...x, cantidad: n } : x));
  }

  volver(): void {
    this.venta.set(null);
    this.error.set(null);
    this.paso.set('elegir');
    void this.listar();
  }

  icono(metodo: string): string {
    switch (metodo) {
      case 'EFECTIVO': return 'ph-money';
      case 'TARJETA': case 'TERMINAL_MP': return 'ph-credit-card';
      case 'TRANSFERENCIA': return 'ph-bank';
      case 'CREDITO': return 'ph-hand-coins';
      default: return 'ph-arrow-counter-clockwise';
    }
  }

  async confirmar(): Promise<void> {
    const v = this.venta(), motivo = this.motivo();
    const userId = this.auth.usuarioActualId;
    if (!v || !motivo || !userId || !this.puedeConfirmar()) return;
    const regreso = this.regreso();
    this.guardando.set(true);
    this.error.set(null);
    try {
      if (this.modo() === 'dinero') {
        const r = await this.dev.devolver(v, motivo, this.nota(), userId);
        if (!r.ok) { if (!r.cancelado) this.error.set(r.error ?? 'No se pudo registrar la devolución.'); return; }
        this.refundId.set(r.refundId ?? null);
        this.hecho.set(regreso);
      } else {
        const dif = this.diferencia();
        const metodo = dif > 0 ? this.metodoDif() : null;
        const r = await this.dev.cambiar(v, motivo, this.nota(), userId, this.lleva(),
          { metodo, recibido: metodo === 'EFECTIVO' ? this.recibidoNum() : null });
        if (!r.ok || !r.hecho) { if (!r.cancelado) this.error.set(r.error ?? 'No se pudo registrar el cambio.'); return; }
        this.cambio.set(r.hecho);
        this.refundId.set(r.hecho.refundId);
        this.hecho.set(regreso);
        if (metodo) this.cobrado.set({ metodo, etiqueta: this.metodos.find(m => m.id === metodo)!.etiqueta, monto: dif,
                                       cambio: metodo === 'EFECTIVO' ? Math.max(0, this.recibidoNum() - dif) : 0 });
      }
      this.paso.set('listo');
    } finally {
      this.guardando.set(false);
    }
  }
}
