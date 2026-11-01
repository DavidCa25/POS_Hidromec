/**
 * UNA SEMANA DE TRABAJO DE UN CAJERO, COMO LA VIVIRIA UNA PERSONA.
 *
 *     npm run e2e:usuario-5-dias
 *
 * Cada dia el Operador entra con su usuario y, por la interfaz: checa entrada,
 * abre turno, vende, descansa, hace su corte, checa salida y cierra sesion.
 * Al final el Encargado revisa la semana, corrige y exporta.
 *
 * LA FECHA
 * --------
 * La hora la pone SQL Server, asi que no se puede adelantar el reloj. Cada
 * accion se hace de verdad y justo despues se mueve su fecha, en esta base
 * desechable, a la hora simulada de ese dia.
 *
 * NO SE DETIENE EN EL PRIMER PROBLEMA
 * -----------------------------------
 * Es una auditoria: lo que no sale como deberia se anota en `hallazgos` y la
 * persona sigue como seguiria en la vida real. Al final se escribe
 * tmp/e2e-5-dias/reporte.json con las capturas al lado, y la prueba falla si
 * hubo hallazgos.
 */
const path = require('node:path');
const fs = require('node:fs');
const { test, expect, CUENTAS, irPorDock, irPorMas } = require('./fixtures');

const SHOTS = path.join(__dirname, '..', 'tmp', 'e2e-5-dias');
const hallazgos = [];
const bitacora = [];
const anotar = (dia, que, detalle = '') => { hallazgos.push({ dia, que, detalle }); console.log(`   HALLAZGO [${dia}] ${que}${detalle ? ' · ' + detalle : ''}`); };
const paso = (dia, que) => { bitacora.push(`${dia}: ${que}`); console.log(`   ok [${dia}] ${que}`); };

async function sql(base, texto) {
  const { consultarTemporal } = await import('../scripts/db/lib/temporal-consulta.mjs');
  const r = consultarTemporal(base, texto);
  if (!r.ok) throw new Error(r.error);
  return r.sets.length ? r.sets[r.sets.length - 1] : [];
}
async function login(app, c) {
  const p = app.ventana;
  await p.waitForSelector('#username', { timeout: 30000 });
  await p.fill('#username', c.usuario);
  await p.fill('#password', c.password);
  await p.click('#btnLogin');
  await expect.poll(async () => {
    try { return (await app.invocar('sesion'))?.data?.usuario; } catch { return null; }
  }).toBe(c.usuario);
  await p.waitForSelector('.wxdock, .wxside', { timeout: 30000 });
}
async function salir(app) {
  const p = app.ventana;
  const aviso = p.getByRole('button', { name: 'Salir', exact: true });
  if (await aviso.isVisible().catch(() => false)) await aviso.click();
  await p.locator('.wx-yo__btn').click();
  await p.locator('.wx-yo__fila').filter({ hasText: 'Cerrar sesión' }).click();
  await p.waitForSelector('#username');
}
const captura = (p, n) => p.screenshot({ path: path.join(SHOTS, `${n}.png`) });
const pad = (n) => String(n).padStart(2, '0');
const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** La ultima semana con lunes a viernes ya pasados. */
function lunesDeLaSemana() {
  const hoy = new Date(); hoy.setHours(12, 0, 0, 0);
  const lun = new Date(hoy); lun.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
  if (((hoy.getDay() + 6) % 7) < 5) lun.setDate(lun.getDate() - 7);
  return lun;
}
const diaDe = (lunes, i) => { const d = new Date(lunes); d.setDate(lunes.getDate() + i); return local(d); };

const dialogo = (p) => p.locator('[data-guide="asistencia-checar"]');

/**
 * Abrir Checar desde el dock, como la persona. Si algo lo tapa, se anota y se
 * hace lo que haria ella: salir del aviso y volver a intentar.
 */
