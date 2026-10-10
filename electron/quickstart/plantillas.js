/**
 * LA PLANTILLA SE GENERA, NO SE GUARDA.
 *
 * Las plantillas anteriores eran un `aoa_to_sheet` escrito a mano dentro del
 * componente, con nueve columnas fijas y ejemplos de refaccionaria -Bardahl,
 * filtros Mann-. Un salon de belleza se descargaba una plantilla de taller.
 * Y como el archivo vivia aparte del modelo, cada columna que se añadia a
 * `products` dejaba la plantilla un poco mas vieja.
 *
 * Aqui la plantilla se arma en el momento a partir de tres cosas que ya
 * existen: el perfil del negocio, el giro de Servicios (`presets.json`) y
 * los campos REALES de la base. No hay cinco Excel que mantener.
 *
 * LOS EJEMPLOS VAN EN SU PROPIA HOJA
 * ----------------------------------
 * Una plantilla vacia intimida, pero un ejemplo en la hoja de datos acaba
 * importado como producto. Van en una hoja aparte que el lector salta por
 * nombre, asi que no pueden colarse ni queriendo.
 */
const ExcelJS = require('exceljs');
const path = require('node:path');
const fs = require('node:fs');

const giros = require('./giros');

const CYAN = 'FF45B3C3';
const TINTA = 'FF16212E';

/** Columnas base: lo que cualquier cosa vendible necesita. */
function columnasProducto(material = 'Producto') {
  return [
    { campo: 'nombre',        cab: 'Nombre',            ancho: 40, obligatorio: true },
    { campo: 'price',         cab: 'Precio',            ancho: 12, obligatorio: true, num: '#,##0.00' },
    { campo: 'stock',         cab: 'Existencia',        ancho: 12, num: '#,##0.##' },
    { campo: 'part_number',   cab: 'Código',            ancho: 18 },
    { campo: 'bar_code',      cab: 'Código de barras',  ancho: 20 },
    { campo: 'cost',          cab: 'Costo',             ancho: 12, num: '#,##0.00' },
    { campo: 'category_name', cab: 'Categoría',         ancho: 20, obligatorio: true },
    { campo: 'brand_name',    cab: 'Marca',             ancho: 18 },
    { campo: 'base_uom',      cab: 'Unidad',            ancho: 10, lista: true },
    VENDIBLE,
  ];
}

/* Si se cobra en caja. Vacío = lo que diga la hoja (Menú se vende, Insumos
   no); con «Sí»/«No» decide cada renglón. */
const VENDIBLE = { campo: 'sellable', cab: 'Vendible', ancho: 10, lista: true, opciones: ['Sí', 'No'] };

/**
 * Que hojas y que columnas, segun el negocio.
 *
 * @param {Object} ctx { businessProfile, servicios, hospitality, preset, material }
 */
function disenar(ctx = {}) {
  const giro = giroDe(ctx);
  const sugeridas = giro ? ` Categorías sugeridas: ${giro.categorias.join(', ')}.` : '';
  const material = ctx.material?.singular || 'Producto';
  const materialPlural = ctx.material?.plural || 'Productos';

  if (ctx.hospitality) {
    /* Dos hojas y no cuatro. Recetas, presentaciones y modificadores son un
       grafo: convertirlos en Excel hace la carga inicial PEOR que la
       pantalla de recetas, que ya existe y sabe hacerlo. Primero que abra
       el negocio; las recetas se montan despues, donde se ven. */
    return {
      nombre: `plantilla_wybix_${giro?.id || 'alimentos'}.xlsx`,
      hojas: [
        /* MENU y no PRODUCTO: lo que sale en la carta se vende pero no
           tiene existencia propia. Si la plantilla dijera PRODUCTO, el
           importador crearia mercancia con stock 0 y la caja la daria por
           agotada, que es justo lo que paso en QA. */
        { nombre: 'Menú', tipo: 'MENU',
          columnas: columnasProducto().filter(c => !['stock', 'brand_name', 'base_uom'].includes(c.campo)),
          nota: `Lo que vendes al cliente: platillos, bebidas, postres. No llevan existencia propia.${sugeridas}` },
        /* Un ingrediente no tiene precio de venta: no se vende. Pedirselo
           en la plantilla es lo que llevo a ponerle $12 a doce insumos. */
        { nombre: 'Insumos', tipo: 'INGREDIENTE',
          /* Un insumo no aparece en la caja: la categoria le ayuda a ordenar,
             pero no es obligatoria como en el Menu. */
          columnas: columnasProducto().filter(c => !['bar_code', 'price'].includes(c.campo))
            .map(c => c.campo === 'category_name' ? { ...c, obligatorio: false } : c),
          nota: 'Lo que consumes para prepararlos. No se venden en caja (pon «Sí» en Vendible si también lo vendes tal cual). Las recetas se arman después, en Wybix.' },
      ],
    };
  }

  if (ctx.servicios) {
    const cols = [
      { campo: 'tipo', cab: 'Tipo', ancho: 14, lista: true, obligatorio: true,
        opciones: ['Servicio', material] },
      ...columnasProducto(material),
      { campo: 'duration_minutes', cab: 'Duración (min)', ancho: 14, num: '0' },
      { campo: 'default_commission_pct', cab: 'Comisión %', ancho: 12, num: '0.00' },
    ];
    return {
      nombre: `plantilla_wybix_${(ctx.preset || 'servicios').toLowerCase()}.xlsx`,
      hojas: [{ nombre: 'Catálogo', tipo: null, columnas: cols,
        nota: `Servicios y ${materialPlural.toLowerCase()} en la misma hoja. La columna «Tipo» decide cuál es cuál.` }],
    };
  }

  return {
    nombre: `plantilla_wybix_${giro?.id || 'productos'}.xlsx`,
    hojas: [{ nombre: 'Productos', tipo: 'PRODUCTO', columnas: columnasProducto(),
      nota: `Un renglón por producto. Con nombre, precio y categoría ya se vende.${sugeridas}` }],
  };
}

