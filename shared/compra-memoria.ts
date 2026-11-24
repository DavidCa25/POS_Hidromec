/**
 * 0092 · LA COMPRA QUE APRENDE.
 *
 * Registrar compra lee `sp_compra_memoria` al elegir proveedor: lo último que
 * se le compró de cada producto. Con eso la línea nace llena (presentación,
 * precio y ganancia de la última vez) y, antes de registrar, se avisa de una
 * captura fuera de lo normal: 240 cartones cuando siempre son 2, o un costo
 * que brincó.
 *
 * Puro (sin Angular) para probarlo en node: scripts/pruebas/compra-memoria.test.mjs.
 */

/** Un renglón de sp_compra_memoria. Cantidades y costos por unidad base. */
export interface MemoriaCompra {
  product_id: number;
  /** 1 = la última compra fue a este proveedor; 0 = a otro. */
  de_este: number;
  presentation_id: number | null;
  presentation_name: string | null;
  factor: number;
  /** Precio de esa presentación, sin IVA: lo que dice el ticket. */
  unit_price: number;
  costo_base: number;
  fecha: unknown;
  profit_percent: number | null;
  qty_tipica: number | null;
  qty_max: number | null;
  compras: number | null;
  mejor_supplier_id: number | null;
  mejor_supplier: string | null;
  mejor_costo_base: number | null;
  mejor_fecha: unknown;
}

/** Lo capturado en una línea, ya en unidad base. */
export interface LineaCapturada {
  nombre: string;
  qtyBase: number;
  costoBase: number;
  baseUom: string;
}

/** Veces la cantidad típica que ya parece un dedo de más (240 por 24). */
export const VECES_TIPICA = 3;
/** Y además por encima de la mayor compra que se ha hecho, por este margen. */
export const VECES_MAXIMA = 1.5;
/** Un costo por pieza que se mueve más que esto contra la última compra. */
export const SALTO_COSTO = 0.35;

const n = (v: unknown) => Number(v) || 0;
const pesos = (v: number) => '$' + v.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cantidad = (v: number) => (Math.round(v * 100) / 100).toLocaleString('es-MX');

/**
 * Lo raro de una línea contra lo que se ha comprado antes. Vacío si no hay
 * historial suficiente (menos de 2 compras para la cantidad) o si todo cuadra.
 * Avisa; no bloquea: decide la persona.
 */
export function avisosDeCaptura(l: LineaCapturada, m: MemoriaCompra | undefined | null): string[] {
  if (!m) return [];
  const out: string[] = [];
  const tipica = n(m.qty_tipica), maxima = n(m.qty_max), compras = n(m.compras);
  if (compras >= 2 && tipica > 0 && l.qtyBase > tipica * VECES_TIPICA && l.qtyBase > maxima * VECES_MAXIMA) {
    out.push(`${l.nombre}: ${cantidad(l.qtyBase)} ${l.baseUom}. Normalmente compras ${cantidad(tipica)} y la mayor compra fue de ${cantidad(maxima)}.`);
  }
  const antes = n(m.costo_base);
  if (antes > 0 && l.costoBase > 0) {
    const cambio = l.costoBase / antes - 1;
    if (Math.abs(cambio) >= SALTO_COSTO) {
      out.push(`${l.nombre}: ${pesos(l.costoBase)} por ${l.baseUom}, ${Math.round(Math.abs(cambio) * 100)} % ${cambio > 0 ? 'más' : 'menos'} que la última compra (${pesos(antes)}).`);
    }
  }
  return out;
}

/**
 * «Última compra: $480.00 por Cartón 24 · 12 nov». `dia` llega ya escrito
 * (la pantalla lo formatea con la zona de SQL). A otro proveedor, se dice.
 */
export function textoUltimaCompra(m: MemoriaCompra | undefined | null, dia: string, baseUom = 'pza'): string | null {
  if (!m || !(n(m.unit_price) > 0)) return null;
  const como = n(m.factor) > 1 && m.presentation_name ? m.presentation_name : baseUom;
  return `Última compra${m.de_este ? '' : ' (a otro proveedor)'}: ${pesos(n(m.unit_price))} por ${como}${dia ? ' · ' + dia : ''}`;
}

/** «Con Distribuidora B costó $18.50 por pza (8 % menos) · 3 nov». */
export function textoMasBarato(m: MemoriaCompra | undefined | null, dia: string, baseUom = 'pza'): string | null {
  if (!m || !m.mejor_supplier || !(n(m.mejor_costo_base) > 0) || !(n(m.costo_base) > 0)) return null;
  const menos = Math.round((1 - n(m.mejor_costo_base) / n(m.costo_base)) * 100);
  if (menos < 1) return null;
  return `Con ${m.mejor_supplier} costó ${pesos(n(m.mejor_costo_base))} por ${baseUom} (${menos} % menos)${dia ? ' · ' + dia : ''}`;
}
