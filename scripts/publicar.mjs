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
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
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

const { token, origen } = await obtenerToken();
console.log(`Token de GitHub: tomado de ${origen}.\n`);

/* Los mismos pasos que antes hacia "publish", ahora con el token puesto. */
const r = spawnSync('npm', ['run', 'publish:pasos'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, GH_TOKEN: token },
});
process.exit(r.status ?? 1);
