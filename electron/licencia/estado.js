/**
 * EN QUÉ ESTADO ESTÁ LA LICENCIA, AHORA, SIN INTERNET.
 *
 * Determinista: solo depende del certificado firmado y del reloj. Nadie tiene
 * que "mandar un evento" para que empiece la gracia o la Venta Esencial: se
 * calcula igual en línea que sin red.
 *
 *   TRIAL      prueba gratuita vigente.
 *   ACTIVE     suscripción vigente (incluye el primer año).
 *   GRACE      venció la suscripción: 45 días (los dice el certificado) con
 *              TODO funcionando y avisos de renovación.
 *   SALE_ONLY  Modo Venta Esencial: vender, cobrar, ticket, turno, consultar,
 *              exportar y respaldar. Lo avanzado espera a la renovación.
 *   EXPIRED    terminó la PRUEBA sin compra: se activa una licencia (el
 *              comportamiento de siempre para una prueba; no aplica a quien
 *              pagó y dejó de pagar, que pasa a SALE_ONLY).
 *
 * LOS NÚMEROS NO VIVEN AQUÍ. La gracia y la vigencia sin red vienen DENTRO
 * del certificado (grace_until, valid_until), que firma el servidor con su
 * única política (_shared/politica.ts). Cambiar la política no toca el POS.
 *
 * EL RELOJ. Se usa max(reloj, última hora vista, emisión del certificado):
 * atrasar Windows no devuelve días. Adelantarlo solo adelanta los avisos.
 * Si el reloj va MUY por detrás de la emisión se marca `relojAtrasado`, pero
 * no se bloquea nada: el cálculo usa la hora de emisión, que es segura.
 */
const DIA = 86_400_000;
const TOLERANCIA_RELOJ = 10 * 60_000;

function dias(ms) { return Math.max(0, Math.ceil(ms / DIA)); }
const fecha = (s) => { const t = Date.parse(s || ''); return Number.isFinite(t) ? t : null; };

/**
 * @param payload  certificado ya verificado
 * @param opts     { ahora, ultimaVista }
 */
function calcularEstado(payload, { ahora = Date.now(), ultimaVista = 0 } = {}) {
  const emitido = fecha(payload.issued_at) ?? 0;
  const efectivo = Math.max(ahora, Number(ultimaVista) || 0, emitido);
  const relojAtrasado = ahora + TOLERANCIA_RELOJ < Math.max(Number(ultimaVista) || 0, emitido);
  const validoHasta = fecha(payload.valid_until);
  const base = { ahoraEfectivo: new Date(efectivo).toISOString(), relojAtrasado };

  if (payload.kind === 'TRIAL') {
    const fin = fecha(payload.trial_ends_at) ?? 0;
    if (efectivo < fin) return { ...base, modo: 'TRIAL', diasRestantes: dias(fin - efectivo), hasta: payload.trial_ends_at };
    return { ...base, modo: 'EXPIRED', motivo: 'PRUEBA_TERMINADA', hasta: payload.trial_ends_at };
  }

  const pagado = fecha(payload.paid_until);
  const gracia = fecha(payload.grace_until);

  let r;
  if (pagado != null && efectivo <= pagado) {
    r = { modo: 'ACTIVE', diasRestantes: dias(pagado - efectivo), hasta: payload.paid_until };
  } else if (pagado != null && gracia != null && efectivo <= gracia) {
    r = { modo: 'GRACE', diasRestantes: dias(gracia - efectivo), hasta: payload.grace_until, vencio: payload.paid_until };
  } else {
    r = { modo: 'SALE_ONLY', motivo: pagado == null ? 'SIN_SUSCRIPCION' : 'SUSCRIPCION_VENCIDA', desde: payload.grace_until || null };
  }

  /*
   * El certificado ya no vale sin volver a validarse (offline_days). Quien
   * sigue pagado pero lleva ese tiempo sin conexión NO pierde la venta: pasa
   * a Venta Esencial hasta refrescar (en línea o importando el archivo).
   */
  if (validoHasta != null && efectivo > validoHasta && r.modo !== 'SALE_ONLY') {
    r = { modo: 'SALE_ONLY', motivo: 'SIN_VALIDAR', desde: payload.valid_until, pagadoHasta: payload.paid_until };
  }
  // Avisar un poco antes de que el certificado necesite refrescarse.
  if (validoHasta != null && r.modo !== 'SALE_ONLY') {
    const faltan = validoHasta - efectivo;
    if (faltan < 10 * DIA) r.refrescarEnDias = dias(faltan);
  }
  return { ...base, ...r };
}

module.exports = { calcularEstado, TOLERANCIA_RELOJ };
