'use strict';
/**
 * MENÚ EN LÍNEA (0067): la caja principal y la nube.
 *
 * La página del menú vive en la web de Wybix (wybix-landing, /m/<slug>) y
 * habla con la nube; nunca con esta caja. La caja:
 *
 *   PUBLICA   el menú (categorías, productos, precio, modificadores,
 *             disponibilidad y marca) cuando cambia, y las fotos que la nube
 *             aún no tiene (`menu_publicar`, `menu_imagen`).
 *   BAJA      los pedidos nuevos y, en la MISMA llamada, sube el estado que
 *             cambió de los suyos y deja su latido (`menu_bandeja`). Sin
 *             latido reciente la nube deja de aceptar pedidos: una caja sin
 *             internet no acumula pedidos que nadie va a ver.
 *
 * Un pedido bajado es una SOLICITUD (sp_pedido_en_linea_recibir): no abre
 * cuenta, no cobra, no descuenta. Aceptarlo es cosa de la caja (ipc).
 *
 * Solo la instalación principal sincroniza: es la que tiene la credencial de
 * la sucursal. Las demás cajas ven la misma bandeja porque leen la misma base.
 * Nunca lanza: si falla, se reintenta en el siguiente ciclo y la caja sigue.
 */
const crypto = require('crypto');

const LIMITE_DISPONIBLE = 99;

/** sp_get_menu_catalog -> lo que publica la nube. Solo lo que ve un cliente. */
function armarCatalogo(sets) {
  const [categorias = [], productos = [], grupos = [], opciones = [], relaciones = []] = sets;
  const tope = (u) => (u == null ? null : Math.max(0, Math.min(LIMITE_DISPONIBLE, Math.floor(Number(u)))));
  const gruposDe = new Map();
  for (const r of relaciones) {
    if (!gruposDe.has(r.product_id)) gruposDe.set(r.product_id, []);
    gruposDe.get(r.product_id).push(Number(r.group_id));
  }
  return {
    categorias: categorias.map((c) => ({ id: c.category_id == null ? 0 : Number(c.category_id), nombre: String(c.category_name) })),
    productos: productos.map((p) => ({
      id: Number(p.id), nombre: String(p.product_name), precio: Number(p.price) || 0,
      categoria_id: p.category_id == null ? 0 : Number(p.category_id),
      imagen: p.image_version ? Number(p.image_version) : null,
      disponible: tope(p.available_units),
      grupos: gruposDe.get(p.id) || [],
    })),
    grupos: grupos.filter((g) => g.role !== 'NOTE').map((g) => ({
      id: Number(g.id), nombre: String(g.name), rol: g.role,
      min: Number(g.min_select) || 0, max: Number(g.max_select) || 1, requerido: !!g.required,
      opciones: opciones.filter((o) => Number(o.group_id) === Number(g.id)).map((o) => ({
        id: Number(o.id), nombre: String(o.name), delta: Number(o.price_delta) || 0, disponible: tope(o.available_units),
      })),
    })),
  };
}

const ETIQUETAS = new Set(['NUEVO', 'RECOMENDADO', 'PICANTE', 'VEGETARIANO']);

/**
 * 0070 · El catálogo con lo de la plantilla (sp_menu_en_linea_diseno):
 * descripción, etiquetas y foto grande por producto; portada, logo y promos;
 * «lo más pedido» de ventas reales. Un producto oculto no se publica.
 * Devuelve también clave de foto -> id local, para subir las que falten.
 */
