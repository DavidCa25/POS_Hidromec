/**
 * UNA CAJA SECUNDARIA YA INSTALADA TIENE QUE ABRIR.
 *
 *     node scripts/pruebas/arranque-secundaria.mjs
 *
 * EL FALLO QUE ORIGINA ESTA PRUEBA
 * --------------------------------
 * En QA, una laptop secundaria con `install-config.json` y `db-config.json`
 * correctos escribia esto al abrir Wybix... y nada mas:
 *
 *     ==== App iniciada ==== v1.2.0
 *     [SETUP] Maquina secundaria: no se instala SQL, solo se conecta por red.
 *
 * Ni `[DB] Conectado`, ni `[DB] Intento`, ni error, ni ventana. Dos lineas y
 * silencio, en cada intento.
 *
 * Ese mensaje lo imprime `ensureServerReady()` justo antes de volver -para una
 * secundaria no hay motor que instalar-, y despues venia `bootMainApp()`, cuya
 * PRIMERA instruccion era `await poolPromise`. Todo lo que pasaba a partir de
 * ahi era invisible:
 *
 *   - el unico `[DB] Intento n/N` estaba dentro del `catch`, asi que un intento
 *     que ni conecta ni falla no imprimia absolutamente nada;
 *   - `resolvePoolConfig` no ponia `connectionTimeout` -`setupServer.js` si lo
 *     pone en todas sus conexiones-, de modo que con el driver nativo el
 *     `connect()` podia quedarse esperando sin final;
 *   - y el arranque estaba escrito en linea dentro de `app.whenReady()`, sin
 *     un solo aviso de transicion entre "leer la instalacion" y "hay ventana".
 *
 * QUE SE COMPRUEBA
 * ----------------
 * El camino completo de una secundaria YA configurada, con dependencias
 * sustituidas: que no abre el asistente, que conecta UNA vez, que arranca la
 * aplicacion, que crea la ventana, y que los pasos quedan anunciados en orden.
 * Y los caminos de fallo: que nada se queda mudo y que un cuelgue termina.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { arrancar, PASOS } = require('../../electron/arranque.js');

let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

/** La laptop del QA, tal cual. */
const INSTALL_SECUNDARIA = {
  role: 'secundaria',
  server: '192.168.100.211\\SQLEXPRESS',
  configuredAt: '2026-09-11T01:00:00.000Z',
};

/** Dobles con contadores: lo que se mide es la secuencia, no SQL Server. */
function montar(ajustes = {}) {
  const h = {
    registro: [], errores: [], asistente: 0, avisos: [],
    conexiones: 0, apps: 0, ventanas: 0, preparaciones: 0,
  };

  const deps = {
    cargarInstalacion: () => ajustes.install !== undefined ? ajustes.install : INSTALL_SECUNDARIA,
    hayConfiguracion: () => ajustes.hayConfiguracion !== undefined ? ajustes.hayConfiguracion : true,
    prepararServidor: async (install) => {
      h.preparaciones++;
      // La linea real que imprime setupServer para una secundaria.
      if ((install.role || '') === 'secundaria') {
        h.registro.push('[SETUP] Maquina secundaria: no se instala SQL, solo se conecta por red.');
      }
      if (ajustes.fallaPreparar) throw ajustes.fallaPreparar;
      return { ok: true, role: install.role, installed: false };
    },
    conectar: async () => {
      h.conexiones++;
      if (ajustes.fallaConectar) throw ajustes.fallaConectar;
      if (ajustes.conectarSeCuelga) await new Promise(() => { /* nunca */ });
      return { connected: true, id: 'pool-' + h.conexiones };
    },
    arrancarApp: async (pool) => {
      h.apps++;
      h.poolRecibido = pool;
      if (ajustes.fallaArrancar) throw ajustes.fallaArrancar;
      h.ventanas++;                       // createWindow() dentro de bootMainApp
      h.registro.push('[APP] ventana principal creada');
    },
    abrirAsistente: (motivo) => { h.asistente++; h.motivoAsistente = motivo; },
    avisarFallo: ({ paso, error }) => h.avisos.push({ paso, error: error?.message }),
    log: (m) => h.registro.push(m),
    logError: (m) => { h.errores.push(m); h.registro.push(m); },
  };

  return { h, deps };
}

