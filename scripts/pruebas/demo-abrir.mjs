/**
 * ABRIR UNA DEMO, Y UNA SOLA TARJETA POR PERFIL.
 *
 *     node scripts/pruebas/demo-abrir.mjs
 *
 * LOS DOS DEFECTOS QUE CIERRA
 * ---------------------------
 *   1. El puente de la ventana exponia `demo:abrir` y NO habia handler
 *      detras. Una demo creada solo ofrecia Restablecer y Eliminar: no habia
 *      forma de entrar a ella desde el gestor.
 *   2. El catalogo de perfiles no tenia el identificador por clave, asi que
 *      dos carpetas que declararan el mismo `id` producian dos tarjetas
 *      iguales en la ventana, sin decir en ningun sitio de donde salia la
 *      segunda.
 *
 * COMO SE EJERCITA
 * ----------------
 * Con el IPC de verdad. Se sustituyen `electron`, el servidor SQL y el
 * arranque de la aplicacion por dobles, y se llaman los handlers tal cual los
 * llama la ventana. Lo que se comprueba es el codigo que se empaqueta, no una
 * copia de su logica escrita aqui.
 *
 * La funcion que pinta las tarjetas se extrae de `ui/demo.html` y se ejecuta:
 * no usa DOM, solo compone texto. Asi la prueba mira los botones que de verdad
 * salen en pantalla y no una lista paralela que alguien tendria que mantener.
 */
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

const require_ = createRequire(import.meta.url);
const REPO = process.cwd();

// ------------------------------------------------------- doble de electron
const RAIZ = mkdtempSync(join(tmpdir(), 'wybix-demo-abrir-'));
const DATOS = join(RAIZ, 'wybix-pos-demo');
mkdirSync(DATOS, { recursive: true });

const Module = require_('module');
const cargarOriginal = Module._load;
Module._load = function (peticion) {
  if (peticion === 'electron') {
    return { app: { getPath: () => DATOS, getName: () => 'wybix-pos', setPath: () => {} } };
  }
  return cargarOriginal.apply(this, arguments);
};

/* Los perfiles se leen de una copia, para poder meter una carpeta repetida sin
   tocar el repositorio. `dirPerfiles` mira `process.resourcesPath` primero. */
const RECURSOS = join(RAIZ, 'resources');
mkdirSync(RECURSOS, { recursive: true });
cpSync(join(REPO, 'demo-profiles'), join(RECURSOS, 'demo-profiles'), { recursive: true });
process.resourcesPath = RECURSOS;

const { leerPerfiles } = require_('../../electron/demo/gestor.js');
const { registrar } = require_('../../electron/demo/ipc.js');
const registro = require_('../../electron/demo/registro.js');

// ------------------------------------------------------------ doble de SQL
/** Que bases existen, y que dice cada una de si misma. */
const BASES = new Map();
const INSTANCIA = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

const espias = { crear: 0, migraciones: 0, drop: 0, abrir: [], soltadas: [], sembrados: [] };

function poolFalso(base) {
  const request = () => {
    const ctx = {};
    const api = {
      input: (n, _t, v) => { ctx[n] = v; return api; },
      query: async (texto) => {
        if (/DB_ID/.test(texto)) return { recordset: [{ id: BASES.has(ctx.n) ? 7 : null }] };
        /* Desde master la consulta lleva [la_base] delante; conectado ya a la
           propia base, no la lleva. En ese caso responde la base del pool. */
        const cual = (texto.match(/\[([^\]]+)\]/) || [])[1] || base;
        if (/database_metadata/.test(texto)) {
          const m = BASES.get(cual) || {};
          return { recordset: Object.entries(m).map(([clave, valor]) => ({ clave, valor })) };
        }
        if (/sales/.test(texto)) return { recordset: [{ n: 0 }] };
        return { recordset: [] };
      },
      batch: async (texto) => {
        if (/DROP DATABASE/.test(texto)) {
          espias.drop++;
          BASES.delete((texto.match(/DROP DATABASE \[([^\]]+)\]/) || [])[1]);
        }
        return { recordset: [] };
      },
    };
    return api;
  };
  return { request, close: async () => {} };
}

