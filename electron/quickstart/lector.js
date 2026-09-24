/**
 * DE UN ARCHIVO A FILAS. Nada mas.
 *
 * POR QUE EXCELJS Y NO LA LIBRERIA QUE YA HABIA
 * --------------------------------------------
 * `xlsx@0.18.5` arrastra CVE-2023-30533 (prototype pollution a traves de un
 * archivo manipulado). El aviso dice literalmente que los flujos que NO leen
 * archivos arbitrarios no estan afectados —y esto es exactamente un flujo
 * que lee archivos arbitrarios del cliente—. La version corregida (0.19.3+)
 * no esta en npm: npm se quedo en 0.18.5 y sin mantenimiento, y el arreglo
 * solo se publica en el CDN propio de SheetJS, que es una fuente rara de
 * empaquetar y de auditar.
 *
 * ExcelJS: MIT, mantenido en npm, lee y escribe, y ademas escribe
 * VALIDACIONES DE DATOS —las listas desplegables de la plantilla—, cosa que
 * SheetJS Community descarta en silencio al escribir. Se queda.
 *
 * `xlsx-js-style` se conserva porque solo EXPORTA reportes: escribir no
 * expone a ese fallo.
 *
 * EL CSV NO SE DELEGA
 * -------------------
 * El mismo analizador sirve para un .csv y para lo que Excel pone en el
 * portapapeles al copiar (TSV). Una dependencia menos y un solo sitio donde
 * arreglar las comillas.
 */
const ExcelJS = require('exceljs');

/** Cuantas filas se leen como maximo de un tiron. Una guarda, no un limite
 *  de producto: por encima de esto casi siempre es un archivo equivocado. */
const TOPE_FILAS = 50000;

/** Hojas de nuestras plantillas que acompañan pero no se importan. */
const HOJAS_QUE_NO_SON_DATOS = new Set(['ejemplos', 'instrucciones', 'ayuda', 'leeme']);

/**
 * Analiza texto separado por un caracter, respetando comillas.
 *
 * Excel entrecomilla una celda que contiene el separador, un salto de linea
 * o una comilla (que dentro va duplicada). Un `split(',')` parte «Aceite
 * 20W50, 1L» en dos columnas y desplaza toda la fila: es el fallo clasico de
 * importar CSV y cuesta horas de encontrar porque solo pasa en algunas filas.
 */
function analizarTexto(texto, sep) {
  const filas = [];
  let fila = [], celda = '', dentro = false;
  const s = String(texto ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (dentro) {
      if (c === '"') {
        if (s[i + 1] === '"') { celda += '"'; i++; }
        else dentro = false;
      } else celda += c;
      continue;
    }
    if (c === '"') { dentro = true; continue; }
    if (c === sep) { fila.push(celda); celda = ''; continue; }
    if (c === '\n') { fila.push(celda); filas.push(fila); fila = []; celda = ''; continue; }
    celda += c;
  }
  if (celda !== '' || fila.length) { fila.push(celda); filas.push(fila); }

  return filas.filter(f => f.some(x => String(x).trim() !== ''));
}

/** Adivina el separador mirando la primera linea. Coma, punto y coma o tab. */
function separadorDe(texto) {
  const linea = String(texto ?? '').split(/\r?\n/)[0] || '';
  const cuenta = (c) => (linea.match(new RegExp(`\\${c}`, 'g')) || []).length;
  const tab = cuenta('\t'), puntoYComa = cuenta(';'), coma = cuenta(',');
  if (tab >= puntoYComa && tab >= coma && tab > 0) return '\t';
  if (puntoYComa > coma) return ';';
  return ',';
}

/**
 * Encuentra en que fila estan los encabezados.
 *
 * Los catalogos de proveedor casi nunca empiezan en A1: traen el logo, la
 * fecha, «LISTA DE PRECIOS MARZO» y dos filas vacias. Se busca la primera
 * fila con al menos dos celdas de texto no numerico y que tenga por debajo
 * filas con datos.
 */
