/**
 * DOCUMENTOS DE COMPRA (0077): subir un ticket, nota o factura y que la compra
 * se llene sola.
 *
 *   compras-doc:leer      lee el documento (XML del SAT exacto; foto con OCR
 *                         local), lo guarda y propone proveedor y productos
 *   compras-doc:aprender  al registrar la compra: liga el documento y recuerda,
 *                         por proveedor, qué producto y presentación es cada
 *                         renglón (la próxima vez sale solo)
 *   compras-doc:archivo   la imagen o el XML guardado, para verlo de nuevo
 *   compras-doc:de-compra los documentos de una compra
 *
 * Nada de esto toca inventario ni dinero: eso lo hace `sp-register-purchase`
 * cuando la persona confirma. Aquí solo se lee y se propone.
 */
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { app, nativeImage } = require('electron');
const sesion = require('../seguridad/sesion');
const ambito = require('../empresas/ambito');  // archivos de la empresa activa (docs/multiempresa.md)
const ocr = require('../ocr/motor.cjs');
const { interpretar } = require('../ocr/ticket.cjs');
const { leerCfdi } = require('../ocr/cfdi.cjs');

const MAX_BYTES = 15 * 1024 * 1024;
const IMAGENES = /\.(png|jpe?g|webp|bmp|gif)$/i;

/* ---------------------------------------------------------- texto y parecido */

const ABREV = {
  REF: 'REFRESCO', HIG: 'HIGIENICO', PAQ: 'PAQUETE', PQ: 'PAQUETE', CJ: 'CAJA', NR: 'NO RETORNABLE', RET: 'RETORNABLE',
  VID: 'VIDRIO', CHOC: 'CHOCOLATE', DET: 'DETERGENTE', DES: 'DESECHABLE', LECH: 'LECHE', SAB: 'SABOR', NAT: 'NATURAL',
  ACEIT: 'ACEITE', GALL: 'GALLETA', PAP: 'PAPAS', JAB: 'JABON', SHAMP: 'SHAMPOO', SUAV: 'SUAVIZANTE', BLANQ: 'BLANQUEADOR',
  MAYON: 'MAYONESA', SALS: 'SALSA', CONS: 'CONSERVA', AZ: 'AZUCAR', ARR: 'ARROZ', FRIJ: 'FRIJOL', ENT: 'ENTERA', DESL: 'DESLACTOSADA',
};
function sinAcentos(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, ''); }

