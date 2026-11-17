'use strict';
/**
 * CLASIFICADOR DE INTENTS: naive Bayes multinomial. Sin IA generativa, sin
 * Internet, sin dependencias. El modelo pesa unos kilobytes y se entrena en
 * milisegundos, así que se reentrena al arrancar con el corpus de fábrica
 * más las frases que la gente de ESTE negocio confirmó (asistente_frases).
 *
 * Solo elige el intent. Los datos (cantidad, producto, precio, fecha) los
 * sacan los extractores, y lo dudoso se pregunta: el clasificador nunca
 * decide un número ni un producto.
 *
 * Características: raíces de palabras y pares de palabras. Los números, el
 * dinero y los productos reconocidos se reemplazan por <num>, <dinero> y
 * <prod> antes de clasificar: «merma de 6 donas» y «merma de 3 conchas» son
 * la misma frase para el modelo.
 */
const { raiz } = require('./normalizar');
const { lema, conceptos } = require('./lexico');

/* Peso de los vecinos en la mezcla y qué tanto se nota la diferencia de parecido (medidos con el loop). */
const MEZCLA = 0.3, TEMP = 15;
const VACIAS = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'y', 'o', 'en', 'me', 'mi', 'se', 'a', 'por', 'que']);

/**
 * Rasgos de una frase: la palabra (sin plural), su lema («cancelala» →
 * «cancel»), sus conceptos del léxico (#DINERO, #CANCELAR…) y los pares de
 * palabras seguidas. Los conceptos son los que dejan entender palabras que
 * ninguna frase de entrenamiento tenía.
 */
function rasgos(tokens) {
  const ws = tokens.map((t) => (t.startsWith('<') ? t : raiz(t))).filter(Boolean);
  const out = [];
  for (const w of ws) {
    if (VACIAS.has(w)) continue;
    out.push(w);
    if (w.startsWith('<')) continue;
    const l = lema(w);
    if (l !== w) out.push(`~${l}`);
    for (const c of conceptos(w)) out.push(`#${c}`);
  }
  /* «que» y «me» sí distinguen preguntas («que me falta») de órdenes: entran como par. */
  for (let i = 0; i < ws.length - 1; i++) out.push(`${ws[i]}_${ws[i + 1]}`);
  return out;
}

/**
 * Dos modelos con los mismos rasgos:
 *   naive Bayes   bueno con muchas frases por intent
 *   vecinos (kNN) la frase de entrenamiento más PARECIDA (coseno con pesos
 *                 idf): bueno con intents de pocas frases y con frases raras
 * La predicción los combina.
 * @param ejemplos [{ tokens: string[], intent }]
 */
function entrenar(ejemplos, { alfa = 0.5 } = {}) {
  const docs = {}, cuenta = {}, total = {}, vocab = new Set(), df = new Map();
  const vecs = [];
  const vistos = new Set();
  for (const { tokens, intent } of ejemplos) {
    docs[intent] = (docs[intent] || 0) + 1;
    cuenta[intent] = cuenta[intent] || {};
    const fs = rasgos(tokens);
    for (const f of fs) {
      cuenta[intent][f] = (cuenta[intent][f] || 0) + 1;
      total[intent] = (total[intent] || 0) + 1;
      vocab.add(f);
    }
    /* Para vecinos, cada frase distinta una vez. */
    const clave = intent + '|' + tokens.join(' ');
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    const u = [...new Set(fs)];
    for (const f of u) df.set(f, (df.get(f) || 0) + 1);
    vecs.push({ intent, fs: u });
  }
  const n = Object.values(docs).reduce((a, b) => a + b, 0);
  const idf = new Map();
  for (const [f, d] of df) idf.set(f, Math.log(1 + vecs.length / d));
  /* Índice invertido rasgo → frases, y norma de cada frase. */
  const indice = new Map();
  vecs.forEach((v, k) => {
    let nn = 0;
    for (const f of v.fs) { const w = idf.get(f); nn += w * w; (indice.get(f) || indice.set(f, []).get(f)).push(k); }
    v.norma = Math.sqrt(nn) || 1;
  });
  return { alfa, vocab: vocab.size, n, docs, cuenta, total, intents: Object.keys(docs), vecs, idf, indice };
}

/** Los K vecinos más parecidos: similitud por intent (el mejor de cada uno). */
function vecinos(modelo, fs) {
  const u = [...new Set(fs)].filter((f) => modelo.idf.has(f));
  let nq = 0;
  const punt = new Map();
  for (const f of u) {
    const w = modelo.idf.get(f);
    nq += w * w;
    for (const k of modelo.indice.get(f)) punt.set(k, (punt.get(k) || 0) + w * w);
  }
  nq = Math.sqrt(nq) || 1;
  const porIntent = {};
  for (const [k, s] of punt) {
    const v = modelo.vecs[k];
    const cos = s / (nq * v.norma);
    if (!(porIntent[v.intent] >= cos)) porIntent[v.intent] = cos;
  }
  return porIntent;
}

/** Probabilidades por intent, ordenadas. Solo cuentan los rasgos que el modelo conoce. */
function predecir(modelo, tokens) {
  const fs = rasgos(tokens);
  const conocidos = fs.filter((f) => modelo.idf.has(f));
  const log = {};
  for (const i of modelo.intents) {
    /* Sin el peso de cuántas frases tiene cada intent: uno con pocas frases
       no debe perder solo por eso. */
    let s = 0;
    const den = (modelo.total[i] || 0) + modelo.alfa * modelo.vocab;
    for (const f of conocidos) s += Math.log(((modelo.cuenta[i][f] || 0) + modelo.alfa) / den);
    log[i] = s;
  }
  const max = Math.max(...Object.values(log));
  const exp = Object.entries(log).map(([i, s]) => [i, Math.exp(s - max)]);
  const suma = exp.reduce((a, [, v]) => a + v, 0);
  const nb = Object.fromEntries(exp.map(([i, v]) => [i, v / suma]));
  /* Vecinos → probabilidades (suavizadas: el parecido 0.9 contra 0.6 pesa). */
  const vz = vecinos(modelo, fs);
  const expV = modelo.intents.map((i) => [i, Math.exp(TEMP * (vz[i] || 0))]);
  const sumaV = expV.reduce((a, [, v]) => a + v, 0);
  const kn = Object.fromEntries(expV.map(([i, v]) => [i, v / sumaV]));
  const ranking = modelo.intents.map((intent) => ({ intent, p: (1 - MEZCLA) * nb[intent] + MEZCLA * kn[intent], nb: nb[intent], parecido: vz[intent] || 0 }))
    .sort((a, b) => b.p - a.p);
  return { conocidos: conocidos.length, ranking };
}

module.exports = { entrenar, predecir, rasgos };