function conDiseno(catalogo, cfg, [imagenes = [], productos = [], masVendidos = []]) {
  const meta = new Map(productos.map((x) => [Number(x.product_id), x]));
  const idDeFoto = new Map();
  const fotos = [];
  const foto = (clave, img) => { idDeFoto.set(clave, Number(img.id)); fotos.push({ clave, v: Number(img.version) }); return Number(img.version); };
  const prods = catalogo.productos.filter((x) => !meta.get(x.id)?.oculto).map((x) => {
    const mm = meta.get(x.id) || {};
    const img = imagenes.find((i) => i.tipo === 'PRODUCTO' && Number(i.product_id) === x.id);
    return {
      ...x,
      descripcion: mm.descripcion || null,
      etiquetas: String(mm.etiquetas || '').split(',').filter((t) => ETIQUETAS.has(t)),
      destacado: !!mm.destacado,
      foto: img ? foto(`producto-${x.id}`, img) : null,
    };
  });
  const visibles = new Set(prods.map((x) => x.id));
  const una = (tipo) => { const i = imagenes.find((x) => x.tipo === tipo); return i ? { v: foto(tipo.toLowerCase(), i), ancho: i.ancho, alto: i.alto } : null; };
  const diseno = {
    frase: cfg.frase || null, direccion: cfg.direccion || null, horario: cfg.horario || null,
    portada: una('PORTADA'), logo: una('LOGO'),
    promos: imagenes.filter((i) => i.tipo === 'PROMO').map((i) => ({
      clave: `promo-${i.id}`, v: foto(`promo-${i.id}`, i), titulo: i.titulo || null, subtitulo: i.subtitulo || null,
      product_id: i.product_id != null && visibles.has(Number(i.product_id)) ? Number(i.product_id) : null,
    })),
  };
  const masPedidos = masVendidos.map((x) => Number(x.product_id)).filter((id) => visibles.has(id));
  return { catalogo: { ...catalogo, productos: prods, diseno, mas_pedidos: masPedidos, fotos }, idDeFoto };
}

