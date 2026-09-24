/**
 * QUE COLUMNA ES QUE COSA.
 *
 * El importador viejo hacia esto con expresiones regulares metidas dentro
 * del componente -`/parte|part|sku/`- y NO se lo enseñaba a nadie: mapeaba
 * en silencio y si acertaba, bien. Aqui el mapeo es un dato que se propone,
 * se enseña y se confirma.
 *
 * POR QUE UNA TABLA DE ALIAS Y NO DISTANCIA DE EDICION
 * ---------------------------------------------------
 * Se probo mentalmente con los encabezados reales de un catalogo mexicano:
 * «P. Compra», «Exist.», «Depto.», «Cve», «Desc». Ninguno se resuelve por
 * parecido con «costo», «existencia», «categoria»: se resuelven porque
 * alguien que conoce el dominio los escribio en una lista. Levenshtein
 * ademas empareja cosas que NO son -«precio» con «preciso»- y se equivoca
 * en silencio, que es justo lo que no queremos.
 *
 * CONFIANZA, NO SI/NO
 * -------------------
 * Cada propuesta viene con un grado. `exacto` se aplica sin preguntar;
 * `probable` se aplica pero se enseña marcado; `dudoso` NO se aplica: se
 * pregunta. Esa es la regla que impide adivinar.
 */

