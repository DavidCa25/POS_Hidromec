/**
 * FACTURA ELECTRÓNICA (CFDI 3.3 / 4.0): lectura EXACTA del XML, sin OCR.
 *
 *   const doc = leerCfdi(textoXml);
 *
 * Devuelve la misma forma que ocr/ticket.cjs (proveedor, rfc, folio, fecha,
 * lineas, totales, cuadre, avisos), así la pantalla de revisión no distingue
 * de dónde vino. Del XML sale todo con certeza:
 *   Emisor (Rfc, Nombre) → el proveedor
 *   Serie+Folio, Fecha, TimbreFiscalDigital/UUID
 *   Concepto: ClaveProdServ, NoIdentificacion, Cantidad, ClaveUnidad, Unidad,
 *             Descripcion, ValorUnitario, Importe, Descuento, ObjetoImp
 *   Traslados por concepto: Impuesto 002 = IVA, 003 = IEPS; TipoFactor
 *             Tasa | Cuota | Exento; TasaOCuota; Importe
 *
 * El XML del SAT es plano y conocido: se lee con expresiones sobre etiquetas
 * y atributos, sin dependencias. Los prefijos (cfdi:, tfd:) pueden variar.
 */

const r2 = (n) => Math.round(n * 100) / 100;
const { factorDe, contenidoDe } = require('./ticket.cjs');

