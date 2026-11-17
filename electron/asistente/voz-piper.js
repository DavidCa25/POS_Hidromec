'use strict';
/**
 * WYBIX HABLA SIN INTERNET: Piper (texto → voz, en la caja).
 *
 * No viaja en el instalador: se baja una vez (~85 MB) cuando alguien lo pide
 * en el chat, con URL, tamaño y SHA-256 FIJOS (si llega otra cosa, se borra).
 *
 *   motor  piper_windows_amd64.zip, release 2023.11.14-2 de rhasspy/piper
 *          (licencia MIT; el proyecto nuevo es GPL-3 y no se usa)
 *   voz    es_MX-claude-high (Hugging Face rhasspy/piper-voices; datos de
 *          entrenamiento Apache-2.0). El hash es el que publica Hugging Face.
 *
 * Queda en <userData>/wybix-habla/{piper/, voz.onnx, voz.onnx.json}. Todo se
 * escribe como .part / carpeta temporal y se renombra al final: un corte a
 * medias no deja una instalación rota.
 *
 * Para contestar rápido, piper.exe se queda corriendo con el modelo cargado
 * (--json-input): cada frase es una línea JSON y Piper avisa en stdout cuando
 * terminó el .wav. Se cierra solo tras 5 minutos sin hablar. Una frase a la
 * vez (cola), máximo 600 caracteres, 20 s de límite.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { bajarVerificado, correr, TAR } = require('./voz-descarga');

const ARCHIVOS = {
  motor: { url: 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip',
           bytes: 22477236, sha256: 'f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea' },
  voz: { url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_MX/claude/high/es_MX-claude-high.onnx',
         bytes: 63122309, sha256: '3ef40a71ea63852cd8ab7e6fa7d2ecdcfa67a0b47c9c48e3f10e02ee02083ea0' },
  config: { url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_MX/claude/high/es_MX-claude-high.onnx.json',
            bytes: 4963, sha256: '1afc81f703c0e4cb3b4d7c0dca096b8b54a98806807f0170cf5eb5557723c12d' },
};
const TOTAL = ARCHIVOS.motor.bytes + ARCHIVOS.voz.bytes + ARCHIVOS.config.bytes;

const rutas = (carpeta) => ({
  exe: path.join(carpeta, 'piper', 'piper.exe'),
  voz: path.join(carpeta, 'voz.onnx'),
  config: path.join(carpeta, 'voz.onnx.json'),
});
const existe = (p) => { try { return fs.statSync(p).size > 0; } catch { return false; } };
const borrar = (p) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* noop */ } };

/** ¿Está instalada en esta carpeta? */
function instalada(carpeta) {
  if (!carpeta) return false;
  const r = rutas(carpeta);
  return existe(r.exe) && existe(r.voz) && existe(r.config);
}

let enCurso = null;
/**
 * Baja e instala Piper y la voz. Una a la vez: quien llega se suma.
 * @param d { carpeta, avance(pct 0-100, etapa), fetch?, archivos? (pruebas) }
 */
function descargarHabla(d) {
  if (!enCurso) enCurso = instalar(d).finally(() => { enCurso = null; });
  return enCurso;
}

