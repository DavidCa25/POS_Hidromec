/**
 * QUIEN ESTA OPERANDO, SEGUN EL PROCESO PRINCIPAL.
 *
 * EL RENDERER NO DECLARA QUIEN ES
 * -------------------------------
 * No existe `establecerSesion(userId, rol)`. El renderer manda credenciales;
 * este modulo recibe lo que SQL respondio -id, rol, activo- y crea la sesion.
 * El identificador de usuario nunca entra como parametro desde fuera: sale de
 * la consulta. Una capa que no podemos creer no puede decir "soy admin".
 *
 * ATADA A LA VENTANA, NO GLOBAL
 * -----------------------------
 * La sesion se guarda por `webContents.id`. Wybix abre seis ventanas con
 * cuatro preloads distintos -principal, asistente, pantalla de cliente, su
 * vista previa, impresion y el gestor de demos-, y ninguna salvo la principal
 * inicia sesion. Con un unico objeto global, cualquiera de las otras podria
 * invocar un canal sensible por conocer su nombre. Con el mapa por ventana,
 * simplemente no tienen sesion.
 *
 * Y si Electron crea un webContents NUEVO tras un fallo del renderer, ese no
 * hereda nada: vuelve al login. Una molestia recuperable es preferible a que
 * una ventana nueva reciba los permisos de otra.
 *
 * LOS PERMISOS NO SE CONGELAN
 * ---------------------------
 * Guardarlos al entrar y no volver a mirarlos significa que retirarle a
 * alguien un permiso desde otra caja no surte efecto hasta que cierre sesion.
 * En un turno de ocho horas, eso es una tarde entera.
 *
 * La solucion es `security_revision`, un contador en la base que sube cuando
 * cambia un rol o el estado activo de alguien. La sesion recuerda con que
 * revision calculo, y antes de cada accion sensible comprueba si la base va
 * por otra. Para que eso no sea una consulta por evento, la revision se lee
 * como mucho una vez cada `TTL_REVISION_MS`.
 *
 * LA GARANTIA, DICHA SIN EXAGERAR
 * -------------------------------
 * No es instantaneo y no hace falta que lo sea. Un cambio hecho en otra caja
 * lo respeta la siguiente accion sensible, con un retraso maximo de cinco
 * segundos. Lo que se evita es "hasta que cierre sesion", que era el problema.
 */

/**
 * Cuanto puede quedarse vieja la revision antes de volver a preguntarla.
 *
 * Cinco segundos es un compromiso explicito: con menos, una caja ocupada
 * consultaria la base varias veces por minuto sin que nada haya cambiado; con
 * mas, un permiso retirado seguiria vivo demasiado tiempo. Un cambio de rol
 * ocurre unas pocas veces al ano, asi que casi siempre la lectura confirma
 * que no hay nada nuevo.
 */
const TTL_REVISION_MS = 5000;

const { normalizarRol, permisosDeRol, etiquetaDeRol, esAltoRiesgo } = require('./permisos');
const { exigePara } = require('./canales');

/** webContents.id -> sesion */
const sesiones = new Map();

/** Cache de la revision de seguridad de la base, comun a todas las sesiones. */
let revisionCache = { valor: null, leidaEn: 0, fallo: false };

/**
 * Lo que este modulo necesita del resto del mundo. Se inyecta para poder
 * ejercitarlo sin Electron ni SQL Server.
 */
let deps = {
  leerRevision: async () => 0,
  leerUsuario: async () => null,
  modulosActivos: async () => new Set(),
  registrar: () => {},
};

function configurar(nuevas) {
  deps = { ...deps, ...nuevas };
}

/**
 * La revision de la base, como mucho una consulta cada TTL.
 *
 * Devuelve tambien si la ultima lectura fallo: quien autoriza necesita
 * distinguir "la base dice que nada cambio" de "no pude preguntarle".
 */
async function revisionActual(forzar = false) {
  const ahora = Date.now();
  const fresca = revisionCache.valor !== null && (ahora - revisionCache.leidaEn) < TTL_REVISION_MS;
  if (!forzar && fresca) return { valor: revisionCache.valor, fiable: true };

  try {
    const v = Number(await deps.leerRevision());
    revisionCache = { valor: Number.isFinite(v) ? v : 0, leidaEn: ahora, fallo: false };
    return { valor: revisionCache.valor, fiable: true };
  } catch {
    revisionCache.fallo = true;
    /* No se actualiza `leidaEn`: si la base vuelve, la proxima comprobacion
       reintenta en vez de esperar otro TTL con un dato que no se pudo leer. */
    return { valor: revisionCache.valor, fiable: false };
  }
}

/**
 * Olvida la revision cacheada: la proxima comprobacion vuelve a preguntar.
 *
 * Existe porque el TTL responde a cambios hechos en OTRA caja, y este proceso
 * sabe de sobra cuando el cambio lo hizo el. Cuando alguien cambia un rol o
 * desactiva a una persona desde esta misma ventana, esperar cinco segundos a
 * que la propia caja se entere seria absurdo: llamando a esto, el efecto es
 * inmediato aqui y sigue tardando como mucho un TTL en las demas.
 */
function invalidarRevision() {
  revisionCache = { valor: null, leidaEn: 0, fallo: false };
}

/**
 * Abre sesion para una ventana. Solo la llama el handler de login, y solo
 * DESPUES de que SQL haya validado las credenciales.
 */
async function abrir(webContentsId, fila) {
  if (!fila || !fila.id) throw new Error('Sesion sin usuario validado.');
  const rol = normalizarRol(fila.rol);
  const { valor } = await revisionActual(true);
  const sesion = {
    webContentsId,
    userId: Number(fila.id),
    usuario: String(fila.usuario || ''),
    rol,
    rolCrudo: String(fila.rol || ''),
    permisos: permisosDeRol(rol),
    revision: valor,
    autenticadaEn: Date.now(),
  };
  sesiones.set(webContentsId, sesion);
  return sesion;
}

