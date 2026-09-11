/**
 * Cambiar de experiencia o de giro surte efecto AHORA, sin reiniciar.
 *
 *     node scripts/pruebas/conducir-app.mjs scripts/pruebas/ui/perfiles-en-caliente.mjs
 *
 * QUE SE ROMPIO
 * -------------
 * Dos defectos con la misma forma: un estado que solo se leia una vez.
 *
 *   EXPERIENCIA DE CAJA   La unica linea que miraba `deviceProfile` estaba en
 *                        el login. Dentro, "Hacer venta" era un enlace fijo a
 *                        /dashboard/venta. Elegir Touch en Configuracion
 *                        guardaba el JSON y actualizaba el estado, pero
 *                        ninguna decision de navegacion volvia a preguntarlo:
 *                        parecia que hacia falta cerrar sesion.
 *
 *   GIRO DEL NEGOCIO      Al terminar el asistente solo se ocultaba el
 *                        asistente. Las capacidades se habian cargado cuando
 *                        todavia no existia configuracion, y nadie las releia:
 *                        Hospitality no aparecia hasta el siguiente arranque.
 *
 * COMO SE PRUEBA
 * --------------
 * Sobre la aplicacion REAL y sus servicios reales: se cambia por la misma via
 * que usa el usuario (`CapabilityService`, que persiste y actualiza el
 * estado), se navega de verdad por el router y se mira donde acaba. No se
 * simula ningun servicio: si el guard o la persistencia se rompen, esto falla.
 *
 * Los dos ejes son INDEPENDIENTES y la prueba lo exige: Hospitality no
 * implica Touch y Touch no implica Hospitality.
 *
 * Todo lo que se toca se restaura al final: el perfil de la caja, el giro del
 * negocio y la sesion.
 */
const pausa = (ms) => new Promise(r => setTimeout(r, ms));

