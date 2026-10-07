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
test("canal y promoción por la pantalla: cobrar, stock y no duplicar", async ({
  app,
}) => {
  test.setTimeout(180000);
  await login(app, CUENTAS.admin);
  const { data, dona, n } = await seed(app);
  const p = app.ventana;
  const beforeIds = new Set(
    rows(await app.invocar("getSales")).map((x) => x.id),
  );
  const policy = data.policy;
  policy.channels = policy.channels.filter((c) => c.id !== "UBER");
  policy.prices = policy.prices.filter((x) => x.channel !== "UBER");
  policy.promotions = policy.promotions.filter((x) => x.id !== "QA2x1");
  policy.channels.push({
    id: "UBER",
    name: "Uber Eats QA",
    active: true,
    inheritBase: false,
  });
  policy.prices.push({ channel: "UBER", product: dona.uuid, price: "32.00" });
  policy.promotions.push({
    id: "QA2x1",
    name: "Donas QA 2x1",
    active: true,
    priority: 1,
    kind: "BUY_PAY",
    selector: { products: [dona.uuid] },
    channels: ["LOCAL"],
    buy: 2,
    pay: 1,
  });
  expect(
    (await app.invocar("commercialSave", { version: policy.version, policy }))
      .success,
  ).toBeTruthy();
  await irPorDock(p, "Venta");
  await p.waitForSelector(".pos-wrap");
  const shift = p.locator(".open-shift-modal");
  if (await shift.count()) {
    await shift.locator("input[type=number]").fill("100");
    await shift.getByRole("button", { name: /Abrir turno/ }).click();
    await p
      .locator(".swal2-popup")
      .getByRole("button", { name: "OK", exact: true })
      .click();
  }
  await p
    .locator("app-commercial-sale wx-select")
    .first()
    .getByRole("combobox")
    .click();
  await p
    .locator("app-commercial-sale")
    .getByRole("option", { name: "Uber Eats QA", exact: true })
    .click();
  await p.getByRole("button", { name: /Agregar producto/ }).click();
  await p
    .locator(".modal-productos .prod-item")
    .filter({ hasText: "Dona comercial " + n })
    .click();
  await expect(p.locator(".modal-productos")).toHaveCount(0);
  await expect(p.locator("app-commercial-sale")).toContainText(
    "Uber Eats QA · Ahorro",
  );
  await p.keyboard.press("F8");
  await expect(p.locator(".total-amount")).toContainText("32.00");
  await p.getByRole("button", { name: /Pagado en plataforma/ }).click();
  await p.locator("[data-guide=venta-confirmar-cobro]").click();
  await expect
    .poll(
      async () =>
        rows(await app.invocar("getSales")).filter(
          (s) => !beforeIds.has(s.id) && Number(s.total) === 32,
        ).length,
    )
    .toBe(1);
  await p.getByRole("button", { name: "Nada más, cerrar" }).click();
  const updated = rows(await app.invocar("getActiveProducts")).find(
    (p) => p.product_name === "Dona comercial " + n,
  );
  expect(Number(updated.stock)).toBe(99);
  // Otra cuenta no hereda el canal. El mismo SKU recibe 2x1 y consume dos.
  await expect(
    p.locator("app-commercial-sale wx-select").first().getByRole("combobox"),
  ).toContainText("Mostrador");
  for (let i = 0; i < 2; i++) {
    await p.getByRole("button", { name: /Agregar producto/ }).click();
    await p
      .locator(".modal-productos .prod-item")
      .filter({ hasText: "Dona comercial " + n })
      .click();
    await expect(p.locator(".modal-productos")).toHaveCount(0);
  }
  await expect(p.locator("app-commercial-sale")).toContainText("25.00");
  await p.keyboard.press("F8");
  await expect(p.locator(".total-amount")).toContainText("25.00");
  await p.locator(".pay-pill").filter({ hasText: "Tarjeta" }).click();
  await p.locator("[data-guide=venta-recibido]").fill("25");
  await p.locator("[data-guide=venta-confirmar-cobro]").click();
  await expect
    .poll(
      async () =>
        rows(await app.invocar("getSales")).filter(
          (s) => !beforeIds.has(s.id) && Number(s.total) === 25,
        ).length,
    )
    .toBe(1);
  expect(
    Number(
      rows(await app.invocar("getActiveProducts")).find(
        (p) => p.product_name === "Dona comercial " + n,
      ).stock,
    ),
  ).toBe(97);
});
test("cajera no publica reglas ni fuerza elegibilidad de descuentos", async ({
  app,
}) => {
  await login(app, CUENTAS.operador);
  expect(
    (await app.invocar("commercialSave", { version: 0, policy: {} })).success,
  ).toBeFalsy();
  const r = await app.invocar("commercialQuote", {
    version: 0,
    channel: "LOCAL",
    lines: [],
    audiences: ["ESTUDIANTE"],
  });
  expect(r.success).toBeFalsy();
  expect(r.error).toContain("supervisor");
});

