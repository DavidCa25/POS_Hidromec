/**
 * Invalidacion de miniaturas por version.
 *
 *     node scripts/pruebas/conducir-app.mjs scripts/pruebas/ui/medir-invalidacion.mjs
 *
 * Comprueba que cambiar UNA foto invalida esa y solo esa. Se mide por el
 * efecto -que productos quedan sin miniatura justo despues de recargar el
 * catalogo-, no espiando el puente: contextBridge expone objetos inmutables
 * y envolverlos no intercepta nada.
 *
 * El cambio de imagen se hace por el camino real (wybix.images.set), el
 * mismo que usa el backoffice, y con una foto DISTINTA para que se note.
 */
const pausa = (ms) => new Promise(r => setTimeout(r, ms));

export default async function ({ ev }) {
  const r = await ev(`
    const t = ng.getComponent(document.querySelector('app-touch-pos'));
    if (!t) return { error: 'el Touch no esta montado: ' + location.href };

    const porPedir = () => t.productos().filter(function (p) { return p.image_version > 0 && !p.thumb; });
    const leer = (id) => t.productos().find(function (p) { return p.id === id; });

    // Punto de partida: catalogo completo.
    await t.menu.load(true);
    for (let i = 0; i < 60 && t.cargando(); i++) await new Promise(s => setTimeout(s, 100));
    for (let i = 0; i < 200 && porPedir().length; i++) await new Promise(s => setTimeout(s, 100));

    const objetivo = t.productos().find(function (p) { return p.image_version > 0; });
    const otro = t.productos().find(function (p) { return p.id !== objetivo.id && p.image_version > 0; });
    const antes = {
      id: objetivo.id, nombre: objetivo.product_name,
      version: objetivo.image_version, thumb: objetivo.thumb
    };
    const otroAntes = { id: otro.id, thumb: otro.thumb };

    // Una foto DISTINTA, para que el cambio sea visible en los bytes.
    const blob = await (await fetch('assets/mechanics.jpg')).blob();
    const dataUrl = await new Promise(function (ok) {
      const fr = new FileReader(); fr.onload = function () { ok(fr.result); }; fr.readAsDataURL(blob);
    });
    const res = await window.wybix.images.set({ productId: antes.id, dataUrl: dataUrl });

    // Refresco del catalogo, igual que despues de una venta.
    await t.menu.load(true);
    for (let i = 0; i < 60 && t.cargando(); i++) await new Promise(s => setTimeout(s, 100));

    // Justo aqui: lo que falte es exactamente lo que se va a pedir.
    const pendientes = porPedir().map(function (p) { return p.id; });

    for (let i = 0; i < 200 && porPedir().length; i++) await new Promise(s => setTimeout(s, 100));

    const despues = leer(antes.id);
    const otroDespues = leer(otro.id);
    return {
      producto: antes.nombre,
      versionAntes: antes.version,
      versionDespues: despues.image_version,
      guardado: res?.success,
      seInvalidaron: pendientes,
      soloEseSeInvalido: pendientes.length === 1 && pendientes[0] === antes.id,
      recuperoMiniatura: !!despues.thumb,
      miniaturaEsOtra: despues.thumb !== antes.thumb,
      bytesAntes: antes.thumb ? antes.thumb.length : 0,
      bytesDespues: despues.thumb ? despues.thumb.length : 0,
      otroConservoLaSuya: otroDespues.thumb === otroAntes.thumb,
      sinMiniaturaAlFinal: porPedir().length
    };
  `);

  if (r.error) { console.log(r.error); return r; }
  console.log(`\nCambio de foto en "${r.producto}"`);
  console.log(`  image_version ${r.versionAntes} -> ${r.versionDespues} (guardado: ${r.guardado})`);
  console.log(`  se invalidaron: ${JSON.stringify(r.seInvalidaron)}  · solo ese: ${r.soloEseSeInvalido}`);
  console.log(`  recupero miniatura: ${r.recuperoMiniatura} · es otra imagen: ${r.miniaturaEsOtra} (${r.bytesAntes} -> ${r.bytesDespues} bytes)`);
  console.log(`  los demas conservaron la suya: ${r.otroConservoLaSuya} · sin miniatura al final: ${r.sinMiniaturaAlFinal}`);

  const ok = r.soloEseSeInvalido && r.recuperoMiniatura && r.miniaturaEsOtra &&
             r.otroConservoLaSuya && r.sinMiniaturaAlFinal === 0;
  console.log(`\n${ok ? 'PASS' : 'FALLA'}: solo se invalida y se vuelve a pedir la imagen que cambio.`);
  return r;
}