/** El giro guardado del negocio, si es de su familia. */
function giroDe(ctx = {}) {
  if (!ctx.giro || ctx.servicios) return null;
  return giros.buscar(ctx.hospitality ? 'HOSPITALITY' : 'RETAIL', ctx.giro);
}

/** Ejemplos con la cara del giro, nunca de refaccionaria por defecto.
    Van por CAMPO y se acomodan a las columnas de la primera hoja: un ejemplo
    con una columna de más desplazaba todo lo que iba detrás. */
function ejemplosDe(ctx) {
  const columnas = disenar(ctx).hojas[0].columnas;
  const giro = giroDe(ctx);
  let filas;
  if (giro) filas = giro.ejemplos;
  else if (ctx.hospitality) filas = giros.buscar('HOSPITALITY', 'cafeteria').ejemplos;
  else if (ctx.servicios) {
    const mat = ctx.material?.singular || 'Producto';
    const s = (o) => ({ ...o, sellable: 'Sí' });
    if (ctx.preset === 'BELLEZA') filas = [
      s({ tipo: 'Servicio', nombre: 'Corte de caballero', price: 150, part_number: 'SRV-CORTE', category_name: 'Servicios', base_uom: 'pza', duration_minutes: 30, default_commission_pct: 40 }),
      s({ tipo: mat, nombre: 'Shampoo anticaspa 400 ml', price: 185, stock: 12, part_number: 'SH-400', bar_code: '7501234567890', cost: 98, category_name: 'Productos', brand_name: 'Head&Shoulders', base_uom: 'pza' }),
    ];
    else if (ctx.preset === 'REPARACION_ELECTRONICA') filas = [
      s({ tipo: 'Servicio', nombre: 'Cambio de pantalla', price: 1200, part_number: 'SRV-PANT', category_name: 'Servicios', base_uom: 'pza', duration_minutes: 60, default_commission_pct: 15 }),
      s({ tipo: mat, nombre: 'Pantalla iPhone 13', price: 1850, stock: 4, part_number: 'PANT-IP13', cost: 1320, category_name: 'Componentes', brand_name: 'OEM', base_uom: 'pza' }),
    ];
    else filas = [
      s({ tipo: 'Servicio', nombre: 'Cambio de aceite', price: 450, part_number: 'SRV-ACE', category_name: 'Servicios', base_uom: 'pza', duration_minutes: 40, default_commission_pct: 10 }),
      s({ tipo: mat, nombre: 'Filtro de aceite Fram PH6017A', price: 129, stock: 18, part_number: 'PH6017A', bar_code: '7501234567890', cost: 62.5, category_name: 'Filtros', brand_name: 'Fram', base_uom: 'pza' }),
    ];
  } else filas = giros.buscar('RETAIL', 'abarrotes').ejemplos;
  return filas.map((e) => columnas.map((c) => e[c.campo] ?? ''));
}

