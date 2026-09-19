/**
 * LOS GIROS DE SERVICIOS, PARA EL PROCESO PRINCIPAL.
 *
 * No define nada: lee `presets.json`, que es la fuente unica, y le pone
 * alrededor lo poco que hace falta para usarla desde Node —buscar por
 * identificador y rechazar lo que no existe—. La interfaz importa el MISMO
 * JSON por su lado, asi que no hay dos listas que puedan separarse.
 *
 * POR QUE VALIDA AQUI Y NO SOLO EN LA VENTANA
 * -------------------------------------------
 * Porque el identificador del giro acaba en un procedimiento almacenado y en
 * el nombre de un archivo de semilla. Un `presetId` que llegue con algo raro
 * dentro no puede pasar de esta linea: se comprueba contra la lista, no
 * contra una expresion regular, que es lo unico que garantiza que solo pasen
 * los cinco que existen.
 */
const DEFINICION = require('./presets.json');

/** Los giros, ya ordenados como se van a ensenar. */
const PRESETS = [...DEFINICION.presets].sort((a, b) => (a.orden ?? 99) - (b.orden ?? 99));

/** Los identificadores validos, para comprobar de un vistazo. */
const IDS = PRESETS.map(p => p.id);

/**
 * El giro con el que se queda un negocio que no eligio ninguno.
 *
 * Existe para las bases anteriores a esto: encendieron Servicios cuando no
 * habia giros, y al abrir siguen viendo exactamente lo de siempre. No se les
 * cambia nada por la espalda, y pueden elegir uno cuando quieran.
 */
const POR_DEFECTO = 'OTRO';

/** El giro pedido, o `null` si no es uno de los que existen. */
function buscar(id) {
  const clave = String(id || '').trim().toUpperCase();
  return PRESETS.find(p => p.id === clave) || null;
}

/** El giro pedido, o un error. Para los sitios donde seguir no tiene sentido. */
function exigir(id) {
  const p = buscar(id);
  if (!p) {
    throw new Error(`Giro de Servicios desconocido: ${JSON.stringify(id)}. ` +
                    `Los que existen son ${IDS.join(', ')}.`);
  }
  return p;
}

module.exports = { PRESETS, IDS, POR_DEFECTO, buscar, exigir, version: DEFINICION.version };
