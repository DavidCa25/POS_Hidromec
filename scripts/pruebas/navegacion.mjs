/**
 * UNA NAVEGACION, DOS FORMAS.
 *
 *     node scripts/pruebas/navegacion.mjs
 *
 * Wybix se navega con el dock o con la barra lateral, a eleccion de cada
 * persona. Esta prueba protege lo que hace que sean DOS FORMAS de la MISMA
 * navegacion y no dos navegaciones:
 *
 *   - un solo registro de destinos, permisos y modulos;
 *   - un solo shell: cabecera, contenido y router no se duplican;
 *   - los atajos no dependen de que el dock este montado;
 *   - una sola figura de Wybix por pantalla.
 *
 * Lo que se ve en pantalla -paridad real, persistencia, transicion- lo
 * comprueba `e2e/navegacion.spec.js`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const leer = (...p) => readFileSync(join(...p), 'utf8');
const sinComentarios = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^\s*\/\/.*$/gm, '');

let ok = 0;
const fallos = [];
const check = (cond, titulo, detalle = '') => {
  if (cond) { ok++; console.log(`   ok     ${titulo}`); }
  else { fallos.push(titulo); console.log(`   FALLA  ${titulo}${detalle ? `\n            ${detalle}` : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

const registro = sinComentarios(leer('src', 'app', 'wx-nav', 'navegacion.service.ts'));
const carcasa = sinComentarios(leer('src', 'app', 'wx-nav', 'wx-navegacion.component.ts'));
const modoTs = sinComentarios(leer('src', 'app', 'wx-nav', 'wx-nav-modo.component.ts'));
const modoCss = leer('src', 'app', 'wx-nav', 'wx-nav-modo.component.css');
const dock = sinComentarios(leer('src', 'app', 'wx-dock', 'wx-dock.component.ts'));
const barra = sinComentarios(leer('src', 'app', 'wx-sidebar', 'wx-sidebar.component.ts'));
const barraHtml = sinComentarios(leer('src', 'app', 'wx-sidebar', 'wx-sidebar.component.html'));
const barraCss = leer('src', 'app', 'wx-sidebar', 'wx-sidebar.component.css');
const paleta = sinComentarios(leer('src', 'app', 'wx-paleta', 'wx-paleta.component.ts'));
const guia = sinComentarios(leer('src', 'app', 'wx-guia', 'wx-guia.component.ts'));
const panelHtml = sinComentarios(leer('src', 'dashboard', 'dashboard.html'));
const panelTs = sinComentarios(leer('src', 'dashboard', 'dashboard.ts'));
const panelCss = leer('src', 'dashboard', 'dashboard.css');
const pkg = JSON.parse(leer('package.json'));

console.log('\nNAVEGACION: DOCK Y BARRA LATERAL\n');

// ===================================================================
seccion('1. Un solo registro');

check(/readonly areas = computed/.test(registro) && /readonly mas = computed/.test(registro)
   && /readonly crear = computed/.test(registro),
  'areas, «Mas» y «Crear» se declaran en el registro');

/* Ninguna de las dos formas ni Ctrl+K declara rutas de pantallas. Si una lo
   hiciera, la seccion nueva de mañana apareceria solo en ella. */
