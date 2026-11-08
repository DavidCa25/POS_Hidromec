'use strict';
/**
 * GRUPO DE EMPRESAS EN LA NUBE (POS 0080 · MultiEmpresa, Fases 2 y 3).
 *
 * Las empresas del grupo que viven en OTRA computadora se consultan con lo
 * que sus cajas ya suben, y se les piden cambios por una bandeja. Esta caja
 * nunca escribe en la base de otra empresa: deja el pedido en la nube y la
 * caja principal de esa empresa lo aplica con sus propias reglas.
 *
 *   enlace      código (30 min, un uso) que la otra empresa escribe en su caja
 *   consulta    listar, resumen, catálogo
 *   pedir       alta de producto o cambio de precio, con su clave de reintento
 *   bandeja     en cada sincronización, aplicar lo que pidieron las demás
 *               (sp_empresas_comando_aplicar, idempotente) y responder
 *
 * Solo la caja principal: es la que tiene la credencial de la empresa.
 *
 * Todas las dependencias se inyectan: scripts/pruebas/empresas.test.mjs.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIPOS = new Set(['PRODUCTO_ALTA', 'PRODUCTO_PRECIO']);

class ErrorGrupo extends Error {
  constructor(mensaje, code) { super(mensaje); this.code = code; }
}

/**
 * @param {object} deps
 *   pool()         la conexión de la empresa activa
 *   sql            mssql (tipos)
 *   llamar(action, cuerpo)   pos-sync con la credencial de esta empresa
 *   disponible()   ¿nube encendida y esta caja es la principal?
 *   log
 */
