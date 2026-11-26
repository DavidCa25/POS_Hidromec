import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { repartirAbono } = createRequire(import.meta.url)('../../electron/lib/repartir-abono.js');

const deuda = [{ id: 1, balance: 500 }, { id: 2, balance: 250 }, { id: 3, balance: 750 }, { id: 4, balance: 500 }];

test('$800 sobre $2,000: liquida las que alcanza y la siguiente queda con faltante', () => {
  const r = repartirAbono(deuda, 800);
  assert.deepEqual(r.partidas.map((p) => [p.sale_id, p.abono, p.queda, p.liquidada]), [
    [1, 500, 0, true], [2, 250, 0, true], [3, 50, 700, false]]);
  assert.equal(r.aplicado, 800);
  assert.equal(r.sobrante, 0);
});

test('el monto exacto de la deuda liquida todo', () => {
  const r = repartirAbono(deuda, 2000);
  assert.equal(r.partidas.length, 4);
  assert.ok(r.partidas.every((p) => p.liquidada));
});

test('más de lo que debe: aplica la deuda y reporta el sobrante', () => {
  const r = repartirAbono(deuda, 2100);
  assert.equal(r.aplicado, 2000);
  assert.equal(r.sobrante, 100);
});

test('centavos: no deja saldos fantasma', () => {
  const r = repartirAbono([{ id: 1, balance: 0.1 }, { id: 2, balance: 0.2 }], 0.3);
  assert.deepEqual(r.partidas.map((p) => p.queda), [0, 0]);
  assert.equal(r.aplicado, 0.3);
});

test('monto en cero o inválido se rechaza', () => {
  assert.throws(() => repartirAbono(deuda, 0));
  assert.throws(() => repartirAbono(deuda, 'abc'));
});

/* ---------------------------------------------------------------------------
 * MASIVAS: muchas ventas a crédito de $10 a $10,000, con centavos, y montos de
 * todo tipo. Semilla fija: si algo falla, el mismo caso vuelve a salir.
 * Cada caso se revisa contra las reglas, y la vista previa de la pantalla
 * (src/clientes/repartir-abono.ts) tiene que decir EXACTAMENTE lo mismo.
 * ------------------------------------------------------------------------- */
const { repartirVista } = await import('../../src/clientes/repartir-abono.ts');

