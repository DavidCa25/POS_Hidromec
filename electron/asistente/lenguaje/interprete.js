'use strict';
/**
 * EL INTÉRPRETE: texto → intent + datos tipados + qué falta preguntar.
 *
 *   normalizar → corregir dedazos → extraer (dinero, cantidades, fecha,
 *   hora, folio, producto, persona) → marcar (<num>, <dinero>, <prod>,
 *   <persona>) → clasificar (naive Bayes + palabras clave + encaje) → llenar
 *   los datos del intent → heredar del contexto lo que falte → decir qué
 *   falta o es dudoso.
 *
 * Nunca adivina: un producto o una persona dudosa vuelve con opciones y se
 * pregunta; un intent con poca seguridad vuelve con alternativas.
 */
const { normalizar, raiz } = require('./normalizar');
const ex = require('./extractores');
const { INTENTS, DESTINOS, porId, disponible } = require('./intents');
const { entrenar, predecir } = require('./clasificador');
const { generar } = require('./corpus');
const { indicesNumericos, marcar } = require('./marcas');
const { conceptos, lema, COMUNES } = require('./lexico');
/* Palabras que solas no prueban un producto: «profesionales» no es el
   «Shampoo profesional», «grande» no es el «Latte grande». */
const SOLO_ADJETIVOS = new Set(['profesional', 'profesionales', 'grande', 'grandes', 'chico', 'chicos', 'chica', 'chicas', 'mediano',
  'mediana', 'natural', 'original', 'blanco', 'blanca', 'negro', 'negra', 'entera', 'entero', 'sencilla', 'sencillo', 'normal', 'especial',
  'clasico', 'clasica', 'dia', 'central', 'express', 'pro', 'kilo', 'litro', 'orden', 'bolsa', 'paquete', 'caja', 'nuevo', 'nueva']);
const { senalesDe } = require('./senales');
const { filtros: filtrosDe } = require('./filtros');
const { apodo } = require('./apodos');
const { preguntaLibre } = require('./pregunta');
const ref = require('./referencias');
const { edicion, edicionPersona, valorDeCampo, valorPersona } = require('./edicion');
const EDITAR_PERSONA = { cliente: 'cliente.editar', proveedor: 'proveedor.editar' };
const { catalogo: reglaCatalogo } = require('./catalogo');
const { socios: reglaSocios } = require('./socios');
const { gastos: reglaGastos } = require('./gastos');
const { servicios: reglaServicios } = require('./servicios');
const EDITAR = new Set(['producto.editar', 'producto.baja', 'producto.impuesto']);
/* «No sé», «ninguno»: saltar un dato que se pregunta sin ser obligatorio. */
const SALTAR = /^(?:no|no se|nose|ni idea|ninguno|ninguna|nada|ningun|despues|luego|ahorita no|todavia no|aun no|sin costo|no tengo|0|cero|paso|siguiente)$/;

/* Después de cuáles respuestas «¿por qué?» pide la explicación del número. */
const POR_QUE_DE = new Set(['consulta.hoy', 'venta.top', 'venta.por_pago', 'venta.horas', 'finanzas.ganancia', 'personal.ventas',
                            'analisis.libre', 'venta.comparar', 'finanzas.resultado']);
/* Los intents que ya contestan una agrupación con sus propias palabras: si la
   pregunta libre pide exactamente eso, se quedan con ellos. */
const AGRUPA_YA = { 'venta.top': ['producto', 'piezas'], 'venta.por_pago': ['metodo', 'ventas'], 'venta.horas': ['hora', 'ventas'],
                    'personal.ventas': ['cajero', 'ventas'], 'cliente.top': ['cliente', 'ventas'] };
/* Las que sí son de ventas (la pregunta libre puede ganarles). */
const ANALITICOS = new Set([...POR_QUE_DE, 'cliente.top', 'analisis.pronostico']);
const NO_ES_VENTA = /\b(?:gastos?|gaste|compras?|compre|citas?|huecos?|agenda|pedidos?|faltan?|acabando|terminarse|terminando|por terminar|surtir|proveedores?|deudas?|debe|deben)\b/;

/* «abre inventario», «llévame a compras»: verbo de ir + una pantalla. */
const IR = /^(?:oye |wybix |oye wybix |porfa )*(?:abre|abreme|abrir|abrime|llevame|lleva|ve|vete|ir|vamos|entra|entrar|pasame|mandame|regresame|muestrame la pantalla de|quiero ir|quiero ver la pantalla de)\b/;
/* «¿cómo hago…?», «¿dónde veo…?»: preguntas de uso de Wybix. */
const COMO = /^(?:oye |wybix |oye wybix |y )*(?:(?:donde|en donde)\s+(?:esta|estan|queda|quedan)\b|(?:como|donde|en donde|de que forma)\s+(?:(?:se|le|lo|la)\s+)?(?:hago|hace|hacen|registro|registra|doy|da|meto|mete|cancelo|cancela|configuro|configura|agrego|agrega|cambio|cambia|veo|ve|pongo|pone|activo|activa|importo|respaldo|reimprimo|divido|mando|abro|agendo|facturo|factura|cobro|cobra|saco|quito|creo|crea|ingreso|capturo|uso|usa|consulto|encuentro|imprimo|asigno|reviso|elimino|borro|edito)\b)/;

/* «doña Mary», «don Pepe», «la señora Lupe»: lo que sigue es una persona. */
const HONORIFICOS = new Set(['don', 'dona', 'sr', 'sra', 'senor', 'senora', 'seno', 'lic', 'licenciado', 'licenciada', 'ing', 'doc', 'doctor', 'doctora', 'profe', 'maestro', 'maestra', 'joven', 'srita', 'senorita']);
const MULETILLAS = ['el', 'la', 'los', 'las', 'a', 'al', 'oye', 'wybix', 'porfa', 'por', 'favor', 'ver', 'ahorita', 'y', 'de', 'del', 'con', 'para', 'que', 'tal', 'pues', 'entonces', 'ok', 'y'];
const PERSONA_SLOTS = { cliente: 'cliente', proveedor: 'proveedor', profesional: 'profesional' };

/** El catálogo (o la lista de personas) listo para buscar por palabras. */
function prepararCatalogo(filas) {
  return (filas || []).filter((p) => p && p.nombre).map((p) => ({
    ...p, tokens: normalizar(p.nombre).tokens.map(raiz).filter((t) => (!ex.RUIDO.has(t) || t.length > 3) && !HONORIFICOS.has(t)),
    codigos: codigosDe(p),
  })).filter((p) => p.tokens.length);
}

/**
 * Código de barras y número de parte (SKU), como palabras normalizadas:
 * «actualiza el 7501055300846 a 25». Un código solo de números necesita 6
 * dígitos o más (para no confundir «600» de «coca de 600» con un código); uno
 * con letras, 4 caracteres o más.
 */
function codigosDe(p) {
  return [p.bar_code, p.part_number].map((c) => normalizar(String(c ?? '')).tokens)
    .filter((ts) => { const s = ts.join(''); return ts.length && (/^\d+$/.test(s) ? s.length >= 6 : s.length >= 4); });
}

/**
 * ¿La frase dice el código de un producto? Devuelve los índices de las
 * palabras del código y los productos que lo tienen (más de uno si el código
 * se repite: entonces se pregunta cuál).
 */
function buscarCodigo(tokens, catalogo) {
  let mejor = null;
  for (const p of catalogo) {
    for (const c of p.codigos || []) {
      for (let i = 0; i + c.length <= tokens.length; i++) {
        if (!c.every((w, k) => tokens[i + k] === w)) continue;
        const idx = c.map((_, k) => i + k);
        if (!mejor || idx.length > mejor.idx.length) mejor = { idx, ids: [p.id], nombres: [p.nombre] };
        else if (idx.length === mejor.idx.length && idx[0] === mejor.idx[0] && !mejor.ids.includes(p.id)) { mejor.ids.push(p.id); mejor.nombres.push(p.nombre); }
      }
    }
  }
  return mejor;
}

/** Todas las palabras con las que se nombra un id: su nombre y sus apodos. */
const tokensDeId = (lista, id) => lista.filter((p) => p.id === id).flatMap((p) => p.tokens);

/** Índices de la frase que forman el nombre encontrado. */
function indicesDe(tokens, nombre, excluir) {
  const out = new Set();
  tokens.forEach((t, i) => {
    if (excluir.has(i)) return;
    const r = raiz(t);
    if (nombre.some((n) => r === n || (r.length >= 4 && n.startsWith(r)))) out.add(i);
  });
  return out;
}

