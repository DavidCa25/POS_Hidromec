/**
 * EL GESTOR DE DEMOSTRACIONES. Solo existe en el build interno.
 *
 * COMO SE SEPARA DEL PRODUCTO PUBLICO
 * -----------------------------------
 * Esta carpeta NO se empaqueta en `Wybix-Setup.exe`. La comprobacion no es un
 * `if` ni una bandera que alguien pueda poner a mano: es que el archivo no
 * existe. `main.js` lo pide con un `require` envuelto en try, y si no esta,
 * no hay gestor, no hay IPC destructivo y no hay perfiles. El build publico
 * se puede abrir con un editor de recursos y no habra nada que activar.
 *
 * EL AISLAMIENTO
 * --------------
 * Todo lo que Wybix guarda en la maquina cuelga de `app.getPath('userData')`:
 * db-config, install-config, device-config, licencia, registros, cache,
 * miniaturas, localStorage y preferencias. Mover ESA raiz mueve las trece
 * cosas de golpe, y por eso el aislamiento es una linea y no trece parches
 * repartidos por el codigo.
 *
 *     Normal:  %APPDATA%\wybix-pos
 *     Demo:    %APPDATA%\wybix-pos-demo
 *
 * Se llama antes de `app.whenReady()` y antes de que nada lea una ruta. Si se
 * llamara despues, algun modulo ya habria resuelto la suya contra la carpeta
 * de la instalacion real, que es exactamente lo que no puede pasar.
 */
const fs = require('fs');
const path = require('path');

const SUFIJO = '-demo';

/** El nombre con el que la licencia distingue este espacio del normal. */
const ESPACIO = 'demo';

/**
 * Mueve la raiz de datos de la aplicacion.
 *
 * Devuelve la ruta nueva. Es idempotente: llamarla dos veces no encadena dos
 * sufijos, porque se compone desde el directorio padre y el nombre base.
 *
 * EL ESPEJO DE LA LICENCIA NO CUELGA DE AQUI
 * ------------------------------------------
 * Trece cosas se mueven con este `setPath`, pero una no: el espejo de la
 * licencia vive en `appData`, que es `%APPDATA%` a secas y no cambia. Sin
 * decirselo al almacen de licencia, la demo escribiria en el MISMO archivo que
 * la instalacion real de la misma maquina. Por eso se declara el espacio aqui,
 * en la misma linea de codigo que mueve todo lo demas: si se separan, alguien
 * movera los datos algun dia y se olvidara del espejo.
 */
function aislarDatos(app) {
  /* Antes de nada, incluso si las rutas ya estaban movidas: el espacio vive en
     memoria del modulo de licencia y hay que declararlo en cada arranque. */
  try { require('../license').usarEspacio(ESPACIO); }
  catch (e) { console.error('[DEMO] no se pudo aislar el espejo de licencia:', e.message); }

  const actual = app.getPath('userData');
  if (actual.endsWith(SUFIJO)) return actual;
  const destino = actual + SUFIJO;
  fs.mkdirSync(destino, { recursive: true });
  app.setPath('userData', destino);
  // La cache tiene su propia ruta y no siempre cuelga de userData.
  try { app.setPath('sessionData', destino); } catch { /* electron antiguo */ }
  return destino;
}

/**
 * Borra lo que la demo dejo en la maquina.
 *
 * Se borra la CARPETA entera de datos de la demo, no fichero por fichero: una
 * lista de nombres se queda corta en cuanto alguien anade un config nuevo, y
 * lo que quede detras reaparece en la siguiente demo como un ajuste fantasma.
 *
 * Solo se toca si la ruta acaba en el sufijo. Una ruta que no lo lleve es la
 * de una instalacion real y no se toca por ningun motivo.
 */
