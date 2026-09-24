// license.js
// Almacenamiento blindado de la licencia / prueba:
//   - Cifrado AES-256-CBC (encrypt-then-MAC)
//   - Firma HMAC-SHA256: editar el archivo a mano lo invalida
//   - Copia espejo en OTRA carpeta: borrar/editar solo una no sirve
//   - Ancla de reloj (lastSeen) en ambas copias: retrasar la fecha no extiende
//   - Huella de maquina GUARDADA y comparada por senales (electron/lib/huella)
//   - Migra automaticamente los formatos anteriores
//
// ===========================================================================
// POR QUE CAMBIO EL FORMATO (v2 -> v3)
// ===========================================================================
// Hasta el formato v2, la LLAVE DE CIFRADO se derivaba del machineId:
//
//     keyFor(machineId) = sha256(SECRET || machineId)
//
// y el machineId incluia `os.hostname()` y dependia de que `wmic` respondiera.
// Eso mezclaba dos preguntas que no son la misma:
//
//     "¿puedo leer este archivo?"   y   "¿es la misma maquina?"
//
// Renombrar el equipo -o un fallo temporal de WMI- hacia fallar la primera, y
// el modulo respondia la segunda: licencia legitima marcada como manipulada y
// aplicacion bloqueada. Es el defecto que se encontro en QA.
//
// En el formato v3 la llave se deriva de una SAL ALEATORIA por instalacion,
// guardada en claro en la cabecera. El archivo siempre descifra en la maquina
// que lo escribio, pase lo que pase con el hardware. La identidad se decide
// aparte, comparando la huella guardada contra la actual, senal por senal.
//
// QUE SE PIERDE Y QUE NO
// ----------------------
// Con la sal en claro, quien extraiga SECRET del binario podria LEER el
// contenido de la licencia. Antes tambien necesitaba el machineId, que se
// calcula en la maquina destino de todos modos, asi que la diferencia real es
// pequena. Lo que NO cambia es lo que importa: el HMAC sigue cubriendo el
// contenido, asi que EDITAR una licencia -estirar la fecha, cambiar el plan-
// sigue siendo imposible sin SECRET. Y copiar la licencia a otra PC se sigue
// rechazando, ahora por la huella en vez de por no poder descifrar.
//
// COMPATIBILIDAD
// --------------
//   v3          se lee y se compara la huella.
//   v2          se descifra con el machineId v1. Si abre, se re-sella como v3
//               en el acto: el cliente no se entera de nada.
//   v2 + WMI    si el machineId actual no abre el archivo, se prueban las
//               variantes ENUMERABLES de la huella v1 degradada (sin uuid, sin
//               disco, sin ninguno de los dos). Eso recupera exactamente el
//               caso "wmic no respondio al arrancar".
//   legado      texto plano de versiones muy viejas: se acepta y se re-sella.
//
// Lo unico irrecuperable es una licencia v2 en un equipo que YA fue renombrado
// antes de esta version: su llave dependia de un hostname que ya no existe y
// no hay forma de derivarla. Esos equipos siguen viendo el mensaje de siempre
// -"No pudimos validar tu licencia, activa tu clave"- y se resuelven
// reactivando.
// ===========================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const { construirHuella, compararHuella, conviene_resellar } = require('./lib/huella');

// Secreto de firma/cifrado (ofuscado por partes; no aparece literal en el codigo).
const _seed = ['W7bx', '9pOS', 'kL2z', 'Q8vT', 'mN4r', 'Zr1c'];
const SECRET = crypto.createHash('sha256').update(_seed.join('-') + '::wybix::lic::v2').digest(); // 32 bytes

const FORMATO = 3;

