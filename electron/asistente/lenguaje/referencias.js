'use strict';
/**
 * LO QUE SE DICE SOBRE LA RESPUESTA ANTERIOR, no sobre el negocio.
 *
 *   referencia   «el segundo», «el último», «ese», «dime más de ese»:
 *                apunta a un renglón de la lista que Wybix acaba de dar.
 *   correccion   «no, me refería a la grande», «mejor de ayer», «no, eran 3»:
 *                la misma pregunta (u orden) con un dato cambiado.
 *   porQue       «¿por qué?», «¿y eso?», «¿a qué se debe?» después de un
 *                número: la explicación de ese número.
 *   explica      «¿cómo lo calculaste?», «¿de dónde sale?»: de qué datos
 *                salió la última respuesta.
 *   preferencia  «llámame Jesús», «no me des el resumen», «sin gráficas»,
 *                «léeme las respuestas», «olvida mis preferencias».
 *
 * Todo es por reglas y sobre texto normalizado (sin acentos, minúsculas).
 */

const ORDINAL = { primero: 0, primer: 0, primera: 0, '1ro': 0, '1o': 0, segundo: 1, segunda: 1, '2do': 1, '2o': 1,
                  tercero: 2, tercer: 2, tercera: 2, '3ro': 2, '3o': 2, cuarto: 3, cuarta: 3, quinto: 4, quinta: 4,
                  ultimo: -1, ultima: -1 };

