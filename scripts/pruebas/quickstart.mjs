/**
 * LA TUBERIA DE QUICKSTART, EJERCITADA.
 *
 *     node scripts/pruebas/quickstart.mjs
 *
 * No comprueba que el codigo contenga cadenas: EJECUTA el lector, el
 * proponedor de mapeo y el planificador sobre datos que se parecen a los de
 * verdad —catalogos de proveedor mexicanos, con sus «P. Compra», sus comas
 * de miles y sus filas de titulo antes de los encabezados—.
 *
 * Cada bloque de abajo nacio de un fallo concreto del importador anterior.
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const raiz = process.cwd();
const lector = require(join(raiz, 'electron', 'quickstart', 'lector.js'));
const alias = require(join(raiz, 'electron', 'quickstart', 'alias.js'));
const plan = require(join(raiz, 'electron', 'quickstart', 'plan.js'));
const plantillas = require(join(raiz, 'electron', 'quickstart', 'plantillas.js'));
const semantica = require(join(raiz, 'electron', 'quickstart', 'semantica.js'));

const leer = (ruta) => fs.readFileSync(ruta, 'utf8');
/* Un comentario que NOMBRA el patron roto para explicarlo no es el patron.
   Buscar dentro de los comentarios daria rojo por la explicacion. */
