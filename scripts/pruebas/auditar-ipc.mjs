/**
 * Contrato entre el renderer y el proceso principal.
 *
 *     node scripts/pruebas/auditar-ipc.mjs
 *
 * Angular llama a `window.electronAPI.<metodo>`. Si ese metodo no existe en el
 * preload, la llamada no falla al compilar ni al arrancar: falla el dia que un
 * cliente pulsa el boton. Esta auditoria compara los tres eslabones -lo que el
 * renderer usa, lo que el preload expone y el canal que atiende el proceso
 * principal- y clasifica cada diferencia.
 *
 * Sale con codigo != 0 si hay algo USADO Y NO EXPUESTO: eso es un boton roto.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

// ------------------------------------------------------------- recorrer
function archivos(dir, exts, acc = []) {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === '.angular' || n === 'dist') continue;
    const p = join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) archivos(p, exts, acc);
    else if (exts.includes(extname(n))) acc.push(p);
  }
  return acc;
}

// ------------------------------------------------- lo que usa el renderer
const usos = new Map();   // metodo -> Set de archivos
for (const f of archivos('src', ['.ts', '.html'])) {
  const txt = readFileSync(f, 'utf8');
  // electronAPI.metodo   ·   electronAPI?.metodo   ·   api.metodo cuando api = electronAPI
  for (const m of txt.matchAll(/electronAPI\s*\??\.\s*([A-Za-z_$][\w$]*)\s*(?:\?\.)?\s*\(/g)) {
    if (!usos.has(m[1])) usos.set(m[1], new Set());
    usos.get(m[1]).add(f.replace(/\\/g, '/'));
  }
}

// Muchos componentes hacen `private get api() { return window.electronAPI; }`
// y luego llaman `this.api.metodo(...)`. Se recogen tambien esos.
function registrarUso(metodo, archivo) {
  if (!usos.has(metodo)) usos.set(metodo, new Set());
  usos.get(metodo).add(archivo.replace(/\\/g, '/'));
}

for (const f of archivos('src', ['.ts'])) {
  const txt = readFileSync(f, 'utf8');

  // const api = (window as any).electronAPI;
  // let bridge = window.electronAPI;
  // var electron = (window as any).electronAPI;
  const aliasesLocales = new Set();

  for (const m of txt.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\(\s*window\s+as\s+any\s*\)|window)\s*\.\s*electronAPI\b/g
  )) {
    aliasesLocales.add(m[1]);
  }

  for (const alias of aliasesLocales) {
    const re = new RegExp(
      `\\b${alias}\\s*\\??\\.\\s*([A-Za-z_$][\\w$]*)\\s*(?:\\?\\.)?\\s*\\(`,
      'g'
    );

    for (const m of txt.matchAll(re)) {
      registrarUso(m[1], f);
    }
  }

  // get api() { return (window as any).electronAPI; }
  const getters = new Set();

  for (const m of txt.matchAll(
    /get\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{[\s\S]{0,300}?(?:\(\s*window\s+as\s+any\s*\)|window)\s*\.\s*electronAPI[\s\S]{0,300}?\}/g
  )) {
    getters.add(m[1]);
  }

  for (const alias of getters) {
    const re = new RegExp(
      `this\\.${alias}\\s*\\??\\.\\s*([A-Za-z_$][\\w$]*)`,
      'g'
    );

    for (const m of txt.matchAll(re)) {
      registrarUso(m[1], f);
    }
  }

  // this.api = (window as any).electronAPI;
  const aliasesThis = new Set();

  for (const m of txt.matchAll(
    /this\.([A-Za-z_$][\w$]*)\s*=\s*(?:\(\s*window\s+as\s+any\s*\)|window)\s*\.\s*electronAPI\b/g
  )) {
    aliasesThis.add(m[1]);
  }

  for (const alias of aliasesThis) {
    const re = new RegExp(
      `this\\.${alias}\\s*\\??\\.\\s*([A-Za-z_$][\\w$]*)`,
      'g'
    );

    for (const m of txt.matchAll(re)) {
      registrarUso(m[1], f);
    }
  }
}

// ------------------------------------------------ lo que expone el preload
//
// No se analiza el texto: se EJECUTA el preload con un `electron` de mentira
// y se leen las claves del objeto que expone. Parsear el archivo daba falsos
// positivos con los metodos de varias lineas, y un falso positivo aqui manda
// a "arreglar" algo que no esta roto.
const canalDe = new Map();      // metodo -> canal que invoca
function registrarSuperficie(nombre, objeto, destino) {
  for (const [k, v] of Object.entries(objeto || {})) {
    destino.set(k, canalDe.get(v) || '(envoltorio)');
  }
}

const superficies = {};
{
  const Module = (await import('node:module')).default;
  const originalLoad = Module._load;
  // `electron` no existe fuera de Electron: se sustituye por lo justo.
  Module._load = function (peticion, padre, esPrincipal) {
    if (peticion === 'electron') {
      const espia = (canal) => { const f = () => {}; canalDe.set(f, canal); return f; };
      return {
        contextBridge: {
          exposeInMainWorld: (nombre, api) => { superficies[nombre] = api; },
        },
        ipcRenderer: {
          invoke: (canal) => canal,
          send: (canal) => canal,
          on: (canal) => canal,
          removeListener: () => {},
          removeAllListeners: () => {},
        },
        ...{ _espia: espia },
      };
    }
    return originalLoad.apply(this, arguments);
  };
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  delete req.cache?.[req.resolve('../../electron/preload.js')];
  req('../../electron/preload.js');
  Module._load = originalLoad;
}

const expuestos = new Map();  // metodo -> canal (o marca de envoltorio)
for (const k of Object.keys(superficies.electronAPI || {})) {
  expuestos.set(k, '(expuesto)');
}
// La otra superficie, `wybix`, es la de Hospitality. Se anota aparte para no
// dar por rota una llamada que en realidad vive ahi.
const expuestosWybix = new Set();
for (const [grupo, api] of Object.entries(superficies.wybix || {})) {
  for (const k of Object.keys(api || {})) expuestosWybix.add(`${grupo}.${k}`);
}

// El canal se saca del texto solo para informar, no para decidir.
const preload = readFileSync('electron/preload.js', 'utf8');
for (const m of preload.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*[^,\n]*?ipcRenderer\.(?:invoke|send|on)\(\s*['"]([^'"]+)['"]/g)) {
  if (expuestos.has(m[1])) expuestos.set(m[1], m[2]);
}

// -------------------------------------------- canales que atiende el main
const main = readFileSync('electron/main.js', 'utf8');
const ipcExtra = archivos('electron/ipc', ['.js']).map(f => readFileSync(f, 'utf8')).join('\n');
const canales = new Set();
for (const m of (main + ipcExtra).matchAll(/ipcMain\.(?:handle|on)\(\s*['"]([^'"]+)['"]/g)) {
  canales.add(m[1]);
}

// --------------------------------------------------------- clasificacion
const soloUsados = [];
const soloExpuestos = [];
const sinHandler = [];
let ok = 0;

for (const [metodo, archivosQueLoUsan] of [...usos].sort()) {
  if (expuestos.has(metodo)) {
    const canal = expuestos.get(metodo);
    // Solo se juzga el canal cuando se pudo resolver del texto. Los que
    // empiezan por `on...` son suscripciones main -> renderer y no tienen
    // `ipcMain.handle`: no son un hueco, son la direccion contraria.
    const resuelto = canal !== '(expuesto)' && canal !== '(envoltorio)';
    const esSuscripcion = /^on[A-Z]/.test(metodo);
    if (resuelto && !esSuscripcion && !canales.has(canal)) {
      sinHandler.push({ metodo, canal, archivos: [...archivosQueLoUsan] });
    } else ok++;
  } else {
    soloUsados.push({ metodo, archivos: [...archivosQueLoUsan] });
  }
}
for (const [metodo] of [...expuestos].sort()) {
  if (!usos.has(metodo)) soloExpuestos.push(metodo);
}

// ------------------------------------------------------------- informe
console.log('\nCONTRATO electronAPI  —  renderer vs preload vs main\n');
console.log(`  usados por el renderer   ${usos.size}`);
console.log(`  expuestos en el preload  ${expuestos.size}`);
console.log(`  canales en el principal  ${canales.size}`);
console.log(`\n  OK (usado, expuesto y con handler)   ${ok}`);

if (soloUsados.length) {
  console.log(`\nUSADO PERO NO EXPUESTO  (${soloUsados.length})  <- botones rotos`);
  for (const u of soloUsados) {
    console.log(`   ${u.metodo}`);
    u.archivos.slice(0, 3).forEach(a => console.log(`      ${a}`));
    if (u.archivos.length > 3) console.log(`      ... y ${u.archivos.length - 3} mas`);
  }
}

if (sinHandler.length) {
  console.log(`\nEXPUESTO SIN HANDLER EN EL PRINCIPAL  (${sinHandler.length})`);
  for (const s of sinHandler) console.log(`   ${s.metodo}  ->  canal '${s.canal}' no existe`);
}

if (soloExpuestos.length) {
  console.log(`\nEXPUESTO PERO NO USADO  (${soloExpuestos.length})  <- deuda, no rotura`);
  console.log('   ' + soloExpuestos.join(', '));
}

const roto = soloUsados.length + sinHandler.length;
console.log(`\nRESULTADO: ${roto === 0 ? 'contrato completo' : roto + ' hueco(s) funcional(es)'}`);
process.exit(roto === 0 ? 0 : 1);
