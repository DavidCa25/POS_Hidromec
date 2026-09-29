import { CapabilityService, CartService, MesaService, ShiftService } from '../../core';
import { MenuCatalogService } from '../../core/menu-catalog.service';

/*
 * EL NEGOCIO DE LAS DEMOSTRACIONES: QUE NECESITAN Y COMO SE SABE QUE PASO.
 *
 * Dos cosas distintas viven aqui:
 *
 *   PREPARACIONES  Lo que una demo necesita ANTES del primer paso: el turno,
 *                  la Mesa 1, la Barra, el producto. Son idempotentes: la
 *                  demo corre una vez, cinco o veinte sobre la misma base y
 *                  no deja «Producto Demo (2)». Solo corren dentro de una demo
 *                  segura: el motor pide `guide:autorizar` antes, y la parte
 *                  que escribe SQL la vuelve a guardar el proceso principal
 *                  (`guide:preparar`).
 *
 *   HECHOS         Preguntas de solo lectura al negocio: «¿la comanda llego a
 *                  la barra?», «¿la cuenta ya se cobro?». Son la verdad de un
 *                  paso. El DOM sirve para SEÑALAR; si un paso se cumplio o no
 *                  lo dice el negocio, no un boton que tardo en pintarse o que
 *                  se volvio a crear.
 *
 * Los resultados (el id de la mesa, de la comanda, de la orden) se guardan en
 * la MEMORIA de la vuelta. Los objetivos los usan como clave estable
 * (`{mem.comandaId}`), nunca el texto que se ve en pantalla.
 */
export interface Servicios {
  caps: CapabilityService;
  turno: ShiftService;
  cart: CartService;
  mesas: MesaService;
  /** El catalogo de Touch: se lee al entrar a la caja; lo que la preparacion
      crea despues no aparece hasta que se vuelve a leer. */
  menu: MenuCatalogService;
  /** Memoria de ESTA vuelta de la demo. */
  mem: Record<string, any>;
}

type Preparacion = (s: Servicios) => Promise<void>;
type Hecho = (s: Servicios) => Promise<boolean>;

const filas = (r: any): any[] => Array.isArray(r) ? r : (Array.isArray(r?.recordset) ? r.recordset : (Array.isArray(r?.data) ? r.data : []));
const num = (v: any) => Number(v ?? NaN);
const api = () => (window as any).electronAPI;
const wy = () => (window as any).wybix;

/** Un fallo de precondicion: se traduce a «Falta algo para continuar» en pantalla. */
export class FaltaPrecondicion extends Error {
  constructor(public detalle: string) { super(detalle); }
}

async function exigir(r: any, que: string) {
  if (!r || r.success === false) throw new FaltaPrecondicion(`${que}: ${r?.error || 'sin respuesta'}`);
  return r;
}

/** La parte de SQL, en el proceso principal y con su guarda. */
async function prepararEnBase(escenario: string, mem: Record<string, any>) {
  const r = await wy()?.guide?.preparar?.({ escenario });
  if (!r?.success) throw new FaltaPrecondicion(r?.detalle || r?.error || 'no se pudo preparar');
  Object.assign(mem, r.data || {});
}

/** El turno de ESTA caja abierto: vender y cobrar lo exigen. */
async function asegurarTurno(turno: ShiftService) {
  if (await turno.refresh()) return;
  const r = await turno.open(500, 'Demostración de Wybix Guide');
  if (!r.ok) throw new FaltaPrecondicion(r.error || 'no se pudo abrir el turno');
}