/** El IPC de verdad, con dobles donde toca. */
const handlers = new Map();
const ipcMain = { handle: (canal, fn) => handlers.set(canal, fn) };
const llamar = (canal, datos) => handlers.get(canal)(null, datos);

registrar({
  ipcMain,
  app: { getPath: () => DATOS },
  sql: { NVarChar: () => 'nvarchar' },
  setup: {
    connectMaster: async () => poolFalso(null),
    connectDb: async (_s, nombre) => poolFalso(nombre),
    /* Crear una base pasa por aqui. Si "abrir" lo tocara, este contador
       subiria: es la prueba de que abrir no rehace nada. */
    ensureServerReady: async () => { espias.crear++; BASES.set(pendiente, marcador(pendientePerfil)); },
  },
  runMigrations: async () => { espias.migraciones++; return { applied: [] }; },
  migrationsDir: join(REPO, 'electron', 'migrations'),
  servidor: 'localhost\\SQLEXPRESS',
  /* Doble de lo que hace `main.js` al abrir: escribe la configuracion local en
     la carpeta de la demo. Asi las pruebas de configuracion miran archivos de
     verdad, y el que los borra -`olvidarConfiguracion`- es el del producto. */
  abrirApp: async (datos) => {
    espias.abrir.push(datos);
    writeFileSync(join(DATOS, 'db-config.json'),
      JSON.stringify({ server: datos.servidor, database: datos.base, auth: 'windows' }), 'utf8');
    writeFileSync(join(DATOS, 'install-config.json'),
      JSON.stringify({ role: 'principal', server: datos.servidor, demo: datos.perfilId }), 'utf8');
    return { yaAbierta: false };
  },
  soltarApp: (base) => { espias.soltadas.push(base); return { cerrada: true }; },
  log: () => {},
});

const marcador = (perfil) => ({
  is_demo: 'true', demo_profile: perfil,
  demo_created_at: '2026-09-15T08:00:00', demo_instance_id: INSTANCIA,
});
let pendiente = null, pendientePerfil = null;

/** Deja una demo ya creada, sin pasar por `crear`. */
function yaCreada(perfil, base) {
  BASES.set(base, marcador(perfil));
  registro.anotar({ getPath: () => DATOS }, perfil, { instancia: INSTANCIA, base });
}

// -------------------------------------------- la funcion que pinta tarjetas
const html = readFileSync(join(REPO, 'electron', 'demo', 'ui', 'demo.html'), 'utf8');
const fuente = html.slice(html.indexOf('function tarjeta(p)'), html.indexOf('async function pintar()'));
const tarjeta = new Function(`${fuente}; return tarjeta;`)();
const botonesDe = (h) => [...h.matchAll(/data-a="([a-z]+)"/g)].map(m => m[1]);

// ===================================================================
seccion('1 y 2. Un perfil, una entrada');

const perfiles = leerPerfiles({});
const cuenta = (id) => perfiles.filter(p => p.id === id).length;
check(cuenta('retail') === 1, 'Retail aparece una sola vez', `${cuenta('retail')} entradas`);
check(cuenta('hospitality') === 1, 'Hospitality aparece una sola vez', `${cuenta('hospitality')} entradas`);
check(cuenta('servicios') === 1, 'Servicios aparece una sola vez, no una por giro',
  `${cuenta('servicios')} entradas`);
/* Los giros de Servicios NO son perfiles: son una eleccion DENTRO de su
   tarjeta. Cinco tarjetas casi iguales -Servicios Taller, Servicios
   Belleza...- habrian llenado la ventana de opciones que hay que leer
   enteras para distinguirlas. */
check(perfiles.length === 3, 'y no hay ningun perfil de mas', perfiles.map(p => p.id).join(', '));
const srv = perfiles.find(p => p.id === 'servicios');
check(Array.isArray(srv && srv.giros) && srv.giros.length >= 5,
  'el perfil de Servicios ofrece los giros del producto',
  srv && srv.giros ? srv.giros.map(g => g.id).join(', ') : 'ninguno');
check(!perfiles.some(p => p.id !== 'servicios' && p.giros),
  'y ningun otro perfil pide giro');

