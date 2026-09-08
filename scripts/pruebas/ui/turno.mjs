/**
 * Entrar a vender sin turno abierto pide abrirlo. En Retail y en Touch.
 *
 *     node scripts/pruebas/conducir-app.mjs scripts/pruebas/ui/turno.mjs
 *
 * QUE SE ROMPIO
 * -------------
 * En la VM se cerro el turno, se volvio a entrar a "Hacer venta" y la pantalla
 * abrio como si nada. La pantalla de Corte cerraba el turno y limpiaba SUS
 * campos, pero no tocaba `ShiftService`, que es de donde leen las pantallas de
 * venta: el servicio seguia diciendo "abierto" el resto de la sesion. Y
 * `ensureShiftOpen` empieza por `if (this.shift.isOpen) return true`, asi que
 * con el estado viejo puesto nunca llegaba a preguntarle a SQL.
 *
 * QUE COMPRUEBA
 * -------------
 * La secuencia de la VM, sobre la ventana real y SIN sustituir nada:
 *
 *     sin turno -> Retail pide abrirlo      (y checkout se niega)
 *               -> Touch bloquea el cobro
 *               -> se abre por el flujo de siempre
 *               -> las dos experiencias dejan vender
 *
 * El estado en memoria se ensucia a proposito antes de cada comprobacion -se
 * marca "abierto" cuando no lo hay-, porque esa es exactamente la situacion
 * del defecto: si el codigo se fiara de memoria, la prueba pasaria en verde
 * sin haber preguntado a SQL.
 *
 * La apertura del turno es real y se queda: la caja termina utilizable, que es
 * como conviene dejar una maquina de trabajo.
 */
const pausa = (ms) => new Promise(r => setTimeout(r, ms));

/** Deja el servicio creyendo que hay turno, que es el estado que enganaba. */
const ENSUCIAR = `
  const host = document.querySelector('app-venta') || document.querySelector('app-touch-pos');
  const c = ng.getComponent(host);
  c['shift'].shift.set({ open: true, id: 999999, openedAt: new Date(), openingCash: 0 });
  return c['shift'].shift().open;
`;