function encontrarEncabezados(matriz) {
  const limite = Math.min(matriz.length, 20);
  for (let i = 0; i < limite; i++) {
    const fila = matriz[i] || [];
    const textos = fila.filter(c => String(c ?? '').trim() !== '' && isNaN(Number(c)));
    if (textos.length >= 2 && matriz.length > i + 1) return i;
  }
  return 0;
}

/** Convierte una matriz en {encabezados, filas} desde la fila de cabecera. */
function desdeMatriz(matriz) {
  if (!matriz.length) return { encabezados: [], filas: [], filaEncabezado: 0 };
  const iCab = encontrarEncabezados(matriz);
  const encabezados = (matriz[iCab] || []).map(c => String(c ?? '').trim());
  const filas = [];
  for (let i = iCab + 1; i < matriz.length && filas.length < TOPE_FILAS; i++) {
    const cruda = matriz[i] || [];
    if (!cruda.some(c => String(c ?? '').trim() !== '')) continue;
    filas.push({ fila: i + 1, celdas: encabezados.map((_, j) => cruda[j] ?? '') });
  }
  return { encabezados, filas, filaEncabezado: iCab + 1 };
}

/* El espacio de nombres principal de una hoja de calculo OOXML. */
const NS_HOJA = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

/**
 * ARREGLAR LO QUE EXCELJS NO SABE LEER, SIN TOCAR LOS DATOS.
 *
 * Dos cosas distintas, las dos de archivos VALIDOS que Excel abre sin
 * quejarse, y las dos vistas en QA con el mismo catalogo de abarrotes:
 *
 * 1. PREFIJO DE ESPACIO DE NOMBRES.
 *    ExcelJS construye el modelo del libro dentro de `case 'workbook'` en
 *    `WorkbookXform.parseClose`. Si el XML escribe `<x:workbook xmlns:x=...>`
 *    -OOXML valido, y lo que producen varios ERP y exportadores- el elemento
 *    se llama `x:workbook`, ese caso no entra nunca, el modelo se queda sin
 *    asignar y revienta con «Cannot read properties of undefined (reading
 *    'sheets')».
 *
 * 2. RUTA ABSOLUTA EN UNA RELACION.
 *    ExcelJS guarda cada tabla con la clave `../tables/tableN.xml`
 *    (`xlsx.js:166`) y despues la busca con `options.tables[rel.Target]`
 *    (`worksheet-xform.js:522`). Un archivo cuyo `Target` sea
 *    `/xl/tables/table1.xml` -absoluto, igual de valido segun OPC- no casa
 *    con esa clave, la busqueda devuelve `undefined`, y `worksheet.js:920`
 *    hace `table.name` sobre ese `undefined`.
 *
 * Se normaliza el prefijo y se pasa la ruta absoluta a la forma relativa que
 * ExcelJS espera. Solo el prefijo del espacio de nombres de hoja de calculo:
 * `r:` (relaciones) se conserva, porque quitarlo romperia los enlaces entre
 * partes, que es peor que no leer el archivo.
 */
