/**
 * Lo que dicen las pantallas sobre la licencia.
 *
 *     node scripts/pruebas/conducir-app.mjs scripts/pruebas/ui/licencia-texto.mjs
 *
 * En la prueba sobre maquina limpia, una instalacion en periodo de prueba
 * anunciaba "Licencia MonoCaja activada" con un sello de verificacion: le
 * decia al cliente que habia comprado un plan que nadie compro, y de paso le
 * escondia que la prueba termina.
 *
 * La causa no era el texto sino de donde salia. El asistente resolvia un
 * getter binario -multicaja si o no- que ademas leia el objeto de licencia
 * heredado en vez de `estado`, que es lo que calcula Electron y lo que usa el
 * resto de la aplicacion. Sin un tercer valor posible, la prueba caia siempre
 * del lado de "MonoCaja".
 *
 * No se toca nada criptografico ni de caducidad: solo se comprueba que cada
 * estado se llame por su nombre. El estado real se restaura al terminar.
 *
 * NOTA DE METODO: el estado del servicio se lee en el MISMO tick en que se
 * inyecta. `SetupInicial.ngOnInit` llama a `license.iniciar()`, que vuelve a
 * leer el estado real desde Electron y resuelve mas tarde; leerlo despues de
 * esperar al DOM medía la maquina, no el caso.
 */
const pausa = (ms) => new Promise(r => setTimeout(r, ms));

/** Monta el asistente y deja que `iniciar()` termine antes de medir nada. */
const MONTAR = `
  const app = ng.getComponent(document.querySelector('app-root'));
  app.necesitaSetup = true;
  ng.applyChanges(app);
  await new Promise(s => setTimeout(s, 4000));
  return !!document.querySelector('app-setup-inicial');
`;

/** Inyecta un estado y devuelve lo que dice el servicio y lo que se ve. */
const conEstado = (estado) => `
  const app = ng.getComponent(document.querySelector('app-root'));
  app.license.estado = ${JSON.stringify(estado)};

  // Sin esperas por medio: si algo pisa el estado despues, ya no es este caso.
  const servicio = {
    enPrueba: app.license.enPrueba,
    planTexto: app.license.planTexto,
    dias: app.license.textoDiasPrueba,
  };

  app.necesitaSetup = true;
  ng.applyChanges(app);
  const asistente = document.querySelector('app-setup-inicial');
  if (asistente) ng.applyChanges(ng.getComponent(asistente));
  await new Promise(s => setTimeout(s, 700));

  const badge = document.querySelector('.su-badge-plan');
  return {
    servicio,
    hayAsistente: !!document.querySelector('app-setup-inicial'),
    texto: badge ? badge.textContent.trim().replace(/\\s+/g, ' ') : null,
    icono: badge?.querySelector('i')?.className || null,
    esPrueba: badge ? badge.classList.contains('es-prueba') : null,
  };
`;

export default async function ({ ev }) {
  let fallos = 0;
  const ok = (t, d = '') => console.log(`   ok     ${t}${d ? '  · ' + d : ''}`);
  const mal = (t, d = '') => { fallos++; console.log(`   FALLA  ${t}${d ? '  · ' + d : ''}`); };

  const original = await ev(`
    const app = ng.getComponent(document.querySelector('app-root'));
    return { estado: app.license.estado, necesitaSetup: app.necesitaSetup };
  `);

  try {
    const montado = await ev(MONTAR);
    if (!montado) { mal('el asistente no llego a montarse'); throw new Error('sin asistente'); }

    // --------------------------------------------------------- en prueba
    console.log('\n-- Instalacion en periodo de prueba');
    let r = await ev(conEstado({ state: 'trial', daysRemaining: 12 }));
    if (/MonoCaja|MultiCaja/i.test(r.texto || '')) mal('la insignia sigue nombrando un plan', r.texto);
    else ok('la insignia no nombra ningun plan', r.texto);
    if (/[Pp]rueba/.test(r.texto || '') && /12/.test(r.texto || '')) ok('dice que es una prueba y cuanto queda', r.texto);
    else mal('no dice que es una prueba con los dias que quedan', r.texto);
    if (/seal-check/.test(r.icono || '')) mal('conserva el sello de verificacion sobre una prueba', r.icono);
    else ok('el icono acompaña al texto', r.icono);
    if (r.esPrueba) ok('y no se pinta con el verde de exito');
    else mal('sigue pintada como un logro conseguido');
    if (r.servicio.planTexto === 'Prueba gratuita') ok('LicenseService.planTexto dice lo mismo', r.servicio.planTexto);
    else mal('LicenseService.planTexto no reconoce la prueba', r.servicio.planTexto);

    // ------------------------------------------------------ un solo dia
    r = await ev(conEstado({ state: 'trial', daysRemaining: 1 }));
    if (/1 día restante/.test(r.texto || '')) ok('con un dia lo dice en singular', r.texto);
    else mal('el ultimo dia se lee mal', r.texto);

    // ------------------------------------------------------ ya comprada
    console.log('\n-- Licencia de pago');
    r = await ev(conEstado({ state: 'active', plan: 'mono' }));
    if (/Licencia MonoCaja activada/.test(r.texto || '')) ok('MonoCaja se anuncia como antes', r.texto);
    else mal('MonoCaja dejo de anunciarse bien', r.texto);
    if (/seal-check/.test(r.icono || '')) ok('y ahi si lleva sello de verificacion');
    else mal('perdio el sello donde si corresponde', r.icono);
    if (r.servicio.planTexto === 'MonoCaja') ok('el servicio tambien lo llama MonoCaja');
    else mal('el servicio no coincide con la pantalla', r.servicio.planTexto);

    r = await ev(conEstado({ state: 'active', plan: 'multi' }));
    if (/Licencia MultiCaja activada/.test(r.texto || '')) ok('MultiCaja se anuncia como antes', r.texto);
    else mal('MultiCaja no se anuncia bien', r.texto);

  } finally {
    await ev(`
      const app = ng.getComponent(document.querySelector('app-root'));
      app.license.estado = ${JSON.stringify(original.estado)};
      app.necesitaSetup = ${JSON.stringify(original.necesitaSetup)};
      ng.applyChanges(app);
      return true;
    `);
    await pausa(600);
    console.log(`\n   (estado de licencia restaurado: ${original.estado?.state})`);
  }

  console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S)` : '\nRESULTADO: OK');
  return { fallos };
}
