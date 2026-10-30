/**
 * Lectura del archivo de la plataforma (shared/plataformas.ts, 0069).
 *
 *     node --test scripts/pruebas/plataformas.test.mjs
 *
 * Sin base y sin Electron: filas como las entrega `xlsx` y lo que sale.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { leerArchivoPlataforma, numero, fecha, depositoEsperado } from '../../shared/plataformas.ts';

/** CSV mínimo (comillas dobles, comas dentro): lo que haría xlsx con raw. */
function csv(texto) {
  return texto.replace(/\r/g, '').split('\n').filter(Boolean).map((l) => {
    const out = []; let cur = '', q = false;
    for (const ch of l) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  });
}

test('el reporte de pedidos de Uber Eats (con título arriba y fila de totales)', () => {
  const filas = csv(readFileSync(new URL('../../e2e/fixtures-archivos/uber-pedidos-ejemplo.csv', import.meta.url), 'utf8'));
  const r = leerArchivoPlataforma(filas);
  assert.equal(r.pedidos.length, 6);
  assert.equal(r.columnas.id, 'ID del pedido');
  assert.equal(r.columnas.base, 'Ventas (sin impuestos)');
  assert.equal(r.columnas.neto, 'Ventas netas');
  const p = r.pedidos[0];
  assert.equal(p.id, '9a3f1c2e-1111-4a0b-9c3d-000000000001');
  assert.equal(p.at, '2026-10-19T13:05:00');
  assert.equal(p.total, 232);
  assert.equal(p.net, 150.8);
  assert.equal(p.fulfillment, 'Entrega');
  assert.equal(r.pedidos.find((x) => x.id.startsWith('e6')).cancelled, true);
  assert.equal(r.pedidos.filter((x) => x.cancelled).length, 1);
  assert.equal(r.desde, '2026-10-19');
  assert.equal(r.hasta, '2026-10-25');   // el del título, aunque el 25 no tenga pedidos
  assert.equal(r.ventas, 232 + 116 + 348 + 174 + 116);   // sin el cancelado
});

test('encabezados en inglés, fecha de Excel y total con IVA', () => {
  const r = leerArchivoPlataforma([
    ['Order ID', 'Order Date', 'Order Status', 'Sales (incl. tax)', 'Net Payout'],
    ['ABC-1', 46315.5, 'Completed', 116, 80.5],
    ['ABC-2', '2026-10-20 09:15', 'Rejected', '(116.00)', 0],
  ]);
  assert.equal(r.pedidos[0].at, '2026-10-20T12:00:00');
  assert.equal(r.pedidos[0].total, 116);
  assert.equal(r.pedidos[1].cancelled, true);
  assert.equal(r.pedidos[1].total, -116);
  assert.equal(r.pedidos[1].at, '2026-10-20T09:15:00');
});

test('un pedido en varias filas (ajustes) se suma', () => {
  const r = leerArchivoPlataforma([
    ['ID del pedido', 'Fecha', 'Ventas con IVA'],
    ['X1', '01/10/2026', '100.00'],
    ['X1', '01/10/2026', '16.00'],
  ]);
  assert.equal(r.pedidos.length, 1);
  assert.equal(r.pedidos[0].total, 116);
});

test('sin columnas de pedido y venta, avisa en vez de inventar', () => {
  assert.throws(() => leerArchivoPlataforma([['Nombre', 'Teléfono'], ['Ana', '33']]), /No reconocí el archivo/);
  const r = leerArchivoPlataforma([['ID del pedido', 'Ventas netas'], ['Y1', '75.40']]);
  assert.ok(r.avisos.some((a) => /fecha/.test(a)));
  assert.ok(r.avisos.some((a) => /netas/.test(a)));
});

test('números y fechas como los escriben las plataformas', () => {
  assert.equal(numero('$1,234.50'), 1234.5);
  assert.equal(numero('MX$ 1.234,50'), 1234.5);
  assert.equal(numero('-$12.00'), -12);
  assert.equal(numero('(306,121.35)'), -306121.35);
  assert.equal(numero('12,5'), 12.5);
  assert.equal(numero('-'), null);
  assert.equal(fecha('03/02/2025'), '2025-02-03T00:00:00');           // día/mes/año
  assert.equal(fecha('3 feb 2025 2:05 PM'), '2025-02-03T14:05:00');
  assert.equal(fecha('31/02/2025'), null);
  assert.equal(fecha('2025-02-03', '0:10'), '2025-02-03T00:10:00');
});

test('depósito esperado: ejemplo de un año de Uber Eats', () => {
  // Ventas brutas 890,276.00 − marketing 306,121.35 − tasas 234,237.72 − modificaciones 55,020.41.
  assert.equal(depositoEsperado({ gross_sales: 890276, marketing: 306121.35, service_fees: 234237.72, refunds: 55020.41,
    isr_withheld: 0, iva_withheld: 0, other_adjustments: 0 }), 294896.52);
});