const rutasEn = (s) => (s.match(/'\/dashboard\/[^']*'/g) || []);
check(rutasEn(dock).length === 0, 'el dock no declara ninguna ruta',
  rutasEn(dock).join(', '));
check(rutasEn(barra).length === 0 && !/routerLink="\//.test(barraHtml),
  'la barra lateral tampoco');
const destinosPaleta = paleta.slice(paleta.indexOf('private destinos()'), paleta.indexOf('private plano('));
check(/this\.nav\.destinos\(\)/.test(destinosPaleta) && rutasEn(destinosPaleta).length === 0,
  'y Ctrl+K ofrece los destinos del registro, no una copia',
  'la copia de la paleta ofrecia «Pago de servicios» con el modulo apagado');

/* Los permisos se preguntan UNA vez. Una forma que filtrara por su cuenta
   dejaria de ofrecer lo mismo que la otra. */
check(!/PAQUETES|auth\.puede/.test(dock) && !/PAQUETES|auth\.puede/.test(barra),
  'ni el dock ni la barra deciden permisos por su cuenta');
check(/this\.nav\.areas/.test(dock) && /this\.nav\.areas/.test(barra),
  'los dos pintan las areas del registro');
check(/this\.nav\.mas/.test(dock) && /this\.nav\.mas\(\)/.test(barra),
  'y los dos pintan «Mas» del registro');

/* Paridad de «Mas»: la barra lo parte en negocio y sistema. Si apareciera un
   tercer grupo en el registro, la barra lo perderia sin avisar. */
const grupos = [...new Set((registro.match(/grupo: '([a-z]+)'/g) || []).map(g => g.slice(8, -1)))];
check(grupos.length && grupos.every(g => ['negocio', 'sistema'].includes(g)),
  'todo «Mas» cae en uno de los dos grupos que pinta la barra', grupos.join(', '));
check(/d\.grupo === 'negocio'/.test(barra) && /d\.grupo === 'sistema'/.test(barra),
  'y la barra pinta los dos');
check(/destinosDe\(a\)/.test(barraHtml) && /tienePanel\(a\)/.test(barraHtml),
  'las subsecciones de cada area salen de la misma pregunta que en el dock');

// ===================================================================
seccion('2. Un solo shell');

check((panelHtml.match(/<router-outlet/g) || []).length === 1,
  'un solo router-outlet');
check((panelHtml.match(/<wx-navegacion/g) || []).length === 1 && !/<wx-dock|<wx-sidebar/.test(panelHtml),
  'el panel monta la navegacion una vez, no el dock ni la barra sueltos');
check(/\*ngIf="nav\.modo\(\) === 'sidebar'"/.test(carcasa) && /\*ngIf="nav\.modo\(\) === 'dock'"/.test(carcasa),
  'la navegacion pinta UNA de las dos formas, segun el modo');
const layouts = readdirSync(join('src', 'app')).filter(d => /layout/i.test(d));
check(layouts.length === 0, 'no hay un layout por modo', layouts.join(', '));
check(!/showOldSidebar|sidebarVieja|oldSidebar/i.test(registro + carcasa + panelTs),
  'y ningun interruptor de «sidebar vieja»: son dos modos oficiales');
check(/\.dashboard-wrapper\.es-sidebar \.main-content/.test(panelCss),
  'con barra lateral el contenido deja de reservar el hueco del dock');

// ===================================================================
seccion('3. El modo es de la persona');

check(/export type ModoNavegacion = 'dock' \| 'sidebar'/.test(registro),
  'dos modos, con nombre');
check(/POR_DEFECTO: Preferencia = \{ modo: 'dock'/.test(registro),
  'por defecto, dock: una instalacion existente no amanece con barra');
check(/`wx-nav:\$\{id\}`/.test(registro) && /acceso\(\)\?\.userId/.test(registro),
  'se guarda por usuario, con su id',
  'el id y no el nombre: el nombre se puede cambiar');
check(/modo: p\?\.modo === 'sidebar' \? 'sidebar' : 'dock'/.test(registro),
  'un valor desconocido guardado vuelve al dock');
check(/catch \{\s*return POR_DEFECTO;/.test(registro),
  'y sin almacenamiento, tambien');

// ===================================================================
seccion('4. Los atajos no dependen del dock');

check(/\/\^\[1-6\]\$\//.test(carcasa) && !/\/\^\[1-6\]\$\//.test(dock),
  'Ctrl+1..6 vive en la navegacion, no en el dock');
check(/key === 'k' \|\| e\.key === 'K'/.test(paleta) && !/'k'/.test(dock) && !/'k'/.test(barra),
  'Ctrl+K vive en la paleta, montada fuera de las dos formas');
check(/<wx-paleta/.test(panelHtml), 'y la paleta la monta el panel');

// ===================================================================
seccion('5. El cambio: continuo y sin librerias');

check(/\.animate\(/.test(carcasa) && /translate:/.test(carcasa) && /opacity:/.test(carcasa),
  'se anima con la API del navegador, translate y opacity');
const ms = [...carcasa.matchAll(/const (SALIDA|ENTRADA) = (\d+);/g)].map(m => Number(m[2]));
check(ms.length === 2 && ms.every(n => n >= 140 && n <= 220),
  'cada tramo dura entre 140 y 220 ms', ms.join(' / '));
check(/prefers-reduced-motion: reduce/.test(carcasa) && /if \(quieto\) return;/.test(carcasa),
  'con movimiento reducido el cambio es inmediato');
check(/antes - despues/.test(carcasa),
  'el contenido se desplaza de donde estaba a donde queda (FLIP), sin brincar');
const deps = { ...pkg.dependencies, ...pkg.devDependencies };
const prohibidas = ['gsap', 'framer-motion', 'motion', '@angular/animations', 'animejs'].filter(d => d in deps);
check(prohibidas.length === 0, 'ninguna libreria de animacion', prohibidas.join(', '));
check(!/navigateByUrl|navigate\(/.test(carcasa.slice(carcasa.indexOf('async cambiar'), carcasa.indexOf('private async salir'))),
  'cambiar de forma no navega: la pantalla y su estado se quedan');

// ===================================================================
seccion('6. Nada flotando huerfano');

const cambiar = carcasa.slice(carcasa.indexOf('async cambiar'), carcasa.indexOf('private async salir'));
check(/this\.guia\.cerrar\(\)/.test(cambiar) && /this\.paleta\.cerrar\(\)/.test(cambiar),
  'al cambiar se cierran el panel de Wybix y Ctrl+K');
check(/effect\(\(\) => \{ this\.nav\.ruta\(\);/.test(dock),
  'y el dock cierra sus paneles al navegar, sin escuchar el router por su cuenta');

// ===================================================================
seccion('7. El tirador');

check(/<button type="button" class="wxmodo"/.test(modoTs),
  'es un boton: teclado y lector de pantalla de serie');
check(/'Usar menú lateral'/.test(modoTs) && /'Usar Dock'/.test(modoTs),
  'dice a donde lleva');
check(/role="tooltip"/.test(modoTs) && /aria-describedby/.test(modoTs),
  'y el tooltip esta enlazado al boton');
check(/@media \(hover: none\)/.test(modoCss) && /width: 44px/.test(modoCss),
  'sin raton queda asomado y con zona de dedo',
  'si dependiera del hover, en una caja tactil no existiria');
check(/:focus-visible \.wxmodo__pestana/.test(modoCss), 'con el teclado sale igual que con el cursor');
check(/html\.dark/.test(modoCss) && /prefers-reduced-motion/.test(modoCss), 'oscuro y movimiento reducido');
check(/--wx-tooltip-bg/.test(modoCss), 'el tooltip usa los tokens del primitivo de tooltip');

// ===================================================================
seccion('8. La barra lateral');

check(/width: 250px/.test(barraCss) && /\.wxside\.es-plegada \{ width: 68px; \}/.test(barraCss),
  'las medidas de la barra anterior: 250 px, 68 plegada');
check(/background: var\(--wx-rail\)/.test(barraCss), 'el navy del rail');
check(/\.wxside__link\.active::before/.test(barraCss) && /Phosphor-Fill/.test(barraCss),
  'el activo con barra de acento e icono relleno, como antes');
check(/class="wx-abrir wxside__sub"/.test(barraHtml),
  'los submenus usan el primitivo de abrir/cerrar, no un max-height');
check(/html\.dark/.test(barraCss) && /prefers-reduced-motion/.test(barraCss) && /hover: none/.test(barraCss),
  'oscuro, movimiento reducido y tactil');
check(/aria-current/.test(barraHtml) && /aria-expanded/.test(barraHtml),
  'el destino actual y los grupos se anuncian');
check(/this\.nav\.fijarPlegada\(false\)/.test(barra),
  'plegada, pulsar un grupo la despliega: ningun destino queda escondido');

// ===================================================================
seccion('9. Una sola figura de Wybix');

check(/<wx-mascota[^>]*\[variante\]="guia\.variante\(\)"/.test(barraHtml),
  'la barra lleva a Wybix con la variante de la sesion');
check(/\.wxside__pulso/.test(guia),
  'el panel de Wybix reconoce su boton en la barra, no solo en el dock');
check(/void this\.guia\.cargar\(\)/.test(carcasa) && !/guia\.cargar/.test(dock) && !/guia\.cargar/.test(barra),
  'la guia se carga una vez, en la navegacion');

// ===================================================================
seccion('10. Contrato de interfaz');

const nuevos = [
  ['src', 'app', 'wx-nav'], ['src', 'app', 'wx-sidebar'],
].flatMap(d => readdirSync(join(...d)).map(f => join(...d, f)));
const conSelect = nuevos.filter(f => statSync(f).isFile() && /<select/.test(readFileSync(f, 'utf8')));
check(conSelect.length === 0, 'sin <select> nativos', conSelect.join(', '));

console.log(`\nRESULTADO: ${fallos.length ? `${fallos.length} FALLO(S) de ${ok + fallos.length}` : `TODO BIEN · ${ok}/${ok}`}`);
process.exit(fallos.length ? 1 : 0);
