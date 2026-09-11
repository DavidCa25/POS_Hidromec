// arranque.js
// El camino desde que Electron esta listo hasta que hay una ventana.
//
// POR QUE ESTO VIVE EN SU PROPIO MODULO
// -------------------------------------
// En QA, una laptop secundaria YA configurada -con `install-config.json` y un
// `db-config.json` correctos- escribia esto en el registro y nada mas:
//
//     ==== App iniciada ==== v1.2.0
//     [SETUP] Maquina secundaria: no se instala SQL, solo se conecta por red.
//
// Ni conexion, ni intento, ni error, ni ventana. Dos lineas y silencio. Con el
// arranque escrito en linea dentro de `app.whenReady()`, no habia forma de
// saber si se habia quedado esperando, si habia vuelto antes de tiempo o si
// alguien se habia tragado una excepcion: la unica manera de averiguarlo era
// reproducirlo en la maquina del cliente.
//
// Aqui el arranque es una secuencia con nombre, que anuncia cada paso y recibe
// sus dependencias desde fuera. Eso permite dos cosas que antes no se podian:
// leer el registro y saber exactamente donde se quedo, y ejercitar el camino
// entero -incluido el de una secundaria ya instalada- en una prueba, sin
// Electron y sin SQL Server.
//
// LA REGLA QUE SE ROMPIO
// ----------------------
// "Maquina secundaria: no se instala SQL" es el resultado de un paso
// intermedio, no un final. Despues de esa linea SIEMPRE tiene que venir
// conectar y abrir la ventana, o un error con su traza. Nunca silencio.

/** Los pasos, en orden. Se anuncian tal cual en el registro. */
const PASOS = [
  'leer-instalacion',
  'comprobar-configuracion',
  'preparar-servidor',
  'conectar',
  'arrancar-aplicacion',
  'listo',
];

/**
 * @param {object} deps
 *   cargarInstalacion()   -> objeto de install-config.json, o null
 *   hayConfiguracion()    -> bool, SIN conectarse
 *   prepararServidor(i)   -> instala/valida el motor segun el rol
 *   conectar()            -> abre la conexion y devuelve el pool
 *   arrancarApp()         -> migraciones, ventana principal y lo demas
 *   abrirAsistente(motivo)
 *   avisarFallo({ paso, error })
 *   log / logError
 * @returns {{destino:'asistente'|'aplicacion'|'fallo', paso:string, motivo?:string}}
 */
async function arrancar(deps) {
  const {
    cargarInstalacion, hayConfiguracion, prepararServidor, conectar,
    arrancarApp, abrirAsistente, avisarFallo,
    log = () => {}, logError = () => {},
  } = deps;

  let paso = PASOS[0];
  const anunciar = (p, detalle) => {
    paso = p;
    log(`[ARRANQUE] ${p}${detalle ? ': ' + detalle : ''}`);
  };

  try {
    anunciar('leer-instalacion');
    const install = cargarInstalacion();

    if (!install) {
      log('[ARRANQUE] sin instalacion previa: se abre el asistente.');
      abrirAsistente('sin-instalacion');
      return { destino: 'asistente', paso, motivo: 'sin-instalacion' };
    }

    const rol = install.role || 'principal';
    anunciar('comprobar-configuracion', `rol ${rol}, servidor ${install.server}`);

    if (!hayConfiguracion()) {
      // Instalacion a medias: se registro el alta pero la configuracion de
      // base no sirve. Intentar conectar serian 20 reintentos para acabar en
      // el mismo sitio un minuto despues.
      log('[ARRANQUE] hay instalacion registrada pero db-config.json no es utilizable: se abre el asistente.');
      abrirAsistente('configuracion-invalida');
      return { destino: 'asistente', paso, motivo: 'configuracion-invalida' };
    }
    log('[ARRANQUE] configuracion de base valida.');

    anunciar('preparar-servidor', rol);
    await prepararServidor(install);
    log('[ARRANQUE] servidor preparado.');

    /* CONECTAR ES UN PASO PROPIO, Y SE ANUNCIA.
       Antes esto ocurria dentro de `bootMainApp`, en su primera linea y sin
       decir nada. Si la conexion no volvia, el registro se quedaba en la
       linea anterior -la del rol secundaria- y parecia que el flujo terminaba
       ahi. Ahora hay una linea antes y otra despues: entre las dos solo cabe
       la conexion. */
    anunciar('conectar', install.server);
    const pool = await conectar();
    log('[ARRANQUE] conexion establecida.');

    anunciar('arrancar-aplicacion');
    await arrancarApp(pool);

    anunciar('listo');
    return { destino: 'aplicacion', paso };
  } catch (error) {
    /* NADA DE ERRORES MUDOS.
       Se registra el paso y la traza completa, y se avisa por pantalla. Un
       fallo antes de la ventana deja al usuario sin nada que mirar: si
       ademas no escribe en el registro, no hay forma de diagnosticarlo. */
    logError(`[ARRANQUE] fallo en el paso "${paso}": ${error?.message || error}`);
    if (error?.stack) logError(error.stack);
    if (error?.cause) logError(`[ARRANQUE] causa: ${error.cause.message || error.cause}`);
    try { avisarFallo({ paso, error }); } catch (e) { logError(`[ARRANQUE] ademas fallo el aviso: ${e.message}`); }
    return { destino: 'fallo', paso, motivo: error?.message || String(error) };
  }
}

module.exports = { arrancar, PASOS };
