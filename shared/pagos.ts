/**
 * Importes aplicados a una venta única. El efectivo recibido no es venta.
 *
 * 0081 · CREDITO: la parte que el cliente se lleva fiada («trae $100 de $150:
 * los otros $50 a crédito»). No es dinero cobrado: queda como saldo de una
 * venta a crédito y se paga después con abonos. Necesita al cliente.
 */
export interface PagoAplicado {
  method: 'EFECTIVO' | 'TARJETA' | 'TRANSFERENCIA' | 'PLATAFORMA' | 'CREDITO';
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
    received = 0,
    credito = 0;
  if (!Array.isArray(pagos) || !pagos.length || pagos.length > 4)
    throw Error('Agrega de uno a cuatro métodos de pago.');
  for (const p of pagos) {
    if (
      !p ||
      !['EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'PLATAFORMA', 'CREDITO'].includes(
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
    if (p.method === 'CREDITO') credito = amount;
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
    /** Lo que queda a crédito (0 si nada). */
    credito: credito / 100,
    /** Lo que se cobra ahora: el total menos lo fiado. */
    cobrado: (sum - credito) / 100,
  };
}

/* ---------------------------------------------------------------------------
   PAGO DIVIDIDO, COMO SE CAPTURA
   ---------------------------------------------------------------------------
   Se eligen los métodos y en cada uno se escribe cuánto lleva: el efectivo
   que dio el cliente y lo que pasó por tarjeta, transferencia, plataforma o
   queda a crédito. El método que todavía no se ha escrito se llena solo con
   lo que falta. Del efectivo sale lo aplicado y el cambio.

   Una sola regla para Touch y Retail: dos versiones es como se llega a que
   una caja cobre distinto que la otra.
   --------------------------------------------------------------------------- */
export type MetodoDividido = PagoAplicado['method'];

export interface PagoDividido {
  /** Lo que muestra cada método: escrito, o calculado si es el automático. */
  valores: Partial<Record<MetodoDividido, number>>;
  /** El método que se llena solo con lo que falta (el último sin escribir). */
  auto: MetodoDividido | undefined;
  /** Lo que se registra: el efectivo aplica solo lo que falta. */
  pagos: PagoAplicado[];
  cambio: number;
  /** Lo que falta por cubrir (0 si ya se cubrió). */
  saldo: number;
  /** Por qué no se puede cobrar todavía ('' si se puede). */
  error: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function distribuirPagoDividido(
  total: number,
  metodos: readonly MetodoDividido[],
  capturados: Partial<Record<MetodoDividido, number>>,
): PagoDividido {
  const auto = [...metodos].reverse().find(m => capturados[m] === undefined);
  const tecleado = metodos.reduce((a, m) => a + (m !== auto ? (capturados[m] ?? 0) : 0), 0);
  const valores: Partial<Record<MetodoDividido, number>> = {};
  for (const m of metodos) valores[m] = m === auto ? Math.max(0, r2(total - tecleado)) : (capturados[m] ?? 0);

  const otros = metodos.filter(m => m !== 'EFECTIVO').map(m => ({ method: m, amount: r2(valores[m] ?? 0) }));
  const sumaOtros = otros.reduce((a, p) => a + p.amount, 0);
  const pagos: PagoAplicado[] = otros.filter(p => p.amount > 0);
  let cambio = 0;
  if (metodos.includes('EFECTIVO')) {
    const recibido = r2(valores.EFECTIVO ?? 0);
    const aplicado = Math.min(recibido, Math.max(0, r2(total - sumaOtros)));
    if (aplicado > 0) pagos.unshift({ method: 'EFECTIVO', amount: aplicado, received: recibido });
    cambio = Math.max(0, r2(recibido - aplicado));
  }
  const saldo = Math.max(0, r2(total - pagos.reduce((a, p) => a + p.amount, 0)));

  let error = '';
  if (Math.round(sumaOtros * 100) > Math.round(total * 100))
    error = 'Tarjeta, transferencia, plataforma y crédito suman más que el total.';
  else try { validarPagos(total, pagos); } catch (e) { error = (e as Error).message; }

  return { valores, auto, pagos, cambio, saldo, error };
}