/** Clave estable de un renglón: mayúsculas, sin acentos ni espacios dobles. */
function normalizar(s) {
  return sinAcentos(s).toUpperCase().replace(/[^A-Z0-9/.%]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** Palabras con significado: abreviaturas expandidas y medidas en una sola forma (600ML, 1L→1000ML). */
function palabras(s) {
  const out = new Set();
  const t = normalizar(s).replace(/(\d+(?:\.\d+)?)\s*(ML|L|LT|LTS|G|GR|GRS|KG|KGS)\b/g, (_, n, u) => {
    const v = Number(n);
    if (/^L/.test(u)) return ` ${v * 1000}ML `;
    if (/^KG/.test(u)) return ` ${v * 1000}G `;
    if (/^G/.test(u)) return ` ${v}G `;
    return ` ${v}ML `;
  });
  for (let w of t.split(' ')) {
    if (!w || w.length < 2 && !/\d/.test(w)) continue;
    w = ABREV[w] || w;
    for (const x of w.split(' ')) out.add(x);
  }
  return out;
}

/** Qué tanto se parecen dos descripciones: palabras en común, y las medidas pesan doble. */
function parecido(a, b) {
  const A = palabras(a), B = palabras(b);
  if (!A.size || !B.size) return 0;
  let comun = 0, total = 0;
  const peso = (w) => (/^\d+(ML|G)$/.test(w) ? 2 : 1);
  for (const w of new Set([...A, ...B])) {
    const p = peso(w); total += p;
    if (A.has(w) && B.has(w)) comun += p;
    else if (A.has(w) && [...B].some(x => x.length >= 4 && w.length >= 4 && (x.startsWith(w) || w.startsWith(x)))) comun += p * 0.7;
  }
  return comun / total;
}

/* ------------------------------------------------------------ registrar */

function registrar({ ipcMain, sql, poolPromise }) {
  const carpeta = () => {
    const d = ambito.ruta('compras-documentos');
    fs.mkdirSync(d, { recursive: true });
    return d;
  };

  async function catalogo(pool, supplierId) {
    const [prods, pres, alias] = await Promise.all([
      pool.request().query(`SELECT id, nombre, part_number, bar_code, base_uom, tasa_iva, cost FROM dbo.products WHERE active = 1;`),
      pool.request().query(`SELECT id, product_id, name, CAST(factor_to_base AS FLOAT) AS factor FROM dbo.product_presentations WHERE active = 1;`),
      supplierId ? pool.request().input('s', sql.Int, supplierId)
        .query(`SELECT texto, codigo, product_id, presentation_id, CAST(factor AS FLOAT) AS factor, veces FROM dbo.supplier_item_aliases WHERE supplier_id = @s;`)
        : Promise.resolve({ recordset: [] }),
    ]);
    const presDe = new Map();
    for (const p of pres.recordset || []) (presDe.get(p.product_id) || presDe.set(p.product_id, []).get(p.product_id)).push(p);
    return { productos: prods.recordset || [], presDe, alias: alias.recordset || [] };
  }

  async function proveedorDe(pool, doc) {
    const r = await pool.request().query(`SELECT id, nombre, rfc FROM dbo.CAT_suppliers WHERE ISNULL(activo, 1) = 1;`);
    const lista = r.recordset || [];
    if (doc.rfc) {
      const porRfc = lista.find(s => normalizar(s.rfc) === normalizar(doc.rfc));
      if (porRfc) return { id: porRfc.id, nombre: porRfc.nombre, por: 'rfc' };
    }
    if (doc.proveedor) {
      let mejor = null;
      for (const s of lista) { const p = parecido(doc.proveedor, s.nombre); if (!mejor || p > mejor.p) mejor = { s, p }; }
      if (mejor && mejor.p >= 0.5) return { id: mejor.s.id, nombre: mejor.s.nombre, por: 'nombre', parecido: +mejor.p.toFixed(2) };
    }
    return null;
  }

  /** Para cada renglón: el producto y la presentación más probables. */
  function sugerir(lineas, cat) {
    return lineas.map((l) => {
      const texto = normalizar(l.descripcion);
      const presDeProducto = (pid) => cat.presDe.get(pid) || [];
      const presentacion = (pid, factor) => {
        if (!factor || factor === 1) return { presentation_id: null, factor: 1 };
        const p = presDeProducto(pid).find(x => Math.abs(x.factor - factor) < 0.001);
        return p ? { presentation_id: p.id, factor: p.factor, nombre: p.name } : { presentation_id: null, factor, falta: true };
      };
      /* 1. La memoria de este proveedor: por código o por el mismo texto. */
      const recuerdo = (l.codigo && cat.alias.find(a => a.codigo && a.codigo === l.codigo)) || cat.alias.find(a => a.texto === texto);
      if (recuerdo) {
        const p = cat.productos.find(x => x.id === recuerdo.product_id);
        if (p) return { product_id: p.id, nombre: p.nombre, por: 'memoria', certeza: 1,
          presentation_id: recuerdo.presentation_id, factor: Number(recuerdo.factor) || 1, candidatos: [] };
      }
      /* 2. El código de barras o el No. de parte. */
      if (l.codigo) {
        const p = cat.productos.find(x => x.bar_code === l.codigo || x.part_number === l.codigo);
        if (p) return { product_id: p.id, nombre: p.nombre, por: 'codigo', certeza: 0.98, ...presentacion(p.id, l.factor), candidatos: [] };
      }
      /* 3. Por parecido del nombre. */
      const puntuados = cat.productos.map(p => ({ p, s: parecido(l.descripcion, p.nombre) }))
        .filter(x => x.s >= 0.3).sort((a, b) => b.s - a.s).slice(0, 4);
      const candidatos = puntuados.map(x => ({ product_id: x.p.id, nombre: x.p.nombre, certeza: +x.s.toFixed(2) }));
      if (puntuados[0] && puntuados[0].s >= 0.55 && (!puntuados[1] || puntuados[0].s - puntuados[1].s >= 0.1)) {
        const p = puntuados[0].p;
        return { product_id: p.id, nombre: p.nombre, por: 'parecido', certeza: +puntuados[0].s.toFixed(2), ...presentacion(p.id, l.factor), candidatos };
      }
      return { product_id: null, nombre: null, por: null, certeza: 0, presentation_id: null, factor: l.factor || 1, candidatos };
    });
  }

  /* ------------------------------------------------------------- leer */
  ipcMain.handle('compras-doc:leer', sesion.proteger('compras-doc:leer', async (_e, p = {}, ses) => {
    try {
      const nombre = String(p.nombre || 'documento').slice(0, 200);
      const buf = Buffer.from(String(p.base64 || ''), 'base64');
      if (!buf.length) return { success: false, error: 'El archivo está vacío.' };
      if (buf.length > MAX_BYTES) return { success: false, error: 'El archivo pesa más de 15 MB.' };
      const sha = crypto.createHash('sha256').update(buf).digest('hex');
      const inicio = buf.subarray(0, 600).toString('utf8');

      let doc, tipo, ext;
      if (/\.xml$/i.test(nombre) || /<\?xml|<(\w+:)?Comprobante\b/.test(inicio)) {
        doc = leerCfdi(buf.toString('utf8'));
        tipo = 'CFDI'; ext = 'xml';
      } else if (IMAGENES.test(nombre) || /^image\//.test(p.mime || '')) {
        let img = nativeImage.createFromBuffer(buf);
        if (img.isEmpty()) return { success: false, error: 'No se pudo abrir la imagen. Prueba con JPG o PNG.' };
        /* Fotos de celular de 12 MP: el texto de un ticket se lee igual a 2400 px. */
        const { width, height } = img.getSize();
        if (Math.max(width, height) > 2400) img = img.resize(width >= height ? { width: 2400 } : { height: 2400 });
        const s = img.getSize();
        const leido = await ocr.leer({ width: s.width, height: s.height, data: img.toBitmap() });
        doc = interpretar(leido.renglones);
        doc.ocr = { renglones: leido.renglones.map(r => ({ texto: r.texto, y: r.y, confianza: r.confianza })), ms: leido.ms };
        tipo = /REMISION|NOTA DE (ENTREGA|VENTA)/i.test(leido.renglones.slice(0, 8).map(r => r.texto).join(' ')) ? 'NOTA' : 'TICKET';
        ext = (nombre.match(IMAGENES)?.[1] || 'jpg').toLowerCase();
      } else if (/\.pdf$/i.test(nombre) || /^%PDF/.test(inicio)) {
        return { success: false, error: 'Por ahora un PDF no se lee solo. Si es factura, sube su XML (viene junto al PDF); si no, una foto o captura de pantalla.' };
      } else {
        return { success: false, error: 'Sube una foto (JPG o PNG) o el XML de la factura.' };
      }

      const pool = await poolPromise;
      /* La misma factura ya registrada: se avisa, no se duplica. */
      if (doc.uuid) {
        const ya = (await pool.request().input('u', sql.VarChar(40), doc.uuid)
          .query(`SELECT TOP 1 id, purchase_id FROM dbo.purchase_documents WHERE cfdi_uuid = @u;`)).recordset?.[0];
        if (ya?.purchase_id) return { success: false, duplicado: true, error: `Esta factura ya se registró en la compra #${ya.purchase_id}.` };
        if (ya) await pool.request().input('id', sql.Int, ya.id).query(`DELETE FROM dbo.purchase_documents WHERE id = @id AND purchase_id IS NULL;`);
      }

      const archivo = path.join(carpeta(), `${sha}.${ext}`);
      if (!fs.existsSync(archivo)) fs.writeFileSync(archivo, buf);

      const proveedor = await proveedorDe(pool, doc);
      const cat = await catalogo(pool, proveedor?.id);
      const sugerencias = sugerir(doc.lineas, cat);

      const r = await pool.request()
        .input('supplier_id', sql.Int, proveedor?.id ?? null)
        .input('tipo', sql.VarChar(12), tipo)
        .input('nombre', sql.NVarChar(200), nombre)
        .input('ruta', sql.NVarChar(400), archivo)
        .input('sha', sql.Char(64), sha)
        .input('uuid', sql.VarChar(40), doc.uuid || null)
        .input('rfc', sql.VarChar(13), doc.rfc ? String(doc.rfc).slice(0, 13) : null)
        .input('folio', sql.NVarChar(60), doc.folio ? String(doc.folio).slice(0, 60) : null)
        .input('fecha', sql.Date, doc.fecha || null)
        .input('total', sql.Decimal(12, 2), doc.totales?.total ?? null)
        .input('cuadra', sql.Bit, doc.cuadre?.ok ? 1 : 0)
        .input('datos', sql.NVarChar(sql.MAX), JSON.stringify({ doc, sugerencias }))
        .input('por', sql.Int, sesion.actorDe(ses))
        .query(`INSERT INTO dbo.purchase_documents (supplier_id, tipo, archivo_nombre, archivo_ruta, sha256, cfdi_uuid, rfc_emisor, folio, fecha_documento, total, cuadra, datos_json, created_by)
                OUTPUT INSERTED.id VALUES (@supplier_id, @tipo, @nombre, @ruta, @sha, @uuid, @rfc, @folio, @fecha, @total, @cuadra, @datos, @por);`);

      return { success: true, data: { document_id: r.recordset[0].id, tipo, doc, proveedor, sugerencias } };
    } catch (e) {
      console.error('compras-doc:leer', e);
      return { success: false, error: e.message };
    }
  }));

  /* --------------------------------------------------------- aprender */
  ipcMain.handle('compras-doc:aprender', sesion.proteger('compras-doc:aprender', async (_e, p = {}) => {
    try {
      const pool = await poolPromise;
      const docId = Number(p.document_id) || null, supplierId = Number(p.supplier_id) || null, compraId = Number(p.purchase_id) || null;
      if (docId) {
        await pool.request().input('id', sql.Int, docId).input('p', sql.Int, compraId).input('s', sql.Int, supplierId)
          .query(`UPDATE dbo.purchase_documents SET purchase_id = ISNULL(@p, purchase_id), supplier_id = ISNULL(@s, supplier_id) WHERE id = @id;`);
      }
      let aprendidos = 0;
      if (supplierId) {
        for (const l of Array.isArray(p.lineas) ? p.lineas : []) {
          const texto = normalizar(l.texto);
          if (!texto || !Number(l.product_id)) continue;
          await pool.request()
            .input('s', sql.Int, supplierId).input('t', sql.NVarChar(200), texto)
            .input('c', sql.NVarChar(60), l.codigo ? String(l.codigo).slice(0, 60) : null)
            .input('p', sql.Int, Number(l.product_id)).input('pr', sql.Int, Number(l.presentation_id) || null)
            .input('f', sql.Decimal(14, 4), Number(l.factor) || 1)
            .query(`MERGE dbo.supplier_item_aliases AS t
                    USING (SELECT @s AS supplier_id, @t AS texto) AS s ON t.supplier_id = s.supplier_id AND t.texto = s.texto
                    WHEN MATCHED THEN UPDATE SET codigo = ISNULL(@c, t.codigo), product_id = @p, presentation_id = @pr, factor = @f,
                         veces = t.veces + 1, updated_at = SYSDATETIME()
                    WHEN NOT MATCHED THEN INSERT (supplier_id, texto, codigo, product_id, presentation_id, factor)
                         VALUES (@s, @t, @c, @p, @pr, @f);`);
          aprendidos++;
        }
      }
      return { success: true, data: { aprendidos } };
    } catch (e) { return { success: false, error: e.message }; }
  }));

  /* ---------------------------------------------------------- archivo */
  ipcMain.handle('compras-doc:archivo', sesion.proteger('compras-doc:archivo', async (_e, p = {}) => {
    try {
      const pool = await poolPromise;
      const d = (await pool.request().input('id', sql.Int, Number(p.id))
        .query(`SELECT archivo_ruta, archivo_nombre, tipo FROM dbo.purchase_documents WHERE id = @id;`)).recordset?.[0];
      if (!d || !d.archivo_ruta || !fs.existsSync(d.archivo_ruta)) return { success: false, error: 'El archivo no está en esta computadora.' };
      const ext = path.extname(d.archivo_ruta).slice(1).toLowerCase();
      const mime = ext === 'xml' ? 'application/xml' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      return { success: true, data: { nombre: d.archivo_nombre, mime, base64: fs.readFileSync(d.archivo_ruta).toString('base64') } };
    } catch (e) { return { success: false, error: e.message }; }
  }));

  /*
   * ¿YA SE REGISTRÓ? Antes de registrar una compra se busca, del mismo día:
   *   · compras del mismo proveedor por el mismo total;
   *   · pagos a ese proveedor que salieron de la caja y no están aplicados a
   *     ninguna compra (el repartidor cobró y la caja le pagó primero);
   *   · salidas de efectivo (gasto o retiro) por el mismo monto, sin proveedor:
   *     a veces se paga al repartidor como «gasto»;
   *   · el mismo archivo (foto o XML) ya ligado a otra compra.
   * El monto «igual» admite un peso de diferencia o 0.5 % (redondeos del ticket).
   * Solo lee: decidir qué hacer es de la persona.
   */
  ipcMain.handle('compras-doc:duplicados', sesion.proteger('compras-doc:duplicados', async (_e, p = {}) => {
    try {
      const total = Number(p.total) || 0;
      const supplierId = Number(p.supplier_id) || null;
      if (!(total > 0) || !supplierId) return { success: true, data: { compras: [], pagos: [], salidas: [], documento: null } };
      const tol = Math.max(1, Math.round(total * 0.005 * 100) / 100);
      const pool = await poolPromise;
      const rq = () => pool.request()
        .input('s', sql.Int, supplierId)
        .input('t', sql.Decimal(12, 2), total)
        .input('tol', sql.Decimal(12, 2), tol);
      const [compras, pagos, salidas] = await Promise.all([
        rq().query(`
          SELECT p.id, p.datee AS fecha, p.total, p.payment_status AS estado, u.usuario
            FROM dbo.purchase p LEFT JOIN dbo.users u ON u.id = p.useer_id
           WHERE p.supplier_id = @s AND CAST(p.datee AS DATE) = CAST(GETDATE() AS DATE)
             AND ABS(p.total - @t) <= @tol
           ORDER BY p.datee DESC;`),
        rq().query(`
          SELECT sp.id, sp.datee AS fecha, sp.amount AS monto, sp.payment_method AS forma, sp.note AS nota,
                 sp.cash_movement_id, u.usuario
            FROM dbo.supplier_payments sp LEFT JOIN dbo.users u ON u.id = sp.user_id
           WHERE sp.supplier_id = @s AND sp.purchase_id IS NULL
             AND CAST(sp.datee AS DATE) = CAST(GETDATE() AS DATE)
             AND ABS(sp.amount - @t) <= @tol
           ORDER BY sp.datee DESC;`),
        rq().query(`
          SELECT cm.id, cm.datee AS fecha, ABS(cm.amount) AS monto, cm.typee AS tipo, t.label AS tipo_nombre,
                 cm.note AS nota, u.usuario
            FROM dbo.cash_movements cm
            LEFT JOIN dbo.cash_movement_types t ON t.code = cm.typee
            LEFT JOIN dbo.users u ON u.id = cm.userId
           WHERE cm.typee IN ('EXPENSE', 'WITHDRAW')
             AND CAST(cm.datee AS DATE) = CAST(GETDATE() AS DATE)
             AND ABS(ABS(cm.amount) - @t) <= @tol
           ORDER BY cm.datee DESC;`),
      ]);
      let documento = null;
      if (Number(p.document_id)) {
        documento = (await pool.request().input('d', sql.Int, Number(p.document_id)).query(`
          SELECT TOP 1 o.purchase_id, o.created_at
            FROM dbo.purchase_documents d
            JOIN dbo.purchase_documents o ON o.sha256 = d.sha256 AND o.id <> d.id AND o.purchase_id IS NOT NULL
           WHERE d.id = @d ORDER BY o.id DESC;`)).recordset?.[0] || null;
      }
      return { success: true, data: { compras: compras.recordset || [], pagos: pagos.recordset || [], salidas: salidas.recordset || [], documento } };
    } catch (e) { return { success: false, error: e.message }; }
  }));

  ipcMain.handle('compras-doc:de-compra', sesion.proteger('compras-doc:de-compra', async (_e, p = {}) => {
    try {
      const pool = await poolPromise;
      const r = await pool.request().input('p', sql.Int, Number(p.purchase_id))
        .query(`SELECT id, tipo, archivo_nombre, folio, fecha_documento, total, cuadra, created_at FROM dbo.purchase_documents WHERE purchase_id = @p ORDER BY id;`);
      return { success: true, data: r.recordset || [] };
    } catch (e) { return { success: false, error: e.message }; }
  }));
}

module.exports = { registrar, normalizar, parecido, palabras };
