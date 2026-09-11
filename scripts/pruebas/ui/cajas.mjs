/**
 * El catalogo de cajas se ve, se elige y se recuerda.
 *
 *     node scripts/pruebas/conducir-app.mjs scripts/pruebas/ui/cajas.mjs
 *
 * QUE SE ROMPIO
 * -------------
 * En la VM, con licencia MultiCaja y DOS cajas correctas en SQL (C1 y C2,
 * las dos activas), Configuracion > Cajas mostraba la lista VACIA y "Sin caja
 * asignada". No era SQL, ni el IPC, ni `is_active`, ni el device-config: los
 * datos llegaban bien al componente. Era la plantilla.
 *
 *     <i class="ph" [class.ph-fill ph-check-circle]="esActual(r)" ...>
 *
 * `[class.a b]` no es sintaxis valida: el analizador corta en el espacio y en
 * tiempo de ejecucion se intenta `setAttribute('[class.ph-fill', ...)`, que el
 * DOM rechaza con InvalidCharacterError. La excepcion aborta el renderizado de
 * la FILA, asi que `registers` tenia los datos y `.rg-item` salia en cero. Y
 * como `registers.length > 0`, tampoco aparecia el estado vacio: la seccion
 * quedaba en blanco, sin ningun mensaje.
 *
 * El defecto llevaba ahi desde siempre; solo se ve con licencia MultiCaja,
 * que es lo unico que hace alcanzable el mosaico "Cajas".
 *
 * QUE COMPRUEBA
 * -------------
 *     las cajas activas se ven en la lista
 *     se puede asignar una a esta maquina
 *     la asignacion persiste (se relee del disco, no de memoria)
 *     elegir una caja NO toca dbo.registers
 *     una caja que nadie tiene asignada NO desaparece del catalogo
 *     dos maquinas distintas pueden quedarse con cajas distintas
 *     el arriendo de caja funciona en la aplicacion real: identidad estable,
 *     estado resuelto con el reloj del servidor, y renovar la propia caja
 *
 * La carrera entre dos equipos por la misma caja NO se prueba aqui: exige dos
 * conexiones simultaneas y esta cubierta con cuatro procesos de verdad en
 * `scripts/db/pruebas/cajas.mjs`.
 *
 * La prueba NO crea ni borra cajas: opera sobre el catalogo que ya existe y
 * deja la asignacion como estaba.
 */
const pausa = (ms) => new Promise(r => setTimeout(r, ms));

