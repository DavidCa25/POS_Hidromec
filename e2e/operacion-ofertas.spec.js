const { test, expect, CUENTAS, irPorMas, irPorDock } = require("./fixtures");
const rows = (r) => (Array.isArray(r) ? r : (r?.data ?? r?.recordset ?? []));
async function login(app, c) {
  const p = app.ventana;
  await p.fill("#username", c.usuario);
  await p.fill("#password", c.password);
  await p.click("#btnLogin");
  await expect
    .poll(async () => {
      try {
        return (await app.invocar("sesion"))?.data?.usuario;
      } catch {
        return null;
      }
    })
    .toBe(c.usuario);
}
async function seed(app, displayNames = false) {
  let categories = rows(await app.invocar("getCategories"));
  if (!categories.length) {
    await app.invocar("createCategory", { nombre: "QA Comercial" });
    categories = rows(await app.invocar("getCategories"));
  }
  let brands = rows(await app.invocar("getBrands"));
  if (!brands.length) {
    await app.invocar("createBrand", { nombre: "QA Comercial" });
    brands = rows(await app.invocar("getBrands"));
  }
  const n = Date.now().toString().slice(-6);
  for (const [code, name, price] of [
    ["D", "Dona", 25],
    ["C", "Café", 35],
  ]) {
    const r = await app.invocar(
      "agregarProducto",
      Number(brands[0].id),
      Number(categories[0].id),
      "COM-" + code + n,
      displayNames
        ? code === "D"
          ? "Dona glaseada"
          : "Café americano"
        : name + " comercial " + n,
      price,
      100,
      null,
      null,
      "02",
      0.16,
      null,
      { inventory_mode: "DIRECT", sellable: 1, base_uom: "pza" },
    );
    expect(r?.success ?? true, JSON.stringify(r)).toBeTruthy();
  }
  const data = (await app.invocar("commercialCatalog")).data;
  const dona = data.catalog.products.find(
      (p) =>
        p.nombre === (displayNames ? "Dona glaseada" : "Dona comercial " + n),
    ),
    cafe = data.catalog.products.find(
      (p) =>
        p.nombre === (displayNames ? "Café americano" : "Café comercial " + n),
    );
  return { data, dona, cafe, n };
}

