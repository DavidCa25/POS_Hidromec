'use strict';
/**
 * CLUB EN LA NUBE (0063): bajar lo que cambió en las demás sucursales.
 *
 * Subir es cosa del outbox (sp_sync_capture: MEMBERSHIP_PLAN / MEMBERSHIP /
 * MEMBERSHIP_REDEMPTION). Aquí solo se BAJA: planes, membresías renovadas en
 * otra sucursal, cafés dados allá y las marcas de "canje doble" que decide la
 * nube. Todo se aplica con sp_membership_apply_remote, que es idempotente.
 *
 * Sin internet la caja sigue canjeando con lo que tiene (decisión del
 * negocio); al volver la conexión esto pone al día los dobles.
 *
 * 0064: en la misma bajada vienen los puntos y sellos (configuración,
 * tarjetas y los movimientos de las DEMÁS sucursales); se aplican con
 * sp_loyalty_points_apply_remote, también idempotente.
 *
 * El cursor se guarda en cloud-config (clubCursor) y se pide con 5 minutos de
 * traslape: un cambio que la nube confirmó tarde no se pierde, y aplicar dos
 * veces no cambia nada.
 */
function crearClub({ pool, sql, llamar, cfg, disponible, subirAntes = () => {}, log = () => {} }) {
  let enCurso = null;
  let reloj = null;
  let inicio = null;

  async function ciclo() {
    if (!(await disponible())) return { omitido: true };
    try { subirAntes(); } catch { /* subir es aparte; no frena la bajada */ }
    const cursor = cfg.leer().clubCursor;
    const desde = cursor ? new Date(new Date(cursor).getTime() - 5 * 60000).toISOString() : null;
    const r = await llamar('club_pull', { desde });
    const payload = { plans: r.plans ?? [], memberships: r.memberships ?? [], redemptions: r.redemptions ?? [] };
    let aplicado = null;
    if (payload.plans.length || payload.memberships.length || payload.redemptions.length) {
      const p = await pool();
      aplicado = (await p.request().input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
        .execute('sp_membership_apply_remote')).recordset?.[0] ?? null;
    }
    const puntos = { points_config: r.points_config ?? null, stamp_cards: r.stamp_cards ?? [], ledger: r.ledger ?? [] };
    let aplicadoPuntos = null;
    if (puntos.points_config || puntos.stamp_cards.length || puntos.ledger.length) {
      const p = await pool();
      aplicadoPuntos = (await p.request().input('payload', sql.NVarChar(sql.MAX), JSON.stringify(puntos))
        .execute('sp_loyalty_points_apply_remote')).recordset?.[0] ?? null;
    }
    if (r.cursor) cfg.escribir({ clubCursor: r.cursor });
    return {
      aplicado, aplicadoPuntos,
      recibidos: { planes: payload.plans.length, membresias: payload.memberships.length, canjes: payload.redemptions.length,
                   tarjetas: puntos.stamp_cards.length, movimientos: puntos.ledger.length },
    };
  }

  /** Una bajada a la vez. Nunca lanza: si falla, se reintenta en el siguiente ciclo. */
  function bajar() {
    if (!enCurso) {
      enCurso = ciclo().catch((e) => { log(`club: sin bajar (se reintenta): ${e.message}`); return { error: e.message }; })
        .finally(() => { enCurso = null; });
    }
    return enCurso;
  }

  function iniciar(ms = 120000) {
    detener();
    inicio = setTimeout(() => { void bajar(); }, 20000);
    reloj = setInterval(() => { void bajar(); }, ms);
  }
  function detener() {
    if (reloj) clearInterval(reloj);
    if (inicio) clearTimeout(inicio);
    reloj = inicio = null;
  }

  return { bajar, iniciar, detener };
}

module.exports = { crearClub };