function azar(semilla) {
  let s = semilla >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const c = (n) => Math.round(n * 100);
const entre = (r, a, b) => a + Math.floor(r() * (b - a + 1));

function ventasAlAzar(r, n) {
  return Array.from({ length: n }, (_, i) => {
    const tipo = r();
    // De todo: $10 exactos, redondos, con centavos, y los extremos.
    const centavos = tipo < 0.1 ? 1000 : tipo < 0.2 ? 1_000_000 : tipo < 0.4 ? entre(r, 10, 10000) * 100 : entre(r, 1000, 1_000_000);
    return { id: 1000 + i, balance: centavos / 100 };
  });
}

function revisar(ventas, monto) {
  const r = repartirAbono(ventas, monto);
  const deuda = ventas.reduce((s, v) => s + c(v.balance), 0);
  const esperado = Math.min(c(monto), deuda);
  // 1. Lo aplicado + lo que sobra = el monto, al centavo.
  assert.equal(c(r.aplicado), esperado, 'aplicado');
  assert.equal(c(r.aplicado) + c(r.sobrante), c(monto), 'aplicado + sobrante = monto');
  // 2. La suma de los abonos es lo aplicado.
  assert.equal(r.partidas.reduce((s, p) => s + c(p.abono), 0), esperado, 'suma de abonos');
  // 3. En orden: las partidas son un prefijo de la lista.
  r.partidas.forEach((p, i) => assert.equal(p.sale_id, ventas[i].id, 'orden'));
  // 4. Todas liquidadas menos, a lo más, la última.
  r.partidas.slice(0, -1).forEach((p) => assert.ok(p.liquidada, 'antes de la última, todas liquidadas'));
  // 5. Cada partida: abono + queda = saldo; nunca negativos; nunca abona de más.
  for (const p of r.partidas) {
    assert.equal(c(p.abono) + c(p.queda), c(p.saldo), 'abono + queda = saldo');
    assert.ok(p.abono > 0 && p.queda >= 0 && c(p.abono) <= c(p.saldo));
    assert.equal(p.liquidada, c(p.queda) === 0);
  }
  // 6. Si sobra algo, se liquidó TODO; si queda faltante, no sobra nada.
  if (r.sobrante > 0) assert.ok(r.partidas.length === ventas.length && r.partidas.every((p) => p.liquidada));
  if (r.partidas.some((p) => !p.liquidada)) assert.equal(r.sobrante, 0);
  // 7. Los centavos son centavos: ningún número con más de 2 decimales.
  for (const p of r.partidas) for (const x of [p.abono, p.queda]) assert.equal(Math.round(x * 100) / 100, x);
  // 8. La pantalla dice lo mismo que el servidor.
  const v = repartirVista(ventas, monto);
  assert.equal(c(v.aplicado), c(r.aplicado), 'vista: aplicado');
  assert.equal(c(v.sobrante), c(r.sobrante), 'vista: sobrante');
  assert.equal(v.porVenta.size, r.partidas.length, 'vista: cuántas toca');
  for (const p of r.partidas) {
    const w = v.porVenta.get(p.sale_id);
    assert.ok(w, 'vista: la misma venta');
    assert.deepEqual([c(w.abono), c(w.queda), w.liquidada], [c(p.abono), c(p.queda), p.liquidada], `vista: venta ${p.sale_id}`);
  }
  return r;
}

test('masiva: 3,000 clientes al azar, de 1 a 150 notas de $10 a $10,000', () => {
  const r = azar(20261125);
  let casos = 0, parciales = 0, exactos = 0, sobrantes = 0;
  for (let k = 0; k < 3000; k++) {
    const ventas = ventasAlAzar(r, entre(r, 1, 150));
    const deuda = ventas.reduce((s, v) => s + c(v.balance), 0);
    const montos = [
      entre(r, 1, deuda) / 100,                         // cualquier monto dentro de la deuda
      deuda / 100,                                      // toda la deuda
      (deuda - 1) / 100,                                // un centavo menos
      (deuda + entre(r, 1, 100000)) / 100,              // más de lo que debe
      0.01,                                             // un centavo
      ventas[0].balance,                                // justo la primera nota
      ventas.slice(0, entre(r, 1, ventas.length)).reduce((s, v) => s + c(v.balance), 0) / 100, // justo varias notas
    ];
    for (const m of montos) {
      const res = revisar(ventas, m);
      casos++;
      if (res.sobrante > 0) sobrantes++;
      else if (res.partidas.some((p) => !p.liquidada)) parciales++;
      else exactos++;
    }
  }
  assert.ok(casos === 21000 && parciales > 1000 && exactos > 1000 && sobrantes > 1000, JSON.stringify({ casos, parciales, exactos, sobrantes }));
});

test('masiva: monto justo en cada frontera entre notas (liquida N, no toca la N+1)', () => {
  const r = azar(7);
  for (let k = 0; k < 300; k++) {
    const ventas = ventasAlAzar(r, entre(r, 2, 60));
    let acumulado = 0;
    ventas.forEach((v, i) => {
      acumulado += c(v.balance);
      const res = revisar(ventas, acumulado / 100);
      assert.equal(res.partidas.length, i + 1);
      assert.ok(res.partidas.every((p) => p.liquidada));
      // un centavo más ya toca la siguiente, con todo su saldo menos un centavo de faltante
      if (i + 1 < ventas.length) {
        const mas = revisar(ventas, (acumulado + 1) / 100);
        assert.equal(mas.partidas.length, i + 2);
        assert.equal(c(mas.partidas.at(-1).abono), 1);
        assert.equal(c(mas.partidas.at(-1).queda), c(ventas[i + 1].balance) - 1);
      }
    });
  }
});

test('notas de $10 a $10,000 y abona $800: liquida la de $10 y abona $790 a la de $10,000', () => {
  const ventas = [10, 10000, 37.5, 1250.99, 0.01 + 99.99, 4999.5].map((b, i) => ({ id: i + 1, balance: b }));
  const r = revisar(ventas, 800);
  assert.deepEqual(r.partidas.map((p) => [p.sale_id, p.abono, p.queda]), [[1, 10, 0], [2, 790, 9210]]);
});
