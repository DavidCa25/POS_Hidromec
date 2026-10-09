import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { restaurar, eliminar } from "../lib/temporal.mjs";
import { consultarTemporal, enParalelo } from "../lib/temporal-consulta.mjs";
const DB = "Wybix_TmpPagosTickets";
const q = (s) => {
  const r = consultarTemporal(DB, s);
  if (!r.ok) throw Error(r.error);
  return r.sets[0] ?? [];
};
try {
  restaurar(DB, "installer/template.bak");
  for (let i = 0; i < 2; i++)
    for (const b of readFileSync(
      "electron/migrations/0054_pagos-mixtos.sql",
      "utf8",
    ).split(/^\s*GO\s*$/im))
      if (b.trim()) q(b);
  q(
    "INSERT dbo.users(usuario,password_hash,rol,active,creation_date) VALUES(N'qa-pagos',N'x',N'admin',1,GETDATE());INSERT dbo.CAT_brands(namee) VALUES(N'QA pagos');INSERT dbo.CAT_categories(namee) VALUES(N'QA pagos');",
  );
  const user = q("SELECT id FROM dbo.users WHERE usuario=N'qa-pagos'")[0].id,
    brand = q("SELECT id FROM dbo.CAT_brands WHERE namee=N'QA pagos'")[0].id,
    category = q("SELECT id FROM dbo.CAT_categories WHERE namee=N'QA pagos'")[0]
      .id;
  const product = q(
    `EXEC dbo.sp_add_product @brand=${brand},@part_number=N'QA-PAY',@name=N'Producto QA',@price=59,@stock=100,@category=${category},@cost=5`,
  )[0].id;
  const closure = q(
    `EXEC dbo.sp_open_shift @user_id=${user},@opening_cash=200,@register_id=1;`,
  )[0].closure_id;
  const key = "90000000-0000-4000-8000-000000000001";
  const payments = JSON.stringify([
    { method: "EFECTIVO", amount: 30, received: 50 },
    { method: "TARJETA", amount: 29 },
  ]);
  const sell = (pay = payments, k = key, hash = "same") =>
    `DECLARE @a dbo.SaleDetailType,@b dbo.SaleDetailType2,@m dbo.SaleModifierType;INSERT @b VALUES(1,${product},1,59,NULL);EXEC dbo.sp_register_sale @user_id=${user},@payment_method=N'MIXTO',@register_id=1,@SaleDetails=@a,@SaleDetails2=@b,@SaleModifiers=@m,@payments_json=N'${pay}',@client_sale_key='${k}',@client_sale_hash='${hash}';`;
  assert.equal(
    consultarTemporal(
      DB,
      sell(
        JSON.stringify([{ method: "TARJETA", amount: 58 }]),
        "90000000-0000-4000-8000-000000000002",
      ),
    ).ok,
    false,
  );
  assert.equal(
    Number(q(`SELECT stock FROM dbo.products WHERE id=${product}`)[0].stock),
    100,
    "el fallo no descuenta inventario",
  );
  const raced = await enParalelo(DB, [sell(), sell()]);
  assert.ok(raced.every((r) => r.ok));
  const id = raced[0].sets[0][0].sale_id;
  assert.equal(
    raced[1].sets[0][0].sale_id,
    id,
    "dos intentos concurrentes guardan un solo folio",
  );
  assert.equal(
    Number(q(`SELECT stock FROM dbo.products WHERE id=${product}`)[0].stock),
    99,
  );
  assert.equal(
    Number(
      q(
        `SELECT SUM(amount) amount FROM dbo.cash_movements WHERE typee='SALE' AND reference_id=${id}`,
      )[0].amount,
    ),
    30,
  );
  assert.equal(
    q(`SELECT * FROM dbo.sale_payments WHERE sale_id=${id}`).length,
    2,
  );
  assert.equal(
    consultarTemporal(DB, sell(payments, key, "different")).ok,
    false,
    "una clave no cambia el cobro",
  );
  q(`UPDATE dbo.products SET tasa_iva=0 WHERE id=${product}`);
  const ticket = consultarTemporal(
    DB,
    `EXEC dbo.sp_get_sale_ticket @sale_id=${id}`,
  );
  assert.ok(ticket.ok);
  assert.equal(JSON.parse(ticket.sets[0][0].payments_json).length, 2);
  assert.equal(
    Number(ticket.sets[1][0].tasa_iva),
    0.16,
    "el impuesto vendido permanece al editar el catálogo",
  );
  const refund = q(
    `DECLARE @d dbo.SaleDetailType;INSERT @d VALUES(${product},1,59);EXEC dbo.sp_refund_sale @sale_id=${id},@user_id=${user},@payment_method=N'EFECTIVO',@RefundDetails=@d,@register_id=1,@apply_net_update=0;`,
  )[0];
  assert.equal(
    q(`SELECT * FROM dbo.refund_payments WHERE refund_id=${refund.refund_id}`)
      .length,
    2,
  );
  assert.equal(
    Number(
      q(
        `SELECT SUM(amount) amount FROM dbo.cash_movements WHERE typee='REFUND' AND reference_id=${id}`,
      )[0].amount,
    ),
    -30,
  );
  assert.equal(
    Number(q(`SELECT stock FROM dbo.products WHERE id=${product}`)[0].stock),
    100,
  );
  const sale2 = q(sell(payments, "90000000-0000-4000-8000-000000000003"))[0];
  q(
    `EXEC dbo.sp_close_shift @closure_id=${closure},@register_id=1,@user_id=${user},@cash_delivered=230;`,
  );
  const snapshot = q(
    `EXEC dbo.sp_cash_closure_ticket @closure_id=${closure}`,
  )[0].document_json;
  assert.equal(JSON.parse(snapshot).cash_expected, 230);
  assert.equal(
    JSON.parse(snapshot).tickets,
    2,
    "corte incluye la venta inmediatamente posterior a la apertura",
  );
  assert.equal(JSON.parse(snapshot).total, 118);
  q(`UPDATE dbo.sales SET total=999 WHERE id=${sale2.sale_id}`);
  assert.equal(
    q(`EXEC dbo.sp_cash_closure_ticket @closure_id=${closure}`)[0]
      .document_json,
    snapshot,
    "reimprimir conserva el cierre confirmado",
  );
  console.log(
    "PAGOS_COMPROBANTES_SQL_OK: migración dos veces, venta concurrente, stock, cajón, devolución dividida, impuesto y corte congelados",
  );
} finally {
  eliminar(DB);
}