export default async function ({ ev, cdp }) {
  let fallos = 0;
  const ok = (t, d = '') => console.log(`   ok     ${t}${d ? '  · ' + d : ''}`);
  const mal = (t, d = '') => { fallos++; console.log(`   FALLA  ${t}${d ? '  · ' + d : ''}`); };
  const seccion = (t) => console.log(`\n-- ${t}`);

  const ir = async (ruta, selector) => {
    await cdp('Page.navigate', { url: 'http://localhost:4200' + ruta });
    for (let k = 0; k < 20; k++) {
      await pausa(1000);
      const listo = await ev(`return !!document.querySelector('${selector}') && typeof ng !== 'undefined';`).catch(() => false);
      if (listo) return true;
    }
    return false;
  };
  const perfil = (p) => `
    const dash = document.querySelector('app-dashboard');
    if (dash) await ng.getComponent(dash).caps.setDeviceProfile('${p}');
    return true;
  `;
  const turnoEnSql = `
    const s = await window.electronAPI.getOpenShift({ user_id: null, register_id: 1 });
    return !!(s?.data?.id && s.data.closed_at == null);
  `;
  /** Marca con la que esta prueba firma los turnos que abre ella misma. */
  const FIRMA = 'QA turno';

  await ev(`
    const users = await window.electronAPI.getActiveUsers();
    const u = (users?.data ?? users?.recordset ?? users ?? [])[0];
    localStorage.setItem('usuarioActual', JSON.stringify({ id: u.id, nombre: u.usuario, rol: u.rol }));
    return true;
  `).catch(() => {});

  if (!await ir('/dashboard/estadisticas', 'app-dashboard')) {
    mal('no se llego al dashboard');
    console.log(`\nRESULTADO: ${fallos} FALLO(S)`);
    return { fallos };
  }
  const perfilOriginal = await ev(`
    const c = await window.electronAPI.getDeviceConfig();
    return (c?.data ?? c ?? {}).deviceProfile ?? 'RETAIL_POS';
  `);

  // La prueba necesita partir SIN turno. Si hay uno, solo se cierra cuando lo
  // abrio ella misma en una corrida anterior -lleva su firma en la nota-.
  // Cerrar el turno de trabajo de alguien seria escribir un corte real.
  const previo = await ev(`
    const s = await window.electronAPI.getOpenShift({ user_id: null, register_id: 1 });
    const d = s?.data;
    return d?.id && d.closed_at == null ? { id: d.id, nota: d.opening_note ?? null } : null;
  `);
  if (previo) {
    if (previo.nota !== FIRMA) {
      console.log('   ---- esta caja tiene un turno abierto que NO abrio esta prueba.');
      console.log('        No se cierra desde aqui: seria escribir un corte real en la base de');
      console.log('        trabajo. Cierralo desde Corte y vuelve a ejecutarla.');
      return { fallos: 0, omitida: true };
    }
    const cerrado = await ev(`
      const u = JSON.parse(localStorage.getItem('usuarioActual') || '{}');
      const r = await window.electronAPI.closeShift({
        closure_id: ${previo.id}, user_id: u.id ?? null, cash_delivered: 0, note: 'QA cierre' });
      return { ok: r?.success, error: r?.error };
    `);
    if (!cerrado.ok) {
      mal('no se pudo cerrar el turno que dejo la corrida anterior', String(cerrado.error));
      console.log(`
RESULTADO: ${fallos} FALLO(S)`);
      return { fallos };
    }
    console.log(`   se cerro el turno #${previo.id} que dejo la corrida anterior`);
  }
  console.log('   punto de partida: esta caja no tiene turno abierto');

  try {
    // ======================================================== RETAIL
    seccion('Retail sin turno pide abrirlo');
    await ev(perfil('RETAIL_POS'));
    if (!await ir('/dashboard/venta', 'app-venta')) {
      mal('no se llego a la pantalla de venta');
    } else {
      const r = await ev(`
        const v = ng.getComponent(document.querySelector('app-venta'));
        return { enMemoria: v.shiftOpen, modal: v.showOpenShiftModal, obligatorio: v.openShiftRequired };
      `);
      if (!r.enMemoria) ok('al entrar, el turno se lee de SQL y sale cerrado');
      else mal('la pantalla cree que hay turno');
      if (r.modal && r.obligatorio) ok('y se abre el modal de apertura, marcado como obligatorio');
      else mal('no se pidio abrir turno', JSON.stringify(r));

      seccion('Y no se fia del estado en memoria');
      const sucio = await ev(ENSUCIAR);
      const tras = await ev(`
        const v = ng.getComponent(document.querySelector('app-venta'));
        // Exactamente lo que hace al entrar: releer y decidir.
        await v['shift'].refresh();
        const ok = await v['ensureShiftOpen']('VENTA');
        return { permitido: ok, enMemoria: v.shiftOpen, modal: v.showOpenShiftModal };
      `);
      if (sucio === true && !tras.permitido && !tras.enMemoria)
        ok('con el estado viejo puesto, releer lo descarta y sigue bloqueado');
      else mal('el estado viejo dejo pasar', JSON.stringify(tras));

      seccion('SaleService se niega aunque se le llame directo');
      const co = await ev(`
        const v = ng.getComponent(document.querySelector('app-venta'));
        // Con el carrito vacio, checkout rechaza por el carrito y la prueba
        // pasaria sin haber tocado la guarda del turno. Se pone una linea real.
        await v.cargarProductosActivos();
        const p = v.productos.find(x => Number(x.stock) > 0) ?? v.productos[0];
        v['cart'].clearActive();
        if (p) v.seleccionarProducto(p);   // la misma ruta que el buscador
        v['shift'].shift.set({ open: true, id: 999999, openedAt: new Date(), openingCash: 0 });
        const total = v['cart'].total();
        const r = await v['sale'].checkout({ method: 'EFECTIVO', received: 999999 });
        v['cart'].clearActive();
        return { ok: r?.ok, error: r?.error, lineas: 1, total };
      `);
      if (co.ok === false && /turno/i.test(String(co.error)))
        ok('checkout rechaza por falta de turno, con el carrito lleno', String(co.error));
      else mal('checkout no bloqueo por el turno', JSON.stringify(co));
    }

    // ========================================================= TOUCH
    seccion('Touch sin turno bloquea el cobro');
    await ev(perfil('TOUCH_POS'));
    if (!await ir('/touch', 'app-touch-pos')) mal('no se llego a Touch');
    else {
      const t = await ev(`
        const t = ng.getComponent(document.querySelector('app-touch-pos'));
        const hoja = document.querySelector('app-touch-pos .tp-hoja--sm');
        return {
          hayTurno: t.hayTurno(),
          hojaAbierta: t.abrirTurno(),
          hojaEnPantalla: !!hoja,
          titulo: hoja?.querySelector('h3')?.textContent.trim() ?? null,
        };
      `);
      if (!t.hayTurno) ok('Touch tambien entra sabiendo que no hay turno');
      else mal('Touch cree que hay turno');
      // Lo que pedia el contrato: que se pida AL ENTRAR, no al llegar al cobro.
      if (t.hojaAbierta && t.hojaEnPantalla && /Abrir turno/i.test(t.titulo ?? ''))
        ok('y pide abrirlo nada mas entrar, con la hoja de siempre', t.titulo);
      else mal('Touch no pidio abrir turno al entrar', JSON.stringify(t));

      await ev(ENSUCIAR);
      const cobro = await ev(`
        const t = ng.getComponent(document.querySelector('app-touch-pos'));
        // Se cierra la hoja de apertura para poder tocar el menu, igual que
        // haria el cajero que quiere mirar antes de abrir turno.
        t.abrirTurno.set(false);
        await new Promise(s => setTimeout(s, 300));
        // Se agrega una linea: sin productos avisa del carrito, no del turno.
        const p = t.productos().find(x => Number(x.available_units ?? 1) > 0) ?? t.productos()[0];
        if (p) t.tocar(p);
        await new Promise(s => setTimeout(s, 300));
        await t.irACobro();
        await new Promise(s => setTimeout(s, 400));
        return { hayTurno: t.hayTurno(), aviso: t.aviso ? t.aviso() : null };
      `);
      if (/turno/i.test(String(cobro.aviso?.texto ?? '')))
        ok('al intentar cobrar avisa en vez de dejar', String(cobro.aviso?.texto));
      else mal('Touch no aviso al cobrar sin turno', JSON.stringify(cobro));
    }

    // ================================================ abrir y volver a vender
    seccion('Se abre el turno por el flujo de siempre y se vuelve a vender');
    // El perfil se cambia desde el dashboard: en /touch no existe app-dashboard
    // y el guard mandaria /dashboard/venta de vuelta a Touch.
    await ir('/dashboard/estadisticas', 'app-dashboard');
    await ev(perfil('RETAIL_POS'));
    if (!await ir('/dashboard/venta', 'app-venta')) mal('no se volvio a la pantalla de venta');
    else {
      const abierto = await ev(`
        const v = ng.getComponent(document.querySelector('app-venta'));
        v.abrirModalAbrirTurno(true);
        v.openingCash = 500;
        v.openingNote = '${FIRMA}';
        const p = v.confirmarAbrirTurno();
        await new Promise(s => setTimeout(s, 1500));
        // El aviso de exito cierra por animacion, y con la ventana oculta
        // Chromium la congela: se retira a mano para no quedarse esperandolo.
        document.querySelectorAll('.swal2-container').forEach(e => e.remove());
        await new Promise(s => setTimeout(s, 500));
        return { enMemoria: v.shiftOpen, id: v.shiftId, modal: v.showOpenShiftModal };
      `);
      if (abierto.enMemoria && abierto.id) ok('el turno queda abierto', `#${abierto.id}`);
      else mal('no se pudo abrir el turno', JSON.stringify(abierto));
      if (!abierto.modal) ok('y el modal se cierra solo');
      else mal('el modal de apertura se quedo abierto');

      const enSql = await ev(turnoEnSql);
      if (enSql) ok('y SQL lo confirma, no solo la pantalla');
      else mal('SQL no ve el turno abierto');

      const permite = await ev(`
        const v = ng.getComponent(document.querySelector('app-venta'));
        return { permitido: await v['ensureShiftOpen']('VENTA') };
      `);
      if (permite.permitido) ok('vender vuelve a estar permitido');
      else mal('sigue bloqueado con el turno abierto');
    }

  } finally {
    await ir('/dashboard/estadisticas', 'app-dashboard').catch(() => {});
    await ev(perfil(perfilOriginal)).catch(() => {});
    const fin = await ev(`
      const c = await window.electronAPI.getDeviceConfig();
      const s = await window.electronAPI.getOpenShift({ user_id: null, register_id: 1 });
      return { perfil: (c?.data ?? c ?? {}).deviceProfile, turno: !!s?.data?.id };
    `).catch(() => ({}));
    console.log(`\n   (perfil restaurado: ${fin.perfil} · turno de esta caja: ${fin.turno ? 'abierto' : 'sin turno'})`);
  }

  console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S)` : '\nRESULTADO: OK');
  return { fallos };
}