function cerrar(webContentsId) { return sesiones.delete(webContentsId); }
function cerrarTodas() { sesiones.clear(); revisionCache = { valor: null, leidaEn: 0, fallo: false }; }
function de(webContentsId) { return sesiones.get(webContentsId) || null; }

/**
 * La sesion con los permisos al dia.
 *
 * `fiable` dice si la comprobacion pudo hacerse contra la base. Si no pudo,
 * la sesion sigue siendo la que estaba: quien autoriza decidira si eso basta
 * segun el riesgo de la operacion.
 */
async function vigente(webContentsId) {
  const s = sesiones.get(webContentsId);
  if (!s) return { sesion: null, fiable: true };

  const { valor, fiable } = await revisionActual();
  if (!fiable) return { sesion: s, fiable: false };
  if (valor === s.revision) return { sesion: s, fiable: true };

  let u;
  try { u = await deps.leerUsuario(s.userId); }
  catch { return { sesion: s, fiable: false }; }

  if (!u || u.active === false || u.active === 0) {
    sesiones.delete(webContentsId);
    return { sesion: null, fiable: true };
  }
  const rol = normalizarRol(u.rol);
  s.rol = rol;
  s.rolCrudo = String(u.rol || '');
  s.permisos = permisosDeRol(rol);
  s.revision = valor;
  return { sesion: s, fiable: true };
}

/**
 * Las cuatro preguntas, separadas a proposito.
 *
 *   sesion      ¿quien eres y estas autenticado?
 *   permiso     ¿puedes ejecutar esto AHORA?
 *   capacidad   ¿el negocio tiene esta funcion AHORA?
 *   dispositivo ¿esta caja puede hacerlo? -> lo resuelve el Core: turno,
 *               arriendo y perfil de equipo, que ya existen y no se tocan.
 *
 * Una capacidad no es un permiso y no se guarda en la sesion: se pregunta al
 * estado del negocio cada vez, con su propia cache. Apagar un modulo desde
 * otra caja tiene que surtir efecto sin que nadie cierre sesion.
 */
async function comprobar(webContentsId, permiso, opciones = {}) {
  const { sesion: s, fiable } = await vigente(webContentsId);
  if (!s) return { ok: false, motivo: 'SIN_SESION' };

  if (permiso) {
    /* NO HAY FAIL-OPEN GENERAL.
       Si no se pudo comprobar contra la base, una operacion de alto riesgo no
       se ejecuta. Una de venta si, dentro de la ventana de cache y solo
       porque sus permisos ya se validaron al abrir la sesion: dejar una caja
       sin vender por un corte de red de un segundo es un fallo peor que el
       que se intenta evitar. */
    if (!fiable && esAltoRiesgo(permiso)) {
      return { ok: false, motivo: 'SIN_VERIFICAR', permiso };
    }
    if (!s.permisos.has(permiso)) {
      return { ok: false, motivo: 'SIN_PERMISO', permiso, userId: s.userId };
    }
  }

  const modulo = opciones.modulo;
  if (modulo) {
    let activos;
    try { activos = await deps.modulosActivos(); }
    catch { return { ok: false, motivo: 'MODULO_INDETERMINADO', modulo }; }
    if (!activos || !activos.has(modulo)) {
      return { ok: false, motivo: 'MODULO_APAGADO', modulo };
    }
  }
  return { ok: true, sesion: s };
}

const MENSAJES = {
  SIN_SESION: 'Inicia sesión para continuar.',
  SIN_PERMISO: 'Tu usuario no tiene acceso a esta operación.',
  SIN_VERIFICAR: 'No se pudo comprobar tu acceso. Revisa la conexión e inténtalo de nuevo.',
  MODULO_APAGADO: 'Esta función no está activada para el negocio.',
  MODULO_INDETERMINADO: 'No se pudo comprobar si la función está activada.',
};

/**
 * La UNICA puerta de autorizacion del proceso principal.
 *
 *     ipcMain.handle(CANAL, sesion.proteger(CANAL, async (e, p) => { ... }));
 *
 * El paquete NO se escribe aqui: sale del mapa de `canales.js`. Asi la
 * respuesta a "que protege Wybix" esta en una tabla y no repartida por el
 * archivo. El handler recibe la sesion como ultimo argumento.
 */
function proteger(canal, handler, opciones = {}) {
  const permiso = exigePara(canal);
  return async function (evento, ...args) {
    const id = evento?.sender?.id;
    const r = await comprobar(id, permiso, opciones);
    if (!r.ok) {
      deps.registrar({ tipo: 'ACCESO_DENEGADO', canal, motivo: r.motivo, permiso, webContentsId: id });
      return { success: false, ok: false, error: MENSAJES[r.motivo] || 'No autorizado.', motivo: r.motivo };
    }
    return handler(evento, ...args, r.sesion);
  };
}

/** Lo que el renderer puede saber de si mismo: para pintar, no para decidir. */
function retrato(sesion) {
  if (!sesion) return null;
  return {
    userId: sesion.userId,
    usuario: sesion.usuario,
    rol: sesion.rol,
    rolEtiqueta: etiquetaDeRol(sesion.rol),
    rolConocido: sesion.rol !== 'sin-rol',
    permisos: [...sesion.permisos],
  };
}

module.exports = {
  TTL_REVISION_MS, MENSAJES,
  configurar, abrir, cerrar, cerrarTodas, de, vigente,
  comprobar, proteger, retrato, revisionActual, invalidarRevision,
  _sesiones: sesiones,
};
