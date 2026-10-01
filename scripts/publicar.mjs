/**
 * PUBLICAR UNA VERSION SIN TENER QUE ACORDARSE DE DONDE ESTA EL TOKEN.
 *
 *     npm run publish
 *
 * electron-builder sube el instalador a GitHub Releases y necesita GH_TOKEN.
 * Este script lo busca, en este orden:
 *
 *   1. La variable de entorno GH_TOKEN (si ya la tienes puesta, manda ella).
 *   2. El archivo  %USERPROFILE%\.wybix\publicar.env  con una linea
 *        GH_TOKEN=github_pat_...
 *
 * Si no esta en ninguno de los dos, lo pide UNA vez (sin mostrarlo en
 * pantalla) y lo guarda en ese archivo para la siguiente.
 *
 * POR QUE FUERA DEL PROYECTO Y NO EN .env
 * ---------------------------------------
 * Un archivo dentro del repositorio puede acabar en un commit o empaquetado
 * dentro del instalador, que se reparte a todos los clientes. En la carpeta
 * del usuario no viaja con el codigo, sobrevive a clonar de nuevo o cambiar
 * de rama, y solo lo lee tu sesion de Windows.
 *
 * El token nunca se imprime: solo se dice de donde salio.
 *
 * Para crearlo: GitHub > Settings > Developer settings > Personal access
 * tokens > Fine-grained, con acceso solo a este repositorio y permiso
 * "Contents: Read and write" (lo que necesita para crear el release).
 *
 * NOTAS DE LA VERSION
 * -------------------
 * Se escriben en  notas-de-version/<version>.md  (la de package.json) y este
 * script las pone en dos sitios:
 *
 *   - latest.yml, para el actualizador de la app (releaseInfo.releaseNotesFile);
 *   - la descripcion del release en GitHub, que es lo que muestra la web
 *     (wybixpos.com.mx/prueba lee el ultimo release). electron-builder NO la
 *     llena: crea el release vacio, por eso se pone aqui despues.
 *
 * Para poner o corregir las notas de una version YA publicada, sin compilar:
 *
 *     npm run publish:notas              (la version de package.json)
 *     npm run publish:notas -- 1.3.0     (otra)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import readline from 'node:readline';

const CARPETA = join(homedir(), '.wybix');
const ARCHIVO = join(CARPETA, 'publicar.env');

function leerArchivo() {
  if (!existsSync(ARCHIVO)) return null;
  /* Tolerante con como se escriba a mano: gh_token o GH_TOKEN, con o sin
     comillas, con `export` delante o con el BOM que deja el Bloc de notas. */
  const clave = /^(?:export\s+)?GH_TOKEN\s*=\s*/i;
  const linea = readFileSync(ARCHIVO, 'utf8')
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .find(l => clave.test(l));
  const valor = linea?.replace(clave, '').replace(/^["']|["']$/g, '').trim();
  return valor || null;
}

/** Pide el token sin que se vea lo que se escribe. */
function preguntarOculto(pregunta) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let mostrada = false;
    rl._writeToOutput = (texto) => {
      if (!mostrada) { process.stdout.write(texto); mostrada = true; }
    };
    rl.question(pregunta, (r) => { rl.close(); process.stdout.write('\n'); resolve(r.trim()); });
  });
}

async function obtenerToken() {
  if (process.env.GH_TOKEN?.trim()) return { token: process.env.GH_TOKEN.trim(), origen: 'la variable de entorno GH_TOKEN' };

  const guardado = leerArchivo();
  if (guardado) return { token: guardado, origen: ARCHIVO };

  if (!process.stdin.isTTY) {
    console.error(`\nNo encuentro el token de GitHub para publicar.\n` +
      `Crea el archivo ${ARCHIVO} con una linea:\n\n    GH_TOKEN=github_pat_...\n`);
    process.exit(1);
  }

  console.log(`\nNo encuentro el token de GitHub para publicar (ni GH_TOKEN ni ${ARCHIVO}).`);
  console.log('Pégalo una vez y lo guardo ahí para la próxima. No se mostrará al escribir.\n');
  const token = await preguntarOculto('Token de GitHub: ');
  if (!token) { console.error('Sin token no se puede publicar.'); process.exit(1); }

  mkdirSync(CARPETA, { recursive: true });
  writeFileSync(ARCHIVO, `GH_TOKEN=${token}\n`, { encoding: 'utf8', mode: 0o600 });
  console.log(`Guardado en ${ARCHIVO}.`);
  return { token, origen: ARCHIVO };
}