/* Y con una carpeta repetida de verdad: es como llega el defecto a una
   maquina -alguien copia `hospitality` para probar algo y no lo borra-. */
const copia = join(RECURSOS, 'demo-profiles', 'hospitality copia');
cpSync(join(RECURSOS, 'demo-profiles', 'hospitality'), copia, { recursive: true });
const conCopia = leerPerfiles({});
check(conCopia.filter(p => p.id === 'hospitality').length === 1,
  'una carpeta copiada NO anade una segunda tarjeta de Hospitality',
  `${conCopia.length} perfiles: ${conCopia.map(p => p.id).join(', ')}`);

/* Y si la copia se renombra por dentro para que su id coincida con su carpeta,
   pasa a ser un perfil distinto y legitimo: no se descarta por parecerse. */
const ficha = JSON.parse(readFileSync(join(copia, 'profile.json'), 'utf8'));
writeFileSync(join(copia, 'profile.json'), JSON.stringify({ ...ficha, id: 'hospitality copia' }), 'utf8');
check(leerPerfiles({}).filter(p => p.id === 'hospitality').length === 1,
  'y un id que no coincide con su carpeta tampoco cuela');
rmSync(copia, { recursive: true, force: true });

/* Lo mismo a traves del IPC, que es por donde lo pide la ventana. */
const estado0 = await llamar('demo:estado', {});
const ids = estado0.data.perfiles.map(p => p.id);
check(new Set(ids).size === ids.length, 'y el estado que recibe la ventana no repite ninguno',
  ids.join(', '));

// ===================================================================
seccion('3 y 4. Una demo creada ofrece Abrir');

const sinCrear = tarjeta({ id: 'retail', nombre: 'Retail Demo', base: 'Wybix_Demo_Retail', existe: false });
check(!botonesDe(sinCrear).includes('abrir'), 'sin crear, no hay Abrir: no habria que abrir');
check(botonesDe(sinCrear).includes('crear'), 'solo Crear demostración');

for (const [id, nombre] of [['retail', 'Retail Demo'], ['hospitality', 'Hospitality Demo']]) {
  const h = tarjeta({
    id, nombre, base: `Wybix_Demo_${id[0].toUpperCase()}${id.slice(1)}`,
    existe: true, esDemo: true, registrada: true, creada: '2026-09-15',
  });
  const b = botonesDe(h);
  check(b.includes('abrir'), `crear ${id} deja un boton Abrir demo`, b.join(' · '));
  check(b[0] === 'abrir', 'y va primero, que es lo que se hace todos los dias');
  check(b.includes('restablecer') && b.includes('eliminar'),
    'sin quitar Restablecer ni Eliminar', b.join(' · '));
}

// ===================================================================
seccion('5 y 8. Abrir usa la base del perfil y NO la rehace');

yaCreada('hospitality', 'Wybix_Demo_Hospitality');
const antes = { crear: espias.crear, migraciones: espias.migraciones, drop: espias.drop };

const abierta = await llamar('demo:abrir', { perfilId: 'hospitality' });
check(abierta.success === true, 'abrir responde que si', abierta.error || '');
check(espias.abrir.length === 1, 'y arranca la aplicacion una vez');
check(espias.abrir[0].base === 'Wybix_Demo_Hospitality',
  'contra la base del perfil pedido', espias.abrir[0].base);
check(espias.crear === antes.crear, 'sin preparar ninguna base');
check(espias.migraciones === antes.migraciones, 'sin aplicar migraciones');
check(espias.drop === antes.drop, 'y sin borrar nada');
check(BASES.has('Wybix_Demo_Hospitality'), 'la base sigue existiendo igual que antes');

const abiertaRetail = await llamar('demo:abrir', { perfilId: 'retail' });
check(abiertaRetail.success === false, 'una demo que no existe no se abre: se dice que la crees',
  abiertaRetail.error);
check(/no existe/i.test(abiertaRetail.error || ''), 'y el motivo lo dice', abiertaRetail.error);
check(espias.crear === antes.crear, 'y tampoco la crea por su cuenta');

// ===================================================================
seccion('6. Abrir no puede apuntar a una base del producto');