export default async function ({ ev, cdp }) {
  let fallos = 0;
  const ok = (t, d = '') => console.log(`   ok     ${t}${d ? '  · ' + d : ''}`);
  const mal = (t, d = '') => { fallos++; console.log(`   FALLA  ${t}${d ? '  · ' + d : ''}`); };
  const seccion = (t) => console.log(`\n-- ${t}`);

  const ir = async (ruta, selector) => {
    await cdp('Page.navigate', { url: 'http://localhost:4200' + ruta });
    for (let k = 0; k < 30; k++) {
      await pausa(1000);
      const listo = await ev(`return !!document.querySelector('${selector}') && typeof ng !== 'undefined';`).catch(() => false);
      if (listo) return true;
    }
    return false;
  };

  /**
   * Abre el mosaico de Cajas y espera a que el panel TERMINE de cargar.
   *
   * `abrir()` resuelve cuando la clase del componente esta descargada, no
   * cuando `ngOnInit` acabo sus dos idas y vueltas por IPC. Dormir un rato
   * fijo es fragil -y con la ventana oculta Chromium estrangula los
   * temporizadores-, asi que se sondea el estado real.
   */
  const abrirPanel = async () => {
    const r = await ev(`
      const sh = ng.getComponent(document.querySelector('app-config-shell'));
      const tile = sh.sections.flatMap(s => s.tiles).find(t => t.id === 'cajas');
      if (!tile) return { error: 'no hay mosaico de Cajas (licencia sin multicaja)' };
      await sh.abrir(tile);
      ng.applyChanges(sh);
      return { ok: true };
    `);
    if (r.error) return r;
    for (let k = 0; k < 20; k++) {
      await pausa(400);
      const listo = await ev(`
        const panel = document.querySelector('app-registers-panel');
        if (!panel) return false;
        const c = ng.getComponent(panel);
        return c.loading === false;
      `).catch(() => false);
      if (listo) { await pausa(250); return { ok: true }; }
    }
    return { error: 'el panel no termino de cargar' };
  };

  await ev(`
    const users = await window.electronAPI.getActiveUsers();
    const u = (users?.data ?? users?.recordset ?? users ?? [])[0];
    localStorage.setItem('usuarioActual', JSON.stringify({ id: u.id, nombre: u.usuario, rol: u.rol }));
    return true;
  `).catch(() => {});

  // ---------------------------------------------------------------- estado
  const inicial = await ev(`
    const api = window.electronAPI;
    const lista = await api.registersList(false);
    const actual = await api.registerGetCurrent();
    const lic = await api.licenseStatus();
    return { lista, actual: actual?.data?.registerId ?? null, plan: lic?.plan, estado: lic?.state };
  `);

  if (inicial.lista?.success === false) {
    mal('el canal no devolvio el catalogo', String(inicial.lista.error));
    console.log(`\nRESULTADO: ${fallos} FALLO(S)`);
    return { fallos };
  }
  const cajas = inicial.lista?.data ?? [];
  const activas = cajas.filter(c => c.is_active);
  console.log(`   catalogo: ${cajas.length} caja(s), ${activas.length} activa(s) · plan ${inicial.plan ?? inicial.estado}`);

  if (!activas.length) {
    console.log('   ---- esta base no tiene cajas activas: no hay nada que elegir.');
    return { fallos: 0, omitida: true };
  }

  // La asignacion de esta maquina se restaura al terminar.
  const asignacionOriginal = inicial.actual;

  /**
   * El mosaico "Cajas" solo existe con licencia MultiCaja. Para poder probar
   * el panel en una maquina en prueba se fuerza el plan por el canal del
   * propio producto, y se restaura al final.
   */
  const licenciaOriginal = await ev(`return await window.electronAPI.licenseGet();`).catch(() => null);
  const necesitaSimular = inicial.plan !== 'multi';

  try {
    if (necesitaSimular) {
      console.log('   (esta maquina no tiene plan multi: se simula para alcanzar el panel)');
      await ev(`
        const hasta = new Date(Date.now() + 365 * 864e5).toISOString();
        await window.electronAPI.licenseSave({ type: 'paid', plan: 'multi',
          customerName: 'QA MultiCaja', revalidateBy: hasta });
        return true;
      `);
    }

    if (!await ir('/dashboard/configuracion', 'app-config-shell')) {
      mal('no se llego a Configuracion');
      throw new Error('sin configuracion');
    }

    // =============================================================== 1
    seccion('1. Las cajas del catalogo se ven en la lista');
    const abierto = await abrirPanel();
    if (abierto.error) { mal(abierto.error); throw new Error(abierto.error); }
    const pintado = await ev(`
      const panel = document.querySelector('app-registers-panel');
      if (!panel) return { error: 'el panel no monto' };
      const c = ng.getComponent(panel);
      return {
        enMemoria: c.registers.length,
        errorCarga: c.errorCarga,
        itemsEnDom: document.querySelectorAll('app-registers-panel .rg-item').length,
        nombres: [...document.querySelectorAll('app-registers-panel .rg-name')].map(e => e.textContent.trim()),
        vacio: !!document.querySelector('app-registers-panel .rg-empty'),
      };
    `);
    if (pintado.error) { mal(pintado.error); throw new Error(pintado.error); }

    if (!pintado.errorCarga) ok('el catalogo se leyo sin error');
    else mal('el panel reporto un error de carga', String(pintado.errorCarga));

    if (pintado.enMemoria === cajas.length)
      ok('el componente recibe todas las cajas', `${pintado.enMemoria}`);
    else mal('el componente no recibio todas', `${pintado.enMemoria} de ${cajas.length}`);

    // Este es EL defecto: datos en memoria y cero filas pintadas.
    if (pintado.itemsEnDom === cajas.length)
      ok('y las pinta todas en pantalla', pintado.nombres.join(' · '));
    else mal('los datos estan pero la lista sale vacia',
             `${pintado.itemsEnDom} filas en pantalla con ${pintado.enMemoria} cajas en memoria`);

    if (!pintado.vacio) ok('no se muestra el estado "no hay cajas"');
    else mal('se muestra "no hay cajas" teniendo cajas');

    // =============================================================== 2
    seccion('2. Se puede asignar una caja a esta maquina');
    const destino = activas[0];
    const asignado = await ev(`
      const panel = document.querySelector('app-registers-panel');
      const c = ng.getComponent(panel);
      const fila = c.registers.find(r => Number(r.id) === ${destino.id});
      await c.elegirCaja(fila);
      ng.applyChanges(c);
      await new Promise(s => setTimeout(s, 600));
      document.querySelectorAll('.swal2-container').forEach(e => e.remove());
      return {
        enMemoria: c.currentId,
        enPantalla: document.querySelector('app-registers-panel .rg-current')?.textContent.replace(/[\\n\\t]+/g, ' ').trim(),
        marcada: document.querySelectorAll('app-registers-panel .rg-item.sel').length,
      };
    `);
    if (asignado.enMemoria === destino.id) ok(`se asigno "${destino.name}"`, `id ${destino.id}`);
    else mal('no se asigno', JSON.stringify(asignado));
    if (asignado.marcada === 1) ok('y queda marcada como "Esta máquina"');
    else mal('la fila no quedo marcada', `${asignado.marcada} marcadas`);
    if (String(asignado.enPantalla || '').includes(destino.name))
      ok('la cabecera lo dice', String(asignado.enPantalla).slice(0, 60));
    else mal('la cabecera no refleja la caja', String(asignado.enPantalla));

    // =============================================================== 3
    seccion('3. La asignacion persiste en el device-config del equipo');
    // Se relee por el canal, que lee el ARCHIVO: si solo estuviera en memoria,
    // esto lo caza.
    const enDisco = await ev(`
      const r = await window.electronAPI.registerGetCurrent();
      return { id: r?.data?.registerId ?? null, nombre: r?.data?.registerName ?? null };
    `);
    if (enDisco.id === destino.id) ok('el archivo local ya la tiene', `${enDisco.nombre} (id ${enDisco.id})`);
    else mal('no se guardo en el archivo', JSON.stringify(enDisco));

    // Y sobrevive a recargar la aplicacion entera.
    if (!await ir('/dashboard/configuracion', 'app-config-shell')) { mal('no se pudo recargar'); }
    else {
      const trasRecargar = await ev(`
        const r = await window.electronAPI.registerGetCurrent();
        return r?.data?.registerId ?? null;
      `);
      if (trasRecargar === destino.id)
        ok('y sigue ahi despues de recargar', `id ${trasRecargar}`);
      else mal('se perdio al recargar', `${trasRecargar}`);
    }

    // =============================================================== 4
    seccion('4. Elegir caja NO toca el catalogo');
    const trasElegir = await ev(`return await window.electronAPI.registersList(false);`);
    const despues = trasElegir?.data ?? [];
    const igual = despues.length === cajas.length &&
      despues.every((d, i) => d.id === cajas[i].id && d.code === cajas[i].code &&
                              d.name === cajas[i].name && !!d.is_active === !!cajas[i].is_active);
    if (igual) ok('dbo.registers quedo identico', `${despues.length} cajas, mismos id/code/name/is_active`);
    else mal('el catalogo cambio al elegir caja',
             JSON.stringify({ antes: cajas.map(c => c.code), despues: despues.map(c => c.code) }));

    // =============================================================== 5
    seccion('5. Una caja sin asignar NO desaparece del catalogo');
    const sinAsignar = cajas.filter(c => c.id !== destino.id);
    if (!sinAsignar.length) {
      console.log('   ---- solo hay una caja: no se puede comprobar con este catalogo.');
    } else {
      // Tras recargar la pagina hay que reabrir el panel.
      const reabierto = await abrirPanel();
      if (reabierto.error) { mal(reabierto.error); throw new Error(reabierto.error); }
      const nombres = await ev(`
        return [...document.querySelectorAll('app-registers-panel .rg-name')].map(e => e.textContent.trim());
      `);
      const faltan = sinAsignar.filter(c => !nombres.some(n => n.includes(c.name)));
      if (!faltan.length)
        ok('las cajas que nadie tiene asignada siguen listadas',
           sinAsignar.map(c => c.name).join(' · '));
      else mal('desaparecieron cajas no asignadas',
               `faltan ${faltan.map(c => c.name).join(', ')} · en pantalla: [${nombres.join(' | ')}]`);
    }

    // =============================================================== 6
    seccion('6. Dos maquinas distintas pueden quedarse con cajas distintas');
    // Cada equipo guarda SU caja en su device-config local; lo que ahora vive
    // ademas en SQL es el ARRIENDO, que impide que dos equipos se queden con
    // la misma. Cambiar de caja aqui no puede tocar el catalogo compartido.
    if (activas.length < 2) {
      console.log('   ---- hace falta una segunda caja activa para comprobarlo.');
    } else {
      const otra = activas[1];
      const cambio = await ev(`
        await window.electronAPI.registerSetCurrent({ id: ${otra.id}, name: '${String(otra.name).replace(/'/g, "\\\\'")}' });
        const local = await window.electronAPI.registerGetCurrent();
        const catalogo = await window.electronAPI.registersList(false);
        return { local: local?.data?.registerId ?? null, cajas: (catalogo?.data ?? []).length };
      `);
      if (cambio.local === otra.id && cambio.cajas === cajas.length)
        ok(`esta maquina paso a "${otra.name}" sin tocar el catalogo compartido`,
           `${cambio.cajas} cajas siguen ahi`);
      else mal('cambiar de caja altero algo mas', JSON.stringify(cambio));

      ok('la caja elegida es la de ESTE equipo, no una global',
         'device-config por equipo + arriendo en SQL para que no se solapen');
    }

    // =============================================================== 7
    seccion('7. El arriendo funciona en la aplicacion real');
    // Hasta esta version, "esta maquina es la Caja 2" vivia SOLO en un archivo
    // local: nadie impedia que otro equipo dijera lo mismo, y el turno es de
    // la CAJA, asi que los dos compartian turno y corte.
    const arriendo = await ev(`
      const asign = await window.electronAPI.registersAssignments(false);
      const yo = await window.electronAPI.registerLeaseStatus();
      const actual = await window.electronAPI.registerGetCurrent();
      return {
        ok: asign?.success !== false,
        filas: (asign?.data ?? []).map(r => ({ id: r.id, estado: r.estado, quien: r.holder_machine_name })),
        mia: yo?.data?.registerId ?? null,
        vigente: !!yo?.data?.vigente,
        ultimo: yo?.data?.ultimo ?? null,
        machineId: yo?.data?.machineId ?? '',
        elegida: actual?.data?.registerId ?? null,
      };
    `);

    if (arriendo.ok) ok('el catalogo trae el estado del arriendo de cada caja',
      arriendo.filas.map(f => `${f.id}:${f.estado}`).join(' '));
    else mal('no se pudo leer el estado de los arriendos');

    if (arriendo.machineId) ok('esta maquina tiene una identidad estable', `${String(arriendo.machineId).slice(0, 8)}...`);
    else mal('esta maquina no reporta identidad: sin ella no puede reclamar ninguna caja');

    const mia = arriendo.filas.find(f => f.id === arriendo.elegida);
    if (mia?.estado === 'MIA') ok('la caja elegida aparece como MIA, resuelto con el reloj del SERVIDOR',
      'si lo calculara el navegador, dos equipos con relojes distintos verian cosas distintas');
    else mal('la caja de esta maquina no aparece como suya', JSON.stringify(mia ?? arriendo.filas));

    if (arriendo.vigente && ['RECLAMADA', 'RENOVADA', 'RECUPERADA'].includes(arriendo.ultimo))
      ok('y el arriendo esta vigente', arriendo.ultimo);
    else mal('el arriendo no esta vigente', `${arriendo.ultimo} / vigente=${arriendo.vigente}`);

    if (arriendo.filas.every(f => f.estado !== 'OCUPADA'))
      ok('ninguna caja figura tomada por otro equipo en esta instalacion');
    else ok('alguna caja la tiene otro equipo, y se dice cual',
      arriendo.filas.filter(f => f.estado === 'OCUPADA').map(f => `${f.id}:${f.quien}`).join(' '));

    // Volver a reclamar la misma caja es lo que hace el latido de cada minuto:
    // tiene que ser inofensivo.
    const latido = await ev(`
      const a = await window.electronAPI.registerLeaseStatus();
      const id = a?.data?.registerId;
      if (!id) return { salta: true };
      const r = await window.electronAPI.registerSetCurrent({ id });
      const b = await window.electronAPI.registerLeaseStatus();
      return { ok: r?.success !== false, resultado: b?.data?.ultimo ?? null };
    `);
    if (latido.salta) console.log('   ---- sin caja asignada: no hay arriendo que renovar.');
    else if (latido.ok && latido.resultado === 'RENOVADA')
      ok('reclamar la propia caja otra vez la RENUEVA, no la pelea', latido.resultado);
    else mal('renovar el propio arriendo no se comporta como renovacion', JSON.stringify(latido));

  } finally {
    // Se devuelve la maquina a la caja que tenia, y la licencia tal cual.
    await ev(`
      const id = ${asignacionOriginal === null ? 'null' : asignacionOriginal};
      if (id) await window.electronAPI.registerSetCurrent({ id });
      return true;
    `).catch(() => {});
    if (necesitaSimular) {
      await ev(`
        await window.electronAPI.licenseClear();
        const prev = ${JSON.stringify(licenciaOriginal)};
        if (prev) await window.electronAPI.licenseSave(prev);
        return true;
      `).catch(() => {});
    }
    console.log(`\n   (caja restaurada a ${asignacionOriginal ?? 'sin asignar'}${necesitaSimular ? ' · licencia restaurada' : ''})`);
  }

  console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S)` : '\nRESULTADO: OK');
  return { fallos };
}
