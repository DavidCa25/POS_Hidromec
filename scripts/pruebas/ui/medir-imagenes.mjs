/**
 * Cuanto cuesta el catalogo con imagenes.
 *
 *     node scripts/pruebas/conducir-app.mjs scripts/pruebas/ui/medir-imagenes.mjs
 *
 * Mide las dos mitades por separado, porque tienen costes muy distintos:
 *   - `images:sync` en frio: lee de SQL, escribe el cache y convierte;
 *   - `images:sync` en caliente: solo lee el cache y convierte;
 *   - el ciclo completo del Touch, hasta que la rejilla tiene sus miniaturas.
 *
 * Los productos sinteticos se crean y se borran desde SQL, fuera de este
 * guion. Vaciar el cache de miniaturas antes de la corrida da el dato frio.
 */
export default async function ({ ev }) {
  const r = await ev(`
    const t = ng.getComponent(document.querySelector('app-touch-pos'));
    if (!t) return { error: 'el Touch no esta montado: ' + location.href };

    if (window.gc) window.gc();
    const heap = () => performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null;
    const heapAntes = heap();

    // --- catalogo (sin imagenes)
    const t0 = performance.now();
    await t.menu.load(true);
    for (let i = 0; i < 60 && t.cargando(); i++) await new Promise(s => setTimeout(s, 100));
    const msCatalogo = Math.round(performance.now() - t0);

    const prods = t.productos();
    const conVersion = prods.filter(function (p) { return p.image_version > 0; }).length;

    // --- se espera a que la rejilla tenga TODAS sus miniaturas, con tope.
    let conThumb = 0;
    for (let i = 0; i < 200; i++) {
      conThumb = t.productos().filter(function (p) { return p.thumb; }).length;
      if (conThumb >= conVersion) break;
      await new Promise(s => setTimeout(s, 100));
    }
    const msHastaImagenes = Math.round(performance.now() - t0);

    // --- coste de una sincronizacion ya con el cache caliente
    const versiones = {};
    for (const p of t.productos()) if (p.image_version > 0) versiones[p.id] = p.image_version;
    const t1 = performance.now();
    const res = await window.wybix.images.sync({ versions: versiones });
    const msCaliente = Math.round(performance.now() - t1);

    let bytes = 0;
    for (const p of t.productos()) if (p.thumb) bytes += p.thumb.length;

    return {
      productos: t.productos().length,
      conImagenEnBase: conVersion,
      convertidasADataUrl: conThumb,
      completadas: conThumb >= conVersion,
      imagenesEnElDom: document.querySelectorAll('.tp-card__media img').length,
      msCatalogo: msCatalogo,
      msHastaImagenes: msHastaImagenes,
      msSyncCacheCaliente: msCaliente,
      descargadasDeSQL: res?.data?.descargadas ?? null,
      mbDataUrls: +(bytes / 1048576).toFixed(2),
      heapAntesMB: heapAntes,
      heapDespuesMB: heap()
    };
  `);
  console.log(JSON.stringify(r, null, 2));
  return r;
}
