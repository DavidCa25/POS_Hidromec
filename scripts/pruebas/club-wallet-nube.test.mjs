/**
 * 0066 · La bajada del Club también trae los pases de Wallet de la empresa
 * (club_pull.wallet_passes) y los aplica con sp_club_wallet_apply, para que
 * esta caja reconozca sin internet una tarjeta emitida en otra sucursal.
 *
 *     node --test scripts/pruebas/club-wallet-nube.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { crearClub } = require('../../electron/nube/club.js');

function mundo(respuesta) {
  const ejecutados = [];
  let cfg = {};
  const pool = async () => ({
    request() {
      const ins = {};
      const r = {
        input(n, _t, v) { ins[n] = v; return r; },
        async execute(sp) { ejecutados.push([sp, ins.payload ? JSON.parse(ins.payload) : null]); return { recordset: [{}] }; },
      };
      return r;
    },
  });
  const club = crearClub({
    pool, sql: { NVarChar: () => 'nv', MAX: 0 }, llamar: async () => respuesta,
    cfg: { leer: () => cfg, escribir: (p) => { cfg = { ...cfg, ...p }; } }, disponible: async () => true,
  });
  return { club, ejecutados, cfg: () => cfg };
}

test('los pases bajan con su teléfono y se aplican una vez por ciclo', async () => {
  const pases = [{ serial: 'a1b2c3d4e5f60718293a4b5c', phone: '4773124588', customer_name: 'Mariana López' }];
  const m = mundo({ ok: true, cursor: '2026-10-28T12:00:00Z', wallet_passes: pases });
  const r = await m.club.bajar();
  assert.equal(r.recibidos.pases, 1);
  assert.deepEqual(m.ejecutados, [['sp_club_wallet_apply', pases]]);
  assert.equal(m.cfg().clubCursor, '2026-10-28T12:00:00Z');
});

test('sin pases (o una nube anterior a 0066) no se llama al procedimiento', async () => {
  const m = mundo({ ok: true, cursor: '2026-10-28T12:00:00Z' });
  const r = await m.club.bajar();
  assert.equal(r.recibidos.pases, 0);
  assert.equal(m.ejecutados.some(([sp]) => sp === 'sp_club_wallet_apply'), false);
});