async function abrirChecar(p, dia, { f9 = false } = {}) {
  /* Al llegar a Venta sin turno sale el aviso de abrirlo: Checar se ofrece ahi mismo. */
  const enAviso = p.locator('[data-guide="turno-checar"]');
  if (await enAviso.waitFor({ state: 'visible', timeout: 2500 }).then(() => true).catch(() => false)) {
    if (f9) await p.keyboard.press('F9'); else await enAviso.click();
    await expect(dialogo(p)).toBeVisible();
    return;
  }
  const boton = p.locator('[data-guide="nav-checar"]');
  try {
    await boton.click({ timeout: 4000 });
  } catch {
    /* Que tapa el boton, tal cual lo ve la persona. */
    const tapa = await p.evaluate(() => {
      const b = document.querySelector('[data-guide="nav-checar"]');
      if (!b) return { sinBoton: true };
      const r = b.getBoundingClientRect();
      const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      const m = e?.closest('.modal, .swal2-container, [role=dialog], .cierre-modal, dialog') || e;
      return { clase: String(m?.className || m?.tagName), texto: (m?.innerText || '').replace(/\s+/g, ' ').slice(0, 160) };
    });
    await captura(p, `${dia}-checar-tapado-${Date.now()}`);
    anotar(dia, 'Checar no se puede pulsar: algo lo tapa', JSON.stringify(tapa));
    const salirAviso = p.getByRole('button', { name: 'Salir', exact: true });
    const cerrarVisible = p.locator('.modal.show .btn-close, .swal2-confirm, .modal.show button:has-text("Cerrar")').first();
    if (await salirAviso.isVisible().catch(() => false)) await salirAviso.click();
    else if (await cerrarVisible.isVisible().catch(() => false)) await cerrarVisible.click();
    await expect(p.locator('.modal.show')).toHaveCount(0);
    await boton.click();
  }
  await expect(dialogo(p)).toBeVisible();
}
async function cerrarChecar(p) {
  await p.keyboard.press('Escape');
  await expect(dialogo(p)).toBeHidden();
}
async function marcar(p, guide, texto) {
  await dialogo(p).locator(`[data-guide="${guide}"]`).click();
  await expect(dialogo(p)).toContainText(texto);
  await cerrarChecar(p);
}

async function irAVenta(p) {
  /* Si ya esta en Venta con el aviso de turno, ahi sigue. */
  if (await p.locator('[data-guide="turno-modal"]').isVisible().catch(() => false)) return;
  await irPorDock(p, 'Venta', 'Nueva venta');
  await p.waitForSelector('.pos-shift-chip', { timeout: 30000 });
}
async function abrirTurno(app, fondo) {
  const p = app.ventana;
  await expect(p.locator('[data-guide="turno-modal"]')).toBeVisible({ timeout: 15000 });
  await p.locator('[data-guide="turno-modal"] input[name="openingCash"]').fill(String(fondo));
  await p.locator('[data-guide="turno-abrir-confirmar"]').click();
  await expect(p.locator('.swal2-popup')).toContainText('Turno abierto', { timeout: 15000 });
  await p.locator('.swal2-confirm').click();
  await expect(p.locator('.swal2-popup')).toHaveCount(0);
  await expect(p.locator('[data-guide="turno-modal"]')).toHaveCount(0, { timeout: 15000 });
}
async function agregar(p, nombre) {
  await p.getByRole('button', { name: /Agregar producto/ }).click();
  await p.locator('.modal-productos .prod-item').filter({ hasText: nombre }).click();
  await expect(p.locator('.modal-productos')).toHaveCount(0);
}
async function cerrarAvisoDeVenta(p) {
  for (let i = 0; i < 2; i++) {
    for (const b of [p.getByRole('button', { name: 'Nada más, cerrar' }), p.locator('app-premios-venta').getByRole('button', { name: 'Continuar' }).first()]) {
      try { await b.click({ timeout: 2000 }); } catch { /* no esta */ }
    }
  }
}
async function cobrar(p, recibido) {
  await p.keyboard.press('F8');
  await p.locator('[data-guide=venta-recibido]').fill(String(recibido));
  await p.locator('[data-guide=venta-confirmar-cobro]').click();
}

