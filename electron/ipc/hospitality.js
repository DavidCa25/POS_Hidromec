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

/**
 * Un error que se le pueda ensenar a quien esta usando la caja.
 *
 * Los procedures hablan el idioma del negocio -"El grupo necesita un
 * nombre"- y esos mensajes SI deben llegar tal cual: son la validacion, y
 * quien los lee sabe que corregir. SQL Server los marca con un numero
 * propio, de 50000 para arriba, porque los levanta un RAISERROR nuestro.
 *
 * Todo lo demas es fontaneria: el driver, el protocolo, la conexion. "A
 * boolean was expected" llego a un usuario en mitad de un QA y no le dijo
 * absolutamente nada, porque no habla de tamanos ni de opciones: habla de
 * como este proceso empaqueta un parametro. Eso se registra entero para
 * quien lo tenga que arreglar, y al usuario se le da una frase suya.
 */
function paraElUsuario(e, queSeIntentaba) {
  const n = Number(e?.number ?? e?.originalError?.info?.number);
  if (Number.isFinite(n) && n >= 50000) return e.message;
  return `No se pudo ${queSeIntentaba}. Es un fallo interno, no un dato mal escrito. ` +
         'Vuelve a intentarlo y, si sigue, avisa a soporte con la hora.';
}

/**
 * Lo que llega del formulario -> el booleano que espera `sql.Bit`.
 *
 * EL FALLO QUE ESTO EVITA
 * -----------------------
 * Guardar un grupo de modificadores con DOS o mas opciones respondia
 * "A boolean was expected". Con una sola opcion guardaba bien, y por eso
 * parecia un problema de SCALE o de tamanos cuando no lo era.
 *
 * El driver es msnodesqlv8, y su `fromRow` arma cada columna del parametro
 * de tabla de dos maneras distintas segun cuantas filas haya: con UNA fila
 * manda el valor suelto, y con dos o mas manda un ARRAY. El nivel nativo
 * tolera un `1` suelto para una columna BIT, pero al recibir un array exige
 * booleanos de verdad. Se mandaba `o.active === false ? 0 : 1`, o sea 1, y
 * con una fila colaba mientras que con dos reventaba.
 *
 * Se normaliza AQUI, en la frontera, y no en cada llamada: mientras un
 * sitio mande 1, otro true y otro "1", el que falle dependera de cuantas
 * filas tenga el formulario ese dia.
 *
 * `null` se conserva: en una columna que admite NULL no es lo mismo "no lo
 * se" que "falso".
 */
function bit(v, pordefecto = null) {
  if (v === null || v === undefined || v === '') return pordefecto;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  // '0' y 'false' llegan asi desde algunos formularios y ambos son verdaderos
  // como cadena: convertirlos con Boolean() los daria por ciertos.
  const s = String(v).trim().toLowerCase();
  if (s === '0' || s === 'false' || s === 'no') return false;
  return true;
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

  /* ---------------------------------------------------- disponibilidad
     Cuantas unidades se pueden preparar CON LAS OPCIONES ELEGIDAS.

     El catalogo responde "¿puedo ofrecer este producto?" mirando la receta
     base; esto responde "¿puedo preparar ESTA combinacion?" con la receta
     efectiva. Son preguntas distintas: un latte puede estar disponible y la
     leche de almendra que eligio el cliente estar agotada.

     Es informacion para la pantalla, NO una autorizacion: la venta vuelve a
     validar existencias dentro de su transaccion, con los productos
     bloqueados. */
  ipcMain.handle('hospitality:availability', async (_e, payload = {}) => {
    try {
      const p = await pool();
      const tvp = new sql.Table('dbo.SaleModifierType');
      tvp.columns.add('line_no', sql.Int, { nullable: false });
      tvp.columns.add('modifier_option_id', sql.Int, { nullable: false });
      tvp.columns.add('quantity', sql.Int, { nullable: false });
      for (const o of (payload.options || [])) {
        tvp.rows.add(1, Number(o.optionId ?? o.modifier_option_id), Number(o.quantity ?? 1) || 1);
      }
      const r = await p.request()
        .input('product_id', sql.Int, Number(payload.productId))
        .input('SaleModifiers', tvp)
        .execute('sp_check_availability');
      return { success: true, data: r.recordset?.[0] ?? null };
    } catch (e) {
      console.error('[HOSPITALITY] availability:', e.message);
      return { success: false, error: e.message };
    }
  });

  // --------------------------------------------------------- modificadores
  ipcMain.handle('modifiers:list', async (_e, payload = {}) => {
    try {
      const p = await pool();
      const r = await p.request()
        .input('product_id', sql.Int, payload.productId ?? null)
        .input('only_active', sql.Bit, bit(payload.onlyActive, false))
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
        bit(o.active, true), o.sortOrder ?? i + 1));

      const r = await p.request()
        .input('group_id', sql.Int, payload.groupId ?? null)
        .input('name', sql.NVarChar(80), payload.name)
        .input('role', sql.NVarChar(15), payload.role)
        .input('min_select', sql.Int, payload.minSelect ?? 0)
        .input('max_select', sql.Int, payload.maxSelect ?? 1)
        .input('required', sql.Bit, bit(payload.required, false))
        .input('active', sql.Bit, bit(payload.active, true))
        .input('sort_order', sql.Int, payload.sortOrder ?? 0)
        .input('Options', tvp)
        .execute('sp_save_modifier_group');
      return { success: true, groupId: r.recordset?.[0]?.group_id ?? null };
    } catch (e) {
      // El stack, no solo el mensaje: "A boolean was expected" sin traza no
      // dice ni que parametro ni que capa lo produjo.
      console.error('[HOSPITALITY] modifiers:save:', e.message, '\n', e.stack);
      return { success: false, error: paraElUsuario(e, 'guardar el grupo') };
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
      .input('only_active', sql.Bit, bit(payload.onlyActive, true))));

  ipcMain.handle('presentations:save', async (_e, payload = {}) =>
    ejecutar(await pool(), 'sp_save_product_presentation', (r) => r
      .input('id', sql.Int, payload.id ?? null)
      .input('product_id', sql.Int, payload.productId)
      .input('name', sql.NVarChar(60), payload.name)
      .input('factor_to_base', sql.Decimal(14, 4), payload.factorToBase)
      .input('is_default', sql.Bit, bit(payload.isDefault, false))
      .input('active', sql.Bit, bit(payload.active, true))));

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
