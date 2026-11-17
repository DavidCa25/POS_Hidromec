/* Prepara Wybix_E2E_Landing: demo retail como la crea el gestor + escaparate.sql. */
const fs = require('node:fs');
const path = require('node:path');
const { prepararDemoReal } = require('../../e2e/demo-real');
const BASE = 'Wybix_E2E_Landing';
(async () => {
  const r = await prepararDemoReal({ base: BASE, perfil: 'retail' });
  console.log('demo lista', r.perfil);
  const extra = path.join(__dirname, 'escaparate.sql');
  if (process.argv.includes('--sin-escaparate') || !fs.existsSync(extra)) return;
  const { ejecutarVarios } = await import('../db/lib/temporal.mjs');
  const gestor = require('../../electron/demo/gestor');
  const rs = ejecutarVarios(BASE, gestor.lotes(fs.readFileSync(extra, 'utf8')));
  const malo = rs.find(x => !x.ok);
  if (malo) { console.error('escaparate:', malo.error); process.exit(1); }
  console.log('escaparate aplicado:', rs.length, 'lotes');
})().catch(e => { console.error(e.message); process.exit(1); });
