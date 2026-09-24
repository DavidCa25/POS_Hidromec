/**
 * QUE VIAJA EN CADA INSTALADOR.
 *
 *     node scripts/pruebas/demo-build.mjs           (lee la configuracion)
 *     node scripts/pruebas/demo-build.mjs --paquete (abre el .exe ya construido)
 *
 * El encargo lo dijo claro: "verifica el contenido del build, no solo que el
 * boton este escondido". Un `if` que oculta una pantalla sigue llevando el
 * codigo destructivo dentro del ejecutable que se le entrega a un cliente.
 *
 * Sin argumentos comprueba la CONFIGURACION, que es lo que decide el
 * contenido y se puede revisar en un segundo. Con `--paquete` abre los
 * artefactos de `release/` y `release-internal/` y mira lo que hay de verdad
 * dentro; se salta lo que no este construido todavia.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const PAQUETE = process.argv.includes('--paquete');

let ok = 0;
const fallos = [];
const check = (cond, titulo, detalle) => {
  if (cond) { ok++; console.log(`   ok     ${titulo}`); }
  else { fallos.push(titulo); console.log(`   FALLA  ${titulo}${detalle ? `\n            ${detalle}` : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const publico = pkg.build;
/* La configuracion interna es un .js: deriva del campo `build` del publico en
   vez de copiarlo, y ademas puede llevar comentarios. Un .json no podia hacer
   ninguna de las dos cosas -`extends: "package.json"` carga el archivo entero
   y una clave "//" rompe la validacion del esquema-. */
const require = createRequire(import.meta.url);
const demo = require(`${process.cwd()}/electron-builder.demo.js`);

// ===================================================================
seccion('1. El build publico NO empaqueta el gestor');

const files = publico.files || [];
check(files.some(f => /^!electron\/demo(\/|$)/.test(f)),
  'la carpeta electron/demo esta excluida de los archivos',
  `files: ${JSON.stringify(files)}`);

const recursosPublicos = (publico.extraResources || [])
  .map(r => (typeof r === 'string' ? r : r.from));
check(!recursosPublicos.some(r => /demo-profiles/.test(String(r))),
  'demo-profiles NO viaja como recurso',
  `extraResources: ${recursosPublicos.join(', ')}`);

check(!JSON.stringify(publico).includes('demo-profiles'),
  'y no aparece por ningun otro lado de la configuracion publica');

// ===================================================================
seccion('2. El build interno SI los empaqueta');

const recursosDemo = (demo.extraResources || []).map(r => (typeof r === 'string' ? r : r.from));
check(recursosDemo.includes('demo-profiles'), 'demo-profiles viaja como recurso');
check(!(demo.files || []).some(f => /^!electron\/demo(\/|$)/.test(f)),
  'y electron/demo NO esta excluida');

/* Hereda del publico en vez de duplicarlo: si manana el publico anade un
   recurso, el demo lo recibe sin que nadie se acuerde de copiarlo. */
/* Hereda de verdad: todo lo que el interno no cambia a proposito tiene que
   ser identico al publico. Asi un recurso nuevo en el publico llega aqui sin
   que nadie se acuerde de copiarlo. */
const CAMBIA_A_PROPOSITO = new Set([
  'appId', 'productName', 'directories', 'files', 'extraResources', 'nsis',
]);
const divergen = Object.keys(publico)
  .filter(k => !CAMBIA_A_PROPOSITO.has(k))
  .filter(k => JSON.stringify(publico[k]) !== JSON.stringify(demo[k]));
check(divergen.length === 0,
  'el build interno hereda todo lo que no cambia a proposito',
  divergen.length ? `difieren sin motivo: ${divergen.join(', ')}` : '');

/* Y de lo que si cambia, lo que no es identidad ni destino se deriva: el
   interno lleva el mismo icono y el mismo instalador que el publico. */
check(demo.directories.buildResources === publico.directories.buildResources,
  'con los mismos recursos de construccion');