/** El corte del turno, por la pantalla. Devuelve el efectivo esperado. */
async function cerrarTurno(app, opId, dia) {
  const p = app.ventana;
  await irPorDock(p, 'Venta', 'Corte del día');
  /* El asistente del corte: caja, que hacer y consultar. */
  const seguir = p.getByRole('button', { name: /Continuar/ });
  if (await seguir.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false)) {
    if (await seguir.isDisabled()) await p.locator('button', { hasText: 'ID: ' }).first().click();
    await seguir.click();
  }
  const consultar = p.getByRole('button', { name: /Consultar movimientos/ });
  if (await consultar.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false)) {
    await p.locator('button.mode-card', { hasText: 'Cerrar turno' }).click();
    await consultar.click();
  }
  const cerrar = p.locator('button.btn-success', { hasText: 'Cerrar turno' });
  await expect(cerrar).toBeEnabled({ timeout: 20000 });
  await cerrar.click();
  const fila = (await sql(app.base, 'SELECT TOP 1 id FROM dbo.cash_closures WHERE closed_at IS NULL ORDER BY id DESC;'))[0];
  await p.locator('#corte-contado').fill('535');
  await p.getByRole('button', { name: 'Confirmar cierre' }).click();
  await expect.poll(async () => (await sql(app.base, `SELECT closed_at FROM dbo.cash_closures WHERE id = ${fila.id};`))[0].closed_at != null,
    { timeout: 30000, message: `[${dia}] el turno no se cerro` }).toBe(true);
  /* Lo que salga despues del corte, en el orden que salga: la persona lo cierra. */
  const ticket = p.locator('dialog.receipt');
  const aviso = p.locator('.swal2-popup');
  let quietos = 0;
  for (let i = 0; i < 40 && quietos < 4; i++) {
    if (await ticket.isVisible().catch(() => false)) {
      await ticket.locator('button.btn-light').click({ timeout: 3000 }).catch(() => p.keyboard.press('Escape'));
      quietos = 0;
    } else if (await aviso.isVisible().catch(() => false)) {
      const txt = (await aviso.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      if (/Sin turno abierto/.test(txt)) {
        await captura(p, `${dia}-aviso-tras-corte`);
        anotar(dia, 'Tras un corte exitoso sale el aviso «Sin turno abierto»', txt);
      }
      await p.locator('.swal2-confirm').click({ timeout: 3000 }).catch(() => {});
      quietos = 0;
    } else {
      quietos++;
    }
    await p.waitForTimeout(300);
  }
  return fila.id;
}

