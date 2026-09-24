/**
 * DE FILAS CRUDAS A UN PLAN.
 *
 * Normalizar, validar, buscar duplicados y decidir que hacer con cada fila.
 * Las cinco entradas -archivo, pegado, plantilla, captura, lector- pasan
 * por aqui y por ningun otro sitio: eso es lo que impide que existan cinco
 * importadores con cinco criterios distintos.
 *
 * NADA DE ESTO ESCRIBE EN EL CATALOGO. Produce datos; escribir es de
 * `sp_import_execute_chunk`, y solo cuando alguien confirma.
 */
const { norm } = require('./alias');
const semantica = require('./semantica');

/* Lo que de verdad cabe en `products`. Son las longitudes de la tabla, no
   un criterio nuestro: una fila mas larga NO entra, y saberlo aqui es lo
   que evita que reviente el INSERT y se lleve por delante a sus vecinas. */
const LIMITES = { nombre: 100, part_number: 100, bar_code: 50 };

/** Un problema: codigo para agrupar, campo para señalar, texto para leer. */
const problema = (codigo, campo, texto, gravedad = 'alto') => ({ codigo, campo, texto, gravedad });

/* ------------------------------------------------------------ NORMALIZAR */

function aNumero(v) {
  if (v === null || v === undefined || v === '') return null;
  /* «$1,240.00», «1.240,00», «24 pz». Se quita todo lo que no sea cifra,
     punto, coma o signo, y despues se decide cual es el decimal. */
  let s = String(v).trim().replace(/[^\d.,-]/g, '');
  if (!s) return null;
  const ultimaComa = s.lastIndexOf(','), ultimoPunto = s.lastIndexOf('.');
  if (ultimaComa > -1 && ultimoPunto > -1) {
    /* El ultimo que aparece es el decimal; el otro son miles. */
    if (ultimaComa > ultimoPunto) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (ultimaComa > -1) {
    /* Una coma sola: decimal si deja dos cifras detras, miles si tres. */
    const detras = s.length - ultimaComa - 1;
    s = detras === 3 ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const aTexto = (v) => String(v ?? '').trim();

/** Si | No | 1 | 0 | true. Cualquier otra cosa: null, que no es «no». */
function aBooleano(v) {
  const s = norm(v);
  if (!s) return null;
  if (['si', 'yes', 'y', '1', 'true', 'verdadero', 'x'].includes(s)) return true;
  if (['no', 'n', '0', 'false', 'falso'].includes(s)) return false;
  return null;
}

/**
 * Convierte una fila cruda en los campos de Wybix.
 *
 * @param {Array} celdas  los valores, en el orden de los encabezados
 * @param {Array} mapping [{indice, campo}] ya confirmado
 * @param {Object} ctx    { tipoPorDefecto, servicios }
 */
function normalizar(celdas, mapping, ctx = {}) {
  const f = { tipo: ctx.tipoPorDefecto || 'PRODUCTO' };
  const contexto = ctx.negocio || {};
  for (const m of mapping) {
    if (!m.campo) continue;
    const v = celdas[m.indice];
    switch (m.campo) {
      case 'price': case 'cost': case 'stock':
      case 'duration_minutes': case 'default_commission_pct': case 'tasa_iva':
        f[m.campo] = aNumero(v); break;
      case 'schedulable':
        f[m.campo] = aBooleano(v); break;
      case 'tipo': {
        /* Lo decide `semantica.js`, que es el unico sitio que traduce
           palabras a entidades. Aqui solo se aplica. */
        const t = semantica.tipoDeCelda(v, contexto);
        if (t) f.tipo = t;
        break;
      }
      default:
        f[m.campo] = aTexto(v) || null;
    }
  }

  /* Lo que el tipo decide, y que el resto de Wybix ya sabe leer. */
  const d = semantica.def(f.tipo);
  f.inventory_mode = d.inventory_mode;
  f.sellable = d.sellable;

  /* Lo que NO lleva existencia, no la lleva aunque la columna trajera un
     numero: guardarla daria un inventario de horas de trabajo o de cafes
     que nadie ha preparado. */
  if (!d.usaStock) f.stock = null;

  /* Y lo que no se vende no tiene precio de venta. Un saco de cafe en grano
     con precio acaba a la venta en la caja, que es justo lo que paso. */
  if (!d.usaPrecio) f.price = null;

  /* El IVA llega como 16 tan a menudo como 0.16. `tasa_iva` es
     DECIMAL(5,4): un 16 ahi es «1600%» y ademas revienta. */
  if (f.tasa_iva != null && f.tasa_iva > 1) f.tasa_iva = f.tasa_iva / 100;

  return f;
}

/* -------------------------------------------------------------- VALIDAR */

/**
 * @param {Object} f    fila normalizada
 * @param {Object} ctx  { uoms: Set, vistosSku: Set, vistosBarras: Set }
 */
function validar(f, ctx = {}) {
  const ps = [];
  const uoms = ctx.uoms || new Set();

  /* QUE HACE FALTA DEPENDE DE QUE ES.
     Una sola lista de campos obligatorios para todo fue exactamente el
     fallo: pedirle precio de venta a doce ingredientes, y despues ofrecer
     ponerselo a los doce de golpe. */
  const d = semantica.def(f.tipo);

  /*
   * LA REGLA, ESCRITA SOBRE LA FILA Y NO SOBRE LA TABLA DE TIPOS.
   *
   * Lo que NO se vende no puede necesitar precio de venta. Punto. Se lee de
   * `f.sellable` -lo que la fila VA A SER en `products`- y no de la lista de
   * campos obligatorios del tipo, para que esto siga siendo cierto aunque
   * alguna vez se clasifique mal: el peor caso pasa de «ofrecer ponerle
   * precio a doce insumos» a «un insumo bien cargado con el tipo cambiado».
   *
   * `vendible` mira el valor de la fila y solo cae en el del tipo si la fila
   * no lo trae -una fila planificada siempre lo trae-.
   */
  const vendible = f.sellable == null ? !!d.sellable : !!Number(f.sellable);
  const exige = (campo) => {
    if (campo === 'price' && !vendible) return false;
    return d.requeridos.includes(campo);
  };

  if (!f.nombre) ps.push(problema('SIN_NOMBRE', 'nombre', 'Le falta el nombre.'));
  else if (f.nombre.length > LIMITES.nombre)
    ps.push(problema('NOMBRE_LARGO', 'nombre',
      `El nombre tiene ${f.nombre.length} caracteres y caben ${LIMITES.nombre}.`));

  if (exige('price')) {
    if (f.price == null) ps.push(problema('SIN_PRECIO', 'price', 'No tiene precio de venta.'));
    else if (f.price < 0) ps.push(problema('PRECIO_NEGATIVO', 'price', 'El precio es negativo.'));
  } else if (f.price != null && f.price < 0) {
    ps.push(problema('PRECIO_NEGATIVO', 'price', 'El precio es negativo.', 'medio'));
  }

  /* Un ingrediente sin unidad no se puede poner en una receta: «200 de
     leche» no dice si son mililitros o litros. */
  if (exige('base_uom') && !f.base_uom) {
    ps.push(problema('SIN_UNIDAD', 'base_uom',
      'Sin unidad no se puede usar en una receta.'));
  }

  if (f.cost != null && f.cost < 0)
    ps.push(problema('COSTO_NEGATIVO', 'cost', 'El costo es negativo.'));

  if (f.stock != null && f.stock < 0)
    ps.push(problema('STOCK_NEGATIVO', 'stock', 'La existencia es negativa.'));

  if (f.part_number && f.part_number.length > LIMITES.part_number)
    ps.push(problema('CODIGO_LARGO', 'part_number',
      `El código tiene ${f.part_number.length} caracteres y caben ${LIMITES.part_number}.`));

  if (f.bar_code && f.bar_code.length > LIMITES.bar_code)
    ps.push(problema('BARRAS_LARGO', 'bar_code',
      `El código de barras tiene ${f.bar_code.length} caracteres y caben ${LIMITES.bar_code}.`));

  /* `products.base_uom` tiene clave ajena contra `uoms`. Una unidad
     inventada no da un aviso: aborta el INSERT. Se caza aqui. */
  if (f.base_uom && !uoms.has(String(f.base_uom).toLowerCase()))
    ps.push(problema('UNIDAD_DESCONOCIDA', 'base_uom',
      `La unidad «${f.base_uom}» no existe en Wybix.`, 'medio'));

  /* La categoria importa porque `sp_get_active_products` une con INNER JOIN
     y sin ella el producto no sale a la venta. A un ingrediente eso no le
     afecta: no se vende. */
  if (!f.category_name && vendible) {
    ps.push(problema('SIN_CATEGORIA', 'category_name',
      'Sin categoría no aparece en la pantalla de venta.', 'medio'));
  }

  /* Repetidos DENTRO del propio archivo. Distinto de «ya existe en el
     catalogo», que no es un problema sino una actualizacion. */
  if (f.part_number) {
    const k = norm(f.part_number);
    if (ctx.vistosSku?.has(k))
      ps.push(problema('DUP_ARCHIVO_SKU', 'part_number', 'Este código se repite en el archivo.'));
    else ctx.vistosSku?.add(k);
  }
  if (f.bar_code) {
    const k = norm(f.bar_code);
    if (ctx.vistosBarras?.has(k))
      ps.push(problema('DUP_ARCHIVO_BARRAS', 'bar_code', 'Este código de barras se repite en el archivo.'));
    else ctx.vistosBarras?.add(k);
  }

  return ps;
}

/* ------------------------------------------------- DUPLICADOS Y DECISION */

/**
 * Indice del catalogo, para no consultar la base una vez por fila.
 * @param {Array} productos filas de products (id, part_number, nombre, price, cost, bar_code)
 */
function indexar(productos) {
  const porSku = new Map(), porBarras = new Map(), porNombre = new Map();
  for (const p of productos || []) {
    if (p.part_number) porSku.set(norm(p.part_number), p);
    if (p.bar_code) porBarras.set(norm(p.bar_code), p);
    if (p.nombre) {
      const k = norm(p.nombre);
      if (!porNombre.has(k)) porNombre.set(k, p);
    }
  }
  return { porSku, porBarras, porNombre };
}

/** Compara lo que trae la fila contra lo que ya hay. Solo campos con valor. */
function hayCambio(f, p) {
  const diferente = (a, b) => a != null && String(a) !== String(b ?? '');
  if (f.price != null && Number(f.price) !== Number(p.price)) return true;
  if (f.cost != null && Number(f.cost) !== Number(p.cost ?? 0)) return true;
  if (diferente(f.nombre, p.nombre)) return true;
  if (diferente(f.bar_code, p.bar_code)) return true;
  return false;
}

/**
 * Decide que hacer con la fila.
 *
 * LAS REGLAS, POR FUERZA DE LA COINCIDENCIA
 *   SKU identico      -> es el mismo producto. Actualizar.
 *   Barras identico   -> es el mismo producto. Actualizar.
 *   Nombre identico   -> PUEDE serlo. Se sugiere, no se decide.
 *
 * Y una excepcion que importa: mismo codigo pero OTRO nombre no es una
 * actualizacion, es un choque. «PH6017A» que era un filtro y ahora dice
 * ser una balata no se resuelve solo.
 */
function clasificar(f, idx, problemas) {
  const graves = problemas.filter(p => p.gravedad === 'alto');
  if (graves.length) return { accion: 'PENDIENTE', match: null, motivo: null };

  let match = null, motivo = null;
  if (f.part_number && idx.porSku.has(norm(f.part_number))) {
    match = idx.porSku.get(norm(f.part_number)); motivo = 'SKU';
  } else if (f.bar_code && idx.porBarras.has(norm(f.bar_code))) {
    match = idx.porBarras.get(norm(f.bar_code)); motivo = 'BARCODE';
  } else if (f.nombre && idx.porNombre.has(norm(f.nombre))) {
    match = idx.porNombre.get(norm(f.nombre)); motivo = 'NOMBRE';
  }

  if (!match) return { accion: 'CREATE', match: null, motivo: null };

  if (motivo === 'NOMBRE') {
    /* Solo el nombre coincide: es una sugerencia, no una certeza. Dos
       negocios distintos pueden vender «Aceite 20W50» de marcas distintas. */
    problemas.push(problema('POSIBLE_DUPLICADO', 'nombre',
      `Se parece a «${match.nombre}», que ya tienes.`, 'medio'));
    return { accion: 'CONFLICT', match, motivo };
  }

  if (f.nombre && norm(f.nombre) !== norm(match.nombre)) {
    problemas.push(problema('CODIGO_OTRO_NOMBRE', 'part_number',
      `Ese código ya lo tiene «${match.nombre}».`, 'alto'));
    return { accion: 'CONFLICT', match, motivo };
  }

  return { accion: hayCambio(f, match) ? 'UPDATE' : 'UNCHANGED', match, motivo };
}

/**
 * La tuberia entera sobre un conjunto de filas.
 *
 * @returns {Array} filas listas para guardar en `import_rows`
 */
function planificar(filas, mapping, catalogo, ctx = {}) {
  const idx = indexar(catalogo);
  const estado = {
    uoms: ctx.uoms || new Set(),
    vistosSku: new Set(),
    vistosBarras: new Set(),
  };

  return filas.map((cruda) => {
    const f = normalizar(cruda.celdas, mapping, ctx);
    /* Lo que el tipo decide viaja con la fila hasta SQL: la pantalla puede
       enseñarlo antes de importar y el ejecutor no lo vuelve a deducir. */
    const problemas = validar(f, estado);
    const { accion, match, motivo } = clasificar(f, idx, problemas);
    return {
      fila: cruda.fila,
      crudo: cruda.celdas,
      ...f,
      accion,
      inventory_mode: f.inventory_mode,
      sellable: f.sellable,
      match_product_id: match ? match.id : null,
      match_motivo: motivo,
      problemas,
    };
  });
}

module.exports = { normalizar, validar, clasificar, planificar, indexar, semantica,
                   aNumero, aTexto, aBooleano, hayCambio, LIMITES };
