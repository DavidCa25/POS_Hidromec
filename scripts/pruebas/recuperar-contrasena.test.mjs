/**
 * Contraseña olvidada con el PIN propio (electron/seguridad/recuperar.js).
 *
 *     node --test scripts/pruebas/recuperar-contrasena.test.mjs
 *
 * Lo que importa: que sin el PIN de ESA persona no se cambia nada, que la
 * respuesta no delata si el usuario existe, y que el cambio queda registrado.
 * La base es falsa: aqui se prueba la regla, no SQL Server (el PIN y su
 * bloqueo ya tienen sus pruebas).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { crearRecuperacion, GENERICO } = require('../../electron/seguridad/recuperar.js');

const sql = { NVarChar: () => 'nvarchar', Int: 'int' };

function montar({ usuarios = { ana: 7 }, pines = { 7: '4321' }, bloqueado = false } = {}) {
  const consultas = [];
  const pool = async () => ({
    request() {
      const params = {};
      const r = {
        input(n, _t, v) { params[n] = v; return r; },
        async query(texto) {
          consultas.push({ texto, params: { ...params } });
          if (/FROM dbo\.users WHERE usuario/.test(texto)) {
            const id = usuarios[params.u];
            return { recordset: id ? [{ id }] : [] };
          }
          return { recordset: [] };
        },
      };
      return r;
    },
  });
  const verificados = [];
  const pin = {
    async verificar(id, p) {
      verificados.push(id);
      if (bloqueado) return { ok: false, bloqueado: true, error: 'Demasiados intentos. Espera unos minutos.' };
      return pines[id] && pines[id] === p ? { ok: true } : { ok: false, error: 'PIN incorrecto.' };
    },
  };
  const contrasenas = { hashear: (c) => `hash(${c})` };
  const recuperar = crearRecuperacion({ sql, pool, pin, contrasenas });
  const cambios = () => consultas.filter(c => /UPDATE dbo\.users SET password_hash/.test(c.texto));
  const eventos = () => consultas.filter(c => /security_events/.test(c.texto));
  return { recuperar, cambios, eventos, verificados };
}

test('con su usuario y su PIN, cambia la contrasena y queda en la bitacora', async () => {
  const m = montar();
  const r = await m.recuperar({ usuario: 'ana', pin: '4321', nueva: 'nueva-clave' });
  assert.equal(r.ok, true);
  assert.equal(m.cambios().length, 1);
  assert.equal(m.cambios()[0].params.id, 7);
  assert.equal(m.cambios()[0].params.hash, 'hash(nueva-clave)');
  assert.match(m.eventos()[0].texto, /CONTRASENA_CON_PIN/);
});

test('con el PIN de otra persona, no cambia nada', async () => {
  const m = montar({ usuarios: { ana: 7, luis: 8 }, pines: { 7: '4321', 8: '9999' } });
  const r = await m.recuperar({ usuario: 'ana', pin: '9999', nueva: 'nueva-clave' });
  assert.equal(r.ok, false);
  assert.equal(r.error, GENERICO);
  assert.equal(m.cambios().length, 0);
});

test('usuario inexistente o sin PIN: la misma respuesta que un PIN equivocado', async () => {
  const m = montar({ usuarios: { ana: 7, sinpin: 9 } });
  const a = await m.recuperar({ usuario: 'nadie', pin: '1234', nueva: 'nueva-clave' });
  const b = await m.recuperar({ usuario: 'sinpin', pin: '1234', nueva: 'nueva-clave' });
  const c = await m.recuperar({ usuario: 'ana', pin: '0000', nueva: 'nueva-clave' });
  assert.deepEqual([a.error, b.error, c.error], [GENERICO, GENERICO, GENERICO]);
  assert.equal(m.verificados.length, 3, 'tambien se verifica para el usuario que no existe');
  assert.equal(m.cambios().length, 0);
});

test('PIN bloqueado: lo dice, y no cambia', async () => {
  const m = montar({ bloqueado: true });
  const r = await m.recuperar({ usuario: 'ana', pin: '4321', nueva: 'nueva-clave' });
  assert.equal(r.ok, false);
  assert.equal(r.bloqueado, true);
  assert.match(r.error, /Demasiados intentos/);
  assert.equal(m.cambios().length, 0);
});

test('contrasena corta, igual al PIN o datos vacios: se rechaza antes de probar el PIN', async () => {
  const m = montar();
  assert.equal((await m.recuperar({ usuario: 'ana', pin: '4321', nueva: '123' })).ok, false);
  assert.equal((await m.recuperar({ usuario: 'ana', pin: '4321', nueva: '4321' })).ok, false);
  assert.equal((await m.recuperar({ usuario: '', pin: '4321', nueva: 'nueva-clave' })).ok, false);
  assert.equal((await m.recuperar({ usuario: 'ana', pin: '', nueva: 'nueva-clave' })).ok, false);
  assert.equal(m.verificados.length, 0, 'no se gasta un intento de PIN en una peticion mal hecha');
  assert.equal(m.cambios().length, 0);
});
