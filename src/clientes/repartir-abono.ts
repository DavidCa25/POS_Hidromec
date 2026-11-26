/**
 * VISTA PREVIA DEL REPARTO DE UN ABONO (pantalla de Clientes).
 *
 * La misma cuenta que electron/lib/repartir-abono.js, que es la que se
 * aplica: de la primera venta de la lista a la última (la lista ya viene con
 * lo más vencido primero), liquida completas las que alcanza y la siguiente
 * queda con faltante. En centavos enteros.
 *
 * La prueba scripts/pruebas/repartir-abono.test.mjs corre las dos con miles de
 * casos y exige que digan exactamente lo mismo: la pantalla no puede prometer
 * un reparto distinto del que se guarda.
 *
 * Solo sintaxis de TypeScript que se puede borrar (sin enums ni parámetros de
 * propiedad): Node la corre tal cual en la prueba.
 */
export interface PartidaVista { abono: number; queda: number; liquidada: boolean }
export interface RepartoVista {
  porVenta: Map<number, PartidaVista>;
  liquidadas: number;
  /** La venta que queda con faltante, si alguna. */
  parcialId: number | null;
  /** Lo que sobra si el monto es mayor que lo que se debe. */
  sobrante: number;
  aplicado: number;
}

export function repartirVista(ventas: ReadonlyArray<{ id: number; balance: number }>, monto: number): RepartoVista {
  const porVenta = new Map<number, PartidaVista>();
  const total = Math.max(0, Math.round(Number(monto || 0) * 100));
  let resta = total;
  let liquidadas = 0;
  let parcialId: number | null = null;
  for (const v of ventas) {
    if (resta <= 0) break;
    const saldo = Math.round(Number(v.balance) * 100);
    if (!(saldo > 0)) continue;
    const abono = Math.min(saldo, resta);
    resta -= abono;
    const liquidada = abono === saldo;
    if (liquidada) liquidadas++; else parcialId = v.id;
    porVenta.set(v.id, { abono: abono / 100, queda: (saldo - abono) / 100, liquidada });
  }
  return { porVenta, liquidadas, parcialId, sobrante: resta / 100, aplicado: (total - resta) / 100 };
}