function crearInterprete({ frasesNegocio = [], semilla = 7, sinApartadas = false } = {}) {
  /* Corpus de fábrica + lo que este negocio confirmó (pesa más: se repite). */
  const ejemplos = generar({ semilla, sinApartadas });
  for (const f of frasesNegocio) {
    const t = analizar(f.texto, [], {}).marcados;
    for (let k = 0; k < 3; k++) ejemplos.push({ intent: f.intent, tokens: t });
  }
  const modelo = entrenar(ejemplos);
  /* Las palabras (sin plural) que aparecen en alguna frase de entrenamiento:
     con ellas se mide si una frase es del negocio o de otro tema. */
  const delCorpus = new Set();
  for (const e of ejemplos) for (const t of e.tokens) if (!t.startsWith('<')) delCorpus.add(raiz(t));

  /* Las palabras que Wybix conoce, con cuántas veces aparecen: para corregir
     errores de dedo hacia una palabra conocida y no hacia cualquiera. */
  const conocidas = new Map();
  const sumar = (w, n = 1) => { if (w && !w.startsWith('<') && !/^\d/.test(w)) conocidas.set(w, (conocidas.get(w) || 0) + n); };
  for (const e of ejemplos) for (const t of e.tokens) sumar(t);
  for (const i of INTENTS) for (const k of i.claves) sumar(k, 5);
  for (const w of ex.RUIDO) sumar(w, 2);
  for (const w of COMUNES) sumar(w, 1);
  /* Raíces conocidas: «dejar» no es un dedazo de «deja», es otra forma del mismo verbo. */
  const lemasConocidos = new Set([...conocidas.keys()].map(lemaSuave));
  for (const [re] of DESTINOS) for (const w of String(re.source).match(/[a-z]{4,}/g) || []) sumar(w, 3);

  /**
   * @param o { personas (prepararCatalogo), precioConPreposicion }
   */
  function analizar(texto, catalogo, o = {}) {
    const personas = o.personas || [];
    const norm0 = normalizar(texto);
    /* Los nombres del catálogo y su plural: «cocnhas» se corrige a «conchas». */
    const extra = new Set([...catalogo, ...personas].flatMap((p) => normalizar(p.nombre).tokens)
      .flatMap((t) => (t.length >= 4 && /[a-z]$/.test(t) ? [t, /[aeiou]$/.test(t) ? `${t}s` : `${t}es`] : [t])));
    const tokens = conocidas.size ? norm0.tokens.map((t) => (lemasConocidos.has(lemaSuave(t)) ? t : corregir(t, conocidas, extra))) : norm0.tokens;
    const norm = tokens.join(' ');
    /* El código de barras o el SKU de un producto ES el producto: no es una
       cantidad ni un precio. Para los números se tapa con una palabra neutra. */
    const codigo = catalogo.length ? buscarCodigo(norm0.tokens, catalogo) : null;
    const paraNumeros = codigo ? tokens.map((w, i) => (codigo.idx.includes(i) ? 'xcodigox' : w)) : tokens;
    const { dineroIdx, numIdx, cants, din } = indicesNumericos(paraNumeros, { precioConPreposicion: o.precioConPreposicion !== false });
    const excluir = new Set([...dineroIdx, ...numIdx]);
    tokens.forEach((t, i) => { if (HONORIFICOS.has(t)) excluir.add(i); });

    /* Producto. «tengo harina para 100 conchas»: lo que se cuenta es lo que
       sigue al número; primero se busca en ese tramo, luego en toda la frase. */
    let prod = null, cantDelProd = null;
    if (codigo) {
      prod = codigo.ids.length === 1
        ? { valor: codigo.ids[0], texto: codigo.nombres[0], confianza: 'exacto', porCodigo: true }
        : { valor: null, texto: codigo.idx.map((i) => norm0.tokens[i]).join(' '), confianza: 'dudoso', porCodigo: true,
            opciones: codigo.ids.map((v, k) => ({ valor: v, etiqueta: codigo.nombres[k] })) };
    } else if (catalogo.length) {
      for (const c of cants) {
        let desde = c.inicio + (c.conUnidad ? 2 : 1);
        while (['de', 'del', 'la', 'las', 'los', 'el'].includes(tokens[desde])) desde++;
        if (!tokens[desde] || ex.RUIDO.has(tokens[desde]) || /^\d/.test(tokens[desde])) continue;
        const tramo = new Set(tokens.map((_, i) => i).filter((i) => i < desde || i > desde + 4 || excluir.has(i)));
        const p = ex.producto(tokens, catalogo, { excluir: tramo });
        if (p && p.valor != null) { prod = p; cantDelProd = c; break; }
      }
      if (!prod) prod = ex.producto(tokens, catalogo, { excluir });
    }
    /* «Coca de 600» o «la coca grande» entre la de 600 ml y la de 2 L: el
       número y el adjetivo no cuentan para buscar, pero si solo UNA de las
       opciones lo lleva en su nombre, es esa. */
    if (!codigo && prod && prod.valor == null && prod.opciones?.length > 1) {
      const nums = tokens.filter((t) => /^\d+(?:\.\d+)?$/.test(t) || SOLO_ADJETIVOS.has(t));
      const conNum = prod.opciones.filter((o) => nums.some((x) => tokensDeId(catalogo, o.valor).includes(x)));
      if (conNum.length === 1) prod = { valor: conNum[0].valor, texto: conNum[0].etiqueta, confianza: 'exacto' };
    }
    let prodIdx = new Set();
    if (codigo) prodIdx = new Set(codigo.idx);
    else if (prod && prod.valor != null) prodIdx = indicesDe(tokens, tokensDeId(catalogo, prod.valor), excluir);
    /* Producto en duda («huevo»: ¿el kilo o los rancheros?): igual es un
       producto para el clasificador; cuál, se pregunta después. */
    else if (prod?.opciones?.length) {
      const nombres = prod.opciones.slice(0, 3).flatMap((o) => tokensDeId(catalogo, o.valor));
      prodIdx = indicesDe(tokens, nombres, excluir);
    }
    /* …salvo que vaya junto a una palabra desconocida: «late grande» es un
       dedazo de «Latte grande», y entonces el adjetivo sí cuenta. */
    const desconocida = (i) => tokens[i] && !conocidas.has(tokens[i]) && !ex.RUIDO.has(tokens[i]) && !/^\d/.test(tokens[i]);
    if (!codigo && prod && prod.confianza !== 'exacto' && prodIdx.size && [...prodIdx].every((i) => SOLO_ADJETIVOS.has(tokens[i]))
        && ![...prodIdx].some((i) => desconocida(i - 1) || desconocida(i + 1))) {
      prod = null; prodIdx = new Set(); cantDelProd = null;
    }

    /* Persona: después de un honorífico, o por su nombre. Si un nombre es a
       la vez producto y persona («Lala»), gana el que cubre más palabras. */
    let persona = null, personaIdx = new Set();
    const personaTipo = new Map();
    if (personas.length) {
      persona = ex.producto(tokens, personas, { excluir });
      const cand = persona && (persona.valor != null ? personas.find((p) => p.id === persona.valor)
        : persona.opciones?.length ? personas.find((p) => p.id === persona.opciones[0].valor) : null);
      /* Una sola palabra común que no es el nombre completo («gas» de «Gas
         Express», «central» de «Harinera Central») no basta para una persona. */
      const idx0 = cand ? indicesDe(tokens, tokensDeId(personas.filter((p) => p.tipo === cand.tipo), cand.id), excluir) : new Set();
      if (cand && persona.confianza !== 'exacto' && idx0.size === 1 && cand.tokens.length > 1 && conceptos(tokens[[...idx0][0]]).length) {
        persona = null;
      } else if (cand) {
        const idx = idx0;
        const cruce = [...idx].some((i) => prodIdx.has(i));
        const gana = !cruce || idx.size > prodIdx.size
          || (idx.size === prodIdx.size && persona.confianza === 'exacto' && prod?.confianza !== 'exacto');
        if (gana && idx.size && (persona.valor != null || !cruce)) {
          personaIdx = idx;
          if (cruce) { prod = null; prodIdx = new Set(); cantDelProd = null; }
          /* Si la duda es entre personas del mismo tipo, el tipo sí se sabe. */
          const tipos = new Set((persona.valor != null ? [cand] : persona.opciones.map((o) => personas.find((p) => p.id === o.valor))).map((p) => p?.tipo));
          for (const i of idx) personaTipo.set(i, tipos.size === 1 ? cand.tipo : 'persona');
        } else persona = null;
      } else if (persona?.opciones?.length === 0) persona = null;
    }
    /* Honorífico + palabra que no es de nadie: sigue siendo una persona (y
       con «don» o «doña», casi siempre un cliente). */
    tokens.forEach((t, i) => {
      if (HONORIFICOS.has(t) && tokens[i + 1] && !excluir.has(i + 1) && !prodIdx.has(i + 1) && !ex.RUIDO.has(tokens[i + 1]) && !personaIdx.has(i + 1)) {
        personaIdx.add(i); personaIdx.add(i + 1);
        personaTipo.set(i, 'cliente'); personaTipo.set(i + 1, 'cliente');
        if (!persona) persona = { valor: null, confianza: 'dudoso', texto: tokens[i + 1], opciones: [] };
      } else if (HONORIFICOS.has(t) && personaIdx.has(i + 1)) { personaIdx.add(i); personaTipo.set(i, personaTipo.get(i + 1)); }
    });
    for (const i of personaIdx) { prodIdx.delete(i); }
    /* «corte de cabello» es UNA marca: el «de» de en medio también es del nombre. */
    const rellenar = (idx) => {
      const xs = [...idx].sort((x, y) => x - y);
      for (let k = 0; k < xs.length - 1; k++) {
        if (xs[k + 1] - xs[k] === 2 && ['de', 'del', 'la', 'el', 'con', 'y', 'en'].includes(tokens[xs[k] + 1])) idx.add(xs[k] + 1);
      }
    };
    rellenar(prodIdx); rellenar(personaIdx);
    for (const i of personaIdx) if (!personaTipo.has(i)) personaTipo.set(i, personaTipo.get(i - 1) || 'persona');

    return { norm, normOriginal: norm0.texto, tokensOriginales: norm0.tokens, crudo: String(texto || '').toLowerCase(), tokens, cants, din, prod, cantDelProd, persona,
             marcados: marcar(tokens, { dineroIdx, numIdx, prodIdx, personaIdx, personaTipo }), excluir, prodIdx, personaIdx, personaTipo };
  }

  function puntuar(a, modulos) {
    const nb = predecir(modelo, a.marcados);
    const claves = {};
    for (const it of INTENTS) {
      const hits = it.claves.filter((k) => a.tokens.some((t) => t === k || (k.length >= 4 && t.startsWith(k)))).length;
      claves[it.id] = hits ? Math.min(1, hits / 2) : 0;
    }
    /* Lo que la frase TRAE también cuenta: «qué me falta comprar» no tiene
       número ni producto, así que no es «qué me falta para producir N». */
    const tieneNum = a.cants.length > 0, tieneProd = !!(a.prod && (a.prod.valor != null || a.prod.opciones?.length));
    const tienePersona = a.personaIdx.size > 0;
    const tiposDichos = new Set([...a.personaTipo.values()].filter((t) => t !== 'persona'));
    const nombraTipo = /\b(proveedor|proveedores|cliente|clientes|profesional|estilista|barbero)\b/.test(a.norm);
    const diceGasto = /\b(luz|cfe|gas|renta|agua|internet|telefono|sueldos?|nomina|raya|gasolina|predial|contador|limpieza|papeleria|publicidad|basura|bolsas)\b/.test(a.norm);
    const senales = senalesDe(a.norm, a.marcados);
    const encaja = (id) => {
      const sl = porId(id)?.slots || {};
      let f = 1;
      if (sl.producto?.requerido && !tieneProd) f *= 0.85;
      /* La persona dicha es de un tipo: los intents de otro tipo no van. */
      const tiposIntent = ['cliente', 'proveedor', 'profesional'].filter((k) => sl[k]);
      if (tiposDichos.size && tiposIntent.length && !tiposIntent.some((t) => tiposDichos.has(t))) f *= 0.45;
      if (tiposIntent.some((k) => sl[k].requerido) && !tienePersona && !nombraTipo) f *= 0.8;
      if (sl.concepto && diceGasto) f *= 1.15;
      if (sl.cantidad?.requerido && !tieneNum && !tieneProd) f *= 0.55;
      if (Object.keys(sl).length === 0 && tieneNum && tieneProd) f *= 0.6;
      if (sl.renglones?.requerido && !(tieneNum && tieneProd)) f *= 0.6;
      if (sl.folio?.requerido && !tieneNum) f *= 0.6;
      if (sl.mesa?.requerido && !tieneNum && !/\bmesa\b/.test(a.norm)) f *= 0.6;
      const pideProd = sl.producto?.requerido || sl.renglones?.requerido;
      const pidePersona = ['cliente', 'proveedor', 'profesional'].some((k) => sl[k]?.requerido);
      if (pidePersona && !tienePersona && tieneProd) f *= 0.7;
      if (pideProd && !tieneProd && tienePersona) f *= 0.7;
      return f;
    };
    /* ¿Es del negocio? «el perro de mi vecino» tiene casi todas sus palabras
       fuera del corpus y ningún dato (producto, persona, número): de otro
       tema. Baja la seguridad de todo, y Wybix dice que no entendió. */
    const VACIAS_OOD = ['mi', 'me', 'se', 'un', 'una', 'es', 'muy', 'que', 'en', 'lo', 'le', 'su', 'mis', 'tu', 'te'];
    /* Se mide con las palabras como se escribieron: un dedazo corregido hacia
       una palabra conocida («japon» → «jamon») no prueba que sea del negocio. */
    const contenido = a.tokensOriginales.filter((t, i) => !a.prodIdx.has(i) && !a.personaIdx.has(i) && !/^\d|^\$/.test(t)
      && !MULETILLAS.includes(t) && !VACIAS_OOD.includes(t));
    /* Un dedazo que se corrigió a una palabra del corpus cuenta como medio visto. */
    const corregidas = new Map(a.tokensOriginales.map((t, i) => [t, a.tokens[i]]));
    const vistas = contenido.reduce((n, t) => n + (delCorpus.has(raiz(t)) ? 1 : delCorpus.has(raiz(corregidas.get(t) || '')) ? 0.5 : 0), 0);
    /* «un» y «una» no son un dato: «cuéntame un chiste» no trae cantidad. */
    const cantsReales = a.cants.filter((c) => !(c.valor === 1 && !/(^|\D)1(\D|$)/.test(a.crudo)));
    const sinDatos = !a.prodIdx.size && !a.personaIdx.size && !cantsReales.length && !a.din;
    const cobertura = contenido.length ? vistas / contenido.length : 1;
    const ajeno = !sinDatos || contenido.length < 2 ? 1 : cobertura < 0.6 ? 0.55 : 1;
    const total = nb.ranking.filter(({ intent }) => disponible(intent, modulos) && !porId(intent)?.soloRegla)
      /* Una señal es un patrón preciso: suma al suyo y resta a los demás. */
      .map(({ intent, p }) => ({ intent, s: (0.75 * p + 0.25 * (claves[intent] || 0) + (senales.has(intent) ? 0.8 : 0))
                                            * encaja(intent) * (senales.size && !senales.has(intent) ? 0.7 : 1) * (senales.has(intent) ? 1 : ajeno) }));
    total.sort((x, y) => y.s - x.s);
    return { ranking: total, conocidos: nb.conocidos, claves };
  }

  /**
   * @param texto
   * @param o { catalogo, personas, categorias, conceptos (categorías de gasto), modulos (Set), ahora,
   *            esperando: { intent, slots, falta }  (lo que Wybix preguntó antes)
   *            contexto:  { intent, slots }          (lo último que se entendió, para «¿y ayer?») }
   */
  function interpretar(texto, { catalogo = [], personas = [], categorias = [], conceptos = [], usuarios = [], socios = [], modulos = null, ahora = new Date(),
                                esperando = null, contexto = null } = {}) {
    const a = analizar(texto, catalogo, { personas });
    const datos = { catalogo, personas, categorias, conceptos, usuarios, ahora };

    /* «A la coca de 600 dile la roja»: enseñar un apodo. Es una regla, no
       una predicción: si la frase tiene esa forma, es eso. */
    const ap = !esperando && apodo(a.normOriginal);
    if (ap && disponible(ap.borrar ? 'sistema.alias_olvidar' : 'sistema.alias', modulos)) {
      if (ap.borrar) return cerrar('sistema.alias_olvidar', { alias: { valor: ap.alias, texto: ap.alias, confianza: 'exacto' } }, 0.95, []);
      return cerrar('sistema.alias', { alias: { valor: ap.alias, texto: ap.alias, confianza: 'exacto' },
                                       objetivo: objetivoDe(analizar(ap.objetivo, catalogo, { personas }), personas, ap.objetivo) }, 0.95, []);
    }

    /* «Llámame Jesús», «sin gráficas», «léeme las respuestas»: cómo hablarle a
       esta persona. Regla, no predicción. El nombre se toma como se escribió
       (con acentos). */
    const pref = !esperando && ref.preferencia(a.normOriginal);
    if (pref && disponible('sistema.preferencia', modulos)) {
      if (pref.cambios?.nombre) {
        const dicho = String(texto).trim().replace(/[¡!¿?.,]+/g, ' ').trim().split(/\s+/).pop() || pref.cambios.nombre;
        pref.cambios.nombre = dicho.charAt(0).toUpperCase() + dicho.slice(1).toLowerCase();
      }
      return cerrar('sistema.preferencia', { preferencia: { valor: pref, texto: a.normOriginal, confianza: 'exacto' } }, 0.95, []);
    }

    /* «Cambia el costo de la concha a 8», «ponle el código 750… a la coca»,
       «da de baja la concha»: editar la ficha. Regla, no predicción
       (lenguaje/edicion.js). Si Wybix preguntó el valor o el producto, la
       respuesta suelta lo llena. */
    if (esperando && EDITAR.has(esperando.intent)) {
      const slots = { ...esperando.slots };
      if (esperando.falta === 'valor') {
        const v = valorDeCampo(slots.campo?.valor, texto);
        if (v != null) slots.valor = { valor: v, texto: String(texto).trim(), confianza: 'exacto' };
        return cerrar(esperando.intent, slots, 1, []);
      }
      if (esperando.falta === 'producto') {
        const pr = a.prod?.confianza === 'dudoso' && slots.producto?.opciones?.length ? null : a.prod;
        const elegido = slots.producto?.opciones?.length ? elegirOpcion(a.norm, slots.producto.opciones) : null;
        if (elegido) slots.producto = { valor: elegido.valor, texto: elegido.etiqueta, confianza: 'exacto' };
        else if (pr && (pr.valor != null || pr.opciones?.length)) slots.producto = pr;
        return cerrar(esperando.intent, slots, 1, []);
      }
    }
    /* «Cambia el teléfono de doña Mary a 55…», «el correo de Bimbo es …»:
       editar la ficha de un cliente o proveedor. Solo si la persona existe. */
    if (esperando && Object.values(EDITAR_PERSONA).includes(esperando.intent) && esperando.falta === 'valor') {
      const slots = { ...esperando.slots };
      const v = valorPersona(slots.campo?.valor, texto);
      if (v != null) slots.valor = { valor: v, texto: String(v), confianza: 'exacto' };
      return cerrar(esperando.intent, slots, 1, []);
    }
    const ep = !esperando && edicionPersona(texto);
    if (ep && ep.textoPersona) {
      const tipos = ep.tipo ? [ep.tipo] : ['cliente', 'proveedor'];
      for (const tipo of tipos) {
        const lista = personas.filter((x) => x.tipo === tipo);
        const r = lista.length ? ex.producto(normalizar(ep.textoPersona).tokens, lista, { excluir: new Set() }) : null;
        if (!r || (r.valor == null && !r.opciones?.length) || !disponible(EDITAR_PERSONA[tipo], modulos)) continue;
        if (r.valor == null && !ep.tipo && tipo === 'cliente') {
          const otro = personas.filter((x) => x.tipo === 'proveedor');
          const rp = otro.length ? ex.producto(normalizar(ep.textoPersona).tokens, otro, { excluir: new Set() }) : null;
          if (rp?.valor != null) continue;
        }
        const slots = { [tipo]: { valor: r.valor, texto: r.texto, confianza: r.valor != null ? r.confianza : 'dudoso', opciones: r.opciones },
                        campo: { valor: ep.campo, texto: ep.campo, confianza: 'exacto' } };
        if (ep.valor != null) slots.valor = { valor: ep.valor, texto: ep.valorTexto, confianza: 'exacto' };
        return cerrar(EDITAR_PERSONA[tipo], slots, 0.95, []);
      }
    }
    /* Servicios: órdenes, profesionales, catálogo de servicios, activos del
       cliente y giro (lenguaje/servicios.js). Una persona o producto que no
       existe no cuenta: la frase sigue su camino. */
    if (esperando?.intent === 'orden.cancelar' && esperando.falta === 'motivo') {
      return cerrar('orden.cancelar', { ...esperando.slots, motivo: { valor: String(texto).trim().slice(0, 200), texto: String(texto).trim(), confianza: 'exacto' } }, 1, []);
    }
    const rv = !esperando && reglaServicios(texto, ahora);
    if (rv && disponible(rv.intent, modulos)) {
      const ex1 = (v, t = String(v)) => ({ valor: v, texto: t, confianza: 'exacto' });
      const persona = (txt, tipo) => {
        const lista = personas.filter((x) => x.tipo === tipo);
        const r = lista.length && txt ? ex.producto(normalizar(txt).tokens, lista, { excluir: new Set() }) : null;
        return r && (r.valor != null || r.opciones?.length) ? { valor: r.valor, texto: r.texto, confianza: r.valor != null ? r.confianza : 'dudoso', opciones: r.opciones } : null;
      };
      const producto = (txt) => {
        const ap = txt ? analizar(txt, catalogo, { personas: [] }) : null;
        return ap?.prod && (ap.prod.valor != null || ap.prod.opciones?.length) ? { prod: ap.prod, cant: ap.cants?.[0]?.valor ?? null } : null;
      };
      const slots = {};
      for (const k of ['folio', 'reportado', 'motivo', 'diagnostico', 'via', 'autoriza', 'estado', 'precio', 'nombre', 'duracion', 'activo', 'preset',
                       'clase', 'etiqueta', 'identificador', 'anio', 'puesto', 'quitar', 'dias', 'desde', 'hasta', 'fechas']) {
        if (rv[k] != null) slots[k] = ex1(rv[k], typeof rv[k] === 'object' ? JSON.stringify(rv[k]) : String(rv[k]));
      }
      let ok = true;
      if (rv.textoCliente != null) { const c = persona(rv.textoCliente, 'cliente'); if (c) slots.cliente = c; else ok = false; }
      if (rv.textoProfesional != null) { const p = persona(rv.textoProfesional, 'profesional'); if (p) slots.profesional = p; else ok = false; }
      if (rv.textoProducto != null) {
        const p = producto(rv.textoProducto);
        if (p) { slots.producto = p.prod; if (p.cant != null && rv.intent === 'orden.linea') slots.cantidad = ex1(p.cant); } else ok = false;
      }
      if (ok) return cerrar(rv.intent, slots, 0.95, []);
    }
    /* Socios y propinas: «Juan retiró 500», «liquida a los socios»,
       «reparte las propinas». El socio tiene que existir (y estar activo). */
    const rs = !esperando && reglaSocios(texto);
    if (rs && disponible(rs.intent, modulos)) {
      if (rs.intent === 'propinas.repartir' || rs.intent === 'socio.liquidar') {
        return cerrar(rs.intent, rs.hasta ? { hasta: { valor: rs.hasta, texto: rs.hasta, confianza: 'exacto' } } : {}, 0.95, []);
      }
      const llanoS = (x) => normalizar(x).texto;
      const dicho = llanoS(rs.socio);
      const s = socios.find((x) => llanoS(x.nombre) === dicho)
        || socios.find((x) => dicho && (llanoS(x.nombre).split(' ').includes(dicho) || llanoS(x.nombre).startsWith(dicho)));
      if (s) {
        const slots = { socio: { valor: s.id, texto: s.nombre, confianza: 'exacto' } };
        if (rs.tipo) slots.tipo = { valor: rs.tipo, texto: rs.tipo, confianza: 'exacto' };
        if (rs.monto != null) slots.monto = { valor: rs.monto, texto: '$' + rs.monto, confianza: 'exacto' };
        if (rs.metodo) slots.metodo = { valor: rs.metodo, texto: rs.metodo, confianza: 'exacto' };
        if (rs.folio) slots.folio = { valor: rs.folio, texto: String(rs.folio), confianza: 'exacto' };
        if (rs.pago != null) slots.pago = { valor: rs.pago, texto: rs.pago ? 'lo pagó' : 'a su cargo', confianza: 'exacto' };
        return cerrar(rs.intent, slots, 0.95, []);
      }
    }
    /* «Cancela el gasto 12», «crea el concepto de gasto Gasolina». Si Wybix
       preguntó por qué se cancela, la respuesta entera es el motivo. */
    if (esperando?.intent === 'gasto.cancelar' && esperando.falta === 'motivo') {
      return cerrar('gasto.cancelar', { ...esperando.slots, motivo: { valor: String(texto).trim().slice(0, 200), texto: String(texto).trim(), confianza: 'exacto' } }, 1, []);
    }
    const rg = !esperando && reglaGastos(texto);
    if (rg && disponible(rg.intent, modulos)) {
      const slots = {};
      for (const k of ['folio', 'motivo', 'accion', 'nombre', 'concepto']) if (rg[k] != null) slots[k] = { valor: rg[k], texto: String(rg[k]), confianza: 'exacto' };
      if (rg.concepto) {
        const c = ex.conceptoGasto(normalizar(rg.concepto).texto, conceptos, normalizar);
        if (c?.valor != null) slots.concepto = c;
      }
      return cerrar(rg.intent, slots, 0.95, []);
    }
    /* «Crea la categoría Lácteos», «Bimbo me surte las conchas». */
    const rc = !esperando && reglaCatalogo(texto);
    if (rc && disponible(rc.intent, modulos)) {
      if (rc.intent !== 'producto.proveedor') return cerrar(rc.intent, { nombre: { valor: rc.nombre, texto: rc.nombre, confianza: 'exacto' } }, 0.95, []);
      const provs = personas.filter((x) => x.tipo === 'proveedor');
      const pv = provs.length ? ex.producto(normalizar(rc.textoProveedor).tokens, provs, { excluir: new Set() }) : null;
      const ap = analizar(rc.textoProducto, catalogo, { personas: [] });
      const pr = ap?.prod && (ap.prod.valor != null || ap.prod.opciones?.length) ? ap.prod : null;
      if (pv && (pv.valor != null || pv.opciones?.length) && pr) {
        return cerrar('producto.proveedor', {
          proveedor: { valor: pv.valor, texto: pv.texto, confianza: pv.valor != null ? pv.confianza : 'dudoso', opciones: pv.opciones },
          producto: pr, accion: { valor: rc.accion, texto: rc.accion, confianza: 'exacto' } }, 0.95, []);
      }
    }
    const ed = !esperando && edicion(texto);
    if (ed && EDITAR.has(ed.intent) && disponible(ed.intent, modulos)) {
      const ap = ed.textoProducto ? analizar(ed.textoProducto, catalogo, { personas }) : null;
      let producto = ap?.prod && (ap.prod.valor != null || ap.prod.opciones?.length) ? ap.prod : null;
      /* «Cámbiale el costo a 8» después de hablar de la concha: esa. */
      if (!producto && contexto?.slots?.producto?.valor != null) producto = contexto.slots.producto;
      const slots = {};
      if (producto) slots.producto = producto;
      if (ed.intent !== 'producto.baja') slots.campo = { valor: ed.campo, texto: ed.campo, confianza: 'exacto' };
      if (ed.intent === 'producto.impuesto') slots.impuesto = { valor: { texto: ed.valor, quitar: !!ed.quitar }, texto: ed.valorTexto, confianza: 'exacto' };
      else if (ed.intent === 'producto.editar' && ed.valor != null) slots.valor = { valor: ed.valor, texto: ed.valorTexto, confianza: 'exacto' };
      return cerrar(ed.intent, slots, 0.95, []);
    }

    const p = puntuar(a, modulos);
    const [mejor = { intent: null, s: 0 }, segundo] = p.ranking;
    const nadaConocido = p.conocidos === 0 && !Object.values(p.claves).some(Boolean);

    /* ¿Es la respuesta a lo que Wybix preguntó? Si no parece otra orden
       clara, llena el dato que faltaba. */
    const salta = esperando && porId(esperando.intent)?.slots?.[esperando.falta]?.preguntar && SALTAR.test(a.norm);
    if (esperando && (salta || nadaConocido || mejor.s < 0.6 || mejor.intent === esperando.intent)) {
      const slots = { ...esperando.slots };
      const nuevos = llenar(esperando.intent, a, { ...datos, respuestaA: esperando.falta });
      for (const [k, v] of Object.entries(nuevos)) if (v && (v.valor != null || v.delta != null || v.omitido) && (!slots[k] || slots[k].valor == null || slots[k].confianza === 'dudoso')) slots[k] = v;
      /* Respuesta suelta a «¿cuál?»: el texto entero es la elección. */
      if (esperando.falta && slots[esperando.falta]?.confianza === 'dudoso' && slots[esperando.falta].opciones?.length) {
        const elegido = elegirOpcion(a.norm, slots[esperando.falta].opciones);
        if (elegido) slots[esperando.falta] = { valor: elegido.valor, texto: elegido.etiqueta, confianza: 'exacto' };
      }
      return cerrar(esperando.intent, slots, 1, []);
    }

    const sinMuletillas = a.tokens.filter((t, i) => !MULETILLAS.includes(t) && !a.prodIdx.has(i) && !a.personaIdx.has(i));

    /* Una sola palabra que es una pantalla («compras», «inventario»), o un
       verbo de ir con una pantalla («abre traspasos»): ir ahí. */
    const destino = DESTINOS.find(([re]) => re.test(a.norm));
    if (destino && !a.cants.length && !a.din && !a.prodIdx.size && !a.personaIdx.size
        && (sinMuletillas.length === 1 || (IR.test(a.norm) && sinMuletillas.length <= 5
            && a.tokensOriginales.every((t) => conocidas.has(t) || conocidas.has(raiz(t)) || MULETILLAS.includes(t))))) {
      return cerrar('ir_a', { destino: { valor: destino[1], texto: destino[2], confianza: 'exacto' } }, 0.9, []);
    }
    /* «¿Cómo hago una devolución?» es una pregunta de uso, no la orden. */
    if (COMO.test(a.norm) && !/\b(?:este chat|wybix)\b/.test(a.norm) && disponible('ayuda.como', modulos)) {
      return cerrar('ayuda.como', llenar('ayuda.como', a, datos), 0.85, []);
    }

    /* «¿Por qué?» después de un número: la explicación de ESE número (el
       mismo periodo, filtros y producto). */
    if (contexto?.intent && POR_QUE_DE.has(contexto.intent) && ref.porQue(a.norm) && disponible('venta.comparar', modulos)) {
      const s = {};
      for (const k of ['periodo', 'filtros', 'producto']) if (contexto.slots[k]) s[k] = contexto.slots[k];
      if (s.periodo) s.periodo = { ...s.periodo, dicho: true };
      return cerrar('venta.comparar', s, 0.85, [], { deContexto: true });
    }

    /* «No, me refería a la grande», «mejor de ayer», «no, eran 3»: la misma
       pregunta u orden de antes, con el dato corregido. «La grande» sola se
       entiende sobre el producto de antes («Coca» + «grande»). */
    const corregido = contexto?.intent && !esperando ? ref.correccion(a.norm) : null;
    if (corregido && disponible(contexto.intent, modulos) && !ref.preferencia(a.norm)) {
      const prev = contexto.slots.producto?.texto;
      const palabras = corregido.split(' ').filter((w) => !MULETILLAS.includes(w));
      const soloAdjetivo = prev && palabras.length && palabras.every((w) => SOLO_ADJETIVOS.has(w));
      const txt = soloAdjetivo
        ? `${normalizar(prev).tokens.filter((w) => !SOLO_ADJETIVOS.has(w) && !/^\d/.test(w) && !/^(?:ml|l|lt|lts|litros?|kg|kilos?|g|gr|grs|gramos|oz|pzas?|piezas?)$/.test(w)).join(' ')} ${palabras.join(' ')}`
        : corregido;
      const a2 = analizar(txt, catalogo, { personas });
      const nuevos = llenar(contexto.intent, a2, datos);
      const slots = { ...contexto.slots };
      let cambio = false;
      for (const [k, v] of Object.entries(nuevos)) {
        if (v && (v.valor != null || v.delta != null || v.opciones?.length)) { slots[k] = v; cambio = true; }
      }
      if (ex.diceperiodo(a2.norm) && nuevos.periodo) slots.periodo = { ...nuevos.periodo, dicho: true };
      if (cambio) return cerrar(contexto.intent, slots, 0.8, [], { deContexto: true, correccion: true });
    }

    /* «¿y ayer?», «¿y de las conchas?», «¿y doña Mary?»: la misma pregunta
       de antes con otro dato. Solo si la frase no trae otra intención. */
    if (contexto?.intent && disponible(contexto.intent, modulos)) {
      const def = porId(contexto.intent);
      /* «¿y los domingos?», «¿y en tarjeta?»: un filtro nuevo sobre la misma pregunta. */
      const f = def?.slots?.filtros ? filtrosDe(a.norm, datos) : null;
      const soloDatos = sinMuletillas.every((t) => /^\d/.test(t) || f?.usados.has(t)
        || /^(hoy|ayer|semana|mes|pasada|pasado|esta|este|ano|anio|manana|cuanto|cuantos|cuantas|y|tambien|igual|mismo|otra|otro|solo|en|los|las|de)$/.test(t));
      const cambia = (def?.slots?.periodo && ex.diceperiodo(a.norm)) || (def?.slots?.producto && a.prodIdx.size) || f
        || (def?.slots?.fecha && ex.fecha(a.norm, ahora)) || (Object.keys(PERSONA_SLOTS).some((k) => def?.slots?.[k]) && a.personaIdx.size);
      /* Nada más que el filtro («¿y en tarjeta?»): es la misma pregunta aunque
         «tarjeta» suene a otro intent. */
      const soloFiltro = !!f && sinMuletillas.every((t) => f.usados.has(t) || /^(y|en|los|las|de|solo|tambien)$/.test(t));
      if (soloDatos && cambia && (soloFiltro || nadaConocido || mejor.s < 0.5 || mejor.intent === contexto.intent)) {
        const nuevos = llenar(contexto.intent, a, datos);
        const slots = { ...contexto.slots, ...nuevos };
        /* Los filtros se suman: «¿y en tarjeta?» después de «los sábados» son los sábados en tarjeta. */
        if (contexto.slots.filtros?.valor && nuevos.filtros?.valor) {
          slots.filtros = { ...nuevos.filtros, valor: { ...contexto.slots.filtros.valor, ...nuevos.filtros.valor },
                            texto: [contexto.slots.filtros.texto, nuevos.filtros.texto].filter(Boolean).join(' · ') };
        }
        /* Un periodo dicho («¿y ayer?») reemplaza el rango de fechas anterior. */
        if (ex.diceperiodo(a.norm) && slots.filtros?.valor?.rango && !nuevos.filtros?.valor?.rango) {
          const { rango, ...resto } = slots.filtros.valor;
          if (Object.keys(resto).length) slots.filtros = { ...slots.filtros, valor: resto };
          else delete slots.filtros;
        }
        return cerrar(contexto.intent, slots, 0.8, [], { deContexto: true });
      }
    }

    /* PREGUNTA LIBRE: «¿qué categoría deja más ganancia los domingos?»,
       «café contra concha», «octubre contra septiembre». Si la pregunta es
       justo la de un intent que ya la contesta («¿qué se vende más?»), se
       queda con él. */
    const libre = disponible('analisis.libre', modulos) ? preguntaLibre(a.norm, { ahora, productos: contarProductos(a.norm, catalogo, personas) }) : null;
    /* No es de ventas si habla de gastos, compras, citas o lo que falta; ni si
       pregunta «por qué» (eso es venta.comparar). Y si el clasificador ya tiene
       una respuesta segura de OTRA área, se queda con ella. */
    const ajena = libre && !libre.comparar && (NO_ES_VENTA.test(a.norm) || /^(?:y )?por que\b/.test(a.norm)
      || (mejor.intent && !ANALITICOS.has(mejor.intent) && mejor.s >= 0.55));
    if (libre && !ajena) {
      const ya = AGRUPA_YA[mejor.intent];
      const esElMismo = ya && !libre.comparar && ya[0] === libre.agrupar && ya[1] === libre.medida && libre.orden === 'desc' && !libre.limite;
      if (!esElMismo) {
        const s = llenar('analisis.libre', a, datos);
        s.pregunta = { valor: libre, texto: a.norm, confianza: 'exacto' };
        if (libre.comparar?.tipo === 'productos') {
          const [izq, der] = a.norm.split(/\s(?:contra|vs|versus|comparado con|frente a)\s/);
          const p1 = ex.producto(analizar(izq.replace(/^(?:compara(?:me|r)?|comparacion de|diferencia entre)\s+/, ''), catalogo, { personas }).tokens, catalogo, {});
          const p2 = der ? ex.producto(analizar(der, catalogo, { personas }).tokens, catalogo, {}) : null;
          if (p1) s.producto = p1;
          if (p2) s.producto2 = p2;
        }
        if (libre.comparar?.tipo === 'periodos') { delete s.periodo; if (s.filtros?.valor?.rango) { const { rango, ...r } = s.filtros.valor; s.filtros = Object.keys(r).length ? { ...s.filtros, valor: r } : undefined; } }
        if (!s.filtros) delete s.filtros;
        return cerrar('analisis.libre', s, 0.8, []);
      }
    }

    if (nadaConocido || mejor.s < 0.3) {
      return { intent: null, puntaje: nadaConocido ? 0 : Math.round(mejor.s * 100) / 100, slots: {}, falta: null,
               alternativas: p.ranking.slice(0, 3).filter((x) => x.s >= 0.12).map(alt) };
    }
    let elegido = mejor.intent;
    let slots = llenar(elegido, a, datos);
    /* «¿Cuánto sale un corte?»: cotizar UNA pieza dicha con «un/una» es
       preguntar el precio. */
    if (elegido === 'venta.cotizar' && slots.renglones?.valor?.length === 1 && slots.renglones.valor[0].cantidad === 1
        && !/(^|\s)1(\s|$)/.test(String(texto).toLowerCase()) && disponible('producto.info', modulos)) {
      elegido = 'producto.info';
      slots = llenar(elegido, a, datos);
    }
    /* Lo que falta y se dijo hace un momento («¿y cuánto le gano?» después
       de preguntar por las conchas): se hereda del contexto. */
    if (contexto?.slots) {
      for (const k of ['producto', 'cliente', 'proveedor', 'profesional']) {
        const spec = porId(elegido)?.slots?.[k];
        const prev = contexto.slots[k];
        /* «¿Qué se vende más?» agrupa por producto: heredar uno la volvería otra pregunta. */
        if (k === 'producto' && porId(elegido)?.analitica?.agrupar === 'producto') continue;
        if (spec && (!slots[k] || slots[k].valor == null && !slots[k].opciones?.length) && prev?.valor != null && prev.confianza !== 'dudoso'
            && !a.prodIdx.size && !a.personaIdx.size) {
          slots[k] = { ...prev, deContexto: true };
        }
      }
    }
    const alternativas = segundo && mejor.s - segundo.s < 0.15 ? p.ranking.slice(1, 3).map(alt) : [];
    return cerrar(elegido, slots, mejor.s, alternativas);
  }

  return { interpretar, analizar, modelo, prepararCatalogo };
}

