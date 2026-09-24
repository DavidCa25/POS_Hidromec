import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService, PAQUETES } from '../../services/auth.service';
import { CapabilityService, GiroServiciosService } from '../../core';
import { LicenseService } from '../../services/license.service';
import { EstadoMascota } from '../wx-mascota/wx-mascota.component';
import { VarianteMascota, varianteDeSesion } from '../wx-mascota/variantes';

/**
 * LA GUÍA DE WYBIX — el estado del negocio, en un solo sitio.
 *
 * ================================================================
 * QUÉ ES, Y QUÉ NO
 * ================================================================
 * NO es un asistente, ni un chatbot, ni un sitio donde preguntarle algo a
 * Wybix. No hay campo de texto y no hay nada que escribir.
 *
 * Es el resumen de tres cosas, leídas del sistema real:
 *
 *   1. qué está pasando ahora mismo;
 *   2. qué necesita una decisión;
 *   3. a dónde ir para resolverlo.
 *
 * El personaje es la cara de ese resumen, no un botón simpático con una figura
 * dentro. Si un día el resumen desapareciera, el personaje desaparecería con
 * él: no está para acompañar.
 *
 * ================================================================
 * NO HAY UN SEGUNDO MOTOR DE ALERTAS
 * ================================================================
 * Todo sale de canales que YA EXISTEN: `alerts:counts`, el turno abierto, las
 * órdenes de servicio y el catálogo. Construir aquí un motor propio habría
 * dado dos verdades sobre el mismo negocio, y la que el usuario ve primero
 * habría sido la del muñeco.
 *
 * ================================================================
 * LO QUE NO SE OFRECE
 * ================================================================
 * Cada aviso declara el PAQUETE que hace falta para resolverlo. A quien no lo
 * tiene no se le ofrece la acción: se le dice que hace falta un administrador
 * y se acabó. Ofrecer un botón que después rebota es peor que no ofrecer nada.
 *
 * Y el ORDEN lo decide el giro: un taller mira primero sus órdenes, una
 * barbería su agenda y una tienda su caja. Es el mismo negocio con distinta
 * urgencia, no distintas alertas.
 */

export type TonoGuia = 'peligro' | 'aviso' | 'ok';

export type AvisoGuia = {
  /** El dominio al que pertenece: «Inventario», «Caja», «Servicios». */
  area: string;
  texto: string;
  tono: TonoGuia;
  /** A dónde se va a resolverlo. Vacío = no hay nada que pulsar. */
  ruta?: string;
  icono: string;
  /** Lo que hace falta para poder resolverlo. */
  paquete?: string;
};

export type DatoGuia = { etiqueta: string; valor: string };

@Injectable({ providedIn: 'root' })
export class GuiaService {
  private readonly auth = inject(AuthService);
  private readonly caps = inject(CapabilityService);
  private readonly license = inject(LicenseService);
  private readonly giro = inject(GiroServiciosService);

  /**
   * LA CARA DE WYBIX EN ESTA SESIÓN.
   *
   * Se calcula UNA vez, al entrar, y no cambia mientras dure la sesión: si
   * se sorteara al pintar, Wybix cambiaría de personaje entre pantallas —y
   * entre fotogramas—, que no es variedad sino parpadeo.
   *
   * Al día siguiente, con otra sesión, puede tocar otra. Esa es la idea:
   * que se note que hoy se ve distinto sin dejar de ser Wybix. El estado
   * —idle, atención, éxito— cambia la EXPRESIÓN, nunca la identidad.
   */
  readonly variante = signal<VarianteMascota>(varianteDeSesion(null));

  /** Fija la cara de esta sesión. La llama el arranque, una sola vez. */
  fijarVariante(idSesion: string | null | undefined) {
    this.variante.set(varianteDeSesion(idSesion));
  }

  readonly abierta = signal(false);
  readonly cargando = signal(true);

  /** Lo que se ha podido leer del negocio. Vacío mientras no llegue. */
  private readonly avisosCrudos = signal<AvisoGuia[]>([]);
  private readonly datos = signal<DatoGuia[]>([]);
  private readonly fallo = signal(false);

