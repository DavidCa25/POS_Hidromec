/**
 * MULTISUCURSAL en la caja: estado, catálogo corporativo, excepciones, reglas,
 * usuarios de empresa y traspasos entre sucursales.
 *
 * Solo la CAJA PRINCIPAL habla con la nube (su credencial es la de la
 * sucursal). Una secundaria comparte la base: ve lo mismo, pero lo que va a la
 * nube se hace desde la principal.
 *
 * Permisos (seguridad/canales.js):
 *   leer y traspasar          INVENTARIO_OPERAR
 *   publicar, excepciones,
 *   reglas y usuarios         CONFIGURACION_ADMINISTRAR
 */
const sesion = require('../seguridad/sesion');

function registrar({ ipcMain, sql, poolPromise, cloudSync, esPrincipal, equipo }) {
  const multi = () => cloudSync.multi;

  /** Errores de la nube o de SQL, con su mensaje en español; nunca un stack. */
  async function seguro(fn) {
    try { return { success: true, data: await fn() }; }
    catch (e) { return { success: false, code: e.code ?? null, error: e.message || 'No se pudo completar.' }; }
  }
  const soloPrincipal = () => {
    if (!esPrincipal()) {
      const e = new Error('Hazlo desde la caja principal de esta sucursal: es la que está conectada con las demás.');
      e.code = 'NOT_PRIMARY';
      throw e;
    }
  };

  ipcMain.handle('multi:estado', sesion.proteger('multi:estado', async () => seguro(async () => {
    soloPrincipal();
    return multi().estado();
  })));

  ipcMain.handle('multi:publicar', sesion.proteger('multi:publicar', async () => seguro(async () => {
    soloPrincipal();
    return multi().publicar({ forzar: true });
  })));

  ipcMain.handle('multi:recibir', sesion.proteger('multi:recibir', async () => seguro(async () => {
    soloPrincipal();
    return multi().recibir();
  })));

  /* Excepciones de UNA sucursal, junto con los productos de la matriz para
     poder elegirlos (la matriz los tiene todos: son los suyos). */
  ipcMain.handle('multi:excepciones', sesion.proteger('multi:excepciones', async (_e, p = {}) => seguro(async () => {
    soloPrincipal();
    const items = await multi().excepciones(String(p.locationId || ''));
    const r = await (await poolPromise).request().query(`
      SELECT LOWER(CONVERT(VARCHAR(36), p.uuid)) AS product_uuid, p.nombre, p.part_number, p.price, CAST(p.sellable AS BIT) AS sellable,
             c.namee AS categoria
        FROM dbo.products p LEFT JOIN dbo.CAT_categories c ON c.id = p.category_id
       WHERE ISNULL(p.active, 1) = 1 AND p.sellable = 1
       ORDER BY p.nombre`);
    return { items, productos: r.recordset || [] };
  })));

  ipcMain.handle('multi:excepciones-guardar', sesion.proteger('multi:excepciones-guardar', async (_e, p = {}) => seguro(async () => {
    soloPrincipal();
    const items = (Array.isArray(p.items) ? p.items : []).map((x) => ({
      product_uuid: String(x.product_uuid),
      price: x.price === '' || x.price == null ? null : Number(x.price),
      available: x.available !== false,
    }));
    if (items.some((x) => x.price != null && (!Number.isFinite(x.price) || x.price < 0))) {
      throw new Error('Un precio especial no es válido.');
    }
    return multi().guardarExcepciones(String(p.locationId || ''), items);
  })));

  ipcMain.handle('multi:reglas-guardar', sesion.proteger('multi:reglas-guardar', async (_e, p = {}) => seguro(async () => {
    soloPrincipal();
    return multi().guardarReglas({ precios_sucursal: !!p.precios_sucursal, productos_locales: p.productos_locales !== false });
  })));

  /* Usuarios de ESTA base y a qué sucursales viajan (solo tiene sentido en la
     matriz: en una sucursal los de empresa llegan solos). */
  ipcMain.handle('multi:usuarios', sesion.proteger('multi:usuarios', async () => seguro(async () => {
    const r = await (await poolPromise).request().query(`
      SELECT id, usuario, rol, CAST(ISNULL(active, 1) AS BIT) AS active, CAST(corporate AS BIT) AS corporate, corporate_scope
        FROM dbo.users ORDER BY usuario`);
    return (r.recordset || []).map((u) => ({ ...u, scope: u.corporate_scope ? JSON.parse(u.corporate_scope) : null }));
  })));

  ipcMain.handle('multi:usuario-alcance', sesion.proteger('multi:usuario-alcance', async (_e, p = {}) => seguro(async () => {
    const id = Number(p.userId);
    if (!Number.isInteger(id) || id <= 0) throw new Error('Usuario no válido.');
    let scope = null;
    if (Array.isArray(p.scope) && p.scope.length) {
      scope = p.scope.includes('*') ? ['*'] : p.scope.map((x) => String(x).toLowerCase()).filter((x) => /^[0-9a-f-]{36}$/.test(x));
    }
    const pool = await poolPromise;
    const r = await pool.request().input('id', sql.Int, id).input('scope', sql.NVarChar(sql.MAX), scope ? JSON.stringify(scope) : null)
      .query('UPDATE dbo.users SET corporate_scope = @scope WHERE id = @id AND corporate = 0; SELECT @@ROWCOUNT AS n;');
    if (!r.recordset?.[0]?.n) throw new Error('Un usuario recibido de la matriz se administra en la matriz.');
    return { userId: id, scope };
  })));

  // ------------------------------------------------------------ traspasos
  ipcMain.handle('multi:traspasos', sesion.proteger('multi:traspasos', async () => seguro(async () => {
    soloPrincipal();
    const { porRecibir } = await multi().sincronizarTraspasos();
    const r = await (await poolPromise).request()
      .input('max_rows', sql.Int, 100).input('scope', sql.VarChar(10), 'BRANCH').execute('sp_transfer_list');
    return { porRecibir, historial: r.recordsets?.[0] ?? [], lineas: r.recordsets?.[1] ?? [] };
  })));

  ipcMain.handle('multi:traspaso-enviar', sesion.proteger('multi:traspaso-enviar', async (_e, p = {}, ses) => seguro(async () => {
    soloPrincipal();
    const lineas = (Array.isArray(p.lineas) ? p.lineas : [])
      .map((l) => ({ product_uuid: String(l.product_uuid), qty: Number(l.qty) }))
      .filter((l) => l.product_uuid && Number.isFinite(l.qty) && l.qty > 0);
    if (!lineas.length) throw new Error('Agrega al menos un producto con cantidad.');
    if (!p.toLocationId) throw new Error('Elige la sucursal a la que se manda la mercancía.');
    return multi().enviarTraspaso({ userId: sesion.actorDe(ses), toLocationId: String(p.toLocationId), toNombre: String(p.toNombre || ''),
      lineas, nota: p.nota ? String(p.nota).slice(0, 255) : null, equipo: equipo(), porNombre: ses?.usuario ?? null });
  })));

  ipcMain.handle('multi:traspaso-recibir', sesion.proteger('multi:traspaso-recibir', async (_e, p = {}, ses) => seguro(async () => {
    soloPrincipal();
    if (!p.traspaso?.id) throw new Error('Falta el traspaso.');
    const recibido = {};
    for (const [k, v] of Object.entries(p.recibido || {})) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) throw new Error('Una cantidad recibida no es válida.');
      recibido[k] = n;
    }
    return multi().recibirTraspaso({ traspaso: p.traspaso, recibido, userId: sesion.actorDe(ses), equipo: equipo(), porNombre: ses?.usuario ?? null });
  })));

  ipcMain.handle('multi:traspaso-cancelar', sesion.proteger('multi:traspaso-cancelar', async (_e, p = {}) => seguro(async () => {
    soloPrincipal();
    return multi().cancelarTraspaso(String(p.id || ''));
  })));

  /* Productos con existencia propia, para armar un envío. */
  ipcMain.handle('multi:productos-traspaso', sesion.proteger('multi:productos-traspaso', async () => seguro(async () => {
    const r = await (await poolPromise).request().query(`
      SELECT LOWER(CONVERT(VARCHAR(36), uuid)) AS product_uuid, nombre, part_number, stock, base_uom, CAST(allow_decimal_qty AS BIT) AS decimales
        FROM dbo.products WHERE ISNULL(active, 1) = 1 AND inventory_mode = 'DIRECT' AND stock > 0 ORDER BY nombre`);
    return r.recordset || [];
  })));
}