/* «esta semana», «este mes»… no son referencias. */
const NO_REF = '(?!\\s+(?:semana|mes|ano|anio|dia|vez|tarde|manana|noche|hora|lunes|martes|miercoles|jueves|viernes|sabado|domingo|ano))';
const RE_ORDINAL = new RegExp(`\\b(?:el|la|al|del|de la)?\\s*(primer[oa]?|segund[oa]|tercer[oa]?|cuart[oa]|quint[oa]|ultim[oa]|1ro|2do|3ro|1o|2o|3o)\\b(?:\\s+(?:de la lista|lugar))?${NO_REF}`);
const RE_NUMERO = /\b(?:el|la)?\s*(?:numero|#)\s*(\d{1,2})\b/;
const RE_ESE = new RegExp(`\\b(?:de |a |con )?(?:ese|esa|eso|aquel|aquella)\\b${NO_REF}`);

/**
 * @returns { indice (0…, -1 = el último), texto: lo que se dijo para señalarlo } | null
 */
function referencia(norm) {
  let m = norm.match(RE_ORDINAL);
  if (m) return { indice: ORDINAL[m[1]] ?? ORDINAL[m[1].replace(/a$/, 'o')] ?? 0, texto: m[0].trim() };
  if ((m = norm.match(RE_NUMERO))) return { indice: Math.max(0, Number(m[1]) - 1), texto: m[0].trim() };
  if ((m = norm.match(RE_ESE))) return { indice: 0, texto: m[0].trim(), demostrativo: true };
  return null;
}

/** ¿Lo que queda, quitando la referencia, pide «más de eso»? */
const MAS_DE = /^(?:y\s+)?(?:dime\s+|cuentame\s+|quiero saber\s+)?(?:mas|mas de|detalles?|detalles? de|info|info de|informacion|informacion de|que mas|que tal|como va|como esta)?\s*(?:de|del|sobre)?\s*$/;

const RE_CORRIGE = /^(?:no+[,.]?\s+|nel[,.]?\s+|mejor\s+|perdon[,.]?\s+|me equivoque[,.]?\s*|quise decir\s+|me referia a\s+|no,?\s*era\s+|no era (?:ese|esa|eso)[,.]?\s*(?:era\s+)?|mas bien\s+|corrijo[,.]?\s*)+/;
/** @returns lo que queda después de «no, …» | null */
function correccion(norm) {
  const m = norm.match(RE_CORRIGE);
  if (!m) return null;
  const resto = norm.slice(m[0].length).replace(/^(?:a |al |el |la |los |las |de |del |en |con |era |eran |es |son )+/, (x) => x).trim();
  return resto ? resto : null;
}

const RE_PORQUE = /^(?:y\s+)?(?:por que|porque|a que se debe|y eso|como que|por que (?:fue|sera|paso)|que paso|y eso por que)(?:\s+(?:eso|asi|tan poco|tanto|bajo|subio|bajaron|subieron))?\s*\??$/;
const porQue = (norm) => RE_PORQUE.test(norm.trim());

const RE_EXPLICA = /\b(?:como lo (?:calculaste|sacaste|calculas|sacas)|como (?:calculaste|sacaste) (?:eso|ese numero)|de donde (?:sale|salio|sacaste|sacas)|como llegaste a (?:eso|ese numero)|explicame (?:eso|el calculo|como lo calculaste|de donde sale)|que datos usaste|con que datos)\b/;
const explica = (norm) => RE_EXPLICA.test(norm);

/**
 * Preferencias de la persona.
 * @returns { cambios: {…}, texto } | { olvidar: true } | null
 */
function preferencia(norm) {
  let m;
  if (/\b(?:olvida|borra|quita) (?:mis|todas mis) preferencias\b/.test(norm)) return { olvidar: true };
  if ((m = norm.match(/^(?:oye\s+)?(?:llamame|dime|hablame de|me puedes decir|puedes decirme)\s+([a-zn]{2,15})(?:\s+por favor)?$/))
      && !/^(?:cuanto|cuantos|cuantas|que|quien|cual|como|donde|cuando|si|no|mas|eso|todo|algo|la|el|lo|los|las)$/.test(m[1])) {
    return { cambios: { nombre: m[1][0].toUpperCase() + m[1].slice(1) }, texto: 'nombre' };
  }
  if ((m = norm.match(/^(?:me llamo|mi nombre es)\s+([a-zn]{2,15})$/))) return { cambios: { nombre: m[1][0].toUpperCase() + m[1].slice(1) }, texto: 'nombre' };
  if (/\b(?:no me (?:des|digas|mandes) (?:el|tu) resumen|sin (?:el )?resumen|ya no quiero (?:el )?resumen|quita el resumen)\b/.test(norm)) return { cambios: { resumen: false }, texto: 'resumen' };
  if (/\b(?:dame (?:el|tu) resumen (?:cuando|al) (?:te )?salud|(?:quiero|vuelve a darme|regresa) el resumen|si (?:quiero )?(?:el )?resumen)\b/.test(norm)) return { cambios: { resumen: true }, texto: 'resumen' };
  if (/\b(?:sin graficas?|no (?:me )?(?:pongas|muestres|enseñes|ensenes) graficas?|quita las graficas?)\b/.test(norm)) return { cambios: { graficas: false }, texto: 'graficas' };
  if (/\b(?:con graficas?|(?:ponme|muestrame|enseñame|ensename) graficas?|regresa las graficas?)\b/.test(norm)) return { cambios: { graficas: true }, texto: 'graficas' };
  if (/\b(?:no me (?:des|digas) (?:consejos|observaciones)|sin (?:consejos|observaciones)|no me (?:avises|digas) (?:lo raro|si algo esta raro))\b/.test(norm)) return { cambios: { observaciones: false }, texto: 'observaciones' };
  if (/\b(?:dime (?:si (?:ves )?algo (?:esta )?raro|lo raro)|(?:dame|quiero) (?:consejos|observaciones))\b/.test(norm)) return { cambios: { observaciones: true }, texto: 'observaciones' };
  if (/\b(?:leeme|lee(?:me)? en voz alta|hablame|dimelo en voz alta|contestame en voz alta|habla) (?:las |tus )?(?:respuestas)?\s*$/.test(norm) || /^(?:quiero que me hables|activa la voz|prende la voz)$/.test(norm)) return { cambios: { hablar: true }, texto: 'hablar' };
  if (/\b(?:no me leas|ya no hables|deja de hablar|callate|apaga la voz|sin voz|quita la voz)\b/.test(norm)) return { cambios: { hablar: false }, texto: 'hablar' };
  return null;
}

module.exports = { referencia, correccion, porQue, explica, preferencia, MAS_DE };