const traza = (h) => h.registro.filter(l => l.startsWith('[ARRANQUE]')).join(' | ');

console.log('\nARRANQUE DE UNA CAJA SECUNDARIA YA INSTALADA');

// ===========================================================================
seccion('1. El caso del QA: secundaria configurada, arranque normal');

{
  const { h, deps } = montar();
  const r = await arrancar(deps);

  check(r.destino === 'aplicacion', 'termina en la aplicacion, no en el asistente', r.destino);
  check(h.asistente === 0, 'NO abre el asistente', 'ya esta instalada');
  check(h.preparaciones === 1, 'prepara el servidor una vez');
  check(h.conexiones === 1, 'intenta EXACTAMENTE una conexion', `${h.conexiones}`);
  check(h.apps === 1, 'arranca la aplicacion una vez');
  check(h.ventanas === 1, 'y se crea la ventana principal', `${h.ventanas}`);
  check(!!h.poolRecibido && h.poolRecibido.connected,
    'la aplicacion recibe el pool ya abierto', 'sin volver a pedirlo');
  check(h.errores.length === 0, 'sin errores');
  check(r.paso === 'listo', 'el ultimo paso es "listo"', r.paso);
}

// ===========================================================================
seccion('2. El mensaje de la secundaria NO es el final del camino');

{
  const { h, deps } = montar();
  await arrancar(deps);

  const iSetup = h.registro.findIndex(l => l.includes('no se instala SQL'));
  check(iSetup >= 0, 'aparece la linea de "maquina secundaria"');
  const despues = h.registro.slice(iSetup + 1);
  check(despues.length > 0, 'y DESPUES de esa linea sigue habiendo registro',
    `${despues.length} linea(s)`);
  check(despues.some(l => l.includes('conectar')), 'se anuncia la conexion');
  check(despues.some(l => l.includes('conexion establecida')), 'y que quedo establecida');
  check(despues.some(l => l.includes('ventana principal creada')), 'y que hay ventana',
    'esto era lo que faltaba: el registro se cortaba en la linea anterior');
}

// ===========================================================================
seccion('3. Los pasos se anuncian en orden');

{
  const { h, deps } = montar();
  await arrancar(deps);

  const anunciados = h.registro
    .filter(l => l.startsWith('[ARRANQUE] ') && PASOS.some(p => l.startsWith(`[ARRANQUE] ${p}`)))
    .map(l => PASOS.find(p => l.startsWith(`[ARRANQUE] ${p}`)));

  check(anunciados.join(',') === PASOS.join(','),
    'se anuncian los seis pasos, en orden', anunciados.join(' > '));

  const posicion = (p) => h.registro.findIndex(l => l.startsWith(`[ARRANQUE] ${p}`));
  check(posicion('conectar') < h.registro.findIndex(l => l.includes('ventana principal')),
    'conectar ocurre antes de la ventana');
  check(posicion('preparar-servidor') < posicion('conectar'),
    'y preparar el servidor antes de conectar');
}

// ===========================================================================
seccion('4. Primera instalacion: asistente, sin tocar la base');

{
  const { h, deps } = montar({ install: null });
  const r = await arrancar(deps);
  check(r.destino === 'asistente' && h.asistente === 1, 'sin install-config se abre el asistente');
  check(h.conexiones === 0, 'y NO se intenta ninguna conexion', 'no hay base todavia');
  check(h.preparaciones === 0, 'ni se prepara ningun servidor');
  check(h.ventanas === 0, 'ni se crea ventana principal');
}

// ===========================================================================
seccion('5. Instalacion a medias: asistente, sin 20 reintentos');

{
  const { h, deps } = montar({ hayConfiguracion: false });
  const r = await arrancar(deps);
  check(r.destino === 'asistente' && r.motivo === 'configuracion-invalida',
    'con db-config inutilizable se abre el asistente', r.motivo);
  check(h.conexiones === 0, 'sin intentar conectar',
    'serian 20 intentos de 3 segundos para acabar en el mismo sitio');
  check(h.registro.some(l => l.includes('no es utilizable')), 'y se dice por que');
}

