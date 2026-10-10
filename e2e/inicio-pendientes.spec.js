/**
 * Inicio · «Necesita tu atención» no inventa pendientes.
 *
 * Dos avisos falsos vistos en uso real (2026-10-09):
 *   - «No hay turno abierto» con el turno abierto: la guía pedía el turno sin
 *     usuario ni caja y el proceso principal fallaba.
 *   - «"Capturado con lector" está a medias» con solo entrar a la captura: la
 *     carga vacía (CAPTURANDO, 0 renglones) contaba como trabajo pendiente.
 */
const { test, expect, CUENTAS } = require("./fixtures");

async function login(app, c) {
  const p = app.ventana;
  await p.fill("#username", c.usuario);
  await p.fill("#password", c.password);
  await p.click("#btnLogin");
  await expect
    .poll(async () => {
      try { return (await app.invocar("sesion"))?.data?.usuario; } catch { return null; }
    })
    .toBe(c.usuario);
}

test("Inicio: con turno abierto y una captura vacía no hay avisos falsos", async ({ app }) => {
  test.setTimeout(120000);
  const p = app.ventana;
  await login(app, CUENTAS.admin);
  const userId = (await app.invocar("sesion")).data.userId;

  const turno = await app.invocar("openShift", { user_id: userId, opening_cash: 500 });
  expect(turno?.success || /ya existe un turno/i.test(String(turno?.error ?? ""))).toBeTruthy();
  const carga = await app.invocar("qsCargaManual", { lector: true, userId });
  expect(carga?.success).toBe(true);

  // Sesión nueva: la guía vuelve a calcular sus avisos desde cero.
  await p.locator(".wx-yo__btn").click();
  await p.locator(".wx-yo__fila").filter({ hasText: "Cerrar sesión" }).click();
  await p.waitForSelector("#username");
  await login(app, CUENTAS.admin);

  const inicio = p.locator("app-inicio");
  await expect(inicio).toBeVisible();
  await p.waitForTimeout(2000);
  await expect(inicio).not.toContainText("No hay turno abierto");
  await expect(inicio).not.toContainText("está a medias");
});
