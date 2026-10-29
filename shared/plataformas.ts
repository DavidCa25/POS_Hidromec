/** Liquidaciones de plataforma (0069). Lectura PURA del archivo que descarga
 * el negocio de su plataforma de entrega: recibe las filas de la hoja (CSV o
 * Excel ya leídos por `xlsx`) y devuelve los pedidos que guarda
 * `sp_platform_settlement_save`. No decide nada contable: eso vive en SQL.
 *
 * LAS COLUMNAS SE RECONOCEN POR NOMBRE, NO POR POSICIÓN
 * -----------------------------------------------------
 * Cada plataforma cambia sus reportes sin avisar y los publica en español o
 * en inglés según la cuenta. Por eso cada campo tiene varios nombres posibles
 * (sin acentos, mayúsculas ni signos) y la fila de encabezados se busca en las
 * primeras filas: hay archivos que empiezan con un título. Agregar un formato
 * nuevo es agregar nombres aquí, no código.
 *
 * Formatos:
 *   UBER_EATS  «Ganancias» > Descargar: id, fecha, cliente, tipo de
 *              cumplimiento, estado, ventas sin impuestos, impuesto, ventas
 *              netas. Es el que se conoce.
 *   DIDI_FOOD, RAPPI  todavía sin un archivo real: usan los mismos nombres
 *              genéricos. Si su archivo no se reconoce, la pantalla lo dice y
 *              el desglose se captura a mano.
 */
export type Plataforma = 'UBER_EATS' | 'DIDI_FOOD' | 'RAPPI';

export const PLATAFORMAS: { id: Plataforma; nombre: string; icono: string }[] = [
  { id: 'UBER_EATS', nombre: 'Uber Eats', icono: 'ph-moped' },
  { id: 'DIDI_FOOD', nombre: 'Didi Food', icono: 'ph-moped-front' },
  { id: 'RAPPI', nombre: 'Rappi', icono: 'ph-bicycle' },
];
export const nombrePlataforma = (p: string | null | undefined): string =>
  PLATAFORMAS.find((x) => x.id === p)?.nombre ?? 'Sin plataforma';

/** Lo que guarda `sp_platform_settlement_save` por pedido (`@orders_json`). */
export interface PedidoPlataforma {
  id: string;
  /** 'AAAA-MM-DDTHH:MM:SS', hora local del negocio. */
  at: string | null;
  customer?: string;
  fulfillment?: string;
  status?: string;
  base: number | null;
  tax: number | null;
  /** Lo que pagó el cliente con IVA: lo que la caja debería tener. */
  total: number;
  net: number | null;
  cancelled: boolean;
}

export interface LecturaPlataforma {
  pedidos: PedidoPlataforma[];
  /** Campo -> encabezado del archivo que se usó. */
  columnas: Partial<Record<Campo, string>>;
  avisos: string[];
  desde: string | null;
  hasta: string | null;
  /** Suma de lo que pagaron los clientes (sin cancelados) y de ventas netas. */
  ventas: number;
  neto: number | null;
}

type Campo = 'id' | 'fecha' | 'hora' | 'cliente' | 'cumplimiento' | 'estado' | 'base' | 'impuesto' | 'total' | 'neto';

