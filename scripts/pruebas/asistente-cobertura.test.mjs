/**
 * COBERTURA DEL ASISTENTE: todo lo que se hace a mano, lo hace el asistente.
 *
 * Para cada canal protegido (electron/seguridad/canales.js):
 *   - cubierto: algún plan de electron/asistente/acciones llama a la función
 *     de preload que lo invoca (se calcula leyendo los archivos);
 *   - o está en electron/asistente/cobertura.js como LECTURA, MANUAL (con
 *     motivo) o PENDIENTE.
 *
 * Falla si un canal no está en ningún lado (nadie decidió), si un canal
 * cubierto sigue en PENDIENTE (hay que sacarlo), si uno MANUAL lo hace el
 * asistente, o si la lista nombra un canal que ya no existe.
 *
 *   node --test scripts/pruebas/asistente-cobertura.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const raiz = join(import.meta.dirname, '..', '..');
const { EXIGE } = require(join(raiz, 'electron/seguridad/canales.js'));
const { LECTURA, MANUAL, PENDIENTE } = require(join(raiz, 'electron/asistente/cobertura.js'));

/** Función de preload → canal que invoca («actualizarProducto» → «sp-update-product»). */
function funcionesDePreload() {
  const t = readFileSync(join(raiz, 'electron/preload.js'), 'utf8');
  const out = new Map();
  const re = /(\w+)\s*:\s*(?:async\s*)?\([^)]*\)\s*=>\s*(?:\{\s*(?:return\s+)?)?invoke\(\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(t))) out.set(m[1], m[2]);
  return out;
}

/** Lo que llaman los planes: «electronAPI.x» o «wybix.area.x» (la última parte es la función). */
function apisDeLosPlanes() {
  const dir = join(raiz, 'electron/asistente/acciones');
  const usadas = new Set();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const t = readFileSync(join(dir, f), 'utf8');
    for (const m of t.matchAll(/['"`](?:electronAPI|wybix)\.([\w.]+)['"`]/g)) usadas.add(m[1].split('.').pop());
  }
  return usadas;
}

function calcular() {
  const preload = funcionesDePreload();
  const cubiertos = new Set();
  for (const fn of apisDeLosPlanes()) { const c = preload.get(fn); if (c && EXIGE[c]) cubiertos.add(c); }
  const pendientes = Object.values(PENDIENTE).flat();
  return { cubiertos, pendientes };
}

test('cobertura: cada canal protegido está decidido (lo hace el asistente, es lectura, manual con motivo o pendiente)', () => {
  const { cubiertos, pendientes } = calcular();
  const listados = [...LECTURA, ...Object.keys(MANUAL), ...pendientes];

  const repetidos = listados.filter((c, i) => listados.indexOf(c) !== i);
  assert.deepEqual(repetidos, [], 'un canal va en una sola lista');

  const fantasma = listados.filter((c) => !EXIGE[c]);
  assert.deepEqual(fantasma, [], 'la lista nombra canales que ya no existen en canales.js');

  const sinDecidir = Object.keys(EXIGE).filter((c) => !cubiertos.has(c) && !listados.includes(c));
  assert.deepEqual(sinDecidir, [], 'canales nuevos sin decidir: agrégalos a electron/asistente/cobertura.js');

  const yaCubiertos = pendientes.filter((c) => cubiertos.has(c));
  assert.deepEqual(yaCubiertos, [], 'ya los hace el asistente: sácalos de PENDIENTE');

  const manualPeroHecho = Object.keys(MANUAL).filter((c) => cubiertos.has(c));
  assert.deepEqual(manualPeroHecho, [], 'están como MANUAL pero el asistente los hace: decide cuál es');

  const sinMotivo = Object.entries(MANUAL).filter(([, m]) => String(m || '').trim().length < 10).map(([c]) => c);
  assert.deepEqual(sinMotivo, [], 'cada canal MANUAL dice por qué');

  const acciones = cubiertos.size + pendientes.length;
  console.log(`   asistente: ${cubiertos.size} de ${acciones} acciones (${Math.round((cubiertos.size / acciones) * 100)}%) · ` +
    `${Object.keys(MANUAL).length} manuales a propósito · ${LECTURA.length} de lectura`);
  for (const [area, cs] of Object.entries(PENDIENTE)) if (cs.length) console.log(`   pendiente ${area}: ${cs.length}`);
});

test('cobertura: cada plan llama a una función que existe en preload y está protegida', () => {
  const preload = funcionesDePreload();
  const sinCanal = [...apisDeLosPlanes()].filter((fn) => !preload.has(fn));
  /* Funciones del asistente mismo (apodos, preferencias) no son canales del negocio. */
  const propias = new Set(['asistenteAlias', 'asistenteAliasOlvidar']);
  assert.deepEqual(sinCanal.filter((fn) => !propias.has(fn)), [], 'un plan llama a algo que preload no expone');
});