  private pedido = false;

  abrir() { this.abierta.set(true); void this.cargar(); }
  cerrar() { this.abierta.set(false); }
  alternar() { this.abierta.update(v => !v); if (this.abierta()) void this.cargar(); }

  // ------------------------------------------------------------- permisos
  private puede(paquete?: string): boolean {
    return !paquete || this.auth.puede(paquete);
  }

  /**
   * Los avisos que ESTA persona puede resolver, y los que solo puede ver.
   *
   * No se esconden los que no puede resolver: enterarse de que falta stock es
   * útil aunque no seas tú quien lo repone. Lo que se quita es la ACCIÓN.
   */
  readonly avisos = computed<AvisoGuia[]>(() =>
    this.avisosCrudos().map(a => this.puede(a.paquete) ? a : { ...a, ruta: undefined }));

  readonly hayPendientes = computed(() => this.avisos().some(a => a.tono !== 'ok'));

  readonly resumen = computed<DatoGuia[]>(() => this.datos());

  /** Alguno requiere un permiso que esta persona no tiene. */
  readonly necesitaAdmin = computed(() =>
    this.avisosCrudos().some(a => a.tono !== 'ok' && !this.puede(a.paquete)));

  readonly estado = computed<EstadoMascota>(() => {
    if (this.fallo()) return 'error';
    return this.hayPendientes() ? 'atencion' : 'idle';
  });

  /** Una línea. Wybix no habla todo el rato. */
  readonly frase = computed<string>(() => {
    if (this.cargando()) return 'Mirando cómo va el día…';
    if (this.fallo()) return 'No pude leer el estado del negocio.';
    const n = this.avisos().filter(a => a.tono !== 'ok').length;
    if (!n) return 'Todo tranquilo por aquí.';
    return n === 1 ? 'Una cosa necesita tu atención.' : `${n} cosas necesitan tu atención.`;
  });

  // ------------------------------------------------------------ acciones
  /**
   * Lo que se puede hacer AHORA, según el giro.
   *
   * Dos como mucho: esto es un resumen, y el botón de crear del dock ya tiene
   * la lista completa.
   */
  readonly acciones = computed<{ texto: string; ruta: string; icono: string }[]>(() => {
    const out: { texto: string; ruta: string; icono: string }[] = [];
    const servicios = this.caps.servicios
      && (this.auth.puede(PAQUETES.SERVICIOS_OPERAR) || this.auth.puede(PAQUETES.SERVICIOS_ADMINISTRAR));

    /* Una barbería empieza el día en la agenda; un taller, en sus órdenes. */
    if (servicios && this.giro.usaAgenda && this.giro.inicio === 'agenda') {
      out.push({ texto: 'Ver la agenda de hoy', ruta: '/dashboard/ordenes-de-servicio/agenda', icono: 'ph-calendar-dots' });
    }
    if (this.auth.puede(PAQUETES.VENTAS_OPERAR)) {
      out.push({ texto: 'Nueva venta', ruta: '/dashboard/venta', icono: 'ph-cash-register' });
    }
    if (servicios && out.length < 2) {
      out.push({ texto: 'Ver órdenes', ruta: '/dashboard/ordenes-de-servicio/ordenes', icono: 'ph-wrench' });
    }
    if (this.auth.puede(PAQUETES.INVENTARIO_OPERAR) && out.length < 2) {
      out.push({ texto: 'Revisar inventario', ruta: '/dashboard/inventario', icono: 'ph-package' });
    }
    return out.slice(0, 2);
  });