/** Lema también para palabras cortas: «deja» → «dej», como «dejar». */
/** Cuántos productos distintos se nombran (para «café contra concha»). */
function contarProductos(norm, catalogo, personas) {
  if (!catalogo.length) return 0;
  const lados = norm.split(/\s(?:contra|vs|versus|comparado con|frente a)\s/);
  if (lados.length < 2) return 0;
  return lados.filter((l) => { const p = ex.producto(normalizar(l).tokens, catalogo, {}); return p && (p.valor != null || p.opciones?.length); }).length;
}

const lemaSuave = (w) => (w.length >= 5 ? lema(w) : w.replace(/[aeo]$/, ''));

/**
 * Un error de dedo («percio», «comrpas») hacia la palabra conocida más usada
 * a UNA letra de distancia (cambiar, sobrar, faltar o voltear dos). Solo
 * palabras de 5 letras o más que Wybix no conoce: «pan» no se toca.
 */
function corregir(w, conocidas, extra) {
  if (w.length < 5 || /\d|\$/.test(w) || conocidas.has(w) || extra.has(w)) return w;
  /* Un plural no es un error de dedo: «galletas» no se vuelve «galleta». */
  if (conocidas.has(raiz(w)) || extra.has(raiz(w)) || [...extra].some((c) => raiz(c) === raiz(w))) return w;
  let mejor = null, frec = 0;
  const probar = (c, f) => { if (f > frec && distancia1(w, c)) { mejor = c; frec = f; } };
  /* Solo hacia palabras frecuentes: un nombre que salió una vez en una frase
     de entrenamiento («pedro») no es a dónde corregir «perro». */
  for (const [c, f] of conocidas) if (f >= 4 && Math.abs(c.length - w.length) <= 1) probar(c, f);
  for (const c of extra) if (Math.abs(c.length - w.length) <= 1) probar(c, 50);
  return mejor || w;
}