async function instalar({ carpeta, avance = () => {}, fetch: traer = globalThis.fetch, archivos = ARCHIVOS, carpetaZip = 'piper' }) {
  if (!fs.existsSync(TAR)) throw new Error('Esta versión de Windows no trae tar.exe; no puedo preparar la voz.');
  fs.mkdirSync(carpeta, { recursive: true });
  const r = rutas(carpeta);
  const total = archivos.motor.bytes + archivos.voz.bytes + archivos.config.bytes;
  const tmp = path.join(carpeta, `tmp-${process.pid}-${Date.now()}`);
  const partes = { motor: path.join(carpeta, 'motor.zip.part'), voz: `${r.voz}.part`, config: `${r.config}.part` };
  let hecho = 0;
  const bajar = async (k) => {
    const a = archivos[k];
    await bajarVerificado({ ...a, destino: partes[k], traer, avance: (f) => avance(Math.floor(((hecho + f * a.bytes) / total) * 95), 'bajando') });
    hecho += a.bytes;
  };
  try {
    avance(0, 'bajando');
    await bajar('motor');
    await bajar('voz');
    await bajar('config');
    avance(96, 'preparando');
    fs.mkdirSync(tmp, { recursive: true });
    await correr(['-xf', partes.motor, '-C', tmp]);
    const extraido = path.join(tmp, carpetaZip);
    if (!existe(path.join(extraido, 'piper.exe')) || !fs.existsSync(path.join(extraido, 'espeak-ng-data'))) throw new Error('El programa de voz no trae lo que se esperaba.');
    cerrar();
    borrar(path.join(carpeta, 'piper'));
    fs.renameSync(extraido, path.join(carpeta, 'piper'));
    fs.renameSync(partes.voz, r.voz);
    fs.renameSync(partes.config, r.config);
    avance(100, 'listo');
    return true;
  } finally {
    for (const p of Object.values(partes)) borrar(p);
    borrar(tmp);
  }
}

/* ------------------------------------------------------------ hablar */
let proc = null, procCarpeta = null, inactivo = null;
let cola = Promise.resolve();
let esperando = null;   // { resolver, rechazar, salida, timer }

function cerrar() {
  clearTimeout(inactivo);
  if (proc) { try { proc.kill(); } catch { /* noop */ } }
  proc = null; procCarpeta = null;
}

function arrancar(carpeta) {
  if (proc && procCarpeta === carpeta) return proc;
  cerrar();
  const r = rutas(carpeta);
  proc = spawn(r.exe, ['--model', r.voz, '--config', r.config, '--json-input', '--quiet'], { windowsHide: true, cwd: path.dirname(r.exe) });
  procCarpeta = carpeta;
  let buffer = '';
  proc.stdout.on('data', (d) => {
    buffer += d.toString();
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const linea = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (esperando && linea && path.resolve(linea) === path.resolve(esperando.salida)) {
        const e = esperando; esperando = null; clearTimeout(e.timer); e.resolver();
      }
    }
  });
  proc.stderr.on('data', () => { /* Piper registra en stderr; no hace falta */ });
  const fin = () => {
    proc = null; procCarpeta = null;
    if (esperando) { const e = esperando; esperando = null; clearTimeout(e.timer); e.rechazar(new Error('La voz se detuvo.')); }
  };
  proc.on('exit', fin);
  proc.on('error', fin);
  return proc;
}

/**
 * Texto → .wav (Buffer). Lanza si no está instalada.
 * @param o { carpeta, texto }
 */
function hablar({ carpeta, texto }) {
  const t = String(texto || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  if (!t) return Promise.resolve(null);
  if (!instalada(carpeta)) return Promise.reject(new Error('La voz de Wybix no está instalada en esta caja.'));
  const tarea = cola.then(() => new Promise((resolver, rechazar) => {
    const salida = path.join(os.tmpdir(), `wybix-habla-${process.pid}-${Date.now()}.wav`);
    const p = arrancar(carpeta);
    const timer = setTimeout(() => { if (esperando) { esperando = null; rechazar(new Error('La voz tardó demasiado.')); cerrar(); } }, 20_000);
    esperando = {
      salida, timer, rechazar,
      resolver: () => {
        try { const wav = fs.readFileSync(salida); borrar(salida); resolver(wav); } catch (e) { rechazar(e); }
      },
    };
    p.stdin.write(`${JSON.stringify({ text: t, output_file: salida })}\n`);
  }));
  cola = tarea.catch(() => {});
  clearTimeout(inactivo);
  tarea.finally(() => { clearTimeout(inactivo); inactivo = setTimeout(cerrar, 5 * 60_000); }).catch(() => {});
  return tarea;
}

module.exports = { descargarHabla, hablar, instalada, cerrar, ARCHIVOS, TOTAL };
