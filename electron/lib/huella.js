/**
 * Huella de maquina (fingerprint v2): que equipo es este.
 *
 * QUE ESTABA MAL
 * --------------
 * La huella v1 era UN hash:
 *
 *     sha256(uuidPlaca | serialDisco | hostname | platform | arch)
 *
 * con `.filter(Boolean)`, y ese hash se usaba como LLAVE DE CIFRADO de la
 * licencia. De ahi salen dos defectos, y el segundo es el grave:
 *
 *   1. `os.hostname()` entra en el hash. Renombrar el equipo -algo que hace
 *      cualquier area de sistemas al dar de alta una maquina- cambia la
 *      huella.
 *   2. `.filter(Boolean)` DESCARTA las partes vacias en vez de dejarlas como
 *      huecos. Si `wmic` falla o tarda, la cadena pasa de
 *      "UUID|DISCO|HOST|win32|x64" a "HOST|win32|x64": un hash completamente
 *      distinto, en silencio, por un fallo temporal.
 *
 * Como el hash era la llave, cualquiera de las dos cosas dejaba la licencia
 * ilegible, y el modulo concluia "manipulada" y bloqueaba la aplicacion.
 *
 * COMO SE RESUELVE
 * ----------------
 * La huella deja de ser un hash y pasa a ser un CONJUNTO DE SENALES que se
 * guardan por separado y se comparan una a una. Asi se puede decir "faltan
 * datos" en vez de "es otra maquina", que es justo la distincion que no
 * existia.
 *
 *   uuid    UUID de la placa (wmic). Fuerte, pero depende de WMI.
 *   discos  seriales de disco, ORDENADOS. Fuerte. Agregar un disco no rompe:
 *           se comparan por interseccion, no por igualdad.
 *   macs    direcciones MAC. La unica senal que NO depende de WMI, y por eso
 *           la que sostiene el caso "WMI fallo".
 *   host    informativo. NO decide: es lo que rompia antes.
 *   plat    plataforma y arquitectura. Tienen que coincidir siempre.
 *   arch
 *
 * REGLA DE DECISION
 * -----------------
 * Se comparan solo las senales duras presentes EN AMBAS. Una senal vacia hoy
 * no cuenta como diferencia: cuenta como "no se puede comparar".
 *
 *   al menos una senal dura en comun    -> misma maquina
 *   ninguna en comun, habiendo alguna
 *   comparable                          -> otra maquina
 *   ninguna comparable                  -> indeterminada (no se afirma nada)
 *
 * "Al menos una" es deliberado: cambiar el disco, o cambiar la placa, es una
 * reparacion legitima y no debe costarle la licencia a nadie. Copiar la
 * licencia a otra PC cambia las TRES a la vez, y eso si se rechaza.
 *
 * Modulo puro: recibe senales y devuelve un veredicto. No lee hardware ni
 * toca Electron, asi que se puede ejercitar entero desde una prueba.
 */

const VERSION_HUELLA = 2;

/** Lista normalizada: sin vacios, sin duplicados, en orden estable. */
function lista(xs) {
  if (!Array.isArray(xs)) return xs ? [String(xs).trim().toUpperCase()].filter(Boolean) : [];
  return [...new Set(xs.map(x => String(x ?? '').trim().toUpperCase()).filter(Boolean))].sort();
}

function texto(x) {
  return String(x ?? '').trim().toUpperCase();
}

/**
 * Arma una huella a partir de las senales crudas del sistema.
 * `senales` lo provee quien sabe leer hardware; aqui solo se normaliza.
 */
function construirHuella(senales = {}) {
  return {
    v: VERSION_HUELLA,
    uuid: texto(senales.uuid),
    discos: lista(senales.discos),
    macs: lista(senales.macs),
    host: texto(senales.host),
    plat: String(senales.plat ?? ''),
    arch: String(senales.arch ?? ''),
  };
}

/** Cuantas senales duras trae. Sirve para no degradar una huella buena. */
function fuerza(h) {
  if (!h) return 0;
  return (h.uuid ? 1 : 0) + (lista(h.discos).length ? 1 : 0) + (lista(h.macs).length ? 1 : 0);
}

/** true / false / null cuando alguna de las dos partes no tiene el dato. */
function coincidenListas(a, b) {
  const la = lista(a), lb = lista(b);
  if (!la.length || !lb.length) return null;
  return la.some(x => lb.includes(x));
}

function coincidenTextos(a, b) {
  const ta = texto(a), tb = texto(b);
  if (!ta || !tb) return null;
  return ta === tb;
}

/**
 * @returns {'misma'|'otra'|'indeterminada'|'sin-huella'}
 */
function compararHuella(guardada, actual) {
  if (!guardada || guardada.v !== VERSION_HUELLA) return 'sin-huella';
  if (!actual) return 'indeterminada';

  // Plataforma y arquitectura son un requisito duro: una licencia de Windows
  // x64 no puede estar corriendo en otra cosa por accidente.
  if (guardada.plat && actual.plat && guardada.plat !== actual.plat) return 'otra';
  if (guardada.arch && actual.arch && guardada.arch !== actual.arch) return 'otra';

  const senales = [
    coincidenTextos(guardada.uuid, actual.uuid),
    coincidenListas(guardada.discos, actual.discos),
    coincidenListas(guardada.macs, actual.macs),
  ];

  const comparables = senales.filter(r => r !== null);
  // Sin nada que comparar no se puede afirmar que sea otra maquina. Decirlo es
  // mejor que adivinar: quien llama decide, y sobre todo NO vuelve a sellar,
  // para no sustituir una huella buena por una vacia.
  if (!comparables.length) return 'indeterminada';

  return comparables.some(r => r === true) ? 'misma' : 'otra';
}

/**
 * Si conviene reescribir la huella guardada con la actual.
 *
 * Solo cuando es la misma maquina Y la huella nueva no es mas pobre que la
 * vieja. Sin esta condicion, un solo arranque con WMI caido borraria el uuid y
 * los discos guardados, y la siguiente comparacion se quedaria sin senales.
 */
function conviene_resellar(guardada, actual) {
  if (compararHuella(guardada, actual) !== 'misma') return false;
  return fuerza(actual) >= fuerza(guardada);
}

module.exports = {
  VERSION_HUELLA,
  construirHuella,
  compararHuella,
  conviene_resellar,
  fuerza,
};
