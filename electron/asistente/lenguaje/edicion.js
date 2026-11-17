/**
 * EDITAR UN REGISTRO HABLANDO
 *
 * «Cambia el costo de la concha a 8», «ponle el código 7501055300846 a la
 * coca», «renombra la concha a Concha grande», «quítale el IEPS a las papas»,
 * «da de baja la concha».
 *
 * Es una REGLA, no una predicción: si la frase nombra un campo de la ficha y
 * un verbo de cambiar, es una edición. El clasificador confundía «cambia el
 * costo» con cambiar el precio, y «actualiza el producto con código…» con
 * crear uno.
 *
 * Aquí solo se entiende la frase. Qué campos tiene cada entidad, cómo se lee
 * el valor actual y por qué canal se guarda vive en acciones/entidades.js.
 */
'use strict';

/** El texto sin acentos y en minúsculas, con la MISMA longitud que el original
    (así un nombre se toma del original, con sus acentos y mayúsculas). */
const llano = (s) => [...String(s || '')].map((c) => c.normalize('NFD')[0]).join('').toLowerCase();

const VERBO = /\b(?:cambia|cambiale|cambiar|cambiarle|actualiza|actualizale|actualizar|modifica|modificale|modificar|pon|ponle|ponles|poner|ponerle|corrige|corrigele|corregir|edita|editale|editar|asigna|asignale|registra|registrale|captura|capturale|renombra|renombrar|agrega|agregale|quita|quitale|quitar|borra|borrale|elimina|eliminale)\b/;
const QUITAR = /\b(?:quita|quitale|quitar|borra|borrale|elimina|eliminale|sin)\b/;

/** Campo → cómo se dice. El orden importa: lo más específico primero. */
const CAMPOS = [
  { campo: 'sku', re: /\b(?:sku|numero de parte|no\.? de parte|codigo interno|clave interna)\b/ },
  { campo: 'codigo_barras', re: /\b(?:codigo de barras|codigo|barras|ean|upc)\b/ },
  { campo: 'costo', re: /\b(?:costo|lo que me cuesta|precio de compra)\b/ },
  { campo: 'iva', re: /\b(?:iva|tasa de iva)\b/ },
  { campo: 'impuesto', re: /\b(?:ieps|impuestos?|imp\.? local|hospedaje)\b/ },
  { campo: 'nombre', re: /\b(?:nombre|renombra|renombrar)\b/ },
  { campo: 'precio', re: /\b(?:precio de venta|precio)\b/ },
];

const BAJA = /\b(?:(?:da|dar|dale|doy|darle|damos) de baja|desactiva|desactivar|desactivalo|desactivala|ya no (?:lo |la )?(?:vendo|vendemos|manejo|manejamos))\b|\b(?:quita|quitar|saca|sacar)\b(?=.*\bdel catalogo$)|\b(?:elimina|eliminar|borra|borrar)\s+(?:el |la |los |las )?(?:producto|articulo)\b/;
/** Una baja de otra cosa no es de un producto. */
const OTRA_COSA = /\b(?:cliente|proveedor|usuario|cajero|empleado|cita|gasto|venta|factura|ticket|orden|cupon|socio|profesional|servicio|mesa|caja)\b/;

const NUM = /^\$?\d+(?:[.,]\d+)?$/;
const CONECTOR = /\s(?:a|al|para|por|en|=|:|que diga|que sea|que quede en)\s/g;

/** El último conector fuera del campo: «… de la concha A concha grande». */
function ultimoConector(t, desde) {
  let m, ult = null;
  CONECTOR.lastIndex = desde;
  while ((m = CONECTOR.exec(t))) ult = { i: m.index, fin: m.index + m[0].length };
  return ult;
}