check(demo.nsis.installerIcon === publico.nsis?.installerIcon,
  'y el mismo icono de instalador');

/* Una clave "//" puesta como comentario hace fallar el empaquetado con
   "configuration has an unknown property". Se cuela sin que nada proteste
   hasta que alguien construye, que es tarde. */
const comentarios = [];
(function buscar(nodo, ruta) {
  if (Array.isArray(nodo)) return nodo.forEach((x, i) => buscar(x, `${ruta}[${i}]`));
  if (!nodo || typeof nodo !== 'object') return;
  for (const clave of Object.keys(nodo)) {
    if (clave === '//') comentarios.push(ruta || '(raiz)');
    else buscar(nodo[clave], ruta ? `${ruta}.${clave}` : clave);
  }
})(demo, '');
check(comentarios.length === 0,
  'la configuracion interna no lleva claves de comentario',
  comentarios.length ? `electron-builder las rechaza: ${comentarios.join(', ')}` : '');

const soloEnPublico = recursosPublicos.filter(r => !recursosDemo.includes(r));
check(soloEnPublico.length === 0,
  'el interno lleva todo lo que lleva el publico',
  soloEnPublico.length ? `le faltan: ${soloEnPublico.join(', ')}` : '');

const soloEnDemo = recursosDemo.filter(r => !recursosPublicos.includes(r));
check(soloEnDemo.length === 1 && soloEnDemo[0] === 'demo-profiles',
  'y lo unico de mas es demo-profiles',
  `de mas: ${soloEnDemo.join(', ') || '(nada)'}`);

// ===================================================================
seccion('3. Son dos aplicaciones distintas para Windows');

/* POR QUE EL appId ES DISTINTO
   Con el mismo appId Windows trata las dos aplicaciones como una sola, y el
   instalador de cualquiera de ellas desinstala la otra. Distintos, conviven en
   la misma maquina sin conocerse, que es justo lo que hace falta para poder
   ensenar una demo en el equipo de alguien que ya usa Wybix.

   Y POR QUE HEREDA EN VEZ DE COPIAR
   `extends: "package.json"` hace que el build interno reciba solo, sin que
   nadie se acuerde de copiarlo, cualquier recurso, icono o version de SQL que
   se le anada al publico. Un JSON duplicado se queda atras en la primera
   version que alguien tenga prisa. Esto no se puede anotar dentro del propio
   JSON: electron-builder valida contra un esquema cerrado y una clave "//"
   hace fallar el empaquetado entero. */

check(publico.appId !== demo.appId,
  'appId distinto',
  `publico ${publico.appId} · demo ${demo.appId}`);
check(publico.productName !== demo.productName,
  'y nombre de producto distinto',
  `${publico.productName} · ${demo.productName}`);
check(publico.directories.output !== demo.directories.output,
  'cada uno a su carpeta',
  `${publico.directories.output} · ${demo.directories.output}`);
check(demo.directories.output === 'release-internal', 'el interno a release-internal');
check(publico.nsis?.artifactName === 'Wybix-Setup.exe', 'el publico se llama Wybix-Setup.exe');
check(demo.nsis?.artifactName === 'Wybix-Demo-Setup.exe', 'el interno Wybix-Demo-Setup.exe');

// ===================================================================
seccion('4. El producto no llama al gestor si no esta');