/**
 * CANDADO DE PRODUCTOS CORPORATIVOS en una sucursal: lo que manda la matriz no
 * se cambia aquí. Devuelve el motivo si el cambio pedido no se permite, o null.
 * Existencia y costo son de la sucursal; el precio, solo si la empresa lo
 * permite (reglas.precios_sucursal).
 */
async function motivoCandado(pool, sql, productId, cambio) {
  const r = await pool.request().input('id', sql.Int, productId).query(`
    SELECT p.corporate, p.nombre, p.part_number, p.bar_code, p.price, p.clave_prod_serv, p.clave_unidad, p.objeto_impuesto,
           p.tasa_iva, p.inventory_mode, p.sellable, p.base_uom,
           (SELECT valor FROM dbo.database_metadata WHERE clave = 'multi_reglas') AS reglas
      FROM dbo.products p WHERE p.id = @id`);
  const p = r.recordset?.[0];
  if (!p || !p.corporate) return null;
  const distinto = (a, b) => a != null && String(a).trim() !== String(b ?? '').trim();
  const num = (a, b) => a != null && Math.abs(Number(a) - Number(b)) > 0.0001;
  const bloqueados = [
    distinto(cambio.nombre, p.nombre) && 'el nombre',
    distinto(cambio.part_number, p.part_number) && 'el código',
    cambio.bar_code !== undefined && distinto(cambio.bar_code ?? '', p.bar_code) && 'el código de barras',
    distinto(cambio.clave_prod_serv, p.clave_prod_serv) && 'la clave SAT',
    num(cambio.tasa_iva, p.tasa_iva) && 'el IVA',
    distinto(cambio.inventory_mode, p.inventory_mode) && 'el tipo de inventario',
    cambio.sellable != null && Boolean(cambio.sellable) !== Boolean(p.sellable) && 'si se vende',
    distinto(cambio.base_uom, p.base_uom) && 'la unidad',
  ].filter(Boolean);
  let reglas = {};
  try { reglas = JSON.parse(p.reglas || '{}'); } catch { /* sin reglas: lo más estricto */ }
  if (num(cambio.price, p.price) && !reglas.precios_sucursal) bloqueados.push('el precio');
  return bloqueados.length
    ? `Este producto lo administra la matriz: aquí no se puede cambiar ${bloqueados.join(', ')}. Cámbialo en la matriz y llegará solo.`
    : null;
}

/** ¿Esta sucursal puede dar de alta productos propios? */
async function puedeCrearProductos(pool) {
  const r = await pool.request().query(`
    SELECT (SELECT valor FROM dbo.database_metadata WHERE clave = 'multi_reglas') AS reglas,
           (SELECT valor FROM dbo.database_metadata WHERE clave = 'multi_version') AS version`);
  const x = r.recordset?.[0] ?? {};
  if (!x.version) return true;   // no recibe catálogo corporativo: es la matriz o no hay MultiSucursal
  try { return JSON.parse(x.reglas || '{}').productos_locales !== false; } catch { return true; }
}

module.exports = { registrar, motivoCandado, puedeCrearProductos };