/**
 * EL ESPACIO DE DATOS. Vacio es la instalacion normal.
 *
 * POR QUE HACE FALTA
 * ------------------
 * La copia principal cuelga de `userData`, que el gestor de demos ya mueve
 * entero con un `setPath`. El ESPEJO no: cuelga de `appData`, que es
 * `%APPDATA%` a secas y es el mismo directorio para las dos instalaciones. Con
 * un solo nombre de archivo, Wybix Demo y Wybix normal escribian y leian el
 * MISMO `.wxsys.dat` en la misma maquina. Activar una demo pisaba el espejo de
 * la instalacion real, y a la siguiente lectura las dos copias dejaban de
 * coincidir en una maquina donde nadie habia manipulado nada.
 *
 * POR QUE EL ESPEJO NO SE MUEVE A `userData`
 * ------------------------------------------
 * Porque entonces no seria un espejo. Las dos copias viven en carpetas
 * distintas a proposito: borrar o editar una sola no sirve de nada. Meterlo
 * dentro de `userData` las juntaria y la proteccion se perderia. Lo que cambia
 * es el NOMBRE, no la carpeta.
 *
 * POR QUE SE DECLARA Y NO SE ADIVINA
 * ----------------------------------
 * Este modulo no puede preguntarle a `electron/demo`: esa carpeta no existe en
 * el instalador publico. Y deducirlo comparando rutas obligaria a reconstruir
 * cual "seria" la carpeta por defecto, que depende de como Electron resuelve
 * el nombre de la aplicacion. Se declara: quien mueve los datos lo dice, y
 * quien no dice nada se queda con el archivo de siempre. El build publico no
 * llama a esto en ningun sitio, asi que su comportamiento es identico al de
 * antes, byte por byte.
 *
 * NO ES UN CONTROL DE SEGURIDAD. Solo decide DONDE se guarda la licencia. No
 * salta ninguna validacion, no toca la huella ni el machineId, y apuntar a un
 * espacio equivocado no regala una licencia: deja de encontrarse la que habia.
 */
let espacio = '';

/**
 * Declara el espacio de datos. Se llama UNA vez, antes de leer nada.
 *
 * Se normaliza a lo que puede formar un nombre de archivo sano: cualquier otra
 * cosa se descarta en vez de acabar en una ruta compuesta a medias.
 */
function usarEspacio(nombre) {
  espacio = String(nombre || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24);
  return espacio;
}

/**
 * El espacio reservado a las demostraciones.
 *
 * `electron/demo/index.js` lo declara al arrancar el gestor, y es lo que hace
 * que la demo escriba su espejo en `.wxsys-demo.dat` en vez de pisar el del
 * cliente.
 */
const ESPACIO_DEMO = 'demo';

/** ¿Esta ventana es una demostracion? */
function esDemo() { return espacio === ESPACIO_DEMO; }

function mainPath()   { return path.join(app.getPath('userData'), 'license.json'); }
function mirrorPath() {
  return path.join(app.getPath('appData'), espacio ? `.wxsys-${espacio}.dat` : '.wxsys.dat');
}

/** Llave del formato v3: sal por instalacion, no hardware. */
function claveDeSal(salt) {
  return crypto.createHash('sha256')
    .update(Buffer.concat([SECRET, Buffer.from(String(salt || ''), 'hex')]))
    .digest();
}

/** Llave del formato v2 (legado): derivada del machineId. */
function claveDeMaquina(machineId) {
  return crypto.createHash('sha256')
    .update(Buffer.concat([SECRET, Buffer.from(String(machineId || ''))]))
    .digest();
}

function safeEq(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ba, bb); } catch { return false; }
}

function cifrarV3(obj) {
  const salt = crypto.randomBytes(16).toString('hex');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', claveDeSal(salt), iv);
  const pt = Buffer.from(JSON.stringify(obj), 'utf8');
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const body = Buffer.concat([iv, ct]);
  // El HMAC cubre el cuerpo Y la sal: cambiar la sal invalida la firma.
  const mac = crypto.createHmac('sha256', SECRET)
    .update(Buffer.concat([body, Buffer.from(salt, 'hex')])).digest('hex');
  return { v: FORMATO, salt, b: body.toString('base64'), s: mac };
}

function descifrarV3(blob) {
  if (!blob || blob.v !== FORMATO || !blob.b || !blob.s || !blob.salt) return null;
  const body = Buffer.from(blob.b, 'base64');
  const mac = crypto.createHmac('sha256', SECRET)
    .update(Buffer.concat([body, Buffer.from(String(blob.salt), 'hex')])).digest('hex');
  if (!safeEq(mac, blob.s)) return null; // firma invalida -> manipulado
  try {
    const iv = body.subarray(0, 16);
    const ct = body.subarray(16);
    const decipher = crypto.createDecipheriv('aes-256-cbc', claveDeSal(blob.salt), iv);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return JSON.parse(pt.toString('utf8'));
  } catch { return null; }
}