// ------------------------------------------------------------ notas
const PKG = JSON.parse(readFileSync('package.json', 'utf8'));
const { owner: DUENO, repo: REPO } = PKG.build?.publish ?? {};
const SOLO_NOTAS = process.argv.includes('--solo-notas');
const VERSION = process.argv.slice(2).find(a => /^\d+\.\d+\.\d+/.test(a)) ?? PKG.version;
const NOTAS = resolve('notas-de-version', `${VERSION}.md`);

function leerNotas() {
  if (!existsSync(NOTAS)) return null;
  const t = readFileSync(NOTAS, 'utf8').replace(/^﻿/, '').trim();
  return t || null;
}

async function github(ruta, token, opciones = {}) {
  const r = await fetch(`https://api.github.com/repos/${DUENO}/${REPO}${ruta}`, {
    ...opciones,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
  });
  const cuerpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${cuerpo?.message || 'sin detalle'}`);
  return cuerpo;
}

/** Pone las notas como descripcion del release v<version> (borrador o publicado). */
async function ponerNotas(token, notas) {
  /* Por etiqueta no sirve: un borrador todavia no tiene etiqueta en git. La
     lista, con token, incluye los borradores. */
  const lista = await github('/releases?per_page=30', token);
  const rel = lista.find(x => x.tag_name === `v${VERSION}` || x.name === VERSION);
  if (!rel) throw new Error(`No encuentro el release v${VERSION} en ${DUENO}/${REPO}.`);
  await github(`/releases/${rel.id}`, token, { method: 'PATCH', body: JSON.stringify({ body: notas }) });
  console.log(`\nNotas de la v${VERSION} puestas en GitHub.`);
  if (rel.draft) {
    console.log('El release sigue como BORRADOR: la web y el boton de descarga lo ignoran hasta'
      + ` que lo publiques en\n  ${rel.html_url}`);
  } else {
    console.log('La web las mostrara en unos minutos (cache de 10 min).');
  }
}

const notas = leerNotas();
if (!notas) {
  const aviso = `No hay notas para la v${VERSION} (${NOTAS}).`;
  if (SOLO_NOTAS) { console.error(`\n${aviso}`); process.exit(1); }
  console.warn(`\nAVISO: ${aviso}\nEl release saldra sin descripcion; puedes ponerla despues con`
    + ' `npm run publish:notas`.\n');
}

const { token, origen } = await obtenerToken();
console.log(`Token de GitHub: tomado de ${origen}.\n`);

if (SOLO_NOTAS) {
  try { await ponerNotas(token, notas); process.exit(0); }
  catch (e) { console.error(`\nNo se pudieron poner las notas: ${e.message}`); process.exit(1); }
}

/* Los mismos pasos que antes hacia "publish", ahora con el token puesto. Lo
   que va despues de `--` lo recibe electron-builder, el ultimo paso; la ruta
   va entre comillas porque el shell la partiria si tuviera espacios. */
const extra = notas ? ['--', `"-c.releaseInfo.releaseNotesFile=${NOTAS}"`] : [];
const r = spawnSync('npm', ['run', 'publish:pasos', ...extra], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, GH_TOKEN: token },
});
if (r.status !== 0) process.exit(r.status ?? 1);

if (notas) {
  try { await ponerNotas(token, notas); }
  catch (e) {
    console.error(`\nEl instalador se publico, pero no se pudieron poner las notas: ${e.message}`
      + `\nReintenta con: npm run publish:notas -- ${VERSION}`);
    process.exit(1);
  }
}
