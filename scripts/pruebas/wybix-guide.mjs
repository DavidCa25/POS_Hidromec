/**
 * WYBIX GUIDE: el contrato, sin ventana.
 *
 *     node scripts/pruebas/wybix-guide.mjs
 *
 * 1. La guarda de la demo automatica, de verdad: el handler del proceso
 *    principal con una base y un gestor simulados, en todos los casos.
 * 2. Los escenarios solo señalan por `data-guide`, y cada `data-guide` que
 *    usan existe en alguna plantilla.
 * 3. La guia no actua; la demo pide permiso antes de cada paso que escribe.
 * 4. Identidad, movimiento reducido, Driver invisible, CLAUDE.md.
 */
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
let ok = 0; const fallos = [];
const check = (c, t, d = '') => {
  if (c) { ok++; console.log(`   ok     ${t}${d ? '  · ' + d : ''}`); }
  else { fallos.push(t); console.log(`   FALLA  ${t}${d ? '  · ' + d : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);
const leer = (p) => readFileSync(p, 'utf8');
const archivos = (dir, re) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  if (statSync(p).isDirectory()) return /^(node_modules|dist)$/.test(n) ? [] : archivos(p, re);
  return re.test(n) ? [p] : [];
});

console.log('\nWYBIX GUIDE\n');

// =====================================================================
seccion('1. La guarda de la demo automatica (proceso principal)');
{
  const dir = mkdtempSync(join(tmpdir(), 'wx-guide-'));
  const app = { getPath: () => dir };
  const INST = '6a1e2f3c-1111-4222-8333-944455556666';
  const guide = require('../../electron/ipc/guide.js');

  async function probar({ demo = true, esDemo = true, meta, base = 'Wybix_Demo_Retail', registro }) {
    writeFileSync(join(dir, 'demo-instancias.json'), JSON.stringify(registro ?? {}), 'utf8');
    const handlers = {};
    const ipcMain = { handle: (c, f) => { handlers[c] = f; } };
    const pool = {
      request: () => ({
        query: async (q) => /DB_NAME/.test(q)
          ? { recordset: [{ base }] }
          : { recordset: Object.entries(meta ?? {}).map(([clave, valor]) => ({ clave, valor })) },
      }),
    };
    guide.registrar({ ipcMain, poolPromise: Promise.resolve(pool), app, demo: demo ? {} : null, licencia: { esDemo: () => esDemo } });
    const c = (await handlers['guide:contexto']()).data;
    const a = await handlers['guide:autorizar'](null, { paso: 'x' });
    return { c, a };
  }
  const bueno = { is_demo: 'true', demo_profile: 'retail', demo_instance_id: INST };
  const reg = { retail: { instancia: INST, base: 'Wybix_Demo_Retail' } };

  let r = await probar({ demo: false, meta: bueno, registro: reg });
  check(!r.c.autopilot && !r.a.success, 'sin el gestor de demos (instalador publico): NO', r.c.motivo);
  r = await probar({ esDemo: false, meta: bueno, registro: reg });
  check(!r.c.autopilot && !r.a.success, 'con el gestor pero fuera del espacio demo: NO');
  r = await probar({ meta: { ...bueno, is_demo: 'false' }, registro: reg });
  check(!r.c.autopilot && /marcada/.test(r.c.motivo), 'una base sin is_demo: NO', r.c.motivo);
  r = await probar({ meta: { ...bueno, demo_instance_id: '00000000-0000-4000-8000-000000000000' }, registro: reg });
  check(!r.c.autopilot && /creó este gestor/.test(r.c.motivo), 'una demo que no es la de este gestor: NO', r.c.motivo);
  r = await probar({ meta: bueno, base: 'Wybix_POS', registro: reg });
  check(!r.c.autopilot, 'la base conectada no es la registrada: NO', r.c.motivo);
  r = await probar({ meta: bueno, registro: reg });
  check(r.c.autopilot && r.a.success && r.c.perfil === 'retail', 'proceso demo + base marcada + instancia registrada: SI');
  rmSync(dir, { recursive: true, force: true });

  /* Un `require('mssql')` suelto (el driver tedious) en el proceso principal
     cambia el estado compartido de la libreria y las consultas por Windows
     (mssql/msnodesqlv8) dejan de responder: el arranque se queda colgado. */
  check(!/require\('mssql'\)/.test(leer('electron/ipc/guide.js')), 'la guarda no carga otro driver de SQL');
  const canales = require('../../electron/seguridad/canales.js');
  const todo = JSON.stringify(canales, (k, v) => v instanceof Map ? Object.fromEntries(v) : v);
  check(/guide:contexto/.test(todo) && /guide:autorizar/.test(todo), 'los dos canales estan clasificados');
}

// =====================================================================
seccion('2. Escenarios: solo data-guide, y cada uno existe');
const esc = leer('src/app/wx-guide/escenarios.ts');
const tipos = leer('src/app/wx-guide/guia-tipos.ts');
const usados = [...new Set([...esc.matchAll(/guia: '([a-z0-9-]+)'/g)].map(m => m[1]))];
check(usados.length >= 25, 'los escenarios señalan por data-guide', `${usados.length} objetivos`);
check(!/querySelector|nth-child|className|\.classList/.test(esc), 'y nunca por selector, clase o posicion');
const plantillas = [...archivos('src', /\.(html|ts)$/)].filter(f => !/wx-guide[\\/]/.test(f));
const texto = plantillas.map(leer).join('\n');
const faltan = usados.filter(g => {
  if (g.startsWith('area-')) return !/data-guide\]="'area-' \+ a\.id"/.test(texto);
  /* Los botones de un SweetAlert no tienen plantilla: se marcan al abrirse
     (`didOpen` -> setAttribute), con el mismo nombre estable. */
  return !new RegExp(`data-guide="${g}"|data-guide\\]="[^"]*'${g}'|setAttribute\\('data-guide', '${g}'\\)`).test(texto);
});
check(!faltan.length, 'cada data-guide usado existe en una plantilla', faltan.join(', '));
const ids = [...esc.matchAll(/^\s+id: '([a-z._]+)',$/gm)].map(m => m[1]);
check(ids.length >= 6 && new Set(ids).size === ids.length, 'escenarios con id unico', ids.join(', '));
check(/core\.first_run/.test(esc) && /core\.venta/.test(esc) && /core\.producto/.test(esc)
  && /demo\.hospitality/.test(esc) && /demo\.retail/.test(esc)
  && /demo\.services\.workshop/.test(esc) && /demo\.services\.beauty/.test(esc),
  'los recorridos base y las demos (retail, hospitality, taller y belleza)');
check(/'hospitality\.mesas'/.test(esc) && /'hospitality\.cocina'/.test(esc),
  'Hospitality: un recorrido de Mesas y otro de Cocina');
check(/'servicios\.ordenes'/.test(esc) && /'servicios\.agenda'/.test(esc),
  'Servicios: uno por forma de trabajar (ordenes / agenda)');
const bloque = (id) => esc.split(/\nconst /).find(b => b.includes(`id: '${id}'`)) || '';
check(/requiere: \{ capacidades: \['mesas'\] \}/.test(bloque('hospitality.mesas'))
  && /requiere: \{ capacidades: \['comandas'\] \}/.test(bloque('hospitality.cocina')),
  'cada uno exige SU modulo: un negocio con solo cocina no ve Mesas');
check(/giro: \{ inicio: 'ordenes' \}/.test(bloque('servicios.ordenes')) && /giro: \{ inicio: 'agenda' \}/.test(bloque('servicios.agenda')),
  'el giro decide cual de los dos de Servicios se ve');
check(/giro: \{ usaActivos: true \}/.test(bloque('servicios.ordenes')) && /\{activo\}|\{Activos\}/.test(bloque('servicios.ordenes')),
  'el taller habla de SU cosa (vehiculo, equipo) con las palabras del giro');
check(/opcional: true, limite: \d+/.test(bloque('servicios.ordenes')) && /opcional: true, limite: \d+/.test(bloque('servicios.agenda')),
  'sin clientes el formulario no abre: sus pasos son opcionales, no un callejon');
check(/SALON = \(c[^)]*\) => \(c\.touch \? '\/touch\/mesas' : '\/dashboard\/mesas'\)/.test(esc),
  'el salon se enseña donde vive: en Touch, dentro de Touch');
check(/servicios-agenda/.test(bloque('core.first_run')) && /servicios-ordenes/.test(bloque('core.first_run'))
  && /mesas-cocina/.test(bloque('core.first_run')),
  'el recorrido inicial nombra Servicios, Mesas y Cocina donde existen');
const runGiro = leer('src/app/wx-guide/guia-runner.service.ts');
check(/inject\(GiroServiciosService\)/.test(runGiro) && /this\.giro\.inicio !== r\.giro\.inicio/.test(runGiro),
  'el giro lo decide GiroServiciosService, sin lista propia de giros');

/* Un escenario de GUIA no tiene acciones: enseña, no hace. */
const bloques = esc.split(/\nconst /).slice(1);
const guiaConAcciones = bloques.filter(b => /modo: 'guia'/.test(b) && /acciones:/.test(b));
check(!guiaConAcciones.length, 'ningun recorrido de guia actua por la persona');
check(bloques.filter(b => /modo: 'demo'/.test(b)).every(b => /grupo: 'demo'/.test(b)),
  'las demos automaticas van en su grupo');
/* El inicial trae variantes por negocio; cada negocio ve 9 como mucho (lo
   comprueba e2e/wybix-guide-giros.spec.js con cada giro de verdad). */
const inicial = bloques.find(b => /core\.first_run/.test(b)) || '';
const pasosInicial = (inicial.match(/\{ id: '/g) || []).length;
check(pasosInicial >= 6 && pasosInicial <= 14, 'el recorrido inicial es corto', `${pasosInicial} pasos entre todas las variantes`);
check(/requiere\?: Requisitos/.test(tipos) && /areas\?: string\[\]/.test(tipos) && /capacidades\?/.test(tipos) && /paquetes\?/.test(tipos),
  'los escenarios declaran areas, capacidades y permisos');

// =====================================================================
seccion('3. El motor');
const run = leer('src/app/wx-guide/guia-runner.service.ts');
const actuar = run.slice(run.indexOf('private async actuar'), run.indexOf('private async teclear'));
for (const t of ['pulsar', 'escribir', 'elegir', 'dominio']) {
  const caso = actuar.slice(actuar.indexOf(`case '${t}'`));
  const cuerpo = caso.slice(0, caso.indexOf('return;') + 1);
  check(/await this\.autorizar\(p\)/.test(cuerpo), `«${t}» pide permiso al proceso principal antes de actuar`);
}
check(/if \(e\.modo === 'demo'\)[\s\S]{0,400}contextoDemo\(\)[\s\S]{0,200}rechazar/.test(run),
  'una demo sin contexto seguro ni empieza');
check(/MutationObserver/.test(run) && /NavigationEnd|navigateByUrl/.test(run), 'espera observando el DOM y el router');
/* `/touch` no es `/touch/mesas`: con prefijo, el paso «Aqui» de Mesas en una
   caja Touch se quedaba en el salon buscando un boton que esta en Venta. */
check(/function enRuta/.test(run) && /actual === ruta/.test(run) && /!enRuta\(this\.router\.url, ruta\)/.test(run)
  && !/router\.url\.startsWith\(ruta\)/.test(run),
  'se navega salvo que ya se este EN la pantalla (exacta; `/**` para cualquiera de debajo)');
check(/p\.limite \?\? \(p\.opcional \? LIMITE_OPCIONAL : LIMITE_OBJETIVO\)/.test(run),
  'un paso puede esperar mas a su objetivo (un formulario que tarda en abrir)');
check(/class NoEncontrado/.test(run) && /private async recuperar/.test(run), 'un objetivo que no aparece se dice, no revienta');
check(/pausar\(/.test(run) && /reanudar\(/.test(run) && /detener\(/.test(run) && /anterior\(/.test(run) && /siguiente\(/.test(run),
  'pausar, reanudar, saltar, volver y detener');
check(/Tomaste el control/.test(run) && /isTrusted/.test(run), 'tomar el control a mano pausa la demo');
check(/this\.nav\.areas\(\)/.test(run) && /this\.auth\.puede/.test(run) && /this\.caps/.test(run),
  'filtra con la misma regla que la navegacion');
check(!/Math\.random/.test([run, esc, leer('src/app/wx-guide/guia-voz.service.ts'), leer('src/app/wx-guide/wx-guide-speaker.component.ts')].join('')),
  'sin azar en ninguna parte');

// =====================================================================
seccion('4. Voz, figura y foco');
const voz = leer('src/app/wx-guide/guia-voz.service.ts');
check(/prefers-reduced-motion/.test(voz) && /this\.texto\.set\(frase\)/.test(voz), 'con movimiento reducido, la frase entera');
check(/'\.!\?…'/.test(voz) && /',;:'/.test(voz), 'la puntuacion respira');
check(/completar\(\)/.test(voz) && /pausar\(\)/.test(voz) && /cancelar\(\)/.test(voz), 'completar, pausar y cancelar');
const hablante = leer('src/app/wx-guide/wx-guide-speaker.component.ts');
check(/return 'exito'/.test(hablante) && /return 'atencion'/.test(hablante) && /return 'error'/.test(hablante)
  && /default: return 'idle'/.test(hablante), 'cuatro caras; el resto es gesto y mirada');
check(/blobatar\/gaze/.test(hablante) && /lookAt/.test(hablante), 'mira el objetivo');
const capa = leer('src/app/wx-guide/wx-guide-layer.component.html');
check(/\[variante\]="guia\.variante\(\)"/.test(capa), 'la figura del recorrido es la de la sesion');
check(/wxgl__segs/.test(capa) && /Demo automática/.test(capa) && /Pausar/.test(capa) && /Detener/.test(capa) && /Tu turno/.test(capa),
  'presentador: segmentos, mandos de demo y «Tu turno»');
const foco = leer('src/app/wx-guide/guia-foco.service.ts');
check(/showButtons: \[\]/.test(foco) && /import\('driver\.js'\)/.test(foco), 'Driver sin sus botones, y bajo demanda');
const css = leer('src/styles/guia.css');
check(/\.wx-guide-driver[^{]*\{ display: none/.test(css), 'el globo de Driver no existe');
check(/\.driver-active \.wxgl/.test(css), 'los mandos siguen respondiendo con el foco encendido');
check(/\.driver-active \.swal2-container \*/.test(css), 'un aviso que salta a mitad de un recorrido se puede cerrar');
for (const f of ['src/styles/guia.css', 'src/app/wx-guide/wx-guide-layer.component.css', 'src/app/wx-guia/wx-guia.component.css']) {
  check(/prefers-reduced-motion/.test(leer(f)), `${f.split('/').pop()} respeta movimiento reducido`);
}
check(/prefers-reduced-motion/.test(hablante), 'la figura tambien');

// =====================================================================
seccion('5. Contrato escrito');
const claude = leer('CLAUDE.md');
check(/# Wybix Guide/.test(claude) && /data-guide/.test(claude) && /clase de presentación/.test(claude)
  && /no crea datos reales/.test(claude) && /Persona ≠ Guide/.test(claude) && /Movimiento reducido/.test(claude)
  && /escenarios\.ts/.test(claude), 'CLAUDE.md lleva las reglas de Wybix Guide');

console.log(`\nRESULTADO: ${fallos.length ? `${fallos.length} FALLO(S) de ${ok + fallos.length}` : `TODO BIEN · ${ok}/${ok}`}`);
process.exit(fallos.length ? 1 : 0);