/**
 * Cifra en el formato v2. Ya no se usa para guardar: existe para que las
 * pruebas puedan FABRICAR una licencia como la escribia la version anterior y
 * comprobar que se migra. Duplicar el algoritmo en la prueba obligaria a
 * duplicar tambien el secreto.
 */
function cifrarV2(obj, machineId) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', claveDeMaquina(machineId), iv);
  const pt = Buffer.from(JSON.stringify(obj), 'utf8');
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const body = Buffer.concat([iv, ct]);
  const mac = crypto.createHmac('sha256', SECRET)
    .update(Buffer.concat([body, Buffer.from(String(machineId))])).digest('hex');
  return { v: 2, b: body.toString('base64'), s: mac };
}

/** Formato v2 (legado): hay que aportar el machineId con el que se sello. */
function descifrarV2(blob, machineId) {
  if (!blob || blob.v !== 2 || !blob.b || !blob.s) return null;
  const body = Buffer.from(blob.b, 'base64');
  const mac = crypto.createHmac('sha256', SECRET)
    .update(Buffer.concat([body, Buffer.from(String(machineId))])).digest('hex');
  if (!safeEq(mac, blob.s)) return null;
  try {
    const iv = body.subarray(0, 16);
    const ct = body.subarray(16);
    const decipher = crypto.createDecipheriv('aes-256-cbc', claveDeMaquina(machineId), iv);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return JSON.parse(pt.toString('utf8'));
  } catch { return null; }
}

function readBlob(p) {
  try { if (!fs.existsSync(p)) return null; return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}
function writeBlob(p, blob) {
  try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(blob)); return true; }
  catch { return false; }
}

/**
 * Normaliza el contexto. Se admite un string por compatibilidad con las
 * llamadas antiguas (`saveLicense(machineId, datos)`), que siguen funcionando
 * aunque sin huella.
 */
function contexto(ctx) {
  if (typeof ctx === 'string') return { machineIdV1: ctx, candidatosV1: [ctx], huella: null };
  const c = ctx || {};
  const principal = c.machineIdV1 || '';
  // El machineId actual va primero; las variantes degradadas son el rescate.
  const candidatos = [principal, ...(c.candidatosV1 || [])].filter(Boolean);
  return {
    machineIdV1: principal,
    candidatosV1: [...new Set(candidatos)],
    huella: c.huella || null,
  };
}

/**
 * Lee una copia. Distingue v3, v2 (con sus candidatos), legado y manipulado.
 */
function loadOne(p, ctx) {
  const raw = readBlob(p);
  if (!raw) return { data: null, tampered: false, present: false };

  if (raw.v === FORMATO) {
    const d = descifrarV3(raw);
    return { data: d, tampered: !d, present: true };
  }

  if (raw.v === 2) {
    for (const id of ctx.candidatosV1) {
      const d = descifrarV2(raw, id);
      // Se marca `viejo` para que se re-selle como v3 en cuanto se pueda.
      if (d) return { data: d, tampered: false, present: true, viejo: true };
    }
    return { data: null, tampered: true, present: true };
  }

  // Formato antiguo (texto plano de versiones previas): se acepta y se migra.
  if (raw.plan || raw.type || raw.expiresAt || raw.revalidateBy) {
    return { data: raw, tampered: false, present: true, viejo: true };
  }

  return { data: null, tampered: true, present: true };
}

/**
 * Guarda la licencia en las dos copias, sellando la huella actual.
 *
 * `conservarHuella` evita degradar una huella buena cuando la lectura de
 * hardware vino incompleta: se mantiene la que ya estaba.
 */
function saveLicense(ctx, obj, conservarHuella = null) {
  const c = contexto(ctx);
  const data = { ...(obj || {}) };
  // El machineId sellado NO se reescribe: es el identificador con el que el
  // cliente ya esta dado de alta en el servidor de activacion. Si se
  // sobreescribiera, renombrar el equipo volveria a reportar una maquina
  // distinta -que era la otra mitad del mismo problema-. Solo se pone cuando
  // aun no hay ninguno, es decir en la primera activacion.
  data.machineId = data.machineId || c.machineIdV1 || '';
  data.lastSeen = Math.max(Number(obj && obj.lastSeen || 0), Date.now());
  const huella = conservarHuella || c.huella || data.fp || null;
  if (huella) data.fp = huella;

  const blob = cifrarV3(data);
  writeBlob(mainPath(), blob);
  writeBlob(mirrorPath(), blob);
  return data;
}

