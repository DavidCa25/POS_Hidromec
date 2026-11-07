/**
 * Corre el OCR local sobre los tickets de prueba (dentro de Electron, con
 * nativeImage para decodificar, igual que en la app).
 *
 *     npx electron scripts/pruebas/compras-documentos/leer.cjs [archivo.png]
 */
const { app, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const ocr = require('../../../electron/ocr/motor.cjs');

app.whenReady().then(async () => {
  const dir = path.join(__dirname, 'tickets');
  const pedidos = process.argv.slice(2).filter(a => /\.(png|jpe?g|webp)$/i.test(a));
  const dirs = [dir, path.join(__dirname, 'tickets-web')].filter(d => fs.existsSync(d));
  const archivos = pedidos.length ? pedidos : dirs.flatMap(d => fs.readdirSync(d).filter(f => /\.(png|jpe?g|webp)$/i.test(f)).map(f => path.join(d, f)));
  for (const f of archivos) {
    let img = nativeImage.createFromBuffer(fs.readFileSync(f));
    if (img.isEmpty()) { console.log(`\n== ${path.basename(f)} · NO SE PUDO DECODIFICAR`); continue; }
    { const z = img.getSize(); if (Math.max(z.width, z.height) > 2400) img = img.resize(z.width >= z.height ? { width: 2400 } : { height: 2400 }); }
    const { width, height } = img.getSize();
    const r = await ocr.leer({ width, height, data: img.toBitmap() });
    const salida = f.replace(/\.(png|jpe?g|webp)$/i, '.ocr.json');
    fs.writeFileSync(salida, JSON.stringify(r, null, 2));
    console.log(`\n== ${path.basename(f)} · ${r.renglones.length} renglones · ${r.ms} ms`);
    for (const l of r.renglones) console.log(`  ${l.confianza.toFixed(2)}  ${l.texto}`);
  }
  app.quit();
});