test("combo real: elegir componentes, cobrar 59 y devolver sin usar precio normal", async ({
  app,
}) => {
  test.setTimeout(180000);
  await login(app, CUENTAS.admin);
  const { data, dona, cafe, n } = await seed(app),
    p = app.ventana;
  const before = new Set(rows(await app.invocar("getSales")).map((x) => x.id));
  data.policy.combos = data.policy.combos.filter((x) => x.id !== "QA_MENU");
  data.policy.combos.push({
    id: "QA_MENU",
    name: "Dona y café QA",
    active: true,
    price: "59.00",
    channels: ["LOCAL"],
    groups: [
      {
        id: "d",
        name: "Dona",
        quantity: 1,
        selector: { products: [dona.uuid] },
      },
      {
        id: "c",
        name: "Café",
        quantity: 1,
        selector: { products: [cafe.uuid] },
      },
    ],
  });
  expect(
    (
      await app.invocar("commercialSave", {
        version: data.policy.version,
        policy: data.policy,
      })
    ).success,
  ).toBeTruthy();
  await irPorDock(p, "Venta");
  await p.waitForSelector(".pos-wrap");
  const shift = p.locator(".open-shift-modal");
  if (await shift.count()) {
    await shift.locator("input[type=number]").fill("100");
    await shift.getByRole("button", { name: /Abrir turno/ }).click();
    await p
      .locator(".swal2-popup")
      .getByRole("button", { name: "OK", exact: true })
      .click();
  }
  const addCombo = p
    .locator("app-commercial-sale")
    .getByRole("button", { name: "Agregar combo", exact: true });
  await addCombo.click();
  await p.keyboard.press("Escape");
  await expect(p.locator(".cs-panel")).toHaveCount(0);
  await expect(addCombo).toBeFocused();
  await addCombo.click();
  const picker = p.locator(".cs-panel");
  await picker.locator("wx-select").nth(0).getByRole("combobox").click();
  await picker.getByRole("option", { name: /Dona y café QA/ }).click();
  for (const [index, product] of [dona, cafe].entries()) {
    await picker
      .locator("wx-select")
      .nth(index + 1)
      .getByRole("combobox")
      .click();
    await picker
      .getByRole("option", { name: product.nombre, exact: true })
      .click();
  }
  await p
    .locator(".cs-panel")
    .getByRole("button", { name: "Agregar combo", exact: true })
    .click();
  await expect(p.locator("#total-venta")).toContainText("59.00");
  await p.screenshot({
    path: "docs/evidencia/comercial-20261007/combo-venta.png",
  });
  await expect(p.locator("[data-guide=venta-linea]")).toHaveCount(2);
  await expect(p.locator("[data-guide=venta-linea]").first()).toContainText(
    "Dona y café QA",
  );
  await p.keyboard.press("F8");
  await p.getByRole("button", { name: /Pagado en plataforma/ }).click();
  await p.locator("[data-guide=venta-confirmar-cobro]").click();
  await expect
    .poll(
      async () =>
        rows(await app.invocar("getSales")).filter(
          (x) => !before.has(x.id) && Number(x.total) === 59,
        ).length,
    )
    .toBe(1);
  const sale = rows(await app.invocar("getSales")).find(
    (x) => !before.has(x.id) && Number(x.total) === 59,
  );
  await p.getByRole("button", { name: "Nada más, cerrar" }).click();
  const ids = data.ids;
  let refunded = 0;
  for (const product of [dona, cafe]) {
    const r = await app.invocar("refundSale", {
      sale_id: sale.id,
      payment_method: "PLATAFORMA",
      items: [
        { productId: ids.find((x) => x.uuid === product.uuid).id, qty: 1 },
      ],
    });
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    refunded += Number(rows(r)[0].refund_total);
  }
  expect(Number(refunded.toFixed(2))).toBe(59);
  const stock = rows(await app.invocar("getActiveProducts"));
  for (const name of ["Dona comercial " + n, "Café comercial " + n])
    expect(Number(stock.find((x) => x.product_name === name).stock)).toBe(100);
});