/** Sin acentos, sin puntuacion, sin dobles espacios. */
function norm(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Los campos que Wybix sabe recibir, y como los llama la gente.
 *
 * `exacto`   -> se da por bueno.
 * `probable` -> se propone marcado; una palabra sola que casi siempre es eso.
 * `ambiguo`  -> se detecta pero NO se aplica: hay que preguntar.
 */
const CAMPOS = {
  nombre: {
    etiqueta: 'Nombre',
    exacto: ['nombre', 'producto', 'descripcion', 'descripcion del producto', 'articulo',
             'nombre del producto', 'name', 'description', 'concepto', 'servicio'],
    probable: ['desc', 'detalle', 'item'],
  },
  part_number: {
    etiqueta: 'Código interno',
    exacto: ['codigo', 'clave', 'sku', 'no parte', 'numero de parte', 'part number',
             'codigo interno', 'cve', 'clave del producto', 'codigo producto', 'part no'],
    probable: ['id', 'referencia', 'ref'],
  },
  bar_code: {
    etiqueta: 'Código de barras',
    exacto: ['codigo de barras', 'barras', 'barcode', 'ean', 'upc', 'codigo barras', 'cod barras'],
    probable: [],
  },
  price: {
    etiqueta: 'Precio de venta',
    exacto: ['precio', 'precio de venta', 'p venta', 'precio venta', 'pvp', 'price',
             'precio publico', 'venta', 'precio final'],
    probable: ['p v'],
  },
  cost: {
    etiqueta: 'Costo',
    exacto: ['costo', 'p compra', 'precio de compra', 'precio compra', 'cost',
             'costo unitario', 'ultimo costo', 'compra'],
    probable: ['c u'],
  },
  stock: {
    etiqueta: 'Existencia',
    exacto: ['existencia', 'existencias', 'stock', 'cantidad', 'inventario', 'exist',
             'qty', 'cantidad actual', 'existencia actual', 'piezas'],
    probable: ['disponible', 'saldo'],
  },
  category_name: {
    etiqueta: 'Categoría',
    exacto: ['categoria', 'departamento', 'depto', 'familia', 'linea', 'grupo',
             'category', 'rubro', 'seccion'],
    probable: [],
  },
  brand_name: {
    etiqueta: 'Marca',
    exacto: ['marca', 'brand', 'fabricante', 'proveedor marca'],
    probable: [],
  },
  base_uom: {
    etiqueta: 'Unidad',
    exacto: ['unidad', 'unidad de medida', 'um', 'uom', 'medida'],
    probable: [],
  },
  clave_prod_serv: {
    etiqueta: 'Clave SAT',
    exacto: ['clave sat', 'clave prodserv', 'prodserv', 'clave producto servicio'],
    probable: [],
  },
  clave_unidad: {
    etiqueta: 'Clave unidad SAT',
    exacto: ['clave unidad', 'clave unidad sat', 'cve unidad'],
    probable: [],
  },
  duration_minutes: {
    etiqueta: 'Duración (min)',
    exacto: ['duracion', 'duracion minutos', 'minutos', 'tiempo', 'duracion min'],
    probable: [],
  },
  default_commission_pct: {
    etiqueta: 'Comisión %',
    exacto: ['comision', 'comision pct', 'porcentaje comision', 'comision %'],
    probable: [],
  },
  tipo: {
    etiqueta: 'Tipo',
    exacto: ['tipo', 'tipo de producto', 'clase'],
    probable: [],
  },
};

/**
 * Los que NO se aplican solos aunque se reconozcan.
 *
 * «P. Unit.» es el caso de libro: en unos catalogos es el costo unitario y
 * en otros el precio unitario. Reconocerlo esta bien; decidir por el
 * usuario, no.
 */
const AMBIGUOS = {
  'p unit': ['cost', 'price'],
  'p unitario': ['cost', 'price'],
  'precio unitario': ['cost', 'price'],
  'unitario': ['cost', 'price'],
  'importe': ['cost', 'price'],
  'valor': ['cost', 'price'],
  'monto': ['cost', 'price'],
};

/**
 * Propone un mapeo para una lista de encabezados.
 *
 * @returns {{columnas: Array, huella: string, dudas: number}}
 *   Cada columna: { indice, original, campo|null, confianza, opciones? }
 */
function proponer(encabezados) {
  const usados = new Set();
  const columnas = encabezados.map((original, indice) => {
    const n = norm(original);
    if (!n) return { indice, original, campo: null, confianza: 'vacio' };

    if (AMBIGUOS[n]) {
      return { indice, original, campo: null, confianza: 'ambiguo', opciones: AMBIGUOS[n] };
    }

    for (const [campo, def] of Object.entries(CAMPOS)) {
      if (usados.has(campo)) continue;
      if (def.exacto.includes(n)) { usados.add(campo); return { indice, original, campo, confianza: 'exacto' }; }
    }
    for (const [campo, def] of Object.entries(CAMPOS)) {
      if (usados.has(campo)) continue;
      if (def.probable.includes(n)) { usados.add(campo); return { indice, original, campo, confianza: 'probable' }; }
    }
    /* Contiene, como ultimo recurso, y siempre marcado como probable: nunca
       se aplica algo «que contiene precio» sin que se vea. */
    for (const [campo, def] of Object.entries(CAMPOS)) {
      if (usados.has(campo)) continue;
      if (def.exacto.some(a => a.length > 4 && n.includes(a))) {
        usados.add(campo); return { indice, original, campo, confianza: 'probable' };
      }
    }
    return { indice, original, campo: null, confianza: 'desconocido' };
  });

  return {
    columnas,
    huella: huellaDe(encabezados),
    dudas: columnas.filter(c => c.confianza === 'ambiguo' || c.confianza === 'desconocido').length,
  };
}

/**
 * La huella de un formato: los encabezados normalizados y ORDENADOS.
 *
 * Ordenados a proposito. El proveedor que manda la misma lista cada mes a
 * veces cambia el orden de las columnas; si la huella dependiera del orden,
 * su formato dejaria de reconocerse por nada.
 */
function huellaDe(encabezados) {
  return encabezados.map(norm).filter(Boolean).sort().join('|').slice(0, 200);
}

/** Etiqueta legible de un campo, para la pantalla. */
function etiqueta(campo) {
  return CAMPOS[campo]?.etiqueta ?? campo;
}

module.exports = { norm, proponer, huellaDe, etiqueta, CAMPOS, AMBIGUOS };
