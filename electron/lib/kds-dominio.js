/**
 * EL KDS, UNA SOLA VEZ.
 *
 * La pantalla de cocina de la caja (IPC) y la de una tablet (Local Host)
 * leen y avanzan comandas con ESTO: los mismos procedimientos, la misma regla
 * de pasos y la misma forma de datos. Si mañana cambia el flujo, cambia en un
 * sitio.
 *
 * La regla del flujo vive en SQL (`sp_comanda_estado`: solo hacia delante).
 * Aqui solo se decide cual es el SIGUIENTE paso a partir del estado que dice
 * la base, nunca el que diga una pantalla.
 */

/** El paso siguiente de cada estado, con el texto del boton (igual que la caja). */
const SIGUIENTE = {
  NUEVA: { estado: 'PREPARANDO', texto: 'Empezar' },
  PREPARANDO: { estado: 'LISTA', texto: 'Lista' },
  LISTA: { estado: 'ENTREGADA', texto: 'Entregada' },
};

/** Los mismos umbrales del reloj que la caja: ambar a los 8 minutos, rojo a los 15. */
const UMBRALES = { avisoMin: 8, atrasoMin: 15 };

function numero(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

/** Las comandas pendientes (de una estacion o de todas), con sus lineas y opciones. */
async function listar({ pool, sql, stationId = null }) {
  const r = await pool.request()
    .input('station_id', sql.Int, numero(stationId))
    .input('comanda_id', sql.Int, null)
    .execute('sp_kds_get');
  return armar(r.recordsets || []);
}

/** Una comanda, en el estado que tenga (tambien entregada o cancelada). */
async function una({ pool, sql, comandaId }) {
  const r = await pool.request()
    .input('station_id', sql.Int, null)
    .input('comanda_id', sql.Int, numero(comandaId))
    .execute('sp_kds_get');
  return armar(r.recordsets || [])[0] ?? null;
}

/** La forma que pinta cualquier KDS: cabecera, lineas con sus opciones, y el paso siguiente. */
function armar(sets) {
  const [cab = [], lineas = [], opciones = []] = sets;
  return cab.map((c) => ({
    id: c.id,
    estado: c.estado,
    estacion: c.estacion,
    stationId: c.station_id,
    cuentaId: c.cuenta_id,
    destino: c.destino,
    area: c.area ?? null,
    segundos: Number(c.segundos || 0),
    siguiente: SIGUIENTE[c.estado] ?? null,
    lineas: lineas.filter((l) => l.comanda_id === c.id).map((l) => ({
      id: l.id,
      nombre: l.nombre,
      cantidad: Number(l.cantidad),
      nota: l.nota ?? null,
      opciones: opciones.filter((o) => o.linea_id === l.id)
        .map((o) => (o.quantity > 1 ? `${o.quantity}× ` : '') + o.option_name),
    })),
  }));
}

/**
 * Avanza la comanda UN paso desde el estado que la pantalla VIO. Si la base
 * ya no esta ahi (otra pantalla la avanzo, o este mismo toque ya llego y la
 * respuesta se perdio), no se avanza dos veces: se devuelve como esta.
 */
async function avanzar({ pool, sql, comandaId, desde, userId = null }) {
  const id = numero(comandaId);
  /* Leer y mover en UNA transaccion, con la fila bloqueada para escribir:
     dos tablets que tocan «Empezar» a la vez no leen las dos NUEVA. La
     segunda espera a la primera, ve PREPARANDO y sale como repetida. */
  const tx = new sql.Transaction(pool);
  await tx.begin();
  let repetido = true;
  try {
    const r = await new sql.Request(tx).input('id', sql.Int, id)
      .query('SELECT estado FROM dbo.comandas WITH (UPDLOCK, ROWLOCK) WHERE id = @id;');
    const estado = r.recordset?.[0]?.estado;
    if (!estado) {
      await tx.rollback();
      return { ok: false, codigo: 'NO_EXISTE', error: 'Esta comanda ya no existe.' };
    }
    const paso = SIGUIENTE[estado];
    if ((!desde || estado === desde) && paso) {
      await new sql.Request(tx)
        .input('comanda_id', sql.Int, id)
        .input('estado', sql.NVarChar(12), paso.estado)
        .input('user_id', sql.Int, userId)
        .execute('sp_comanda_estado');
      repetido = false;
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
  return { ok: true, comanda: await una({ pool, sql, comandaId: id }), repetido };
}

module.exports = { SIGUIENTE, UMBRALES, listar, una, armar, avanzar };