/**
 * Escribe el archivo y devuelve su ruta.
 *
 * @param {string} destino  carpeta
 * @param {Object} ctx      contexto del negocio
 * @param {Array}  uoms     [{code, name}] para la lista desplegable
 * @param {Object} info     { appVersion }
 */
async function generar(destino, ctx = {}, uoms = [], info = {}) {
  const dis = disenar(ctx);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Wybix POS';
  wb.created = new Date();

  const codigos = (uoms.length ? uoms : [{ code: 'pza' }]).map(u => u.code);

  for (const hoja of dis.hojas) {
    const ws = wb.addWorksheet(hoja.nombre, {
      views: [{ state: 'frozen', ySplit: 2 }],
    });

    /* Fila 1: la nota, en el idioma del negocio. Fila 2: los encabezados.
       El lector busca la fila de encabezados, asi que una nota arriba no
       le estorba —y a una persona le dice que hacer—. */
    ws.mergeCells(1, 1, 1, hoja.columnas.length);
    const nota = ws.getCell(1, 1);
    nota.value = hoja.nota;
    nota.font = { size: 11, italic: true, color: { argb: 'FF55677A' } };
    ws.getRow(1).height = 22;

    const cab = ws.getRow(2);
    hoja.columnas.forEach((c, i) => {
      const celda = cab.getCell(i + 1);
      celda.value = c.obligatorio ? `${c.cab} *` : c.cab;
      celda.font = { bold: true, color: { argb: TINTA } };
      celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDF1F6' } };
      celda.border = { bottom: { style: 'thin', color: { argb: CYAN } } };
      ws.getColumn(i + 1).width = c.ancho;
      if (c.num) ws.getColumn(i + 1).numFmt = c.num;
    });
    cab.height = 20;

    /* Las listas desplegables. ExcelJS SI las escribe; SheetJS Community
       las descartaba en silencio, y por eso la plantilla anterior no podia
       tenerlas. Se aplican a un rango generoso, no a una celda. */
    hoja.columnas.forEach((c, i) => {
      if (!c.lista) return;
      const opciones = c.opciones || codigos;
      const letra = ws.getColumn(i + 1).letter;
      for (let r = 3; r <= 500; r++) {
        ws.getCell(`${letra}${r}`).dataValidation = {
          type: 'list', allowBlank: true,
          formulae: [`"${opciones.join(',')}"`],
          showErrorMessage: true,
          errorTitle: 'Valor no válido',
          error: `Elige uno de: ${opciones.join(', ')}`,
        };
      }
    });
  }

  /* Los ejemplos, en su hoja. El lector salta esta hoja por nombre. */
  const wsEj = wb.addWorksheet('Ejemplos');
  wsEj.mergeCells(1, 1, 1, 6);
  wsEj.getCell(1, 1).value = 'Solo para que veas cómo se llena. Esta hoja NO se importa.';
  wsEj.getCell(1, 1).font = { italic: true, color: { argb: 'FF55677A' } };
  const primera = dis.hojas[0];
  wsEj.getRow(2).values = primera.columnas.map(c => c.cab);
  wsEj.getRow(2).font = { bold: true };
  ejemplosDe(ctx).forEach((e, i) => { wsEj.getRow(3 + i).values = e; });
  primera.columnas.forEach((c, i) => { wsEj.getColumn(i + 1).width = c.ancho; });

  /* La metadata, escondida. El usuario no tiene por que verla; Wybix la usa
     para reconocer su propia plantilla y para poder migrarla el dia que el
     esquema cambie. */
  const wsMeta = wb.addWorksheet('_wybix', { state: 'veryHidden' });
  const meta = {
    schemaVersion: 1,
    appVersion: info.appVersion || '',
    preset: ctx.preset || '',
    businessProfile: ctx.businessProfile || 'RETAIL',
    servicios: ctx.servicios ? 1 : 0,
    hospitality: ctx.hospitality ? 1 : 0,
    giro: giroDe(ctx)?.id || '',
    generatedAt: new Date().toISOString(),
    hojasDatos: dis.hojas.map(h => h.nombre).join(','),
  };
  Object.entries(meta).forEach(([k, v], i) => { wsMeta.getRow(i + 1).values = [k, v]; });

  fs.mkdirSync(destino, { recursive: true });
  const ruta = path.join(destino, dis.nombre);
  await wb.xlsx.writeFile(ruta);
  return { ruta, nombre: dis.nombre, hojas: dis.hojas.map(h => h.nombre) };
}

module.exports = { generar, disenar, columnasProducto, ejemplosDe };