const sinComentarios = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let ok = 0;
const fallos = [];
const check = (cond, titulo, detalle = '') => {
  if (cond) { ok++; console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`); }
  else { fallos.push(titulo); console.log(`   FALLA  ${titulo}${detalle ? `\n            ${detalle}` : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

console.log('\nQUICKSTART · LA TUBERIA\n');

// ===================================================================
seccion('Leer: lo que Excel deja en el portapapeles');

{
  /* El fallo clasico de importar CSV: una coma DENTRO de una celda parte la
     fila y desplaza todas las columnas a partir de ahi. Solo pasa en algunas
     filas, asi que el importador «funciona» hasta que un dia no. */
  const csv = 'Producto,Código,Precio\n"Aceite Mobil, 1L",MOB-1L,129.00\nBujía NGK,BKR6E,79\n';
  const r = lector.analizarTexto(csv, ',');
  check(r.length === 3, 'una coma dentro de comillas no parte la fila', `${r.length} filas`);
  check(r[1][0] === 'Aceite Mobil, 1L', 'y la celda conserva su coma', r[1][0]);
  check(r[1][2] === '129.00', 'las columnas de despues NO se desplazan', r[1][2]);
}

{
  const tsv = 'A\tB\n1\t2\n';
  check(lector.separadorDe(tsv) === '\t', 'se reconoce el TSV que pega Excel');
  check(lector.separadorDe('a;b;c\n1;2;3') === ';', 'y el CSV con punto y coma de Excel en español');
  check(lector.separadorDe('a,b,c\n1,2,3') === ',', 'y el CSV con coma');
}

{
  /* Los catalogos de proveedor casi nunca empiezan en A1. */
  const matriz = [
    ['LISTA DE PRECIOS MARZO 2026'],
    [],
    ['Producto', 'Código', 'P. Venta'],
    ['Aceite', 'MOB', '129'],
  ];
  const d = lector.desdeMatriz(matriz);
  check(d.encabezados[0] === 'Producto', 'los encabezados se encuentran aunque haya titulo arriba',
    `fila ${d.filaEncabezado}`);
  check(d.filas.length === 1, 'y las filas de adorno no se cuentan como datos');
  check(d.filas[0].fila === 4, 'el numero de renglon es el DEL ARCHIVO',
    'para poder decir «renglón 184» y que se encuentre en el Excel');
}

// ===================================================================
seccion('Mapear: proponer sin adivinar');

{
  /* El ejemplo exacto del brief. */
  const enc = ['Producto', 'Código', 'P. Compra', 'P. Venta', 'Existencia', 'Departamento'];
  const p = alias.proponer(enc);
  const de = (o) => p.columnas.find(c => c.original === o)?.campo;
  check(de('Producto') === 'nombre', 'Producto → Nombre');
  check(de('Código') === 'part_number', 'Código → Código interno');
  check(de('P. Compra') === 'cost', 'P. Compra → Costo');
  check(de('P. Venta') === 'price', 'P. Venta → Precio');
  check(de('Existencia') === 'stock', 'Existencia → Existencia');
  check(de('Departamento') === 'category_name', 'Departamento → Categoría');
  check(p.dudas === 0, 'y no queda ninguna duda que preguntar');
}

{
  const p = alias.proponer(['Producto', 'P. Unit.', 'P. Venta']);
  const c = p.columnas[1];
  check(c.campo === null && c.confianza === 'ambiguo',
    '«P. Unit.» NO se aplica solo',
    'en unos catalogos es el costo y en otros el precio: decidirlo seria adivinar');
  check(Array.isArray(c.opciones) && c.opciones.includes('cost') && c.opciones.includes('price'),
    'pero se ofrecen las dos opciones', c.opciones?.join(' / '));
  check(p.dudas === 1, 'y la duda se cuenta para saber si hay que preguntar');
}

{
  /* La huella tiene que sobrevivir a que el proveedor reordene columnas. */
  const a = alias.huellaDe(['Producto', 'Código', 'Precio']);
  const b = alias.huellaDe(['Precio', 'Producto', 'Código']);
  check(a === b, 'el mismo formato con las columnas en otro orden da la MISMA huella',
    'si no, el perfil del proveedor dejaria de reconocerse por nada');
  const c = alias.huellaDe(['Producto', 'Código', 'Costo']);
  check(a !== c, 'y un formato distinto da otra');
}

{
  const p = alias.proponer(['Nombre', 'Cve', 'Exist.', 'Depto.']);
  const de = (o) => p.columnas.find(c => c.original === o)?.campo;
  check(de('Cve') === 'part_number', 'las abreviaturas de verdad se reconocen: «Cve»');
  check(de('Exist.') === 'stock', 'y «Exist.»');
  check(de('Depto.') === 'category_name', 'y «Depto.»',
    'ninguna de estas la resuelve una distancia de edicion: hace falta la tabla');
}

// ===================================================================
seccion('Normalizar: los numeros como los escribe la gente');

check(plan.aNumero('$1,240.00') === 1240, 'formato mexicano con símbolo y miles');
check(plan.aNumero('1.240,50') === 1240.5, 'formato europeo, con la coma de decimal');
check(plan.aNumero('24 pz') === 24, 'un número con su unidad pegada');
check(plan.aNumero('') === null, 'vacío es nulo, no cero',
  'cero y «no lo sé» son cosas distintas: cero seria regalar el producto');
check(plan.aNumero('abc') === null, 'y lo que no es número tampoco es cero');

{
  const f = plan.normalizar(['Servicio', 'Cambio de aceite', '450', '10'],
    [{ indice: 0, campo: 'tipo' }, { indice: 1, campo: 'nombre' },
     { indice: 2, campo: 'price' }, { indice: 3, campo: 'stock' }], {});
  check(f.tipo === 'SERVICIO', 'la columna «Tipo» con «Servicio» marca el tipo');
  check(f.stock === null, 'y un servicio pierde la existencia que traia',
    'guardarla daria un inventario de horas de trabajo');
}

{
  const f = plan.normalizar(['X', '16'], [{ indice: 0, campo: 'nombre' }, { indice: 1, campo: 'tasa_iva' }], {});
  check(f.tasa_iva === 0.16, 'un IVA escrito como 16 se guarda como 0.16',
    'la columna es DECIMAL(5,4): un 16 ahi es 1600% y ademas revienta');
}

// ===================================================================
seccion('Validar: lo que NO cabe se caza antes, no al INSERT');

{
  const largo = 'A'.repeat(140);
  const ps = plan.validar({ nombre: largo, price: 10 }, { uoms: new Set() });
  check(ps.some(p => p.codigo === 'NOMBRE_LARGO'),
    'un nombre de 140 caracteres se marca',
    'products.nombre son 100: con el importador viejo esto abortaba las 5,000 filas');
}

{
  const ps = plan.validar({ nombre: 'X', price: 10, base_uom: 'galon' }, { uoms: new Set(['pza', 'lt']) });
  check(ps.some(p => p.codigo === 'UNIDAD_DESCONOCIDA'),
    'una unidad que no existe se marca',
    '`base_uom` tiene clave ajena: una inventada no avisa, aborta');
}

{
  const ps = plan.validar({ nombre: 'X' }, { uoms: new Set() });
  check(ps.some(p => p.codigo === 'SIN_PRECIO'), 'sin precio se marca');
  check(ps.some(p => p.codigo === 'SIN_CATEGORIA'), 'sin categoría también',
    'sin categoria el producto no sale en la pantalla de venta');
  check(ps.find(p => p.codigo === 'SIN_CATEGORIA')?.gravedad === 'medio',
    'pero la categoría no impide importar, y el precio sí',
    'empezar con poco y completar despues');
}

{
  const estado = { uoms: new Set(), vistosSku: new Set(), vistosBarras: new Set() };
  plan.validar({ nombre: 'A', price: 1, part_number: 'X1' }, estado);
  const ps = plan.validar({ nombre: 'B', price: 1, part_number: 'x1' }, estado);
  check(ps.some(p => p.codigo === 'DUP_ARCHIVO_SKU'),
    'el mismo código dos veces en el archivo se detecta, con mayúsculas o sin ellas');
}

// ===================================================================
seccion('Decidir: crear, actualizar, igual o conflicto');

{
  const cat = [{ id: 7, part_number: 'PH6017A', nombre: 'Filtro de aceite Fram PH6017A', price: 115, cost: 62.5, bar_code: '7501' }];
  const uno = (f) => {
    const probs = plan.validar(f, { uoms: new Set(), vistosSku: new Set(), vistosBarras: new Set() });
    return { ...plan.clasificar(f, plan.indexar(cat), probs), probs };
  };

  check(uno({ nombre: 'Aceite nuevo', price: 100, category_name: 'X' }).accion === 'CREATE',
    'algo que no existe se CREA');

  check(uno({ nombre: 'Filtro de aceite Fram PH6017A', price: 129, part_number: 'PH6017A', category_name: 'X' }).accion === 'UPDATE',
    'el mismo código con precio distinto se ACTUALIZA', '$115 → $129');

  check(uno({ nombre: 'Filtro de aceite Fram PH6017A', price: 115, part_number: 'PH6017A', category_name: 'X' }).accion === 'UNCHANGED',
    'el mismo código con el mismo precio queda IGUAL',
    'sin esto, reimportar el mismo archivo «actualizaria» 5,000 productos sin cambiar nada');

  const choque = uno({ nombre: 'Balata trasera Brembo', price: 689, part_number: 'PH6017A', category_name: 'X' });
  check(choque.accion === 'CONFLICT', 'el mismo código con OTRO nombre es un CONFLICTO',
    'no lo decide Wybix: «PH6017A» que era un filtro y ahora dice ser una balata');
  check(choque.probs.some(p => p.codigo === 'CODIGO_OTRO_NOMBRE'), 'y se dice por qué');

  const parecido = uno({ nombre: 'filtro de aceite fram ph6017a', price: 200, category_name: 'X' });
  check(parecido.accion === 'CONFLICT' && parecido.probs.some(p => p.codigo === 'POSIBLE_DUPLICADO'),
    'solo el nombre parecido NO se fusiona: se sugiere',
    'dos negocios pueden vender el mismo nombre de marcas distintas');

  /* El codigo de barras es coincidencia fuerte, pero fuerte no es ciega:
     con el MISMO nombre actualiza, y con otro nombre va a revision. Un EAN
     repetido con otra descripcion es casi siempre una captura mal hecha, y
     fusionarlo en silencio sobreescribiria un producto que no era. */
  check(uno({ nombre: 'Filtro de aceite Fram PH6017A', price: 140, bar_code: '7501', category_name: 'X' }).accion === 'UPDATE',
    'el código de barras idéntico y el mismo nombre ACTUALIZA');
  const barrasChoque = uno({ nombre: 'Balata trasera', price: 9, bar_code: '7501', category_name: 'X' });
  check(barrasChoque.accion === 'CONFLICT',
    'pero el mismo código de barras con otro nombre va a revisión',
    'fusionar ahi sobreescribiria un producto distinto');
}

{
  /* Una fila rota no llega a clasificarse: se queda PENDIENTE. Es lo que
     impide que entre al catalogo por accidente. */
  const f = { nombre: null, price: null };
  const probs = plan.validar(f, { uoms: new Set() });
  check(plan.clasificar(f, plan.indexar([]), probs).accion === 'PENDIENTE',
    'una fila con problemas graves no se clasifica como importable');
}

// ===================================================================
seccion('La tuberia entera, de punta a punta');

{
  const pegado = [
    'Producto\tCódigo\tP. Compra\tP. Venta\tExistencia\tDepartamento',
    'Aceite Mobil Super 4T 20W50 1L\tMOB-20W50\t78.00\t129.00\t24\tLubricantes',
    'Filtro de aceite Fram PH6017A\tPH6017A\t62.50\t129.00\t18\tFiltros',
    'Kit de clutch LUV 2.2\tCLU-LUV22\t1,240.00\t\t2\tTransmisión',
  ].join('\n');

  const leido = lector.leerPegado(pegado);
  const prop = alias.proponer(leido.hojas[0].encabezados);
  const cat = [{ id: 7, part_number: 'PH6017A', nombre: 'Filtro de aceite Fram PH6017A', price: 115, cost: 62.5, bar_code: null }];
  const filas = plan.planificar(leido.hojas[0].filas, prop.columnas, cat, { uoms: new Set(['pza']) });

  check(filas.length === 3, 'tres renglones leídos');
  check(filas[0].accion === 'CREATE', 'el aceite es nuevo');
  check(filas[1].accion === 'UPDATE' && filas[1].match_product_id === 7,
    'el filtro actualiza el que ya existe', `$115 → $${filas[1].price}`);
  check(filas[2].accion === 'PENDIENTE' && filas[2].problemas.some(p => p.codigo === 'SIN_PRECIO'),
    'el clutch queda pendiente por no traer precio');
  check(filas[2].cost === 1240, 'y su costo con coma de miles se leyó bien');
}

// ===================================================================
seccion('La plantilla se genera del negocio, no de un archivo guardado');

{
  const carpeta = fs.mkdtempSync(join(os.tmpdir(), 'wybix-plantilla-'));

  const taller = plantillas.disenar({ servicios: true, preset: 'TALLER_AUTOMOTRIZ',
    material: { singular: 'Refacción', plural: 'Refacciones' } });
  const colTipo = taller.hojas[0].columnas.find(c => c.campo === 'tipo');
  check(colTipo?.opciones?.includes('Refacción'),
    'la plantilla de un taller ofrece «Refacción»', colTipo?.opciones?.join(' / '));

  const belleza = plantillas.disenar({ servicios: true, preset: 'BELLEZA',
    material: { singular: 'Producto', plural: 'Productos e insumos' } });
  check(belleza.hojas[0].columnas.find(c => c.campo === 'tipo')?.opciones?.includes('Producto'),
    'y la de un salón ofrece «Producto»',
    'mismo generador, vocabulario del giro: no son dos Excel distintos que mantener');

  check(taller.hojas[0].columnas.some(c => c.campo === 'duration_minutes'),
    'un giro con servicios pide duración');
  const tienda = plantillas.disenar({ businessProfile: 'RETAIL' });
  check(!tienda.hojas[0].columnas.some(c => c.campo === 'duration_minutes'),
    'y una tienda no', 'preguntar la duracion de una Coca-Cola no tiene sentido');

  const hosp = plantillas.disenar({ hospitality: true });
  check(hosp.hojas.length === 2 && hosp.hojas.map(h => h.nombre).join(',') === 'Menú,Insumos',
    'alimentos y bebidas trae dos hojas: lo que se vende y lo que se consume',
    hosp.hojas.map(h => `${h.nombre}/${h.tipo}`).join(' · '));
  check(!hosp.hojas.some(h => /receta|modificador|presentacion/i.test(h.nombre)),
    'y NO trae recetas ni modificadores',
    'son un grafo: en Excel la carga inicial seria peor que la pantalla que ya existe');

  /* Y que el archivo se escriba de verdad, con su hoja de ejemplos aparte. */
  const escrito = await plantillas.generar(carpeta, { businessProfile: 'RETAIL' },
    [{ code: 'pza' }, { code: 'kg' }], { appVersion: '1.2.0' });
  check(fs.existsSync(escrito.ruta), 'la plantilla se escribe en disco', escrito.nombre);

  const ExcelJS = require(join(raiz, 'node_modules', 'exceljs'));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(escrito.ruta);
  const nombres = wb.worksheets.map(w => w.name);
  check(nombres.includes('Ejemplos'), 'con su hoja de ejemplos');
  check(nombres.includes('_wybix'), 'y su metadata escondida');
  check(wb.getWorksheet('_wybix').state === 'veryHidden', 'que el usuario no ve');

  /* Lo que la libreria anterior NO podia hacer. */
  const ws = wb.getWorksheet('Productos');
  const colUnidad = ws.getRow(2).values.findIndex(v => String(v ?? '').startsWith('Unidad'));
  const val = ws.getCell(3, colUnidad).dataValidation;
  check(val?.type === 'list', 'y la columna de unidad tiene lista desplegable de verdad',
    'SheetJS Community las descartaba en silencio al escribir');

  /* La prueba que importa de la hoja de ejemplos: que el lector NO la lea. */
  const releido = await lector.leerExcel(escrito.ruta);
  check(!releido.hojas.some(h => h.nombre === 'Ejemplos'),
    'el lector SALTA la hoja de ejemplos',
    'si no, los ejemplos acabarian importados como productos del negocio');
  check(releido.metadata?.schemaVersion === 1,
    'y reconoce la plantilla como suya', `appVersion ${releido.metadata?.appVersion}`);

  try { fs.rmSync(carpeta, { recursive: true, force: true }); } catch { /* noop */ }
}

// ===================================================================
seccion('Cada cosa entra como lo que es');

/*
 * EL FALLO QUE ESTO EVITA, TAL CUAL SE VIO EN QA
 * ----------------------------------------------
 * Con un catalogo de cafeteria, QuickStart invirtio la semantica:
 *
 *   · «Cafe en grano» —un INGREDIENTE— pidio precio de venta, y como la
 *     accion era masiva se le puso $12 a los doce insumos. Acabo a la venta
 *     en la caja, con 5000 g de existencia.
 *   · «Cafe Americano» —un PRODUCTO DE MENU— entro como mercancia DIRECT
 *     con stock 0, asi que la caja lo daba por agotado.
 *
 * No faltaba modelo: `products.inventory_mode` y `products.sellable` ya
 * distinguian las dos cosas y las consultas del dominio ya las respetaban.
 * El importador no las escribia.
 */
{
  const uoms = new Set(['g', 'ml', 'pza', 'kg', 'lt']);

  // ------------------------------------------------- CAFE EN GRANO
  const mIng = [{ indice: 0, campo: 'nombre' }, { indice: 1, campo: 'stock' },
                { indice: 2, campo: 'base_uom' }, { indice: 3, campo: 'cost' }];
  const grano = plan.normalizar(['Café en grano', '5000', 'g', '380'], mIng,
    { tipoPorDefecto: 'INGREDIENTE' });

  check(grano.inventory_mode === 'DIRECT' && grano.sellable === 0,
    'un ingrediente nace DIRECT y NO vendible',
    `${grano.inventory_mode} · sellable ${grano.sellable}`);
  check(grano.price === null, 'sin precio de venta: no se vende');
  check(grano.stock === 5000 && grano.base_uom === 'g',
    'y conserva su existencia con su unidad', '5000 g');

  const psGrano = plan.validar(grano, { uoms });
  check(!psGrano.some(p => p.codigo === 'SIN_PRECIO'),
    'NO se le pide precio de venta',
    'pedirselo a doce insumos y ofrecer ponerselo a todos fue el fallo');
  check(!psGrano.some(p => p.codigo === 'SIN_CATEGORIA'),
    'ni categoria: sin venta, la categoria no lo saca de ningun sitio');
  check(psGrano.length === 0, 'el ingrediente entra limpio', 'cero problemas');

  /* Y sin unidad SI se queja: una receta que pide «200 de leche» no sabe si
     son mililitros o litros. */
  const sinUom = plan.normalizar(['Leche', '12000', '', '22'], mIng, { tipoPorDefecto: 'INGREDIENTE' });
  check(plan.validar(sinUom, { uoms }).some(p => p.codigo === 'SIN_UNIDAD'),
    'pero un ingrediente SIN unidad si se marca',
    'es el dato que hace falta para poder usarlo en una receta');

  // ------------------------------------------------- CAFE AMERICANO
  const mMenu = [{ indice: 0, campo: 'nombre' }, { indice: 1, campo: 'price' },
                 { indice: 2, campo: 'category_name' }, { indice: 3, campo: 'stock' }];
  const americano = plan.normalizar(['Café Americano', '35', 'Bebidas', '0'], mMenu,
    { tipoPorDefecto: 'MENU' });

  check(americano.inventory_mode === 'NONE' && americano.sellable === 1,
    'un producto de menu nace NONE y vendible',
    'NONE da 999999 unidades disponibles: no se agota mientras no tenga receta');
  check(americano.stock === null,
    'y SIN existencia propia',
    'con stock 0 y DIRECT la caja lo daba por agotado, que es lo que paso');
  check(americano.price === 35, 'conserva su precio');
  check(plan.validar(americano, { uoms }).length === 0,
    'y entra limpio');

  // ------------------------------------------------- SERVICIO Y MATERIAL
  const serv = plan.normalizar(['Cambio de aceite', '450', '40'],
    [{ indice: 0, campo: 'nombre' }, { indice: 1, campo: 'price' }, { indice: 2, campo: 'duration_minutes' }],
    { tipoPorDefecto: 'SERVICIO' });
  check(serv.inventory_mode === 'NONE' && serv.sellable === 1 && serv.stock === null,
    'un servicio: NONE, vendible, sin existencia');
  check(serv.duration_minutes === 40, 'y conserva su duracion');

  const refa = plan.normalizar(['Filtro de aceite', '129', '18', '62.5'],
    [{ indice: 0, campo: 'nombre' }, { indice: 1, campo: 'price' },
     { indice: 2, campo: 'stock' }, { indice: 3, campo: 'cost' }],
    { tipoPorDefecto: 'MATERIAL' });
  check(refa.inventory_mode === 'DIRECT' && refa.sellable === 1 && refa.stock === 18,
    'una refaccion: DIRECT, vendible, con existencia');
}

// ===================================================================
seccion('Confirmar el mapeo no le cambia el tipo a la hoja');

/*
 * EL CASO DE QA, CON SU ARCHIVO.
 *
 * La hoja «Menú» trae su propia columna «Tipo» con «Producto» en cada fila,
 * y una columna «Vendible» que el mapeo no conoce. Por esa columna la
 * pantalla pregunta; la persona pulsa «No usar», y eso REPLANIFICA la hoja
 * por `quickstart:remapear`.
 *
 * Ese canal llamaba a `planificar` sin el tipo de la hoja y sin el negocio.
 * Con eso, «Producto» se leia como PRODUCTO/DIRECT, el Cafe Americano
 * entraba con existencia 0 y Touch lo pintaba «Agotado». El POS no tenia la
 * culpa: nunca recibio un NONE.
 */
{
  const m = [
    { indice: 0, campo: 'part_number' }, { indice: 1, campo: 'nombre' },
    { indice: 2, campo: 'category_name' }, { indice: 3, campo: 'price' },
    { indice: 4, campo: null },            { indice: 5, campo: 'tipo' },
  ];
  const fila = [{ fila: 2, celdas: ['CAF-AME', 'Café Americano', 'Cafés', 35, 'Sí', 'Producto'] }];

  const [bien] = plan.planificar(fila, m, [], {
    tipoPorDefecto: 'MENU', negocio: { hospitality: true },
  });
  check(bien.tipo === 'MENU' && bien.inventory_mode === 'NONE' && Number(bien.sellable) === 1,
    'con el contexto, «Producto» en una cafeteria es un producto de menu',
    `${bien.tipo} · ${bien.inventory_mode} · sellable ${bien.sellable}`);

  const [mal] = plan.planificar(fila, m, [], {});
  check(mal.inventory_mode === 'DIRECT',
    'y sin el contexto sale DIRECT: por eso cada llamada tiene que llevarlo',
    'es exactamente lo que se guardo en Demo Hospitality');

  /* Y el canal que replanifica lo lleva. Se lee el codigo porque el canal
     necesita una base; lo que se comprueba es que no vuelva a perderse. */
  const ipc = leer(join(raiz, 'electron', 'ipc', 'quickstart.js'));
  const desde = ipc.indexOf("ipcMain.handle('quickstart:remapear'");
  const remap = ipc.slice(desde, ipc.indexOf('ipcMain.handle(', desde + 1));
  check(/tipoPorDefecto:\s*tipoHoja/.test(remap),
    'remapear replanifica con el tipo de la hoja',
    'el que se decidio al analizar y quedo en metadata_json.tipo');
  check(/negocio:\s*ctx/.test(remap),
    'y con el negocio, que es lo que dice que «Producto» es menu');
  check(/metadata_json/.test(remap),
    'y el tipo sale de la carga, no se vuelve a adivinar');
}

// ===================================================================
seccion('Lo que no se vende no puede pedir precio de venta');

/*
 * LA REGLA, ESCRITA SOBRE LA FILA.
 *
 * En QA, Demo Hospitality seguia ofreciendo «12 sin precio de venta ·
 * Ponerles precio» sobre una hoja de insumos. La causa estaba antes -el
 * proceso principal no sabia que el negocio era una cafeteria-, pero la
 * leccion es que la regla no puede depender de haber clasificado bien:
 *
 *   si `sellable = 0`, la ausencia de precio de venta NO es un problema.
 *
 * Asi el peor caso de una mala clasificacion pasa de «ofrecer ponerle precio
 * a doce insumos» a «un insumo bien cargado con el tipo cambiado».
 */
{
  const uoms = new Set(['g', 'ml', 'pza']);
  const m = [{ indice: 0, campo: 'nombre' }, { indice: 1, campo: 'base_uom' }];

  const ing = plan.normalizar(['Café en grano', 'g'], m, { tipoPorDefecto: 'INGREDIENTE' });
  check(!plan.validar(ing, { uoms }).some(p => p.codigo === 'SIN_PRECIO'),
    'un ingrediente sin precio entra limpio');
  check(!plan.validar(ing, { uoms }).some(p => p.codigo === 'SIN_CATEGORIA'),
    'y tampoco se le exige categoria',
    'la categoria importa porque sin ella no sale a la VENTA; esto no se vende');

  /* Y la regla mira la FILA, no la tabla de tipos: una fila marcada como
     producto pero no vendible tampoco pide precio. */
  const raro = plan.normalizar(['Algo raro', 'pza'], m, { tipoPorDefecto: 'PRODUCTO' });
  raro.sellable = 0;
  check(!plan.validar(raro, { uoms }).some(p => p.codigo === 'SIN_PRECIO'),
    'y sigue valiendo aunque el tipo diga otra cosa',
    'es la red que impide que un fallo de clasificacion se convierta otra vez en «ponerles precio a los 12»');

  /* Lo que SI se vende sigue necesitandolo: la regla no afloja nada. */
  const prod = plan.normalizar(['Coca-Cola', 'pza'], m, { tipoPorDefecto: 'PRODUCTO' });
  check(plan.validar(prod, { uoms }).some(p => p.codigo === 'SIN_PRECIO'),
    'pero a un producto vendible se le sigue pidiendo');
  const menu = plan.normalizar(['Latte', 'pza'], m, { tipoPorDefecto: 'MENU' });
  check(plan.validar(menu, { uoms }).some(p => p.codigo === 'SIN_PRECIO'),
    'y a un producto de menu tambien');
  const serv = plan.normalizar(['Corte', 'pza'], m, { tipoPorDefecto: 'SERVICIO' });
  check(plan.validar(serv, { uoms }).some(p => p.codigo === 'SIN_PRECIO'),
    'y a un servicio, que se cobra');
}

// ===================================================================
seccion('Con que columnas se revisa cada cosa');

/*
 * La tabla de revision era fija -Producto, Codigo, Costo, Precio,
 * Existencia-, que es una tabla de tienda. Revisando insumos no enseñaba la
 * UNIDAD: «5000» sin ella no dice si son gramos o litros.
 *
 * Las columnas salen de `semantica.js`, que es de donde sale todo lo demas.
 * El renderer las copia en `COLUMNAS`; esto comprueba que las dos listas
 * dicen lo mismo, porque separarlas es como vuelven a divergir.
 */
{
  const front = leer(join('src', 'app', 'wx-quickstart', 'quickstart.service.ts'));

  for (const [tipo, hay, nohay] of [
    ['INGREDIENTE', ['base_uom', 'cost', 'stock', 'category_name'], ['price']],
    ['MENU',        ['price', 'category_name'],                     ['stock']],
    ['SERVICIO',    ['price', 'duration_minutes'],                  ['stock']],
    ['PRODUCTO',    ['price', 'stock'],                             []],
    ['MATERIAL',    ['price', 'stock'],                             []],
  ]) {
    const rev = semantica.def(tipo).revision;
    for (const c of hay) check(rev.includes(c), `la revision de ${tipo} enseña ${c}`);
    for (const c of nohay) check(!rev.includes(c), `y NO enseña ${c}, que no aplica`);
  }

  /* El bloque del renderer para cada tipo, tal cual se pinta. */
  const bloque = (t) => (front.split(`  ${t}: [`)[1] || '').split('],')[0];
  check(/base_uom[^\]]*Unidad/.test(bloque('INGREDIENTE')),
    'y la pantalla de ingredientes tiene su columna Unidad',
    'es la que faltaba en QA: «5000» sin unidad no dice nada');
  check(!/campo: 'price'/.test(bloque('INGREDIENTE')),
    'sin una columna de Precio de venta que no aplica');
  check(!/campo: 'stock'/.test(bloque('MENU')),
    'y la de menu, sin una Existencia que no tiene');
}

// ===================================================================
seccion('Que trae cada hoja: se decide en UN solo sitio');

{
  /* Sin esto acaban apareciendo `if (hoja === "Insumos")` repartidos por la
     tuberia, cada uno con su propio criterio. */
  const caf = { hospitality: true };
  check(semantica.tipoDeHoja('Insumos', ['Nombre', 'Unidad', 'Costo'], caf) === 'INGREDIENTE',
    'en una cafeteria, «Insumos» son ingredientes');
  check(semantica.tipoDeHoja('Menú', ['Nombre', 'Precio'], caf) === 'MENU',
    'y «Menú» son productos de menu');
  check(semantica.tipoDeHoja('Hoja1', ['Nombre', 'Costo', 'Unidad'], caf) === 'INGREDIENTE',
    'sin pista en el nombre, una hoja sin precio es almacen');
  check(semantica.tipoDeHoja('Hoja1', ['Nombre', 'P. Venta'], caf) === 'MENU',
    'y una con precio es carta');

  const tall = { servicios: true, material: { singular: 'Refacción', plural: 'Refacciones' } };
  check(semantica.tipoDeHoja('Servicios', ['Nombre', 'Precio', 'Duración'], tall) === 'SERVICIO',
    'en un taller, «Servicios» son servicios');
  check(semantica.tipoDeHoja('Refacciones', ['Nombre', 'Precio', 'Existencia'], tall) === 'MATERIAL',
    'y «Refacciones» son material');

  /* La MISMA palabra, otro negocio, otra cosa. Una ferreteria que llama
     «Insumos» a su mercancia no tiene ingredientes. */
  check(semantica.tipoDeHoja('Insumos', ['Nombre', 'Precio'], {}) === 'PRODUCTO',
    'en una tienda, «Insumos» son productos',
    'la misma palabra no significa lo mismo en dos negocios');

  /* Y el vocabulario del giro se respeta en la columna «Tipo». */
  check(semantica.tipoDeCelda('Refacción', tall) === 'MATERIAL',
    'la columna Tipo entiende el vocabulario del giro');
  check(semantica.tipoDeCelda('Servicio', tall) === 'SERVICIO', 'y «Servicio»');
}

// ===================================================================
seccion('Lo que hace falta depende de que es');

{
  const req = (t) => semantica.def(t).requeridos.join('+');
  check(req('PRODUCTO') === 'nombre+price', 'un producto: nombre y precio');
  check(req('MENU') === 'nombre+price', 'un producto de menu: nombre y precio');
  check(req('SERVICIO') === 'nombre+price', 'un servicio: nombre y precio');
  check(req('INGREDIENTE') === 'nombre+base_uom',
    'un ingrediente: nombre y UNIDAD, nunca precio de venta');
  check(!semantica.def('INGREDIENTE').requeridos.includes('price'),
    'y eso es lo que impide ofrecer «ponerles precio a los 12»');

  /* Las columnas de la revision tambien salen de aqui: revisar una hoja de
     ingredientes sin ver la unidad es leer «5000» sin saber de que. */
  check(semantica.def('INGREDIENTE').revision.includes('base_uom'),
    'la revision de ingredientes enseña la unidad');
  check(!semantica.def('INGREDIENTE').revision.includes('price'),
    'y no enseña un precio que no tiene');
  check(semantica.def('MENU').revision.includes('category_name'),
    'la de menu enseña la categoria');
  check(!semantica.def('MENU').revision.includes('stock'),
    'y no una existencia que no aplica');
  check(semantica.def('SERVICIO').revision.includes('duration_minutes'),
    'la de servicios enseña la duracion');

  /* Y a que puede mapearse una columna depende del tipo: ofrecer
     «Existencia» en una hoja de menu no tiene sentido. */
  check(!semantica.def('MENU').destinos.includes('stock'),
    'una columna de una hoja de menu no puede mapearse a Existencia');
  check(!semantica.def('INGREDIENTE').destinos.includes('price'),
    'ni una de ingredientes a Precio de venta');
  check(semantica.def('SERVICIO').destinos.includes('duration_minutes'),
    'pero la de servicios si ofrece Duracion');
}

// ===================================================================
seccion('XLSX: los archivos que llegan de verdad');

/*
 * EL FALLO QUE ESTO EVITA
 * -----------------------
 * En QA, un catalogo de abarrotes perfectamente valido devolvia
 *
 *     Cannot read properties of undefined (reading 'sheets')
 *
 * y el mensaje tecnico llegaba hasta la pantalla del cliente.
 *
 * La causa no era el archivo. ExcelJS construye el modelo del libro dentro
 * de `case 'workbook'` en `WorkbookXform.parseClose`: si el XML declara el
 * espacio de nombres con PREFIJO -`<x:workbook xmlns:x="...">`, que es OOXML
 * valido y lo que producen varios ERP y exportadores-, el elemento se llama
 * `x:workbook`, ese caso no entra nunca, el modelo se queda sin asignar y
 * `parseWorkbook()` devuelve `undefined`.
 */
{
  const ExcelJS = require(join(raiz, 'node_modules', 'exceljs'));
  const JSZip = require(join(raiz, 'node_modules', 'jszip'));
  const carpeta = fs.mkdtempSync(join(os.tmpdir(), 'wybix-xlsx-'));

  const CABECERA = ['Código', 'Descripción', 'Depto.', 'Marca', 'P. Compra', 'P. Venta', 'Exist.', 'Código Barras', 'Unidad'];
  const FILAS = [
    ['ABA-001', 'Coca-Cola 600 ml', 'Bebidas', 'Coca-Cola', 13.5, 18, 24, '7501055300013', 'pza'],
    ['ABA-013', 'Sabritas Original 45 g', 'Botanas', 'Sabritas', 14, 19, 30, '', 'pza'],
  ];

  const escribir = async (nombre, hojas) => {
    const wb = new ExcelJS.Workbook();
    for (const [titulo, filas] of hojas) {
      const ws = wb.addWorksheet(titulo);
      filas.forEach(f => ws.addRow(f));
    }
    const ruta = join(carpeta, nombre);
    await wb.xlsx.writeFile(ruta);
    return ruta;
  };

  // -------------------------------------------------- una sola hoja
  const unaHoja = await escribir('una.xlsx', [['Inventario', [CABECERA, ...FILAS]]]);
  const r1 = await lector.leerArchivo(unaHoja);
  check(r1.hojas.length === 1 && r1.hojas[0].filas.length === 2,
    'un XLSX de una hoja se lee');

  // -------------------------------------------- varias hojas, una es basura
  const variasHojas = await escribir('varias.xlsx', [
    ['Inventario Actual', [CABECERA, ...FILAS]],
    ['Notas QA', [['Este archivo es para QA'], ['No importar esta hoja']]],
  ]);
  const r2 = await lector.leerArchivo(variasHojas);
  check(r2.hojas.length === 2, 'un XLSX de varias hojas NO revienta',
    r2.hojas.map(h => h.nombre).join(' | '));

  /* Y la hoja util se distingue de la de notas por los encabezados que Wybix
     reconoce, no por el orden en que estan en el libro. */
  const puntuar = (h) => alias.proponer(h.encabezados).columnas
    .filter(c => c.campo && c.confianza !== 'ambiguo').length;
  const datos = r2.hojas.find(h => h.nombre === 'Inventario Actual');
  const notas = r2.hojas.find(h => h.nombre === 'Notas QA');
  check(puntuar(datos) >= 2 && puntuar(notas) < 2,
    'la hoja de datos se distingue de la de notas',
    `Inventario ${puntuar(datos)} campos · Notas ${puntuar(notas)}`);

  // --------------------------------- EL FALLO: espacio de nombres con prefijo
  const prefijado = join(carpeta, 'prefijado.xlsx');
  {
    const zip = await JSZip.loadAsync(fs.readFileSync(variasHojas));
    const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    let xml = await zip.file('xl/workbook.xml').async('string');
    xml = xml
      .replace('<workbook ', '<x:workbook ')
      .replace(`xmlns="${NS}"`, `xmlns:x="${NS}"`)
      .replace('</workbook>', '</x:workbook>')
      .replace(/<(\/?)(sheets|sheet|workbookPr|bookViews|workbookView|fileVersion|calcPr|definedNames)\b/g, '<$1x:$2');
    zip.file('xl/workbook.xml', xml);
    fs.writeFileSync(prefijado, await zip.generateAsync({ type: 'nodebuffer' }));
  }

  let leidoPrefijado = null, errorPrefijado = null;
  try { leidoPrefijado = await lector.leerArchivo(prefijado); }
  catch (e) { errorPrefijado = e; }

  check(!errorPrefijado, 'un XLSX con prefijo de espacio de nombres se lee',
    errorPrefijado ? errorPrefijado.message : 'ExcelJS solo entiende <workbook> sin prefijo: se normaliza antes');
  check(leidoPrefijado && leidoPrefijado.hojas.length === 2,
    'y conserva sus dos hojas');
  check(leidoPrefijado && leidoPrefijado.hojas.find(h => h.nombre === 'Inventario Actual')?.filas.length === 2,
    'con sus filas intactas');

  // ------------------------- EL ARCHIVO DE QA, con sus DOS rarezas juntas
  /*
   * Replica del catalogo de abarrotes que fallaba en QA. Trae las dos cosas
   * que ExcelJS no sabe leer, y las trae a la vez:
   *
   *   1. El espacio de nombres con prefijo -`<x:workbook>`-.
   *   2. Una tabla de Excel («dar formato como tabla») cuya relacion apunta
   *      con ruta ABSOLUTA: `/xl/tables/table1.xml`. ExcelJS guarda la tabla
   *      con la clave `../tables/table1.xml` y la busca por el `Target` tal
   *      cual, asi que no casan y mete un `undefined` en las tablas de la
   *      hoja. Despues `worksheet.js` hace `table.name` sobre eso.
   *
   * Las dos son OOXML valido. El archivo abre en Excel sin una queja.
   */
  const comoQA = join(carpeta, 'QA_como_el_real.xlsx');
  {
    const zip = await JSZip.loadAsync(fs.readFileSync(variasHojas));
    const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

    /* La tabla, con su parte y su relacion de ruta absoluta. */
    zip.file('xl/tables/table1.xml',
      '<?xml version="1.0" encoding="utf-8"?>'
      + `<x:table id="1" name="RetailInventory" displayName="RetailInventory" ref="A1:I3" `
      + `headerRowCount="1" totalsRowCount="0" xmlns:x="${NS}">`
      + '<x:tableColumns count="1"><x:tableColumn id="1" name="Código" /></x:tableColumns>'
      + '</x:table>');
    zip.file('xl/worksheets/_rels/sheet1.xml.rels',
      '<?xml version="1.0" encoding="utf-8"?>'
      + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + `<Relationship Type="${REL}/table" Target="/xl/tables/table1.xml" Id="Rtabla1" />`
      + '</Relationships>');

    /* Y el prefijo en todo el XML de hoja de calculo, como el archivo real. */
    for (const nombre of Object.keys(zip.files)) {
      if (zip.files[nombre].dir) continue;
      if (!/^xl\/.*\.xml$/.test(nombre)) continue;
      let xml = await zip.file(nombre).async('string');
      if (!xml.includes(`xmlns="${NS}"`)) continue;
      xml = xml
        .replace(new RegExp(`xmlns="${NS}"`, 'g'), `xmlns:x="${NS}"`)
        .replace(/<(\/?)(?!\?)([a-zA-Z][a-zA-Z0-9]*)/g, (todo, cierre, tag) =>
          /^(Relationship|Relationships|Types|Override|Default)$/.test(tag) ? todo : `<${cierre}x:${tag}`);
      zip.file(nombre, xml);
    }

    /* La referencia desde la hoja a su tabla. */
    let s1 = await zip.file('xl/worksheets/sheet1.xml').async('string');
    s1 = s1.replace('</x:worksheet>',
      `<x:tableParts count="1"><x:tablePart r:id="Rtabla1" xmlns:r="${REL}" /></x:tableParts></x:worksheet>`);
    zip.file('xl/worksheets/sheet1.xml', s1);

    fs.writeFileSync(comoQA, await zip.generateAsync({ type: 'nodebuffer' }));
  }

  let leidoQA = null, errorQA = null;
  try { leidoQA = await lector.leerArchivo(comoQA); } catch (e) { errorQA = e; }

  check(!errorQA, 'el archivo de QA -prefijo Y tabla con ruta absoluta- se lee',
    errorQA ? errorQA.message : 'las dos rarezas juntas, que es como llego');
  check(leidoQA && leidoQA.hojas.length === 2,
    'y conserva sus dos hojas', leidoQA ? leidoQA.hojas.map(h => h.nombre).join(' | ') : '');
  check(leidoQA && leidoQA.hojas[0].filas.length === 2,
    'con las filas de datos intactas',
    'perder filas por el camino seria peor que no leer el archivo');
  check(leidoQA && leidoQA.hojas[0].encabezados.length === 9,
    'y sus nueve columnas');

  // ------------------------------------------------------------ un CSV
  const csv = join(carpeta, 'lista.csv');
  fs.writeFileSync(csv, 'Producto,Código,Precio\n"Aceite, 1L",MOB,129\n', 'utf8');
  const r3 = await lector.leerArchivo(csv);
  check(r3.hojas[0].filas.length === 1 && r3.hojas[0].filas[0].celdas[0] === 'Aceite, 1L',
    'un CSV se lee y respeta las comillas');

  // ----------------------------------------------- un archivo que no lo es
  const roto = join(carpeta, 'roto.xlsx');
  fs.writeFileSync(roto, 'esto no es un Excel, es texto suelto', 'utf8');
  let errorRoto = null;
  try { await lector.leerArchivo(roto); } catch (e) { errorRoto = e; }
  check(!!errorRoto, 'un archivo malformado falla, no devuelve basura');

  /* Y lo importante: lo que falla NO puede llegar con esa cara al cliente.
     El traductor vive en el IPC y se comprueba que exista y que no devuelva
     nunca el mensaje crudo. */
  const ipc = leer(join('electron', 'ipc', 'quickstart.js'));
  check(/function alHumano\(/.test(ipc), 'hay un traductor de errores a lenguaje humano');
  check(!/error: String\(e\.message/.test(sinComentarios(ipc)),
    'y ningun canal devuelve el mensaje tecnico crudo',
    'un TypeError en un modal no le dice nada a quien acaba de comprar un POS');
  check(/console\.error/.test(ipc), 'el detalle tecnico si va a la bitacora');

  /* -------------------------------------------- EL VIAJE DE IDA Y VUELTA
     Lo que la plantilla PROMETE tiene que ser lo que QuickStart entiende.
     Si la plantilla dijera «Servicio» y el importador creara mercancia, el
     usuario tendria razon en no volver a fiarse de ella. */
  for (const [nombre, ctxNeg] of [
    ['alimentos', { hospitality: true }],
    ['taller', { servicios: true, preset: 'TALLER_AUTOMOTRIZ',
                 material: { singular: 'Refacción', plural: 'Refacciones' } }],
    ['tienda', { businessProfile: 'RETAIL' }],
  ]) {
    const dis = plantillas.disenar(ctxNeg);
    let cuadra = true, detalle = [];
    for (const hoja of dis.hojas) {
      if (!hoja.tipo) continue;   // la de servicios decide por columna «Tipo»
      const inferido = semantica.tipoDeHoja(hoja.nombre, hoja.columnas.map(c => c.cab), ctxNeg);
      detalle.push(`${hoja.nombre}→${inferido}`);
      if (inferido !== hoja.tipo) cuadra = false;
    }
    check(cuadra, `plantilla de ${nombre}: lo que promete es lo que se importa`,
      detalle.join(' · '));

    /* Y las columnas que ofrece son las que ese tipo admite. */
    for (const hoja of dis.hojas) {
      if (!hoja.tipo) continue;
      const permitidos = semantica.def(hoja.tipo).destinos;
      const sobran = hoja.columnas
        .filter(c => c.campo !== 'tipo' && !permitidos.includes(c.campo))
        .map(c => c.cab);
      check(sobran.length === 0,
        `plantilla de ${nombre} · ${hoja.nombre}: no pide nada que ese tipo no use`,
        sobran.length ? `sobra: ${sobran.join(', ')}` : `${hoja.columnas.length} columnas`);
    }

    /* Y los ejemplos tienen tantas celdas como columnas: una de mas
       desplaza todo lo que va detras. */
    const ej = plantillas.ejemplosDe(ctxNeg);
    check(ej.every(e => e.length === dis.hojas[0].columnas.length),
      `plantilla de ${nombre}: los ejemplos cuadran con sus columnas`,
      `${dis.hojas[0].columnas.length} columnas · ${ej[0].length} celdas`);
  }

  try { fs.rmSync(carpeta, { recursive: true, force: true }); } catch { /* noop */ }
}

// ===================================================================
seccion('Rendimiento: lo que tarda planificar de verdad');

{
  const filas = [];
  for (let i = 0; i < 10000; i++) {
    filas.push({ fila: i + 2, celdas: [`Producto ${i}`, `SKU-${i}`, '78.00', '129.00', '24', 'Lubricantes'] });
  }
  const mapping = alias.proponer(['Producto', 'Código', 'P. Compra', 'P. Venta', 'Existencia', 'Departamento']).columnas;
  const cat = [];
  for (let i = 0; i < 5000; i++) cat.push({ id: i, part_number: `VIEJO-${i}`, nombre: `Viejo ${i}`, price: 1, cost: 1, bar_code: null });

  const t0 = Date.now();
  const r = plan.planificar(filas, mapping, cat, { uoms: new Set(['pza']) });
  const ms = Date.now() - t0;

  check(r.length === 10000, '10,000 filas planificadas contra un catálogo de 5,000');
  check(ms < 3000, `y tarda ${ms} ms`, 'el indice se construye una vez, no una consulta por fila');
}

console.log(`\nRESULTADO: ${fallos.length ? `${fallos.length} FALLO(S) de ${ok + fallos.length}` : `TODO BIEN · ${ok}/${ok}`}`);
process.exit(fallos.length ? 1 : 0);
