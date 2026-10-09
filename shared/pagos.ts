/** Importes aplicados a una venta única. El efectivo recibido no es venta. */
export interface PagoAplicado {
  method: 'EFECTIVO' | 'TARJETA' | 'TRANSFERENCIA' | 'PLATAFORMA';
  amount: number;
  received?: number;
  reference?: string;
}
function cents(n: number): number {
  if (
    !Number.isFinite(n) ||
    n < 0 ||
    n > 99999999 ||
    Math.abs(n * 100 - Math.round(n * 100)) > 0.00001
  )
    throw Error('Importe inválido: usa hasta dos decimales.');
  return Math.round(n * 100);
}
export function validarPagos(total: number, pagos: PagoAplicado[]) {
  const target = cents(total),
    methods = new Set<string>();
  let sum = 0,
    cash = 0,
    received = 0;
  if (!Array.isArray(pagos) || !pagos.length || pagos.length > 4)
    throw Error('Agrega de uno a cuatro métodos de pago.');
  for (const p of pagos) {
    if (
      !p ||
      !['EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'PLATAFORMA'].includes(
        p.method,
      ) ||
      methods.has(p.method)
    )
      throw Error('Método repetido o no admitido en pago dividido.');
    methods.add(p.method);
    const amount = cents(p.amount);
    if (!amount) throw Error('Cada pago debe tener un importe mayor a cero.');
    sum += amount;
    if (
      p.reference &&
      (typeof p.reference !== 'string' || p.reference.length > 100)
    )
      throw Error('Referencia de pago inválida.');
    if (p.method === 'EFECTIVO') {
      cash = amount;
      received = cents(p.received ?? p.amount);
      if (received < cash)
        throw Error('El efectivo recibido no alcanza la porción aplicada.');
    }
  }
  if (sum !== target)
    throw Error(
      sum < target
        ? 'Falta cubrir el total de la compra.'
        : 'Los pagos aplicados superan el total.',
    );
  return {
    cash: cash / 100,
    received: received / 100,
    change: (received - cash) / 100,
    total: sum / 100,
  };
}
