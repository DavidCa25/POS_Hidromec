/**
 * EL DOCK Y LA MASCOTA.
 *
 *     node scripts/pruebas/dock-y-mascota.mjs
 *
 * El rail lateral se cambio por una barra de trabajo abajo. Un cambio de esa
 * talla tiene dos formas tipicas de salir mal, y las dos son silenciosas:
 *
 *   1. QUE ALGO DEJE DE SER ALCANZABLE. El rail tenia veintiuna entradas. Si
 *      una no se copio, nadie se entera hasta que un cliente pregunta donde
 *      esta Migracion. Aqui esta la lista entera, escrita a mano el dia de la
 *      mudanza, y se comprueba una por una.
 *
 *   2. QUE EL MENU OFREZCA LO QUE DESPUES SE RECHAZA. El rail preguntaba por
 *      el paquete que exige cada operacion. El dock tiene que preguntar lo
 *      mismo, y no una copia suya con otro nombre.
 *
 * Y dos defectos concretos que YA OCURRIERON al construirlo, los dos sin
 * mensaje de error:
 *
 *   - Sin `trackBy`, las listas del dock se reconstruian enteras en cada
 *     revision y los `routerLinkActive` volvian a marcar el componente. El
 *     hilo del renderer se quedaba colgado y la ventana en blanco.
 *   - Leyendo `router.url` desde la plantilla con OnPush, el area iluminada
 *     se quedaba en la anterior al navegar.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DOCK_TS   = join('src', 'app', 'wx-dock', 'wx-dock.component.ts');
const DOCK_HTML = join('src', 'app', 'wx-dock', 'wx-dock.component.html');
const DOCK_CSS  = join('src', 'app', 'wx-dock', 'wx-dock.component.css');
const MASC_TS   = join('src', 'app', 'wx-mascota', 'wx-mascota.component.ts');
const GLOBAL_CSS= join('src', 'styles.css');
const PANEL_HTML= join('src', 'dashboard', 'dashboard.html');
const PANEL_TS  = join('src', 'dashboard', 'dashboard.ts');
const INICIO_TS = join('src', 'dashboard', 'inicio', 'inicio.component.ts');
const RUTAS     = join('src', 'app', 'app.routes.ts');
const PAQUETE   = 'package.json';
const IGNORADOS = '.gitignore';

const leer = (p) => readFileSync(p, 'utf8');
const sinComentarios = (t) => t
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/<!--[\s\S]*?-->/g, '');

let ok = 0;
const fallos = [];
const check = (cond, titulo, detalle = '') => {
  if (cond) { ok++; console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`); }
  else { fallos.push(titulo); console.log(`   FALLA  ${titulo}${detalle ? `\n            ${detalle}` : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

const dock = sinComentarios(leer(DOCK_TS));
const dockHtml = sinComentarios(leer(DOCK_HTML));
const dockCss = leer(DOCK_CSS);
const masc = sinComentarios(leer(MASC_TS));
const global = leer(GLOBAL_CSS);
const panelHtml = sinComentarios(leer(PANEL_HTML));
const panelTs = sinComentarios(leer(PANEL_TS));
const rutas = leer(RUTAS);

console.log('\nEL DOCK Y LA MASCOTA\n');

// ===================================================================
seccion('1. El rail se fue entero, y no se llevo nada por delante');

check(!/nav class="sidebar"|class="sidebar-link"/.test(panelHtml),
  'el panel ya no dibuja el rail lateral');
check(/<wx-dock/.test(panelHtml),
  'y en su lugar monta la barra de trabajo');

/*
 * LAS VEINTIUNA ENTRADAS DEL RAIL, el dia que se mudo.
 *
 * Esta lista no se genera: se escribio mirando el rail que habia. Generarla
 * desde el dock seria comprobar que el dock es igual a si mismo.
 */
