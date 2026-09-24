/**
 * "ESTA INSTALACION YA ESTA DADA DE ALTA?"
 *
 * Una sola frase decide si alguien ve el asistente de primer arranque o el
 * Login. Equivocarse hacia un lado es una molestia; equivocarse hacia el otro
 * es mandar al asistente a una caja que ya vende, con su negocio, sus
 * usuarios y su historial. Eso no es un paso de mas: es una pantalla que pide
 * crear un administrador que ya existe, sobre una base que ya opera.
 *
 * Por eso vive aqui y no dentro del manejador de IPC: para que una prueba
 * pueda EJECUTARLA sobre cada forma de instalacion que existe ahi fuera, en
 * vez de leer el codigo y suponer.
 *
 * LA REGLA
 * --------
 *     configurado = hay usuarios activos  O  hay negocio configurado
 *
 * Es una UNION de dos senales que ya existen en cualquier base historica. Eso
 * es lo que la hace compatible sin backfill y sin metadata nueva: no pregunta
 * por una columna que las instalaciones viejas no tienen, sino por filas que
 * todas tienen desde siempre.
 *
 * POR QUE NO SOLO `usuarios`
 *   Era asi, y `negocio_configurado` se calculaba sin que nadie lo leyera.
 *   Los usuarios se cuentan solo si estan ACTIVOS: desactivarlos a todos
 *   daba cero y devolvia al asistente una instalacion completa.
 *
 * POR QUE NO SOLO `negocio_configurado`
 *   Habria sido peor. Una instalacion antigua sin esa fila -o de una version
 *   anterior a `business_config`- habria vuelto al asistente de golpe.
 *
 * POR QUE `O` Y NO `Y`
 *   Con `O`, el conjunto de instalaciones que entran directas solo puede
 *   CRECER respecto a la regla anterior. Ninguna que hoy entra al Login puede
 *   empezar a ver el asistente. Esa es la propiedad que se queria, y es la
 *   que hace segura la transicion.
 */

/**
 * @param {{usuarios?: number|string, negocio_configurado?: number|string}} fila
 *        Lo que devuelve `sp_setup_status`.
 * @returns {boolean} true si NO hay que mostrar el asistente.
 */
function estaConfigurado(fila) {
  const usuarios = Number(fila?.usuarios) || 0;
  const negocio = Number(fila?.negocio_configurado) || 0;
  return usuarios > 0 || negocio > 0;
}

module.exports = { estaConfigurado };
