'use strict';
/**
 * MULTISUCURSAL: la caja principal de cada sucursal y la red de la empresa.
 *
 *   MATRIZ    publica su catálogo corporativo (sp_corporate_catalog_export) y
 *             fija excepciones por sucursal y reglas de la empresa.
 *   SUCURSAL  recibe la versión nueva y sus excepciones y las aplica en su
 *             base (sp_corporate_catalog_apply).
 *   TODAS     traspasan mercancía: enviar baja la existencia aquí; la otra
 *             sucursal sube lo que realmente le llegó; quien envía puede
 *             cancelar mientras no se reciba.
 *
 * SIN RED NO SE DETIENE NADA. Cada paso local queda hecho y la nube se pone al
 * día en la siguiente sincronización: los envíos se reintentan (idempotentes
 * por su uuid), las recepciones también, y el catálogo llega cuando haya red.
 *
 * Todas las dependencias se inyectan: tests/unit/multisucursal.test.js.
 */
const crypto = require('crypto');

function crearMultisucursal({ pool, sql, llamar, cfg, log = () => {} }) {
  const meta = async (claves) => {
    const r = await (await pool()).request().query(
      `SELECT clave, valor FROM dbo.database_metadata WHERE clave IN (${claves.map((c) => `'${c}'`).join(',')})`);
    return Object.fromEntries((r.recordset || []).map((x) => [x.clave, x.valor]));
  };

  /** Lo que dice la nube y lo que tiene esta base. */
  async function estado() {
    const nube = await llamar('multi_estado');
    const local = await meta(['multi_version', 'multi_overrides_revision', 'multi_aplicado_en', 'multi_reglas']);
    return {
      multisucursal: !!nube.multisucursal,
      esMatriz: !!nube.es_matriz,
      locationId: nube.location_id,
      matriz: nube.matriz ?? null,
      sucursales: nube.sucursales ?? [],
      reglas: nube.reglas ?? { precios_sucursal: false, productos_locales: true },
      versionNube: nube.version ?? null,
      versionLocal: local.multi_version ? Number(local.multi_version) : null,
      aplicadoEn: local.multi_aplicado_en ?? null,
      publicadoEn: cfg.leer().multiPublicadoEn ?? null,
    };
  }

  /* Una sucursal que el dueño hizo matriz traía productos y usuarios «de la
     matriz» con candado. Ahora ella es la fuente: se sueltan, una vez. */
  async function soltarSiFueSucursal() {
    await (await pool()).request().query(`
      IF EXISTS (SELECT 1 FROM dbo.database_metadata WHERE clave = 'multi_version' AND valor <> '')
      BEGIN
        UPDATE dbo.products SET corporate = 0, corporate_price = NULL, corporate_sellable = NULL,
               corporate_override = NULL, corporate_available = NULL WHERE corporate = 1;
        UPDATE dbo.users SET corporate = 0 WHERE corporate = 1;
        UPDATE dbo.database_metadata SET valor = '', actualizado_en = SYSDATETIME()
         WHERE clave IN ('multi_version', 'multi_overrides_revision', 'multi_reglas', 'multi_location_id');
      END`);
  }

  /** MATRIZ: publica si el catálogo cambió desde la última vez. */
  async function publicar({ forzar = false } = {}) {
    await soltarSiFueSucursal();
    const r = await (await pool()).request().execute('sp_corporate_catalog_export');
    const texto = r.recordset?.[0]?.catalog_json;
    if (!texto) return { publicado: false };
    const catalog = JSON.parse(texto);
    const huella = crypto.createHash('sha256').update(texto).digest('hex');
    if (!forzar && cfg.leer().multiPublishHash === huella) return { publicado: false, sinCambios: true };
    const res = await llamar('multi_publicar', { catalog });
    cfg.escribir({ multiPublishHash: huella, multiPublicadoEn: new Date().toISOString(), multiVersion: res.version });
    return { publicado: true, version: res.version, productos: catalog.products?.length ?? 0 };
  }

  /** SUCURSAL: pide solo lo que cambió y lo aplica en una transacción. */
  async function recibir() {
    const local = await meta(['multi_version', 'multi_overrides_revision']);
    const version = Number(local.multi_version || 0);
    const rev = local.multi_overrides_revision != null ? Number(local.multi_overrides_revision) : -1;
    const r = await llamar('multi_recibir', { version, overrides_revision: rev });
    if (r.es_matriz) return { aplicado: false, esMatriz: true };
    if (!r.catalog && !r.overrides && rev === r.overrides_revision) return { aplicado: false, version };
    const q = (await pool()).request()
      .input('catalog', sql.NVarChar(sql.MAX), r.catalog ? JSON.stringify(r.catalog) : null)
      .input('overrides', sql.NVarChar(sql.MAX), r.overrides ? JSON.stringify(r.overrides) : null)
      .input('reglas', sql.NVarChar(sql.MAX), JSON.stringify(r.reglas ?? {}))
      .input('location_id', sql.NVarChar(36), r.location_id ?? cfg.leer().locationId ?? null)
      .input('version', sql.Int, r.catalog ? r.version : version || null)
      .input('overrides_revision', sql.Int, r.overrides_revision ?? null);
    const res = (await q.execute('sp_corporate_catalog_apply')).recordset?.[0] ?? {};
    if (res.avisos) log(`catálogo corporativo: ${res.avisos}`);
    return { aplicado: true, version: r.version, ...res };
  }

  // ------------------------------------------------------------ excepciones
  const excepciones = (locationId) => llamar('multi_excepciones_listar', { location_id: locationId }).then((r) => r.items ?? []);
  const guardarExcepciones = (locationId, items) => llamar('multi_excepciones', { location_id: locationId, items });
  const guardarReglas = (reglas) => llamar('multi_excepciones', { reglas });

  // -------------------------------------------------------------- traspasos
  /** Envío: primero aquí (baja existencia), luego la nube. Si no hay red, el
      envío queda y se reintenta solo en la siguiente sincronización. */
  async function enviarTraspaso({ userId, toLocationId, toNombre, lineas, nota, equipo, porNombre }) {
    const id = crypto.randomUUID();
    const r = await (await pool()).request()
      .input('user_id', sql.Int, userId)
      .input('to_location_uuid', sql.UniqueIdentifier, toLocationId)
      .input('to_name', sql.NVarChar(120), toNombre)
      .input('lines', sql.NVarChar(sql.MAX), JSON.stringify(lineas))
      .input('note', sql.NVarChar(255), nota || null)
      .input('machine_name', sql.NVarChar(120), equipo || null)
      .input('transfer_uuid', sql.UniqueIdentifier, id)
      .execute('sp_branch_transfer_send');
    const lines = r.recordsets?.[1] ?? [];
    let enNube = false;
    try {
      await llamar('multi_traspaso_enviar', { id, to_location_id: toLocationId, lines, note: nota || null, sent_by_name: porNombre || null });
      enNube = true;
    } catch (e) { log(`traspaso ${id}: queda pendiente de subir (${e.message})`); }
    return { id, enNube, lineas: lines };
  }

  /** Recepción: aquí entra lo que llegó; luego se avisa a la nube. */
  async function recibirTraspaso({ traspaso, recibido, userId, equipo, porNombre }) {
    const lines = (traspaso.lines || []).map((l) => ({
      product_uuid: l.product_uuid, nombre: l.nombre, qty_sent: Number(l.qty),
      qty: Number(recibido?.[l.product_uuid] ?? l.qty),
    }));
    await (await pool()).request()
      .input('transfer_uuid', sql.UniqueIdentifier, traspaso.id)
      .input('user_id', sql.Int, userId)
      .input('from_location_uuid', sql.UniqueIdentifier, traspaso.from_location_id)
      .input('from_name', sql.NVarChar(120), traspaso.from_nombre)
      .input('lines', sql.NVarChar(sql.MAX), JSON.stringify(lines))
      .input('note', sql.NVarChar(255), traspaso.note || null)
      .input('machine_name', sql.NVarChar(120), equipo || null)
      .execute('sp_branch_transfer_receive');
    let enNube = false;
    try {
      await llamar('multi_traspaso_recibir', { id: traspaso.id, received_by_name: porNombre || null,
        received_lines: lines.map((l) => ({ product_uuid: l.product_uuid, qty: l.qty })) });
      enNube = true;
    } catch (e) { log(`recepción ${traspaso.id}: queda pendiente de subir (${e.message})`); }
    return { id: traspaso.id, enNube };
  }

  async function cancelarTraspaso(id) {
    await llamar('multi_traspaso_cancelar', { id });
    await liquidar(id, 'CANCELLED', null);
    return { id, status: 'CANCELLED' };
  }

  const liquidar = async (id, status, received) => (await pool()).request()
    .input('transfer_uuid', sql.UniqueIdentifier, id)
    .input('status', sql.VarChar(12), status)
    .input('received_lines', sql.NVarChar(sql.MAX), received ? JSON.stringify(received) : null)
    .execute('sp_branch_transfer_settle');

  /**
   * Pone de acuerdo esta base y la nube:
   *   · envíos locales que la nube no conoce -> se suben (idempotente);
   *   · envíos que la otra sucursal ya recibió o que se cancelaron -> se cierran aquí;
   *   · recepciones hechas aquí que la nube aún da por pendientes -> se confirman.
   * Devuelve lo que falta recibir en esta sucursal, para la pantalla.
   */
  async function sincronizarTraspasos() {
    const p = await pool();
    const locales = (await p.request().query(`
      SELECT LOWER(CONVERT(VARCHAR(36), t.uuid)) AS id, t.kind, t.status, LOWER(CONVERT(VARCHAR(36), t.event_location_uuid)) AS otra,
             t.note, u.usuario AS por
        FROM dbo.stock_transfers t LEFT JOIN dbo.users u ON u.id = t.created_by
       WHERE t.kind IN ('BRANCH_OUT', 'BRANCH_IN') AND t.created_at > DATEADD(DAY, -30, SYSDATETIME())`)).recordset || [];
    const lineas = async (id) => ((await p.request().input('id', sql.UniqueIdentifier, id).query(`
      SELECT LOWER(CONVERT(VARCHAR(36), pr.uuid)) AS product_uuid, pr.nombre, l.qty_sent AS qty, l.qty_received
        FROM dbo.stock_transfer_lines l JOIN dbo.stock_transfers t ON t.id = l.transfer_id JOIN dbo.products pr ON pr.id = l.product_id
       WHERE t.uuid = @id ORDER BY l.id`)).recordset || []);

    const b = await llamar('multi_traspaso_bandeja');
    const enviados = new Map((b.enviados ?? []).map((t) => [t.id, t]));
    const entrantes = b.entrantes ?? [];

    for (const t of locales.filter((x) => x.kind === 'BRANCH_OUT')) {
      const nube = enviados.get(t.id);
      try {
        if (!nube && t.status === 'SENT') {
          const ls = await lineas(t.id);
          await llamar('multi_traspaso_enviar', { id: t.id, to_location_id: t.otra, note: t.note,
            sent_by_name: t.por, lines: ls.map((l) => ({ product_uuid: l.product_uuid, nombre: l.nombre, qty: Number(l.qty) })) });
        } else if (nube && t.status === 'SENT' && nube.status !== 'SENT') {
          await liquidar(t.id, nube.status, nube.received_lines);
        }
      } catch (e) { log(`traspaso ${t.id}: ${e.message}`); }
    }

    const recibidosAqui = new Set(locales.filter((x) => x.kind === 'BRANCH_IN').map((x) => x.id));
    for (const t of entrantes.filter((x) => recibidosAqui.has(x.id))) {
      try {
        const ls = await lineas(t.id);
        await llamar('multi_traspaso_recibir', { id: t.id, received_lines: ls.map((l) => ({ product_uuid: l.product_uuid, qty: Number(l.qty_received) })) });
      } catch (e) { log(`recepción ${t.id}: ${e.message}`); }
    }
    return { porRecibir: entrantes.filter((x) => !recibidosAqui.has(x.id)) };
  }

  /** El ciclo de fondo. Sin MultiSucursal no hace nada. */
  async function sincronizar() {
    const e = await llamar('multi_estado');
    if (!e.multisucursal) return { activo: false };
    const out = { activo: true, esMatriz: !!e.es_matriz };
    try { out.catalogo = e.es_matriz ? await publicar() : await recibir(); } catch (err) { out.errorCatalogo = err.message; log(`catálogo corporativo: ${err.message}`); }
    try { out.traspasos = await sincronizarTraspasos(); } catch (err) { out.errorTraspasos = err.message; log(`traspasos: ${err.message}`); }
    return out;
  }

  return { estado, publicar, recibir, excepciones, guardarExcepciones, guardarReglas,
    enviarTraspaso, recibirTraspaso, cancelarTraspaso, sincronizarTraspasos, sincronizar };
}

module.exports = { crearMultisucursal };