test("Inventario: crear 2x1 con componentes Wybix y previsualizar sin mover existencias", async ({
  app,
}) => {
  test.setTimeout(180000);
  await login(app, CUENTAS.admin);
  const { dona, n } = await seed(app),
    p = app.ventana;
  const before = rows(await app.invocar("getSales")).length;
  await irPorMas(p, "Configuracion");
  await expect(
    p
      .locator("app-config-shell")
      .getByRole("button", { name: /Precios, promociones y combos/ }),
  ).toHaveCount(0);
  await irPorDock(p, "Inventario", "Promociones y combos");
  const panel = p.locator("app-commercial-panel");
  await expect(
    panel.getByRole("heading", { name: "Promociones y combos", exact: true }),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "Nueva oferta", exact: true })
    .click();
  await panel
    .getByRole("menuitem", { name: "Crear promoción", exact: true })
    .click();
  const editor = panel.locator("dialog.offer-dialog");
  await expect(editor).toBeVisible();
  await editor
    .getByLabel("Nombre de la oferta", { exact: true })
    .fill("2x1 desde interfaz " + n);
  await editor.locator("wx-select").first().getByRole("combobox").click();
  await editor.getByRole("option", { name: /Compra N \/ paga M/ }).click();
  await editor.getByLabel("Oferta activa", { exact: true }).check();
  await editor
    .locator(".editor-steps")
    .getByRole("button", { name: /Productos/ })
    .click();
  await editor
    .getByRole("button", { name: "Productos elegibles", exact: true })
    .click();
  const multi = editor.locator("wx-multi-select").first();
  await multi.getByRole("searchbox").fill("Dona comercial " + n);
  await multi
    .getByRole("checkbox", {
      name: "Dona comercial " + n + " $25.00",
      exact: true,
    })
    .check();
  await p.keyboard.press("Escape");
  await expect(editor).toBeVisible();
  await expect(
    multi.getByRole("button", { name: "Productos elegibles", exact: true }),
  ).toBeFocused();
  await editor
    .getByRole("button", { name: "Guardar oferta", exact: true })
    .click();
  await expect(editor).not.toBeVisible();
  await expect(panel.getByRole("status")).toContainText("Cambios guardados");
  const published = (await app.invocar("commercialCatalog")).data.policy;
  expect(
    published.promotions.find((x) => x.name === "2x1 desde interfaz " + n)?.buy,
  ).toBe(2);
  await expect(panel.locator(".preview-total")).toContainText("$25.00");
  await expect(panel.locator(".preview-discount")).toContainText("−$25.00");
  await expect(panel.locator(".preview-product")).toHaveCount(1);
  await expect(panel.locator("select")).toHaveCount(0);
  const typography = await panel
    .locator(".rule-mark strong")
    .first()
    .evaluate((el) => ({
      family: getComputedStyle(el).fontFamily,
      style: getComputedStyle(el).fontStyle,
    }));
  expect(typography.family).toContain("Geist");
  expect(typography.style).toBe("normal");
  expect(rows(await app.invocar("getSales")).length).toBe(before);
  expect(
    Number(
      rows(await app.invocar("getActiveProducts")).find(
        (x) => x.product_name === "Dona comercial " + n,
      ).stock,
    ),
  ).toBe(100);
  await p.screenshot({
    path: "docs/evidencia/comercial-20261007/ofertas-interfaz-real.png",
  });
  // Escape cancela el borrador sin publicar el nuevo nombre.
  await panel
    .getByRole("button", { name: "Editar oferta", exact: true })
    .click();
  await editor
    .getByLabel("Nombre de la oferta", { exact: true })
    .fill("NO GUARDAR");
  await p.keyboard.press("Escape");
  await expect(editor).not.toBeVisible();
  expect(
    (await app.invocar("commercialCatalog")).data.policy.promotions.some(
      (x) => x.name === "NO GUARDAR",
    ),
  ).toBeFalsy();
  await p.setViewportSize({ width: 768, height: 1024 });
  await expect(panel.locator(".preview-total")).toBeVisible();
  expect(
    await panel.evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBeTruthy();
  await p.screenshot({
    path: "docs/evidencia/comercial-20261007/ofertas-tablet-real.png",
    fullPage: true,
  });
  await p.setViewportSize({ width: 1440, height: 900 });
  await irPorDock(p, "Inventario", "Precios por canal");
  await expect(
    panel.getByRole("heading", { name: "Precios por canal", exact: true }),
  ).toBeVisible();
});