function crearGrupoEmpresas({ pool, sql, llamar, disponible, log = () => {} }) {
  async function exigirNube() {
    if (!(await disponible())) {
      throw new ErrorGrupo('Las empresas en otra computadora se ven por la nube: enciéndela en esta caja principal.', 'NO_CLOUD');
    }
  }

  // ------------------------------------------------------------- enlace
  async function codigo() {
    await exigirNube();
    const r = await llamar('grupo_codigo');
    return { codigo: r.code, vence: r.expires_at };
  }

  async function unir(codigoEscrito) {
    await exigirNube();
    const c = String(codigoEscrito || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.length !== 12) throw new ErrorGrupo('El código tiene 12 letras y números (XXXX-XXXX-XXXX).', 'BAD_CODE');
    const r = await llamar('grupo_unir', { code: c });
    return { yaEstaba: !!r.ya_estaba };
  }

  async function salir() {
    await exigirNube();
    await llamar('grupo_salir');
    return { salio: true };
  }

  // ------------------------------------------------------------ consulta
  async function listar() {
    await exigirNube();
    const r = await llamar('grupo_listar');
    return (r.empresas || []).map((e) => ({
      companyId: e.company_id,
      nombre: e.nombre,
      ubicaciones: e.ubicaciones || [],
      instancias: (e.ubicaciones || []).map((u) => String(u.instance_uuid || '').toLowerCase()).filter(Boolean),
      ultimaSync: e.ultima_sync ?? null,
    }));
  }

  function exigirEmpresa(companyId) {
    if (!UUID.test(String(companyId || ''))) throw new ErrorGrupo('Elige la empresa.', 'BAD_REQUEST');
  }

  async function resumen(companyId, { desde = null, hasta = null } = {}) {
    await exigirNube();
    exigirEmpresa(companyId);
    const r = await llamar('grupo_resumen', { company_id: companyId, desde, hasta });
    const n = (v) => Number(v) || 0;
    return {
      companyId, ventas: n(r.ventas), tickets: n(r.tickets), utilidad: null,
      turnosAbiertos: n(r.turnos_abiertos), efectivoEnCaja: n(r.efectivo_en_caja),
      ultimaVenta: r.ultima_venta ?? null, ultimaSync: r.ultima_sync ?? null,
    };
  }

  async function catalogo(companyId) {
    await exigirNube();
    exigirEmpresa(companyId);
    const r = await llamar('grupo_catalogo', { company_id: companyId });
    return { version: r.version ?? null, publicado: r.publicado ?? null, productos: r.productos || [] };
  }

  // -------------------------------------------------------------- pedir
  /**
   * La clave la genera la pantalla al abrir el formulario: si la red falla y
   * se reintenta, la nube reconoce el pedido en vez de duplicarlo.
   */
  async function pedir({ companyId, tipo, datos, claveCliente, usuario }) {
    await exigirNube();
    exigirEmpresa(companyId);
    if (!TIPOS.has(tipo)) throw new ErrorGrupo('Ese cambio no se puede pedir a otra empresa.', 'BAD_REQUEST');
    if (!UUID.test(String(claveCliente || ''))) throw new ErrorGrupo('Falta la clave del pedido.', 'BAD_REQUEST');
    const payload = normalizarDatos(tipo, datos);
    const r = await llamar('grupo_comando', {
      company_id: companyId, kind: tipo, payload, client_key: claveCliente, requested_by: usuario ? String(usuario).slice(0, 50) : null,
    });
    return { id: r.id, estado: r.status, repetido: !!r.repetido };
  }

  async function pedidos() {
    await exigirNube();
    const r = await llamar('grupo_comandos');
    return (r.comandos || []).map((c) => ({
      id: c.id, empresa: c.empresa, companyId: c.company_id, tipo: c.kind, datos: c.payload, estado: c.status,
      detalle: c.detail ?? null, pidio: c.requested_by ?? null, creado: c.creado, resuelto: c.resuelto ?? null,
    }));
  }

  // ------------------------------------------------------------ bandeja
  /**
   * Lo que las demás empresas le pidieron a ESTA. Se aplica uno por uno: un
   * pedido que falla no detiene a los demás. La respuesta se manda después
   * de aplicar; si la red se cae entre las dos cosas, la nube lo vuelve a
   * entregar y `sp_empresas_comando_aplicar` responde lo mismo sin repetirlo.
   */
  async function atenderBandeja() {
    if (!(await disponible())) return { atendidos: 0 };
    const b = await llamar('grupo_bandeja');
    let atendidos = 0;
    for (const c of b.comandos || []) {
      try {
        const r = await (await pool()).request()
          .input('comando_id', sql.UniqueIdentifier, c.id)
          .input('tipo', sql.NVarChar(30), c.kind)
          .input('origen_empresa', sql.NVarChar(200), c.empresa)
          .input('origen_usuario', sql.NVarChar(50), c.requested_by ?? null)
          .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(c.payload ?? {}))
          .execute('sp_empresas_comando_aplicar');
        const f = r.recordset?.[0] ?? {};
        await llamar('grupo_comando_resultado', { id: c.id, ok: f.resultado === 'APLICADO', detail: f.detalle ?? null });
        atendidos++;
      } catch (e) {
        log(`grupo: no se pudo atender ${c.id}: ${e.message}`);
      }
    }
    return { atendidos };
  }

  /** La bitácora local: lo que otras empresas cambiaron aquí. */
  async function recibidos() {
    const r = await (await pool()).request().query(`
      SELECT TOP (100) comando_id, tipo, origen_empresa, origen_usuario, payload, resultado, detalle, product_id, aplicado_en
        FROM dbo.empresas_comandos ORDER BY aplicado_en DESC, id DESC;`);
    return (r.recordset || []).map((x) => ({ ...x, payload: seguroJson(x.payload) }));
  }

  return { codigo, unir, salir, listar, resumen, catalogo, pedir, pedidos, atenderBandeja, recibidos };
}

function normalizarDatos(tipo, d = {}) {
  const precio = Number(d.precio);
  if (!Number.isFinite(precio) || precio < 0) throw new ErrorGrupo('Escribe un precio válido.', 'BAD_REQUEST');
  const redondo = Math.round(precio * 100) / 100;
  if (tipo === 'PRODUCTO_PRECIO') {
    if (!UUID.test(String(d.productUuid || ''))) throw new ErrorGrupo('Elige el producto.', 'BAD_REQUEST');
    return { product_uuid: String(d.productUuid).toLowerCase(), nombre: d.nombre ? String(d.nombre).slice(0, 100) : null, precio: redondo };
  }
  const nombre = String(d.nombre || '').trim();
  if (nombre.length < 2 || nombre.length > 100) throw new ErrorGrupo('Escribe el nombre del producto.', 'BAD_REQUEST');
  const texto = (v, n) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, n));
  return { nombre, precio: redondo, codigo: texto(d.codigo, 100), categoria: texto(d.categoria, 100) };
}

function seguroJson(t) { try { return JSON.parse(t); } catch { return null; } }

module.exports = { crearGrupoEmpresas, ErrorGrupo, normalizarDatos };
