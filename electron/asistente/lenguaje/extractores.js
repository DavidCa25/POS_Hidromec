'use strict';
/**
 * EXTRACTORES: sacan datos tipados del texto ya normalizado. Cada uno dice
 * qué tan seguro está (exacto · probable · dudoso), como el lector de
 * QuickStart: lo dudoso NUNCA se aplica, se pregunta.
 */
const { raiz } = require('./normalizar');

/* Unidad escrita → unidad base de Wybix y factor. */
const UNIDADES = [
  [/^(g|gr|grs|gramo|gramos)$/, 'g', 1],
  [/^(kg|kilo|kilos|kilogramo|kilogramos)$/, 'g', 1000],
  [/^(ml|mililitro|mililitros)$/, 'ml', 1],
  [/^(l|lt|lts|litro|litros)$/, 'ml', 1000],
  [/^(pz|pza|pzas|pieza|piezas|unidad|unidades)$/, 'pza', 1],
];
function unidadDe(w) {
  for (const [re, base, f] of UNIDADES) if (re.test(w)) return { base, factor: f };
  return null;
}

/** «$65», «65 pesos», «a 65» (después de «a», «en», «por» cuando se habla de precio). */
function dinero(texto, { conPreposicion = false } = {}) {
  let m = texto.match(/\$(\d+(?:\.\d+)?)/) || texto.match(/\b(\d+(?:\.\d+)?) pesos\b/);
  if (m) return { valor: Number(m[1]), confianza: 'exacto', texto: m[0] };
  if (conPreposicion) {
    /* «a 65» es precio; «a 5 conchas» no: si después del número viene el
       nombre de algo (y no una muletilla), es una cantidad. */
    m = texto.match(/\b(?:a|en|por|de|precio)\s+(\d+(?:\.\d+)?)\b(?!\s*(?:g|kg|ml|l|pz|pza|piezas?|gramos|litros?|kilos?)\b)(?!\s+(?!porfa|por favor|gracias|ahorita|pesos|varos|hoy|manana)[a-z])/);
    if (m) return { valor: Number(m[1]), confianza: 'probable', texto: m[0] };
  }
  return null;
}

/** Cantidades con unidad: [{ valor, uom, texto, inicio }] en unidad base. */
function cantidades(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!/^\d+(\.\d+)?$/.test(tokens[i])) continue;
    if (i > 0 && tokens[i - 1].startsWith('$')) continue;
    const n = Number(tokens[i]);
    const u = tokens[i + 1] ? unidadDe(tokens[i + 1]) : null;
    out.push(u ? { valor: n * u.factor, uom: u.base, texto: `${tokens[i]} ${tokens[i + 1]}`, inicio: i, conUnidad: true }
               : { valor: n, uom: null, texto: tokens[i], inicio: i, conUnidad: false });
  }
  return out;
}

const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
/** Fecha relativa → 'AAAA-MM-DD' (hora local del equipo). */
function fecha(texto, ahora = new Date()) {
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const mas = (n) => { const d = new Date(ahora); d.setDate(d.getDate() + n); return d; };
  if (/\bpasado manana\b/.test(texto)) return { valor: iso(mas(2)), texto: 'pasado mañana', confianza: 'exacto' };
  if (/\bmanana\b/.test(texto)) return { valor: iso(mas(1)), texto: 'mañana', confianza: 'exacto' };
  if (/\bhoy\b/.test(texto)) return { valor: iso(ahora), texto: 'hoy', confianza: 'exacto' };
  if (/\bayer\b/.test(texto)) return { valor: iso(mas(-1)), texto: 'ayer', confianza: 'exacto' };
  for (let i = 0; i < 7; i++) {
    if (new RegExp(`\\b${DIAS[i]}\\b`).test(texto)) {
      let dif = (i - ahora.getDay() + 7) % 7;
      if (dif === 0) dif = 7;
      return { valor: iso(mas(dif)), texto: DIAS[i], confianza: 'probable' };
    }
  }
  return null;
}

/** Periodo para consultas: hoy · ayer · semana · semana_pasada · mes · mes_pasado · anio. */
function periodo(texto) {
  if (/\b(semana pasada|pasada semana|semana anterior)\b/.test(texto)) return 'semana_pasada';
  if (/\b(mes pasado|mes anterior)\b/.test(texto)) return 'mes_pasado';
  if (/\b(ano|anio|anual)\b/.test(texto)) return 'anio';
  if (/\b(semana|semanal|7 dias|siete dias)\b/.test(texto)) return 'semana';
  if (/\b(mes|mensual|30 dias|quincena)\b/.test(texto)) return 'mes';
  if (/\bayer\b/.test(texto)) return 'ayer';
  return 'hoy';
}
/** ¿La frase dice un periodo? (para heredar el intent anterior: «¿y ayer?»). */
const diceperiodo = (texto) => /\b(hoy|ayer|semana|mes|ano|anio|quincena)\b/.test(texto);