test('Una semana de un cajero: checar, turno, venta, corte y revisión del encargado', async ({ app }) => {
  test.setTimeout(600000);
  fs.rmSync(SHOTS, { recursive: true, force: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = app.ventana;
  await p.setViewportSize?.({ width: 1366, height: 768 });
  const db = app.base;
  const lunes = lunesDeLaSemana();
  const D = [0, 1, 2, 3, 4].map(i => diaDe(lunes, i));

  const op = (await sql(db, `SELECT id FROM dbo.users WHERE usuario = N'${CUENTAS.operador.usuario}';`))[0].id;
  const PROD = `Café Semana ${Date.now().toString().slice(-6)}`;
  const semana = [1, 2, 3, 4, 5, 6].map(w => ({ weekday: w, entrada: '08:00', salida: '16:00', descanso_min: 30 }));
  await sql(db, `
    DELETE FROM dbo.asistencia_correcciones; DELETE FROM dbo.asistencia_descansos;
    DELETE FROM dbo.asistencia_jornadas; DELETE FROM dbo.asistencia_horarios; DELETE FROM dbo.asistencia_reglas;
    UPDATE dbo.cash_closures SET closed_at = SYSDATETIME() WHERE closed_at IS NULL;
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_categories) INSERT INTO dbo.CAT_categories (namee) VALUES (N'Bebidas');
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_brands) INSERT INTO dbo.CAT_brands (namee) VALUES (N'Casa');
    EXEC dbo.sp_asistencia_reglas_guardar @cuenta_extra=1, @tolerancia=1, @descanso_pagado=0, @dia_libre_extra=1,
      @marca_retardos=1, @entrada_para_vender=1, @activar=1;
    EXEC dbo.sp_asistencia_horario_guardar @persona_id=${op}, @dias=N'${JSON.stringify(semana)}';`);

  /* El producto, como lo da de alta el negocio: con categoria y marca. */
  await login(app, CUENTAS.admin);
  const filas = (r) => (Array.isArray(r) ? r : r?.data ?? r?.recordset ?? []);
  const idDe = (x) => Number(x?.id ?? x?.category_id ?? x?.brand_id);
  const cats = filas(await app.invocar('getCategories'));
  const marcas = filas(await app.invocar('getBrands'));
  const alta = await app.invocar('agregarProducto', idDe(marcas[0]), idDe(cats[0]), `SEM-${Date.now().toString().slice(-6)}`, PROD, 35, 500,
    null, null, '02', 0.16, null, null);
  expect(alta?.success ?? true, JSON.stringify(alta)).toBeTruthy();
  await salir(app);

  /* Mover a la hora simulada lo que acaba de pasar. */
  /* Se mueve al TERMINAR el dia: a media jornada, una entrada de hace dias seria
     un olvido de salida (y con razon) y frenaria la venta. */
  const moverJornada = async (d, entrada, descanso, salida) => {
    const j = (await sql(db, `SELECT TOP 1 id FROM dbo.asistencia_jornadas WHERE user_id = ${op} ORDER BY id DESC;`))[0].id;
    if (descanso) await sql(db, `UPDATE dbo.asistencia_descansos SET inicio_en = '${d}T${descanso[0]}:00', fin_en = '${d}T${descanso[1]}:00' WHERE jornada_id = ${j};`);
    await sql(db, `UPDATE dbo.asistencia_jornadas SET dia = '${d}', entrada_en = '${d}T${entrada}:00', created_at = '${d}T${entrada}:00',
      salida_en = ${salida ? `'${d}T${salida}:00'` : 'NULL'} WHERE id = ${j};`);
  };
  const moverTurno = async (id, d, abre, cierra) => {
    await sql(db, `UPDATE dbo.cash_closures SET create_date = '${d}', opened_at = '${d}T${abre}:00', closed_at = '${d}T${cierra}:00' WHERE id = ${id};
      UPDATE dbo.cash_movements SET datee = DATEADD(MINUTE, 90, '${d}T${abre}:00') WHERE closure_id = ${id};
      UPDATE dbo.sales SET datee = DATEADD(MINUTE, 90, '${d}T${abre}:00') WHERE closure_id = ${id};`);
  };

  /** Un dia normal. */
  async function jornada({ nombre, d, entrada, descanso, salida, turnoAbre, turnoCierra, previo, f9, olvidoDe }) {
    await login(app, CUENTAS.operador);
    if (previo) await previo();
    await abrirChecar(p, nombre, { f9 });
    const estado = dialogo(p);
    await expect(estado.locator('.asis-hora__reloj')).toBeVisible();
    if (await estado.locator('[data-guide="asistencia-entrada"]').count() === 0) {
      await captura(p, `${nombre}-sin-boton-entrada`);
      anotar(nombre, 'Checar no ofrece «Registrar entrada»', (await estado.innerText()).replace(/\s+/g, ' ').slice(0, 220));
      /* La persona solo tiene Salida: la pulsa para poder empezar su dia. */
      await marcar(p, 'asistencia-salida', 'Salida registrada');
      await abrirChecar(p, nombre);
    }
    if (olvidoDe && !(await dialogo(p).locator('[data-guide="asistencia-olvido"]').isVisible().catch(() => false))) {
      anotar(nombre, 'Checar no avisa que quedo una salida sin registrar', olvidoDe);
    }
    await captura(p, `${nombre}-1-checar`);
    await marcar(p, 'asistencia-entrada', 'Entrada registrada');
    paso(nombre, `entrada ${entrada}`);

    await irAVenta(p);
    await abrirTurno(app, 500);
    const turno = (await sql(db, 'SELECT TOP 1 id FROM dbo.cash_closures WHERE closed_at IS NULL ORDER BY id DESC;'))[0].id;
    paso(nombre, `turno ${turno} abierto`);
    await agregar(p, PROD);
    await cobrar(p, 35);
    await cerrarAvisoDeVenta(p);
    await expect.poll(async () => (await sql(db, `SELECT COUNT(*) AS n FROM dbo.sales WHERE closure_id = ${turno};`))[0].n,
      { timeout: 20000, message: `[${nombre}] la venta no quedo` }).toBeGreaterThan(0);
    paso(nombre, 'venta de $35 en efectivo');
    await captura(p, `${nombre}-2-vendido`);

    if (descanso) {
      await abrirChecar(p, nombre);
      await marcar(p, 'asistencia-descanso', 'Descanso iniciado');
      await abrirChecar(p, nombre);
      await expect(dialogo(p).locator('[data-guide="asistencia-salida"]')).toHaveCount(0);
      await marcar(p, 'asistencia-fin-descanso', 'De vuelta del descanso');
      paso(nombre, `descanso ${descanso[0]}-${descanso[1]}`);
    }

    await cerrarTurno(app, op, nombre);
    await moverTurno(turno, d, turnoAbre, turnoCierra);
    paso(nombre, 'corte cerrado');

    if (salida) {
      await abrirChecar(p, nombre);
      await marcar(p, 'asistencia-salida', 'Salida registrada');
      paso(nombre, `salida ${salida}`);
    } else {
      paso(nombre, 'se va SIN checar salida');
    }
    await salir(app);
    await moverJornada(d, entrada, descanso, salida);
  }

  // ------------------------------------------------------------- lunes
  await jornada({ nombre: 'lunes', d: D[0], entrada: '07:58', descanso: ['12:00', '12:30'], salida: '16:00', turnoAbre: '08:02', turnoCierra: '15:55' });
  // ------------------------------------------------------------ martes
  await jornada({ nombre: 'martes', d: D[1], entrada: '08:12', descanso: ['13:00', '13:30'], salida: '16:42', turnoAbre: '08:15', turnoCierra: '16:35', f9: true });

  // --------------------------- miercoles: olvida checar y va directo a vender
  await login(app, CUENTAS.operador);
  await irAVenta(p);
  await abrirTurno(app, 500);
  const turnoMie = (await sql(db, 'SELECT TOP 1 id FROM dbo.cash_closures WHERE closed_at IS NULL ORDER BY id DESC;'))[0].id;
  await agregar(p, PROD);
  await cobrar(p, 35);
  try {
    await expect(dialogo(p)).toBeVisible({ timeout: 10000 });
    await expect(dialogo(p)).toContainText('Checa tu entrada antes de cobrar.');
    await captura(p, 'miercoles-1-cobro-pide-checar');
    paso('miercoles', 'el cobro abre Checar');
    await marcar(p, 'asistencia-entrada', 'Entrada registrada');
  } catch (e) {
    await captura(p, 'miercoles-1-cobro-no-pide-checar');
    anotar('miercoles', 'Cobrar sin entrada no abrio Checar', String(e.message).slice(0, 200));
    await p.keyboard.press('Escape');
    await abrirChecar(p, 'miercoles');
    await marcar(p, 'asistencia-entrada', 'Entrada registrada');
  }
  if (await p.locator('.total-amount').isVisible().catch(() => false) === false) await p.keyboard.press('F8');
  await p.locator('[data-guide=venta-recibido]').fill('35').catch(() => {});
  await p.locator('[data-guide=venta-confirmar-cobro]').click().catch(() => {});
  await cerrarAvisoDeVenta(p);
  await expect.poll(async () => (await sql(db, `SELECT COUNT(*) AS n FROM dbo.sales WHERE closure_id = ${turnoMie};`))[0].n,
    { timeout: 15000 }).toBeGreaterThan(0).catch(() => anotar('miercoles', 'La venta no se pudo completar después de checar', 'el carrito o el cobro no se conservaron'));
  await cerrarTurno(app, op, 'miercoles');
  await moverTurno(turnoMie, D[2], '08:06', '16:00');
  await abrirChecar(p, 'miercoles');
  await marcar(p, 'asistencia-salida', 'Salida registrada');
  await salir(app);
  await moverJornada(D[2], '08:05', null, '16:08');
  paso('miercoles', 'dia completo');

  // ----------------------------------------------------- jueves: olvida salida
  await jornada({ nombre: 'jueves', d: D[3], entrada: '08:00', descanso: null, salida: null, turnoAbre: '08:03', turnoCierra: '15:50' });
  // ------------------------------------------- viernes: se queda hasta las 18
  await jornada({ nombre: 'viernes', d: D[4], entrada: '07:50', descanso: ['12:00', '13:00'], salida: '18:00', turnoAbre: '07:55', turnoCierra: '17:50', olvidoDe: 'jueves' });

  // ---------------------------------------------------- lo que dice la base
  const crudo = await sql(db, `SELECT CONVERT(CHAR(10), dia, 23) AS dia, CONVERT(CHAR(5), entrada_en, 108) AS e, CONVERT(CHAR(5), salida_en, 108) AS s,
    CONVERT(CHAR(10), salida_en, 23) AS sd, estado FROM dbo.asistencia_jornadas WHERE user_id = ${op} ORDER BY entrada_en;`);
  fs.writeFileSync(path.join(SHOTS, 'jornadas-antes-de-corregir.json'), JSON.stringify(crudo, null, 2));

  // ------------------------------------------------- el encargado revisa
  await login(app, CUENTAS.encargado);
  await irPorMas(p, 'Asistencia');
  await expect(p.locator('.asis-cab h1')).toHaveText('Asistencia');
  const hoy = new Date(); hoy.setHours(12, 0, 0, 0);
  const lunActual = new Date(hoy); lunActual.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
  if (local(lunActual) !== local(lunes)) await p.getByRole('button', { name: 'Semana anterior' }).click();
  const fila = p.locator('.asis-tabla tbody tr', { hasText: CUENTAS.operador.usuario });
  await expect(fila).toBeVisible();
  await captura(p, 'encargado-1-semana');
  const celda = async (i) => (await fila.locator('td').nth(i + 1).innerText()).replace(/\s+/g, ' ').trim();
  const celdas = [];
  for (let i = 0; i < 5; i++) celdas.push(await celda(i));
  paso('encargado', `semana: ${celdas.join(' | ')}`);
  const esperado = [
    ['lunes', '7:32'], ['martes', '8:00'], ['miercoles', '8:03'], ['viernes', '9:10'],
  ];
  for (const [n, h] of esperado) {
    const i = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes'].indexOf(n);
    if (!celdas[i].startsWith(h)) anotar('encargado', `${n}: la tabla no da ${h}`, `dice «${celdas[i]}»`);
  }
  if (!/Retardo 12/.test(celdas[1]) || !/\+0:42/.test(celdas[1])) anotar('encargado', 'martes: faltan Retardo 12 y +0:42', celdas[1]);
  if (/Retardo|\+/.test(celdas[2])) anotar('encargado', 'miercoles: no debia tener retardo ni extra (tolerancia)', celdas[2]);
  if (!/\+2:00/.test(celdas[4])) anotar('encargado', 'viernes: faltan las 2:00 de extra', celdas[4]);
  if (!/Revisar/.test(celdas[3]) || !/^Sin salida/.test(celdas[3])) anotar('encargado', 'jueves: el olvido de salida no aparece como «Revisar» con 0 horas', celdas[3]);
  const porRevisar = (await p.locator('.asis-kpi--revisar b').innerText()).trim();
  if (porRevisar !== '1') anotar('encargado', 'El contador «Por revisar» no da 1', porRevisar);
  if (await p.getByText('sin horario', { exact: false }).count()) anotar('encargado', 'El aviso de «sin horario» sigue contando a quien no se espera');

  /* Corregir el jueves. */
  await fila.click();
  const detalle = p.locator('.asis-detalle');
  await expect(detalle).toContainText(CUENTAS.operador.usuario);
  await captura(p, 'encargado-2-detalle');
  const delJueves = detalle.locator('.asis-jornada').filter({ hasText: 'jueves' });
  await delJueves.getByRole('button', { name: 'Corregir' }).click();
  const form = p.locator('[data-guide="asistencia-corregir"]');
  await form.locator('wx-date[name="fs"] input, wx-date[name="fs"] button').first().waitFor();
  /* La salida quedo otro dia: el encargado tambien corrige su fecha. */
  await form.locator('wx-date[name="fs"] .wx-date__campo').click();
  await p.locator('wx-date[name="fs"] [role="gridcell"]:not(.is-fuera)').filter({ hasText: new RegExp(`^\\s*${Number(D[3].slice(8))}\\s*$`) }).first().click();
  await form.locator('wx-time[name="he"] input').fill('08:00');
  await form.locator('wx-time[name="hs"] input').fill('16:00');
  await form.locator('#asis-motivo').fill('Olvidó checar su salida');
  await captura(p, 'encargado-3-corrigiendo');
  await form.getByRole('button', { name: 'Guardar corrección' }).click();
  await p.waitForTimeout(1500);
  if (await p.locator('.swal2-popup').isVisible().catch(() => false)) {
    await captura(p, 'encargado-4-error-al-corregir');
    anotar('encargado', 'No se pudo corregir el jueves', (await p.locator('.swal2-popup').innerText()).replace(/\s+/g, ' ').slice(0, 200));
    await p.locator('.swal2-confirm').click();
  }
  await p.getByRole('button', { name: 'Cerrar' }).first().click();
  const jueves = await celda(3);
  paso('encargado', `jueves tras corregir: ${jueves}`);
  if (!jueves.startsWith('8:00')) anotar('encargado', 'jueves corregido no da 8:00', jueves);

  const totalTxt = (await fila.locator('td').nth(8).innerText()).trim();
  const extraTxt = (await fila.locator('td').nth(9).innerText()).trim();
  paso('encargado', `total ${totalTxt} · extra ${extraTxt}`);
  if (totalTxt !== '40:45') anotar('encargado', 'El total de la semana no da 40:45', totalTxt);
  if (extraTxt !== '2:42') anotar('encargado', 'La extra de la semana no da 2:42', extraTxt);
  await captura(p, 'encargado-5-semana-corregida');

  /* Exportar para el contador. */
  const ruta = path.join(SHOTS, 'asistencia.xlsx');
  fs.rmSync(ruta, { force: true });
  await app.app.evaluate(({ dialog }, r) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: r }); }, ruta);
  await p.locator('[data-guide="asistencia-exportar"]').click();
  await p.waitForTimeout(2500);
  if (!fs.existsSync(ruta)) anotar('encargado', 'Exportar a Excel no generó el archivo', ruta);
  else paso('encargado', `Excel exportado (${fs.statSync(ruta).size} bytes)`);

  /* El corte de cada dia, con su hora. */
  const cortes = await sql(db, `SELECT CONVERT(CHAR(10), opened_at, 23) AS d, CONVERT(CHAR(5), opened_at, 108) AS a, CONVERT(CHAR(5), closed_at, 108) AS c,
    cash_expected, cash_delivered, difference FROM dbo.cash_closures WHERE opened_at >= '${D[0]}' AND opened_at < DATEADD(DAY, 1, '${D[4]}') ORDER BY opened_at;`);
  fs.writeFileSync(path.join(SHOTS, 'cortes.json'), JSON.stringify(cortes, null, 2));
  if (cortes.length !== 5) anotar('encargado', `Se esperaban 5 cortes y hay ${cortes.length}`);
  for (const c of cortes) if (Number(c.difference) !== 0) anotar('encargado', `Corte del ${c.d} con diferencia ${c.difference}`, `esperado ${c.cash_expected}, entregado ${c.cash_delivered}`);

  fs.writeFileSync(path.join(SHOTS, 'reporte.json'), JSON.stringify({ hallazgos, bitacora }, null, 2));
  console.log(`\n   ${hallazgos.length} HALLAZGO(S) · reporte en tmp/e2e-5-dias/reporte.json`);
  expect(hallazgos, JSON.stringify(hallazgos, null, 2)).toEqual([]);
});

