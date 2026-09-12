import { ChangeDetectorRef, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import {
  CapabilityService, CatalogService, CouponDefinition, DynamicDefinition,
  LoyaltyInstance, LoyaltyService, RaffleDefinition, RaffleEntry, RaffleWinner,
  RewardDefinition, WheelSegment,
} from '../core';
import { WxOpcion, WxSelectComponent } from '../app/wx-select/wx-select.component';
import { WxDateComponent } from '../app/wx-date/wx-date.component';
import { WxTimeComponent } from '../app/wx-time/wx-time.component';
import { DinamicaJuego } from './dinamica-juego';

/*
 * Administracion de Fidelizacion.
 *
 * UNA entrada en el menu, seis secciones dentro: Resumen, Campanas,
 * Recompensas, Cupones, Dinamicas y Rifas. El menu lateral ya tiene mas
 * entradas de las que nadie recuerda; anadirle seis mas por una funcion que
 * muchos negocios no encenderan habria sido repartir el problema, no
 * resolverlo.
 *
 * Nada se valida aqui por gusto: los procedures deciden y esta pantalla
 * ensena el mensaje que devuelven. Lo unico que se comprueba antes de
 * enviar es lo que el formulario puede saber solo -que falte el nombre, que
 * una campana de recompensa no tenga recompensa elegida-, para no gastar un
 * viaje en algo evidente.
 */

type Seccion = 'resumen' | 'campanas' | 'recompensas' | 'cupones' | 'dinamicas' | 'rifas';

/** Borrador de campana. `id` null = alta. */
interface DraftCampana {
  id: number | null;
  name: string;
  description: string;
  outcome: 'REWARD' | 'COUPON' | 'DYNAMIC' | 'RAFFLE_ENTRY';
  rewardDefinitionId: number | null;
  couponDefinitionId: number | null;
  dynamicDefinitionId: number | null;
  raffleId: number | null;
  quantity: number;
  perAmount: number | null;
  minTotal: number | null;
  productId: number | null;
  requiresCustomer: boolean;
  firstPurchaseOnly: boolean;
  dias: boolean[];
  timeFrom: string;
  timeTo: string;
  startsAt: string;
  endsAt: string;
  priority: number;
  active: boolean;
}

interface DraftPremio {
  id: number | null;
  name: string;
  kind: 'FREE_PRODUCT' | 'AMOUNT' | 'PERCENT';
  productId: number | null;
  amount: number | null;
  discountPct: number | null;
  description: string;
  validDays: number | null;
  usesAllowed: number;
  codePrefix: string;
  active: boolean;
}

interface DraftDinamica {
  id: number | null;
  name: string;
  type: 'TIMING' | 'WHEEL';
  description: string;
  targetValue: number | null;
  attemptsAllowed: number;
  rewardDefinitionId: number | null;
  active: boolean;
}

interface DraftRifa {
  id: number | null;
  name: string;
  description: string;
  prize: string;
  startsAt: string;
  endsAt: string;
  winnersCount: number;
  codePrefix: string;
  /** Cuantos boletos tiene la rifa. Vacio es sin tope. */
  ticketsTotal: number | null;
  status: 'DRAFT' | 'OPEN' | 'CLOSED' | 'DRAWN' | '';
}

@Component({
  selector: 'app-loyalty-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, WxSelectComponent, WxDateComponent, WxTimeComponent, DinamicaJuego],
  templateUrl: './loyalty-admin.html',
  styleUrls: ['./loyalty-admin.css'],
})
export class LoyaltyAdmin implements OnInit {
  readonly loyalty = inject(LoyaltyService);
  readonly caps = inject(CapabilityService);
  private readonly catalog = inject(CatalogService);
  private readonly cd = inject(ChangeDetectorRef);

  seccion = signal<Seccion>('resumen');
  guardando = signal(false);

  /**
   * Definiciones o emisiones.
   *
   * Son dos preguntas distintas sobre lo mismo: "que promociones tengo" y
   * "que se ha repartido". La segunda es la que aparece cuando un cliente
   * llega con un codigo en la mano, y hasta ahora solo se podia responder
   * abriendo SSMS.
   */
  vista = signal<'definiciones' | 'emitidas'>('definiciones');

  /**
   * Por que no se pudo guardar, EN el formulario.
   *
   * El modal solo no basta: se cierra de un clic reflejo y deja un formulario
   * con seis campos y ninguna marca de cual falta. Quien lo cierra deprisa se
   * queda convencido de que guardo, y luego no encuentra lo que creyo crear.
   * Este mensaje se queda hasta que se corrige o se cancela.
   */
  problema = signal<string | null>(null);
  instancias = signal<LoyaltyInstance[]>([]);
  cargandoInstancias = signal(false);
  filtroEstado = signal<string>('');

  /** Estados por los que se puede filtrar lo emitido. */
  readonly opcEstadoInstancia: WxOpcion[] = [
    { valor: '', etiqueta: 'Todas' },
    { valor: 'ISSUED', etiqueta: 'Emitidas' },
    { valor: 'REDEEMED', etiqueta: 'Usadas' },
    { valor: 'EXPIRED', etiqueta: 'Vencidas' },
    { valor: 'VOID', etiqueta: 'Anuladas' },
  ];
  filtroTexto = '';

  /** Nombres visibles de las secciones, para la navegacion interna. */
  readonly secciones: { id: Seccion; label: string; icono: string }[] = [
    { id: 'resumen',     label: 'Resumen',     icono: 'ph-chart-line-up' },
    { id: 'campanas',    label: 'Campañas',    icono: 'ph-megaphone' },
    { id: 'recompensas', label: 'Recompensas', icono: 'ph-gift' },
    { id: 'cupones',     label: 'Cupones',     icono: 'ph-ticket' },
    { id: 'dinamicas',   label: 'Dinámicas',   icono: 'ph-game-controller' },
    { id: 'rifas',       label: 'Rifas',       icono: 'ph-confetti' },
  ];

  readonly diasSemana = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  // ------------------------------------------------------------ borradores
  campana = signal<DraftCampana | null>(null);
  premio = signal<DraftPremio | null>(null);
  /** REWARD o COUPON: el mismo formulario, distinto destino en SQL. */
  premioDe = signal<'REWARD' | 'COUPON'>('REWARD');
  dinamica = signal<DraftDinamica | null>(null);

  /**
   * La dinamica que se esta PROBANDO, si hay alguna.
   *
   * Configurar un juego sin poder verlo es configurar a ciegas, y depender de
   * un segundo monitor para verlo deja fuera a quien configura desde una
   * laptop. La vista previa usa el MISMO componente que la partida real y
   * abre la pantalla de cliente en una ventana corriente.
   */
  probando = signal<DynamicDefinition | null>(null);
  abriendoVentana = signal(false);

  /** Los sectores de la ruleta que se esta editando o probando. */
  sectores = signal<WheelSegment[]>([]);
  /** La ruleta cuyos sectores se estan editando. */
  editandoSectores = signal<DynamicDefinition | null>(null);
  sectorNuevo = { label: '', outcome: 'NONE' as 'NONE' | 'REWARD' | 'RAFFLE_ENTRY',
                  rewardDefinitionId: null as number | null, raffleId: null as number | null,
                  quantity: 1, weight: 1 };
  rifa = signal<DraftRifa | null>(null);

  /** Rifa abierta en el detalle, con sus boletos y ganadores. */
  rifaSel = signal<RaffleDefinition | null>(null);
  participaciones = signal<RaffleEntry[]>([]);
  ganadores = signal<RaffleWinner[]>([]);
  cargandoDetalle = signal(false);

  // ------------------------------------------------------------- derivados
  readonly productos = computed<WxOpcion[]>(() =>
    this.catalog.vendibles().map(p => ({ valor: p.id, etiqueta: p.product_name, nota: p.part_number ?? '' })));

  /**
   * Los tipos de beneficio que se pueden elegir AHORA.
   *
   * Un cupon hay que canjearlo, y hoy solo el producto gratis se puede
   * aplicar: la venta no tiene concepto de descuento. Los otros dos aparecen
   * desactivados y con su motivo, en vez de desaparecer: esconderlos haria
   * pensar que no existen, y dejarlos elegibles haria repartir papeles que la
   * caja no puede aceptar.
   */
  readonly tiposDePremio = computed<WxOpcion[]>(() => {
    const cupon = this.premioDe() === 'COUPON';
    return [
      { valor: 'FREE_PRODUCT', etiqueta: 'Producto gratis' },
      {
        valor: 'AMOUNT', etiqueta: 'Descuento en pesos',
        nota: cupon ? 'Próximamente' : undefined, desactivada: cupon,
      },
      {
        valor: 'PERCENT', etiqueta: 'Descuento en porcentaje',
        nota: cupon ? 'Próximamente' : undefined, desactivada: cupon,
      },
    ];
  });

  readonly opcRecompensas = computed<WxOpcion[]>(() =>
    this.loyalty.recompensas().filter(r => r.active).map(r => ({ valor: r.id, etiqueta: r.name })));

  readonly opcCupones = computed<WxOpcion[]>(() =>
    this.loyalty.cupones().filter(c => c.active).map(c => ({ valor: c.id, etiqueta: c.name })));

  readonly opcDinamicas = computed<WxOpcion[]>(() =>
    this.loyalty.dinamicas().filter(d => d.active).map(d => ({ valor: d.id, etiqueta: d.name })));

  readonly opcRifas = computed<WxOpcion[]>(() =>
    this.loyalty.rifas().filter(r => r.status === 'OPEN').map(r => ({ valor: r.id, etiqueta: r.name })));

  /** Cifras del Resumen. Todas salen del catalogo ya cargado. */
  readonly resumen = computed(() => {
    const camp = this.loyalty.campanas();
    const rifas = this.loyalty.rifas();
    const din = this.loyalty.dinamicas();
    return {
      campanasActivas: camp.filter(c => c.active).length,
      campanasTotales: camp.length,
      recompensasEmitidas: this.loyalty.recompensas().reduce((a, r) => a + r.emitidas, 0),
      cuponesEmitidos: this.loyalty.cupones().reduce((a, c) => a + c.emitidos, 0),
      intentos: din.reduce((a, d) => a + d.intentos, 0),
      ganados: din.reduce((a, d) => a + d.ganados, 0),
      rifasAbiertas: rifas.filter(r => r.status === 'OPEN').length,
      participaciones: rifas.reduce((a, r) => a + r.participaciones, 0),
    };
  });

  /** Las campanas encendidas que no reparten nada porque su premio falta. */
  readonly campanasHuerfanas = computed(() =>
    this.loyalty.campanasActivas().filter(c =>
      (c.outcome === 'REWARD' && !c.reward_definition_id) ||
      (c.outcome === 'COUPON' && !c.coupon_definition_id) ||
      (c.outcome === 'DYNAMIC' && !c.dynamic_definition_id) ||
      (c.outcome === 'RAFFLE_ENTRY' && !c.raffle_id)));

  async ngOnInit(): Promise<void> {
    await Promise.all([this.loyalty.cargar(true), this.catalog.load()]);
    this.cd.detectChanges();
  }

  ir(s: Seccion): void {
    this.seccion.set(s);
    this.vista.set('definiciones');
    this.instancias.set([]);
    this.cerrarFormularios();
  }

  private cerrarFormularios(): void {
    this.problema.set(null);
    this.campana.set(null);
    this.premio.set(null);
    this.dinamica.set(null);
    this.rifa.set(null);
  }

  // ============================================================== campanas
  nuevaCampana(): void {
    this.campana.set({
      id: null, name: '', description: '', outcome: 'REWARD',
      rewardDefinitionId: null, couponDefinitionId: null,
      dynamicDefinitionId: null, raffleId: null,
      quantity: 1, perAmount: null, minTotal: null, productId: null,
      requiresCustomer: false, firstPurchaseOnly: false,
      dias: [true, true, true, true, true, true, true],
      timeFrom: '', timeTo: '', startsAt: '', endsAt: '',
      priority: 100, active: true,
    });
  }

  editarCampana(c: any): void {
    this.campana.set({
      id: c.id, name: c.name, description: c.description ?? '', outcome: c.outcome,
      rewardDefinitionId: c.reward_definition_id, couponDefinitionId: c.coupon_definition_id,
      dynamicDefinitionId: c.dynamic_definition_id, raffleId: c.raffle_id,
      quantity: c.quantity, perAmount: c.per_amount, minTotal: c.min_total,
      productId: c.product_id,
      requiresCustomer: c.requires_customer, firstPurchaseOnly: c.first_purchase_only,
      dias: LoyaltyAdmin.mascaraADias(c.weekday_mask),
      timeFrom: LoyaltyAdmin.hora(c.time_from), timeTo: LoyaltyAdmin.hora(c.time_to),
      startsAt: LoyaltyAdmin.fecha(c.starts_at), endsAt: LoyaltyAdmin.fecha(c.ends_at),
      priority: c.priority, active: c.active,
    });
  }

  async guardarCampana(): Promise<void> {
    const d = this.campana();
    if (!d) return;
    if (!d.name.trim()) return this.avisar('Falta el nombre', 'Ponle nombre a la campaña.');
    const falta = this.premioDeCampanaFalta(d);
    if (falta) return this.avisar('Falta qué reparte', falta);

    this.guardando.set(true);
    try {
      await this.loyalty.guardarCampana({
        id: d.id, name: d.name.trim(), description: d.description.trim() || null,
        outcome: d.outcome,
        rewardDefinitionId: d.outcome === 'REWARD' ? d.rewardDefinitionId : null,
        couponDefinitionId: d.outcome === 'COUPON' ? d.couponDefinitionId : null,
        dynamicDefinitionId: d.outcome === 'DYNAMIC' ? d.dynamicDefinitionId : null,
        raffleId: d.outcome === 'RAFFLE_ENTRY' ? d.raffleId : null,
        quantity: d.quantity, perAmount: d.perAmount, minTotal: d.minTotal,
        productId: d.productId,
        requiresCustomer: d.requiresCustomer, firstPurchaseOnly: d.firstPurchaseOnly,
        weekdayMask: LoyaltyAdmin.diasAMascara(d.dias),
        timeFrom: d.timeFrom || null, timeTo: d.timeTo || null,
        startsAt: d.startsAt || null, endsAt: d.endsAt || null,
        priority: d.priority, active: d.active,
      });
      this.campana.set(null);
      await this.exito('Campaña guardada');
    } catch (e: any) {
      await this.avisar('No se pudo guardar', e?.message || 'Error.');
    } finally {
      this.guardando.set(false);
      this.cd.detectChanges();
    }
  }

  /** Que le falta a la campana para repartir algo, si es que le falta. */
  private premioDeCampanaFalta(d: DraftCampana): string | null {
    if (d.outcome === 'REWARD' && !d.rewardDefinitionId) return 'Elige la recompensa que entrega.';
    if (d.outcome === 'COUPON' && !d.couponDefinitionId) return 'Elige el cupón que entrega.';
    if (d.outcome === 'DYNAMIC' && !d.dynamicDefinitionId) return 'Elige la dinámica que se juega.';
    if (d.outcome === 'RAFFLE_ENTRY' && !d.raffleId) return 'Elige la rifa donde participa.';
    return null;
  }

  async alternarCampana(c: any): Promise<void> {
    try {
      await this.loyalty.guardarCampana({
        id: c.id, name: c.name, description: c.description, outcome: c.outcome,
        rewardDefinitionId: c.reward_definition_id, couponDefinitionId: c.coupon_definition_id,
        dynamicDefinitionId: c.dynamic_definition_id, raffleId: c.raffle_id,
        quantity: c.quantity, perAmount: c.per_amount, minTotal: c.min_total,
        productId: c.product_id, requiresCustomer: c.requires_customer,
        firstPurchaseOnly: c.first_purchase_only, weekdayMask: c.weekday_mask,
        timeFrom: LoyaltyAdmin.hora(c.time_from) || null, timeTo: LoyaltyAdmin.hora(c.time_to) || null,
        startsAt: c.starts_at, endsAt: c.ends_at,
        priority: c.priority, active: !c.active,
      });
    } catch (e: any) {
      await this.avisar('No se pudo cambiar', e?.message || 'Error.');
    } finally { this.cd.detectChanges(); }
  }

  // =============================================== recompensas y cupones
  nuevoPremio(de: 'REWARD' | 'COUPON'): void {
    this.premioDe.set(de);
    this.premio.set({
      id: null, name: '', kind: 'FREE_PRODUCT', productId: null,
      amount: null, discountPct: null, description: '',
      validDays: de === 'COUPON' ? 30 : null, usesAllowed: 1,
      codePrefix: de === 'COUPON' ? 'CUP' : '', active: true,
    });
  }

  editarRecompensa(r: RewardDefinition): void {
    this.premioDe.set('REWARD');
    this.premio.set({
      id: r.id, name: r.name, kind: r.kind, productId: r.product_id,
      amount: r.amount, discountPct: r.discount_pct, description: r.notes ?? '',
      validDays: r.valid_days, usesAllowed: r.uses_allowed, codePrefix: '', active: r.active,
    });
  }

  editarCupon(c: CouponDefinition): void {
    this.premioDe.set('COUPON');
    this.premio.set({
      id: c.id, name: c.name, kind: c.kind, productId: c.product_id,
      amount: c.amount, discountPct: c.discount_pct, description: '',
      validDays: c.valid_days, usesAllowed: c.uses_allowed,
      codePrefix: c.code_prefix ?? '', active: c.active,
    });
  }

  async guardarPremio(): Promise<void> {
    const d = this.premio();
    if (!d) return;
    this.problema.set(null);
    if (!d.name.trim()) return this.falta('Ponle nombre.');
    if (d.kind === 'FREE_PRODUCT' && !d.productId) return this.falta('Elige qué producto se regala.');
    if (d.kind === 'AMOUNT' && !(d.amount && d.amount > 0)) return this.falta('El descuento debe ser mayor que cero.');
    if (d.kind === 'PERCENT' && !(d.discountPct && d.discountPct > 0)) return this.falta('El porcentaje debe ser mayor que cero.');

    this.guardando.set(true);
    try {
      await this.loyalty.guardarDefinicion(this.premioDe(), {
        id: d.id, name: d.name.trim(), kind: d.kind,
        productId: d.kind === 'FREE_PRODUCT' ? d.productId : null,
        amount: d.kind === 'AMOUNT' ? d.amount : null,
        discountPct: d.kind === 'PERCENT' ? d.discountPct : null,
        description: d.description.trim() || null,
        validDays: d.validDays, usesAllowed: d.usesAllowed,
        codePrefix: d.codePrefix.trim() || null, active: d.active,
      });
      this.premio.set(null);
      // Se vuelve a Definiciones pase lo que pase: lo que se acaba de crear
      // tiene que quedar delante de quien lo creo, no en la pestana de al lado.
      this.vista.set('definiciones');
      await this.exito('Guardado');
    } catch (e: any) {
      // El motivo de SQL tambien se queda puesto: "no se pudo guardar" a secas
      // no dice si falto un dato o si fallo la conexion.
      this.problema.set(e?.message || 'No se pudo guardar.');
      await this.avisar('No se pudo guardar', e?.message || 'Error.');
    } finally {
      this.guardando.set(false);
      this.cd.detectChanges();
    }
  }

  /** Falta un dato: se dice en el formulario y ademas se avisa. */
  private falta(motivo: string): Promise<void> {
    this.problema.set(motivo);
    this.cd.detectChanges();
    return this.avisar('Falta un dato', motivo).then(() => undefined);
  }

  // ============================================================= dinamicas
  nuevaDinamica(): void {
    this.dinamica.set({
      id: null, name: '', type: 'TIMING', description: '',
      targetValue: 10, attemptsAllowed: 1,
      rewardDefinitionId: null, active: true,
    });
  }

  editarDinamica(d: DynamicDefinition): void {
    this.dinamica.set({
      id: d.id, name: d.name, type: d.type, description: d.description ?? '',
      targetValue: d.target_value,
      attemptsAllowed: d.attempts_allowed, rewardDefinitionId: d.reward_definition_id,
      active: d.active,
    });
  }

  async guardarDinamica(): Promise<void> {
    const d = this.dinamica();
    if (!d) return;
    if (!d.name.trim()) return this.avisar('Falta el nombre', 'Ponle nombre a la dinámica.');
    if (!d.rewardDefinitionId) return this.avisar('Falta el premio', 'Elige qué recompensa se lleva quien gane.');
    if (d.type === 'TIMING' && !(d.targetValue && d.targetValue > 0)) {
      return this.avisar('Falta el segundo exacto', 'Di en qué segundo hay que detener el contador, por ejemplo 10.00.');
    }

    this.guardando.set(true);
    try {
      await this.loyalty.guardarDefinicion('DYNAMIC', {
        id: d.id, name: d.name.trim(), type: d.type,
        description: d.description.trim() || null,
        targetValue: d.targetValue,
        attemptsAllowed: d.attemptsAllowed,
        rewardDefinitionId: d.rewardDefinitionId, active: d.active,
      });
      this.dinamica.set(null);
      await this.exito('Dinámica guardada');
    } catch (e: any) {
      await this.avisar('No se pudo guardar', e?.message || 'Error.');
    } finally {
      this.guardando.set(false);
      this.cd.detectChanges();
    }
  }

  // ------------------------------------------------------ sectores
  /**
   * Abrir el editor de sectores de una ruleta.
   *
   * Los sectores viven aparte de la definicion porque son varios y cada uno
   * apunta a un premio distinto. Editarlos dentro del mismo formulario habria
   * convertido una pantalla sencilla en una hoja de calculo.
   */
  async editarSectores(d: DynamicDefinition): Promise<void> {
    this.editandoSectores.set(d);
    this.sectorNuevo = { label: '', outcome: 'NONE', rewardDefinitionId: null, raffleId: null, quantity: 1, weight: 1 };
    try {
      this.sectores.set(await this.loyalty.segmentos(d.id));
    } catch (e: any) {
      this.sectores.set([]);
      await this.avisar('No se pudieron leer los sectores', e?.message || 'Error.');
    } finally { this.cd.detectChanges(); }
  }

  cerrarSectores(): void {
    this.editandoSectores.set(null);
    this.sectores.set([]);
  }

  async agregarSector(): Promise<void> {
    const d = this.editandoSectores();
    if (!d) return;
    const n = this.sectorNuevo;
    if (!n.label.trim()) return this.avisar('Falta la etiqueta', 'Es lo que lee el cliente en la rueda.');
    if (n.outcome === 'REWARD' && !n.rewardDefinitionId) return this.avisar('Falta la recompensa', 'Elige qué entrega ese sector.');
    if (n.outcome === 'RAFFLE_ENTRY' && !n.raffleId) return this.avisar('Falta la rifa', 'Elige de qué rifa son los boletos.');

    this.guardando.set(true);
    try {
      this.sectores.set(await this.loyalty.guardarSegmento({
        definitionId: d.id, label: n.label.trim(), outcome: n.outcome,
        rewardDefinitionId: n.rewardDefinitionId, raffleId: n.raffleId,
        quantity: n.quantity, weight: n.weight,
      }));
      this.sectorNuevo = { label: '', outcome: 'NONE', rewardDefinitionId: null, raffleId: null, quantity: 1, weight: 1 };
    } catch (e: any) {
      await this.avisar('No se pudo añadir', e?.message || 'Error.');
    } finally {
      this.guardando.set(false);
      this.cd.detectChanges();
    }
  }

  async cambiarPeso(sec: WheelSegment, peso: number): Promise<void> {
    const d = this.editandoSectores();
    if (!d) return;
    try {
      this.sectores.set(await this.loyalty.guardarSegmento({
        id: sec.id, definitionId: d.id, label: sec.label, outcome: sec.outcome,
        rewardDefinitionId: sec.reward_definition_id, raffleId: sec.raffle_id,
        quantity: sec.quantity, weight: Math.max(0, Number(peso) || 0), sortOrder: sec.sort_order,
      }));
    } catch (e: any) {
      await this.avisar('No se pudo cambiar', e?.message || 'Error.');
    } finally { this.cd.detectChanges(); }
  }

  /** Mover un sector cambia DONDE se pinta en la rueda. */
  async moverSector(sec: WheelSegment, delta: number): Promise<void> {
    const d = this.editandoSectores();
    if (!d) return;
    try {
      this.sectores.set(await this.loyalty.guardarSegmento({
        id: sec.id, definitionId: d.id, label: sec.label, outcome: sec.outcome,
        rewardDefinitionId: sec.reward_definition_id, raffleId: sec.raffle_id,
        quantity: sec.quantity, weight: sec.weight,
        sortOrder: Math.max(0, sec.sort_order + delta),
      }));
    } catch (e: any) {
      await this.avisar('No se pudo mover', e?.message || 'Error.');
    } finally { this.cd.detectChanges(); }
  }

  async quitarSector(sec: WheelSegment): Promise<void> {
    const d = this.editandoSectores();
    if (!d) return;
    const conf = await Swal.fire({
      icon: 'question',
      title: `¿Quitar "${sec.label}"?`,
      text: 'Dejará de salir en la ruleta. Los premios que ya entregó se conservan.',
      showCancelButton: true, confirmButtonText: 'Quitar', cancelButtonText: 'Cancelar',
    });
    if (!conf.isConfirmed) return;
    try {
      this.sectores.set(await this.loyalty.guardarSegmento({ id: sec.id, definitionId: d.id, label: sec.label, borrar: true }));
    } catch (e: any) {
      await this.avisar('No se pudo quitar', e?.message || 'Error.');
    } finally { this.cd.detectChanges(); }
  }

  readonly opcResultadoSector = [
    { valor: 'NONE', etiqueta: 'Sin premio' },
    { valor: 'REWARD', etiqueta: 'Una recompensa' },
    { valor: 'RAFFLE_ENTRY', etiqueta: 'Boletos de rifa' },
  ];

  // ------------------------------------------------------- vista previa
  /**
   * Probar una dinamica sin venta, sin premio y sin segundo monitor.
   *
   * Se abre la pantalla de cliente en una ventana normal -la MISMA pagina,
   * marcada como vista previa- y el juego corre en modo PREVIEW: no consume
   * intentos, no crea recompensas y no toca ninguna metrica.
   */
  async probar(d: DynamicDefinition): Promise<void> {
    if (d.type === 'WHEEL') {
      try {
        const secs = await this.loyalty.segmentos(d.id);
        this.sectores.set(secs);
        if (!secs.filter(x => x.active).length) {
          return this.avisar('Sin sectores', 'Añade sectores a la ruleta antes de probarla.');
        }
      } catch (e: any) {
        return this.avisar('No se pudieron leer los sectores', e?.message || 'Error.');
      }
    } else if (d.type !== 'TIMING') {
      return this.avisar('Todavía no', `La vista previa de ${d.type} llegará con su renderer.`);
    }
    this.abriendoVentana.set(true);
    try {
      const r = await (window as any).electronAPI?.customerPreviewOpen?.();
      if (r && r.ok === false) {
        // Se avisa, pero se juega igual: la ventana es un extra, no el juego.
        await this.avisar('No se pudo abrir la vista previa',
          `${r.error || 'Error.'} La dinámica se puede probar igualmente aquí.`);
      }
    } catch { /* sin ventana de cliente el juego sigue siendo jugable */ }
    finally { this.abriendoVentana.set(false); }
    this.probando.set(d);
    this.cd.detectChanges();
  }

  /** Cerrar la prueba, y con ella la ventana que se abrio para verla. */
  async cerrarPrueba(): Promise<void> {
    this.probando.set(null);
    try { await (window as any).electronAPI?.customerPreviewClose?.(); } catch { /* noop */ }
    this.cd.detectChanges();
  }

  /** Encender o apagar una dinamica sin abrir su formulario. */
  async alternarDinamica(d: DynamicDefinition): Promise<void> {
    this.guardando.set(true);
    try {
      await this.loyalty.guardarDefinicion('DYNAMIC', {
        id: d.id, name: d.name, type: d.type, description: d.description,
        targetValue: d.target_value, attemptsAllowed: d.attempts_allowed,
        rewardDefinitionId: d.reward_definition_id, active: !d.active,
      });
    } catch (e: any) {
      await this.avisar('No se pudo cambiar', e?.message || 'Error.');
    } finally {
      this.guardando.set(false);
      this.cd.detectChanges();
    }
  }

  // ================================================================= rifas
  nuevaRifa(): void {
    this.rifa.set({
      id: null, name: '', description: '', prize: '',
      // Nace en BORRADOR: se configura, y activarla es una decision aparte.
      // Una rifa que empieza repartiendo boletos en cuanto la guardas no deja
      // margen para revisar el premio o las fechas.
      startsAt: '', endsAt: '', winnersCount: 1, codePrefix: 'RIF',
      ticketsTotal: null, status: 'DRAFT',
    });
  }

  editarRifa(r: RaffleDefinition): void {
    this.rifa.set({
      id: r.id, name: r.name, description: r.description ?? '', prize: r.prize ?? '',
      startsAt: LoyaltyAdmin.fecha(r.starts_at), endsAt: LoyaltyAdmin.fecha(r.ends_at),
      winnersCount: r.winners_count, codePrefix: r.code_prefix ?? '',
      ticketsTotal: r.tickets_total ?? null, status: r.status,
    });
  }

  async guardarRifa(): Promise<void> {
    const d = this.rifa();
    if (!d) return;
    if (!d.name.trim()) return this.avisar('Falta el nombre', 'Ponle nombre a la rifa.');
    if (!d.prize.trim()) return this.avisar('Falta el premio', 'Di qué se rifa: es lo que va a leer el cliente.');

    this.guardando.set(true);
    try {
      await this.loyalty.guardarRifa({
        id: d.id, name: d.name.trim(), description: d.description.trim() || null,
        prize: d.prize.trim(), startsAt: d.startsAt || null, endsAt: d.endsAt || null,
        winnersCount: d.winnersCount, codePrefix: d.codePrefix.trim() || null,
        ticketsTotal: Number(d.ticketsTotal) > 0 ? Number(d.ticketsTotal) : null,
        status: d.status || null,
      });
      this.rifa.set(null);
      await this.exito('Rifa guardada');
    } catch (e: any) {
      await this.avisar('No se pudo guardar', e?.message || 'Error.');
    } finally {
      this.guardando.set(false);
      this.cd.detectChanges();
    }
  }

  /** Activar: de borrador a admitir boletos. */
  async activarRifa(r: RaffleDefinition): Promise<void> {
    this.guardando.set(true);
    try {
      await this.loyalty.guardarRifa({
        id: r.id, name: r.name, description: r.description, prize: r.prize,
        startsAt: r.starts_at, endsAt: r.ends_at, winnersCount: r.winners_count,
        codePrefix: r.code_prefix, ticketsTotal: r.tickets_total ?? null, status: 'OPEN',
      });
      await this.exito('Rifa activada');
      if (this.rifaSel()) await this.abrirRifa(r);
    } catch (e: any) {
      await this.avisar('No se pudo activar', e?.message || 'Error.');
    } finally {
      this.guardando.set(false);
      this.cd.detectChanges();
    }
  }

  /**
   * Cerrar: deja de admitir boletos y congela cuantos habia.
   *
   * Se pregunta y se dice el numero, porque ese numero es el que se anuncia y
   * ya no cambia. No se puede reabrir.
   */
  async cerrarRifa(r: RaffleDefinition): Promise<void> {
    const conf = await Swal.fire({
      icon: 'warning',
      title: `¿Cerrar ${r.name}?`,
      html: `Participan <b>${r.participaciones}</b> boletos.<br><br>` +
            'Al cerrar dejará de repartir boletos y ese número queda congelado: ' +
            'es el que se sorteará, aunque el sorteo sea dentro de una semana.<br><br>' +
            '<b>Una rifa cerrada no se puede reabrir.</b>',
      showCancelButton: true,
      confirmButtonText: 'Cerrar la rifa',
      cancelButtonText: 'Cancelar',
    });
    if (!conf.isConfirmed) return;

    this.guardando.set(true);
    try {
      const cerrada = await this.loyalty.cerrarRifa(r.id);
      await Swal.fire({
        icon: 'success',
        title: 'Rifa cerrada',
        text: `Quedaron ${cerrada?.closed_entries_count ?? r.participaciones} boletos participando.`,
      });
      if (this.rifaSel()) await this.abrirRifa(r);
    } catch (e: any) {
      await this.avisar('No se pudo cerrar', e?.message || 'Error.');
    } finally {
      this.guardando.set(false);
      this.cd.detectChanges();
    }
  }

  // ---------------------------------------------------------- instancias
  /** Lo repartido de verdad: recompensas o cupones emitidos. */
  async cargarInstancias(): Promise<void> {
    const tipo = this.seccion() === 'cupones' ? 'COUPON' : 'REWARD';
    this.cargandoInstancias.set(true);
    try {
      this.instancias.set(await this.loyalty.instancias(tipo, {
        estado: this.filtroEstado() || null,
        search: this.filtroTexto.trim() || null,
      }));
    } catch (e: any) {
      this.instancias.set([]);
      await this.avisar('No se pudo leer', e?.message || 'Error.');
    } finally {
      this.cargandoInstancias.set(false);
      this.cd.detectChanges();
    }
  }

  async verVista(v: 'definiciones' | 'emitidas'): Promise<void> {
    this.vista.set(v);
    this.premio.set(null);
    if (v === 'emitidas') await this.cargarInstancias();
  }

  async abrirRifa(r: RaffleDefinition): Promise<void> {
    this.rifaSel.set(r);
    this.cargandoDetalle.set(true);
    this.participaciones.set([]);
    this.ganadores.set([]);
    try {
      const d = await this.loyalty.detalleRifa(r.id);
      if (d.rifa) this.rifaSel.set(d.rifa);
      this.participaciones.set(d.participaciones);
      this.ganadores.set(d.ganadores);
    } catch (e: any) {
      await this.avisar('No se pudo abrir la rifa', e?.message || 'Error.');
      this.rifaSel.set(null);
    } finally {
      this.cargandoDetalle.set(false);
      this.cd.detectChanges();
    }
  }

  /** Volver al listado. Cierra la VISTA, no la rifa. */
  volverALista(): void {
    this.rifaSel.set(null);
    this.participaciones.set([]);
    this.ganadores.set([]);
  }

  /**
   * Sortear.
   *
   * Pregunta antes, y lo dice claro: el sorteo congela los boletos y no se
   * deshace. Alguien que pulse esto por error deja una rifa cerrada con
   * ganadores que no queria.
   */
  async sortear(): Promise<void> {
    const r = this.rifaSel();
    if (!r) return;
    const conf = await Swal.fire({
      icon: 'warning',
      title: `¿Sortear ${r.name}?`,
      // El universo ya se congelo al CERRAR: se repite ese numero para que
      // quien pulsa vea exactamente sobre cuantos boletos se va a sortear.
      html: `Se sorteará sobre los <b>${r.closed_entries_count ?? r.participaciones}</b> boletos ` +
            `congelados al cerrar, y se elegirán <b>${r.winners_count}</b> ` +
            `${r.winners_count === 1 ? 'ganador' : 'ganadores'}.<br><br>` +
            'El sorteo <b>no se puede deshacer</b>. Se guarda el algoritmo y la semilla ' +
            'para que pueda comprobarse después.',
      showCancelButton: true,
      confirmButtonText: 'Sortear',
      cancelButtonText: 'Cancelar',
    });
    if (!conf.isConfirmed) return;

    this.guardando.set(true);
    try {
      const ganadores = await this.loyalty.sortear({ raffleId: r.id });
      this.ganadores.set(ganadores);
      const lista = ganadores.map(g => `<li><b>${g.boleto}</b> — ${g.cliente || 'Sin cliente'}</li>`).join('');
      await Swal.fire({
        icon: 'success',
        title: 'Sorteo realizado',
        html: `<ul style="text-align:left;margin:0;padding-left:1.2em">${lista}</ul>`,
      });
      await this.abrirRifa(r);
    } catch (e: any) {
      await this.avisar('No se pudo sortear', e?.message || 'Error.');
    } finally {
      this.guardando.set(false);
      this.cd.detectChanges();
    }
  }

  async entregar(g: RaffleWinner): Promise<void> {
    try {
      const filas = await this.loyalty.marcarGanador({ winnerId: g.winner_id, status: 'DELIVERED' });
      this.ganadores.set(filas.length ? filas : this.ganadores());
      await this.exito('Premio entregado');
    } catch (e: any) {
      await this.avisar('No se pudo marcar', e?.message || 'Error.');
    } finally { this.cd.detectChanges(); }
  }

  /**
   * Descartar a un ganador y, si se pide, promover a su suplente.
   *
   * Pasa: el ganador no aparece. Sin esto la unica salida seria repetir el
   * sorteo entero, que castiga a todos los demas por uno.
   */
  async descartar(g: RaffleWinner): Promise<void> {
    const conf = await Swal.fire({
      icon: 'question',
      title: `¿Descartar el boleto ${g.boleto}?`,
      text: 'Se marcará como no reclamado. Si hay suplente, pasará a ocupar su lugar.',
      showCancelButton: true,
      confirmButtonText: 'Descartar',
      cancelButtonText: 'Cancelar',
    });
    if (!conf.isConfirmed) return;
    try {
      const filas = await this.loyalty.marcarGanador({
        winnerId: g.winner_id, status: 'FORFEITED', promoverSuplente: true,
      });
      this.ganadores.set(filas.length ? filas : this.ganadores());
    } catch (e: any) {
      await this.avisar('No se pudo descartar', e?.message || 'Error.');
    } finally { this.cd.detectChanges(); }
  }

  // ============================================================== ayudas
  /** El nombre de lo que reparte una campana, para la lista. */
  queReparte(c: any): string {
    if (c.premio_nombre) return c.premio_nombre;
    switch (c.outcome) {
      case 'REWARD': return 'Recompensa';
      case 'COUPON': return 'Cupón';
      case 'DYNAMIC': return 'Dinámica';
      case 'RAFFLE_ENTRY': return 'Boleto de rifa';
      default: return '—';
    }
  }

  /** La condicion de la campana en una linea legible. */
  condicion(c: any): string {
    const partes: string[] = [];
    if (c.min_total) partes.push(`Compra desde $${Number(c.min_total).toFixed(2)}`);
    if (c.per_amount) partes.push(`1 por cada $${Number(c.per_amount).toFixed(2)}`);
    if (c.product_id) partes.push('Producto concreto');
    if (c.first_purchase_only) partes.push('Solo primera compra');
    if (c.requires_customer) partes.push('Requiere cliente');
    const dias = LoyaltyAdmin.mascaraADias(c.weekday_mask);
    if (dias.some(d => !d)) {
      partes.push(this.diasSemana.filter((_, i) => dias[i]).join(' '));
    }
    if (c.time_from && c.time_to) {
      partes.push(`${LoyaltyAdmin.hora(c.time_from)}–${LoyaltyAdmin.hora(c.time_to)}`);
    }
    return partes.length ? partes.join(' · ') : 'Cualquier venta';
  }

  etiquetaTipo(k: string): string {
    return k === 'FREE_PRODUCT' ? 'Producto gratis' : k === 'AMOUNT' ? 'Importe' : k === 'PERCENT' ? 'Porcentaje' : k;
  }

  valorPremio(r: { kind: string; product_name?: string | null; amount: number | null; discount_pct: number | null }): string {
    if (r.kind === 'FREE_PRODUCT') return r.product_name || 'Producto';
    if (r.kind === 'AMOUNT') return `$${Number(r.amount ?? 0).toFixed(2)}`;
    if (r.kind === 'PERCENT') return `${Number(r.discount_pct ?? 0)}%`;
    return '—';
  }

  estadoRifa(s: string): string {
    return s === 'DRAFT' ? 'Borrador' : s === 'OPEN' ? 'Activa'
      : s === 'CLOSED' ? 'Cerrada' : s === 'DRAWN' ? 'Sorteada' : s;
  }

  /** Que se puede hacer con una rifa segun donde este de su ciclo. */
  puedeActivar(r: { status: string }): boolean { return r.status === 'DRAFT'; }
  puedeCerrar(r: { status: string }): boolean { return r.status === 'OPEN'; }
  puedeSortear(r: { status: string }): boolean { return r.status === 'CLOSED'; }

  /**
   * Un cupon de importe o porcentaje se emite y se valida, pero la caja
   * todavia no puede aplicarlo: la venta no tiene concepto de descuento. Se
   * avisa AL CREARLO para que nadie reparta papeles que no se pueden canjear.
   */
  beneficioSinCanje(kind: string): boolean {
    return kind === 'AMOUNT' || kind === 'PERCENT';
  }


  /** Los estados que escribe SQL: WINNER, ALTERNATE, DELIVERED, FORFEITED. */
  estadoGanador(s: string): string {
    return s === 'WINNER' ? 'Por entregar' : s === 'DELIVERED' ? 'Entregado'
      : s === 'FORFEITED' ? 'No reclamado' : s === 'ALTERNATE' ? 'Suplente' : s;
  }

  /**
   * Los siete dias como bits, empezando en lunes.
   *
   * `null` significa "todos": una campana sin restriccion de dia no debe
   * verse con los siete apagados, que es justo lo contrario de lo que hace.
   */
  private static mascaraADias(m: number | null | undefined): boolean[] {
    if (m === null || m === undefined) return [true, true, true, true, true, true, true];
    return Array.from({ length: 7 }, (_, i) => (Number(m) & (1 << i)) !== 0);
  }

  /** Los siete dias encendidos se guardan como NULL: sin restriccion. */
  private static diasAMascara(dias: boolean[]): number | null {
    if (dias.every(Boolean)) return null;
    return dias.reduce((a, d, i) => a + (d ? (1 << i) : 0), 0);
  }

  /** `2026-09-11T00:00:00` -> `2026-09-11`, para el input date. */
  private static fecha(v: string | null | undefined): string {
    return v ? String(v).slice(0, 10) : '';
  }

  /** `14:30:00` -> `14:30`, para el input time. */
  private static hora(v: string | null | undefined): string {
    if (!v) return '';
    const s = String(v);
    // SQL Server puede devolver TIME como Date: en ese caso interesa la hora
    // local del propio valor, no un slice del ISO, que estaria desplazado.
    const m = s.match(/(\d{2}):(\d{2})/);
    return m ? `${m[1]}:${m[2]}` : '';
  }

  /**
   * Generar codigos de un cupon para repartirlos a mano.
   *
   * Sin esto, definir un cupon no producia ni un solo codigo usable: habia
   * que crear ademas una campana que lo entregase y esperar a que alguien
   * comprase. El caso de repartir un taco de volantes no tenia camino.
   */
  async emitirCupones(c: CouponDefinition): Promise<void> {
    if (!c.active) {
      return this.avisar('El cupón está apagado',
        'Enciéndelo antes de emitirlo: los códigos repartidos no se podrían canjear.');
    }

    const r = await Swal.fire({
      title: `Emitir cupones de "${c.name}"`,
      input: 'number',
      inputLabel: '¿Cuántos códigos?',
      inputValue: '10',
      inputAttributes: { min: '1', max: '500', step: '1' },
      showCancelButton: true,
      confirmButtonText: 'Emitir',
      cancelButtonText: 'Cancelar',
      inputValidator: (v) => {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 500) return 'Entre 1 y 500.';
        return null;
      },
    });
    if (!r.isConfirmed) return;

    this.guardando.set(true);
    try {
      const codigos = await this.loyalty.emitirCupones(c.id, Number(r.value));
      /* Se ensenan los codigos aqui mismo. Emitirlos y mandar a buscarlos a
         la pestana de al lado obliga a filtrar y adivinar cuales son los
         que se acaban de crear. */
      await Swal.fire({
        icon: 'success',
        title: `${codigos.length} ${codigos.length === 1 ? 'cupón emitido' : 'cupones emitidos'}`,
        html: `<div style="text-align:left;max-height:38vh;overflow:auto;font-family:monospace;
                          font-size:13px;line-height:1.8">${
          codigos.map(x => x.code).join('<br>')
        }</div>`,
        confirmButtonText: 'Listo',
      });
      this.vista.set('emitidas');
      await this.cargarInstancias();
    } catch (e: any) {
      await this.avisar('No se pudieron emitir', e?.message || 'Error.');
    } finally {
      this.guardando.set(false);
      this.cd.detectChanges();
    }
  }

  /** Que porcentaje de los boletos se ha repartido. Se topa en 100. */
  progresoBoletos(r: RaffleDefinition): number {
    const total = Number(r.tickets_total) || 0;
    if (total <= 0) return 0;
    return Math.min(100, Math.round((Number(r.participaciones) || 0) * 100 / total));
  }

  private avisar(title: string, text: string): Promise<any> {
    return Swal.fire({ icon: 'warning', title, text });
  }

  private exito(title: string): Promise<any> {
    return Swal.fire({ icon: 'success', title, timer: 1100, showConfirmButton: false });
  }
}