export default async function ({ ev }) {
  let fallos = 0;
  const ok = (t, d = '') => console.log(`   ok     ${t}${d ? '  · ' + d : ''}`);
  const mal = (t, d = '') => { fallos++; console.log(`   FALLA  ${t}${d ? '  · ' + d : ''}`); };
  const seccion = (t) => console.log(`\n-- ${t}`);

  // El inyector de la raiz no da acceso por token sin importar la clase, asi
  // que se toma la instancia por un componente que ya la inyecta: es la MISMA
  // (providedIn: 'root'), no una copia.
  const preparar = `
    const dash = document.querySelector('app-dashboard');
    const caps = dash ? ng.getComponent(dash).caps : null;
  `;

  // -------------------------------------------------- sesion y dashboard
  await ev(`
    const users = await window.electronAPI.getActiveUsers();
    const u = (users?.data ?? users?.recordset ?? users ?? [])[0];
    localStorage.setItem('usuarioActual', JSON.stringify({ id: u.id, nombre: u.usuario, rol: u.rol }));
    location.href = location.origin + '/dashboard/estadisticas';
    return true;
  `);
  await pausa(7000);

  const inicial = await ev(`
    ${preparar}
    if (!caps) return { error: 'no se llego al dashboard (ruta ' + location.pathname + ')' };
    await caps.load(true);
    return {
      deviceProfile: caps.deviceProfile(),
      businessProfile: caps.businessProfile(),
      rutaDeVenta: caps.rutaDeVenta,
      sesion: localStorage.getItem('usuarioActual'),
    };
  `);
  if (inicial.error) { mal(inicial.error); console.log(`\nRESULTADO: ${fallos} FALLO(S)`); return { fallos }; }
  console.log(`   estado de partida: ${inicial.businessProfile} / ${inicial.deviceProfile}`);

  /** Cambia el perfil por el servicio real y navega a la venta como el menu. */
  const cambiarYVender = (perfil) => `
    ${preparar}
    await caps.setDeviceProfile('${perfil}');
    const leido = await window.electronAPI.getDeviceConfig();
    const trasGuardar = {
      enMemoria: caps.deviceProfile(),
      rutaDeVenta: caps.rutaDeVenta,
      // Lo que quedo en disco, leido otra vez desde el proceso principal.
      enDisco: (leido?.data ?? leido ?? {}).deviceProfile,
      sesion: localStorage.getItem('usuarioActual'),
    };
    // Se pulsa "Hacer venta" como lo hace el usuario: el enlace del menu.
    const enlace = [...document.querySelectorAll('a.dropdown-item')]
      .find(a => /Hacer venta/i.test(a.textContent || ''));
    if (enlace) enlace.click();
    await new Promise(s => setTimeout(s, 2500));
    trasGuardar.rutaFinal = location.pathname;
    trasGuardar.pantalla = document.querySelector('app-touch-pos') ? 'touch'
                         : document.querySelector('app-venta') ? 'retail' : '(ninguna)';
    trasGuardar.sesionDespues = localStorage.getItem('usuarioActual');
    return trasGuardar;
  `;

  const volverAlDashboard = `
    location.href = location.origin + '/dashboard/estadisticas';
    return true;
  `;

  try {
    // ======================================================= experiencia
    seccion('Cambiar la experiencia de esta caja, sin reiniciar ni salir');

    for (const [perfil, esperado, pantalla] of [
      ['TOUCH_POS',  '/touch',           'touch'],
      ['RETAIL_POS', '/dashboard/venta', 'retail'],
      ['BACKOFFICE', '/dashboard/venta', 'retail'],
      ['TOUCH_POS',  '/touch',           'touch'],
    ]) {
      await ev(volverAlDashboard);
      await pausa(4000);
      const r = await ev(cambiarYVender(perfil));

      if (r.enMemoria === perfil) ok(`${perfil}: el estado en memoria cambia al instante`);
      else mal(`${perfil}: el estado en memoria quedo en ${r.enMemoria}`);

      if (r.enDisco === perfil) ok(`${perfil}: y queda persistido para el proximo arranque`, r.enDisco);
      else mal(`${perfil}: no se persistio`, String(r.enDisco));

      if (r.rutaFinal === esperado && r.pantalla === pantalla)
        ok(`${perfil}: "Hacer venta" abre ${pantalla}`, r.rutaFinal);
      else mal(`${perfil}: "Hacer venta" acabo en ${r.rutaFinal} (${r.pantalla}), se esperaba ${esperado}`);

      if (r.sesionDespues && r.sesionDespues === inicial.sesion)
        ok(`${perfil}: la sesion sigue intacta`, 'no hubo logout');
      else mal(`${perfil}: la sesion cambio o se perdio`, String(r.sesionDespues));
    }

    // ============================================================== giro
    // La ultima iteracion deja la ventana en Touch, donde no hay dashboard:
    // hay que volver antes de leer el menu lateral.
    await ev(volverAlDashboard);
    await pausa(5000);
    seccion('El giro del negocio se refresca sin reiniciar');
    const giro = await ev(`
      ${preparar}
      const antes = caps.businessProfile();
      // Se escribe por el mismo canal que usa el asistente y Configuracion,
      // conservando el resto de la ficha: ese SP no protege los demas campos.
      const cfg = await window.electronAPI.getConfig();
      const d = cfg?.data ?? cfg ?? {};
      const guardar = (perfil) => window.electronAPI.updateBusinessConfig({
        business_name: d.business_name, address: d.address, phone: d.phone,
        rfc: d.rfc, ticket_footer: d.ticket_footer, business_profile: perfil,
      });

      const res = await guardar('HOSPITALITY');
      if (!res?.success) return { error: res?.error || 'no se pudo guardar HOSPITALITY' };
      await caps.load(true);
      const conHospitality = {
        businessProfile: caps.businessProfile(),
        hospitality: caps.hospitality,
        // Los dos ejes son independientes: cambiar el giro no toca la caja.
        deviceProfile: caps.deviceProfile(),
        recetasEnElMenu: !!document.querySelector('a[href="/dashboard/recetas"]'),
      };

      await guardar(antes);
      await caps.load(true);
      const restaurado = {
        businessProfile: caps.businessProfile(),
        hospitality: caps.hospitality,
        recetasEnElMenu: !!document.querySelector('a[href="/dashboard/recetas"]'),
      };
      return { antes, conHospitality, restaurado };
    `);

    if (giro.error) mal('no se pudo cambiar el giro', giro.error);
    else {
      if (giro.conHospitality.businessProfile === 'HOSPITALITY' && giro.conHospitality.hospitality)
        ok('HOSPITALITY queda activo en memoria sin reiniciar');
      else mal('HOSPITALITY no llego a las capacidades', JSON.stringify(giro.conHospitality));

      if (giro.conHospitality.recetasEnElMenu)
        ok('"Recetas y modificadores" aparece en el menu sin recargar');
      else mal('el menu no mostro "Recetas y modificadores"');

      if (giro.conHospitality.deviceProfile === 'TOUCH_POS')
        ok('y el perfil de la caja no se toco: los dos ejes son independientes', giro.conHospitality.deviceProfile);
      else mal('cambiar el giro movio el perfil del dispositivo', giro.conHospitality.deviceProfile);

      if (!giro.restaurado.hospitality && !giro.restaurado.recetasEnElMenu)
        ok(`el giro vuelve a ${giro.antes} y el menu tambien`);
      else mal('no se restauro el giro original', JSON.stringify(giro.restaurado));
    }

    // ================================================== ortogonalidad
    seccion('Touch sin Hospitality');
    const orto = await ev(`
      ${preparar}
      return {
        deviceProfile: caps.deviceProfile(),
        businessProfile: caps.businessProfile(),
        hospitality: caps.hospitality,
        touchPos: caps.touchPos,
        recetasEnElMenu: !!document.querySelector('a[href="/dashboard/recetas"]'),
      };
    `);
    if (orto.touchPos && !orto.hospitality && !orto.recetasEnElMenu)
      ok('una caja Touch en un negocio Retail no gana capacidades de Hospitality',
         `${orto.businessProfile} / ${orto.deviceProfile}`);
    else mal('los ejes se contaminaron', JSON.stringify(orto));

  } finally {
    await ev(volverAlDashboard).catch(() => {});
    await pausa(4500);
    const fin = await ev(`
      ${preparar}
      if (caps) await caps.setDeviceProfile('${inicial.deviceProfile}');
      return {
        deviceProfile: caps ? caps.deviceProfile() : null,
        businessProfile: caps ? caps.businessProfile() : null,
      };
    `);
    console.log(`\n   (restaurado: ${fin.businessProfile} / ${fin.deviceProfile})`);
  }

  console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S)` : '\nRESULTADO: OK');
  return { fallos };
}
