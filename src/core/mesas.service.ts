import { Injectable, computed, inject } from '@angular/core';
import { Cart, CartLine, CartService } from './cart.service';
import { CartCustomer, SelectedOption } from './models';

/** Una mesa tal como la ensena el salon. El estado es de tres palabras. */
export interface MesaSalon {
  id: number;
  area_id: number;
  nombre: string;
  capacidad: number | null;
  estado: 'LIBRE' | 'ABIERTA' | 'POR_COBRAR';
  cuenta_id: number | null;
  minutos: number | null;
  total: number;
  lineas: number;
  comandas_pendientes: number;
  comandas_listas: number;
}

export interface AreaSalon { id: number; nombre: string; orden: number; }

/** Lo que el carrito sabe de la cuenta a la que pertenece. */
export interface CuentaEnCarrito {
  id: number;
  titulo: string;
  /** Numero de pedido del dia, solo en una cuenta sin mesa: el que se le dice al cliente. */
  numero: number | null;
  /** El cliente de la cuenta (`hosp_cuentas.customer_id`), si tiene. */
  clienteId: number | null;
  mesaId: number | null;
  area: string | null;
  estado: string;
}

type Resultado<T = void> = { ok: true; datos: T } | { ok: false; error: string };

/** Un UUID v4. `crypto.randomUUID` no existe fuera de un contexto seguro. */
function nuevoOrigen(): string {
  const c: any = (globalThis as any).crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  const b: Uint8Array = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * LA MESA SOBRE EL CARRITO DE SIEMPRE.
 *
 * No hay un segundo carrito ni un segundo checkout. Una cuenta de mesa vive
 * en la base -la ven las demas cajas y la cocina, y sobrevive a un
 * reinicio- y, mientras alguien la atiende, se trabaja en una cuenta normal
 * de `CartService` marcada con `meta.cuentaMesa`:
 *
 *   lineas con `enviada`   ya estan en la base (y en cocina, si se preparan)
 *   lineas sin `enviada`   lo que se esta tomando ahora
 *
 * ENVIAR manda las segundas y vuelve a leer la cuenta. COBRAR es el cobro de
 * siempre (`SaleService.checkout`) con todas las lineas; despues la cuenta se
 * enlaza a la venta y la mesa queda libre. Es el mismo patron que una orden
 * de servicio: la venta no sabe nada de mesas.
 */
@Injectable({ providedIn: 'root' })
export class MesaService {
  private readonly cart = inject(CartService);

  private get api(): any { return (window as any).wybix; }

  /** La cuenta de mesa del carrito activo, si lo es. */
  readonly cuentaActiva = computed<CuentaEnCarrito | null>(() => {
    this.cart.version();
    return (this.cart.activeCart().meta?.['cuentaMesa'] as CuentaEnCarrito) ?? null;
  });

  /** Lo que se ha tomado y aun no se ha enviado. */
  readonly pendientes = computed<CartLine[]>(() => {
    this.cart.version();
    return this.cuentaActiva() ? this.cart.activeCart().lines.filter(l => l.enviada == null) : [];
  });

  // ---------------------------------------------------------------- salon
  async salon(): Promise<Resultado<{ areas: AreaSalon[]; mesas: MesaSalon[] }>> {
    try {
      const r = await this.api?.salon?.get();
      if (!r?.success) return { ok: false, error: r?.error || 'No se pudo leer el salón.' };
      const [areas = [], mesas = []] = r.sets || [];
      return {
        ok: true,
        datos: {
          areas,
          mesas: mesas.map((m: any) => ({ ...m, total: Number(m.total || 0) })),
        },
      };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'No se pudo leer el salón.' };
    }
  }

  // -------------------------------------------------------------- abrir
  /**
   * Abre la mesa (o toma su cuenta si ya la tiene) y la carga en el carrito.
   *
   * `adoptar` es la cuenta de la caja en la que ya se estaba tomando el
   * pedido: lo que tenga pasa a la mesa. Asi se elige la mesa DESDE Venta, a
   * mitad del pedido, sin perder nada ni abrir otra pestana.
   */
  async abrirMesa(mesaId: number, adoptar?: Cart): Promise<Resultado<CuentaEnCarrito>> {
    /* El cliente que ya tenia el pedido pasa a la mesa (si ella no tenia). */
    const r = await this.api?.cuentas?.abrir({ mesaId, customerId: this.clienteAdoptable(adoptar) });
    if (!r?.success) return { ok: false, error: r?.error || 'No se pudo abrir la mesa.' };
    return this.cargar(Number(r.sets?.[0]?.[0]?.id), adoptar);
  }

  /** Una cuenta sin mesa: la barra, un «para llevar» que espera. */
  async abrirCuenta(etiqueta: string, adoptar?: Cart): Promise<Resultado<CuentaEnCarrito>> {
    const r = await this.api?.cuentas?.abrir({ etiqueta, customerId: this.clienteAdoptable(adoptar) });
    if (!r?.success) return { ok: false, error: r?.error || 'No se pudo abrir la cuenta.' };
    return this.cargar(Number(r.sets?.[0]?.[0]?.id), adoptar);
  }

  private clienteAdoptable(adoptar?: Cart): number | null {
    return adoptar && !adoptar.meta?.['cuentaMesa'] ? (adoptar.customer?.id ?? null) : null;
  }

  // -------------------------------------------------------------- cliente
  /**
   * Elegir, cambiar o quitar el cliente de la venta: EL contrato de Venta y
   * Touch. Sin cuenta, vive solo en el carrito (`cart.customer`). Con cuenta
   * de Hospitality, la cuenta es la fuente (`hosp_cuentas.customer_id`): se
   * guarda ahi primero y el carrito la refleja, para que la otra caja, la
   * cocina y el tablero de pedidos vean lo mismo.
   */
  async fijarCliente(c: CartCustomer | null): Promise<Resultado> {
    const cuenta = this.cuentaActiva();
    if (cuenta) {
      const r = await this.api?.cuentas?.cliente({ cuentaId: cuenta.id, customerId: c?.id ?? null });
      if (!r?.success) return { ok: false, error: r?.error || 'No se pudo cambiar el cliente de la cuenta.' };
      cuenta.clienteId = c?.id ?? null;
    }
    this.cart.setCustomer(c);
    return { ok: true, datos: undefined };
  }

  /** Vuelve a leer la cuenta activa: lo que la cocina ya preparo, lo que otra caja pidio. */
  async refrescar(): Promise<void> {
    const c = this.cuentaActiva();
    if (c) await this.cargar(c.id);
  }

  /**
   * Trae la cuenta de la base al carrito.
   *
   * Si esta caja ya la tenia abierta en una pestana, se usa esa: las lineas
   * enviadas se sustituyen por lo que dice la base -otra caja pudo pedir mas-
   * y las no enviadas se conservan, porque son trabajo de quien esta aqui.
   */
  async cargar(cuentaId: number, adoptar?: Cart): Promise<Resultado<CuentaEnCarrito>> {
    if (!cuentaId) return { ok: false, error: 'Falta la cuenta.' };
    const r = await this.api?.cuentas?.obtener({ cuentaId });
    if (!r?.success) return { ok: false, error: r?.error || 'No se pudo leer la cuenta.' };
    const [cab = [], lineas = [], opciones = []] = r.sets || [];
    const c = cab[0];
    if (!c) return { ok: false, error: 'La cuenta no existe.' };
    if (c.estado !== 'ABIERTA' && c.estado !== 'POR_COBRAR') {
      return { ok: false, error: 'Esta cuenta ya está cerrada.' };
    }

    const cuenta: CuentaEnCarrito = {
      id: c.id, titulo: c.titulo, numero: c.numero_dia != null ? Number(c.numero_dia) : null,
      clienteId: c.customer_id != null ? Number(c.customer_id) : null,
      mesaId: c.mesa_id ?? null, area: c.area ?? null, estado: c.estado,
    };

    /* Solo se adopta una cuenta que no es de otra mesa. */
    const adoptable = adoptar && !adoptar.meta?.['cuentaMesa'] ? adoptar : null;
    const carrito = this.carritoDe(cuenta.id) ?? adoptable ?? this.nuevoCarrito();
    if (!carrito) {
      return { ok: false, error: 'No hay cuentas libres en esta caja: cobra o cierra alguna y vuelve a intentarlo.' };
    }
    this.cart.switchTo(carrito.id);

    /* Lo que la base ya tiene (por su origen) no se queda como pendiente: si
       un envio llego pero su respuesta no, la linea aparece una vez, enviada. */
    const enBase = new Set((lineas as any[]).map(l => String(l.origen ?? '').toLowerCase()).filter(Boolean));
    const aun = (l: CartLine) => l.enviada == null && !(l.origen && enBase.has(l.origen.toLowerCase()));
    let pendientes = carrito.lines.filter(aun);
    if (adoptable && adoptable !== carrito) {
      /* La mesa ya estaba abierta en otra pestana: lo tomado aqui se le suma
         y esta pestana, ya vacia, se cierra. */
      pendientes = [...pendientes, ...adoptable.lines.filter(aun)];
      adoptable.lines = [];
      this.cart.closeCart(adoptable.id);
      this.cart.switchTo(carrito.id);
    }
    const enviadas = (lineas as any[])
      .filter(l => l.estado === 'ACTIVA')
      .map(l => {
        const ops: SelectedOption[] = (opciones as any[])
          .filter(o => o.linea_id === l.id)
          .map(o => ({
            groupId: Number(o.group_id), optionId: Number(o.modifier_option_id),
            groupName: String(o.group_name ?? ''), optionName: String(o.option_name),
            priceDelta: Number(o.price_delta || 0), quantity: Number(o.quantity || 1),
          }));
        const linea = this.cart.makeLine({
          productId: Number(l.product_id),
          productName: String(l.nombre),
          unitPrice: Number(l.precio_unitario),
          claveProdServ: l.clave_prod_serv ?? null,
          claveUnidad: l.clave_unidad ?? null,
          objetoImpuesto: l.objeto_impuesto ?? null,
          tasaIva: l.tasa_iva != null ? Number(l.tasa_iva) : null,
          inventoryMode: l.inventory_mode,
        }, Number(l.cantidad), ops);
        linea.note = l.nota ?? null;
        linea.enviada = Number(l.id);
        linea.origen = l.origen ? String(l.origen).toLowerCase() : null;
        linea.prep = { estacion: l.estacion ?? null, estado: l.comanda_estado ?? null };
        return linea;
      });

    carrito.lines = [...enviadas, ...pendientes];
    /* Una mesa es «aqui». Una cuenta sin mesa conserva lo que la caja eligio. */
    if (cuenta.mesaId) carrito.serviceMode = 'DINE_IN';
    carrito.meta = { ...(carrito.meta ?? {}), cuentaMesa: cuenta };
    /* El cliente es el de la cuenta. Si el carrito ya lo tenia (con sus datos
       fiscales, de Venta) se conserva ese objeto; si la cuenta no tiene, el
       carrito tampoco. */
    carrito.customer = cuenta.clienteId == null ? null
      : carrito.customer?.id === cuenta.clienteId ? carrito.customer
      : { id: cuenta.clienteId, name: String(c.customer_name ?? '') };
    this.cart.version.update(v => v + 1);
    return { ok: true, datos: cuenta };
  }

  private carritoDe(cuentaId: number): Cart | null {
    return this.cart.carts().find(c => (c.meta?.['cuentaMesa'] as CuentaEnCarrito)?.id === cuentaId) ?? null;
  }

  /**
   * Una pestana para la cuenta. Si ya no caben, se cierra la de otra mesa
   * que no tenga nada sin enviar: su contenido esta en la base y vuelve
   * entero al tocar la mesa otra vez. Nunca se cierra una con trabajo a medias.
   */
  private nuevoCarrito(): Cart | null {
    const creada = this.cart.createCart();
    if (creada) return creada;
    const liberable = this.cart.carts().find(c =>
      c.meta?.['cuentaMesa'] && c.lines.every(l => l.enviada != null));
    if (!liberable) return null;
    this.cart.closeCart(liberable.id);
    return this.cart.createCart();
  }

  // ---------------------------------------------------- antes de cobrar
  /**
   * Lo que aun no se envio y SI va a preparacion: productos con una estacion
   * activa, la misma regla con la que la base crea comandas. Una botella de
   * agua no cuenta. Sirve para no cobrar en silencio algo que la cocina nunca
   * recibio.
   */
  async pendientesDePreparacion(lineas: CartLine[]): Promise<CartLine[]> {
    const nuevas = lineas.filter(l => l.enviada == null);
    if (!nuevas.length || !this.api?.cuentas?.preparacion) return [];
    const ids = [...new Set(nuevas.map(l => Number(l.productId)).filter(n => Number.isInteger(n) && n > 0))];
    const r = await this.api.cuentas.preparacion({ productIds: ids });
    if (!r?.success) return [];
    const conEstacion = new Set((r.data || []).map((x: any) => Number(x.product_id)));
    return nuevas.filter(l => conEstacion.has(Number(l.productId)));
  }

  // -------------------------------------------------------------- enviar
  /**
   * Envia lo pendiente de la cuenta activa. Devuelve cuantas comandas se
   * crearon y las que no se pudieron imprimir, para decirlo en pantalla.
   */
  async enviar(opciones: { sinMesa?: string } = {}): Promise<Resultado<{ comandas: number; sinImprimir: string[] }>> {
    let cuenta = this.cuentaActiva();
    /* «Para llevar» no tiene mesa, pero la cocina necesita una cuenta a la que
       colgar la comanda: se abre una con nombre al ENVIAR, nunca antes. */
    if (!cuenta && opciones.sinMesa) {
      const carrito = this.cart.activeCart();
      if (!carrito.lines.length) return { ok: false, error: 'No hay nada que enviar.' };
      const a = await this.abrirCuenta(opciones.sinMesa, carrito);
      if (!a.ok) return a;
      cuenta = a.datos;
    }
    if (!cuenta) return { ok: false, error: 'Esta cuenta no es de una mesa.' };
    const lineas = this.pendientes();
    if (!lineas.length) return { ok: false, error: 'No hay nada nuevo que enviar.' };

    /* El origen se fija ANTES de enviar y se conserva si falla: el reintento
       lleva el mismo, y la base salta lo que ya tenga. */
    for (const l of lineas) l.origen ??= nuevoOrigen();

    const r = await this.api?.cuentas?.enviar({
      cuentaId: cuenta.id,
      lineas: lineas.map(l => ({
        productId: l.productId,
        cantidad: l.qty,
        nota: l.note,
        origen: l.origen,
        opciones: l.options.map(o => ({ optionId: o.optionId, quantity: o.quantity })),
      })),
    });
    if (!r?.success) {
      /* Puede que la base SI lo guardara y solo se perdiera la respuesta:
         releer lo deja claro (y la linea deja de estar pendiente). */
      await this.cargar(cuenta.id).catch(() => null);
      return { ok: false, error: r?.error || 'No se pudo enviar.' };
    }

    /* Lo enviado se quita del carrito ANTES de releer: si no, la relectura lo
       conservaria como «pendiente» y aparecería dos veces. */
    const carrito = this.cart.activeCart();
    carrito.lines = carrito.lines.filter(l => !lineas.includes(l));
    await this.cargar(cuenta.id);

    const sinImprimir = (r.data?.impresion || [])
      .filter((x: any) => !x.ok).map((x: any) => `${x.estacion}: ${x.error}`);
    return { ok: true, datos: { comandas: (r.data?.comandas || []).length, sinImprimir } };
  }

  // --------------------------------------------------------------- estado
  async pedirCuenta(): Promise<Resultado> {
    const cuenta = this.cuentaActiva();
    if (!cuenta) return { ok: false, error: 'Esta cuenta no es de una mesa.' };
    const r = await this.api?.cuentas?.estado({ cuentaId: cuenta.id, estado: 'POR_COBRAR' });
    if (!r?.success) return { ok: false, error: r?.error || 'No se pudo marcar.' };
    cuenta.estado = 'POR_COBRAR';
    this.cart.version.update(v => v + 1);
    return { ok: true, datos: undefined };
  }

  /** Libera una mesa sin consumo. SQL rechaza liberar una con lineas. */
  async liberar(cuentaId: number): Promise<Resultado> {
    const r = await this.api?.cuentas?.liberar({ cuentaId });
    if (!r?.success) return { ok: false, error: r?.error || 'No se pudo liberar.' };
    const c = this.carritoDe(cuentaId);
    if (c) this.cart.closeCart(c.id);
    return { ok: true, datos: undefined };
  }

  /**
   * Tras un cobro correcto: enlaza la cuenta a su venta y libera la mesa.
   *
   * La venta YA esta registrada. Si el enlace falla, se reintenta; si sigue
   * fallando, se devuelve el error para decirlo, pero nada se deshace: el
   * procedimiento es idempotente y el enlace se puede repetir.
   */
  async enlazarCobro(cuentaId: number, saleId: number | null): Promise<Resultado> {
    if (!cuentaId || !saleId) return { ok: false, error: 'Falta la venta para cerrar la cuenta.' };
    let ultimo = '';
    for (let i = 0; i < 3; i++) {
      const r = await this.api?.cuentas?.cobrada({ cuentaId, saleId });
      if (r?.success) return { ok: true, datos: undefined };
      ultimo = r?.error || 'No se pudo cerrar la cuenta.';
      await new Promise(res => setTimeout(res, 300 * (i + 1)));
    }
    return { ok: false, error: `La venta se cobró, pero la mesa no se liberó: ${ultimo}` };
  }
}
