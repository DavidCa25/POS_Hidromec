import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { validarPagos } from "../../shared/pagos.ts";
const require = createRequire(import.meta.url);
const { perfil, venta, corte } = require("../../electron/lib/comprobante");
const extras = {
  plantilla: readFileSync("electron/templates/ticket.html", "utf8"),
  negocio: { business_name: "Negocio <QA>", ticket_footer: "Gracias" },
};
test("un solo folio, porción de efectivo y cambio independiente de tarjeta", () => {
  assert.deepEqual(
    validarPagos(59, [
      { method: "EFECTIVO", amount: 30, received: 50 },
      { method: "TARJETA", amount: 29 },
    ]),
    { total: 59, cash: 30, received: 50, change: 20 },
  );
});
test("centavos exactos, faltantes, sobrantes, duplicados, negativo y precisión", () => {
  assert.equal(
    validarPagos(0.3, [
      { method: "TARJETA", amount: 0.1 },
      { method: "TRANSFERENCIA", amount: 0.2 },
    ]).total,
    0.3,
  );
  for (const p of [
    [{ method: "TARJETA", amount: 58 }],
    [{ method: "TARJETA", amount: 60 }],
    [
      { method: "TARJETA", amount: 30 },
      { method: "TARJETA", amount: 29 },
    ],
    [{ method: "EFECTIVO", amount: 59, received: 50 }],
    [{ method: "TARJETA", amount: -1 }],
    [{ method: "TARJETA", amount: 59.001 }],
  ])
    assert.throws(() => validarPagos(59, p));
});
test("papeles no limitados a 58/80 y validación de medidas", () => {
  for (const width of [58, 70, 76, 80, 112, 210])
    assert.equal(perfil({ width }).width, width);
  assert.equal(
    perfil({ format: "sheet", width: 210, height: 297 }).height,
    297,
  );
  for (const x of [
    { width: 10 },
    { format: "label", height: 0 },
    { margin: 41 },
    { fields: ["arbitrary"] },
    { fields: ["tax", "tax"] },
  ])
    assert.throws(() => perfil(x));
});
test("misma composición del visor/impresión, campos selectivos y escape", () => {
  const html = venta(
    {
      id: 1,
      payment_method: "MIXTO",
      payments_json: JSON.stringify([
        { payment_method: "EFECTIVO", amount: 30, received: 50 },
        { payment_method: "TARJETA", amount: 29 },
      ]),
    },
    [{ nombre: "Dona", quantity: 1, unitary_price: 59 }],
    extras,
    { width: 70 },
  );
  assert.ok(html.includes("70mm"));
  assert.ok(html.includes("$20.00"));
  assert.ok(html.includes("Negocio &lt;QA&gt;"));
  const minimal = venta(
    { id: 1 },
    [{ nombre: "Producto no mostrado", quantity: 1, unitary_price: 59 }],
    extras,
    { fields: [] },
  );
  assert.ok(!minimal.includes("Producto no mostrado"));
  assert.ok(!minimal.includes('class="items"'));
  assert.ok(minimal.includes("$59.00"));
  assert.ok(minimal.includes("TOTAL"));
});
test("corte simple por defecto, campos y orden configurables sin alterar total", () => {
  const d = {
    id: 1,
    closed_at: "hoy",
    opened_at: "ayer",
    tickets: 3,
    total: 59,
    cash_expected: 30,
    cash_delivered: 35,
    difference: 5,
    payments: [
      { payment_method: "EFECTIVO", amount: 30 },
      { payment_method: "TARJETA", amount: 29 },
    ],
  };
  const basic = corte(d, {}, {});
  assert.ok(basic.includes("3 tickets"));
  assert.ok(!basic.includes("Efectivo esperado"));
  const configured = corte(
    d,
    { fields: ["declaration", "sales", "payments"] },
    {},
  );
  assert.ok(
    configured.indexOf("Efectivo esperado") <
      configured.indexOf("TOTAL VENDIDO"),
  );
  assert.ok(configured.includes("$5.00"));
  assert.ok(configured.includes("$29.00"));
});
