/**
 * DE RENGLONES A COMPRA: el intérprete de tickets y notas de proveedor.
 *
 *   const doc = interpretar(renglones);   // renglones de ocr/motor.cjs
 *
 * Lo que sale:
 *   proveedor, rfc, folio, fecha
 *   lineas[]   descripcion, cantidad, unidad, factor (piezas por presentación),
 *              precio_unitario, importe, tasa_iva (0 | 0.16 | null), granel
 *   totales    subtotal, descuento, ieps, iva, envases, total
 *   cuadre     si las cuentas cierran y, si no, por cuánto
 *   avisos[]   lo que quien revisa tiene que mirar
 *
 * Lo que sabe de los tickets mexicanos (de la investigación):
 *   · El renglón viene en UNA línea («3 CJ REF COLA 600ML CJ24 312.00 936.00»)
 *     o en DOS (la descripción arriba y «3 CJ x 312.00  936.00 A» abajo).
 *   · Presentación en la descripción: CJ24, CJ 24, C/24, PAQ12, PQ6, X12,
 *     12PZ, 24/355ML, DISP 10. La unidad: PZA, CJ, PAQ, KG, GR, LT, BOL, BOT...
 *   · Marca de impuesto al final del importe: una letra (A, B, E, G, T, *).
 *     Qué letra es 16% cambia de proveedor a proveedor: se deduce de las
 *     cuentas (la que cuadra con el IVA del ticket).
 *   · IVA 0% en alimentos básicos y 16% en lo demás; IEPS 8% en botanas de
 *     alta densidad calórica y por litro en bebidas azucaradas ($3.0818/L
 *     en 2026). El IEPS de una compra es COSTO para la tienda.
 *   · Notas de distribuidor: descuento (antes de impuestos) y depósito de
 *     envase retornable, que no es mercancía.
 */

const UNIDADES = {
  PZA: 'pza', P2A: 'pza', PZ: 'pza', PZAS: 'pza', PIEZA: 'pza', PIEZAS: 'pza', UN: 'pza', UND: 'pza', U: 'pza', H87: 'pza',
  CJ: 'caja', CJA: 'caja', CAJA: 'caja', CAJAS: 'caja', CS: 'caja', XBX: 'caja',
  PAQ: 'paquete', PQ: 'paquete', PQT: 'paquete', PAQUETE: 'paquete', PK: 'paquete', XPK: 'paquete',
  KG: 'kg', KGS: 'kg', KILO: 'kg', KGM: 'kg', GR: 'g', GRS: 'g', G: 'g', GRM: 'g',
  LT: 'l', LTS: 'l', L: 'l', LTR: 'l', ML: 'ml',
  BOL: 'bolsa', BOLSA: 'bolsa', BOT: 'botella', FCO: 'frasco', LATA: 'lata',
  DISP: 'display', EXH: 'exhibidor', TIRA: 'tira', BLIS: 'blister', SOB: 'sobre',
  COSTAL: 'costal', BULTO: 'bulto', SACO: 'saco', REJA: 'reja', ROLLO: 'rollo', PAR: 'par', DOC: 'docena', DOCENA: 'docena',
};
const DE_PESO = new Set(['kg', 'g', 'l', 'ml']);
const LETRAS_IMPUESTO = /^[ABEGTX*]$/;

/** Corrige lo que el OCR confunde DENTRO de un número: O→0, l/I→1, S→5, B→8, coma de miles. */
function aNumero(t) {
  if (t == null) return null;
  let s = String(t).trim().replace(/^\$/, '').replace(/[Oo]/g, '0').replace(/[lI|]/g, '1').replace(/S/g, '5');
  const neg = /^-|\($/.test(s) || /^\(.*\)$/.test(s);
  s = s.replace(/[()\-\s]/g, '');
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  /* «1.934.80»: el OCR leyó la coma de miles como punto. */
  else if (/^\d{1,3}(\.\d{3})+\.\d{2}$/.test(s)) s = s.replace(/\.(?=\d{3}\.)/g, '');
  else if (/^\d+,\d{2}$/.test(s)) s = s.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}
const dinero = (t) => { const n = aNumero(t); return n != null && /[.,]\d{2}\)?$/.test(String(t).trim()) ? n : null; };
const r2 = (n) => Math.round(n * 100) / 100;
const r4 = (n) => Math.round(n * 10000) / 10000;
const bits = (n) => { let c = 0; for (; n; n >>= 1) c += n & 1; return c; };

/* ------------------------------------------------------------- encabezado */

const RFC = /\b([A-ZÑ&]{3,4})[\s-]?(\d{6})[\s-]?([A-Z0-9]{3})\b/;
const FECHA = /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/;