/** ¿Están a una edición (Damerau) de distancia? */
function distancia1(a, b) {
  if (a === b) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const dif = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) dif.push(i);
    if (dif.length === 1) return true;
    return dif.length === 2 && dif[1] === dif[0] + 1 && a[dif[0]] === b[dif[1]] && a[dif[1]] === b[dif[0]];
  }
  const [c, l] = a.length < b.length ? [a, b] : [b, a];
  for (let i = 0, j = 0, saltos = 0; j < l.length; j++) {
    if (c[i] === l[j]) { i++; continue; }
    if (++saltos > 1) return false;
  }
  return true;
}

const alt = (x) => ({ intent: x.intent, etiqueta: porId(x.intent)?.etiqueta || x.intent, puntaje: Math.round(x.s * 100) / 100 });

/** Una respuesta corta («la glaseada», «2», «chocolate») contra las opciones ofrecidas. */
function elegirOpcion(norm, opciones) {
  const n = Number(norm.match(/^\d+$/)?.[0]);
  if (n >= 1 && n <= opciones.length) return opciones[n - 1];
  const ws = norm.split(' ').map(raiz).filter((w) => w.length > 2 && !ex.RUIDO.has(w));
  const puntos = opciones.map((o) => {
    const ot = normalizar(o.etiqueta).tokens.map(raiz);
    return { o, s: ws.filter((w) => ot.some((t) => t === w || t.startsWith(w))).length };
  }).sort((x, y) => y.s - x.s);
  return puntos[0]?.s > 0 && (!puntos[1] || puntos[1].s < puntos[0].s) ? puntos[0].o : null;
}

