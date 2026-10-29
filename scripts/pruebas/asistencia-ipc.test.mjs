/**
 * Asistencia: de donde sale QUIEN checa (electron/ipc/asistencia.js).
 *
 *     node --test scripts/pruebas/asistencia-ipc.test.mjs
 *
 * `sesion.proteger` agrega la sesion como ultimo argumento. Checar se llama
 * sin payload, y tomar la sesion por payload dejaba el dialogo vacio: nadie
 * era "quien checa".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { argumentos } = require('../../electron/ipc/asistencia.js');
const ses = { userId: 7, usuario: 'cajero1' };

test('sin payload: la sesion dice quien es y el payload queda vacio', () => {
  assert.deepEqual(argumentos([ses]), { p: {}, quien: 7 });
});

test('con payload: el payload es el primero y quien sale de la sesion', () => {
  assert.deepEqual(argumentos([{ tipo: 'ENTRADA' }, ses]), { p: { tipo: 'ENTRADA' }, quien: 7 });
});

test('un userId en el payload no cambia quien checa', () => {
  assert.equal(argumentos([{ userId: 99 }, ses]).quien, 7);
});

test('sin sesion no hay quien', () => {
  assert.deepEqual(argumentos([]), { p: {}, quien: null });
});