/* La ventana manda un perfil, no un nombre, asi que `Wybix_POS` no cabe por el
   canal. Aun asi la guarda se comprueba aparte: es la que se quedaria sola si
   manana alguien anadiera un parametro. */
const G = require_('../../electron/demo/guardas.js');
const P = [{ id: 'retail' }, { id: 'hospitality' }];
for (const nombre of ['Wybix_POS', 'Wybix_Production', 'Wybix_Template', 'ContabilidadDelCliente']) {
  const r = G.sePuedeAbrir({
    perfilId: 'retail', nombre, perfilesInstalados: P, metadatos: marcador('retail'),
  });
  check(r.ok === false, `no se abre ${nombre} ni con el marcador puesto a mano`,
    r.ok ? 'DEVOLVIO QUE SI' : '');
}
check(G.sePuedeAbrir({
  perfilId: 'retail', nombre: 'Wybix_Demo_Retail', perfilesInstalados: P, metadatos: {},
}).ok === false, 'ni una base con nombre de demo que no lleve el marcador');

/* Y el canal: pedir un perfil inventado no compone ningun nombre. */
const inventado = await llamar('demo:abrir', { perfilId: 'wybix_pos' });
check(inventado.success === false, 'un perfil inventado se rechaza en el canal', inventado.error);

// ===================================================================
seccion('7. Abrir trabaja en el espacio aislado de la demo');

check(estado0.data.datos === DATOS, 'el gestor informa la carpeta de datos de la demo', estado0.data.datos);

/* Lo que hace `main.js` al abrir, comprobado sobre su fuente: escribe la
   configuracion con el mecanismo del producto y arranca. Las dos escrituras
   caen en `userData`, que ya esta movido, y por eso no hay nada aqui que
   nombre una ruta absoluta. */
