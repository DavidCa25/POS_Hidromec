/**
 * Lo que cuesta refrescar el catalogo cuando NINGUNA imagen cambio.
 *
 *     node scripts/pruebas/conducir-app.mjs scripts/pruebas/ui/medir-resync.mjs
 *
 * Es el caso real despues de cada venta: el Touch llama a `menu.load(true)`
 * para refrescar existencias y disponibilidad. Las fotos no cambiaron, asi
 * que no deberian volver a pedirse, ni convertirse, ni viajar por IPC.
 *
 * Como se mide: NO se puede envolver `window.wybix.images.sync` para espiar,
 * porque contextBridge expone objetos inmutables y el parche se ignora en
 * silencio. Lo que si se observa es el efecto: justo despues de recargar el
 * catalogo, los productos que quedan SIN miniatura son exactamente los que
 * el servicio va a pedir. Si son cero, no hay llamada, ni conversion a
 * base64, ni bytes por IPC.
 */
export default async function ({ ev }) {
  const r = await ev(`
    const t = ng.getComponent(document.querySelector('app-touch-pos'));
    if (!t) return { error: 'el Touch no esta montado: ' + location.href };

    const heap = () => performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null;
    const conImagen = () => t.productos().filter(function (p) { return p.image_version > 0; }).length;
    const conMiniatura = () => t.productos().filter(function (p) { return p.thumb; }).length;
    // Lo que el servicio pedira: se reproduce su criterio (version resuelta
    // en la cache del renderer, tenga miniatura o no).
    const porPedir = () => {
      const m = t.menu.miniaturas;
      return t.productos().filter(function (p) {
        if (p.image_version <= 0) return false;
        const previa = m.get(p.id);
        return !(previa && previa.version === p.image_version);
      }).length;
    };

    const medida = async (etiqueta) => {
      if (window.gc) window.gc();
      const h0 = heap();
      const t0 = performance.now();
      await t.menu.load(true);
      for (let i = 0; i < 60 && t.cargando(); i++) await new Promise(s => setTimeout(s, 100));

      // Instante en que el catalogo ya esta puesto: lo que falte aqui es lo
      // que se va a pedir.
      const pendientes = porPedir();
      const msCatalogo = Math.round(performance.now() - t0);

      // Se espera a que la rejilla quede completa.
      for (let i = 0; i < 200; i++) {
        if (porPedir() === 0) break;
        await new Promise(s => setTimeout(s, 100));
      }
      const msTotal = Math.round(performance.now() - t0);

      let bytes = 0;
      for (const p of t.productos()) if (p.thumb) bytes += p.thumb.length;
      return {
        etiqueta,
        productos: t.productos().length,
        conImagen: conImagen(),
        conMiniatura: conMiniatura(),
        imagenesQueSePiden: pendientes,
        mbPorIPC: +(pendientes * 8767 / 1048576).toFixed(3),
        msCatalogo,
        msTotal,
        mbEnMemoria: +(bytes / 1048576).toFixed(2),
        heap: h0 + ' -> ' + heap()
      };
    };

    const salida = [];
    salida.push(await medida('recarga tras venta #1'));
    salida.push(await medida('recarga tras venta #2'));
    salida.push(await medida('recarga tras venta #3'));
    return salida;
  `);

  if (r.error) { console.log(r.error); return r; }
  for (const m of r) {
    console.log(`\n${m.etiqueta}`);
    console.log(`  ${m.productos} productos · ${m.conImagen} con imagen · ${m.conMiniatura} con miniatura puesta`);
    console.log(`  imagenes que se piden: ${m.imagenesQueSePiden}  (~${m.mbPorIPC} MB por IPC)`);
    console.log(`  catalogo ${m.msCatalogo} ms · completo ${m.msTotal} ms · ${m.mbEnMemoria} MB en memoria · heap ${m.heap}`);
  }
  // El criterio es que no se pida nada. Un producto puede quedarse sin
  // miniatura legitimamente: si le borraron la foto, no hay nada que traer.
  const ok = r.every(m => m.imagenesQueSePiden === 0);
  console.log(`\n${ok ? 'PASS' : 'FALLA'}: refrescar el catalogo no vuelve a pedir imagenes.`);
  return r;
}