const NOMBRES: Record<Campo, string[]> = {
  id: ['id del pedido', 'id. del pedido', 'id de pedido', 'id pedido', 'numero de pedido', 'no. de pedido', 'id de la orden', 'id orden', 'order id', 'order uuid', 'workflow uuid', 'pedido', 'orden'],
  fecha: ['fecha del pedido', 'fecha de pedido', 'fecha y hora del pedido', 'fecha de la orden', 'order date', 'date', 'fecha'],
  hora: ['hora del pedido', 'hora de pedido', 'hora de aceptacion del pedido', 'order accept time', 'order time', 'time', 'hora'],
  cliente: ['cliente', 'nombre del cliente', 'customer', 'customer name', 'eater name'],
  cumplimiento: ['tipo de cumplimiento', 'tipo de entrega', 'fulfillment type', 'fulfilment type', 'dining mode', 'modalidad'],
  estado: ['estado del pedido', 'estado de la orden', 'order status', 'estado', 'status'],
  base: ['ventas sin impuestos', 'ventas (sin impuestos)', 'ventas sin iva', 'ventas (sin iva)', 'subtotal sin iva', 'sales (excl. tax)', 'sales excl tax', 'sales (excl. vat)', 'sales excl vat'],
  impuesto: ['impuesto', 'impuestos', 'iva', 'impuesto sobre las ventas', 'iva sobre las ventas', 'tax on sales', 'tax', 'vat on sales', 'vat'],
  total: ['ventas con impuestos', 'ventas (con impuestos)', 'ventas con iva', 'ventas (con iva)', 'ventas brutas', 'total del pedido', 'sales (incl. tax)', 'sales incl tax', 'sales (incl. vat)', 'sales incl vat', 'gross sales'],
  neto: ['ventas netas', 'net sales', 'pago neto', 'total pagado', 'pago total', 'total payout', 'net payout'],
};

/** Encabezado normalizado: sin acentos, minúsculas, solo letras y números. */
export const normalizar = (s: unknown): string =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

const NORMALIZADOS = Object.fromEntries(
  Object.entries(NOMBRES).map(([k, v]) => [k, v.map(normalizar)]),
) as Record<Campo, string[]>;

/** Qué columna es cada campo. Gana el nombre más específico (el primero de la lista). */
function mapearEncabezado(fila: unknown[]): Partial<Record<Campo, number>> {
  const h = fila.map(normalizar);
  const usado = new Set<number>();
  const m: Partial<Record<Campo, number>> = {};
  // Primero los campos de dinero y el id, que tienen nombres largos; al final
  // 'fecha', 'hora', 'estado', que como palabra sola pueden repetirse.
  const orden: Campo[] = ['base', 'total', 'neto', 'impuesto', 'id', 'cliente', 'cumplimiento', 'fecha', 'hora', 'estado'];
  for (const campo of orden) {
    for (const nombre of NORMALIZADOS[campo]) {
      const i = h.findIndex((x, j) => !usado.has(j) && x === nombre);
      if (i >= 0) { m[campo] = i; usado.add(i); break; }
    }
  }
  return m;
}

/** "$1,234.50", "-12", "(12.00)", "MX$ 1 234,50", 12.5 -> número o null. */
export function numero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  let s = String(v ?? '').trim();
  if (!s || s === '-' || s === '—') return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[^\d,.\-]/g, '');
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.round(Number(s) * 100) / 100;
  return neg ? -n : n;
}

const MESES: Record<string, number> = {
  ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8,
  sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12,
};
const dos = (n: number) => String(n).padStart(2, '0');
const iso = (a: number, m: number, d: number, hh = 0, mm = 0, ss = 0): string | null => {
  const f = new Date(a, m - 1, d, hh, mm, ss);
  if (f.getFullYear() !== a || f.getMonth() !== m - 1 || f.getDate() !== d) return null;
  return `${a}-${dos(m)}-${dos(d)}T${dos(hh)}:${dos(mm)}:${dos(ss)}`;
};

/** Hora suelta: "14:05", "2:05 PM", 0.5868 (fracción de día de Excel). */
function hora(v: unknown): [number, number, number] | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && v >= 0 && v < 1) {
    const t = Math.round(v * 86400);
    return [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60];
  }
  if (v instanceof Date) return [v.getHours(), v.getMinutes(), v.getSeconds()];
  const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])?\.?\s*m?\.?/i.exec(String(v));
  if (!m) return null;
  let h = Number(m[1]);
  if (m[4]) { const pm = m[4].toLowerCase() === 'p'; if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
  return [h, Number(m[2]), Number(m[3] ?? 0)];
}