/**
 * Hora del día: «a las 5», «5 pm», «5:30», «a las 10 de la mañana», «al
 * mediodía». Un número suelto de 1 a 7 es de la tarde (horario de negocio).
 * @returns {{ h, m, texto, confianza }} | null
 */
function hora(texto) {
  if (/\b(mediodia|medio dia)\b/.test(texto)) return { h: 12, m: 0, texto: 'mediodía', confianza: 'exacto' };
  const m = texto.match(/\b(?:a las|a la|las|tipo|como a las|para las)\s+(\d{1,2})(?:[:.](\d{2})| y (media|cuarto))?\s*(am|pm|de la manana|de la tarde|de la noche|hrs|horas)?\b/)
         || texto.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|hrs)\b/)
         || texto.match(/\b(\d{1,2})[:](\d{2})\b/);
  if (!m) return null;
  let h = Number(m[1]);
  const extra = m[3] && !/am|pm|hrs|manana|tarde|noche|horas/.test(m[3]) ? m[3] : null;
  let min = m[2] ? Number(m[2]) : extra === 'media' ? 30 : extra === 'cuarto' ? 15 : 0;
  const sufijo = (m[4] || (m[3] && /am|pm|hrs|manana|tarde|noche|horas/.test(m[3]) ? m[3] : '') || '').trim();
  if (h > 23 || min > 59) return null;
  let confianza = 'exacto';
  if (/pm|tarde|noche/.test(sufijo) && h < 12) h += 12;
  else if (/am|manana/.test(sufijo) && h === 12) h = 0;
  else if (!sufijo && h >= 1 && h <= 7) { h += 12; confianza = 'probable'; }
  return { h, m: min, texto: `${h}:${String(min).padStart(2, '0')}`, confianza };
}