const DESTINOS_DEL_RAIL = [
  '/dashboard/estadisticas', '/dashboard/alertas',
  '/dashboard/venta', '/dashboard/abrir-cajon', '/dashboard/corte-dia', '/dashboard/tablaVenta',
  '/dashboard/inventario', '/dashboard/conteo', '/dashboard/recetas',
  '/dashboard/tablaCompra', '/dashboard/registrarCompra', '/dashboard/proveedores',
  '/dashboard/clientes', '/dashboard/servicios', '/dashboard/facturacion',
  '/dashboard/fidelizacion', '/dashboard/ordenes-de-servicio',
  '/dashboard/aplicaciones', '/dashboard/configuracion',
  '/dashboard/importador', '/dashboard/migracion',
];

const perdidos = DESTINOS_DEL_RAIL.filter(r => !dock.includes(`'${r}'`));
check(perdidos.length === 0,
  `las ${DESTINOS_DEL_RAIL.length} entradas del rail siguen alcanzables`,
  perdidos.length ? `se perdieron: ${perdidos.join(', ')}` : 'ninguna se quedo por el camino');

check(/path: 'inicio'/.test(rutas) && /redirectTo: 'inicio'/.test(rutas),
  'y el panel tiene por fin pantalla de entrada');

// ===================================================================
seccion('2. Ofrece exactamente lo que la autorizacion permite');

for (const g of ['verNumeros', 'supervisarVentas', 'operarVentas',
                 'operarInventario', 'administrarNegocio', 'operarServicios']) {
  check(dock.includes(`get ${g}(`) && dock.includes(`this.${g}`),
    `pregunta por ${g}, y lo usa`);
}
check(/PAQUETES\./.test(dock) && !/rol === '/.test(dock),
  'y lo hace por paquete, nunca por el nombre del rol',
  'un Encargado con reglas de "cajero" pierde inventario, compras y el corte');

/* Cada entrada declara su condicion. Una sin `visible` seria una puerta
   abierta para todo el mundo, incluida la gente que no puede cruzarla. */