function crearMenuEnLinea({ pool, sql, llamar, disponible, marca = () => null, negocio = () => null, alNuevos = () => {}, log = () => {} }) {
  let enCurso = null;
  let relojBandeja = null, relojMenu = null, inicio = null;
  let huella = null;
  const porConfirmar = new Set();
  let ultimo = { publicado: null, bajado: null, error: null };

  async function config() {
    const r = await (await pool()).request().input('guardar', sql.Bit, 0).execute('sp_menu_en_linea_config');
    return r.recordset?.[0] ?? null;
  }

  /** El menú, si cambió desde la última vez (o `forzar`). */
  async function publicar(forzar = false) {
    const cfg = await config();
    if (!cfg) return { omitido: true };
    const p = await pool();
    let catalogo = null, idDeFoto = new Map();
    if (cfg.activo) {
      catalogo = armarCatalogo((await p.request().execute('sp_get_menu_catalog')).recordsets || []);
      const d = (await p.request().execute('sp_menu_en_linea_diseno')).recordsets || [];
      ({ catalogo, idDeFoto } = conDiseno(catalogo, cfg, d));
    }
    /* Los colores de la pantalla Diseño mandan sobre los del addon. */
    const m = marca() || null;
    const marcaFinal = cfg.color || cfg.acento ? { ...(m || {}), color: cfg.color || m?.color || null, acento: cfg.acento || m?.acento || null } : m;
    const cuerpo = {
      activo: !!cfg.activo, slug: cfg.slug || null, recibe_pedidos: !!cfg.recibe_pedidos,
      minutos_estimados: Number(cfg.minutos_estimados) || 15, mensaje: cfg.mensaje || null,
      negocio: negocio() || null, marca: marcaFinal, catalogo,
    };
    const h = crypto.createHash('sha256').update(JSON.stringify(cuerpo)).digest('hex');
    if (!forzar && h === huella) return { publicado: false };
    const r = await llamar('menu_publicar', cuerpo);
    huella = h;
    /* Las fotos que la nube no tiene en esa versión. Una por llamada: cada una
       pesa hasta 64 KB y no hay prisa. */
    const faltan = Array.isArray(r?.faltan_imagenes) ? r.faltan_imagenes.map(Number).filter(Number.isSafeInteger).slice(0, 200) : [];
    let fotos = 0;
    if (faltan.length) {
      const t = await p.request().input('ids_json', sql.NVarChar(sql.MAX), JSON.stringify(faltan)).execute('sp_get_product_thumbs');
      for (const f of t.recordset || []) {
        await llamar('menu_imagen', { product_id: Number(f.product_id), version: Number(f.version), mime: f.mime,
          data: Buffer.from(f.thumb).toString('base64') });
        fotos++;
      }
    }
    /* 0070 · Las fotos grandes (portada, logo, promos, productos) que la nube
       no tiene en esa versión. Hasta 450 KB cada una: también de una en una. */
    for (const clave of Array.isArray(r?.faltan_fotos) ? r.faltan_fotos.slice(0, 200) : []) {
      const id = idDeFoto.get(String(clave));
      if (!id) continue;
      const f = (await p.request().input('id', sql.Int, id).execute('sp_menu_en_linea_imagen_get')).recordset?.[0];
      if (!f) continue;
      await llamar('menu_foto', { clave, version: Number(f.version), mime: f.mime, data: Buffer.from(f.data).toString('base64') });
      fotos++;
    }
    ultimo.publicado = new Date().toISOString();
    return { publicado: true, url: r?.url ?? null, fotos };
  }

  /** Baja lo nuevo y sube lo que cambió, en una llamada. */
  async function bandeja() {
    const cfg = await config();
    if (!cfg?.activo) return { omitido: true };
    const p = await pool();
    const cambios = (await p.request().input('por_publicar', sql.Bit, 1).execute('sp_pedidos_en_linea_listar')).recordset || [];
    const estados = cambios.slice(0, 200).map((x) => ({
      id: String(x.uuid).toLowerCase(), estado: x.estado_cliente, numero_dia: x.numero_dia ?? null, motivo: x.motivo ?? null,
    }));
    /* Lo guardado en la vuelta anterior se confirma ahora: la nube reenvía un
       pedido hasta que la caja dice que lo tiene (guardarlo dos veces no
       duplica nada). Así no hace falta una segunda llamada. */
    const confirmar = [...porConfirmar].slice(0, 200);
    const r = await llamar('menu_bandeja', { estados, confirmar });
    for (const c of confirmar) porConfirmar.delete(c);
    for (const e of estados) {
      if ((r?.estados_aplicados ?? []).includes(e.id)) {
        await p.request().input('uuid', sql.UniqueIdentifier, e.id).input('estado', sql.NVarChar(12), e.estado).execute('sp_pedido_en_linea_publicado');
      }
    }
    const nuevos = [];
    for (const x of Array.isArray(r?.pedidos) ? r.pedidos : []) {
      try {
        const g = (await p.request()
          .input('uuid', sql.UniqueIdentifier, x.id)
          .input('origen', sql.NVarChar(12), x.origen ? String(x.origen).slice(0, 12) : null)
          .input('cliente_nombre', sql.NVarChar(60), String(x.cliente_nombre ?? '').slice(0, 60))
          .input('cliente_telefono', sql.NVarChar(20), String(x.cliente_telefono ?? '').slice(0, 20))
          .input('nota', sql.NVarChar(200), x.nota ? String(x.nota).slice(0, 200) : null)
          .input('lineas', sql.NVarChar(sql.MAX), JSON.stringify(x.lineas ?? []))
          .input('total_cliente', sql.Decimal(12, 2), Number(x.total) || 0)
          .input('creado_en_nube', sql.DateTime2(0), x.creado_en ? new Date(x.creado_en) : null)
          .execute('sp_pedido_en_linea_recibir')).recordset?.[0];
        porConfirmar.add(String(x.id).toLowerCase());
        if (g?.nuevo) nuevos.push({ id: g.id, nombre: x.cliente_nombre });
      } catch (e) { log(`menú en línea: no se guardó el pedido ${x.id}: ${e.message}`); }
    }
    if (nuevos.length) { try { alNuevos(nuevos); } catch { /* noop */ } }
    ultimo.bajado = new Date().toISOString();
    return { nuevos: nuevos.length, estados: estados.length, abierto: r?.abierto ?? null };
  }

  function unaVez(fn) {
    if (!enCurso) {
      enCurso = (async () => {
        if (!(await disponible())) return { omitido: true };
        const res = await fn();
        ultimo.error = null;
        return res;
      })().catch((e) => { ultimo.error = e.message; log(`menú en línea (se reintenta): ${e.message}`); return { error: e.message }; })
        .finally(() => { enCurso = null; });
    }
    return enCurso;
  }

  const sincronizar = () => unaVez(async () => ({ menu: await publicar(), bandeja: await bandeja() }));

  function iniciar({ msBandeja = 20000, msMenu = 120000 } = {}) {
    detener();
    inicio = setTimeout(() => { void sincronizar(); }, 10000);
    relojBandeja = setInterval(() => { void unaVez(bandeja); }, msBandeja);
    relojMenu = setInterval(() => { void unaVez(() => publicar()); }, msMenu);
  }
  function detener() {
    for (const r of [relojBandeja, relojMenu]) if (r) clearInterval(r);
    if (inicio) clearTimeout(inicio);
    relojBandeja = relojMenu = inicio = null;
  }

  return {
    sincronizar, publicar: (forzar = true) => unaVez(() => publicar(forzar)), bandeja: () => unaVez(bandeja),
    iniciar, detener, estado: () => ({ ...ultimo }), olvidarHuella: () => { huella = null; },
  };
}

module.exports = { crearMenuEnLinea, armarCatalogo, conDiseno };
