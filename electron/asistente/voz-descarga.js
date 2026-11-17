'use strict';
/**
 * LA VOZ EN ESPAÑOL, BAJADA UNA SOLA VEZ.
 *
 * El dictado corre sin internet, pero el modelo de español (~40 MB) no viaja
 * en el instalador: se baja la primera vez que alguien lo pide en el chat.
 *
 *   1. Baja el .zip oficial de Vosk (alphacephei.com) a `descarga.zip.part`,
 *      calculando el SHA-256 mientras llega.
 *   2. Si el tamaño o el hash no son EXACTAMENTE los esperados, lo borra y
 *      falla: no se abre nada que no sea el archivo que se revisó.
 *   3. Lo descomprime con el tar.exe de Windows (System32, ruta absoluta) en
 *      una carpeta temporal y lo vuelve a empacar como .tar.gz, que es lo que
 *      lee vosk-browser.
 *   4. Renombra a `modelo.tar.gz` al final: un corte a medias nunca deja un
 *      modelo roto en su lugar.
 *
 * Una descarga a la vez: si ya hay una en curso, quien llega se suma a ella.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const MODELO = {
  url: 'https://alphacephei.com/vosk/models/vosk-model-small-es-0.42.zip',
  carpeta: 'vosk-model-small-es-0.42',
  bytes: 39817833,
  sha256: '09b239888f633ef2f0b4e09736e3d9936acfd810bc65d53fad45261762c6511f',
};

const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');

const correr = (args, cwd) => new Promise((ok, mal) => {
  execFile(TAR, args, { cwd, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (e, _out, err) => (e ? mal(new Error(String(err || e.message).trim().split('\n')[0])) : ok()));
});

const borrar = (p) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* noop */ } };

let enCurso = null;

/**
 * Baja UN archivo a `destino` y lo deja solo si el tamaño y el SHA-256 son
 * EXACTAMENTE los esperados (si no, lanza; quien llama borra el destino).
 * La usa también la voz de respuesta (voz-piper.js).
 * @param o { url, bytes, sha256, destino, traer (fetch), avance(fraccion 0-1) }
 */
async function bajarVerificado({ url, bytes, sha256, destino, traer = globalThis.fetch, avance = () => {} }) {
  let r;
  try { r = await traer(url, { redirect: 'follow' }); } catch { throw new Error('No hay internet o no se pudo llegar al servidor de la voz.'); }
  if (!r.ok || !r.body) throw new Error(`El servidor de la voz contestó ${r.status}.`);
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(destino);
  let n = 0, ultimo = -1;
  try {
    for await (const trozo of r.body) {
      n += trozo.length;
      if (n > bytes) throw new Error('La descarga es más grande de lo esperado; se descartó.');
      hash.update(trozo);
      if (!out.write(trozo)) await new Promise((ok) => out.once('drain', ok));
      const pct = Math.floor((n / bytes) * 100);
      if (pct !== ultimo) { ultimo = pct; avance(n / bytes); }
    }
  } finally { await new Promise((ok) => out.end(ok)); }
  if (n !== bytes) throw new Error('La descarga se cortó; vuelve a intentarlo.');
  if (hash.digest('hex') !== sha256) throw new Error('El archivo que llegó no es el esperado; se descartó.');
}

/**
 * @param d { carpeta: userData/wybix-voz, avance(pct 0-100, etapa), fetch? (para pruebas), modelo? (para pruebas) }
 * @returns la ruta de modelo.tar.gz
 */
function descargarVoz(d) {
  if (!enCurso) enCurso = bajar(d).finally(() => { enCurso = null; });
  return enCurso;
}

async function bajar({ carpeta, avance = () => {}, fetch: traer = globalThis.fetch, modelo = MODELO }) {
  if (!fs.existsSync(TAR)) throw new Error('Esta versión de Windows no trae tar.exe; copia el modelo a mano (docs/asistente.md).');
  fs.mkdirSync(carpeta, { recursive: true });
  const parcial = path.join(carpeta, 'descarga.zip.part');
  const tmp = path.join(carpeta, `tmp-${process.pid}-${Date.now()}`);
  const destino = path.join(carpeta, 'modelo.tar.gz');
  const destinoParcial = `${destino}.part`;
  try {
    avance(0, 'bajando');
    await bajarVerificado({ ...modelo, destino: parcial, traer, avance: (f) => avance(Math.floor(f * 90), 'bajando') });

    avance(92, 'preparando');
    fs.mkdirSync(tmp, { recursive: true });
    await correr(['-xf', parcial, '-C', tmp]);
    const raiz = path.join(tmp, modelo.carpeta);
    if (!fs.existsSync(path.join(raiz, 'am')) || !fs.existsSync(path.join(raiz, 'conf'))) throw new Error('El modelo no trae lo que se esperaba.');
    avance(96, 'preparando');
    await correr(['-czf', destinoParcial, '-C', tmp, modelo.carpeta]);
    fs.renameSync(destinoParcial, destino);
    avance(100, 'listo');
    return destino;
  } finally {
    borrar(parcial);
    borrar(tmp);
    borrar(destinoParcial);
  }
}

module.exports = { descargarVoz, bajarVerificado, correr, TAR, MODELO };