/**
 * Fecha (con o sin hora) a ISO local. México escribe día/mes/año: "03/02/2025"
 * es 3 de febrero. Acepta también AAAA-MM-DD, "3 feb 2025", objetos Date
 * (xlsx con cellDates) y el número de serie de Excel.
 */
export function fecha(v: unknown, h?: unknown): string | null {
  if (v == null || v === '') return null;
  let r: string | null = null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    r = iso(v.getFullYear(), v.getMonth() + 1, v.getDate(), v.getHours(), v.getMinutes(), v.getSeconds());
  } else if (typeof v === 'number' && v > 20000 && v < 80000) {
    // Serie de Excel: días desde 1899-12-30; la fracción es la hora.
    const ms = Math.round((v - 25569) * 86400000);
    const d = new Date(ms);
    r = iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
  } else {
    const s = String(v).trim();
    let m: RegExpExecArray | null;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)))
      r = iso(+m[1], +m[2], +m[3], ...(hora(s.slice(m[0].length)) ?? [0, 0, 0]));
    else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s)))
      r = iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1], ...(hora(s.slice(m[0].length)) ?? [0, 0, 0]));
    else if ((m = /^(\d{1,2})\s*(?:de\s+)?([a-záéíóú]{3})[a-záéíóú]*\.?\s*(?:de\s+)?(\d{4})/i.exec(s))) {
      const mes = MESES[normalizar(m[2]).slice(0, 3)];
      if (mes) r = iso(+m[3], mes, +m[1], ...(hora(s.slice(m[0].length)) ?? [0, 0, 0]));
    }
  }
  if (r && h != null && h !== '') {
    const t = hora(h);
    if (t) r = r.slice(0, 11) + `${dos(t[0])}:${dos(t[1])}:${dos(t[2])}`;
  }
  return r;
}

/** Sobre el estado normalizado (sin espacios): 'Cancelado', 'Rechazado', 'No entregado'... */
const CANCELADO = /cancel|rechaz|noentreg|fallid|unfulfill|reject/;

/**
 * Lee las filas de la hoja. `filas` es lo que da
 * `XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true })`.
 */