test('Touch: al llegar, Checar se puede usar desde el aviso de abrir turno', async ({ app }) => {
  test.setTimeout(180000);
  const p = app.ventana;
  const op = (await sql(app.base, `SELECT id FROM dbo.users WHERE usuario = N'${CUENTAS.operador.usuario}';`))[0].id;
  await sql(app.base, `
    DELETE FROM dbo.asistencia_descansos WHERE jornada_id IN (SELECT id FROM dbo.asistencia_jornadas WHERE user_id = ${op} AND dia = CAST(GETDATE() AS DATE));
    DELETE FROM dbo.asistencia_jornadas WHERE user_id = ${op} AND estado = 'ABIERTA';
    UPDATE dbo.cash_closures SET closed_at = SYSDATETIME() WHERE closed_at IS NULL;
    EXEC dbo.sp_asistencia_reglas_guardar @cuenta_extra=1, @tolerancia=1, @descanso_pagado=0, @dia_libre_extra=1,
      @marca_retardos=1, @entrada_para_vender=0, @activar=1;`);
  await login(app, CUENTAS.admin);
  await app.invocar('setDeviceConfig', { deviceProfile: 'TOUCH_POS' });
  await expect.poll(async () => (await p.locator('.wx-yo__btn').count())).toBeGreaterThan(0);
  await salir(app);
  await p.fill('#username', CUENTAS.operador.usuario);
  await p.fill('#password', CUENTAS.operador.password);
  await p.click('#btnLogin');
  const enAviso = p.locator('[data-guide="turno-checar"]');
  await expect(enAviso).toBeVisible({ timeout: 20000 });
  await enAviso.click();
  await expect(dialogo(p)).toBeVisible();
  await marcar(p, 'asistencia-entrada', 'Entrada registrada');
  await captura(p, 'touch-checar-desde-turno');
  await sql(app.base, `EXEC dbo.sp_set_business_module @module_key = N'asistencia', @enabled = 0;`);
});

test.afterAll(() => {
  try { fs.mkdirSync(SHOTS, { recursive: true }); fs.writeFileSync(path.join(SHOTS, 'reporte.json'), JSON.stringify({ hallazgos, bitacora }, null, 2)); } catch { /* noop */ }
});

