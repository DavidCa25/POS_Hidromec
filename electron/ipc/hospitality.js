/**
 * IPC del dominio Hospitality.
 *
 * Un modulo por dominio, no mas handlers sueltos en main.js. Aqui NO hay
 * reglas de negocio: cada handler traduce el payload a parametros y llama a
 * su procedure. Quien decide es SQL.
 *
 * Nombres por dominio: recipes:*, modifiers:*, catalog:*, images:*.
 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

/** Envoltorio uniforme: nunca lanza al renderer, siempre {success, ...}. */
async function ejecutar(pool, nombre, construir) {
  try {
    const req = pool.request();
    construir(req);
    const r = await req.execute(nombre);
    return { success: true, data: r.recordset ?? [], sets: r.recordsets ?? [] };
  } catch (e) {
    console.error(`[HOSPITALITY] ${nombre}:`, e.message);
    return { success: false, error: e.message };
  }
}

/** Carpeta de miniaturas cacheadas de ESTA caja. */
function dirThumbs() {
  const d = path.join(app.getPath('userData'), 'thumbs');
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

function registrar({ ipcMain, sql, poolPromise, nativeImage }) {
  const pool = () => poolPromise;

  // ------------------------------------------------------------- catalogo
  ipcMain.handle('catalog:menu', async () => {
    try {
      const p = await pool();
      const r = await p.request().execute('sp_get_menu_catalog');
      const [categorias = [], productos = [], grupos = [], opciones = [], relaciones = []] = r.recordsets || [];
      return { success: true, data: { categorias, productos, grupos, opciones, relaciones } };
    } catch (e) {
      console.error('[HOSPITALITY] catalog:menu:', e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('catalog:uoms', async () =>
    ejecutar(await pool(), 'sp_get_uoms', () => {}));

  ipcMain.handle('catalog:ingredients', async (_e, payload = {}) =>
    ejecutar(await pool(), 'sp_get_ingredients', (r) =>
      r.input('search', sql.NVarChar(100), payload.search ?? null)));

  // -------------------------------------------------------------- recetas
  ipcMain.handle('recipes:get', async (_e, payload = {}) => {
    try {
      const p = await pool();
      const r = await p.request()
        .input('product_id', sql.Int, payload.productId)
        .input('variant_option_id', sql.Int, payload.variantOptionId ?? null)
        .execute('sp_get_recipe');
      const [cab = [], lineas = []] = r.recordsets || [];
      return { success: true, data: { header: cab[0] ?? null, lines: lineas } };
    } catch (e) {
      console.error('[HOSPITALITY] recipes:get:', e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('recipes:save', async (_e, payload = {}) => {
    try {
      const p = await pool();
      const tvp = new sql.Table('dbo.RecipeLineType');
      tvp.columns.add('ingredient_product_id', sql.Int, { nullable: false });
      tvp.columns.add('input_qty', sql.Decimal(12, 3), { nullable: false });
      tvp.columns.add('input_uom', sql.NVarChar(10), { nullable: false });
      tvp.columns.add('waste_pct', sql.Decimal(5, 2), { nullable: true });
      tvp.columns.add('sort_order', sql.Int, { nullable: true });
      (payload.lines || []).forEach((l, i) => tvp.rows.add(
        l.ingredientProductId, l.inputQty, l.inputUom, l.wastePct ?? 0, l.sortOrder ?? i + 1));

      const r = await p.request()
        .input('product_id', sql.Int, payload.productId)
        .input('variant_option_id', sql.Int, payload.variantOptionId ?? null)
        .input('notes', sql.NVarChar(300), payload.notes ?? null)
        .input('Lines', tvp)
        .execute('sp_save_recipe');
      return { success: true, recipeId: r.recordset?.[0]?.recipe_id ?? null };
    } catch (e) {
      console.error('[HOSPITALITY] recipes:save:', e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('recipes:delete', async (_e, payload = {}) =>
    ejecutar(await pool(), 'sp_delete_recipe', (r) => r.input('recipe_id', sql.Int, payload.recipeId)));

  // --------------------------------------------------------- modificadores
  ipcMain.handle('modifiers:list', async (_e, payload = {}) => {
    try {
      const p = await pool();
      const r = await p.request()
        .input('product_id', sql.Int, payload.productId ?? null)
        .input('only_active', sql.Bit, payload.onlyActive ? 1 : 0)
        .execute('sp_get_modifier_groups');
      const [grupos = [], opciones = []] = r.recordsets || [];
      return { success: true, data: { grupos, opciones } };
    } catch (e) {
      console.error('[HOSPITALITY] modifiers:list:', e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('modifiers:save', async (_e, payload = {}) => {
    try {
      const p = await pool();
      const tvp = new sql.Table('dbo.ModifierOptionType');
      tvp.columns.add('id', sql.Int, { nullable: true });
      tvp.columns.add('name', sql.NVarChar(80), { nullable: false });
      tvp.columns.add('price_delta', sql.Decimal(10, 2), { nullable: true });
      tvp.columns.add('effect', sql.NVarChar(12), { nullable: false });
      tvp.columns.add('ingredient_product_id', sql.Int, { nullable: true });
      tvp.columns.add('replaces_product_id', sql.Int, { nullable: true });
      tvp.columns.add('qty_base', sql.Decimal(14, 4), { nullable: true });
      tvp.columns.add('qty_factor', sql.Decimal(8, 4), { nullable: true });
      tvp.columns.add('active', sql.Bit, { nullable: true });
      tvp.columns.add('sort_order', sql.Int, { nullable: true });
      (payload.options || []).forEach((o, i) => tvp.rows.add(
        o.id ?? null, o.name, o.priceDelta ?? 0, o.effect,
        o.ingredientProductId ?? null, o.replacesProductId ?? null,
        o.qtyBase ?? null, o.qtyFactor ?? null,
        o.active === false ? 0 : 1, o.sortOrder ?? i + 1));

      const r = await p.request()
        .input('group_id', sql.Int, payload.groupId ?? null)
        .input('name', sql.NVarChar(80), payload.name)
        .input('role', sql.NVarChar(15), payload.role)
        .input('min_select', sql.Int, payload.minSelect ?? 0)
        .input('max_select', sql.Int, payload.maxSelect ?? 1)
        .input('required', sql.Bit, payload.required ? 1 : 0)
        .input('active', sql.Bit, payload.active === false ? 0 : 1)
        .input('sort_order', sql.Int, payload.sortOrder ?? 0)
        .input('Options', tvp)
        .execute('sp_save_modifier_group');
      return { success: true, groupId: r.recordset?.[0]?.group_id ?? null };
    } catch (e) {
      console.error('[HOSPITALITY] modifiers:save:', e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('modifiers:delete', async (_e, payload = {}) =>
    ejecutar(await pool(), 'sp_delete_modifier_group', (r) => r.input('group_id', sql.Int, payload.groupId)));

  ipcMain.handle('modifiers:set-product-groups', async (_e, payload = {}) =>
    ejecutar(await pool(), 'sp_set_product_modifier_groups', (r) => r
      .input('product_id', sql.Int, payload.productId)
      .input('group_ids_json', sql.NVarChar(sql.MAX), JSON.stringify(payload.groupIds || []))));

  // ------------------------------------------------- presentaciones compra
  ipcMain.handle('presentations:list', async (_e, payload = {}) =>
    ejecutar(await pool(), 'sp_get_product_presentations', (r) => r
      .input('product_id', sql.Int, payload.productId ?? null)
      .input('only_active', sql.Bit, payload.onlyActive === false ? 0 : 1)));

  ipcMain.handle('presentations:save', async (_e, payload = {}) =>
    ejecutar(await pool(), 'sp_save_product_presentation', (r) => r
      .input('id', sql.Int, payload.id ?? null)
      .input('product_id', sql.Int, payload.productId)
      .input('name', sql.NVarChar(60), payload.name)
      .input('factor_to_base', sql.Decimal(14, 4), payload.factorToBase)
      .input('is_default', sql.Bit, payload.isDefault ? 1 : 0)
      .input('active', sql.Bit, payload.active === false ? 0 : 1)));

  ipcMain.handle('presentations:delete', async (_e, payload = {}) =>
    ejecutar(await pool(), 'sp_delete_product_presentation', (r) => r.input('id', sql.Int, payload.id)));

  // -------------------------------------------------------------- imagenes
  /**
   * Guarda la imagen de un producto reduciendola a miniatura.
   *
   * La reduccion se hace aqui, con el Chromium que ya trae Electron
   * (nativeImage): sin dependencias nuevas y sin mandar el original por IPC.
   * Solo viaja la miniatura, que es lo unico que Touch muestra.
   */
  ipcMain.handle('images:set', async (_e, payload = {}) => {
    try {
      const p = await pool();
      let buf = null, w = 0, h = 0;

      if (payload.dataUrl) {
        let img = nativeImage.createFromDataURL(payload.dataUrl);
        if (img.isEmpty()) throw new Error('La imagen no se pudo leer.');
        const size = img.getSize();
        const LADO = 192;
        if (size.width > LADO || size.height > LADO) {
          img = img.resize({ width: Math.min(LADO, size.width), height: undefined, quality: 'good' });
        }
        const s = img.getSize();
        w = s.width; h = s.height;
        // Calidad decreciente hasta caber en el limite del CHECK (64 KB).
        for (const q of [80, 65, 50, 35]) {
          buf = img.toJPEG(q);
          if (buf.length <= 64 * 1024) break;
        }
        if (!buf || buf.length > 64 * 1024) throw new Error('La imagen es demasiado compleja para reducirla. Usa otra.');
      }

      const r = await p.request()
        .input('product_id', sql.Int, payload.productId)
        .input('thumb', sql.VarBinary(sql.MAX), buf)
        .input('mime', sql.NVarChar(30), 'image/jpeg')
        .input('width', sql.Int, w)
        .input('height', sql.Int, h)
        .execute('sp_set_product_image');

      // La copia local de esta caja queda obsoleta.
      try { fs.rmSync(path.join(dirThumbs(), `${payload.productId}.jpg`), { force: true }); } catch { /* noop */ }
      return { success: true, data: r.recordset?.[0] ?? null };
    } catch (e) {
      console.error('[HOSPITALITY] images:set:', e.message);
      return { success: false, error: e.message };
    }
  });

  /**
   * Sincroniza la cache local de miniaturas.
   *
   * Recibe {id: version} de lo que la caja ya tiene y baja SOLO lo que
   * cambio. Devuelve rutas file:// listas para <img>: la rejilla Touch no
   * mueve blobs por IPC ni los guarda en memoria.
   */
  /*
   * La miniatura viaja como data URL, no como ruta del disco.
   *
   * En desarrollo el renderer corre en http://localhost:4200 y el navegador
   * bloquea cualquier subrecurso file://, asi que las fotos no se veian
   * nunca. El cache en disco se conserva -evita volver a SQL-, lo unico que
   * cambia es la forma en que se entrega: como maximo 64 KB por imagen, que
   * es el limite que ya impone el CHECK de product_images.
   */
  const comoDataUrl = (buf) => `data:image/jpeg;base64,${Buffer.from(buf).toString('base64')}`;

  ipcMain.handle('images:sync', async (_e, payload = {}) => {
    try {
      const dir = dirThumbs();
      const pedidos = payload.versions || {};
      const faltantes = [];
      const rutas = {};

      for (const [id, version] of Object.entries(pedidos)) {
        const f = path.join(dir, `${id}.jpg`);
        const meta = path.join(dir, `${id}.ver`);
        let local = null;
        try { local = fs.readFileSync(meta, 'utf8').trim(); } catch { /* sin cache */ }
        if (fs.existsSync(f) && local === String(version)) rutas[id] = comoDataUrl(fs.readFileSync(f));
        else faltantes.push(Number(id));
      }

      if (faltantes.length) {
        const p = await pool();
        const r = await p.request()
          .input('ids_json', sql.NVarChar(sql.MAX), JSON.stringify(faltantes))
          .execute('sp_get_product_thumbs');
        for (const fila of r.recordset ?? []) {
          const f = path.join(dir, `${fila.product_id}.jpg`);
          fs.writeFileSync(f, fila.thumb);
          fs.writeFileSync(path.join(dir, `${fila.product_id}.ver`), String(fila.version), 'utf8');
          rutas[fila.product_id] = comoDataUrl(fila.thumb);
        }
      }

      return { success: true, data: { rutas, descargadas: faltantes.length } };
    } catch (e) {
      console.error('[HOSPITALITY] images:sync:', e.message);
      return { success: false, error: e.message };
    }
  });
}

module.exports = { registrar };