const entradas = dock.match(/\{ texto: '[^']+', ruta: '[^']+', icono: '[^']+', visible: [^}]+\}/g) || [];
check(entradas.length >= 15, 'todas las entradas declaran su condicion',
  `${entradas.length} entradas con \`visible\``);

check(/servicios[\s\S]{0,400}this\.operarServicios && this\.caps\.servicios/.test(dock),
  'Servicios exige el modulo encendido Y el permiso');

// ===================================================================
seccion('3. Los dos fallos que ya ocurrieron no pueden volver');

check(/trackBy: porId/.test(dockHtml) && /trackBy: porRuta/.test(dockHtml),
  'las listas del dock llevan trackBy',
  'sin el, ngFor reconstruye todo en cada revision y el renderer se cuelga');
check(/porId = \(/.test(dock) && /porRuta = \(/.test(dock),
  'y las funciones existen de verdad');

check(/readonly areas = computed/.test(dock) && /readonly mas = computed/.test(dock),
  'las listas son computed, no getters que reservan memoria en cada lectura',
  'un getter devuelve objetos nuevos cada vez y ngFor no puede reconocerlos');

check(/private readonly ruta = signal/.test(dock) && /NavigationEnd/.test(dock),
  'el area encendida sigue a la navegacion',
  'leer router.url desde la plantilla con OnPush dejaba encendida la anterior');
check(/esActiva\(a: Area\): boolean \{ return this\.ruta\(\)/.test(dock),
  'y lo hace leyendo ese signal');

// ===================================================================
seccion('4. El dock no tapa el trabajo ni se pierde en oscuro');

check(/padding: 20px 22px 108px/.test(leer(join('src', 'dashboard', 'dashboard.css'))),
  'el area de trabajo reserva el hueco del dock',
  'sin el, la ultima fila de cualquier tabla queda debajo y no se alcanza');

check(/:host-context\(html\.dark\) \.wxdock \{/.test(dockCss),
  'y en oscuro el dock tiene su propia superficie',
  'el navy del rail y el lienzo oscuro son casi el mismo color');

check(/z-index: var\(--wx-z-rail/.test(dockCss),
  'vive en la capa del rail, no por encima de los dialogos');

// ===================================================================
seccion('5. La ventana de cada area funciona tambien sin raton');

check(/:has\(:focus-visible\) \.wxdock__ventana/.test(dockCss),
  'la ventana se abre tambien con el teclado');
check(!/:focus-within \.wxdock__ventana/.test(dockCss),
  'y NO con `focus-within`, que dejaba dos ventanas abiertas a la vez',
  'al pulsar un area se quedaba con el foco y la de al lado se abria encima');
check(/Ctrl 1/.test(dock) && /\/\^\[1-6\]\$\//.test(dock),
  'Ctrl+1 a Ctrl+6 saltan de area');
check(/e\.key === 'k' \|\| e\.key === 'K'/.test(dock),
  'y Ctrl+K abre el buscador');

/*
 * EL HUECO ENTRE EL BOTON Y LA VENTANA.
 *
 * Reportado probando: se abria la ventana de Inventario, se movia el raton
 * hacia una opcion y la ventana se cerraba a medio camino. La causa era que
 * los 14 px de separacion no pertenecian a nadie: al cruzarlos se perdia el
 * `:hover` y la ventana se iba justo antes de poder pulsar.
 *
 * El puente es una franja invisible que SI es parte de la ventana. No se
 * puede quitar "porque no se ve": es lo unico que hace la ventana usable.
 */
check(/\.wxdock__ventana::after/.test(dockCss) && /top: 100%/.test(dockCss),
  'el hueco hasta el boton esta puenteado',
  'sin el, mover el raton hacia una opcion cierra la ventana a medio camino');

// ===================================================================
seccion('6. La mascota es un blobatar, y tiene tres estados');

/*
 * ES LA MISMA FIGURA QUE LAS PERSONAS.
 *
 * La primera version era un SVG dibujado a mano: parecido a un blobatar sin
 * serlo, con su propia respiracion y su propio parpadeo. Dos personajes en la
 * misma aplicacion cuando la libreria ya sabia dibujar los dos.
 */
check(/blobatar\/internal/.test(masc) && /blobatar\/expression/.test(masc),
  'la mascota la dibuja blobatar, no un SVG propio');
/* El `<svg>` de la plantilla es el marco al que se le escribe el interior; lo
   que no puede quedar es GEOMETRIA, que es lo que se dibujo a mano. */
check(!/<path|<ellipse|<circle/.test(masc),
  'y no queda geometria escrita a mano',
  'un personaje dibujado dos veces se separa a la primera');

for (const [estado, pose] of [['idle', 'idle'], ['atencion', 'surprised'], ['exito', 'happy']]) {
  check(new RegExp(`${estado}: '${pose}'`).test(masc), `${estado} usa la pose ${pose}`);
}
check(!/'mad'|'scared'|'sick'|'thinking'/.test(masc),
  'y no hay un cuarto estado',
  'la libreria trae catorce poses; un estado que no se distingue de un vistazo es ruido con cara');

/*
 * LO QUE HACE QUE SE MUEVA, QUE NO ES EVIDENTE.
 *
 * `blobatar()` a secas devuelve markup ESTATICO: la capa de movimiento la
 * montan los adaptadores de React y de Vue, y para Angular no hay. La primera
 * version llamaba a `blobatar()` con `animate: 'always'` y daba una figura
 * correcta y completamente quieta, sin un solo error por ninguna parte.
 */
check(/_parts\(/.test(masc),
  'se monta con `_parts`, que es la superficie de los adaptadores',
  '`blobatar()` a secas devuelve una figura quieta y no avisa de nada');
check(/animate: 'always'/.test(masc),
  "y pide movimiento sin depender del raton");
check(/@import "blobatar\/motion\.css"/.test(global),
  'su hoja de movimiento se carga en la global, no en el componente',
  'las @property que registra son de documento: encapsuladas no valen');

/* El morfeo entre poses depende de que el nodo NO se vuelva a crear. */
check(/this\.dibujado !== this\.size/.test(masc),
  'el interior solo se reescribe si cambia el tamano',
  'reescribirlo al cambiar de estado daria un nodo nuevo, y la cara saltaria en vez de morfearse');
check(/setAttribute\('class'/.test(masc) && /setAttribute\('style'/.test(masc),
  'y el estado viaja en la clase y las variables, que es lo que CSS interpola');

/* Wybix de atencion aparece SOLO si hay algo a lo que atender. Si estuviera
   siempre, no significaria nada. */
const inicio = sinComentarios(leer(INICIO_TS));
const inicioHtml = sinComentarios(leer(join('src', 'dashboard', 'inicio', 'inicio.component.html')));
check(/get hayPendientes\(\): boolean/.test(inicio),
  'Inicio sabe si hay algo pendiente');
check(/\*ngIf="hayPendientes"[\s\S]*?estado="atencion"/.test(inicioHtml),
  'y la mascota de atencion solo sale entonces');
check(/estado="exito"/.test(leer(join('src', 'venta', 'appVenta', 'venta.html'))),
  'el estado de exito vive donde se cobra, no en un boton de prueba');

/* La marca no coge su color de la semilla como una persona cualquiera. */
check(/const COLOR = \{ hue: \d+, tone: [\d.]+ \}/.test(masc),
  'y su color es el de la marca, no el que le tocaria por su nombre');

// ===================================================================
seccion('7. Nada de esto entra en el paquete inicial');

check(!/^import .*blobatar/m.test(masc),
  'blobatar NO se importa de forma estatica en la mascota');
check(/import\('blobatar\/internal'\)/.test(masc)
   && /import\('blobatar\/expression'\)/.test(masc),
  'se importa bajo demanda y por subruta');
check(/cache\.get\(clave\)/.test(masc),
  'y cada figura se calcula una sola vez por sesion');

/*
 * RIVE SIGUE INSTALADO Y NADIE LO USA.
 *
 * Se cableo entero -runtime, wasm local, maquina de estados- antes de
 * descubrir que blobatar ya hacia estos tres estados. Queda por si algun dia
 * hace falta algo que una pose no puede dar. Lo que esta prueba vigila es que
 * mientras tanto NO se cuele en el paquete: una dependencia dormida que se
 * despierta sola son 2.9 MB que nadie pidio.
 */
const fuentes = [];
(function recorrer(dir) {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules') continue;
    const ruta = join(dir, n);
    if (statSync(ruta).isDirectory()) recorrer(ruta);
    else if (n.endsWith('.ts')) fuentes.push(ruta);
  }
})('src');
const conRive = fuentes.filter(f => /^import[^;]*@rive-app/m.test(leer(f)));
check(conRive.length === 0,
  'ningun archivo importa Rive de forma estatica',
  conRive.length ? conRive.join(', ') : 'no puede entrar en el paquete inicial sin que esto falle');

const pkg = JSON.parse(leer(PAQUETE));
check(/assets:rive/.test(pkg.scripts.build),
  'el build sigue dejando su wasm en su sitio, por si se retoma');
check(/src\/assets\/rive\//.test(leer(IGNORADOS)),
  'y ese binario no se versiona');

// ===================================================================
seccion('8. Lo que hace a Wybix lo que es sigue en su sitio');

check(/paletaTablas/.test(panelHtml) && /wx-swatch/.test(panelHtml),
  'el color de las tablas lo sigue eligiendo el negocio');
check(/setInvTheme/.test(panelTs) && /previewColor/.test(panelTs),
  'con su vista previa antes de confirmar');
check(/dark-toggle-btn/.test(panelHtml) && /toggleDark\(\)/.test(panelTs),
  'el modo oscuro sigue a un clic');
check(/wx-negocio/.test(panelHtml) && /esDemo/.test(panelHtml),
  'y se sigue viendo en que negocio se trabaja, y si es una demo',
  'confundir una demo con datos reales es caro');

console.log(`\nRESULTADO: ${fallos.length ? `${fallos.length} FALLO(S) de ${ok + fallos.length}` : `TODO BIEN · ${ok}/${ok}`}`);
process.exit(fallos.length ? 1 : 0);