test("Inventario: publicar canal y precio con el mismo SKU", async ({
  app,
}) => {
  await login(app, CUENTAS.admin);
  const { dona, n } = await seed(app),
    p = app.ventana;
  await irPorDock(p, "Inventario", "Precios por canal");
  const panel = p.locator("app-commercial-panel");
  await panel
    .getByRole("link", { name: "Administrar canales", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Agregar canal", exact: true })
    .click();
  await panel
    .locator(".channel-row")
    .last()
    .getByRole("textbox")
    .fill("Plataforma " + n);
  await panel
    .getByRole("button", { name: "Guardar cambios", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText("Cambios guardados");
  await panel
    .getByRole("link", { name: "Volver a precios", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Agregar precio", exact: true })
    .click();
  const row = panel.locator(".price-row").last();
  await row.locator("wx-select").nth(0).getByRole("combobox").click();
  await row
    .getByRole("option", { name: "Plataforma " + n, exact: true })
    .click();
  await row.locator("wx-select").nth(1).getByRole("combobox").click();
  await row
    .getByRole("option", {
      name: "Dona comercial " + n + " $25.00",
      exact: true,
    })
    .click();
  await row.getByLabel("Precio base", { exact: true }).fill("32");
  await panel
    .getByRole("button", { name: "Guardar cambios", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText("Cambios guardados");
  const data = (await app.invocar("commercialCatalog")).data,
    channel = data.policy.channels.find((c) => c.name === "Plataforma " + n);
  expect(
    data.policy.prices.find(
      (x) => x.channel === channel.id && x.product === dona.uuid,
    )?.price,
  ).toBe("32.00");
  const request = {
    version: data.policy.version,
    channel: channel.id,
    lines: [
      {
        productId: data.ids.find((x) => x.uuid === dona.uuid).id,
        qty: 2,
        extras: 0,
      },
    ],
  };
  // El contrato de la cotización toma productos/opciones reales del carrito.
  const quote = await app.invocar("commercialQuote", request);
  expect(quote.success, JSON.stringify(quote)).toBeTruthy();
  expect(quote.data.total).toBe("64.00");
  expect(
    Number(
      rows(await app.invocar("getActiveProducts")).find(
        (x) => x.product_name === "Dona comercial " + n,
      ).stock,
    ),
  ).toBe(100);
  await expect(panel.locator("select")).toHaveCount(0);
});

test("Inventario: crear combo, pausar y eliminar con confirmación", async ({
  app,
}) => {
  await login(app, CUENTAS.admin);
  const { dona, cafe, n } = await seed(app),
    p = app.ventana;
  await irPorDock(p, "Inventario", "Promociones y combos");
  const panel = p.locator("app-commercial-panel"),
    editor = panel.locator("dialog.offer-dialog");
  await panel
    .getByRole("button", { name: "Nueva oferta", exact: true })
    .click();
  await panel
    .getByRole("menuitem", { name: "Crear combo", exact: true })
    .click();
  await editor
    .getByLabel("Nombre de la oferta", { exact: true })
    .fill("Combo interfaz " + n);
  await editor.getByLabel("Precio del combo", { exact: true }).fill("59");
  await editor.getByLabel("Oferta activa", { exact: true }).check();
  await editor
    .locator(".editor-steps")
    .getByRole("button", { name: /Productos/ })
    .click();
  for (const [i, name] of [
    "Dona comercial " + n,
    "Café comercial " + n,
  ].entries()) {
    if (i)
      await editor
        .getByRole("button", { name: "Agregar componente", exact: true })
        .click();
    const group = editor.locator(".component-group").nth(i);
    await group.getByRole("textbox").fill(i ? "Café" : "Dona");
    await group
      .getByRole("button", {
        name: "Productos del componente " + (i + 1),
        exact: true,
      })
      .click();
    const multi = group.locator("wx-multi-select").first();
    await multi.getByRole("searchbox").fill(name);
    await multi.getByRole("checkbox", { name: new RegExp(name) }).check();
    await p.keyboard.press("Escape");
  }
  await expect(editor.locator(".editor-total")).toContainText("$59.00");
  await editor
    .getByRole("button", { name: "Guardar oferta", exact: true })
    .click();
  await expect(editor).not.toBeVisible();
  await expect(panel.locator(".preview-total")).toContainText("$59.00");
  await expect(panel.locator(".preview-product")).toHaveCount(2);
  const published = (await app.invocar("commercialCatalog")).data.policy,
    combo = published.combos.find((x) => x.name === "Combo interfaz " + n);
  expect(combo.groups.map((g) => g.selector.products[0])).toEqual([
    dona.uuid,
    cafe.uuid,
  ]);
  const card = panel
    .locator(".offer-card")
    .filter({ hasText: "Combo interfaz " + n });
  await card
    .getByRole("button", {
      name: "Acciones de Combo interfaz " + n,
      exact: true,
    })
    .click();
  await card
    .getByRole("menuitem", { name: "Pausar oferta", exact: true })
    .click();
  await expect(card.locator(".status")).toHaveText("Inactiva");
  expect(
    (await app.invocar("commercialCatalog")).data.policy.combos.find(
      (x) => x.id === combo.id,
    ).active,
  ).toBe(false);
  await expect(panel.locator(".preview-total")).toContainText("$59.00");
  await card
    .getByRole("button", {
      name: "Acciones de Combo interfaz " + n,
      exact: true,
    })
    .click();
  await card
    .getByRole("menuitem", { name: "Eliminar oferta", exact: true })
    .click();
  const confirmation = panel.locator("dialog.remove-dialog");
  await confirmation
    .getByRole("button", { name: "Cancelar", exact: true })
    .click();
  expect(
    (await app.invocar("commercialCatalog")).data.policy.combos.some(
      (x) => x.id === combo.id,
    ),
  ).toBe(true);
  await card
    .getByRole("button", {
      name: "Acciones de Combo interfaz " + n,
      exact: true,
    })
    .click();
  await card
    .getByRole("menuitem", { name: "Eliminar oferta", exact: true })
    .click();
  await confirmation
    .getByRole("button", { name: "Eliminar oferta", exact: true })
    .click();
  await expect(confirmation).not.toBeVisible();
  await expect(card).toHaveCount(0);
});

test("Centro de ofertas: composición aprobada en claro, oscuro y tablet", async ({
  app,
}) => {
  await login(app, CUENTAS.admin);
  const { data, dona, cafe } = await seed(app, true),
    p = app.ventana;
  // Fixture ilustrativo únicamente en Wybix_E2E_Core, nunca en un negocio real.
  data.policy.promotions = [
    {
      id: "VISUAL_2x1",
      name: "Martes de donas",
      active: true,
      priority: 1,
      kind: "BUY_PAY",
      buy: 2,
      pay: 1,
      selector: { products: [dona.uuid] },
      weekdays: [2],
      channels: ["LOCAL"],
    },
    {
      id: "VISUAL_ADDON",
      name: "Al comprar 2 donas",
      active: true,
      priority: 2,
      kind: "ADDON",
      value: "10.00",
      triggerQty: 2,
      trigger: { products: [dona.uuid] },
      selector: { products: [cafe.uuid] },
      starts: "2099-01-01",
      channels: ["LOCAL"],
    },
    {
      id: "VISUAL_PERCENT",
      name: "Descuento estudiante",
      active: false,
      priority: 3,
      kind: "PERCENT",
      value: "20.00",
      audience: "ESTUDIANTE",
      selector: { products: [dona.uuid, cafe.uuid] },
      weekdays: [1, 2, 3, 4, 5],
      channels: ["LOCAL"],
    },
  ];
  data.policy.combos = [
    {
      id: "VISUAL_COMBO",
      name: "Dona + café",
      active: true,
      price: "59.00",
      channels: ["LOCAL"],
      groups: [
        {
          id: "d",
          name: "Dona",
          quantity: 1,
          selector: { products: [dona.uuid] },
        },
        {
          id: "c",
          name: "Café",
          quantity: 1,
          selector: { products: [cafe.uuid] },
        },
      ],
    },
  ];
  expect(
    (
      await app.invocar("commercialSave", {
        version: data.policy.version,
        policy: data.policy,
      })
    ).success,
  ).toBeTruthy();
  await irPorDock(p, "Inventario", "Promociones y combos");
  const panel = p.locator("app-commercial-panel");
  await expect(panel.locator(".offer-card")).toHaveCount(4);
  await expect(panel.locator(".preview-total")).toContainText("$25.00");
  await p.setViewportSize({ width: 1440, height: 900 });
  expect(
    await panel
      .locator(".rule-mark strong")
      .evaluateAll((nodes) =>
        nodes.every((el) => el.scrollWidth <= el.clientWidth),
      ),
  ).toBe(true);
  const dockTop = await p
    .locator(".wxdock")
    .evaluate((el) => el.getBoundingClientRect().top);
  expect(
    await panel
      .locator(".offer-card")
      .evaluateAll((nodes) =>
        Math.max(...nodes.map((el) => el.getBoundingClientRect().bottom)),
      ),
  ).toBeLessThan(dockTop);
  expect(
    await panel
      .locator(".preview-panel")
      .evaluate((el) => el.getBoundingClientRect().bottom),
  ).toBeLessThan(dockTop);
  await p.screenshot({
    path: "docs/evidencia/comercial-20261007/centro-ofertas-claro.png",
    fullPage: true,
  });
  await p.getByRole("button", { name: "Oscuro", exact: true }).click();
  await expect(p.locator("html")).toHaveClass(/dark/);
  await p.screenshot({
    path: "docs/evidencia/comercial-20261007/centro-ofertas-oscuro.png",
    fullPage: true,
  });
  await panel
    .getByRole("button", { name: "Editar oferta", exact: true })
    .click();
  const editor = panel.locator("dialog.offer-dialog");
  await expect(editor).toBeVisible();
  await editor
    .locator(".editor-steps")
    .getByRole("button", { name: /Productos/ })
    .click();
  await editor
    .getByRole("button", { name: "Productos elegibles", exact: true })
    .click();
  await expect.poll(() => editor.locator('.wm-panel:popover-open').evaluate(el => Number(getComputedStyle(el).opacity))).toBe(1);
  await p.screenshot({
    path: "docs/evidencia/comercial-20261007/centro-ofertas-editor.png",
  });
  await p.keyboard.press("Escape");
  await expect(editor).toBeVisible();
  await p.keyboard.press("Escape");
  await expect(editor).not.toBeVisible();
  await p.getByRole("button", { name: "Claro", exact: true }).click();
  await p.setViewportSize({ width: 768, height: 1024 });
  expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await p.screenshot({
    path: "docs/evidencia/comercial-20261007/centro-ofertas-tablet.png",
    fullPage: true,
  });
  await panel.getByRole("link", { name: "Productos", exact: true }).click();
  await expect(
    p
      .locator("wx-inventory-tabs")
      .getByRole("link", { name: "Promociones y combos", exact: true }),
  ).toBeVisible();
});

test("combo entre dos estaciones: cancelar dona, cobrar solo café y liberar mesa", async ({
  app,
}) => {
  test.setTimeout(180000);
  await login(app, CUENTAS.admin);
  const { data, dona, cafe, n } = await seed(app),
    p = app.ventana;
  const call = (fn, arg) =>
    p.evaluate(
      ([f, a]) => {
        const [g, m] = f.split(".");
        return window.wybix[g][m](a);
      },
      [fn, arg],
    );
  for (const m of ["hospitality", "mesas", "comandas"])
    expect((await app.invocar("modulosSet", m, true)).success).toBeTruthy();
  try {
    const stations = [];
    for (const name of ["Dona", "Café"]) {
      const r = await call("estaciones.guardar", {
        nombre: name + " combo " + n,
      });
      expect(r.success).toBeTruthy();
      stations.push(r.data[0].id);
    }
    for (const [i, pr] of [dona, cafe].entries())
      expect(
        (
          await call("estaciones.asignar", {
            productId: data.ids.find((x) => x.uuid === pr.uuid).id,
            stationId: stations[i],
          })
        ).success,
      ).toBeTruthy();
    const ar = await call("salon.guardarArea", { nombre: "Combos " + n }),
      mesa = await call("salon.guardarMesa", {
        areaId: ar.data[0].id,
        nombre: "Mesa combo " + n,
      });
    const account = await call("cuentas.abrir", { mesaId: mesa.data[0].id });
    expect(account.success).toBeTruthy();
    const cuentaId = account.data[0].id;
    data.policy.combos.push({
      id: "cancel" + n,
      name: "Menú cancelable QA",
      active: true,
      price: "59.00",
      groups: [
        {
          id: "d",
          name: "Dona",
          quantity: 1,
          selector: { products: [dona.uuid] },
        },
        {
          id: "c",
          name: "Café",
          quantity: 1,
          selector: { products: [cafe.uuid] },
        },
      ],
    });
    expect(
      (
        await app.invocar("commercialSave", {
          version: data.policy.version,
          policy: data.policy,
        })
      ).success,
    ).toBeTruthy();
    const instance = "instance" + n,
      lineas = [dona, cafe].map((pr) => ({
        productId: data.ids.find((x) => x.uuid === pr.uuid).id,
        cantidad: 1,
        origen: require("node:crypto").randomUUID(),
        opciones: [],
      }));
    const send = await call("cuentas.enviar", {
      cuentaId,
      lineas,
      commercial: {
        channel: "LOCAL",
        lines: lineas.map((_, i) => ({
          linea: i + 1,
          combo: { id: "cancel" + n, instance, group: i ? "c" : "d" },
        })),
      },
    });
    expect(send.success, JSON.stringify(send)).toBeTruthy();
    await app.invocar("setDeviceConfig", { deviceProfile: "TOUCH_POS" });
    await p.locator(".wx-yo__btn").click();
    await p
      .locator(".wx-yo__fila")
      .filter({ hasText: "Cerrar sesión" })
      .click();
    await p.waitForSelector("#username");
    await login(app, CUENTAS.admin);
    await p.waitForSelector("app-touch-pos .tp-card");
    await p.getByRole("button", { name: "Mesas", exact: true }).click();
    await p
      .locator("hx-selector-mesas .sm-mesa")
      .filter({ hasText: "Mesa combo " + n })
      .click();
    await expect(p.locator(".tp-linea")).toHaveCount(2);
    await expect(p.locator("app-commercial-sale")).toContainText(
      "Ahorro $1.00",
    );
    const loaded = await call("cuentas.obtener", { cuentaId }),
      cancelId = loaded.sets[1].find(
        (x) => x.product_id === lineas[0].productId,
      ).comanda_id;
    expect(
      (
        await call("kds.cancelar", {
          comandaId: cancelId,
          motivo: "QA faltó dona",
        })
      ).success,
    ).toBeTruthy();
    await expect(p.locator(".tp-linea")).toHaveCount(1, { timeout: 20000 });
    await expect(p.locator("app-commercial-sale")).toContainText(
      "Los productos restantes se cobran por separado",
    );
    const before = new Set(
      rows(await app.invocar("getSales")).map((x) => x.id),
    );
    await p.locator(".tp-cart__foot .tp-primaria").click();
    await p.locator(".tp-metodo").filter({ hasText: "Plataforma" }).click();
    await p.locator(".tp-cobro__confirmar").click();
    await expect
      .poll(
        async () =>
          rows(await app.invocar("getSales")).filter(
            (x) => !before.has(x.id) && Number(x.total) === 35,
          ).length,
      )
      .toBe(1);
    await expect
      .poll(
        async () =>
          (await call("cuentas.obtener", { cuentaId })).sets[0][0].estado,
        { timeout: 20000 },
      )
      .toBe("COBRADA");
    const stock = rows(await app.invocar("getActiveProducts"));
    expect(
      Number(stock.find((x) => x.product_name === "Dona comercial " + n).stock),
    ).toBe(100);
    expect(
      Number(stock.find((x) => x.product_name === "Café comercial " + n).stock),
    ).toBe(99);
  } finally {
    for (const m of ["comandas", "mesas", "hospitality"])
      await app.invocar("modulosSet", m, false);
    await app.invocar("setDeviceConfig", { deviceProfile: "RETAIL_POS" });
  }
});
