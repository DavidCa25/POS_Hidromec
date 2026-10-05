'use strict';
/**
 * ENVÍO DE HECHOS A LA NUBE (outbox, Fase 1).
 *
 * El POS NO depende de esto para vender ni para cerrar un turno. Las ventas,
 * los turnos/cortes y los movimientos de caja importantes se capturan en
 * `dbo.sync_outbox` (sp_sync_capture, por rowversion) y este módulo los manda
 * cuando hay Internet:
 *
 *   sp_sync_capture  -> sp_sync_outbox_next -> POST events -> sp_sync_outbox_ack
 *
 * La nube es idempotente por event_uuid: reenviar un lote (porque se cortó la
 * red antes del acuse) no duplica nada. Se sincronizan HECHOS, nunca saldos.
 *
 * Solo la caja PRINCIPAL envía (las secundarias comparten la base: mandar
 * desde todas sería repetir el mismo outbox).
 */
function crearEnvioHechos({ pool, sql, llamar, puedeEnviar, huella = async () => null, log = () => {}, esperaMs = 3000 }) {
  let enCurso = null;
  let reloj = null;

  const normalizar = (e) => ({
    event_uuid: String(e.event_uuid).toLowerCase(),
    event_type: e.event_type,
    aggregate_type: e.aggregate_type,
    aggregate_uuid: String(e.aggregate_uuid).toLowerCase(),
    // BIGINT: como texto, para no perder precisión en JavaScript.
    aggregate_version: String(e.aggregate_version),
    occurred_at: e.occurred_at instanceof Date ? e.occurred_at.toISOString() : e.occurred_at,
    payload_version: Number(e.payload_version || 1),
    payload: typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload,
  });

  async function ciclo() {
    if (!(await puedeEnviar())) return { enviados: 0, omitido: true };
    const p = await pool();
    await p.request().input('max_rows', sql.Int, 500).execute('sp_sync_capture');
    let enviados = 0;
    for (let lote = 0; lote < 20; lote++) {
      const r = await p.request().input('max_rows', sql.Int, 100).execute('sp_sync_outbox_next');
      const eventos = r.recordsets?.[0] ?? [];
      if (!eventos.length) break;
      const s = r.recordsets?.[1]?.[0] ?? {};
      // Fase 2: la huella del servidor viaja en el sobre; la nube detecta una copia restaurada en otro equipo.
      const envelope = { instance_uuid: s.instance_uuid ?? null, company_uuid: s.company_uuid ?? null, location_uuid: s.location_uuid ?? null,
                         server_fingerprint: await huella() };
      const resp = await llamar('events', { envelope, events: eventos.map(normalizar) });
      const acuses = (resp.results ?? []).map(x => ({ event_uuid: x.event_uuid, result: x.result, error: x.error ?? null }));
      await p.request().input('acuses', sql.NVarChar(sql.MAX), JSON.stringify(acuses)).execute('sp_sync_outbox_ack');
      const ok = acuses.filter(a => a.result === 'APPLIED' || a.result === 'DUPLICATE').length;
      enviados += ok;
      // Si nada del lote avanzó, se espera al siguiente ciclo (no se martilla).
      if (ok === 0) break;
    }
    if (enviados) log(`hechos enviados: ${enviados}`);
    return { enviados };
  }

  /** Un envío a la vez. Nunca lanza: el outbox queda PENDING y se reintenta. */
  function enviar() {
    if (!enCurso) {
      enCurso = ciclo().catch((e) => { log(`hechos pendientes (se reintenta): ${e.message}`); return { enviados: 0, error: e.message }; })
        .finally(() => { enCurso = null; });
    }
    return enCurso;
  }

  /** "Hay algo nuevo" (p. ej. se cerró un turno): envía en unos segundos. */
  function pronto() {
    if (reloj) return;
    reloj = setTimeout(() => { reloj = null; enviar(); }, esperaMs);
    if (typeof reloj.unref === 'function') reloj.unref();
  }

  return { enviar, pronto };
}

module.exports = { crearEnvioHechos };