export function leerArchivoPlataforma(filas: unknown[][]): LecturaPlataforma {
  const avisos: string[] = [];
  let ini = -1;
  let m: Partial<Record<Campo, number>> = {};
  for (let i = 0; i < Math.min(filas.length, 20); i++) {
    const c = mapearEncabezado(filas[i] ?? []);
    if (c.id != null && (c.total != null || c.base != null || c.neto != null)) { ini = i; m = c; break; }
  }
  if (ini < 0)
    throw Error('No reconocí el archivo: no encontré las columnas de id del pedido y ventas. Revisa que sea el reporte de pedidos de la plataforma.');
  const enc = filas[ini] ?? [];
  const columnas = Object.fromEntries(Object.entries(m).map(([k, i]) => [k, String(enc[i as number] ?? '')])) as LecturaPlataforma['columnas'];
  if (m.fecha == null) avisos.push('El archivo no trae fecha por pedido: solo se emparejará por número de pedido.');
  if (m.total == null && m.base != null && m.impuesto == null)
    avisos.push('El archivo trae ventas sin impuestos y no trae el impuesto: el importe por pedido no incluye IVA.');
  if (m.total == null && m.base == null)
    avisos.push('El archivo solo trae ventas netas: se comparan contra la caja, pero ya llevan descuentos de la plataforma.');

  const val = (f: unknown[], c: Campo) => (m[c] == null ? undefined : f[m[c] as number]);
  const porId = new Map<string, PedidoPlataforma>();
  let sinId = 0, sinImporte = 0;
  for (const f of filas.slice(ini + 1)) {
    if (!f || f.every((x) => x == null || String(x).trim() === '')) continue;
    const id = String(val(f, 'id') ?? '').trim();
    // Las filas de totales al final no traen id, o traen «Total» en su lugar.
    if (!id || /^(sub)?totale?s?(general)?$|^grandtotal$/.test(normalizar(id))) { sinId++; continue; }
    const base = numero(val(f, 'base')), tax = numero(val(f, 'impuesto')), net = numero(val(f, 'neto'));
    let total = numero(val(f, 'total'));
    if (total == null && base != null) total = Math.round((base + (tax ?? 0)) * 100) / 100;
    if (total == null) total = net;
    if (total == null) { sinImporte++; continue; }
    const estado = String(val(f, 'estado') ?? '').trim();
    const p: PedidoPlataforma = {
      id: id.slice(0, 100),
      at: fecha(val(f, 'fecha'), val(f, 'hora')),
      customer: String(val(f, 'cliente') ?? '').trim().slice(0, 120) || undefined,
      fulfillment: String(val(f, 'cumplimiento') ?? '').trim().slice(0, 40) || undefined,
      status: estado.slice(0, 40) || undefined,
      base, tax, total, net,
      cancelled: CANCELADO.test(normalizar(estado)),
    };
    const ya = porId.get(p.id);
    if (!ya) { porId.set(p.id, p); continue; }
    // Un pedido con ajustes viene en varias filas: se suman.
    const suma = (a: number | null, b: number | null) => (a == null && b == null ? null : Math.round(((a ?? 0) + (b ?? 0)) * 100) / 100);
    ya.base = suma(ya.base, p.base); ya.tax = suma(ya.tax, p.tax); ya.net = suma(ya.net, p.net);
    ya.total = Math.round((ya.total + p.total) * 100) / 100;
    ya.at = ya.at ?? p.at; ya.cancelled = ya.cancelled && p.cancelled;
  }
  if (sinImporte) avisos.push(`${sinImporte} fila(s) sin importe se omitieron.`);
  if (sinId > 1) avisos.push(`${sinId} filas sin número de pedido se omitieron (totales o notas).`);
  const pedidos = [...porId.values()];
  if (!pedidos.length) throw Error('El archivo no trae pedidos.');
  const fechas = pedidos.map((p) => p.at?.slice(0, 10)).filter((x): x is string => !!x).sort();
  // El periodo del reporte, si el título lo dice («del 19/10/2026 al 25/10/2026»):
  // el último día puede no tener pedidos y aun así ser del periodo.
  const titulo = filas.slice(0, ini).flat().map((x) => String(x ?? '')).join(' ');
  const rango = [...titulo.matchAll(/\d{1,2}[/.-]\d{1,2}[/.-]\d{4}|\d{4}-\d{2}-\d{2}/g)].map((m) => fecha(m[0])?.slice(0, 10)).filter((x): x is string => !!x);
  const vivos = pedidos.filter((p) => !p.cancelled);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    pedidos, columnas, avisos,
    desde: rango.length >= 2 && rango[0] <= (fechas[0] ?? rango[0]) ? rango[0] : fechas[0] ?? null,
    hasta: rango.length >= 2 && rango[1] >= (fechas[fechas.length - 1] ?? rango[1]) ? rango[1] : fechas[fechas.length - 1] ?? null,
    ventas: r2(vivos.reduce((s, p) => s + p.total, 0)),
    neto: m.neto == null ? null : r2(vivos.reduce((s, p) => s + (p.net ?? 0), 0)),
  };
}

/** Depósito esperado con el mismo signo que la columna calculada de SQL. */
export function depositoEsperado(d: {
  gross_sales: number; marketing: number; service_fees: number; refunds: number;
  isr_withheld: number; iva_withheld: number; other_adjustments: number;
}): number {
  const c = (n: number) => Math.round((Number(n) || 0) * 100);
  return (c(d.gross_sales) - c(d.marketing) - c(d.service_fees) - c(d.refunds)
    - c(d.isr_withheld) - c(d.iva_withheld) - c(d.other_adjustments)) / 100;
}