/** Una persona de un tipo (cliente, proveedor, profesional) en la frase. */
function personaDe(a, personas, tipo, { soloTras = null, excluir = new Set() } = {}) {
  const lista = personas.filter((p) => p.tipo === tipo);
  const fuera = new Set([...a.excluir, ...excluir]);
  if (soloTras != null) a.tokens.forEach((_, i) => { if (i <= soloTras) fuera.add(i); });
  if (!lista.length) {
    /* Sin lista (o sin nadie de ese tipo): lo que se dijo con honorífico. */
    return a.persona && a.persona.valor == null && a.personaIdx.size ? { ...a.persona, confianza: 'dudoso' } : null;
  }
  const r = ex.producto(a.tokens, lista, { excluir: fuera });
  if (!r) return null;
  if (r.valor != null) return { valor: r.valor, texto: r.texto, confianza: r.confianza, opciones: r.opciones };
  /* Nadie se parece: solo vale si la frase sí nombraba a una persona. */
  if (!r.opciones.length) return a.personaIdx.size ? { valor: null, texto: r.texto, confianza: 'dudoso', opciones: [] } : null;
  return { valor: null, texto: r.texto, confianza: 'dudoso', opciones: r.opciones };
}

/** Los datos que pide el intent, con su seguridad. */
function llenar(intent, a, { catalogo, personas = [], categorias = [], conceptos = [], usuarios = [], ahora, respuestaA = null }) {
  const def = porId(intent);
  const s = {};
  const quiere = (k) => def && k in def.slots;
  const primera = a.cantDelProd || a.cants.find((c) => !c.conUnidad || c.uom === 'pza') || a.cants[0];
  if (quiere('cantidad')) {
    if (primera) s.cantidad = { valor: primera.valor, texto: primera.texto, confianza: 'exacto' };
    /* «ajusta la coca a 20»: el «a 20» no es precio aquí, es cantidad. */
    else if (a.din?.confianza === 'probable') s.cantidad = { valor: a.din.valor, texto: String(a.din.valor), confianza: 'exacto' };
  }
  if ((quiere('producto') || quiere('servicio')) && a.prod) {
    const v = a.prod.valor != null
      ? { valor: a.prod.valor, texto: a.prod.texto, confianza: a.prod.confianza, opciones: a.prod.opciones }
      : (a.prod.opciones?.length ? { valor: null, texto: a.prod.texto, confianza: 'dudoso', opciones: a.prod.opciones } : undefined);
    if (v) s[quiere('producto') ? 'producto' : 'servicio'] = v;
  }
  if (quiere('renglones') && catalogo.length) {
    const fuera = new Set([...a.excluir].filter((i) => !/^\d/.test(a.tokens[i])));
    /* En una compra «a 12» es el costo y el proveedor no es producto
       («Coca-Cola» no son cocas). */
    if (intent === 'compra.registrar') {
      a.tokens.forEach((t, i) => { if (/^\d/.test(t) && a.tokens[i - 1] === 'a') fuera.add(i); });
      for (const i of a.personaIdx) fuera.add(i);
    }
    let rs = ex.renglones(a.tokens, catalogo, { excluir: fuera });
    if (!rs.length && a.prod?.valor != null) rs = [{ cantidad: 1, producto: a.prod }];
    if (rs.length) {
      const dudoso = rs.some((r) => r.producto.valor == null);
      s.renglones = { valor: dudoso ? null : rs.map((r) => ({ cantidad: r.cantidad, productId: r.producto.valor, nombre: r.producto.texto })),
                      texto: rs.map((r) => `${r.cantidad} ${r.producto.texto}`).join(', '), confianza: dudoso ? 'dudoso' : 'exacto',
                      opciones: dudoso ? rs.find((r) => r.producto.valor == null).producto.opciones : undefined };
    }
  }
  if (quiere('precio')) {
    /* «súbele 2 pesos»: cambio relativo, no precio nuevo. */
    const rel = /\b(?:a|en)\s+\$?\d/.test(a.norm) ? null
      : a.norm.match(/\b(sube|subele|subirle|subo|subiera|subimos|aumenta|aumentale|aumento|baja|bajale|bajarle|bajo|bajara|bajamos|rebaja|rebajale|quito|quitale|quitara)\b.*?\$?(\d+(?:\.\d+)?)\s*pesos?\b/);
    /* «si subo la concha a 14 cuánto gano»: el número después de «a» o «en» es el precio aunque siga la frase. */
    const tras = a.norm.match(/\b(?:a|en)\s+\$?(\d+(?:\.\d+)?)\b(?!\s*(?:piezas?|pzas?|kg|kilos?|g|gramos|litros?|ml|l|dias|horas|por ciento)\b)/);
    if (rel) s.precio = { valor: null, delta: (/^(baja|rebaja|bajo|quit)/.test(rel[1]) ? -1 : 1) * Number(rel[2]), texto: rel[0], confianza: 'exacto' };
    else if (a.din) s.precio = { valor: a.din.valor, texto: a.din.texto, confianza: a.din.confianza === 'probable' ? 'exacto' : a.din.confianza };
    else if (tras && Number(tras[1]) > 0) s.precio = { valor: Number(tras[1]), texto: tras[1], confianza: 'exacto' };
    else {
      /* «nuevo precio latte chico 45»: un número suelto al final es el precio. */
      const ult = a.tokens[a.tokens.length - 1];
      if (/^\d+(\.\d+)?$/.test(ult) && Number(ult) > 0) s.precio = { valor: Number(ult), texto: ult, confianza: 'exacto' };
    }
  }
  if (quiere('monto') && intent === 'venta.cobrar') {
    /* En un cobro los números son cantidades; lo recibido se dice aparte:
       «me dio 100», «paga con 200», «con un billete de 500». */
    const m = a.norm.match(/\bbillete de\s+\$?(\d+(?:\.\d+)?)\b/)
      || a.norm.match(/\b(?:me dio|me dieron|me paga|me pago|paga con|pago con|pagan con|recibi)\s+\$?(\d+(?:\.\d+)?)\b(?!\s*(?:billete|billetes)\b)/);
    if (m) s.monto = { valor: Number(m[1]), texto: `$${m[1]}`, confianza: 'exacto' };
  } else if (quiere('monto')) {
    if (a.din) s.monto = { valor: a.din.valor, texto: `$${a.din.valor}`, confianza: 'exacto' };
    else {
      /* «doña Mary abonó 200»: el número que no es teléfono, hora ni folio. */
      const tel = ex.telefono(a.normOriginal);
      const c = a.cants.find((x) => !x.conUnidad && x.valor > 0 && String(x.valor) !== tel?.valor);
      if (c) s.monto = { valor: c.valor, texto: `$${c.valor}`, confianza: 'exacto' };
    }
  }
  if (quiere('metodo')) { const m = ex.metodoPago(a.norm); if (m) s.metodo = m; }
  /* Compra: el costo de cada renglón, en el orden en que se dijo
     («24 cocas a 12 y 10 sabritas a 15»). Solo si cada renglón trae el suyo,
     o uno solo para todos. */
  if (quiere('costos') && s.renglones?.valor?.length) {
    const tramos = a.norm.split(/\s(?:y|,)\s|,\s*/);
    const costos = tramos.map((t) => t.match(/\ba\s+\$?(\d+(?:\.\d+)?)(?:\s*pesos?)?\b(?!\s*(?:piezas?|pzas?|kg|kilos?|litros?))/)).filter(Boolean).map((m) => Number(m[1]));
    if (costos.length === s.renglones.valor.length) s.costos = { valor: costos, texto: costos.join(', '), confianza: 'exacto' };
  }
  if (quiere('concepto')) {
    const c = ex.conceptoGasto(a.norm, conceptos, normalizar);
    if (c) s.concepto = c;
    else if (conceptos.length && def.slots.concepto.requerido) s.concepto = { valor: null, confianza: 'dudoso', opciones: conceptos.slice(0, 10).map((x) => ({ etiqueta: x.nombre, valor: x.id })) };
  }
  if (quiere('folio')) {
    const f = ex.folio(a.norm) || (respuestaA === 'folio' && a.cants[0] ? { valor: a.cants[0].valor, texto: String(a.cants[0].valor), confianza: 'exacto' } : null)
      || (a.cants.length === 1 && !a.prodIdx.size ? { valor: a.cants[0].valor, texto: String(a.cants[0].valor), confianza: 'exacto' } : null);
    if (f) s.folio = f;
    /* «reimprime el último ticket», «devuelve la última venta». */
    else if (/\bultim[oa]s?\b/.test(a.norm)) s.folio = { valor: 'ultimo', texto: 'el último', confianza: 'exacto' };
  }
  if (quiere('razon')) {
    const r = ex.motivoDevolucion(a.norm) || (respuestaA === 'razon' ? ex.MOTIVOS_DEVOLUCION.find((m) => normalizar(m).texto === a.norm) || (a.norm.length > 2 ? 'Otro' : null) : null);
    if (r) s.razon = { valor: r, texto: r, confianza: 'exacto' };
  }
  if (quiere('mesa')) {
    const m = ex.mesa(a.norm) || (a.cants.length === 1 ? { valor: a.cants[0].valor, texto: `mesa ${a.cants[0].valor}`, confianza: 'exacto' } : null);
    if (m) s.mesa = m;
  }
  if (quiere('hora')) { const h = ex.hora(a.norm); if (h) s.hora = { valor: h, texto: h.texto, confianza: h.confianza === 'probable' ? 'exacto' : h.confianza }; }
  if (quiere('telefono')) { const t = ex.telefono(a.normOriginal); if (t) s.telefono = t; }
  if (quiere('fecha')) { const f = ex.fecha(a.norm, ahora); if (f) s.fecha = f; }
  if (quiere('motivo')) { const m = ex.motivoMerma(a.norm); if (m) s.motivo = { valor: m, confianza: 'exacto' }; }
  /* `dicho`: si la frase nombró el periodo o es el de omisión (hoy). */
  if (quiere('periodo')) s.periodo = { valor: ex.periodo(a.norm), confianza: 'exacto', dicho: ex.diceperiodo(a.norm) };
  if (quiere('filtros')) {
    const f = filtrosDe(a.norm, { categorias, usuarios, ahora });
    if (f) {
      /* Una categoría que también es el producto dicho: gana el producto, es más preciso. */
      if (f.valor.categoria && a.prod?.valor != null && quiere('producto')) delete f.valor.categoria;
      if (Object.keys(f.valor).length) s.filtros = { valor: f.valor, texto: f.texto, confianza: 'exacto' };
    }
  }
  if (quiere('destino')) {
    const d = DESTINOS.find(([re]) => re.test(a.norm));
    if (d) s.destino = { valor: d[1], texto: d[2], confianza: 'exacto' };
  }
  if (quiere('nombre')) {
    const n = nombreNuevo(a.normOriginal || a.norm, intent);
    if (n) s.nombre = { valor: n, texto: n, confianza: 'probable' };
  }
  /* Costo y existencia del alta: dichos («me cuesta 6», «tengo 20») o como
     respuesta a su pregunta; «no sé», «ninguno», «después» los omite. */
  const numSuelto = () => (a.din ? a.din.valor : a.cants[0]?.valor ?? (/^\d+(?:\.\d+)?$/.test(a.norm) ? Number(a.norm) : null));
  if (quiere('costo')) {
    const m = a.norm.match(/\b(?:me cuesta|cuesta|de costo|costo de|costo|lo compro a|lo compro en|me sale en|me sale a)\s+\$?(\d+(?:\.\d+)?)/);
    if (m) s.costo = { valor: Number(m[1]), texto: m[1], confianza: 'exacto' };
    else if (respuestaA === 'costo') {
      const n = numSuelto();
      s.costo = n != null && n > 0 ? { valor: n, texto: String(n), confianza: 'exacto' } : SALTAR.test(a.norm) || n === 0 ? { valor: null, omitido: true, texto: 'no sé', confianza: 'exacto' } : undefined;
    }
  }
  if (quiere('existencia')) {
    const m = a.norm.match(/\b(?:tengo|hay|existencia de|existencia|inventario de)\s+(\d+(?:\.\d+)?)\b/);
    if (m) s.existencia = { valor: Number(m[1]), texto: m[1], confianza: 'exacto' };
    else if (respuestaA === 'existencia') {
      const n = a.cants[0]?.valor ?? (/^\d+(?:\.\d+)?$/.test(a.norm) ? Number(a.norm) : null);
      s.existencia = n != null && n > 0 ? { valor: n, texto: String(n), confianza: 'exacto' } : SALTAR.test(a.norm) || n === 0 ? { valor: null, omitido: true, texto: 'ninguno', confianza: 'exacto' } : undefined;
    }
  }
  if (quiere('categoria') && categorias.length) {
    const ws = a.norm.split(' ').map(raiz);
    const c = categorias.find((x) => normalizar(x.nombre).tokens.map(raiz).every((t) => ws.includes(t)));
    s.categoria = c ? { valor: c.id, texto: c.nombre, confianza: 'exacto' }
                    : { valor: null, confianza: 'dudoso', opciones: categorias.slice(0, 8).map((x) => ({ etiqueta: x.nombre, valor: x.id })) };
  }
  /* Personas. El profesional va después de «con» («agenda a Laura con Pedro»). */
  let profIdx = new Set();
  if (quiere('profesional')) {
    const con = a.tokens.indexOf('con');
    const pr = (con >= 0 && personaDe(a, personas, 'profesional', { soloTras: con }))
      || (!quiere('cliente') || respuestaA === 'profesional' ? personaDe(a, personas, 'profesional') : null);
    if (pr && (pr.valor != null || pr.opciones?.length)) {
      s.profesional = pr;
      if (pr.valor != null) profIdx = indicesDe(a.tokens, tokensDeId(personas.filter((x) => x.tipo === 'profesional'), pr.valor), new Set());
    }
  }
  if (quiere('cliente')) { const c = personaDe(a, personas, 'cliente', { excluir: profIdx }); if (c) s.cliente = c; }
  if (quiere('proveedor')) { const c = personaDe(a, personas, 'proveedor'); if (c) s.proveedor = c; }
  if (quiere('nota')) {
    const m = a.normOriginal.match(/\b(?:para|por|de)\s+(?!\$?\d)([a-z].{2,60})$/);
    if (m && !/^(caja|cajon|la caja|el cajon|efectivo)$/.test(m[1])) s.nota = { valor: m[1], texto: m[1], confianza: 'exacto' };
  }
  for (const k of Object.keys(s)) if (s[k] === undefined) delete s[k];
  return s;
}

