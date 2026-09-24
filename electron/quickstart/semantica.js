/**
 * QUE ES CADA COSA QUE SE IMPORTA.
 *
 * EL FALLO QUE ESTE ARCHIVO EXISTE PARA NO REPETIR
 * ------------------------------------------------
 * QuickStart trataba toda fila como «producto con precio y existencia». Con
 * un catalogo de cafeteria eso invirtio la semantica entera:
 *
 *   · «Cafe en grano» —un INGREDIENTE— entro como articulo vendible, pidio
 *     precio de venta, y acabo a la venta a $12 con 5000 g de existencia.
 *   · «Cafe Americano» —un PRODUCTO DE MENU— entro como mercancia DIRECT con
 *     stock 0, asi que la caja lo daba por agotado y no se podia vender.
 *
 * Las dos cosas al reves. Y no por falta de modelo: el modelo ya lo sabia.
 *
 * NO HAY TAXONOMIA NUEVA. LA QUE HAY YA BASTABA
 * ---------------------------------------------
 * Wybix distingue lo que vende de lo que consume con DOS columnas que ya
 * existen en `products`, y las consultas del dominio ya las respetan:
 *
 *   inventory_mode   DIRECT | RECIPE | NONE
 *   sellable         0 | 1
 *
 *   · `sp_get_ingredients` busca exactamente `inventory_mode = 'DIRECT'`.
 *   · `sp_get_menu_catalog` filtra `sellable = 1` y calcula lo disponible:
 *       NONE   -> 999999   (no se agota nunca)
 *       DIRECT -> FLOOR(stock)
 *       RECIPE -> lo que permitan sus ingredientes
 *   · `sp_get_active_products` —el catalogo de venta— filtra `sellable = 1`.
 *
 * Asi que este archivo no inventa nada: traduce «esto es un ingrediente» a
 * las dos columnas que el resto de Wybix ya lee. Y vive en UN solo sitio,
 * para que no acaben apareciendo `if (hoja === 'Insumos')` por el proyecto.
 */

const { norm } = require('./alias');

/**
 * Las cinco cosas que se pueden importar, y en que se convierten.
 *
 * `requeridos` NO es una lista global: es lo que hace falta PARA ESA COSA.
 * Pedirle precio de venta a un saco de cafe en grano fue exactamente el
 * fallo, y una unica lista de campos obligatorios lo garantiza.
 */
const TIPOS = {
  /* Lo que una tienda vende tal cual. */
  PRODUCTO: {
    etiqueta: 'Producto',
    plural: 'Productos',
    inventory_mode: 'DIRECT',
    sellable: 1,
    requeridos: ['nombre', 'price'],
    usaStock: true,
    usaPrecio: true,
    /* Que columnas ayudan a validar ESTO antes de importarlo. */
    revision: ['nombre', 'part_number', 'category_name', 'brand_name', 'cost', 'price', 'stock'],
    /* A que campos tiene sentido mapear una columna de este tipo. */
    destinos: ['nombre', 'part_number', 'bar_code', 'price', 'cost', 'stock',
               'category_name', 'brand_name', 'base_uom', 'clave_prod_serv', 'clave_unidad'],
  },

  /**
   * Lo que se consume para preparar otra cosa. NO se vende.
   *
   * `sellable = 0` es lo que lo mantiene fuera de la pantalla de venta, y
   * `DIRECT` es lo que lo hace elegible como ingrediente de una receta.
   */
  INGREDIENTE: {
    etiqueta: 'Ingrediente',
    plural: 'Ingredientes',
    inventory_mode: 'DIRECT',
    sellable: 0,
    /* Sin precio de venta: no se vende. La unidad SI, porque una receta que
       pide «200 ml de leche» necesita saber en que se mide la leche. */
    requeridos: ['nombre', 'base_uom'],
    usaStock: true,
    usaPrecio: false,
    revision: ['nombre', 'part_number', 'category_name', 'base_uom', 'cost', 'stock'],
    destinos: ['nombre', 'part_number', 'cost', 'stock', 'category_name', 'base_uom', 'brand_name'],
  },

  /**
   * Lo que sale en la carta. Se vende; no tiene existencia propia.
   *
   * SIN RECETA ENTRA COMO `NONE`, Y ESA ES LA DECISION QUE IMPORTA.
   * Un producto de menu recien cargado todavia no tiene receta. Si entrara
   * como `RECIPE`, `sp_get_menu_catalog` calcularia `ISNULL(po.units, 0)` =
   * 0 y la caja lo daria por agotado; si entrara como `DIRECT` con stock 0,
   * lo mismo. `NONE` da 999999: se vende mientras no se le ponga receta, que
   * es lo que hace un negocio el primer dia.
   *
   * Cuando el usuario le arme la receta desde la pantalla de Hospitality,
   * esa pantalla lo pasa a `RECIPE` —`sp_update_product` permite NONE ->
   * RECIPE— y a partir de ahi lo limitan sus ingredientes. QuickStart no
   * inventa recetas.
   */
  MENU: {
    etiqueta: 'Producto de menú',
    plural: 'Productos de menú',
    inventory_mode: 'NONE',
    sellable: 1,
    requeridos: ['nombre', 'price'],
    usaStock: false,
    usaPrecio: true,
    revision: ['nombre', 'part_number', 'category_name', 'price'],
    destinos: ['nombre', 'part_number', 'bar_code', 'price', 'cost',
               'category_name', 'clave_prod_serv', 'clave_unidad'],
  },

  /** Trabajo que se cobra. No tiene existencia. */
  SERVICIO: {
    etiqueta: 'Servicio',
    plural: 'Servicios',
    inventory_mode: 'NONE',
    sellable: 1,
    requeridos: ['nombre', 'price'],
    usaStock: false,
    usaPrecio: true,
    revision: ['nombre', 'part_number', 'category_name', 'price', 'duration_minutes', 'default_commission_pct'],
    destinos: ['nombre', 'part_number', 'price', 'category_name',
               'duration_minutes', 'default_commission_pct', 'clave_prod_serv', 'clave_unidad'],
  },

  /**
   * Lo que un negocio de servicios pone Y cobra: refaccion, insumo,
   * componente, material. Es mercancia normal; solo cambia como se llama,
   * y eso lo decide `presets.json`, no este archivo.
   */
  MATERIAL: {
    etiqueta: 'Material',
    plural: 'Materiales',
    inventory_mode: 'DIRECT',
    sellable: 1,
    requeridos: ['nombre', 'price'],
    usaStock: true,
    usaPrecio: true,
    revision: ['nombre', 'part_number', 'category_name', 'brand_name', 'cost', 'price', 'stock'],
    destinos: ['nombre', 'part_number', 'bar_code', 'price', 'cost', 'stock',
               'category_name', 'brand_name', 'base_uom'],
  },
};