function encabezado(rs) {
  const out = { proveedor: null, rfc: null, folio: null, fecha: null };
  for (let i = 0; i < Math.min(rs.length, 20); i++) {
    const t = rs[i].texto.toUpperCase().replace(/\s{2,}/g, ' ');
    if (!out.rfc) {
      const m = t.replace(/^R[FE][CG]\s*:?\s*/, '').match(RFC);
      if (m && /R[FE][CG]|^[A-Z&Ñ]{3,4}\d{6}/.test(t)) out.rfc = m[1] + m[2] + m[3];
    }
    if (!out.fecha) {
      const m = t.match(FECHA);
      if (m) {
        const a = m[3].length === 2 ? '20' + m[3] : m[3];
        out.fecha = `${a}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      }
    }
    if (!out.folio) {
      const m = t.match(/\b(?:FOLIO|REF(?=\s*:)|TICKET|NOTA(?: DE)? (?:REMISION|VENTA)|NOT DE REMISION|REMISION|FACTURA|TRANSACCION|TRX|NO\.?)\s*:?\s*#?\s*([A-Z0-9][A-Z0-9 -]{1,20})$/);
      if (m && (m[1].match(/\d/g) || []).length >= 4) out.folio = m[1].trim();
    }
  }
  /* El proveedor es lo primero que no es RFC, fecha ni folio. */
  const primero = rs.slice(0, 4).find(r => /[A-Z]{3}/.test(r.texto.toUpperCase()) && !/R[FE][CG]|FECHA|TICKET|FOLIO|REMISION|\d{2}\/\d{2}/.test(r.texto.toUpperCase()));
  if (primero) out.proveedor = primero.texto.replace(/\s{2,}/g, ' ').replace(/\bDIS TRIBUIDORA\b/, 'DISTRIBUIDORA').trim();
  const razon = rs.slice(0, 8).find(r => /\bS\.?\s?A\.?\s*(P\.?\s?I\.?\s*)?(de|DE)\s*C\.?\s?[VU]\b|\bS\.?\s?DE\s?R\.?\s?L\b|\bS\.?\s?A\.?\s?S\b/i.test(r.texto));
  if (razon) out.proveedor = razon.texto.replace(/\s{2,}/g, ' ').replace(/^(.*?\b(C\.?\s?[VU]\.?|R\.?\s?L\.?(\s*DE\s*C\.?\s?V\.?)?))\b.*$/i, '$1').replace(/[\s,.(]+$/, '').trim();
  /* Las notas de las distribuidoras grandes casi nunca traen el nombre
     arriba (o el rollo lo corta): lo delatan sus productos y su formato. */
  const marca = marcaDe(rs);
  if (marca && (!out.rfc || !primero || ENCABEZADO_GENERICO.test(out.proveedor || ''))) {
    out.proveedor = marca; out.proveedor_por = 'marca';
  }
  return out;
}

/** Títulos de sección que no son el nombre del proveedor. */
const ENCABEZADO_GENERICO = /^[\s*]*(VENTA|NOTA DE VENTA|COMBOS|DESCRIPCION|PRODUCTO|TICKET|ESTIMADO|PAGAR|REMISION)\b|\*{3}/i;

/**
 * Distribuidoras directas a tienda: cada una se reconoce por lo que vende y
 * por cómo imprime. Hacen falta DOS señales para no confundir un mayorista
 * que también vende sus productos.
 */
const MARCAS = [
  ['BIMBO', [/\bBIMBO\b/, /CAMBIO\s+F[IÍ]SICO/, /\b75010304\d{5}\b/, /\b7500810\d{6}\b/, /\b(CONCHA|MANTECADA|PANQU|NITO|GANSITO|PINGUINO|BIGOT|TWIN|SUAVICREMAS|DALMATA|PACHON|TIRITAS?|MARINELA)/]],
  ['SABRITAS', [/\bSABRITAS\b/, /\b(DORITOS|RUFFLES|CHEETOS|TOSTITOS|CRUJITOS|PAKETAXO|FRITOS|SANISSIMO)\b/, /\bGRX\d+X\d\b/, /\b3000\d{5}\b/]],
  ['PEPSI', [/\bPEPS[I1T]\b/, /\b(EPURA|GATORADE|SQUIRT|MIRINDA|7\s?UP|MANZANITA|STING|GEPP)\b/, /\bCOMBOS\b/, /CANTIDAD DE CAJAS/]],
  ['COCA-COLA', [/COCA[\s-]?COLA/, /\bNR(P|V|L|PET)\s?\d{1,2}\b/, /\b(FANTA|SPRITE|FRESCA|DELAWARE|CIEL|FUZE|POWERADE|FRESCA|SIDRAL|TOPO CHICO)\b/, /CAJ\s*\/\s*BOT|CA[IJ]\/BOT/]],
  ['BARCEL', [/\bBARCEL\b/, /\b(TAKIS|RUNNERS|CHIPS|HOT NUTS|WAPAS|PAPATINAS)\b/]],
  ['LALA', [/\bLALA\b/, /\b(NUTRI|YOMI|BIO\s?BALANCE|DESLACTOSADA)\b/]],
];
function marcaDe(rs) {
  const todo = rs.map(r => r.texto.toUpperCase()).join('\n');
  let mejor = null;
  for (const [nombre, senas] of MARCAS) {
    const n = senas.filter(re => re.test(todo)).length;
    if (n >= 2 && (!mejor || n > mejor.n)) mejor = { nombre, n };
  }
  return mejor?.nombre ?? null;
}

/* ---------------------------------------------------------------- totales */

const TOTALES = [
  /* «SUB T. REMPLAZO» (Bimbo): lo que se repuso en el cambio físico, sin cargo. */
  ['remplazo', /\bR[E]{1,2}MPLAZO\b/],
  /* «Total descuentos» resume los de arriba: reemplaza, no suma. */
  ['descuento_total', /\bTOTAL\s+DESCUENTOS?\b/],
  ['subtotal', /\bSUB\s*[.\-]?\s*T(OTAL)?\b|\bIMPORT[EA]\s+DE\s+VENTA\b/],
  ['descuento', /\b(DESCUENTOS?|DESC\.?|BONIFICACION|REBAJA|AHORRO)\b/],
  ['ieps', /\bI\.?E\.?P\.?S\b/],
  ['iva', /\bI\.?V\.?A\b|\b\d{1,2}\s*%\s*IMP\b|\bIMPUESTOS?\b/],
  ['envases', /\b(ENVASE|ENVASES|DEPOSITO|DEP\.?\s*ENV|CASCO|CASCOS)\b/],
  ['total', /\b(TOTAL|IMPORTE TOTAL|TOTAL A PAGAR|NETO)\b/],
];

function esTotal(t) {
  const u = t.toUpperCase();
  /* «PIEZAS EN VENTA», «Cantidad de cajas»: conteos, no dinero. */
  if (/\bPIEZAS\b|\bCANTIDAD DE\b/.test(u)) return null;
  /* Los títulos de la tabla («NS CLAVE CANT P.UNIT SUBTOTAL», «Descripción
     Caj/Bot Precio Total») nombran columnas, no son el total. */
  const columnas = (u.match(/\b(CANT|CLAVE|P\.?\s?UNIT|PRECIO|PRECI|DESCRIPCI\w*|IMP|NS|CODIGO|COD|CA[IJ]\/BOT)\b/g) || []).length;
  if (columnas >= 2) return null;
  for (const [k, re] of TOTALES) if (re.test(u) && !(k === 'total' && /SUB\s*[.\-]?\s*T/.test(u))) return k;
  return null;
}

/* ------------------------------------------------------- presentación */

/**
 * Cuántas piezas trae la presentación, leído de la descripción:
 * «REF COLA 600ML CJ24» → 24, «PAPEL HIG 4R PAQ12» → 12, «C/24», «X12»,
 * «24/355ML», «DISP 10», «6PZ».
 */
function factorDe(desc, unidad) {
  const u = desc.toUpperCase();
  const pats = [
    /\b(?:CJ|CJA|CAJA|C\/|PAQ|PQ|PQT|PK|DISP|EXH|BOL|BULTO|COSTAL|REJA|X)\s*\/?\s*(\d{1,3})\b(?!\s*(?:ML|L|LT|G|GR|KG|R|M|CM))/,
    /\b(\d{1,3})\s*\/\s*\d+(?:\.\d+)?\s*(?:ML|L|LT|G|GR|KG)\b/,
    /\b(\d{1,3})\s*(?:PZ|PZA|PZAS|PIEZAS|UN|LATAS|BOTELLAS)\b/,
    /* Refresqueras: «Pet 8», «Lata 6 Pack», «6 Pack». */
    /\bPET\s*(\d{1,2})\b/,
    /\b(\d{1,2})\s*PACK\b/, /\bPACK\s*(\d{1,2})\b/,
    /\b(\d{1,2})\s*PK\b/, /\bPK\s*(\d{1,2})\b/,
    /* Claves de embotelladora: NRP12 (no retornable plástico), NRV 24 (vidrio),
       NRL12 (lata), NRPET8; NR6P. */
    /NR(?:PET|P|V|L|E)\s*(\d{1,2})P?\b/,
    /NR(\d{1,2})P\b/,
  ];
  for (const re of pats) {
    const m = u.match(re);
    if (m) { const n = Number(m[1]); if (n >= 2 && n <= 500) return n; }
  }
  return unidad === 'docena' ? 12 : 1;
}

/** El contenido de UNA pieza (600ML, 1KG, 45G), para el IEPS por litro y la ficha. */
function contenidoDe(desc) {
  const m = desc.toUpperCase().match(/\b(\d+(?:\.\d+)?)\s*(ML|L|LT|LTS|G|GR|KG)\b/);
  if (!m) return null;
  const v = Number(m[1]), u = m[2];
  if (u === 'ML') return { cantidad: v, unidad: 'ml', litros: v / 1000 };
  if (/^L/.test(u)) return { cantidad: v, unidad: 'l', litros: v };
  if (u === 'KG') return { cantidad: v, unidad: 'kg' };
  return { cantidad: v, unidad: 'g' };
}

/* ------------------------------------------------------------- renglones */

/** Separa un renglón en números de dinero, cantidades, unidad, marca y texto. */
function tokens(texto) {
  const crudos = texto.replace(/\s+[xX*]\s+/g, ' x ').split(/\s+/).filter(Boolean);
  const out = [];
  for (const t of crudos) {
    const T = t.toUpperCase().replace(/[.:]$/, '');
    if (t === 'x' || t === 'X' || t === '@') { out.push({ tipo: 'por' }); continue; }
    /* «8.0%»: la tasa de IEPS del renglón (Bimbo la imprime en la columna IMP.). */
    if (/^\d{1,2}(\.\d{1,2})?%$/.test(t)) { out.push({ tipo: 'pct', v: Number(t.slice(0, -1)) / 100, t }); continue; }
    /* Código de barras o clave del proveedor: 6 a 14 dígitos seguidos. */
    if (/^\d{6,14}$/.test(t)) { out.push({ tipo: 'codigo', v: t, t }); continue; }
    /* «2/0» (Caj/Bot): 2 cajas y 0 botellas sueltas. */
    { const m = t.match(/^(\d{1,3})\/(\d{1,2})$/); if (m) { out.push({ tipo: 'num', v: Number(m[1]), sueltas: Number(m[2]), t }); continue; } }
    if (dinero(t) != null) { out.push({ tipo: 'dinero', v: dinero(t), t }); continue; }
    if (/^\d+(\.\d{1,3})?$/.test(t)) { out.push({ tipo: 'num', v: Number(t), t }); continue; }
    if (UNIDADES[T]) { out.push({ tipo: 'unidad', v: UNIDADES[T], t }); continue; }
    if (LETRAS_IMPUESTO.test(T)) { out.push({ tipo: 'marca', v: T, t }); continue; }
    out.push({ tipo: 'texto', t });
  }
  return out;
}

/**
 * Lee la parte numérica de un renglón: cantidad, unidad, precio, importe y
 * marca de impuesto. Devuelve null si no parece un renglón de producto.
 */
function partesNumericas(tk) {
  const dineros = tk.filter(x => x.tipo === 'dinero');
  if (!dineros.length) return null;
  {
    const iUlt = tk.lastIndexOf(dineros[dineros.length - 1]);
    const despues = tk.slice(iUlt + 1).filter(x => x.tipo === 'texto' || x.tipo === 'unidad');
    if (dineros.length === 1 && despues.length >= 2) return null;
  }
  const marcaTk = tk[tk.length - 1]?.tipo === 'marca' ? tk[tk.length - 1] : null;
  const importe = dineros[dineros.length - 1].v;
  let precio = dineros.length >= 2 ? dineros[dineros.length - 2].v : null;
  /* Cantidad: el primer número (o dinero, si es un peso como 1.35) antes del
     precio. En «3 CJ ...» va al inicio; en «2 x 412.80» antes de la «x». */
  let cantidad = null, unidad = null;
  const iPrecio = precio != null ? tk.indexOf(dineros[dineros.length - 2]) : tk.indexOf(dineros[dineros.length - 1]);
  for (let i = 0; i < iPrecio; i++) {
    const x = tk[i];
    if (cantidad == null && (x.tipo === 'num' || x.tipo === 'dinero')) { cantidad = x.v; continue; }
    if (x.tipo === 'unidad' && unidad == null && cantidad != null && i <= tk.findIndex(y => y === x)) unidad = x.v;
    if (x.tipo === 'texto' && cantidad == null) break;
  }
  if (unidad == null) { const u = tk.find((x, i) => x.tipo === 'unidad' && i < iPrecio); if (u) unidad = u.v; }
  const leida = cantidad != null;
  if (cantidad == null && precio != null) cantidad = r2(importe / precio);
  if (cantidad == null || !Number.isFinite(cantidad)) cantidad = 1;
  if (precio == null || !Number.isFinite(precio)) precio = r2(importe / (cantidad || 1));
  /* Importe 0 al final (columna de IEPS o IVA vacía): la cantidad que salió de
     dividir no vale; cuadrar() busca la lectura buena. */
  if (!(cantidad > 0) && !leida) cantidad = 1;
  const base = { cantidad, unidad, precio, importe, marca: marcaTk?.v ?? null };
  /* Si las cuentas ya cierran, así se queda. Si no (o es un renglón sin
     cargo, donde 0 × lo que sea da 0), se busca la lectura que cuadre. */
  /* (Solo si la cantidad se LEYÓ: importe ÷ precio siempre «cuadra».) */
  if (leida && importe > 0 && Math.abs(cantidad * precio - importe) <= 0.02) return base;
  const c = cuadrar(tk);
  if (c) return { ...base, ...c };
  /* Nada cuadra (el OCR leyó mal un número): la cantidad es el entero justo
     antes del precio, no el primer número del renglón (que en «52.50 1 48.30»
     es el precio de lista). */
  const iP = tk.lastIndexOf(dineros.length >= 2 ? dineros[dineros.length - 2] : dineros[0]);
  const antes = tk[iP - 1];
  if (dineros.length >= 2 && antes?.tipo === 'num' && Number.isInteger(antes.v) && antes.v > 0 && antes.v < 1000) return { ...base, cantidad: antes.v };
  return base;
}

/** «$15.85» que el OCR leyó «815.85» o «S15.85»: el «$» pegado como dígito o letra. */
function sinPesoPegado(x) {
  const m = String(x.t).match(/^[8S§s$](\d+[.,]\d{2})$/);
  return m ? Number(m[1].replace(',', '.')) : null;
}

/**
 * La lectura de un renglón que hace cuadrar cantidad × precio = importe.
 *
 * El importe es el último dinero; el precio, uno de los dos números antes; la
 * cantidad, el número entero antes del precio. Se prueba también cada
 * número sin el «$» que el OCR pegó como 8 o S. Entre varias que cuadran
 * gana la más «derecha» (sin saltarse números) y con menos correcciones.
 * Si ninguna cuadra exacta pero una queda a menos del 2 %, se toma esa con
 * el precio que dan importe ÷ cantidad (el importe es lo que se paga).
 */
function cuadrar(tk) {
  const ns = tk.map((x, i) => ({ ...x, i })).filter(x => x.tipo === 'num' || x.tipo === 'dinero');
  /* El importe es el último dinero… o uno de los dos anteriores: en una
     factura impresa siguen columnas de IEPS e IVA («141.93  0.00  0.00»). */
  const ks = ns.map((x, i) => i).filter(i => ns[i].tipo === 'dinero').slice(-3).reverse();
  if (!ks.length) return null;
  const vars = (x) => {
    const out = [[x.v, 0]];
    const s = sinPesoPegado(x);
    if (s != null && s !== x.v) out.push([s, 1]);
    /* «$066.82»: un 6, 8 o 9 al inicio que el OCR leyó como 0. */
    const m = String(x.t).match(/^\$?0(\d+[.,]\d{2})$/);
    if (m) for (const d of ['6', '8', '9']) out.push([Number(d + m[1].replace(',', '.')), 1]);
    return out;
  };
  let mejor = null;
  const probar = (cand) => {
    /* 0 × 0 = 0 cuadra siempre: un renglón sin cargo gana solo si no hay otra lectura. */
    if (cand.importe === 0) cand.puntos += 2;
    cand.puntos += cola;
    if (!mejor || cand.puntos < mejor.puntos) mejor = cand;
  };
  let cola = 0;
  for (const [n, k] of ks.entries()) for (const [t, ct] of vars(ns[k])) {
    cola = n * 1.5;
    for (let j = k - 1; j >= Math.max(0, k - 4); j--) {
      if (ns[j].tipo !== 'dinero') continue;
      for (const [p, cp] of vars(ns[j])) {
        let hubo = false;
        for (let i = j - 1; i >= Math.max(0, j - 2); i--) {
          const q = ns[i].v;
          if (!(q >= 0) || q > 9999 || (ns[i].tipo === 'dinero' && !Number.isInteger(q) && q > 50)) continue;
          const saltos = (k - j - 1) + (j - i - 1) + ct + cp + (Number.isInteger(q) ? 0 : 0.5);
          const d = Math.abs(q * p - t);
          if (d <= 0.02) {
            const medio = j - i === 2 ? ns[i + 1] : null;
            const piezas = medio && medio.tipo === 'num' && Number.isInteger(medio.v) && q > 0 && medio.v > q && medio.v % q === 0 ? medio.v / q : null;
            probar({ cantidad: q, precio: p, importe: t, puntos: piezas ? saltos - 1 : saltos, ...(piezas ? { piezas } : {}) }); hubo = true;
          }
          /* «2/0  102.00  0.00  $204.00»: precio, descuento del renglón, importe. */
          else if (k - j === 2 && t > 0 && ns[k - 1].tipo === 'dinero'
                   && vars(ns[k - 1]).some(([dv]) => dv < q * p * 0.5 && Math.abs(q * p - dv - t) <= 0.02)) {
            const [[dv, cd]] = vars(ns[k - 1]).filter(([v]) => v < q * p * 0.5 && Math.abs(q * p - v - t) <= 0.02);
            probar({ cantidad: q, precio: p, importe: r2(q * p), descuento: dv, puntos: saltos - 1 + cd }); hubo = true;
          }
          else if (t > 0 && q > 0 && d / t <= 0.02) probar({ cantidad: q, precio: r2(t / q), importe: t, puntos: saltos + 3, aproximado: true });
        }
        /* Sin cantidad legible («:» o «y» en lugar de un 1): la dan importe ÷ precio. */
        if (!hubo && p > 0) {
          const q = t / p;
          if (q >= 1 && Math.abs(q - Math.round(q)) < 0.01) probar({ cantidad: Math.round(q), precio: p, importe: t, puntos: (k - j - 1) + ct + cp + 1 });
        }
      }
    }
  }
  if (!mejor) return null;
  const { puntos, ...r } = mejor;
  return r;
}

/**
 * Lo que el OCR rompe en los números antes de separarlos:
 *   «52 50»   un punto decimal que la foto perdió (pieza «52 50» → 52.50)
 *   «196_00»  el punto leído como guion bajo
 *   «8.0%13.83» la tasa pegada al precio
 *   «212  50  212  60» al final de un renglón con dinero: precio y total
 *            partidos en dos piezas cada uno
 */
function normalizarFila(texto) {
  let piezas = texto.replace(/(\d%)(?=\S)/g, '$1  ').split(/\s{2,}/).map(p => p.trim()).filter(Boolean);
  piezas = piezas.map(p => p.replace(/^(\$?\d{1,5}) (\d{2})$/, '$1.$2').replace(/^(\$?\d{1,5})_(\d{2})$/, '$1.$2'));
  const esDinero = (p) => /^\$?\d+[.,]\d{2}$/.test(p);
  if (piezas.some(esDinero) || piezas.filter(p => /^\d{1,5}$/.test(p)).length >= 4) {
    const out = [];
    for (let i = piezas.length - 1; i >= 0; i--) {
      if (/^\d{2}$/.test(piezas[i]) && i > 0 && /^\d{1,5}$/.test(piezas[i - 1]) && out.length < 4
          && out.every(o => esDinero(o) || /^[A-Z]$/i.test(o))) {
        out.unshift(`${piezas[i - 1]}.${piezas[i]}`); i--; continue;
      }
      out.unshift(...piezas.slice(0, i + 1)); break;
    }
    piezas = out;
  }
  return piezas.join('  ');
}

/** Limpia la descripción: viñetas, «M1» por «ML», espacios. */
function limpiarDescripcion(d) {
  return d.replace(/^[*×•·]\s*/, '').replace(/\s+\d{1,2}\s*-\s*S[IÍ]\s+OBJETO\s+DE\s+IMPUESTO.*$/i, '').replace(/\s+0\d\s*$/, '').replace(/(\d)\s*M[1lI]\b/g, '$1 ML').replace(/\bL\s+ts\b/gi, 'Lts').replace(/\s{2,}/g, ' ').trim();
}

/** La descripción: el texto del renglón sin la cantidad, la unidad, los precios ni la marca. */
function descripcionDe(tk, partes) {
  const sinColas = [...tk];
  while (sinColas.length && ['dinero', 'marca', 'por'].includes(sinColas[sinColas.length - 1].tipo)) sinColas.pop();
  let i = 0;
  if (partes && sinColas[0] && ['num', 'dinero'].includes(sinColas[0].tipo)) i = 1;
  if (partes && sinColas[i]?.tipo === 'unidad') i++;
  return sinColas.slice(i).filter(x => x.tipo !== 'por').map(x => x.t).join(' ').replace(/\s+[xX]$/, '').trim();
}

/** Encabezado de sección de lo que NO es compra: el cambio físico de Bimbo, devoluciones. */
const SECCION_CAMBIO = /\bCAMBIO\s+F[IÍ]SICO\b|\bDEVOLUCI[OÓ]N(ES)?\b|\bCAMBIOS\b/i;
/** Títulos de columnas: no son descripción de nada. */
const TITULOS = /\b(PRODUCTO\s+COD|CANT\s+IMP|DESCRIPCI[OÓ]N\s*$|NS\s+CLAVE|P\.?\s*UNIT|CAJ\/BOT|PRECIO\s+TOTAL)/i;

function lineas(rs) {
  const out = [];
  const cambios = [];
  let pendiente = null;   // descripción en su propio renglón, esperando sus números
  let numeros = null;     // «1 300066168 4»: números sin dinero que siguen en el renglón de abajo
  let pendienteCola = null; // «W  12»: el «12» de «Pet 12» que la foto separó
  let destino = out;
  for (const r of rs) {
    const texto = normalizarFila(r.texto.replace(/\s{2,}/g, '  ').trim());
    if (SECCION_CAMBIO.test(texto) && !/\d+[.,]\d{2}/.test(texto)) { destino = cambios; pendiente = null; numeros = null; continue; }
    if (TITULOS.test(texto) && !/\d+[.,]\d{2}/.test(texto)) continue;
    if (/TRAS[LI]AD|RETENCI[OÓ]N|TASA\s+O\s+CUOTA|TIPO\s+(O\s+)?FACTOR/i.test(texto)) continue;
    /* «5 X $ 8.00» o «0.765 KG @ 128.00» debajo de un renglón: su cantidad y
       precio (Walmart, Bodega Aurrera, Soriana imprimen así la multiplicación). */
    {
      const m = texto.match(/^(\d+(?:[.,]\d{1,3})?)\s*(KG|KGS|PZ|PZA)?\s*[X@*]\s*\$?\s*(\d+[.,]\d{2})$/i);
      const previo = destino[destino.length - 1];
      if (m && previo) {
        const q = Number(m[1].replace(',', '.')), p = Number(m[3].replace(',', '.'));
        if (Math.abs(q * p - previo.importe) <= 0.02 + previo.importe * 0.005) {
          Object.assign(previo, { cantidad: q, precio_unitario: p, granel: !Number.isInteger(q), alternativas: [] });
          if (!Number.isInteger(q) || /KG/i.test(m[2] || '')) previo.unidad = 'kg';
          continue;
        }
      }
    }
    /* «PT REGALO= 0», «SUBTOTAL=»: etiqueta = valor, no un producto. */
    if (/^[*×•\s]*[A-ZÁÉÍÓÚÑ. ]{2,}=(\s|$)/i.test(texto)) { pendiente = null; numeros = null; continue; }
    let tk = tokens(texto);
    let partes = partesNumericas(tk);
    const letras = (s) => s.replace(/[^A-Za-zÁÉÍÓÚÑ]/g, '').length;
    if (!partes) {
      if (letras(texto) >= 3) pendiente = { texto, y: r.y, confianza: r.confianza };
      else if (tk.some(x => x.tipo === 'num' || x.tipo === 'codigo')) {
        numeros = texto;
        const solo = tk.filter(x => x.tipo === 'num');
        pendienteCola = solo.length === 1 && solo[0].v >= 2 && solo[0].v <= 48 && Number.isInteger(solo[0].v) ? solo[0].t : null;
      }
      continue;
    }
    /* Solo ceros y ninguna cantidad («480g MTA BIM  0.00  0.00»): es la
       segunda línea de una descripción con sus columnas vacías, no un renglón. */
    if (partes.importe === 0 && !tk.some(x => x.tipo === 'num') && tk.every(x => x.tipo !== 'dinero' || x.v === 0)) continue;
    let desc = descripcionDe(tk, partes);
    /* Sin las etiquetas de columna («P.Sug», «P.U.», «Tot.», como sea que las lea el OCR). */
    const soloNumeros = letras(desc.replace(/\b(P\.?\s?SUG|P\.?\s?UNIT|TOTAL|PRECIO|IMPORTE|NETO|LISTA)\b\.?/gi, '').replace(/(^|\s)[A-Za-z0-9]{0,2}\.?[A-Za-z]{1,3}\.(?=\s|$)/g, ' ').replace(/(^|\s)P\.\s?[A-Za-z]{1,4}\.?(?=\s|$)/g, ' ')) < 3;
    /* El renglón de números que quedó partido en dos: se une al de abajo. */
    if (soloNumeros && numeros && !pendienteCola) {
      tk = tokens(`${numeros}  ${texto}`);
      partes = partesNumericas(tk);
      desc = descripcionDe(tk, partes);
    }
    numeros = null;
    let descripcion = soloNumeros ? (pendiente?.texto ?? '') : desc;
    /* «24.00 PZA LECHE LALA ENTERA 12-1LT» arriba y sus precios abajo: la
       cantidad y la unidad vienen al inicio de la descripción. */
    if (soloNumeros && pendiente) {
      const m = descripcion.match(/^(\d+(?:[.,]\d{1,3})?)\s+([A-Za-z0-9]{1,6})\.?\s+(.+)$/);
      const q = m ? Number(m[1].replace(',', '.')) : null;
      if (m && UNIDADES[m[2].toUpperCase()] && q > 0 && Math.abs(q * partes.precio - partes.importe) <= 0.05 + partes.importe * 0.005) {
        partes = { ...partes, cantidad: q, unidad: UNIDADES[m[2].toUpperCase()] };
        descripcion = m[3];
      }
    }
    if (!descripcion || !(partes.cantidad > 0)) { pendiente = null; continue; }
    /* Código: el de barras o la clave del proveedor, de la descripción o de los números. */
    let codigo = null;
    const tkDesc = tokens(descripcion);
    /* Si hay varios (clave interna y EAN, como en la factura de Bimbo), gana
       el código de barras: es el que está en el catálogo de la tienda. */
    const ean = (l) => l.find(x => x.tipo === 'codigo' && /^\d{12,14}$/.test(x.v)) || l.find(x => x.tipo === 'codigo' && !/^\d{8}$/.test(x.v));
    for (const x of [...tkDesc, ...tk].filter(y => y.tipo === 'codigo' && /^\d{8}$/.test(y.v))) descripcion = descripcion.replace(x.t, ' ');
    const parte = descripcion.match(/(?:^|\s)(\d{3,5}\.\d{3}\.\d{2,4})(?=\s)/);
    if (parte) { descripcion = descripcion.replace(parte[1], ' '); }
    const enDesc = ean(tkDesc);
    const enNums = ean(tk);
    if (enDesc) {
      codigo = enDesc.v;
      for (const x of tkDesc.filter(y => y.tipo === 'codigo')) descripcion = descripcion.replace(x.t, ' ');
    }
    else if (enNums) codigo = enNums.v;
    else if (parte) codigo = parte[1];
    else {
      /* «4174 Sting Fresa…»: la clave corta del proveedor al inicio de la descripción. */
      const m = soloNumeros && descripcion.match(/^(\d{2,5})\s+(?=[A-Za-z])/);
      if (m) { codigo = m[1]; descripcion = descripcion.slice(m[0].length); }
    }
    /* En una factura en tabla la descripción arrastra las columnas que le
       siguen: «… 9 Pieza», «… CAJA 50202306 02 1 24 203.64 Tasa 16.00 002». */
    if (!soloNumeros) {
      descripcion = descripcion.trim()
        .replace(/\s+(CAJA|PIEZA|PZA|PAQUETE|BOLSA|H87|XBX)\s+\d[\d\s.:,]*(TASA[\s\d.]*)?$/i, '')
        .replace(new RegExp(`\\s+${String(partes.cantidad).replace('.', '\\.')}\\s+(PIEZA|PZA|PZ|P[A-Z0-9]{2,4})?\\s*$`, 'i'), '')
        .replace(/^[A-Z0-9]{3}\s+(?=[A-Z])/, (m) => /^X[B8]X|^XIX/i.test(m) ? '' : m);
    }
    descripcion = descripcion.replace(/(\s+(\$|S|§|\d+([.,]\d{1,3})?))+(\s+[A-Z*])?\s*$/, (m) => /\$|\d[.,]\d{2}/.test(m) ? '' : m);
    descripcion = descripcion.trim()
      .replace(/^(PZA\s+)?H87\s+/i, '')
      .replace(/^HLT\s*-\s*(Hectolitro\s+)?(\d+\s+)?(CJ|C)\s+/i, '')
      .replace(/^(UNIDAD|PIEZA|PZA|SERVICIO)\s+(?=[A-ZÁÉÍÓÚÑ])/i, '');
    descripcion = limpiarDescripcion(descripcion);
    const pct = tk.find(x => x.tipo === 'pct');
    /* «Pet» / «Pack» y el número quedó en el renglón de junto («W  12»). */
    if (soloNumeros && /\b(PET|PACK|CJ|PAQ)$/i.test(descripcion) && pendienteCola) descripcion += ' ' + pendienteCola;
    /* Lecturas posibles del importe si el OCR se equivocó en un dígito: con el
       precio, con el precio de lista (refresqueras: lista, cajas, neto, total)
       o con una sola pieza. Se eligen después, contra el subtotal. */
    const ds = tk.filter(x => x.tipo === 'dinero');
    const lista = ds.length >= 3 ? ds[0].v : null;
    /* «385 ML», «24 G» dentro de la descripción es el contenido, no la unidad de compra. */
    if (partes.unidad && DE_PESO.has(partes.unidad) && Number.isInteger(partes.cantidad) && contenidoDe(descripcion)
        && !new RegExp(`^\s*${partes.cantidad}\s*(KG|KGS|GR|GRS|G|LT|LTS|L|ML)\b`, 'i').test(texto)) partes.unidad = null;
    if ((partes.unidad === 'g' || partes.unidad === 'ml') && partes.cantidad < 50) partes.unidad = null;
    let unidad = partes.unidad ?? (!Number.isInteger(partes.cantidad) ? 'kg' : 'pza');
    /* Con PZA explícito, «CAJA 50» en la descripción es lo que trae el producto, no la presentación. */
    let factor = DE_PESO.has(unidad) || (partes.unidad === 'pza') ? 1 : factorDe(descripcion, unidad);
    /* La factura dice cuántos artículos trae el renglón («TOTAL ARTICULOS»): piezas por caja. */
    if (factor === 1 && partes.piezas >= 2 && partes.piezas <= 500) factor = partes.piezas;
    if (!partes.unidad && factor > 1 && unidad === 'pza') unidad = 'caja';
    /* «2/3»: dos cajas y tres botellas sueltas = 2 + 3/factor cajas. */
    const qTk = tk.find(x => x.sueltas != null && x.v === partes.cantidad);
    const cantidad = qTk?.sueltas && factor > 1 ? r4(partes.cantidad + qTk.sueltas / factor) : partes.cantidad;
    if (partes.importe < 0) {
      const previo = destino[destino.length - 1];
      if (previo) {
        previo.descuento = r2((previo.descuento || 0) - partes.importe);
        previo.alternativas = [];
      }
      pendiente = null;
      continue;
    }
    destino.push({
      descripcion,
      codigo,
      cantidad,
      ...(partes.descuento ? { descuento: partes.descuento } : {}),
      unidad,
      factor,
      contenido: contenidoDe(descripcion),
      precio_unitario: partes.precio,
      importe: partes.importe,
      marca: partes.marca,
      tasa_ieps: pct ? pct.v : null,
      regalo: partes.importe === 0 && partes.precio === 0 ? true : undefined,
      granel: DE_PESO.has(unidad) || !Number.isInteger(partes.cantidad),
      confianza: Math.min(r.confianza, soloNumeros && pendiente ? pendiente.confianza : 1),
      ...(partes.aproximado ? { corregido: 'precio' } : {}),
      alternativas: partes.descuento ? [] : [
        { cantidad: partes.cantidad, precio_unitario: partes.precio, importe: r2(partes.cantidad * partes.precio) },
        ...(lista && lista > partes.precio ? [{ cantidad: partes.cantidad, precio_unitario: lista, importe: r2(partes.cantidad * lista) }] : []),
        ...(partes.cantidad !== 1 && partes.precio > 0 ? [{ cantidad: 1, precio_unitario: partes.precio, importe: partes.precio }] : []),
      ].filter(a => Math.abs(a.importe - partes.importe) > 0.005),
    });
    pendienteCola = null;
    pendiente = null;
  }
  return { lineas: out, cambios };
}

/* ------------------------------------------------------------- impuestos */

/**
 * Qué marca es 16%: la combinación que hace cuadrar el IVA del ticket.
 * Sin marcas, si el IVA es cero todo es 0%; si no, se reparte: lo que
 * cuadre por subconjunto; si no cuadra nada, se deja para revisar.
 */
function asignarIva(ls, ivaTotal, iepsTotal) {
  const marcas = [...new Set(ls.map(l => l.marca).filter(Boolean))];
  const prueba = (gravadas) => {
    const base = ls.filter(gravadas).reduce((a, l) => a + l.importe, 0);
    const iepsG = iepsTotal || 0;
    return [Math.abs(base * 0.16 - ivaTotal), Math.abs((base + iepsG) * 0.16 - ivaTotal)];
  };
  if (ivaTotal == null) return { metodo: 'sin-iva', exacto: false };
  if (ivaTotal === 0) { ls.forEach(l => { l.tasa_iva = 0; }); return { metodo: 'todo-0', exacto: true }; }
  let mejor = null;
  for (const m of marcas) {
    const [a, b] = prueba(l => l.marca === m);
    const d = Math.min(a, b);
    if (!mejor || d < mejor.d) mejor = { m, d };
  }
  if (mejor && mejor.d <= Math.max(1, ivaTotal * 0.02)) {
    ls.forEach(l => { l.tasa_iva = l.marca === mejor.m ? 0.16 : 0; });
    return { metodo: `marca ${mejor.m} = 16%`, exacto: mejor.d <= 0.5 };
  }
  /* Sin marcas: si 16% de todo cuadra, todo va gravado. */
  const [a, b] = prueba(() => true);
  if (Math.min(a, b) <= Math.max(1, ivaTotal * 0.02)) { ls.forEach(l => { l.tasa_iva = 0.16; }); return { metodo: 'todo-16', exacto: true }; }
  /* IVA incluido en el precio (tickets de mostrador): total ya trae IVA. */
  ls.forEach(l => { l.tasa_iva = null; });
  return { metodo: 'por-revisar', exacto: false };
}

/**
 * El IEPS va al costo del producto que lo causa. Bebidas azucaradas por litro;
 * botanas, dulces y galletas 8% de su importe. Si las reglas no explican el
 * total del ticket, lo que falte se reparte entre esas mismas líneas.
 */
const BEBIDA = /\b(REF|REFRESCO|SODA|COLA|NARANJA|LIMON|MANZANA|TORONJA|BEBIDA|JUGO|NECTAR|TE|ENERG|ISOT)\b/;
const BOTANA = /\b(PAPA|PAPAS|FRITURA|BOTANA|CHICHARRON|CACAHUATE|PALOMITAS|GALLETA|GALLETAS|CHOC|CHOCOLATE|DULCE|DULCES|CARAMELO|CHICLE|PAN DULCE|PASTELITO|BOMBON|MAZAPAN|CEREAL)\b/;
function asignarIeps(ls, iepsTotal, baseTicket = null) {
  ls.forEach(l => { l.ieps = 0; });
  if (!iepsTotal) return { metodo: 'sin-ieps' };
  /* El ticket dice la tasa de cada renglón («8.0%» / «0.0%»): el IEPS va a
     los que la tienen, repartido por lo que se pagó de cada uno. */
  if (ls.some(l => l.tasa_ieps != null)) {
    const con = ls.filter(l => l.tasa_ieps > 0);
    let base = con.reduce((a, l) => a + l.importe - (l.descuento || 0), 0);
    /* Si faltan renglones (la foto no los dejó leer), el IEPS del ticket es
       de TODOS: repartido solo entre los leídos les cargaría de más. La base
       es la del ticket menos lo leído que va en 0 %. */
    if (baseTicket != null) {
      const sinTasa = ls.filter(l => !(l.tasa_ieps > 0)).reduce((a, l) => a + l.importe - (l.descuento || 0), 0);
      base = Math.max(base, baseTicket - sinTasa);
    }
    if (con.length && base > 0) {
      for (const l of con) l.ieps = r2(iepsTotal * (l.importe - (l.descuento || 0)) / base);
      return { metodo: 'tasa del ticket', diferencia: r2(iepsTotal - con.reduce((a, l) => a + l.ieps, 0)) };
    }
  }
  for (const l of ls) {
    const u = l.descripcion.toUpperCase();
    if (BEBIDA.test(u) && !/\bAGUA\b/.test(u) && l.contenido?.litros) l.ieps = r2(l.cantidad * l.factor * l.contenido.litros * 3.0818);
    else if (BOTANA.test(u)) l.ieps = r2(l.importe * 0.08);
  }
  const calc = ls.reduce((a, l) => a + l.ieps, 0);
  const dif = r2(iepsTotal - calc);
  if (Math.abs(dif) > 0.5) {
    const con = ls.filter(l => l.ieps > 0);
    const base = (con.length ? con : ls).reduce((a, l) => a + l.importe, 0) || 1;
    for (const l of (con.length ? con : ls)) l.ieps = r2(l.ieps + dif * l.importe / base);
    return { metodo: 'reglas+reparto', diferencia: dif };
  }
  return { metodo: 'reglas', diferencia: dif };
}

/* ---------------------------------------------------------------- interpretar */

function interpretar(renglones) {
  const rs = renglones.filter(r => r.texto && r.texto.trim());
  const cab = encabezado(rs);
  /* Dónde empiezan los totales: el primer SUBTOTAL (o TOTAL) después de algún renglón con precio. */
  let iTot = rs.findIndex(r => esTotal(r.texto) === 'subtotal');
  if (iTot < 0) iTot = rs.findIndex(r => esTotal(r.texto) === 'total');
  const cuerpo = iTot >= 0 ? rs.slice(0, iTot) : rs;
  const pie = iTot >= 0 ? rs.slice(iTot) : [];

  /* El cuerpo empieza después del encabezado: la última línea con RFC/fecha/folio o los títulos de la tabla. */
  let iIni = 0;
  cuerpo.forEach((r, i) => { if (/R[FE][CG]\b|FECHA|TICKET|FOLIO|REMISION|CANT\b.*DESCRIPCION|DESCRIPCION.*(IMPORTE|PRECIO|TOTAL)|PRODUCTO.*COD/i.test(r.texto) && i < 12) iIni = i + 1; });
  const { lineas: ls, cambios } = lineas(cuerpo.slice(iIni));

  const totales = { subtotal: null, descuento: 0, ieps: 0, iva: null, envases: 0, total: null };
  let remplazo = 0;
  /* El dinero de un total: en su renglón o, si la foto lo partió, en el
     renglón vecino que no trae más que ese número. «$0» y «$O» también. */
  const soloDinero = (r) => r && !esTotal(r.texto) && /^[\s$§S8]*\d[\d,.]*[.,]\d{2}\s*$/.test(normalizarFila(r.texto));
  const valorDe = (r) => {
    const tk = tokens(normalizarFila(r.texto));
    const d = tk.filter(x => x.tipo === 'dinero');
    if (d.length) return Math.abs(d[d.length - 1].v);
    const cero = tk.find(x => /^\$[0O]$/.test(x.t));
    return cero ? 0 : null;
  };
  pie.forEach((r, i) => {
    const k = esTotal(r.texto);
    if (!k) return;
    let v = valorDe(r);
    if (v == null) {
      const vecino = [pie[i + 1], pie[i - 1]].find(soloDinero);
      if (vecino) v = valorDe(vecino);
    }
    if (v == null) return;
    if (k === 'subtotal' && totales.subtotal == null) totales.subtotal = v;
    else if (k === 'total' && totales.total == null) totales.total = v;
    else if (k === 'iva') totales.iva = (totales.iva ?? 0) + v;
    else if (k === 'descuento_total') totales.descuento = v;
    else if (k === 'remplazo') remplazo = r2(remplazo + v);
    else if (k !== 'subtotal' && k !== 'total') totales[k] = r2((totales[k] || 0) + v);
  });

  const avisos = [];

  /* Cambio físico (Bimbo): el pan que se llevó se repone sin cargo. Lo
     repuesto viene cobrado en la venta y restado como «REMPLAZO»: ese
     descuento va al mismo producto, no repartido. */
  if (cambios.length || remplazo) {
    let resta = remplazo || r2(cambios.reduce((a, c) => a + c.importe, 0));
    for (const c of cambios) {
      const mismo = ls.find(l => (c.codigo && l.codigo === c.codigo) || l.descripcion === c.descripcion);
      if (mismo && resta > 0) {
        const d = Math.min(resta, c.importe, mismo.importe - (mismo.descuento || 0));
        mismo.descuento = r2((mismo.descuento || 0) + d);
        resta = r2(resta - d);
      }
    }
    if (resta > 0.005) totales.descuento = r2((totales.descuento || 0) + resta);
    const piezas = cambios.reduce((a, c) => a + c.cantidad, 0);
    avisos.push(`Cambio físico: ${piezas} ${piezas === 1 ? 'pieza repuesta' : 'piezas repuestas'} sin cargo (${remplazo.toFixed(2)}). Ya va descontado del costo.`);
  }
  /* Un importe mal leído («$187.76» por $107.76) se delata con el subtotal:
     si poniendo cantidad × precio en los renglones que no cuadran la suma da
     el subtotal al centavo, eran esos. */
  {
    const malos = ls.filter(l => Math.abs(l.cantidad * l.precio_unitario - l.importe) > 0.06 && l.alternativas?.length).slice(0, 6);
    const sumaAhora = ls.reduce((a, l) => a + l.importe, 0);
    const metas = [totales.subtotal, totales.subtotal != null && totales.descuento ? totales.subtotal - totales.descuento : null, totales.total].filter(x => x != null);
    if (malos.length && metas.length && !metas.some(m => Math.abs(sumaAhora - m) <= 0.05)) {
      /* Cada renglón dudoso se queda como está o toma una de sus lecturas;
         gana la combinación que da el subtotal con MENOS cambios. */
      let mejor = null;
      const elegir = (i, suma, cambios, eleccion) => {
        if (mejor && cambios >= mejor.cambios) return;
        if (i === malos.length) {
          if (cambios && metas.some(m => Math.abs(suma - m) <= 0.05)) mejor = { cambios, eleccion: [...eleccion] };
          return;
        }
        const l = malos[i];
        eleccion.push(null); elegir(i + 1, suma, cambios, eleccion); eleccion.pop();
        for (const a of l.alternativas) { eleccion.push(a); elegir(i + 1, suma - l.importe + a.importe, cambios + 1, eleccion); eleccion.pop(); }
      };
      elegir(0, sumaAhora, 0, []);
      (mejor?.eleccion || []).forEach((a, i) => {
        if (!a) return;
        const l = malos[i], antes = l.importe;
        Object.assign(l, a, { corregido: 'importe' });
        avisos.push(`«${l.descripcion}»: se leyó ${antes.toFixed(2)}; con el total del ticket es ${l.cantidad} × ${l.precio_unitario.toFixed(2)} = ${l.importe.toFixed(2)}.`);
      });
    }
  }

  /* Cada renglón: cantidad × precio = importe. Si el OCR leyó mal uno de los
     tres, los otros dos lo corrigen. */
  for (const l of ls) {
    if (Math.abs(l.cantidad * l.precio_unitario - l.importe) > 0.06) {
      const q = l.precio_unitario ? r2(l.importe / l.precio_unitario) : null;
      if (q && Math.abs(q - Math.round(q)) < 0.02 && !l.granel) { l.cantidad = Math.round(q); l.corregido = 'cantidad'; }
      else if (l.cantidad) { l.precio_unitario = r2(l.importe / l.cantidad); l.corregido = 'precio'; }
      avisos.push(`Revisa «${l.descripcion}»: cantidad × precio no daba el importe (se ajustó el ${l.corregido}).`);
    }
  }

  /* Un renglón que cuesta más que todo el ticket es basura del OCR (un
     pedazo de papel arrugado leído como 1,058,217.88): se deja fuera. */
  const tope = Math.max((totales.total || 0) + (totales.descuento || 0), totales.subtotal || 0);
  for (const l of ls) {
    if (tope > 0 && l.importe > tope * 1.02) {
      l.dudoso = true;
      avisos.push(`«${l.descripcion}» se leyó con un importe imposible (${l.importe.toFixed(2)}): se dejó sin marcar.`);
    }
  }
  const validas = ls.filter(l => !l.dudoso);

  const descuentoRenglones = r2(validas.reduce((a, l) => a + (l.descuento || 0), 0));
  if (descuentoRenglones > 0 && Math.abs((totales.descuento || 0) - descuentoRenglones) <= 0.05) totales.descuento = 0;
  const suma = r2(validas.reduce((a, l) => a + l.importe, 0));
  /* Lo que el OCR leyó en el pie y no cuadra: un «$0.00» que salió 8.08 o
     0.80. Si quitando UNO de los cargos las cuentas cierran al centavo, ese
     era el mal leído. */
  const calcular = () => r2((totales.subtotal ?? suma) - (totales.descuento || 0) - descuentoRenglones + (totales.ieps || 0) + (totales.iva || 0) + (totales.envases || 0));
  if (totales.total != null && Math.abs(calcular() - totales.total) > 0.05) {
    const ks = ['descuento', 'iva', 'ieps', 'envases'].filter(k => totales[k]);
    const antes = Object.fromEntries(ks.map(k => [k, totales[k]]));
    /* El menor número de cargos en cero que haga cerrar las cuentas. */
    const masks = [...Array(1 << ks.length).keys()].slice(1).sort((a, b) => bits(a) - bits(b));
    let cerro = false;
    for (const mask of masks) {
      ks.forEach((k, i) => { totales[k] = mask & (1 << i) ? 0 : antes[k]; });
      if (Math.abs(calcular() - totales.total) <= 0.05) {
        ks.filter((_, i) => mask & (1 << i)).forEach(k =>
          avisos.push(`El ${k === 'iva' ? 'IVA' : k === 'ieps' ? 'IEPS' : k} se leyó ${antes[k].toFixed(2)}, pero las cuentas cierran con 0: se tomó 0.`));
        cerro = true;
        break;
      }
    }
    if (!cerro) ks.forEach(k => { totales[k] = antes[k]; });
  }
  /* Precios ya con el descuento (refresqueras: precio de lista, descuento y
     neto por renglón): los renglones suman el subtotal MENOS el descuento.
     Ese descuento no se vuelve a restar. */
  if (totales.subtotal != null && totales.descuento > 0
      && Math.abs(suma - totales.subtotal) > 0.05 && Math.abs(suma - (totales.subtotal - totales.descuento)) <= 0.05) {
    totales.descuento_en_renglones = true;
    totales.subtotal_lista = totales.subtotal;
    totales.subtotal = suma;
    totales.descuento_lista = totales.descuento;
    totales.descuento = 0;
  }
  const regalos = validas.filter(l => l.regalo);
  if (regalos.length) avisos.push(`${regalos.length === 1 ? 'Un renglón llegó' : `${regalos.length} renglones llegaron`} sin cargo (promoción): ${regalos.length === 1 ? 'quedó' : 'quedaron'} sin marcar. Márcalos y ponles costo si quieres que entren al inventario.`);

  const iva = asignarIva(validas, totales.iva, totales.ieps);
  const faltan = totales.subtotal != null && totales.subtotal - suma > 0.05;
  const ieps = asignarIeps(validas, totales.ieps,
    faltan ? r2(totales.subtotal - (totales.descuento || 0) - descuentoRenglones) : null);
  const cuadre = {
    lineas_vs_subtotal: totales.subtotal != null ? r2(totales.subtotal - suma) : null,
    total_calculado: calcular(),
  };
  cuadre.total_vs_ticket = totales.total != null ? r2(totales.total - cuadre.total_calculado) : null;
  cuadre.ok = (cuadre.lineas_vs_subtotal == null || Math.abs(cuadre.lineas_vs_subtotal) <= 0.05)
    && (cuadre.total_vs_ticket == null || Math.abs(cuadre.total_vs_ticket) <= 0.05);
  if (cuadre.lineas_vs_subtotal != null && Math.abs(cuadre.lineas_vs_subtotal) > 0.05)
    avisos.push(`Los renglones suman ${suma.toFixed(2)} y el subtotal dice ${totales.subtotal.toFixed(2)}: puede faltar o sobrar un renglón.`);
  if (cuadre.total_vs_ticket != null && Math.abs(cuadre.total_vs_ticket) > 0.05)
    avisos.push(`Las cuentas dan ${cuadre.total_calculado.toFixed(2)} y el total dice ${totales.total.toFixed(2)}.`);
  if (iva.metodo === 'por-revisar') avisos.push('No se pudo saber qué productos llevan IVA: revísalo en cada renglón.');
  if (totales.envases) avisos.push(`El depósito de envase (${totales.envases.toFixed(2)}) no es mercancía: no entra al inventario.`);
  for (const l of ls) if (l.confianza < 0.85) avisos.push(`«${l.descripcion}» se leyó con poca claridad.`);

  if (remplazo) totales.remplazo = remplazo;
  return { tipo: 'ticket', ...cab, lineas: ls, cambios, totales, impuestos: { iva, ieps }, cuadre, avisos };
}

module.exports = { interpretar, factorDe, contenidoDe, aNumero, tokens, UNIDADES };
