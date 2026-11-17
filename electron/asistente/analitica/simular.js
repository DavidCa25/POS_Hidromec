'use strict';
/**
 * «¿Y SI…?»: qué pasa con la ganancia si cambia un precio.
 *
 * Wybix no sabe cuántos clientes se irían con un precio más alto (nadie lo
 * sabe sin probarlo), así que no lo inventa. Dice dos cosas que sí son
 * ciertas:
 *   1. Vendiendo lo mismo que el último mes, cuánto ganarías.
 *   2. El punto de equilibrio: hasta cuántas piezas menos podrías vender (o
 *      cuántas más necesitas, si bajas el precio) para ganar lo mismo.
 */

/**
 * @param x { precio (con IVA), nuevo (con IVA), costo (por pieza, sin IVA), tasa (IVA, 0.16), piezas (al mes) }
 */
function simularPrecio({ precio, nuevo, costo, tasa = 0, piezas }) {
  const base = precio / (1 + tasa);
  const baseNueva = nuevo / (1 + tasa);
  const porPieza = base - costo;
  const porPiezaNueva = baseNueva - costo;
  const gananciaHoy = porPieza * piezas;
  const gananciaNueva = porPiezaNueva * piezas;
  /* Piezas que dejan la misma ganancia con el precio nuevo. */
  const equilibrio = porPiezaNueva > 0 && gananciaHoy > 0 ? gananciaHoy / porPiezaNueva : null;
  const cambioPrecio = precio > 0 ? (nuevo / precio - 1) : null;
  return {
    porPieza, porPiezaNueva, gananciaHoy, gananciaNueva, diferencia: gananciaNueva - gananciaHoy, equilibrio,
    /* Positivo: cuántas piezas menos aguanta; negativo: cuántas más necesita. */
    margenPiezas: equilibrio != null ? piezas - equilibrio : null,
    margenPct: equilibrio != null && piezas > 0 ? (piezas - equilibrio) / piezas : null,
    cambioPrecio, perdida: porPiezaNueva <= 0,
    /* ±20 % o más (con tolerancia: 13.92 / 11.60 no da 1.2 exacto en coma flotante). */
    saltoGrande: cambioPrecio != null && Math.abs(cambioPrecio) >= 0.2 - 1e-9,
  };
}

module.exports = { simularPrecio };
