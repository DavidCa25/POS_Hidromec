/**
 * PRUEBAS DE CI, POR GRUPOS.
 *
 *     node scripts/ci/correr.mjs rapidas     sin SQL Server (contratos, unidad, build)
 *     node scripts/ci/correr.mjs bd          con SQL Server (migración y dominio)
 *     node scripts/ci/correr.mjs conocidas   las que fallan hoy en main (no bloquean)
 *
 * Corre TODAS las del grupo aunque alguna falle y al final dice cuáles
 * fallaron: en CI se ve el panorama completo en una sola corrida. Sale con 1
 * si alguna falló. Lo mismo que corre GitHub Actions se puede correr aquí.
 *
 * Una prueba nueva se agrega a su grupo en esta lista; si no está aquí, CI no
 * la corre.
 */
import { spawnSync } from 'node:child_process';

const GRUPOS = {
  rapidas: [
    'test:ui-contract', 'test:ipc', 'test:navegacion', 'test:addons', 'test:seguridad', 'test:fechas',
    'test:modificadores', 'test:marca', 'test:ruleta', 'test:modulos', 'test:capas', 'test:quickstart',
    'test:dock', 'test:onboarding', 'test:matriz', 'test:arranque', 'test:ticket', 'test:licencia',
    'test:red', 'test:servidor', 'test:pool', 'test:opciones', 'test:demo', 'test:presentaciones',
    'test:fase1', 'test:hospitality-operacion', 'test:wybix-guide', 'test:terminal', 'test:servicios',
    'test:giros', 'test:servicios-ui', 'test:licencia-v2', 'test:comercial', 'test:multisucursal', 'test:pagos',
    'test:plataformas', 'test:whatsapp',
  ],
  /* El orden importa: el baseline sale de Git (installer/template.bak no se
     versiona) y venta-hospitality usa el catálogo que deja dominio-hospitality
     sobre la base conservada por probar-migracion. */
  bd: [
    'db:baseline', 'node scripts/db/verificar-template.mjs --a-fondo --solo-template',
    'db:test-hospitality', 'db:test-paridad-recetas', 'db:test-mesas',
    'db:test-setup', 'db:test-latte', 'db:test-baja', 'db:test-turno', 'db:test-permisos', 'db:test-rol',
    'db:test-cajas', 'db:test-compras', 'db:test-egresos', 'db:test-bebidas', 'db:test-alertas',
    'db:test-corte-correo', 'db:test-resultados', 'db:test-produccion', 'db:test-upgrade', 'db:test-0052',
    'db:test-fidelizacion', 'db:test-fidelizacion-multicaja', 'db:test-fidelizacion-cupones',
    'db:test-fidelizacion-horarios', 'db:test-fidelizacion-cronometro', 'db:test-fidelizacion-ruleta',
    'db:test-fidelizacion-emision', 'db:test-fase1', 'db:test-core', 'db:test-giro-nacer',
    'db:test-servicios', 'db:test-giros', 'db:test-comercial', 'db:test-multisucursal', 'db:test-pagos',
    'node scripts/db/pruebas/club-membresias.mjs', 'node scripts/db/pruebas/puntos-sellos.mjs',
    'node scripts/db/pruebas/devoluciones.mjs',
    'test:club-wallet', 'db:test-menu-en-linea', 'db:test-liquidaciones',
    'test:local-host', 'test:licencia-integracion',
  ],
  /* Fallan hoy en main; se corren para verlas, sin bloquear. Al arreglar una,
     pásala a su grupo. */
  conocidas: [
    'test:pantallas',
  ],
};

const grupo = process.argv[2];
const lista = GRUPOS[grupo];
if (!lista) {
  console.error(`Grupo desconocido: ${grupo ?? '(ninguno)'}. Usa: ${Object.keys(GRUPOS).join(', ')}`);
  process.exit(2);
}

const resultados = [];
for (const p of lista) {
  const [cmd, args] = p.startsWith('node ') ? ['node', p.slice(5).split(' ')] : ['npm', ['run', '-s', p]];
  const inicio = Date.now();
  console.log(`\n::group::${p}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' && cmd === 'npm' });
  console.log('::endgroup::');
  const s = Math.round((Date.now() - inicio) / 1000);
  resultados.push({ p, ok: r.status === 0, s });
  console.log(`${r.status === 0 ? 'ok   ' : 'FALLA'} ${p} (${s}s)`);
}

const fallas = resultados.filter(r => !r.ok);
console.log(`\n${grupo}: ${resultados.length - fallas.length}/${resultados.length} bien`);
for (const f of fallas) console.log(`  FALLA ${f.p}`);
process.exit(fallas.length ? 1 : 0);