/**
 * Reconcilia las dos copias.
 * @returns {{ data, tampered, identidad }}
 *   identidad: 'misma' | 'otra' | 'indeterminada' | 'sin-huella'
 */
function readLicense(ctx) {
  const c = contexto(ctx);
  const a = loadOne(mainPath(), c);
  const b = loadOne(mirrorPath(), c);

  let data = null;
  if (a.data && b.data) {
    data = { ...a.data };
    // ancla de reloj: la MAS avanzada de las dos (no se puede retroceder)
    data.lastSeen = Math.max(Number(a.data.lastSeen || 0), Number(b.data.lastSeen || 0));
    // vencimiento: el MAS temprano de las dos (no se puede "estirar" una copia)
    const ea = Date.parse(a.data.expiresAt || '') || 0;
    const eb = Date.parse(b.data.expiresAt || '') || 0;
    if (ea && eb) data.expiresAt = new Date(Math.min(ea, eb)).toISOString();
    // huella: la mas completa de las dos
    data.fp = a.data.fp || b.data.fp || null;
  } else {
    data = a.data || b.data || null;
  }

  // Manipulacion real: hay una copia que NO verifica y ningun dato sano detras.
  const tampered = (a.tampered || b.tampered) && !data;
  if (tampered || !data) return { data, tampered, identidad: 'sin-huella' };

  // -------- identidad: ¿es esta la maquina donde se sello? --------
  const identidad = c.huella ? compararHuella(data.fp, c.huella) : 'sin-huella';

  const hayQueMigrar = a.viejo || b.viejo || !a.present || !b.present;
  const sellarHuella = c.huella && (identidad === 'sin-huella' ||
                                    conviene_resellar(data.fp, c.huella));

  // Nunca se re-sella cuando la maquina no coincide: seria bendecir una copia.
  if (identidad !== 'otra' && (hayQueMigrar || sellarHuella)) {
    const nueva = sellarHuella ? c.huella : data.fp;
    data = saveLicense(c, data, nueva);
  }

  return { data, tampered: false, identidad };
}

