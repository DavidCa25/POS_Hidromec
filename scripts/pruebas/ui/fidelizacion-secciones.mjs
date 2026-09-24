/**
 * Recorre las secciones de Fidelizacion en la ventana REAL y las fotografia.
 *
 *     npx ng serve
 *     npx electron ./electron/main.js --remote-debugging-port=9222
 *     node scripts/pruebas/conducir-app.mjs scripts/pruebas/ui/fidelizacion-secciones.mjs
 *
 * QA VISUAL, NO REDISENO. El backoffice ya tiene su lenguaje y no se toca
 * aqui: lo que se comprueba es que cada seccion pinta algo coherente, que
 * el estado vacio se ve como un estado vacio y no como una pantalla rota,
 * y que nada se desborda.
 *
 * SOLO LEE. No crea campanas, no sortea rifas, no canjea cupones: esta
 * corriendo contra la base de desarrollo de alguien.
 */
const SECCIONES = ['resumen', 'campanas', 'recompensas', 'cupones', 'dinamicas', 'rifas'];

export default async function ({ ev, captura }) {
  const informe = [];

  /* El rail lateral se fue: la entrada vive en la ventana de "Mas" del dock.
     Esa ventana solo se ABRE al pasar el cursor, pero el enlace esta en el
     arbol igualmente, asi que se puede encontrar y pulsar sin simular hover.
     Fidelizacion puede estar apagada: entonces ni siquiera hay entrada. */
  const ENLACE = `[...document.querySelectorAll('.wxdock__vira')]
      .find(a => /fidelizacion/i.test(a.getAttribute('routerLink') || a.getAttribute('href') || ''))`;

  const encendida = await ev(`return !!(${ENLACE});`);
  if (!encendida) {
    console.log('Fidelizacion esta apagada en esta base: no hay nada que fotografiar.');
    console.log('Enciendela en Aplicaciones y vuelve a lanzar el guion.');
    return;
  }

  await ev(`window.location.hash = ''; return true;`);
  await ev(`(${ENLACE}).click(); return true;`);
  await new Promise(r => setTimeout(r, 1200));

  for (const s of SECCIONES) {
    /* Se pulsa la pestana por su texto, no por un indice: reordenarlas no
       deberia romper la prueba, y si una desaparece hay que enterarse. */
    const pulsada = await ev(`
      // Las etiquetas llevan tilde -Campanas, Dinamicas- y el id no: se
      // comparan sin diacriticos para no depender de como se escriban.
      const sin = (t) => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      const b = [...document.querySelectorAll('.loy-nav button')]
        .find(x => sin(x.textContent).includes(sin(${JSON.stringify(s)})));
      if (!b) return false;
      b.click();
      return true;
    `);
    if (!pulsada) { informe.push({ seccion: s, error: 'no se encontro la pestana' }); continue; }

    await new Promise(r => setTimeout(r, 900));

    const m = await ev(`
      const sec = document.querySelector('.loy-sec');
      const doc = document.documentElement;
      return {
        pinta: !!sec && sec.getBoundingClientRect().height > 40,
        alto: sec ? Math.round(sec.getBoundingClientRect().height) : 0,
        desbordeH: doc.scrollWidth > window.innerWidth + 1,
        vacio: /no hay|todavia|aun no|sin /i.test((sec && sec.textContent) || ''),
        filas: document.querySelectorAll('.loy-sec tbody tr, .loy-sec .loy-item').length,
        texto: ((sec && sec.textContent) || '').replace(/\\s+/g, ' ').trim().slice(0, 110),
      };
    `);
    informe.push({ seccion: s, ...m });
    await captura(`docs/evidencias/fidelizacion/${s}.png`);
  }

  console.log('');
  for (const r of informe) {
    const estado = r.error ? `ERROR ${r.error}`
      : `${r.pinta ? 'ok  ' : 'VACIA'}  alto=${r.alto}  filas=${r.filas}` +
        `${r.desbordeH ? '  DESBORDA' : ''}${r.vacio ? '  (estado vacio)' : ''}`;
    console.log(`  ${r.seccion.padEnd(13)} ${estado}`);
    if (r.texto) console.log(`                ${r.texto}`);
  }

  const malas = informe.filter(r => r.error || !r.pinta || r.desbordeH);
  console.log(`\nRESULTADO: ${malas.length ? `${malas.length} seccion(es) con problema` : 'OK'}`);
}