function limpiarDatos(app, { log = () => {} } = {}) {
  const dir = app.getPath('userData');
  if (!dir.endsWith(SUFIJO)) {
    log(`[DEMO] NO se limpia ${dir}: no es la carpeta de una demo.`);
    return { ok: false, motivo: 'La carpeta de datos no es la de una demo.' };
  }
  if (!fs.existsSync(dir)) return { ok: true, borrada: false };
  /* Se vacia en vez de borrar la carpeta: Electron la tiene abierta y
     eliminarla entera deja la sesion escribiendo en un directorio fantasma. */
  for (const entrada of fs.readdirSync(dir)) {
    const p = path.join(dir, entrada);
    try { fs.rmSync(p, { recursive: true, force: true }); }
    catch (e) { log(`[DEMO] no se pudo borrar ${entrada}: ${e.message}`); }
  }
  /* Y el espejo de la licencia de la demo, que NO esta dentro de esta carpeta:
     vive en `appData` con un nombre propio. Si se quedara, la siguiente demo
     encontraria media licencia de la anterior -el espejo sin la principal- y
     el almacen la daria por buena rehaciendo la copia que falta.

     Se comprueba el nombre antes de borrar. El de la instalacion normal es
     `.wxsys.dat` y no lleva sufijo: si por lo que sea el espacio no estuviera
     declarado, esta linea borraria la licencia de un cliente. */
  try {
    const espejo = require('../license')._internos.mirrorPath();
    if (/\.wxsys-[a-z0-9-]+\.dat$/i.test(espejo)) {
      if (fs.existsSync(espejo)) fs.rmSync(espejo, { force: true });
      log(`[DEMO] espejo de licencia de la demo borrado: ${espejo}`);
    } else {
      log(`[DEMO] NO se toca ${espejo}: no lleva el nombre de un espacio de demo.`);
    }
  } catch (e) {
    log(`[DEMO] no se pudo borrar el espejo de licencia: ${e.message}`);
  }

  log(`[DEMO] datos locales de la demo vaciados: ${dir}`);
  return { ok: true, borrada: true, dir };
}

/**
 * Borra la configuracion local que apunta a UNA demo concreta.
 *
 * POR QUE NO BASTA CON BORRAR LA BASE
 * -----------------------------------
 * Abrir una demo escribe `db-config.json` -a que base conectarse- e
 * `install-config.json` -que hay una instalacion registrada-. Los dos viven en
 * la carpeta de datos de la demo, que es COMUN a todos los perfiles: no hay una
 * por perfil, hay una para "la demo".
 *
 * Si se elimina Hospitality y esos dos archivos se quedan apuntando a
 * `Wybix_Demo_Hospitality`, la siguiente demo arranca sobre la configuracion de
 * la anterior. Eso es lo que hacia que crear Retail acabara ensenando
 * Hospitality.
 *
 * Solo se borra si la configuracion es DE ESA BASE. Eliminar Retail mientras
 * Hospitality esta configurada no puede dejar a Hospitality sin configuracion.
 */
function olvidarConfiguracion(app, base, { log = () => {} } = {}) {
  const dir = app.getPath('userData');
  if (!dir.endsWith(SUFIJO)) {
    log(`[DEMO] NO se toca la configuracion de ${dir}: no es la carpeta de una demo.`);
    return { ok: false, motivo: 'La carpeta de datos no es la de una demo.' };
  }

  const cfg = path.join(dir, 'db-config.json');
  let apunta = false;
  try {
    apunta = JSON.parse(fs.readFileSync(cfg, 'utf8')).database === base;
  } catch {
    return { ok: true, borrada: false };  // sin configuracion, nada que olvidar
  }
  if (!apunta) return { ok: true, borrada: false };

  for (const archivo of ['db-config.json', 'install-config.json']) {
    try { fs.rmSync(path.join(dir, archivo), { force: true }); }
    catch (e) { log(`[DEMO] no se pudo borrar ${archivo}: ${e.message}`); }
  }
  log(`[DEMO] configuracion local de ${base} olvidada.`);
  return { ok: true, borrada: true };
}

/** Lo que se ensena en la barra cuando la base es una demo. */
async function etiquetaDemo(pool) {
  try {
    const r = await pool.request().query(
      "SELECT clave, valor FROM dbo.database_metadata WHERE clave IN ('is_demo','demo_profile');");
    const m = {};
    for (const f of r.recordset || []) m[f.clave] = f.valor;
    if (String(m.is_demo).toLowerCase() !== 'true') return null;
    return { demo: true, perfil: m.demo_profile || null };
  } catch {
    return null;
  }
}

module.exports = {
  SUFIJO,
  ESPACIO,
  aislarDatos,
  limpiarDatos,
  olvidarConfiguracion,
  etiquetaDemo,
  registrar: (deps) => require('./ipc').registrar(deps),
  abrirGestor: (deps) => require('./ventana').abrir(deps),
  leerPerfiles: (app) => require('./gestor').leerPerfiles(app),
};
