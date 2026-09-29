/**
 * Piezas que comparten todas las superficies. Ninguna tiene reglas de
 * negocio: esas viven en los procedimientos de siempre.
 */

/** Un «no» del negocio: se muestra tal cual y no se reintenta. */
function negocio(mensaje, { http = 409, codigo = 'NEGOCIO' } = {}) {
  return Object.assign(new Error(mensaje), { negocio: true, http, codigo });
}

/** Algo cambio mientras la tablet estaba sin conexion: no se sobrescribe. */
function conflicto(mensaje = 'Esta información cambió mientras estabas sin conexión. Revísala antes de seguir.') {
  return Object.assign(new Error(mensaje), { negocio: true, http: 409, codigo: 'CONFLICTO' });
}

function prohibido(mensaje = 'Esta pantalla no puede hacer eso.') {
  return Object.assign(new Error(mensaje), { negocio: true, http: 403, codigo: 'PROHIBIDO' });
}

/** Un RAISERROR de un procedimiento es un mensaje para la persona; lo demas no. */
function esErrorDeNegocio(e) {
  const n = Number(e?.number ?? e?.originalError?.info?.number);
  const clase = Number(e?.class ?? e?.originalError?.info?.class);
  return (Number.isFinite(n) && n >= 50000) || clase === 16;
}

/** Ejecuta un procedimiento; un RAISERROR sale como error de negocio. */
async function sp(pool, nombre, construir) {
  try {
    const req = pool.request();
    if (construir) construir(req);
    const r = await req.execute(nombre);
    return r.recordsets || [];
  } catch (e) {
    if (esErrorDeNegocio(e)) throw negocio(String(e.message).trim());
    throw e;
  }
}

function entero(v, { min = 1, max = 2147483647 } = {}) {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function decimal(v, { min = 0, max = 999999 } = {}) {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 100) / 100 : null;
}

function texto(v, max) {
  const t = String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Hoy en la computadora principal (SQL corre en la misma), como YYYY-MM-DD. */
function hoyLocal(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

module.exports = { negocio, conflicto, prohibido, esErrorDeNegocio, sp, entero, decimal, texto, UUID, hoyLocal };