// ===========================================================================
seccion('6. Ningun fallo se queda mudo');

{
  const fallo = new Error('No se pudo conectar a 192.168.100.211\\SQLEXPRESS tras 20 intentos: login failed');
  const { h, deps } = montar({ fallaConectar: fallo });
  const r = await arrancar(deps);

  check(r.destino === 'fallo' && r.paso === 'conectar', 'el fallo se atribuye al paso exacto', r.paso);
  check(h.errores.some(l => l.includes('conectar')), 'queda registrado con el nombre del paso');
  check(h.errores.some(l => l.includes('at ') || l.includes('Error:')), 'y con la traza completa');
  check(h.avisos.length === 1 && h.avisos[0].paso === 'conectar',
    'y se avisa por pantalla', 'un fallo antes de la ventana deja al usuario sin donde mirar');
  check(h.ventanas === 0, 'no se crea ventana');
}

{
  // Un fallo al preparar el servidor tampoco puede ser silencioso.
  const { h, deps } = montar({ fallaPreparar: new Error('motor no compatible') });
  const r = await arrancar(deps);
  check(r.destino === 'fallo' && r.paso === 'preparar-servidor', 'lo mismo al preparar el servidor', r.paso);
  check(h.conexiones === 0, 'y no se sigue adelante como si nada');
}

{
  // Y uno dentro de la aplicacion, despues de conectar.
  const { h, deps } = montar({ fallaArrancar: new Error('migracion rota') });
  const r = await arrancar(deps);
  check(r.destino === 'fallo' && r.paso === 'arrancar-aplicacion', 'y al arrancar la aplicacion', r.paso);
  check(h.avisos.length === 1, 'con su aviso');
}

// ===========================================================================
seccion('7. La traza dice donde se quedo, aunque no termine');

{
  // Se reproduce el sintoma: la conexion no vuelve nunca. Lo que se comprueba
  // es que el registro ya identifica el punto exacto, en vez de cortarse en la
  // linea de "maquina secundaria" y no decir nada mas.
  const { h, deps } = montar({ conectarSeCuelga: true });
  const enCurso = arrancar(deps);
  await new Promise(r => setTimeout(r, 50));

  check(h.registro.some(l => l.includes('[ARRANQUE] conectar')),
    'el registro llega hasta "conectar" y se para AHI',
    'antes se paraba una linea antes y el punto era indistinguible');
  check(!h.registro.some(l => l.includes('conexion establecida')), 'sin decir que conecto');
  check(h.ventanas === 0, 'y sin ventana');
  check(traza(h).endsWith('[ARRANQUE] conectar: 192.168.100.211\\SQLEXPRESS'),
    'y el ultimo paso anunciado nombra el servidor', traza(h).slice(-60));
  void enCurso;   // se queda colgada a proposito; el proceso termina igual
}

// ===========================================================================
seccion('8. Lo que el codigo ya no permite');

{
  const sinComentarios = (txt) => txt
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

  const base = sinComentarios(readFileSync(join('electron', 'db.js'), 'utf8'));
  check(/connectionTimeout:/.test(base),
    'db.js fija connectionTimeout',
    'setupServer lo ponia en todas sus conexiones; la de la aplicacion no tenia ninguno');
  check(/conTope\(\s*p\.connect\(\)/.test(base),
    'y acota connect() tambien desde JavaScript',
    'el driver nativo puede quedarse dentro de su propio codigo sin avisar');
  const intentos = base.split('\n').filter(l => l.includes('] Intento '));
  check(intentos.length >= 2,
    'el registro anuncia el intento ANTES de intentarlo, no solo al fallar',
    `${intentos.length} lineas de "Intento"`);

  const principal = sinComentarios(readFileSync(join('electron', 'main.js'), 'utf8'));
  check(/arranque\.arrancar\(/.test(principal), 'main.js delega el arranque en la secuencia con nombre');
  check(!/await setupServer\.ensureServerReady\([\s\S]{0,200}await bootMainApp\(\)/.test(principal),
    'y ya no lo lleva escrito en linea dentro de whenReady');
}

console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S) de ${pasos}` : `\nRESULTADO: OK (${pasos} comprobaciones)`);
process.exit(fallos ? 1 : 0);