const main = readFileSync(join('electron', 'main.js'), 'utf8');
check(/try\s*\{[\s\S]{0,160}require\('\.\/demo'\)/.test(main),
  'main.js pide el modulo dentro de un try',
  'sin el, el build publico no arrancaria por un require que no existe');

/* En desarrollo la carpeta SIEMPRE esta en el arbol, asi que encender el
   gestor por su mera presencia moveria los datos de quien esta desarrollando
   sin avisarle. Empaquetado no hace falta la condicion, porque alli la
   carpeta solo existe si el build es el interno. */
check(/app\.isPackaged \|\| process\.env\.WYBIX_DEMO === '1'/.test(main),
  'y en desarrollo solo se enciende con WYBIX_DEMO=1');
check(/MODULE_NOT_FOUND/.test(main),
  'y trata su ausencia como lo normal, no como un error');
check(/if \(demo\)/.test(main), 'y todo lo del gestor cuelga de que exista');

/* Ninguna pieza destructiva puede vivir fuera de la carpeta excluida: si un
   handler `demo:` se escribiera en main.js, viajaria en el build publico. */
const destructivoFuera = /ipcMain\.handle\(\s*['"]demo:(crear|restablecer|eliminar)/.test(main);
check(!destructivoFuera,
  'ningun handler destructivo vive en main.js',
  'tienen que estar en electron/demo/, que es lo que no se empaqueta');

/* El nombre de la instancia de SQL lleva la barra DUPLICADA en el fuente. Con
   una sola, JavaScript se la come y queda "localhostSQLEXPRESS", que no es
   ninguna instancia: el gestor no podria crear ni una demo. */
check(main.includes("'localhost\\\\SQLEXPRESS'"),
  'el gestor apunta a la instancia con la barra bien escapada',
  'una sola barra deja el nombre en localhostSQLEXPRESS');

for (const archivo of ['guardas.js', 'gestor.js', 'ipc.js', 'index.js', 'ventana.js', 'registro.js']) {
  check(existsSync(join('electron', 'demo', archivo)), `electron/demo/${archivo} existe`);
}

/* EL PUENTE Y LOS HANDLERS, UNO POR UNO.
   El preload expuso `demo:abrir` antes de que existiera su handler: la ventana
   podia llamarlo y la llamada moria en "No handler registered". Nada lo
   detectaba porque cada archivo, por separado, estaba bien. */
const puente = readFileSync(join('electron', 'demo', 'preload.js'), 'utf8');
const ipcDemo = readFileSync(join('electron', 'demo', 'ipc.js'), 'utf8');

const expuestos = [...puente.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map(m => m[1]);
const atendidos = [...ipcDemo.matchAll(/ipcMain\.handle\('([^']+)'/g)].map(m => m[1]);

const huerfanos = expuestos.filter(c => !atendidos.includes(c));
check(huerfanos.length === 0,
  'cada canal del puente tiene su handler detras',
  huerfanos.length ? `sin handler: ${huerfanos.join(', ')}` : '');

const inalcanzables = atendidos.filter(c => !expuestos.includes(c));
check(inalcanzables.length === 0,
  'y cada handler es alcanzable desde la ventana',
  inalcanzables.length ? `sin puente: ${inalcanzables.join(', ')}` : '');

/* Y que la ventana ofrezca de verdad lo que el puente sabe pedir: un canal
   con handler y sin boton es una funcion que nadie encuentra. */
const ui = readFileSync(join('electron', 'demo', 'ui', 'demo.html'), 'utf8');
const acciones = new Set([...ui.matchAll(/data-a="([a-z]+)"/g)].map(m => m[1]));
for (const canal of expuestos) {
  const accion = canal.replace(/^demo:/, '');
  if (accion === 'estado') continue;  // lo pide la ventana al pintar, no un boton
  check(acciones.has(accion), `la ventana ofrece un boton para ${canal}`,
    [...acciones].join(', '));
}

// ===================================================================
seccion('5. Los perfiles estan bien formados');

const base = 'demo-profiles';
check(existsSync(base), 'existe demo-profiles/');
const carpetas = existsSync(base)
  ? readdirSync(base).filter(d => statSync(join(base, d)).isDirectory()) : [];
check(carpetas.length >= 2, `hay ${carpetas.length} perfiles`, carpetas.join(', '));

for (const c of carpetas) {
  const ficha = join(base, c, 'profile.json');
  check(existsSync(ficha), `${c}/profile.json existe`);
  if (!existsSync(ficha)) continue;
  const p = JSON.parse(readFileSync(ficha, 'utf8'));
  check(p.id === c, `${c}: el id coincide con la carpeta`, `id = ${p.id}`);
  check(!!p.nombre && !!p.descripcion, `${c}: tiene nombre y descripcion`);
  /* Un perfil normal tiene UNA semilla. Uno que pide elegir giro tiene una
     por giro dentro de su carpeta `seeds/`, mas la parte comun. Las dos formas
     valen; lo que no vale es no tener ninguna. */
  let semilla;
  if (p.presets) {
    const dir = join(base, c, p.seeds || 'seeds');
    const porGiro = existsSync(dir)
      ? readdirSync(dir).filter(x => x.endsWith('.sql')) : [];
    check(porGiro.length >= 2, `${c}: tiene una semilla por giro`, porGiro.join(', ') || dir);
    /* El marcador de demo lo escribe la parte COMUN, que es la que se ejecuta
       primero en todos los giros. Es la que se mira debajo. */
    semilla = join(base, c, 'comun.sql');
    check(existsSync(semilla), `${c}: y lo que comparten todos los giros va una sola vez`);
  } else {
    semilla = join(base, c, p.seed || 'seed.sql');
    check(existsSync(semilla), `${c}: su semilla existe`, semilla);
  }

  /* Sin marcador, la demo que cree esa semilla no se podria restablecer ni
     eliminar: quedaria una base huerfana que el gestor se niega a tocar. */
  if (existsSync(semilla)) {
    const sql = readFileSync(semilla, 'utf8');
    check(/is_demo/.test(sql) && /database_metadata/.test(sql),
      `${c}: la semilla escribe el marcador is_demo`);
    check(new RegExp(`'${c}'`).test(sql),
      `${c}: y deja constancia de su perfil`);

    /* Y el identificador de instancia, que es lo que distingue "una demo" de
       "la demo que creo este gestor". Sin el, la base nace huerfana. */
    check(/demo_instance_id/.test(sql) && /NEWID\(\)/i.test(sql),
      `${c}: la semilla genera un demo_instance_id`);
    check(/IF NOT EXISTS[\s\S]{0,200}demo_instance_id/i.test(sql),
      `${c}: y no lo regenera si ya estaba`,
      'regenerarlo dejaria la base sin coincidir con el registro local del gestor');
  }
}

// ===================================================================
if (PAQUETE) {
  seccion('6. Lo que hay DENTRO de los ejecutables');

  /** Lista el contenido de un asar sin descomprimirlo. */
  const dentro = (dir) => {
    const asar = join(dir, 'resources', 'app.asar');
    if (!existsSync(asar)) return null;
    try {
      return execFileSync('npx', ['asar', 'list', asar], { encoding: 'utf8', shell: true });
    } catch { return null; }
  };

  const casos = [
    ['publico', join('release', 'win-unpacked'), false],
    ['interno', join('release-internal', 'win-unpacked'), true],
  ];
  for (const [etiqueta, dir, debeTenerlo] of casos) {
    if (!existsSync(dir)) {
      console.log(`   —      ${etiqueta}: no construido todavia (${dir})`);
      continue;
    }
    const lista = dentro(dir);
    if (lista == null) { console.log(`   —      ${etiqueta}: no se pudo leer el asar`); continue; }
    const tieneGestor = /electron[\\/]demo[\\/]/.test(lista);
    check(tieneGestor === debeTenerlo,
      `${etiqueta}: ${debeTenerlo ? 'lleva' : 'NO lleva'} electron/demo dentro del asar`,
      `encontrado: ${tieneGestor}`);

    const perfiles = existsSync(join(dir, 'resources', 'demo-profiles'));
    check(perfiles === debeTenerlo,
      `${etiqueta}: ${debeTenerlo ? 'lleva' : 'NO lleva'} demo-profiles en resources`,
      `encontrado: ${perfiles}`);
  }
} else {
  console.log('\n(para mirar dentro de los .exe ya construidos: --paquete)');
}

console.log(`\nRESULTADO: ${fallos.length ? `${fallos.length} FALLO(S) de ${ok + fallos.length}` : `OK (${ok} comprobaciones)`}`);
process.exit(fallos.length ? 1 : 0);