function computeStatus(ctx) {
  /*
   * UNA DEMO NO TIENE LICENCIA, Y NO DEBE FINGIR TENERLA.
   *
   * El gestor de demos prepara la base entera -negocio, giro, administrador y
   * datos-, pero el espacio de licencia queda vacio: al abrirla salia
   * "Comienza tu prueba gratis", que es exactamente el paso redundante que no
   * tiene sentido pedirle a una demo.
   *
   * La alternativa mala era sembrar una PRUEBA de verdad en la demo. Eso
   * gastaria la prueba real de la maquina -se emiten por machineId-, y ademas
   * una demo no es una prueba comercial: es una demostracion.
   *
   * `demo` es su propio estado. Se resuelve por el ESPACIO, no por un archivo,
   * asi que no hay nada que falsificar y no puede afectar jamas a la licencia
   * normal: una instalacion de cliente nunca declara este espacio.
   */
  if (esDemo()) return { state: 'demo', type: 'demo', plan: 'demo' };

  const c = contexto(ctx);
  const { data, tampered, identidad } = readLicense(c);
  if (tampered) return { state: 'tamper', motivo: 'firma' };
  if (!data) return { state: 'none' };

  // La licencia es de OTRO equipo. Antes esto se detectaba porque el archivo no
  // descifraba; ahora se detecta por la huella, que es lo que de verdad
  // distingue una copia de un cambio de nombre.
  if (identidad === 'otra') return { state: 'tamper', motivo: 'otro-equipo' };

  const now = Date.now();
  const lastSeen = Number(data.lastSeen || 0);
  const effectiveNow = Math.max(now, lastSeen); // el reloj no puede retroceder
  if (now > lastSeen) saveLicense(c, { ...data, lastSeen: now }, data.fp);

  /*
   * QUE CLASE DE LICENCIA ES ESTA.
   *
   * `type` lo escribe `sellarComoPrueba` desde que existe, asi que una
   * licencia guardada por el codigo actual SIEMPRE lo trae y este calculo ni
   * se ejecuta.
   *
   * Sin `type` la guardo una version ANTERIOR al sellado, y ahi estaba el
   * fallo: la respuesta de la prueba no traia `type` ni `plan: 'trial'`, asi
   * que caia en `paid` y la caja anunciaba "Licencia MonoCaja activada" a
   * quien acababa de pedir una prueba gratuita. El arreglo actuaba al GUARDAR,
   * asi que las instalaciones que ya habian empezado su prueba se quedaban
   * mintiendo para siempre.
   *
   * LA REGLA: `expiresAt` presente => prueba.
   *
   * Y esto NO es una heuristica: se comprobo contra el servidor de licencias.
   * `expiresAt` lo emite UN SOLO archivo de todo el backend, `trial-license`.
   * La activacion de pago (`license-check`) devuelve
   *
   *     { plan, maxRegisters, customerName, machineId,
   *       supportUntil, supportActive, revalidateBy, issuedAt }
   *
   * y ahi no hay `expiresAt` ni lo hubo nunca. Una licencia pagada no puede
   * coincidir con esta forma porque el campo no existe en su contrato.
   *
   * La version anterior de esta regla exigia ADEMAS que faltara
   * `revalidateBy`, y eso la dejaba corta: la prueba tambien lo trae
   * -`revalidateBy: expiresAt`-, asi que una prueba legada con los dos campos
   * no se reparaba. El campo que de verdad distingue es `expiresAt`.
   *
   * LA UNICA AMBIGUEDAD QUE QUEDABA, Y COMO SE RESUELVE
   * ---------------------------------------------------
   * `plan === 'trial'` era la otra senal, y esa NO es demostrable. `plan` sale
   * de la columna homonima de la tabla de licencias de pago, y esa columna no
   * tiene ninguna restriccion que impida escribir ahi la palabra `trial`. Es
   * una convencion operativa, no una garantia del contrato.
   *
   * Ante una ambiguedad NO se reclasifica. Asi que esa senal solo vale cuando
   * no hay ninguna marca de pago: `supportUntil` y `supportActive` los emite
   * UNICAMENTE `license-check`, nunca la prueba. Si vienen, es una licencia
   * pagada y se queda como esta, diga lo que diga `plan`.
   *
   * A las pruebas legadas de verdad no les cuesta nada: todas traen
   * `expiresAt`, que es la senal demostrable, y se reparan por ahi.
   */
  const marcasDePago = data.supportUntil !== undefined || data.supportActive !== undefined;
  const type = data.type
    || (data.expiresAt ? 'trial'
    : (data.plan === 'trial' && !marcasDePago ? 'trial' : 'paid'));

  if (type === 'trial') {
    const exp = Date.parse(data.expiresAt || data.revalidateBy || '') || 0;
    const daysRemaining = Math.max(0, Math.ceil((exp - effectiveNow) / 86400000));
    const state = effectiveNow < exp ? 'trial' : 'expired';
    return {
      state, type: 'trial', daysRemaining,
      expiresAt: data.expiresAt || null,
      startedAt: data.startedAt || null,
      customerName: data.customerName || ''
    };
  }

  return {
    state: 'active', type: 'paid',
    plan: data.plan || 'mono',
    customerName: data.customerName || '',
    revalidateBy: data.revalidateBy || null
  };
}

/**
 * El machineId que se le REPORTA al servidor de activacion.
 *
 * Se devuelve el que quedo sellado en la licencia mientras siga siendo la
 * misma maquina. Asi un renombrado o un fallo de WMI no cambian el
 * identificador con el que el cliente ya esta dado de alta, que era otra forma
 * del mismo problema: reactivar tras un rename reportaba una maquina distinta.
 */
function machineIdEstable(ctx) {
  const c = contexto(ctx);
  try {
    const { data, identidad } = readLicense(c);
    if (data && data.machineId && identidad !== 'otra') return data.machineId;
  } catch { /* sin licencia legible: se usa el calculado */ }
  return c.machineIdV1;
}

function clearLicense() {
  for (const p of [mainPath(), mirrorPath()]) {
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* noop */ }
  }
  return true;
}

module.exports = {
  saveLicense, readLicense, computeStatus, clearLicense, machineIdEstable, usarEspacio, esDemo,
  // Expuestos para las pruebas: permiten ejercitar el formato sin Electron.
  _internos: { cifrarV3, descifrarV3, cifrarV2, descifrarV2, claveDeMaquina, FORMATO, mainPath, mirrorPath },
};
