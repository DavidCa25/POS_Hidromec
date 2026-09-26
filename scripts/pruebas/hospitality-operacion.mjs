/**
 * OPERACION HOSPITALITY: las piezas que no necesitan base ni ventana.
 *
 *     node scripts/pruebas/hospitality-operacion.mjs
 *
 * - La comanda en papel: opciones y notas bajo su linea, escapado, ancho.
 * - Cada canal nuevo tiene manejador, esta protegido y clasificado.
 * - Mesas y Cocina cuelgan de Hospitality, y la navegacion lo respeta.
 * - Las pantallas nuevas cumplen el contrato: ni <select> ni Math.random.
 * - El modo terminal no mata procesos ni escribe sin respaldo.
 *
 * El flujo con datos lo prueba `scripts/db/pruebas/mesas-comandas.mjs`, y el
 * de pantalla `e2e/mesas-kds.spec.js`.
 */
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { comandaHtml } = require('../../electron/lib/comanda-html.js');
const mt = require('../../electron/terminal/modo-terminal.js');

let ok = 0; const fallos = [];
const check = (c, t, d = '') => {
  if (c) { ok++; console.log(`   ok     ${t}${d ? '  · ' + d : ''}`); }
  else { fallos.push(t); console.log(`   FALLA  ${t}${d ? '  · ' + d : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);
const leer = (p) => readFileSync(p, 'utf8');
const archivos = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? archivos(p) : [p];
});

console.log('\nOPERACION HOSPITALITY\n');

// =====================================================================
seccion('1. La comanda en papel');
const html = comandaHtml(
  { id: 41, estacion: 'Barra', destino: 'Mesa 4', area: 'Terraza', creada_en: '2026-09-24T09:05:00' },
  [{ id: 1, nombre: 'Latte', cantidad: 2, nota: 'muy caliente' }, { id: 2, nombre: '<script>x</script>', cantidad: 1.5 }],
  [{ linea_id: 1, option_name: 'Leche de avena', quantity: 1 }, { linea_id: 1, option_name: 'Shot extra', quantity: 2 }],
  { anchoMm: 58 });
const iLatte = html.indexOf('Latte'), iAvena = html.indexOf('Leche de avena'), iSegunda = html.indexOf('&lt;script&gt;');
check(iLatte > 0 && iAvena > iLatte && iAvena < iSegunda, 'la opcion va debajo de SU linea, no de otra');
check(html.includes('2× Shot extra'), 'una opcion doble dice cuantas');
check(html.includes('» muy caliente'), 'la nota sale');
check(!html.includes('<script>x') && iSegunda > 0, 'un nombre con HTML se escapa');
check(html.includes('<b>1.5</b>'), 'cantidades con decimales, sin ceros de mas');
check(html.includes('Mesa 4 · Terraza') && html.includes('09:05'), 'para quien es y a que hora');
check(!html.includes('REIMPRESIÓN') && comandaHtml({ id: 1 }, [], [], { reimpresion: true }).includes('REIMPRESIÓN'),
  'la reimpresion se marca, la primera no');
check(comandaHtml({ id: 1 }, [], [], { anchoMm: 80 }).includes('width: 72mm') && html.includes('width: 48mm'),
  '58 y 80 mm');

// =====================================================================
seccion('2. Canales: manejador, proteccion y clasificacion');
const canales = leer('electron/seguridad/canales.js');
const preload = leer('electron/preload.js');
for (const f of ['electron/ipc/salon.js', 'electron/ipc/terminal.js']) {
  const src = leer(f);
  const nombres = [...src.matchAll(/ipcMain\.handle\('([^']+)'/g)].map(m => m[1]);
  const protegidos = [...src.matchAll(/ipcMain\.handle\('([^']+)',\s*sesion\.proteger\('([^']+)'/g)]
    .filter(m => m[1] === m[2]).map(m => m[1]);
  check(nombres.length > 0 && protegidos.length === nombres.length,
    `${f}: todos pasan por sesion.proteger con su propio nombre`, `${protegidos.length}/${nombres.length}`);
  const sinClase = nombres.filter(n => !canales.includes(`'${n}':`));
  check(!sinClase.length, `${f}: todos clasificados en canales.js`, sinClase.join(', '));
  const sinPuente = nombres.filter(n => !preload.includes(`'${n}'`));
  check(!sinPuente.length, `${f}: todos llegan al renderer por el preload`, sinPuente.join(', '));
}
const clase = (c) => (canales.match(new RegExp(`'${c}':\\s*(\\w+)`)) || [])[1];
check(clase('comandas:cancelar') === 'VENTAS_SUPERVISAR', 'cancelar una comanda es de supervisor');
check(clase('kds:estado') === 'VENTAS_OPERAR' && clase('cuentas:enviar') === 'VENTAS_OPERAR',
  'marcar lista y enviar comanda son de operar');
check(['salon:mesa-guardar', 'estaciones:guardar', 'terminal:activar', 'terminal:restaurar']
  .every(c => clase(c) === 'CONFIGURACION_ADMINISTRAR'), 'configurar salon, estaciones y terminal es de administrar');
check(clase('reportes:actividad-horaria') === 'REPORTES_VER', 'las horas concurridas son de ver reportes');

// =====================================================================
seccion('3. Capacidades y navegacion');
const caps = leer('src/core/capability.service.ts');
check(/mesas:\s*this\.modulos\(\)\.has\('hospitality'\)\s*&&/.test(caps)
  && /comandas:\s*this\.modulos\(\)\.has\('hospitality'\)\s*&&/.test(caps), 'mesas y comandas exigen Hospitality');
const modulos = leer('src/core/modulos.ts');
check(/requiere:\s*'hospitality'/.test(modulos), 'Aplicaciones sabe que dependen de Hospitality');
const nav = leer('src/app/wx-nav/navegacion.service.ts');
check(/'Mesas'[^\n]*caps\.mesas|caps\.mesas[^\n]*'Mesas'/.test(nav) || (/Mesas/.test(nav) && /this\.caps\.mesas/.test(nav)),
  'Mesas en la navegacion, segun la capacidad');
check(/\/cocina/.test(nav) && /this\.caps\.comandas/.test(nav), 'Cocina en la navegacion, segun la capacidad');
const rutas = leer('src/app/app.routes.ts');
check(/puedeUsarCocina/.test(rutas) && /puedeUsarMesas/.test(rutas) && /puedeConfigurarSalon/.test(rutas),
  'las rutas tienen guardas, no solo la navegacion');

// =====================================================================
seccion('4. Contrato de interfaz en lo nuevo');
const nuevos = [
  ...archivos('src/hospitality/mesas'), ...archivos('src/hospitality/cocina'), ...archivos('src/hospitality/salon-admin'),
  ...archivos('src/estadisticas/actividad-horaria'), ...archivos('src/app/wx-virtual-keyboard'),
  ...archivos('src/app/teclado-panel'), ...archivos('src/app/modo-terminal-panel'), 'src/core/mesas.service.ts',
  ...archivos('src/hospitality/mesita'), ...archivos('src/hospitality/selector-mesas'), 'src/hospitality/hx.ts',
].filter(f => /\.(ts|html)$/.test(f));
const conSelect = nuevos.filter(f => /<select[\s>]/.test(leer(f)));
check(!conSelect.length, 'ningun <select> nativo', conSelect.join(', '));
const conRandom = nuevos.filter(f => /Math\.random/.test(leer(f)));
check(!conRandom.length, 'ningun Math.random', conRandom.join(', '));
const kdsCss = leer('src/hospitality/cocina/kds.component.css');
check(/prefers-reduced-motion/.test(kdsCss) || !/animation|transition/.test(kdsCss), 'el KDS respeta movimiento reducido');
const vk = leer('src/app/wx-virtual-keyboard/wx-virtual-keyboard.component.ts');
const hxCss = leer('src/hospitality/hx.css');
check(/prefers-reduced-motion/.test(hxCss) && /prefers-reduced-motion/.test(leer('src/hospitality/mesas/mesas.component.css'))
  && /prefers-reduced-motion/.test(leer('src/hospitality/salon-admin/salon-admin.component.css')),
  'Mesas y Salon respetan movimiento reducido');
const pantallas = ['src/hospitality/mesas/mesas.component.css', 'src/hospitality/cocina/kds.component.css',
  'src/hospitality/salon-admin/salon-admin.component.css', 'src/hospitality/hx.css'].map(leer).join(' ');
check(!/@keyframes/.test(pantallas) && !/infinite/.test(pantallas),
  'sin animaciones propias ni bucles: usan el lenguaje de movimiento de movimiento.css');
check(!/transition:[^;]*box-shadow/.test(pantallas), 'no animan box-shadow (solo transform y opacidad)');
const tpl = ['src/hospitality/mesas/mesas.component.html', 'src/hospitality/cocina/kds.component.html',
  'src/hospitality/salon-admin/salon-admin.component.html'].map(leer);
check(tpl.every(t => /class="wx-seg/.test(t)), 'las tres usan el patron wx-seg para elegir vista');
check((vk.match(/tabindex="-1"/g) || []).length >= 10 && !/\(click\)=/.test(vk),
  'las teclas no roban el foco: pointerdown y fuera del orden de tabulacion');

// =====================================================================
seccion('5. Modo terminal: nada destructivo');
const mtSrc = leer('electron/terminal/modo-terminal.js') + leer('electron/ipc/terminal.js');
/* La unica excepcion: su propio PowerShell hijo, si se cuelga. */
check(!/Stop-Process|taskkill|process\.kill|kill\(/i.test(mtSrc.replace(/hijo\.kill\(\)/g, '')),
  'no mata procesos (salvo su propio PowerShell si se cuelga)');
check(!/Shell\s*=|Winlogon/i.test(mtSrc.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), 'no reemplaza el shell de Windows');
const aplicar = mt.scriptAplicar({ raiz: mt.raizRegistro('S-1-5-21-9', true), valores: mt.plan({ ejecutableWybix: 'Wybix.exe' }).valores,
  respaldo: 'C:\\x\\respaldo.json' });
const iCopia = aplicar.indexOf('$copia | ConvertTo-Json'), iEscribe = aplicar.indexOf('New-ItemProperty -LiteralPath $k -Name $p.nombre');
check(aplicar.includes('respaldo.json') && iCopia > -1 && iCopia < iEscribe,
  'el respaldo se escribe ANTES que cualquier directiva');
check(/catch/.test(aplicar), 'y si algo falla a medias, vuelve atras');

console.log(`\nRESULTADO: ${fallos.length ? `${fallos.length} FALLO(S) de ${ok + fallos.length}` : `TODO BIEN · ${ok}/${ok}`}`);
process.exit(fallos.length ? 1 : 0);