test("Touch: mayoreo, quitar una pieza, pago dividido y acciones posventa reales", async ({
  app,
}) => {
  test.setTimeout(180000);
  await login(app, CUENTAS.admin);
  const { data, dona, n } = await seed(app),
    p = app.ventana;
  data.policy.promotions = [
    {
      id: "MAYOREO_QA",
      name: "Mayoreo QA",
      kind: "VOLUME",
      active: true,
      priority: 1,
      minimumQty: 3,
      mixProducts: true,
      value: "20.00",
      selector: { products: [dona.uuid] },
      channels: ["LOCAL"],
    },
  ];
  data.policy.combos = [];
  expect(
    (
      await app.invocar("commercialSave", {
        version: data.policy.version,
        policy: data.policy,
      })
    ).success,
  ).toBe(true);
  await app.invocar("setDeviceConfig", {
    deviceProfile: "TOUCH_POS",
    printer: { ticketPrinterName: "WYBIX IMPRESORA QA INEXISTENTE" },
  });
  await p.locator(".wx-yo__btn").click();
  await p.locator(".wx-yo__fila").filter({ hasText: "Cerrar sesión" }).click();
  await p.waitForSelector("#username");
  await login(app, CUENTAS.admin);
  await p.setViewportSize({ width: 1280, height: 800 });
  await p.waitForSelector("app-touch-pos .tp-card");
  const turn = p
    .getByRole("dialog")
    .filter({
      has: p.getByRole("heading", { name: "Abrir turno", exact: true }),
    });
  if (await turn.count())
    await turn
      .getByRole("button", { name: "Abrir turno", exact: true })
      .click();
  const card = p.locator(".tp-card").filter({ hasText: "Dona comercial " + n });
  await card.click();
  await expect(p.locator(".cs-volume")).toContainText("Faltan 2 piezas");
  await card.click();
  await card.click();
  await expect(p.locator(".tp-cart__total")).toContainText("$60.00");
  await expect(p.locator(".cs-volume")).toContainText("Mayoreo aplicado");
  await p
    .getByRole("button", {
      name: "Quitar uno de Dona comercial " + n,
      exact: true,
    })
    .click();
  await expect(p.locator(".tp-cart__total")).toContainText("$50.00");
  await card.click();
  await expect(p.locator(".tp-cart__total")).toContainText("$60.00");
  await p.getByRole("button", { name: "Ofertas de hoy y mayoreo" }).click();
  await expect(p.locator(".tp-ofertas")).toContainText("Mayoreo QA");
  await p
    .locator(".tp-ofertas")
    .getByRole("button", { name: "Cerrar ofertas" })
    .click();
  await p.locator("[data-guide=touch-cobrar]").click();
  await p.getByRole("button", { name: "Dividir pago", exact: true }).click();
  const key = async (v) => {
    for (const k of v)
      await p
        .locator(".tp-num")
        .getByRole("button", { name: k, exact: true })
        .click();
  };
  await key("20");
  await p
    .locator(".tp-dinero")
    .getByRole("button", { name: /Recibido/ })
    .click();
  await key("50");
  await p
    .locator(".tp-metodos")
    .getByRole("button", { name: "Tarjeta", exact: true })
    .click();
  await expect(p.locator(".tp-pagos")).toContainText("$40.00");
  await expect(p.locator(".tp-pagos")).toContainText("$30.00");
  const before = new Set(rows(await app.invocar("getSales")).map((x) => x.id));
  await p.screenshot({
    path: "docs/evidencia/comercial-20261007/cobro-mixto-touch.png",
    fullPage: true,
  });
  await p.locator("[data-guide=touch-cobro-confirmar]").click();
  await expect(p.locator('.tp-exito, .tp-aviso:not(.ok)')).toBeVisible();
  expect(await p.locator('.tp-aviso:not(.ok)').allTextContents()).toEqual([]);
  await expect(p.locator(".tp-exito")).toBeVisible();
  const sale = rows(await app.invocar("getSales")).find(
    (x) => !before.has(x.id),
  );
  expect(Number(sale.total)).toBe(60);
  expect(sale.payment_method).toBe("MIXTO");
  const ticket = await app.invocar("ticketPreview", {
    id: sale.id,
    document: "sale",
  });
  expect(ticket.success, JSON.stringify(ticket)).toBe(true);
  expect(ticket.data.html).toContain("$20.00");
  expect(ticket.data.html).toContain("$40.00");
  await p
    .locator(".tp-exito")
    .getByRole("button", { name: "Ver ticket", exact: true })
    .click();
  await expect(p.locator("app-receipt-viewer dialog")).toBeVisible();
  await p
    .locator("app-receipt-viewer")
    .getByRole("button", { name: "Cerrar", exact: true })
    .click();
  await p
    .locator(".tp-exito")
    .getByRole("button", { name: "Correo", exact: true })
    .click();
  await expect(p.locator("app-receipt-email dialog")).toBeVisible();
  await p
    .locator("app-receipt-email")
    .getByRole("button", { name: "Cerrar", exact: true })
    .click();
  await p
    .locator(".tp-exito")
    .getByRole("button", { name: "Facturar", exact: true })
    .click();
  await expect(p.locator("app-factura-nueva")).toContainText(
    "Desde la venta #" + sale.id,
  );
  // La descripción del concepto es un campo editable: se lee su valor.
  await expect(
    p.locator("app-factura-nueva input.c-desc").first(),
  ).toHaveValue(new RegExp("Dona comercial " + n));
  await p.locator(".fn-close").click();
  await expect(p.locator(".tp-exito")).toBeVisible();
  await p
    .locator(".tp-exito")
    .getByRole("button", { name: "Listo", exact: true })
    .click();
});
test("Editor de ticket: campos, papel de 70 mm, visor antes/después de guardar y corte histórico", async ({
  app,
}) => {
  await login(app, CUENTAS.admin);
  const p = app.ventana;
  await irPorMas(p, "Configuracion");
  await p.getByRole("button", { name: /Tickets y cortes/ }).click();
  const panel = p.locator("app-ticket-panel");
  await expect(panel).toBeVisible();
  await panel.locator("wx-select").first().getByRole("combobox").click();
  await panel
    .getByRole("option", { name: "Corte de caja", exact: true })
    .click();
  await panel.getByLabel("Ancho · mm", { exact: true }).fill("70");
  await panel.getByLabel("Arqueo y diferencia", { exact: true }).check();
  await expect
    .poll(async () => await panel.locator("iframe").getAttribute("srcdoc"))
    .toContain("Efectivo esperado");
  await panel
    .getByRole("button", { name: "Guardar configuración", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText(
    "Configuración guardada",
  );
  const cfg = (await app.invocar("getDeviceConfig")).data;
  expect(cfg.printer.documents.closure.width).toBe(70);
  expect(cfg.printer.documents.closure.fields).toContain("declaration");
  await p.screenshot({
    path: "docs/evidencia/comercial-20261007/editor-comprobantes.png",
    fullPage: true,
  });
  const shift = (await app.invocar("getOpenShift", { register_id: 1 })).data;
  if (shift?.id) {
    expect(
      (
        await app.invocar("closeShift", {
          closure_id: shift.id,
          register_id: 1,
          cash_delivered: 0,
        })
      ).success,
    ).toBe(true);
    const result = await app.invocar("ticketPreview", {
      document: "closure",
      id: shift.id,
    });
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.data.html).toContain("CERRADO");
    expect(result.data.profile.width).toBe(70);
    expect(
      (await app.invocar("ticketClosures", { registerId: 1 })).data.some(
        (x) => x.id === shift.id,
      ),
    ).toBe(true);
  }
});