/**
 * Lo que nombra un apodo: un producto o una persona del catálogo. Si hay
 * duda, vuelve con opciones (valor = { tipo, id }).
 */
function objetivoDe(a, personas, texto) {
  const opcion = (tipo, o) => ({ etiqueta: o.etiqueta, valor: { tipo, id: o.valor }, nota: tipo === 'producto' ? undefined : tipo });
  if (a.persona?.valor != null && a.personaIdx.size && (!a.prod || a.prod.valor == null)) {
    const tipo = a.personaTipo.get([...a.personaIdx][0]);
    const p = personas.find((x) => x.id === a.persona.valor && x.tipo === tipo) || personas.find((x) => x.id === a.persona.valor);
    if (a.persona.confianza === 'exacto') return { valor: { tipo: p.tipo, id: p.id }, texto: p.nombre, confianza: 'exacto' };
    return { valor: null, texto, confianza: 'dudoso', opciones: [opcion(p.tipo, { etiqueta: p.nombre, valor: p.id })] };
  }
  if (a.prod?.valor != null && a.prod.confianza === 'exacto') return { valor: { tipo: 'producto', id: a.prod.valor }, texto: a.prod.texto, confianza: 'exacto' };
  const ops = [...(a.prod?.opciones || []).map((o) => opcion('producto', o)),
               ...(a.persona?.opciones || []).map((o) => opcion(personas.find((x) => x.id === o.valor)?.tipo || 'cliente', o))];
  /* «la coca de 600»: el número no cuenta como palabra del nombre, pero
     decide entre las opciones si solo una lo lleva. */
  const numeros = String(texto).match(/\d+/g) || [];
  const conNumero = numeros.length ? ops.filter((o) => numeros.every((n) => new RegExp(`(^|\\D)${n}(\\D|$)`).test(o.etiqueta))) : [];
  if (conNumero.length === 1) return { valor: conNumero[0].valor, texto: conNumero[0].etiqueta, confianza: 'exacto' };
  return { valor: null, texto, confianza: 'dudoso', opciones: ops.slice(0, 6) };
}