function numero(s) {
  const m = String(s).replace(/,/g, '').match(/\$?\s*(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function iva(s) {
  const t = llano(s);
  if (/\bexento\b|\b0\s*%?$|\bcero\b|\bsin iva\b/.test(t)) return 0;
  if (/\b8\b|\bfrontera\b/.test(t)) return 0.08;
  if (/\b16\b/.test(t)) return 0.16;
  return null;
}

/**
 * @returns null si la frase no es una edición; si lo es:
 *   { intent: 'producto.editar' | 'producto.precio' | 'producto.baja' | 'producto.impuesto',
 *     campo, valor, valorTexto, quitar, textoProducto }
 */
function edicion(texto) {
  const raw = String(texto || '').trim().replace(/[¿?¡!]+/g, '');
  const t = llano(raw);
  if (!t) return null;

  /* «Da de baja la concha». */
  /* «Dar de baja 5 panes por caducidad» es merma (piezas), no sacar el
     producto del catálogo. */
  const esMerma = /\b(?:caduc\w*|merma|se cay\w*|rot\w*|echaron a perder|echo a perder|vencid\w*|piezas?|pzas?|unidades)\b/.test(t)
    || /\bbaja\s+(?:de\s+)?\d/.test(t) || /\b(?:baja|desactiva\w*)\s+(?:\w+\s+)?\d+(?:\.\d+)?\s+(?!$)/.test(t);
  if (BAJA.test(t) && !esMerma && !OTRA_COSA.test(t.replace(BAJA, ' '))) {
    return { intent: 'producto.baja', textoProducto: t.replace(BAJA, ' ').replace(/\b(?:el|la|los|las|producto|articulo|del catalogo|de inventario)\b/g, ' ').trim() };
  }

  /* «La coca va sin IVA». */
  const sinIva = t.match(/\b(?:va|lleva|ponle|ponla|ponlo|ponles|dejala|dejalo|deja|dejale)\s+sin iva\b/);
  if (sinIva) {
    return { intent: 'producto.editar', campo: 'iva', valor: 0, valorTexto: 'sin IVA',
             textoProducto: t.replace(sinIva[0], ' ').replace(/\b(?:el|la|los|las|producto)\b/g, ' ').replace(/\s+/g, ' ').trim() };
  }
  /* «El costo de la concha es 8», «el código de la coca ahora es 750…».
     Una pregunta («¿cuál es el costo…?») no es una orden. */
  const afirma = !/^(?:cual|cuanto|cuanta|que|como|donde|dime|sabes)\b/.test(t)
    && t.match(/^(?:el |la )?(costo|codigo de barras|codigo|sku|numero de parte|iva)\b(.*?)\s(?:ahora es|ahora sera|es|sera|queda en|va a ser)\s+(\S.*)$/);
  if (afirma) {
    const c = CAMPOS.find((x) => x.re.test(afirma[1]));
    if (c && c.campo !== 'impuesto' && c.campo !== 'precio') {
      const valorRaw = raw.slice(t.length - afirma[3].length);
      return { intent: 'producto.editar', campo: c.campo, valor: valorDeCampo(c.campo, valorRaw), valorTexto: limpio(valorRaw),
               textoProducto: afirma[2].replace(/\b(?:el|la|los|las|de|del|producto)\b/g, ' ').replace(/\s+/g, ' ').trim() };
    }
  }

  /* «La concha me cuesta 8 (ahora)». */
  const cuesta = !/^(?:cual|cuanto|cuanta|que|como)\b/.test(t) && t.match(/^(?:el |la |los |las )?(.+?)\s+(?:me|nos)\s+(?:cuesta|cuestan|sale|salen)\s+(?:en\s+)?\$?\s*(\d+(?:[.,]\d+)?)(?:\s+pesos)?(?:\s+ahora)?$/);
  if (cuesta) return { intent: 'producto.editar', campo: 'costo', valor: numero(cuesta[2]), valorTexto: cuesta[2], textoProducto: cuesta[1].trim() };
  /* «Las sabritas llevan IEPS 8 %», «las sabritas ya no llevan IEPS». */
  const lleva = t.match(/^(?:el |la |los |las )?(.+?)\s+(ya no\s+)?(?:llevan?|tienen?|pagan?|causan?)\s+((?:el\s+)?(?:ieps|impuesto|hospedaje)\b.*)$/);
  if (lleva) return { intent: 'producto.impuesto', campo: 'impuesto', quitar: !!lleva[2], valor: lleva[3].replace(/^el\s+/, '').trim(), valorTexto: lleva[3].trim(), textoProducto: lleva[1].trim() };

  if (!VERBO.test(t) && !/\b(?:con (?:el )?(?:codigo|sku)|que se llame)\b/.test(t)) return null;
  let hit = null;
  for (const c of CAMPOS) {
    const m = t.match(c.re);
    if (m) { hit = { ...c, i: m.index, fin: m.index + m[0].length }; break; }
  }
  if (!hit) return null;
  /* «Actualiza el producto CON CÓDIGO 750… a 25 pesos»: el código dice cuál
     producto, no el campo que cambia. Si además trae un precio, es el precio. */
  if (hit.campo === 'codigo_barras' && /\bcon (?:el )?codigo\b/.test(t.slice(Math.max(0, hit.i - 8), hit.fin))) {
    const p = t.match(/\bprecio\b/);
    if (p || /\$\s*\d|\d+\s*pesos/.test(t)) return { intent: 'producto.precio' };
    const otro = CAMPOS.filter((c) => c.campo !== 'codigo_barras' && c.campo !== 'sku').find((c) => c.re.test(t.slice(hit.fin)));
    if (!otro) return null;
    hit = { ...otro, i: hit.fin + t.slice(hit.fin).search(otro.re), fin: 0 };
    hit.fin = hit.i + t.slice(hit.i).match(otro.re)[0].length;
  }
  if (hit.campo === 'precio') return { intent: 'producto.precio' };

  const quitar = QUITAR.test(t);
  /* Impuestos: «ponle IEPS 8% a las papas», «quítale el IEPS a las papas». */
  if (hit.campo === 'impuesto') {
    const con = ultimoConector(t, hit.fin);
    const queImpuesto = (con ? t.slice(hit.i, con.i) : t.slice(hit.i)).trim();
    const textoProducto = con ? t.slice(con.fin) : t.slice(0, hit.i).replace(VERBO, ' ');
    return { intent: 'producto.impuesto', campo: 'impuesto', quitar, valor: queImpuesto, valorTexto: queImpuesto, textoProducto: textoProducto.trim() };
  }

  /* «Quítale el código de barras a la concha»: el campo queda vacío. */
  if (quitar && (hit.campo === 'codigo_barras' || hit.campo === 'sku')) {
    const con = ultimoConector(t, hit.fin);
    return { intent: 'producto.editar', campo: hit.campo, valor: '', valorTexto: 'sin código',
             textoProducto: (con ? t.slice(con.fin) : t.slice(hit.fin)).trim() };
  }

  /* Dos formas:
     A «cambia el costo de la concha A 8»          → valor al final.
     B «ponle el código 7501055300846 A la concha» → valor junto al campo. */
  const tras = t.slice(hit.fin).replace(/^\s*(?:de|del|a|al|en|el|la)?\s*/, '');
  const primero = tras.split(/\s+/)[0] || '';
  const pareceValor = hit.campo !== 'nombre' && (NUM.test(primero) || /\d/.test(primero) || (hit.campo === 'sku' && /^[a-z0-9-]{3,}$/.test(primero)));
  const restoB = tras.slice(primero.length).match(/^\s+(?:a|al|para|en|de|del)\s+(.+)$/);
  let valorRaw, textoProducto;
  if (pareceValor && restoB) {
    const ini = t.indexOf(primero, hit.fin);
    valorRaw = raw.slice(ini, ini + primero.length);
    textoProducto = restoB[1];
  } else {
    const con = ultimoConector(t, hit.fin);
    if (con) {
      valorRaw = raw.slice(con.fin).trim();
      textoProducto = `${t.slice(0, hit.i).replace(VERBO, ' ')} ${t.slice(hit.fin, con.i)}`;
    } else {
      valorRaw = null;
      textoProducto = `${t.slice(0, hit.i).replace(VERBO, ' ')} ${t.slice(hit.fin)}`;
    }
  }
  textoProducto = String(textoProducto || '').replace(/\b(?:el|la|los|las|de|del|al|a|su|le|producto|articulo)\b/g, ' ').replace(/\s+/g, ' ').trim();

  let valor = null, valorTexto = valorRaw;
  if (valorRaw != null && valorRaw !== '') {
    valor = valorDeCampo(hit.campo, valorRaw);
    valorTexto = limpio(valorRaw);
  }
  return { intent: 'producto.editar', campo: hit.campo, valor, valorTexto, textoProducto };
}

const limpio = (s) => String(s ?? '').trim().replace(/^["'«“]+|["'»”.]+$/g, '').trim();

/** El valor dicho, ya en el tipo del campo; null si no se entiende. */
function valorDeCampo(campo, dicho) {
  const v = limpio(dicho);
  if (!v) return null;
  if (campo === 'costo') return numero(v);
  if (campo === 'iva') return iva(v);
  if (campo === 'codigo_barras') { const c = v.replace(/[\s-]/g, ''); return /^[0-9a-z]{3,}$/i.test(c) ? c : null; }
  if (campo === 'sku') return v.toUpperCase();
  if (campo === 'nombre') return v.charAt(0).toUpperCase() + v.slice(1);
  return null;
}

/* ------------------------------------------------ personas (cliente, proveedor)
   «Cambia el teléfono de doña Mary a 5512345678», «el correo de Bimbo es
   ventas@bimbo.mx», «ponle límite de crédito de 2000 a don Pepe»,
   «renombra al cliente Juan a Juan Pérez». */
const CAMPOS_PERSONA = [
  { campo: 'limite', re: /\b(?:limite de credito|limite|credito maximo|tope de credito)\b/ },
  { campo: 'dias', re: /\b(?:dias de credito|plazo de credito|plazo)\b/ },
  { campo: 'telefono', re: /\b(?:telefono|celular|cel|whatsapp|numero de telefono|numero)\b/ },
  { campo: 'correo', re: /\b(?:correo electronico|correo|email|e-mail|mail)\b/ },
  { campo: 'rfc', re: /\brfc\b/ },
  { campo: 'nombre', re: /\b(?:nombre|renombra|renombrar)\b/ },
];
const TIPO = /\b(cliente|clienta|proveedor|proveedora)\b/;

/** El valor de un campo de persona, sacado del texto original. */
function valorPersona(campo, raw) {
  const r = String(raw || '');
  if (campo === 'telefono') { const m = r.replace(/(\d)[\s-](?=\d)/g, '$1').match(/\b(\d{10})\b/); return m ? m[1] : null; }
  if (campo === 'correo') { const m = r.match(/[^\s@,;«»"']+@[^\s@,;«»"']+\.[a-z]{2,}/i); return m ? m[0].toLowerCase() : null; }
  if (campo === 'rfc') { const m = r.toUpperCase().match(/\b([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})\b/); return m ? m[1] : null; }
  if (campo === 'limite') return numero(r);
  if (campo === 'dias') { const n = numero(r); return n == null ? null : Math.round(n); }
  if (campo === 'nombre') { const v = limpio(r); return v ? v.charAt(0).toUpperCase() + v.slice(1) : null; }
  return null;
}

/**
 * @returns null o { campo, valor, valorTexto, tipo: 'cliente'|'proveedor'|null, textoPersona }
 */
function edicionPersona(texto) {
  const raw = String(texto || '').trim().replace(/[¿?¡!]+/g, '');
  const t = llano(raw);
  if (!t || /^(?:cual|cuanto|cuanta|que|como|donde|dime|sabes|tiene)\b/.test(t)) return null;
  const hit = CAMPOS_PERSONA.map((c) => ({ ...c, m: t.match(c.re) })).find((c) => c.m);
  if (!hit) return null;
  const afirma = /\s(?:ahora es|es|sera|queda en|va a ser)\s/.test(t);
  if (!VERBO.test(t) && !afirma && !/\b(?:dale|dales|darle|da|subele|bajale|aumentale)\b/.test(t)) return null;
  const tipo = (t.match(TIPO)?.[1] || '').startsWith('proveedor') ? 'proveedor' : TIPO.test(t) ? 'cliente' : null;
  const i = hit.m.index, fin = i + hit.m[0].length;
  let valorRaw = null, quien = '';
  if (hit.campo === 'nombre') {
    /* «renombra a doña Mary a María López»: el nombre nuevo va al final. */
    const con = ultimoConector(t, fin);
    if (con) { valorRaw = raw.slice(con.fin); quien = t.slice(fin, con.i); }
    else quien = t.slice(fin);
  } else {
    valorRaw = raw;
    const v = valorPersona(hit.campo, raw);
    const sinValor = v == null ? t : t.replace(llano(String(v)), ' ').replace(/\$?\s?[\d.,\s-]{4,}/g, ' ');
    quien = sinValor.slice(0, i).replace(VERBO, ' ') + ' ' + sinValor.slice(fin);
  }
  const valor = valorRaw == null ? null : valorPersona(hit.campo, valorRaw);
  const textoPersona = quien.replace(VERBO, ' ').replace(/\b(?:ahora es|es|sera|queda en|va a ser|a|al|de|del|el|la|los|las|su|le|para|en|que|con|pesos|dias|cliente|clienta|proveedor|proveedora|credito)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return { campo: hit.campo, valor, valorTexto: valor == null ? null : String(valor), tipo, textoPersona };
}

module.exports = { edicion, edicionPersona, valorDeCampo, valorPersona, llano };