async function normalizarLibro(buffer) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buffer);
  let hubo = false;

  for (const entrada of Object.values(zip.files)) {
    if (entrada.dir) continue;
    const nombre = entrada.name.replace(/^\//, '');

    /* --- las relaciones: ruta absoluta -> relativa A SU PROPIA CARPETA ---
       Y «su propia carpeta» importa. `xl/_rels/workbook.xml.rels` describe
       partes desde `xl/`, asi que `/xl/worksheets/sheet1.xml` es
       `worksheets/sheet1.xml`; pero `xl/worksheets/_rels/sheet1.xml.rels`
       describe desde `xl/worksheets/`, asi que la misma clase de ruta lleva
       `../` delante. Aplicar una sola forma a las dos deja el libro sin
       hojas -se probo, y cargaba vacio-. */
    if (/\.rels$/.test(nombre)) {
      const rels = await entrada.async('string');
      /* De `xl/_rels/x.rels` sale `xl/`; de `xl/worksheets/_rels/x.rels`,
         `xl/worksheets/`. */
      const base = nombre.replace(/_rels\/[^/]+$/, '');
      const arreglado = rels.replace(/Target="\/([^"]+)"/g, (todo, destino) => {
        if (!destino.startsWith(base)) return todo;   // no sabemos: se deja
        return `Target="${destino.slice(base.length)}"`;
      }).replace(/Target="\/xl\/([^"]+)"/g, (todo, resto) => {
        /* Lo que quedo fuera de la carpeta base: se sube un nivel. */
        return base.startsWith('xl/') && base !== 'xl/' ? `Target="../${resto}"` : todo;
      });
      if (arreglado !== rels) { zip.file(nombre, arreglado); hubo = true; }
      continue;
    }

    /* --- el XML de la hoja de calculo: fuera el prefijo --- */
    if (!/^xl\/.*\.xml$/.test(nombre)) continue;
    const xml = await entrada.async('string');
    const m = xml.match(new RegExp(`xmlns:([A-Za-z0-9_.-]+)\\s*=\\s*"${NS_HOJA}"`));
    if (!m) continue;
    const pre = m[1];

    zip.file(nombre, xml
      .replace(new RegExp(`xmlns:${pre}\\s*=\\s*"${NS_HOJA}"`, 'g'), `xmlns="${NS_HOJA}"`)
      .replace(new RegExp(`<${pre}:`, 'g'), '<')
      .replace(new RegExp(`</${pre}:`, 'g'), '</'));
    hubo = true;
  }

  return hubo ? zip.generateAsync({ type: 'nodebuffer' }) : null;
}

/**
 * QUITAR EL ADORNO Y QUEDARSE CON LOS DATOS.
 *
 * Ultimo recurso. Una tabla de Excel -«dar formato como tabla»-, un dibujo o
 * un comentario son presentacion: las celdas viven en la hoja y se leen
 * igual sin ellos. Si ExcelJS sigue sin poder montar el libro por culpa de
 * una de esas partes, se tiran y se lee lo que importa.
 *
 * Es mejor importar el catalogo sin saber que tenia formato de tabla que
 * decirle al cliente que su archivo no se puede leer.
 */