/** Folio de venta o de factura: «#123», «folio 123», «ticket 123», «venta 123». */
function folio(texto) {
  const m = texto.match(/(?:#|\b(?:folio|ticket|venta|nota|factura)\s+(?:numero\s+|no\s+)?)(\d{1,9})\b/);
  return m ? { valor: Number(m[1]), texto: m[1], confianza: 'exacto' } : null;
}

/** Mesa: «mesa 4», «la 4 pide la cuenta». */
function mesa(texto) {
  const m = texto.match(/\bmesa\s+(?:numero\s+)?(\d{1,3})\b/) || texto.match(/^(?:la|el)\s+(\d{1,3})\b/);
  return m ? { valor: Number(m[1]), texto: `mesa ${m[1]}`, confianza: 'exacto' } : null;
}

/** Forma de pago con las palabras de mostrador. */
function metodoPago(texto) {
  if (/\b(efectivo|cash|en billetes|contado|feria)\b/.test(texto)) return { valor: 'EFECTIVO', texto: 'efectivo', confianza: 'exacto' };
  if (/\b(transferencia|transferi|spei|deposito|depositado|depositaron)\b/.test(texto)) return { valor: 'TRANSFERENCIA', texto: 'transferencia', confianza: 'exacto' };
  if (/\b(tarjeta|terminal|debito|credito con tarjeta|tdc|tdd)\b/.test(texto)) return { valor: 'TARJETA', texto: 'tarjeta', confianza: 'exacto' };
  return null;
}

/** Teléfono de 10 dígitos (con o sin espacios). */
function telefono(texto) {
  const m = texto.replace(/(\d)[\s-](?=\d)/g, '$1').match(/\b(\d{10})\b/);
  return m ? { valor: m[1], texto: m[1], confianza: 'exacto' } : null;
}

/* Concepto de gasto: palabras de la calle → nombre que suele tener la categoría. */
const SINONIMOS_GASTO = [
  [/\b(luz|cfe|electricidad|recibo de luz)\b/, ['luz', 'electricidad', 'energia', 'servicios']],
  [/\b(agua|simapag|recibo del agua)\b/, ['agua', 'servicios']],
  [/\b(gas|tanque|cilindro)\b/, ['gas', 'servicios']],
  [/\b(renta|alquiler|local)\b/, ['renta', 'arrendamiento', 'alquiler']],
  [/\b(internet|telefono|telmex|izzi|totalplay|megacable|celular|saldo)\b/, ['internet', 'telefono', 'servicios']],
  [/\b(sueldo|sueldos|nomina|raya|pago al personal|semana de)\b/, ['sueldos', 'nomina', 'personal']],
  [/\b(gasolina|combustible|diesel|uber|taxi|pasaje|flete)\b/, ['gasolina', 'transporte', 'combustible', 'fletes']],
  [/\b(limpieza|cloro|jabon|escoba|trapeador)\b/, ['limpieza']],
  [/\b(papeleria|hojas|plumas|rollos de ticket|rollo)\b/, ['papeleria']],
  [/\b(mantenimiento|reparacion|arreglo|plomero|electricista|tecnico)\b/, ['mantenimiento', 'reparaciones']],
  [/\b(publicidad|anuncio|facebook|volantes|lona)\b/, ['publicidad', 'marketing']],
  [/\b(impuesto|impuestos|sat|predial|contador|contadora)\b/, ['impuestos', 'contador', 'honorarios']],
  [/\b(comida|desayuno|comidas del personal)\b/, ['comida', 'alimentos']],
  [/\b(bolsas|desechables|vasos|empaque|empaques)\b/, ['empaque', 'desechables', 'insumos']],
];
/**
 * El concepto de un gasto contra las categorías del negocio.
 * @param categorias [{ id, nombre }]
 */
function conceptoGasto(texto, categorias, normalizarFn) {
  if (!categorias?.length) return null;
  const toks = (s) => normalizarFn(s).tokens.map(raiz);
  const dichas = new Set(texto.split(' ').map(raiz));
  /* 1. La categoría se nombra tal cual («de renta»). */
  for (const c of categorias) {
    const ct = toks(c.nombre).filter((t) => t.length > 2 && !RUIDO.has(t));
    if (ct.length && ct.some((t) => dichas.has(t))) return { valor: c.id, texto: c.nombre, confianza: 'exacto' };
  }
  /* 2. Por sinónimo («cfe» → Luz). */
  for (const [re, nombres] of SINONIMOS_GASTO) {
    if (!re.test(texto)) continue;
    for (const n of nombres) {
      const c = categorias.find((x) => toks(x.nombre).includes(raiz(n)));
      if (c) return { valor: c.id, texto: c.nombre, confianza: 'exacto' };
    }
  }
  return null;
}

/**
 * Varios renglones en una frase: «3 cocas, 2 sabritas y un pan».
 * Corta por números: cada número abre un renglón con lo que sigue hasta el
 * siguiente número. El producto de cada tramo se busca en el catálogo.
 * @returns [{ cantidad, producto: {valor, texto, confianza, opciones} }]
 */
function renglones(tokens, catalogo, { excluir = new Set() } = {}) {
  const nums = tokens.map((t, i) => (/^\d+(\.\d+)?$/.test(t) && !excluir.has(i) && !(tokens[i - 1] || '').startsWith('$') ? i : -1)).filter((i) => i >= 0);
  const out = [];
  for (let k = 0; k < nums.length; k++) {
    const desde = nums[k] + 1, hasta = k + 1 < nums.length ? nums[k + 1] : tokens.length;
    const fuera = new Set(tokens.map((_, i) => i).filter((i) => i < desde || i >= hasta || excluir.has(i)));
    const p = producto(tokens, catalogo, { excluir: fuera });
    if (p) out.push({ cantidad: Number(tokens[nums[k]]), producto: p });
  }
  return out;
}

/* Palabras que nunca son parte del nombre de un producto. */
const RUIDO = new Set(('a al de del la las el los un una unos unas y o en con para por que me mi mis se le lo les ' +
  'registra registrar registro merma mermas tira tirar tire tiraron tiro cayo cayeron caducaron caduco hecha hechas ' +
  'mal precio precios cambia cambiar cambiale sube subir subele baja bajar bajale pon ponle poner cuesta cuanto cuantos cuantas ' +
  'quedan queda hay tengo tenemos falta faltan comprar producir produce produccion planea planear hacer haz hare crea crear ' +
  'nuevo nueva producto productos pesos piezas pieza pza pzas hoy manana ayer semana mes g kg ml l litro litros gramos kilos ' +
  'necesito necesita quiero alcanza alcanzan esta este estos ver dame dime agrega agregar da dar ' +
  'existencia existencias inventario stock vender vendo vendi vendido vende cuantos son suficiente suficientes tanda tandas ' +
  'charola horno basura catalogo ' +
  'lunes martes miercoles jueves viernes sabado domingo pasado echaron echo perder perdio rompieron rompio ' +
  /* Palabras de las demás áreas: órdenes y preguntas, nunca parte del nombre. */
  'cobra cobrale cobrar cobro cobrame vendele despacha cuenta cuentas total suma seria sale salen es como cuando quien quienes ' +
  'cliente clientes proveedor proveedores debe deben debo fiado fiados abono abona abonale abonar abonó pago pague pagale pagar paga ' +
  'efectivo tarjeta transferencia mesa mesas cita citas agenda agendale aparta apartale reserva cancela cancelo mueve recorre ' +
  'receta lleva ingredientes ultima ultimo vez compre compramos compra compras costo costos valor vale cuesta datos telefono numero ' +
  'surte surten trae traen movimientos kardex historial ajusta ajustar ajuste conte corrige deja realidad fisico pon ponle ' +
  'folio ticket nota factura facturar devolucion devolver regresar traspaso traspasa manda sucursal otra ' +
  'ganancia margen utilidad gano gane ganado deja dejo trajo info informacion precio todavia aun ya algo mucho poco ' +
  'mas menos mejor peor top estrella cada todo todos tienda negocio ahorita porfa favor oye wybix ver muestrame dime').split(' '));

/**
 * El producto que se nombra, buscado en el catálogo.
 *
 * Por PALABRAS, no por parecido de letras: «latte grande» encuentra «Latte
 * grande» y no «Late night». Un nombre completo es exacto; si varias
 * coinciden igual de bien, es dudoso y vuelven como opciones.
 *
 * @param tokens  del texto normalizado
 * @param catalogo [{ id, nombre, tokens: string[] (raíces), alias?: string[] }]
 * @param o { excluir: índices de tokens ya usados (números, unidades) }
 */
function producto(tokens, catalogo, { excluir = new Set() } = {}) {
  const palabras = tokens.map((t, i) => ({ t: raiz(t), i }))
    .filter(({ t, i }) => !excluir.has(i) && !RUIDO.has(t) && !RUIDO.has(tokens[i]) && !/^\$?\d/.test(t) && t.length > 1);
  if (!palabras.length) return null;
  const busca = palabras.map((p) => p.t);
  const puntuados = [];
  for (const p of catalogo) {
    const nom = p.tokens;
    const coinciden = busca.filter((w) => nom.includes(w) || (w.length >= 4 && nom.some((n) => n.startsWith(w) || w.startsWith(n) && n.length >= 4)));
    if (!coinciden.length) continue;
    /* Cuánto del nombre se dijo y cuánto de lo dicho es el nombre. */
    const cubreNombre = coinciden.length / nom.length;
    const cubreDicho = coinciden.length / busca.length;
    const exactoNombre = nom.every((n) => busca.includes(n));
    puntuados.push({ p, s: cubreNombre * 0.6 + cubreDicho * 0.4 + (exactoNombre ? 0.3 : 0), exactoNombre });
  }
  if (!puntuados.length) return { valor: null, confianza: 'dudoso', texto: busca.join(' '), opciones: [] };
  puntuados.sort((a, b) => b.s - a.s || a.p.nombre.length - b.p.nombre.length);
  /* Un producto con apodo aparece dos veces (su nombre y su apodo): cuenta el mejor. */
  const clave = (x) => (x.p.tipo ? `${x.p.tipo}:${x.p.id}` : x.p.id);
  for (let i = puntuados.length - 1; i > 0; i--) if (puntuados.slice(0, i).some((x) => clave(x) === clave(puntuados[i]))) puntuados.splice(i, 1);
  const [a, b] = puntuados;
  const opciones = puntuados.slice(0, 5).map((x) => ({ etiqueta: x.p.nombre, valor: x.p.id, nota: x.p.nota }));
  const claro = a.exactoNombre && (!b || b.s < a.s - 0.15 || !b.exactoNombre || b.p.tokens.length > a.p.tokens.length);
  if (claro) return { valor: a.p.id, confianza: 'exacto', texto: a.p.nombre, opciones };
  if (!b || a.s - b.s >= 0.25) return { valor: a.p.id, confianza: 'probable', texto: a.p.nombre, opciones };
  return { valor: null, confianza: 'dudoso', texto: busca.join(' '), opciones };
}

/** Motivo de merma con las palabras de un mostrador. */
function motivoMerma(texto) {
  if (/\b(caduc|venci|echaron a perder|echo a perder|se perdio|se perdieron|rancio|aceda|pasad)/.test(texto)) return 'CADUCADO';
  if (/\b(cayo|cayeron|tiro al piso|rompi|rompio|rompieron|quebr|revent)/.test(texto)) return 'SE_CAYO';
  if (/\b(mal hech|quem|crud|salio mal|salieron mal|defect)/.test(texto)) return 'MAL_HECHO';
  if (/\b(degust|probar|prueba|muestra|regalo|cortesia)/.test(texto)) return 'DEGUSTACION';
  return null;
}

module.exports = { dinero, cantidades, fecha, periodo, diceperiodo, hora, folio, mesa, metodoPago, telefono, conceptoGasto, renglones,
                   producto, motivoMerma, unidadDe, RUIDO };