/** Hoy, como `YYYY-MM-DD` local. */
function hoy(): string {
  const d = new Date();
  const z = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

const PREPARACIONES: Record<string, Preparacion> = {
  /** Retail: marca y categoria que el formulario exige, el producto de la vuelta
      anterior archivado, y el turno abierto para poder cobrar. */
  'demo.retail': async ({ turno, mem }) => {
    await prepararEnBase('demo.retail', mem);
    mem['sku'] = 'DEMO-GUIA-CAFE';
    await asegurarTurno(turno);
  },

  /** Cafeteria: modulos, la Barra, el Americano asignado a la Barra, el Salón con
      la Mesa 1 libre, la caja sin cuentas viejas y el turno abierto. */
  'demo.hospitality': async ({ caps, turno, cart, mesas, menu, mem }) => {
    for (const m of ['hospitality', 'mesas', 'comandas']) {
      const tiene = m === 'hospitality' ? caps.hospitality : m === 'mesas' ? caps.mesas : caps.comandas;
      if (!tiene) await exigir(await api().modulosSet(m, true), `encender ${m}`);
    }
    await caps.load(true);
    await prepararEnBase('demo.hospitality', mem);

    const estaciones = filas(await wy().estaciones.listar());
    let barra = estaciones.find((e: any) => String(e.nombre).trim().toLowerCase() === 'barra');
    if (!barra) {
      const r = await exigir(await wy().estaciones.guardar({ nombre: 'Barra', salida: 'PANTALLA' }), 'crear la Barra');
      barra = { id: r.data?.[0]?.id };
    }
    mem['estacionId'] = num(barra.id);

    const pn = 'DEMO-AMERICANO-GUIDE';
    let prod = filas(await api().getActiveProducts()).find((p: any) => p.part_number === pn);
    if (!prod) {
      await exigir(await api().agregarProducto(num(mem['marcaId']), num(mem['categoriaId']), pn, 'Americano Demo', 38, 0,
        null, null, '02', 0.16, null, { inventory_mode: 'NONE', sellable: 1, base_uom: 'pza' }), 'crear el Americano');
      prod = filas(await api().getActiveProducts()).find((p: any) => p.part_number === pn);
    }
    if (!prod) throw new FaltaPrecondicion('el Americano no quedó a la venta');
    mem['productoId'] = num(prod.id ?? prod.product_id);
    mem['sku'] = pn;
    await exigir(await wy().estaciones.asignar({ productId: mem['productoId'], stationId: mem['estacionId'] }), 'asignar el Americano a la Barra');

    const salon = await wy().salon.get();
    let area = (salon?.sets?.[0] || []).find((a: any) => String(a.nombre).trim() === 'Salón');
    if (!area) {
      const r = await exigir(await wy().salon.guardarArea({ nombre: 'Salón' }), 'crear el Salón');
      area = { id: r.data?.[0]?.id };
    }
    let mesa = (salon?.sets?.[1] || []).find((m: any) => String(m.nombre).trim() === '1');
    if (!mesa) {
      const r = await exigir(await wy().salon.guardarMesa({ areaId: area.id, nombre: '1', capacidad: 4 }), 'crear la Mesa 1');
      mesa = { id: r.data?.[0]?.id };
    }
    mem['mesaId'] = num(mesa.id);

    /* Touch ya leyo su menu al abrirse; el Americano y su Barra son de ahora. */
    await menu.load(true);

    /* La caja no puede empezar atada a una cuenta vieja: si el carrito activo
       apunta a una cuenta que ya no esta abierta, se suelta. */
    const actual = mesas.cuentaActiva();
    if (actual) cart.completeActive();

    await asegurarTurno(turno);
  },

  /** Taller: el cliente y su vehiculo vienen de la semilla del giro; aqui se
      limpia lo que una vuelta cortada dejo abierto y se abre el turno. */
  'demo.services.workshop': async ({ turno, mem }) => {
    await prepararEnBase('demo.services.workshop', mem);
    if (!mem['clienteId'] || !mem['servicioId']) throw new FaltaPrecondicion('falta el cliente o el servicio de la demo');
    await asegurarTurno(turno);
  },

  /** Belleza: la clienta, el servicio y la estilista vienen de la semilla. */
  'demo.services.beauty': async ({ turno, mem }) => {
    await prepararEnBase('demo.services.beauty', mem);
    if (!mem['clienteId'] || !mem['servicioId'] || !mem['profesionalId']) {
      throw new FaltaPrecondicion('falta la clienta, el servicio o la estilista de la demo');
    }
    await asegurarTurno(turno);
  },
};

/* ------------------------------------------------------------------ HECHOS */

/**
 * La cuenta de la Mesa 1 de ESTA vuelta. Si la memoria aun no la tiene (la
 * persona tomo el control antes de que el motor la viera), se busca: primero
 * en el carrito de la caja, luego en el salon.
 */
async function asegurarCuenta(s: Servicios): Promise<void> {
  const { mem, mesas } = s;
  if (mem['cuentaId'] || !mem['mesaId']) return;
  const c = mesas.cuentaActiva();
  if (c && num(c.mesaId) === num(mem['mesaId'])) { mem['cuentaId'] = num(c.id); return; }
  const salon = await wy()?.salon?.get?.();
  const m = (salon?.sets?.[1] || []).find((x: any) => num(x.id) === num(mem['mesaId']));
  if (m?.cuenta_id) mem['cuentaId'] = num(m.cuenta_id);
}

async function comandaDeLaCuenta(s: Servicios): Promise<any | null> {
  await asegurarCuenta(s);
  const mem = s.mem;
  if (!mem['cuentaId']) return null;
  const r = await wy()?.kds?.listar?.({ stationId: null });
  const cab = r?.sets?.[0] || [];
  const k = cab.filter((c: any) => num(c.cuenta_id) === num(mem['cuentaId']) && num(c.id) > num(mem['comandaBase'] ?? 0))
    .sort((a: any, b: any) => num(b.id) - num(a.id))[0];
  if (k) mem['comandaId'] = num(k.id);
  return k ?? null;
}

async function estadoCuenta(s: Servicios): Promise<string | null> {
  await asegurarCuenta(s);
  const mem = s.mem;
  if (!mem['cuentaId']) return null;
  const r = await wy()?.cuentas?.obtener?.({ cuentaId: mem['cuentaId'] });
  return r?.sets?.[0]?.[0]?.estado ?? null;
}

async function ordenDeLaDemo(mem: Record<string, any>): Promise<any | null> {
  if (mem['ordenId']) {
    const r = await api()?.serviciosOrden?.({ id: mem['ordenId'] });
    const cab = r?.sets?.[0]?.[0];
    if (cab) return { cabecera: cab, lineas: r.sets?.[1] ?? [] };
  }
  const r = await api()?.serviciosOrdenes?.({ top: 50 });
  const o = filas(r).filter((x: any) => num(x.id) > num(mem['ordenBase'] ?? 0) && num(x.customer_id) === num(mem['clienteId']))
    .sort((a: any, b: any) => num(b.id) - num(a.id))[0];
  if (!o) return null;
  mem['ordenId'] = num(o.id);
  const d = await api()?.serviciosOrden?.({ id: mem['ordenId'] });
  const cab = d?.sets?.[0]?.[0];
  return cab ? { cabecera: cab, lineas: d.sets?.[1] ?? [] } : null;
}

const HECHOS: Record<string, Hecho> = {
  // --------------------------------------------------------------- retail
  'retail.producto-creado': async ({ mem }) => {
    const p = filas(await api().getActiveProducts()).find((x: any) => x.part_number === mem['sku']);
    if (p) mem['productoId'] = num(p.id ?? p.product_id);
    return !!p;
  },
  'retail.en-la-venta': async ({ cart, mem }) =>
    !!mem['productoId'] && cart.activeCart().lines.some(l => num(l.productId) === num(mem['productoId'])),
  'retail.vendido': async ({ cart, mem }) => {
    if (!mem['productoId']) return false;
    const enCarrito = cart.activeCart().lines.some(l => num(l.productId) === num(mem['productoId']));
    if (enCarrito) return false;
    const r = await api()?.getSales?.({ start_date: hoy(), end_date: hoy() });
    return filas(r).some((v: any) => num(v.id ?? v.sale_id) > num(mem['ventaBase'] ?? 0));
  },

  // ---------------------------------------------------------- hospitality
  'hosp.mesa-abierta': async ({ mesas, mem }) => {
    const c = mesas.cuentaActiva();
    if (c && num(c.mesaId) === num(mem['mesaId'])) { mem['cuentaId'] = num(c.id); return true; }
    return false;
  },
  'hosp.en-la-cuenta': async ({ cart, mem }) =>
    cart.activeCart().lines.some(l => num(l.productId) === num(mem['productoId'])),
  'hosp.enviada': async (s) => !!(await comandaDeLaCuenta(s)),
  'hosp.preparando': async (s) => {
    const k = await comandaDeLaCuenta(s);
    return !!k && ['PREPARANDO', 'LISTA'].includes(String(k.estado));
  },
  'hosp.lista': async (s) => {
    const k = await comandaDeLaCuenta(s);
    return !!k && String(k.estado) === 'LISTA';
  },
  'hosp.cobrada': async (s) => (await estadoCuenta(s)) === 'COBRADA',

  // ------------------------------------------------------------- servicios
  'srv.orden-abierta': async ({ mem }) => !!(await ordenDeLaDemo(mem)),
  'srv.linea-agregada': async ({ mem }) => {
    const o = await ordenDeLaDemo(mem);
    return !!o && o.lineas.some((l: any) => num(l.product_id) === num(mem['servicioId']) && l.status !== 'CANCELADA');
  },
  /* Terminar una orden exige al menos un trabajo hecho (sp_service_order_set_status). */
  'srv.linea-hecha': async ({ mem }) => {
    const o = await ordenDeLaDemo(mem);
    return !!o && o.lineas.some((l: any) => num(l.product_id) === num(mem['servicioId']) && l.status === 'HECHA');
  },
  'srv.autorizada': async ({ mem }) => {
    const o = await ordenDeLaDemo(mem);
    return !!o && !!o.cabecera.authorized_at && !o.cabecera.needs_reauthorization;
  },
  'srv.en-proceso': async ({ mem }) => {
    const o = await ordenDeLaDemo(mem);
    return !!o && ['EN_PROCESO', 'TERMINADA', 'ENTREGADA'].includes(String(o.cabecera.status));
  },
  'srv.terminada': async ({ mem }) => {
    const o = await ordenDeLaDemo(mem);
    return !!o && ['TERMINADA', 'ENTREGADA'].includes(String(o.cabecera.status));
  },
  'srv.cobrada': async ({ mem }) => {
    const o = await ordenDeLaDemo(mem);
    return !!o && !!o.cabecera.sale_id;
  },
  'srv.cita-agendada': async ({ mem }) => {
    const desde = new Date(); desde.setHours(0, 0, 0, 0);
    const hasta = new Date(desde); hasta.setDate(hasta.getDate() + 1);
    const r = await api()?.serviciosCitas?.({ desde: desde.toISOString(), hasta: hasta.toISOString() });
    const c = (r?.sets?.[0] ?? []).filter((x: any) => num(x.id) > num(mem['citaBase'] ?? 0) && num(x.customer_id) === num(mem['clienteId']))
      .sort((a: any, b: any) => num(b.id) - num(a.id))[0];
    if (c) { mem['citaId'] = num(c.id); if (c.service_order_id) mem['ordenId'] = num(c.service_order_id); }
    return !!c;
  },
  'srv.cita-en-orden': async ({ mem }) => {
    await HECHOS['srv.cita-agendada']({ mem } as any);
    return !!mem['ordenId'];
  },
};

export function preparacion(nombre: string): Preparacion | null {
  return PREPARACIONES[nombre] ?? null;
}

export function hecho(nombre: string): Hecho | null {
  return HECHOS[nombre] ?? null;
}

/** Para las pruebas estaticas: que nombres existen. */
export const NOMBRES_DE_HECHOS = Object.keys(HECHOS);
export const NOMBRES_DE_PREPARACIONES = Object.keys(PREPARACIONES);