function atributos(etiqueta) {
  const out = {};
  for (const m of etiqueta.matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) out[m[1].replace(/^\w+:/, '')] = desescapar(m[2]);
  return out;
}
function desescapar(s) {
  return s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
/** Primera etiqueta de apertura con ese nombre local (sin importar el prefijo). */
function etiqueta(xml, nombre) {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${nombre}\\b[^>]*>`));
  return m ? atributos(m[0]) : null;
}
/** Todos los bloques <Nombre ...>...</Nombre> (o autocerrados). */
function bloques(xml, nombre) {
  const re = new RegExp(`<(?:\\w+:)?${nombre}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${nombre}>)`, 'g');
  return [...xml.matchAll(re)].map(m => ({ attr: atributos(`<x ${m[1]}>`), cuerpo: m[2] || '' }));
}

/* Unidades del catálogo del SAT (c_ClaveUnidad) que llegan en compras de tienda. */
const CLAVE_UNIDAD = {
  H87: 'pza', EA: 'pza', C62: 'pza', XBX: 'caja', XPK: 'paquete', XBG: 'bolsa', XBO: 'botella', XCN: 'lata',
  KGM: 'kg', GRM: 'g', LTR: 'l', MLT: 'ml', XUN: 'pza', E48: 'servicio', ACT: 'actividad', XKI: 'kit', SET: 'juego', PR: 'par',
};

function leerCfdi(xml) {
  const texto = String(xml || '');
  const comp = etiqueta(texto, 'Comprobante');
  if (!comp || !/cfd/i.test(texto.slice(0, 2000))) throw new Error('No es una factura electrónica (CFDI) válida.');
  const emisor = etiqueta(texto, 'Emisor') || {};
  const receptor = etiqueta(texto, 'Receptor') || {};
  const timbre = etiqueta(texto, 'TimbreFiscalDigital') || {};
  const tipo = comp.TipoDeComprobante || 'I';

  /* Conceptos: solo los de la sección Conceptos (no los de Complementos). */
  const seccion = (texto.match(/<(?:\w+:)?Conceptos\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Conceptos>/) || [])[1] || '';
  const lineas = bloques(seccion, 'Concepto').map(({ attr: a, cuerpo }) => {
    const traslados = bloques(cuerpo, 'Traslado').map(t => t.attr);
    const iva = traslados.find(t => t.Impuesto === '002');
    const ieps = traslados.filter(t => t.Impuesto === '003');
    const cantidad = Number(a.Cantidad || 0);
    const importe = Number(a.Importe || 0);
    const descuento = Number(a.Descuento || 0);
    const unidad = CLAVE_UNIDAD[a.ClaveUnidad] || (a.Unidad || 'pza').toLowerCase();
    return {
      descripcion: (a.Descripcion || '').trim(),
      clave_prod_serv: a.ClaveProdServ || null,
      codigo: a.NoIdentificacion || null,
      cantidad,
      unidad,
      clave_unidad: a.ClaveUnidad || null,
      factor: ['kg', 'g', 'l', 'ml', 'pza'].includes(unidad) ? 1 : factorDe(a.Descripcion || '', unidad),
      contenido: contenidoDe(a.Descripcion || ''),
      precio_unitario: Number(a.ValorUnitario || 0),
      importe,
      descuento,
      objeto_impuesto: a.ObjetoImp || null,
      tasa_iva: iva ? (iva.TipoFactor === 'Exento' ? 0 : Number(iva.TasaOCuota || 0)) : (a.ObjetoImp === '01' ? 0 : null),
      iva_exento: iva?.TipoFactor === 'Exento',
      iva_importe: r2(iva && iva.TipoFactor !== 'Exento' ? Number(iva.Importe || 0) : 0),
      ieps: r2(ieps.reduce((s, t) => s + Number(t.Importe || 0), 0)),
      ieps_tipo: ieps[0] ? `${ieps[0].TipoFactor} ${ieps[0].TasaOCuota}` : null,
      granel: ['kg', 'g', 'l', 'ml'].includes(unidad) || !Number.isInteger(cantidad),
      confianza: 1,
    };
  });

  const subtotal = Number(comp.SubTotal || 0);
  const descuento = Number(comp.Descuento || 0);
  const total = Number(comp.Total || 0);
  const iva = r2(lineas.reduce((s, l) => s + l.iva_importe, 0));
  const ieps = r2(lineas.reduce((s, l) => s + l.ieps, 0));
  const retenciones = r2(bloques((texto.split(/<\/(?:\w+:)?Conceptos>/)[1] || ''), 'Retencion').reduce((s, t) => s + Number(t.attr.Importe || 0), 0));

  const totales = { subtotal, descuento, ieps, iva, envases: 0, retenciones, total };
  const calculado = r2(subtotal - descuento + iva + ieps - retenciones);
  const cuadre = {
    lineas_vs_subtotal: r2(subtotal - lineas.reduce((s, l) => s + l.importe, 0)),
    total_calculado: calculado,
    total_vs_ticket: r2(total - calculado),
  };
  cuadre.ok = Math.abs(cuadre.lineas_vs_subtotal) <= 0.05 && Math.abs(cuadre.total_vs_ticket) <= 0.05;

  const avisos = [];
  if (tipo === 'E') avisos.push('Es una nota de crédito (egreso): resta, no suma una compra.');
  if (tipo === 'P') avisos.push('Es un complemento de pago, no una compra.');
  if (comp.Moneda && comp.Moneda !== 'MXN') avisos.push(`La factura está en ${comp.Moneda} (tipo de cambio ${comp.TipoCambio || 'sin dato'}).`);
  if (!cuadre.ok) avisos.push('Las cuentas del XML no cuadran: revísalo con el proveedor.');

  return {
    tipo: 'cfdi',
    tipo_comprobante: tipo,
    proveedor: emisor.Nombre || null,
    rfc: emisor.Rfc || null,
    regimen: emisor.RegimenFiscal || null,
    receptor_rfc: receptor.Rfc || null,
    folio: [comp.Serie, comp.Folio].filter(Boolean).join('-') || null,
    uuid: timbre.UUID || null,
    fecha: (comp.Fecha || '').slice(0, 10) || null,
    forma_pago: comp.FormaPago || null,
    metodo_pago: comp.MetodoPago || null,
    moneda: comp.Moneda || 'MXN',
    lineas,
    totales,
    impuestos: { iva: { metodo: 'xml', exacto: true }, ieps: { metodo: 'xml' } },
    cuadre,
    avisos,
  };
}

module.exports = { leerCfdi };