  // --------------------------------------------------------------- datos
  /**
   * Se lee una vez por sesión y se refresca al abrir.
   *
   * Cada llamada lleva su propio catch: que Servicios no conteste no puede
   * dejar sin estado a la caja.
   */
  async cargar(forzar = false): Promise<void> {
    if (this.pedido && !forzar) return;
    this.pedido = true;

    const api = (window as any).electronAPI;
    if (!api) { this.cargando.set(false); return; }

    this.cargando.set(true);
    const pedir = <T>(p: Promise<T> | undefined) =>
      (p ?? Promise.resolve(null as any)).catch(() => null);

    /* La cara de esta sesion, decidida UNA vez. `abiertaEn` cambia al
       entrar, asi que manana toca otra variante; dentro de la sesion no se
       mueve. */
    try {
      const s = await pedir(api.sesion?.());
      const d = (s as any)?.data;
      if (d) this.fijarVariante(`${d.userId}:${d.abiertaEn ?? ''}`);
    } catch { /* sin sesion: se queda la de siempre */ }

    const verNumeros = this.auth.puede(PAQUETES.REPORTES_VER);
    const operarVentas = this.auth.puede(PAQUETES.VENTAS_OPERAR);
    const operarInv = this.auth.puede(PAQUETES.INVENTARIO_OPERAR);
    const servicios = this.caps.servicios
      && (this.auth.puede(PAQUETES.SERVICIOS_OPERAR) || this.auth.puede(PAQUETES.SERVICIOS_ADMINISTRAR));

    const [cuentas, turno, hoy, ords, cargas] = await Promise.all([
      pedir(api.alertsCounts?.({ min: 3 })),
      operarVentas ? pedir(api.getOpenShift?.()) : Promise.resolve(null),
      verNumeros ? pedir(api.getSalesDayly?.()) : Promise.resolve(null),
      servicios ? pedir(api.serviciosOrdenes?.({})) : Promise.resolve(null),
      /* Las cargas a medias. Leerlas no exige permiso: saber que el catalogo
         esta vacio no es informacion sensible, y sin esto un cajero veria
         Inicio como si no pasara nada. */
      pedir(api.qsCargas?.({ historial: false })),
    ]);

    this.fallo.set(cuentas === null && turno === null && hoy === null);

    // ---------------------------------------------------------- el resumen
    const resumen: DatoGuia[] = [];
    const t = turno?.data ?? turno?.turno ?? null;
    if (operarVentas) {
      resumen.push({ etiqueta: 'Caja', valor: t ? 'Abierta' : 'Sin turno abierto' });
    }
    const vendido = Number(hoy?.data?.[0]?.total_sales_today ?? NaN);
    if (Number.isFinite(vendido)) {
      resumen.push({
        etiqueta: 'Vendido hoy',
        valor: vendido.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }),
      });
    }
    this.datos.set(resumen);

    // ----------------------------------------------------------- lo parado
    const c = cuentas?.data ?? {};
    const lista: AvisoGuia[] = [];

    /* ------------------------------------------------ el catalogo vacio
     * Va PRIMERO a proposito: sin catalogo no hay nada que vender, asi que
     * cualquier otro aviso -«no hay turno abierto»- es ruido. Y se ofrece,
     * no se impone: Wybix no bloquea la navegacion para esto.
     */
    /* Una demo viene sembrada: ofrecerle cargar el catalogo seria ofrecerle
       resolver un problema que no tiene. QuickStart sigue accesible por su
       ruta para poder probarlo, pero no se ofrece solo. */
    const sinCatalogo = Number(c?.productos ?? NaN) === 0 && !this.license.esDemo;
    if (sinCatalogo && operarInv) {
      lista.push({
        area: 'Catálogo', texto: 'Todavía no tienes productos',
        tono: 'aviso', icono: 'ph-package',
        ruta: '/dashboard/quickstart', paquete: PAQUETES.INVENTARIO_OPERAR,
      });
    }

    /* Una carga a medias no se olvida. Es trabajo de alguien esperando. */
    const vivas = (cargas?.data ?? []).filter((x: any) => x.estado !== 'IMPORTADA');
    if (vivas.length && operarInv) {
      lista.push({
        area: 'Catálogo',
        texto: vivas.length === 1
          ? `«${vivas[0].etiqueta}» está a medias`
          : `${vivas.length} cargas sin terminar`,
        tono: 'aviso', icono: 'ph-tray',
        ruta: '/dashboard/quickstart', paquete: PAQUETES.INVENTARIO_OPERAR,
      });
    }

    if (operarVentas && !t) {
      lista.push({
        area: 'Caja', texto: 'No hay turno abierto',
        tono: 'aviso', icono: 'ph-vault',
        ruta: '/dashboard/venta', paquete: PAQUETES.VENTAS_OPERAR,
      });
    }

    const agotados = Number(c.agotados || 0);
    const bajos = Number(c.lowstock || 0);
    if (agotados + bajos > 0) {
      const n = agotados + bajos;
      lista.push({
        area: 'Inventario',
        texto: `${n} ${n === 1 ? 'producto por reponer' : 'productos por reponer'}`,
        tono: agotados > 0 ? 'peligro' : 'aviso', icono: 'ph-package',
        ruta: '/dashboard/alertas', paquete: PAQUETES.INVENTARIO_OPERAR,
      });
    }

    const vencidos = Number(c.vencidos || 0);
    if (vencidos > 0) {
      lista.push({
        area: 'Clientes',
        texto: `${vencidos} con saldo vencido`,
        tono: 'aviso', icono: 'ph-users',
        ruta: '/dashboard/clientes', paquete: PAQUETES.VENTAS_OPERAR,
      });
    }

    const descuadres = Number(c.descuadres || 0);
    if (descuadres > 0) {
      lista.push({
        area: 'Caja',
        texto: `${descuadres} ${descuadres === 1 ? 'corte descuadrado' : 'cortes descuadrados'}`,
        /* Revisar un descuadre es supervisión, no operación de caja. */
        tono: 'peligro', icono: 'ph-calendar-check',
        ruta: '/dashboard/alertas', paquete: PAQUETES.VENTAS_SUPERVISAR,
      });
    }

    if (servicios) {
      const filas = Array.isArray(ords?.data) ? ords.data : [];
      const porEntregar = filas.filter((o: any) =>
        String(o.status || '').toUpperCase() === 'TERMINADA'
        && String(o.economic_status || '') !== 'SIN_COBRAR').length;
      if (porEntregar > 0) {
        lista.push({
          area: 'Servicios',
          texto: `${porEntregar} ${porEntregar === 1 ? 'orden lista para entregar' : 'órdenes listas para entregar'}`,
          tono: 'aviso', icono: 'ph-wrench',
          ruta: '/dashboard/ordenes-de-servicio/ordenes', paquete: PAQUETES.SERVICIOS_OPERAR,
        });
      }
      const sinAutorizar = filas.filter((o: any) =>
        String(o.status || '').toUpperCase() === 'ABIERTA' && o.authorized === false).length;
      if (sinAutorizar > 0) {
        lista.push({
          area: 'Servicios',
          texto: `${sinAutorizar} ${sinAutorizar === 1 ? 'orden sin autorizar' : 'órdenes sin autorizar'}`,
          tono: 'aviso', icono: 'ph-seal-question',
          ruta: '/dashboard/ordenes-de-servicio/ordenes', paquete: PAQUETES.SERVICIOS_OPERAR,
        });
      }
    }

    /*
     * EL ORDEN LO DECIDE EL GIRO.
     *
     * Lo urgente no es lo mismo en una tienda que en un taller. Se ordena por
     * gravedad primero -un agotado antes que un aviso- y dentro de la misma
     * gravedad manda el area que este giro mira primero.
     */
    const prioridad = this.prioridadPorGiro();
    const peso = (a: AvisoGuia) => (a.tono === 'peligro' ? 0 : 1) * 100
      + (prioridad.indexOf(a.area) < 0 ? 50 : prioridad.indexOf(a.area));
    lista.sort((a, b) => peso(a) - peso(b));

    this.avisosCrudos.set(lista);
    this.cargando.set(false);
  }

  /** Qué mira primero cada clase de negocio. */
  private prioridadPorGiro(): string[] {
    if (this.caps.servicios) {
      return this.giro.inicio === 'agenda'
        ? ['Servicios', 'Clientes', 'Caja', 'Inventario']       // barbería
        : ['Servicios', 'Inventario', 'Caja', 'Clientes'];      // taller
    }
    if (this.caps.hospitality) return ['Caja', 'Inventario', 'Clientes'];
    return ['Caja', 'Inventario', 'Clientes'];                  // tienda
  }
}