/** «crea producto pay de queso a $45» → «Pay de queso»; «nuevo cliente Juan Pérez tel 477…» → «Juan Pérez». */
function nombreNuevo(norm, intent = 'producto.crear') {
  if (intent === 'cliente.alta' || intent === 'proveedor.alta') {
    const m = norm.match(/\b(?:cliente|proveedor|alta a|alta de|alta al|agrega a|registra a|se llama|llamado|llamada)\s+(?:(?:nuevo|nueva|que se llama|al|a|el|la)\s+)*(.+?)(?:\s+(?:como cliente|como proveedor|con telefono|telefono|tel|cel|celular|su numero|numero|correo|rfc)\b.*)?$/);
    if (!m) return null;
    const nombre = m[1].replace(/\b(cliente|proveedor|nuevo|nueva|por favor|porfa)\b/g, ' ').replace(/[\d\s]+$/, '').replace(/\s+/g, ' ').trim();
    if (!nombre || nombre.length < 2 || /^\d/.test(nombre)) return null;
    return nombre.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  }
  const m = norm.match(/\b(?:crea|crear|creame|agrega|agregar|alta de|da de alta|dar de alta|registra|nuevo producto|vender)\b\s+(?:(?:un|una|el|la|1)\s+)?(?:(?:producto|articulo)\s+)?(?:(?:nuevo|nueva)\s+)?(.+?)(?:\s+(?:a|en|de|con precio|que cuesta|cuesta|por)\s+\$?\d.*|\s+\$\d.*|\s+\d+(?:\.\d+)?\s+pesos.*|\s+al catalogo.*)?$/);
  if (!m) return null;
  const nombre = m[1].replace(/\b(producto|nuevo|nueva|por favor|porfa|al catalogo|en el catalogo)\b/g, ' ')
    .replace(/\s+\d+(\.\d+)?$/, '').replace(/\s+/g, ' ').trim();
  if (!nombre || /^\$?\d/.test(nombre) || nombre.length < 2) return null;
  return nombre.replace(/^./, (c) => c.toUpperCase());
}

/** Qué falta: el primer dato requerido vacío o dudoso. */
function cerrar(intent, slots, puntaje, alternativas, extra = {}) {
  const def = porId(intent);
  let falta = null;
  for (const [k, spec] of Object.entries(def?.slots || {})) {
    const v = slots[k];
    if (spec.requerido && (!v || (v.valor == null && v.delta == null) || v.confianza === 'dudoso')) { falta = k; break; }
  }
  /* Los que se preguntan sin ser obligatorios: una vez, al final. Un «no sé»
     los deja como omitidos y no se vuelven a pedir. */
  if (!falta) {
    for (const [k, spec] of Object.entries(def?.slots || {})) {
      if (spec.preguntar && !slots[k]) { falta = k; break; }
    }
  }
  return { intent, puntaje: Math.round(puntaje * 100) / 100, alternativas, slots, falta, ...extra };
}

module.exports = { crearInterprete, prepararCatalogo, elegirOpcion, nombreNuevo };