async function quitarAdornos(buffer) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buffer);

  const sobra = (n) => /^xl\/(tables|drawings|comments|charts)\//.test(n);

  for (const nombre of Object.keys(zip.files)) {
    if (sobra(nombre.replace(/^\//, ''))) zip.remove(nombre);
  }

  /* Y la referencia desde la hoja, que sin su parte apuntaria a la nada. */
  for (const entrada of Object.values(zip.files)) {
    if (entrada.dir) continue;
    const nombre = entrada.name.replace(/^\//, '');
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(nombre)) continue;
    const xml = await entrada.async('string');
    zip.file(nombre, xml
      .replace(/<(\w+:)?tableParts[\s\S]*?<\/(\w+:)?tableParts>/g, '')
      .replace(/<(\w+:)?tableParts[^>]*\/>/g, '')
      .replace(/<(\w+:)?drawing[^>]*\/>/g, '')
      .replace(/<(\w+:)?legacyDrawing[^>]*\/>/g, ''));
  }

  return zip.generateAsync({ type: 'nodebuffer' });
}

/** Lee un XLSX. Devuelve TODAS las hojas con datos, no solo la primera. */
/** Lee un XLSX. Devuelve TODAS las hojas con datos, no solo la primera. */
async function leerExcel(ruta) {
  const fs = require('node:fs');
  const buffer = fs.readFileSync(ruta);
  /* TRES INTENTOS, de menos a mas invasivo. El primero es el normal y es el
     que corre siempre que el archivo no tiene rarezas; los otros dos solo
     existen porque un archivo valido no puede acabar en «no se puede leer». */
  const wb = new ExcelJS.Workbook();
  const intentos = [
    async () => buffer,
    async () => normalizarLibro(buffer),
    async () => quitarAdornos((await normalizarLibro(buffer)) || buffer),
  ];

  let primerError = null;
  for (const preparar of intentos) {
    let datos;
    try { datos = await preparar(); } catch { continue; }
    if (!datos) continue;
    try {
      await wb.xlsx.load(datos);
      primerError = null;
      break;
    } catch (e) {
      /* Se guarda el error del PRIMER intento: el de los arreglos habla de
         cosas que el archivo no tiene y despista a quien lea la bitacora. */
      if (!primerError) primerError = e;
    }
  }
  if (primerError) throw primerError;

  const hojas = [];
  let metadata = null;

  wb.eachSheet((ws) => {
    /* La hoja de metadata de nuestras propias plantillas: se lee y se
       esconde, el usuario no tiene por que verla. */
    if (ws.name === '_wybix') {
      try {
        const m = {};
        ws.eachRow((row) => {
          const k = String(row.getCell(1).value ?? '').trim();
          const v = row.getCell(2).value;
          if (k) m[k] = v && typeof v === 'object' && 'result' in v ? v.result : v;
        });
        metadata = m;
      } catch { /* una plantilla vieja o tocada a mano: se ignora */ }
      return;
    }
    if (ws.state === 'veryHidden' || ws.state === 'hidden') return;

    /* Las hojas de acompañamiento de nuestras plantillas NO son datos. Los
       ejemplos existen para que una plantilla vacia no intimide, y la unica
       forma de que no acaben importados como productos es que el lector no
       los mire nunca. Por nombre, y no por posicion: alguien reordena las
       hojas y sigue funcionando. */
    if (HOJAS_QUE_NO_SON_DATOS.has(ws.name.trim().toLowerCase())) return;

    const matriz = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const celdas = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        celdas[col - 1] = valorDeCelda(cell);
      });
      matriz.push(celdas);
    });
    if (matriz.length) hojas.push({ nombre: ws.name, ...desdeMatriz(matriz) });
  });

  return { hojas, metadata };
}

/** El valor util de una celda: sin formulas, sin objetos, sin hipervinculos. */
function valorDeCelda(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return v.result ?? '';          // formula
    if ('text' in v) return v.text ?? '';              // hipervinculo / rich text
    if ('richText' in v) return v.richText.map(t => t.text).join('');
    return '';
  }
  return v;
}

/** Lee un CSV desde disco. */
async function leerCsv(ruta) {
  const fs = require('node:fs');
  let texto = fs.readFileSync(ruta, 'utf8');
  if (texto.charCodeAt(0) === 0xFEFF) texto = texto.slice(1);   // BOM de Excel
  const matriz = analizarTexto(texto, separadorDe(texto));
  return { hojas: [{ nombre: 'CSV', ...desdeMatriz(matriz) }], metadata: null };
}

/** Lo que Excel o Sheets dejan en el portapapeles al copiar filas. */
function leerPegado(texto) {
  const matriz = analizarTexto(texto, separadorDe(texto));
  return { hojas: [{ nombre: 'Pegado', ...desdeMatriz(matriz) }], metadata: null };
}

/** Punto de entrada unico para un archivo del disco. */
async function leerArchivo(ruta) {
  const bajo = String(ruta).toLowerCase();
  if (bajo.endsWith('.csv') || bajo.endsWith('.txt')) return leerCsv(ruta);
  if (bajo.endsWith('.xlsx') || bajo.endsWith('.xlsm')) return leerExcel(ruta);
  throw new Error('Solo puedo leer archivos .xlsx y .csv.');
}

module.exports = { leerArchivo, leerExcel, leerCsv, leerPegado,
                   normalizarLibro, quitarAdornos,
                   analizarTexto, separadorDe, desdeMatriz, encontrarEncabezados,
                   TOPE_FILAS, HOJAS_QUE_NO_SON_DATOS };