const main = readFileSync(join(REPO, 'electron', 'main.js'), 'utf8');
const fn = main.slice(main.indexOf('async function abrirDemoEnWybix'), main.indexOf('function arrancarGestorDemo'));
check(fn.length > 0, 'main.js tiene la funcion que abre la demo');
check(/db\.setConnectionConfig\(/.test(fn), 'apunta la configuracion de base con el mecanismo del producto');
check(/saveInstallConfig\(/.test(fn), 'registra la instalacion para no volver a pedir el alta');
check(/bootMainApp\(/.test(fn), 'y arranca por el mismo camino que el asistente');
check(!/appData|getPath\('appData'\)/.test(fn), 'sin tocar ninguna ruta compartida');
check(/mainWindow && !mainWindow\.isDestroyed\(\)/.test(fn),
  'y si Wybix ya esta abierto, lo trae al frente en vez de abrir otra ventana');

// ===================================================================
seccion('9. Volver al gestor: la demo sigue lista');

const estado1 = await llamar('demo:estado', {});
const hosp = estado1.data.perfiles.find(p => p.id === 'hospitality');
check(hosp.existe === true, 'despues de abrir, Hospitality sigue existiendo');
check(hosp.esDemo === true, 'sigue marcada como demo');
check(hosp.registrada === true, 'y sigue siendo la que creo este gestor');
check(botonesDe(tarjeta(hosp))[0] === 'abrir', 'asi que la tarjeta sigue ofreciendo Abrir demo');

// ===================================================================
seccion('10. Restablecer y Eliminar siguen igual');

pendiente = 'Wybix_Demo_Hospitality'; pendientePerfil = 'hospitality';
const reset = await llamar('demo:restablecer', { perfilId: 'hospitality' });
check(reset.success === true, 'restablecer sigue funcionando', reset.error || '');
check(espias.drop === antes.drop + 1, 'tiro la base una vez');
check(espias.crear === antes.crear + 1, 'y la volvio a crear');

const borrada = await llamar('demo:eliminar', { perfilId: 'hospitality' });
check(borrada.success === true, 'eliminar sigue funcionando', borrada.error || '');
check(!BASES.has('Wybix_Demo_Hospitality'), 'y la base ya no esta');

/* Y despues de eliminar, la tarjeta vuelve a ofrecer Crear y no Abrir. */
const estado2 = await llamar('demo:estado', {});
const hosp2 = estado2.data.perfiles.find(p => p.id === 'hospitality');
check(hosp2.existe === false, 'el gestor la ve como no creada');
check(botonesDe(tarjeta(hosp2)).includes('crear'), 'y vuelve a ofrecer Crear demostración');
check(!botonesDe(tarjeta(hosp2)).includes('abrir'), 'sin Abrir, que no habria que abrir');

// ===================================================================
seccion('11 a 13. Retail es Retail y Hospitality es Hospitality');

/* EL FALLO QUE CIERRA ESTA SECCION
   Crear Hospitality, abrirla, eliminarla y crear Retail acababa ensenando
   Hospitality. La base era la correcta desde el primer dia: lo que se
   reutilizaba era lo de ALREDEDOR -la ventana ya abierta, el cache de negocio
   del proceso y la configuracion local de la demo anterior-. */

const DECLARADO = {
  retail: { base: 'Wybix_Demo_Retail', perfil: 'RETAIL' },
  hospitality: { base: 'Wybix_Demo_Hospitality', perfil: 'HOSPITALITY' },
};

/** Lo que dice la semilla del perfil, leida de disco. */
function semillaDe(id) {
  const p = leerPerfiles({}).find(x => x.id === id);
  return readFileSync(join(p.dir, p.seed || 'seed.sql'), 'utf8');
}

for (const [id, esperado] of Object.entries(DECLARADO)) {
  const p = leerPerfiles({}).find(x => x.id === id);
  check(p.base === esperado.base, `${id} compone ${esperado.base}`, p.base);

  const sql = semillaDe(id);
  check(new RegExp(`@business_profile\\s*=\\s*N'${esperado.perfil}'`).test(sql),
    `su semilla da de alta el negocio como ${esperado.perfil}`);
  check(new RegExp(`'demo_profile',\\s*'${id}'`).test(sql),
    `y deja demo_profile = ${id} en la base`);

  /* Y ninguna semilla nombra al otro perfil: una copia mal hecha entre las dos
     es exactamente como Retail acabaria sembrando Hospitality. */
  const otro = id === 'retail' ? 'HOSPITALITY' : 'RETAIL';
  check(!sql.includes(otro), `y no menciona ${otro} en ningun sitio`);
}

/** Crea de verdad, por el IPC, y devuelve lo que quedo sembrado. */
async function crear(id) {
  pendiente = DECLARADO[id].base; pendientePerfil = id;
  const r = await llamar('demo:crear', { perfilId: id });
  return r;
}

/* --- A) Retail desde cero --- */
BASES.clear();
const a = await crear('retail');
check(a.success && a.data.base === 'Wybix_Demo_Retail', 'A) crear Retail deja Wybix_Demo_Retail', a.error || a.data?.base);
check([...BASES.keys()].join() === 'Wybix_Demo_Retail', 'y no existe ninguna otra base', [...BASES.keys()].join(', ') || '(ninguna)');
check(BASES.get('Wybix_Demo_Retail').demo_profile === 'retail', 'marcada como perfil retail');

/* --- B) Eliminar Retail, crear Hospitality --- */
await llamar('demo:abrir', { perfilId: 'retail' });
check(JSON.parse(readFileSync(join(DATOS, 'db-config.json'), 'utf8')).database === 'Wybix_Demo_Retail',
  'la configuracion local apunta a la base de Retail');

await llamar('demo:eliminar', { perfilId: 'retail' });
check(espias.soltadas.includes('Wybix_Demo_Retail'), 'eliminar suelta la ventana de esa demo');
check(!existsSync(join(DATOS, 'db-config.json')),
  'B) y borra la configuracion local que apuntaba a ella',
  'sin esto, la siguiente demo arranca sobre la configuracion de la anterior');

const b = await crear('hospitality');
check(b.success && b.data.base === 'Wybix_Demo_Hospitality', 'crear Hospitality deja Wybix_Demo_Hospitality', b.error || '');
check(!BASES.has('Wybix_Demo_Retail'), 'y Retail ya no existe');
check(BASES.get('Wybix_Demo_Hospitality').demo_profile === 'hospitality', 'marcada como perfil hospitality');

/* --- C) y D) El caso que fallo a mano: Hospitality -> eliminar -> Retail --- */
await llamar('demo:abrir', { perfilId: 'hospitality' });
check(JSON.parse(readFileSync(join(DATOS, 'db-config.json'), 'utf8')).database === 'Wybix_Demo_Hospitality',
  'la configuracion pasa a la base de Hospitality');

await llamar('demo:eliminar', { perfilId: 'hospitality' });
const d = await crear('retail');
check(d.success && d.data.base === 'Wybix_Demo_Retail', 'D) despues de Hospitality, crear Retail da Retail', d.error || '');
check(BASES.get('Wybix_Demo_Retail').demo_profile === 'retail',
  'con su perfil, sin heredar el anterior', BASES.get('Wybix_Demo_Retail').demo_profile);
check(!BASES.has('Wybix_Demo_Hospitality'), 'y Hospitality no reaparece');

const abiertaD = await llamar('demo:abrir', { perfilId: 'retail' });
check(abiertaD.success, 'y se abre', abiertaD.error || '');
check(espias.abrir.at(-1).base === 'Wybix_Demo_Retail',
  '10) abrir arranca la seleccionada, no la ultima que existio',
  espias.abrir.at(-1).base);
check(JSON.parse(readFileSync(join(DATOS, 'db-config.json'), 'utf8')).database === 'Wybix_Demo_Retail',
  '11) y la configuracion local queda apuntando a Retail');

/* --- 9) Alternar cinco veces no mezcla nada --- */
let mezclado = null;
for (let vuelta = 1; vuelta <= 5 && !mezclado; vuelta++) {
  for (const id of ['hospitality', 'retail']) {
    const otro = id === 'retail' ? 'hospitality' : 'retail';
    if (BASES.has(DECLARADO[otro].base)) await llamar('demo:eliminar', { perfilId: otro });
    if (!BASES.has(DECLARADO[id].base)) await crear(id);
    await llamar('demo:abrir', { perfilId: id });

    const cfg = JSON.parse(readFileSync(join(DATOS, 'db-config.json'), 'utf8'));
    const meta = BASES.get(DECLARADO[id].base);
    if (cfg.database !== DECLARADO[id].base) mezclado = `vuelta ${vuelta}: config en ${cfg.database} pidiendo ${id}`;
    else if (meta.demo_profile !== id) mezclado = `vuelta ${vuelta}: ${DECLARADO[id].base} marcada como ${meta.demo_profile}`;
    else if (BASES.has(DECLARADO[otro].base)) mezclado = `vuelta ${vuelta}: quedo viva ${DECLARADO[otro].base}`;
  }
}
check(mezclado === null, '9) alternar Retail y Hospitality cinco veces no mezcla estado', mezclado || '');

/* --- 13) La instalacion normal, intacta --- */
check(DATOS.endsWith('-demo'), '13) todo lo anterior ocurrio en la carpeta de la demo', DATOS);
const indice = require_('../../electron/demo/index.js');
const normal = indice.olvidarConfiguracion({ getPath: () => join(RAIZ, 'wybix-pos') }, 'Wybix_POS', {});
check(normal.ok === false,
  'y la limpieza se niega a tocar una carpeta que no sea de demo', normal.motivo);
/* Sin los comentarios: el encabezado del archivo nombra `Wybix_POS` para
   explicar justamente que no se puede tocar, y eso no es codigo. */
const sinComentarios = readFileSync(join(REPO, 'electron', 'demo', 'ipc.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
check(!/Wybix_POS|wxsys\.dat|wybix-pos(?!-demo)/i.test(sinComentarios),
  'y el codigo del IPC no nombra ninguna base ni ruta del producto',
  (sinComentarios.match(/Wybix_POS|wxsys\.dat|wybix-pos(?!-demo)/i) || [])[0] || '');

Module._load = cargarOriginal;
try { rmSync(RAIZ, { recursive: true, force: true }); } catch { /* noop */ }

console.log(`\nRESULTADO: ${fallos ? `${fallos} FALLO(S) de ${pasos}` : `OK (${pasos} comprobaciones)`}`);
process.exit(fallos ? 1 : 0);