/** Los tipos que tienen sentido para este negocio, en el orden que se ofrecen. */
function tiposDe(ctx = {}) {
  if (ctx.hospitality) return ['MENU', 'INGREDIENTE', 'PRODUCTO'];
  if (ctx.servicios) return ['SERVICIO', 'MATERIAL'];
  return ['PRODUCTO'];
}

/** El nombre que este negocio le da a su mercancia. Sale del giro. */
function etiquetaDe(tipo, ctx = {}) {
  if (tipo === 'MATERIAL' && ctx.material?.singular) return ctx.material.singular;
  return TIPOS[tipo]?.etiqueta ?? tipo;
}
function pluralDe(tipo, ctx = {}) {
  if (tipo === 'MATERIAL' && ctx.material?.plural) return ctx.material.plural;
  return TIPOS[tipo]?.plural ?? tipo;
}

/**
 * QUE TRAE ESTA HOJA.
 *
 * Aqui y en ningun otro sitio. Es la unica funcion que mira el nombre de
 * una hoja para decidir semantica, precisamente para que no aparezca un
 * `if (hoja === 'Insumos')` repartido por la tuberia.
 *
 * Y el nombre es solo UNA de las tres señales: tambien cuenta lo que dice
 * una columna «Tipo» y lo que el negocio es capaz de tener. Una hoja
 * llamada «Insumos» en una ferreteria son productos, no ingredientes.
 */
function tipoDeHoja(nombreHoja, encabezados, ctx = {}) {
  const permitidos = tiposDe(ctx);
  const n = norm(nombreHoja);

  if (ctx.hospitality) {
    if (/\b(insumo|insumos|ingrediente|ingredientes|materia prima|almacen)\b/.test(n)) {
      return 'INGREDIENTE';
    }
    if (/\b(menu|carta|platillo|platillos|bebida|bebidas|producto|productos)\b/.test(n)) {
      return 'MENU';
    }
    /* Sin pista en el nombre: si la hoja no trae precio, casi siempre es
       almacen; si lo trae, es carta. */
    const tienePrecio = (encabezados || []).some(h => /precio|p\.?\s*venta|pvp/i.test(String(h)));
    return tienePrecio ? 'MENU' : 'INGREDIENTE';
  }

  if (ctx.servicios) {
    if (/\b(servicio|servicios|mano de obra|trabajos)\b/.test(n)) return 'SERVICIO';
    if (/\b(refaccion|refacciones|material|materiales|componente|componentes|insumo|insumos|repuesto|repuestos|producto|productos)\b/.test(n)) {
      return 'MATERIAL';
    }
    /* Una hoja con duracion es de servicios; sin ella, mercancia. */
    const tieneDuracion = (encabezados || []).some(h => /duracion|minutos|tiempo/i.test(String(h)));
    return tieneDuracion ? 'SERVICIO' : 'MATERIAL';
  }

  return permitidos[0];
}

/** Lo que dice una celda de la columna «Tipo», si la hay. */
function tipoDeCelda(valor, ctx = {}) {
  const s = norm(valor);
  if (!s) return null;
  if (/servicio|mano de obra|labor/.test(s)) return 'SERVICIO';
  if (/ingrediente|insumo|materia prima/.test(s)) return 'INGREDIENTE';
  if (/menu|carta|platillo|bebida/.test(s)) return 'MENU';
  if (/refaccion|componente|repuesto|material/.test(s)) return 'MATERIAL';
  if (/producto|articulo|mercancia/.test(s)) return ctx.hospitality ? 'MENU' : 'PRODUCTO';
  /* El vocabulario del giro: «Refacción» en un taller. */
  if (ctx.material?.singular && norm(ctx.material.singular) === s) return 'MATERIAL';
  return null;
}

const def = (tipo) => TIPOS[tipo] || TIPOS.PRODUCTO;

module.exports = { TIPOS, tiposDe, etiquetaDe, pluralDe, tipoDeHoja, tipoDeCelda, def };
