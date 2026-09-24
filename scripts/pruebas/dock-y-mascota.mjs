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
/* El registro de navegacion salio del dock: lo leen el dock, la barra
   lateral y Ctrl+K. Las reglas sobre QUE se ofrece se comprueban ahi. */
const REGISTRO_TS = join('src', 'app', 'wx-nav', 'navegacion.service.ts');
const CARCASA_TS  = join('src', 'app', 'wx-nav', 'wx-navegacion.component.ts');
const MASC_TS   = join('src', 'app', 'wx-mascota', 'wx-mascota.component.ts');
const GLOBAL_CSS= join('src', 'styles.css');
const PANEL_HTML= join('src', 'dashboard', 'dashboard.html');
const PANEL_TS  = join('src', 'dashboard', 'dashboard.ts');
const INICIO_TS = join('src', 'dashboard', 'inicio', 'inicio.component.ts');
const RUTAS     = join('src', 'app', 'app.routes.ts');
const PAL_TS    = join('src', 'app', 'wx-paleta', 'wx-paleta.component.ts');
const PAL_HTML  = join('src', 'app', 'wx-paleta', 'wx-paleta.component.html');
const PAL_CSS   = join('src', 'app', 'wx-paleta', 'wx-paleta.component.css');
const RIVE_DOC  = join('docs', 'rive-wybix.md');
const GUIA_TS   = join('src', 'app', 'wx-guia', 'guia.service.ts');
const GUIA_COMP = join('src', 'app', 'wx-guia', 'wx-guia.component.ts');
const GUIA_HTML = join('src', 'app', 'wx-guia', 'wx-guia.component.html');
const GUIA_CSS  = join('src', 'app', 'wx-guia', 'wx-guia.component.css');
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
const registro = sinComentarios(leer(REGISTRO_TS));
const carcasa = sinComentarios(leer(CARCASA_TS));
const masc = sinComentarios(leer(MASC_TS));
const global = leer(GLOBAL_CSS);
const panelHtml = sinComentarios(leer(PANEL_HTML));
const panelTs = sinComentarios(leer(PANEL_TS));
const rutas = leer(RUTAS);
const pal = sinComentarios(leer(PAL_TS));
const palHtml = sinComentarios(leer(PAL_HTML));
const palCss = leer(PAL_CSS);
const guia = sinComentarios(leer(GUIA_TS));
const guiaComp = sinComentarios(leer(GUIA_COMP));
const guiaHtml = sinComentarios(leer(GUIA_HTML));

console.log('\nEL DOCK Y LA MASCOTA\n');

// ===================================================================
seccion('1. El rail se fue entero, y no se llevo nada por delante');

check(!/nav class="sidebar"|class="sidebar-link"/.test(panelHtml),
  'el panel ya no dibuja el rail lateral');
check(/<wx-navegacion/.test(panelHtml) && /<wx-dock/.test(carcasa),
  'y en su lugar monta la navegacion, que pinta la barra de trabajo');

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

const perdidos = DESTINOS_DEL_RAIL.filter(r => !registro.includes(`'${r}'`));
check(perdidos.length === 0,
  `las ${DESTINOS_DEL_RAIL.length} entradas del rail siguen alcanzables`,
  perdidos.length ? `se perdieron: ${perdidos.join(', ')}` : 'ninguna se quedo por el camino');

check(/path: 'inicio'/.test(rutas) && /redirectTo: 'inicio'/.test(rutas),
  'y el panel tiene por fin pantalla de entrada');

// ===================================================================
seccion('2. Ofrece exactamente lo que la autorizacion permite');

for (const g of ['verNumeros', 'supervisarVentas', 'operarVentas',
                 'operarInventario', 'administrarNegocio', 'operarServicios']) {
  check(registro.includes(`get ${g}(`) && registro.includes(`this.${g}`),
    `pregunta por ${g}, y lo usa`);
}
check(/PAQUETES\./.test(registro) && !/rol === '/.test(registro) && !/rol === '/.test(dock),
  'y lo hace por paquete, nunca por el nombre del rol',
  'un Encargado con reglas de "cajero" pierde inventario, compras y el corte');

/* Cada entrada declara su condicion. Una sin `visible` seria una puerta
   abierta para todo el mundo, incluida la gente que no puede cruzarla. */
const entradas = registro.match(/\{ texto: '[^']+', ruta: '[^']+', icono: '[^']+',(?: grupo: '[^']+',)? visible: [^}]+\}/g) || [];
check(entradas.length >= 15, 'todas las entradas declaran su condicion',
  `${entradas.length} entradas con \`visible\``);

check(/servicios[\s\S]{0,400}this\.operarServicios && this\.caps\.servicios/.test(registro),
  'Servicios exige el modulo encendido Y el permiso');

// ===================================================================
seccion('3. Los dos fallos que ya ocurrieron no pueden volver');

check(/trackBy: porId/.test(dockHtml) && /trackBy: porRuta/.test(dockHtml),
  'las listas del dock llevan trackBy',
  'sin el, ngFor reconstruye todo en cada revision y el renderer se cuelga');
check(/porId = \(/.test(dock) && /porRuta = \(/.test(dock),
  'y las funciones existen de verdad');

check(/readonly areas = computed/.test(registro) && /readonly mas = computed/.test(registro),
  'las listas son computed, no getters que reservan memoria en cada lectura',
  'un getter devuelve objetos nuevos cada vez y ngFor no puede reconocerlos');

check(/readonly ruta = signal/.test(registro) && /NavigationEnd/.test(registro),
  'el area encendida sigue a la navegacion',
  'leer router.url desde la plantilla con OnPush dejaba encendida la anterior');
check(/esActiva\(a: Area\): boolean \{ return this\.ruta\(\)/.test(registro),
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
seccion('5. Abrir un area no depende del raton');

/*
 * ESTO ERA UNA DEUDA CONOCIDA Y AHORA ESTA PAGADA.
 *
 * La primera version abria el panel SOLO al pasar el cursor. En una pantalla
 * tactil no hay cursor, asi que las subsecciones de Venta, Inventario y
 * Compras sencillamente no existian: la unica forma de llegar era Ctrl+K, y
 * Ctrl+K es un acelerador, no un sustituto de la navegacion.
 */
check(/pulsar\(a: Area, _e: Event\)/.test(dock),
  'pulsar un area abre su panel',
  'con el dedo no hay hover: si solo abriera al pasar el cursor, en tactil no existiria');
check(/this\.fijado\.set\(true\)/.test(dock),
  'y el panel se queda fijado hasta que se cierre');
check(/\(click\)="pulsar\(a, \$event\)"/.test(dockHtml),
  'la plantilla lo engancha al clic');
check(/\(mouseenter\)="asomar\(a\)"/.test(dockHtml) && /\(mouseleave\)="retirar\(\)"/.test(dockHtml),
  'el cursor solo lo ASOMA, que es una comodidad encima');
check(/if \(this\.fijado\(\)\) return;/.test(dock),
  'y un panel fijado no se cierra porque el cursor se vaya');

/* Un area sin subsecciones no abre nada: navega. Abrir un panel de una sola
   fila seria pedir dos gestos para lo mismo. */
check(/tienePanel\(a: Area\): boolean/.test(dock),
  'un area sin subsecciones navega directamente');
check(/\*ngIf="tienePanel\(a\); else enlaceArea"/.test(dockHtml)
   && /<ng-template #enlaceArea>/.test(dockHtml),
  'y entonces es un enlace de verdad, no un boton que navega a escondidas',
  'un elemento que a veces navega y a veces no no se anuncia bien');

check(/'Escape'|keydown\.escape/.test(dock) && /this\.cerrarTodo\(\)/.test(dock),
  'Escape cierra');
check(/alPulsarFuera/.test(dock),
  'y un clic fuera tambien');

/*
 * EL HUECO ENTRE EL BOTON Y EL PANEL.
 *
 * Reportado probando: se abria el panel de Inventario, se movia el raton hacia
 * una opcion y el panel se cerraba a medio camino. Los 14 px de separacion no
 * pertenecian a nadie. Van dos remedios y hacen falta los dos: la franja
 * invisible cubre el trayecto recto y la pausa de gracia cubre el diagonal.
 */
check(/\.wxdock__panel::after/.test(dockCss) && /top: 100%/.test(dockCss),
  'el hueco hasta el boton esta puenteado',
  'sin el, mover el raton hacia una opcion cierra el panel a medio camino');
check(/const GRACIA = \d+/.test(dock) && /setTimeout\(\(\) => this\.panel\.set\(null\), GRACIA\)/.test(dock),
  'y el cierre tiene una pausa de gracia para el trayecto en diagonal');

check(/Ctrl 1/.test(registro) && /\/\^\[1-6\]\$\//.test(carcasa),
  'Ctrl+1 a Ctrl+6 van DIRECTO al destino principal, sin abrir panel, con cualquier navegacion',
  'el panel esta para descubrir; la tecla, para repetir');

/* El activo tiene que verse desde el borde de una pantalla grande. */
check(/\.wxdock__btn\.is-on::after/.test(dockCss),
  'el area activa lleva barra de acento, no solo un fondo distinto');

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

/* El morfeo entre poses depende de que el nodo NO se vuelva a crear.

   La firma lleva la SEMILLA ademas del tamano: desde que hay variantes, dos
   apariencias distintas no son el mismo nodo con otro color, son otra figura.
   Lo que sigue sin entrar en la firma es el ESTADO, que es justo el punto. */
check(/const firma = `\$\{v\.semilla\}\|\$\{this\.size\}`/.test(masc)
   && /this\.dibujado !== firma/.test(masc),
  'el interior solo se reescribe si cambia la apariencia o el tamano',
  'reescribirlo al cambiar de estado daria un nodo nuevo, y la cara saltaria en vez de morfearse');
check(!/firma = [^;]*estado/.test(masc),
  'y el estado NUNCA entra en esa firma',
  'es la unica linea que separa «morfea» de «salta»');
check(/setAttribute\('class'/.test(masc) && /setAttribute\('style'/.test(masc),
  'y el estado viaja en la clase y las variables, que es lo que CSS interpola');

/* Wybix de atencion aparece SOLO si hay algo a lo que atender. Si estuviera
   siempre, no significaria nada. */
const inicio = sinComentarios(leer(INICIO_TS));
const inicioHtml = sinComentarios(leer(join('src', 'dashboard', 'inicio', 'inicio.component.html')));
/*
 * UNA SOLA FIGURA EN INICIO, Y SU CARA ES EL RESUMEN.
 *
 * Antes habia dos: una pequena junto al saludo y otra asomandose a la lista de
 * pendientes. Dos figuras a la vez diciendo cosas distintas es una
 * conversacion, no una pantalla de trabajo.
 */
check(/get hayPendientes\(\): boolean/.test(inicio),
  'Inicio sabe si hay algo pendiente');
/*
 * Y LO SABE POR LA GUIA, no por su cuenta.
 *
 * Tenia su propia lectura de alertas mientras la frase salia de la guia, y la
 * pantalla llego a decir "una cosa necesita tu atencion" encima de una lista
 * vacia: cada mitad contaba cosas distintas.
 */
check(/readonly pendientes = computed<Pendiente\[\]>/.test(inicio)
   && /this\.guia\.avisos\(\)/.test(inicio),
  'y la lista sale del mismo sitio que la frase',
  'dos cuentas del mismo negocio acaban contradiciendose en la misma pantalla');
check(!/alertsCounts/.test(inicio),
  'Inicio ya no lee las alertas por su cuenta');
check(/readonly estadoGuia = computed<EstadoMascota>\(\(\) => this\.guia\.estado\(\)\)/.test(inicio),
  'y la cara de la guia sale del MISMO calculo que la del dock',
  'Inicio calculaba el suyo y el dock el suyo: podian discrepar sobre el mismo negocio');
check((inicioHtml.match(/<wx-mascota/g) || []).length === 1,
  'hay UNA sola guia en Inicio, no dos hablando a la vez');
check(/\[size\]="104"/.test(inicioHtml),
  'y es lo bastante grande para ver la expresion y la mirada',
  'a 46 px la cara no se lee y el personaje pasa a ser un icono simpatico');

/* Nada de disco blanco ni tarjeta alrededor: la forma ya tiene personalidad. */
const inicioCss = leer(join('src', 'dashboard', 'inicio', 'inicio.component.css'));
check(/\.ini__guia \{ flex: none; \}/.test(inicioCss)
   && !/\.ini__guia[^}]*background:/.test(inicioCss),
  'la guia se apoya en el lienzo, sin contenedor que no aporte nada');

/* Mientras carga no afirma nada. */
check(/if \(this\.cargando\(\)\) return 'Mirando/.test(guia),
  'y no dice "todo tranquilo" antes de saberlo',
  'corregirse tres segundos despues es peor que callarse');
check(/estado="exito"/.test(leer(join('src', 'venta', 'appVenta', 'venta.html'))),
  'el estado de exito vive donde se cobra, no en un boton de prueba');

/*
 * LA APARIENCIA ES UN DATO DE ENTRADA, NUNCA UN SORTEO.
 *
 * El color no sale de la semilla como le saldria a una persona cualquiera:
 * sale de una lista curada. Una combinacion al azar da tonos que no pegan con
 * la marca y contrastes que no se leen.
 *
 * Y se PASA al componente ya calculada. Si se sorteara al pintar, Wybix
 * cambiaria de cara entre pantallas -y entre fotogramas-, que no es variedad
 * sino parpadeo.
 */
const variantes = sinComentarios(leer(join('src', 'app', 'wx-mascota', 'variantes.ts')));
check(/@Input\(\) variante: VarianteMascota = VARIANTE_BASE/.test(masc),
  'la apariencia entra por `@Input`, ya decidida',
  'sortearla al pintar seria parpadeo, no variedad');
check(!/Math\.random/.test(masc) && !/Math\.random/.test(variantes),
  'y en ninguno de los dos archivos hay un sorteo');
check(/export const VARIANTES: VarianteMascota\[\] = \[/.test(variantes)
   && (variantes.match(/hue: \d+, tone: [\d.]+/g) || []).length >= 4,
  'los colores salen de una lista revisada, no de la semilla',
  'el hue se queda en la familia fria del cyan de Wybix: siguen leyendose como la misma marca');
check(/export const VARIANTE_BASE = VARIANTES\[0\]/.test(variantes),
  'y hay una de siempre, para no quedarse sin cara si algo falla');
/* Una persona SI deriva la suya, y de su id: los nombres se corrigen. */
check(/huella\(`wybix:persona:\$\{[^}]*\}`\)|varianteDePersona/.test(variantes),
  'el avatar de una persona sale de su id, estable para siempre');

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


// ===================================================================
seccion('9. Ctrl+K busca cosas, no solo rutas');

/*
 * La primera version era una lista de rutas con un campo encima. Para ir a
 * Inventario ya esta el dock: un buscador que solo repite el menu no se abre
 * nunca. Lo que lo vuelve util es que encuentre lo que el negocio TIENE.
 */
for (const g of ['Acciones', 'Productos', 'Clientes', 'Órdenes', 'Activos', 'Ir a']) {
  check(new RegExp(`'${g}'`).test(pal), `busca en ${g}`);
}
check(/getActiveProducts|getCustomers|serviciosOrdenes|serviciosActivos/.test(pal),
  'y los indices salen de canales que ya existian',
  'no se abrio ningun canal nuevo para esto');

/* Los indices se piden al ABRIR, no al arrancar la aplicacion. */
check(/if \(this\.cargado\) return;/.test(pal),
  'los indices se traen una sola vez, y al abrir la paleta');
check(/const TOPE = \d+/.test(pal),
  'y el indice esta acotado, con el limite escrito y no escondido');

/* Sin acentos: quien teclea deprisa escribe "afinacion". */
check(/normalize\('NFD'\)/.test(pal),
  'encuentra "Afinacion" escribiendo "afinacion"');

check(/ArrowDown/.test(pal) && /ArrowUp/.test(pal) && /e\.key === 'Enter'/.test(pal)
   && /e\.key === 'Escape'/.test(pal),
  'se recorre con flechas, se abre con Enter y se cierra con Escape');
check(/localStorage\.getItem\(RECIENTES\)/.test(pal) && /catch/.test(pal),
  'recuerda lo ultimo usado, y sin almacenamiento sigue funcionando');

/* Un cliente ES una persona: lleva su figura, no un icono generico. */
check(/persona: 'c:'/.test(pal) && /r\.persona/.test(palHtml),
  'un cliente aparece con su figura');

/* Emil: lo que se dispara con el teclado cincuenta veces al dia no se anima. */
check(/wxpal-entra 90ms/.test(palCss),
  'entra casi sin animarse',
  'un dialogo de 230 ms se siente lento a la tercera vez del dia');

/* Un vacio que dice que hacer, no solo que no hay nada. */
check(/wxpal__nada/.test(palHtml) && /Se buscan productos, clientes/.test(palHtml),
  'el estado vacio explica que se puede pedir');

/* Y sigue siendo un ACELERADOR: nada vive solo aqui. */
/* `dock` viene sin comentarios; esta regla vive precisamente en uno. */
check(/Ctrl\+K es un acelerador, no el unico camino/.test(leer(DOCK_TS)),
  'el dock deja escrito que Ctrl+K no sustituye a la navegacion');

// ===================================================================
seccion('10. El menu del avatar es de la sesion, y vive en la cabecera');

/*
 * DOS FIGURAS EN EL DOCK ERAN UNA DE MAS.
 *
 * Habia Wybix a la izquierda y la persona a la derecha: dos caras pequenas en
 * la misma barra que se leian como decoracion repetida. La barra de trabajo es
 * para NAVEGAR; quien ha entrado es CONTEXTO, igual que el negocio, y el
 * contexto ya vivia en la cabecera.
 */
check(!/wx-avatar/.test(dockHtml),
  'en el dock queda UNA sola figura, y es Wybix');
check((dockHtml.match(/<wx-mascota/g) || []).length === 1,
  'una sola, no dos');
check(/wx-avatar/.test(panelHtml) && /wx-yo__btn/.test(panelHtml),
  'y la persona vive en la cabecera, junto al negocio');

/*
 * Tenia «Crear usuario», y eso no es una accion sobre uno mismo; ademas crear
 * usuarios ya vive en Configuracion > Usuarios y permisos, con rol y
 * contrasena.
 */
const bloqueYo = panelHtml.slice(panelHtml.indexOf('wx-yo__menu'));
check(!/sign_up/.test(dock) && !/sign_up/.test(panelTs),
  'el menu del usuario ya no lleva a la pantalla suelta de crear usuario');
check(!/Crear usuario/.test(bloqueYo),
  'ni la ofrece como accion personal');
check(/Cerrar sesión/.test(bloqueYo),
  'cerrar sesion sigue, que es la unica accion personal que existe de verdad');
check(/await this\.auth\.salir\(\)/.test(panelTs),
  'y cierra la sesion de verdad, no solo cambia de pantalla');

const canalesSeg = leer(join('electron', 'seguridad', 'canales.js'));
check(/'users:reset-password': CONFIGURACION_ADMINISTRAR/.test(canalesSeg),
  'cambiar contrasena sigue siendo cosa de administracion, no personal',
  'por eso no aparece en este menu: no existe como accion de uno mismo');
check(/puedeAdministrarUsuarios/.test(panelTs),
  'y el acceso a administrar usuarios solo se ofrece a quien puede');

// ===================================================================
seccion('10b. Wybix Mini abre la guia, y la guia hace algo');

check(/alternarGuia/.test(dock) && /\(click\)="alternarGuia\(\$event\)"/.test(dockHtml),
  'pulsar Wybix Mini abre el resumen',
  'antes estaba ahi sin hacer nada, que es lo que lo hacia parecer adorno');
check(/\[size\]="32"/.test(dockHtml),
  'y mide 32 px, dentro de la franja de una figura reconocible');
check(!/routerLink/.test(dockHtml.slice(dockHtml.indexOf('wxdock__pulso'),
                                        dockHtml.indexOf('wxdock__sep'))),
  'no navega a ninguna parte: abre');

/*
 * LA MISMA IDENTIDAD EN LOS TRES SITIOS DONDE SE VE.
 *
 * Ya no es «una sola semilla en el componente»: desde que Wybix Guide toma
 * una variante por sesion, la identidad vive en el servicio y las tres
 * figuras la leen de ahi. Si una de las tres se la calculara por su cuenta,
 * el dock y el panel enseñarian personajes distintos en la misma pantalla.
 */
for (const [donde, html] of [['el dock', dockHtml], ['el panel de la guia', guiaHtml],
                             ['Inicio', inicioHtml]]) {
  check(/\[variante\]="guia\.variante\(\)"/.test(html),
    `${donde} lee la variante de la guia`,
    'tres calculos distintos darian tres personajes distintos a la vez');
}
const guiaTs = sinComentarios(leer(join('src', 'app', 'wx-guia', 'guia.service.ts')));
check(/readonly variante = signal<VarianteMascota>\(varianteDeSesion\(/.test(guiaTs),
  'y se fija UNA vez, al entrar',
  'sortearla al pintar cambiaria de personaje entre pantallas');

/* El estado del dock y el de Inicio salen del mismo sitio. */
check(/this\.guia\.hayPendientes\(\) \? 'atencion' : 'idle'/.test(dock),
  'y la cara del dock sale de la guia, no de un calculo propio del dock');

check(/document:keydown\.escape/.test(guiaComp), 'Escape cierra el panel');
check(/alPulsarFuera/.test(guiaComp) && /wxdock__pulso/.test(guiaComp),
  'un clic fuera cierra, y el propio boton no cuenta como fuera',
  'si contara, pulsarlo cerraria y volveria a abrir en el mismo gesto');
check(!/mouseenter|:hover/.test(guiaComp),
  'y no depende del cursor: se abre pulsando, tambien con el dedo');

/* No hay un segundo motor de alertas. */
check(/alertsCounts|getOpenShift|serviciosOrdenes|getSalesDayly/.test(guia),
  'la guia lee de canales que ya existian');
check(!/ipcRenderer|invoke\(/.test(guia),
  'y no abre ninguno nuevo');

/* Permisos: no se ofrece lo que esta persona no puede ejecutar. */
check(/paquete\?: string/.test(guia) && /this\.puede\(a\.paquete\)/.test(guia),
  'cada aviso declara el paquete que hace falta para resolverlo');
check(/\{ \.\.\.a, ruta: undefined \}/.test(guia),
  'y a quien no lo tiene se le quita la ACCION, no el aviso',
  'enterarse de que falta stock sirve aunque no seas tu quien repone');
check(/necesitaAdmin/.test(guia) && /necesita un administrador/.test(guiaHtml),
  'y se le dice que hace falta un administrador');
check(/\*ngIf="a\.ruta; else soloInforma"/.test(guiaHtml),
  'un aviso sin accion no se dibuja como boton');

/* El orden lo decide el giro. */
check(/prioridadPorGiro/.test(guia) && /this\.giro\.inicio === 'agenda'/.test(guia),
  'el orden de los avisos lo decide el giro',
  'una barberia mira primero su agenda y un taller sus ordenes');

/* Sale de su propio boton, no del centro de la pantalla. */
const guiaCss = leer(GUIA_CSS);
check(/transform-origin: bottom left/.test(guiaCss),
  'el panel escala desde la esquina donde vive Wybix Mini');
check(!/inset: 0/.test(guiaCss),
  'y no es un modal centrado que corte el trabajo');

/*
 * ANCLADO AL BOTON, NO A UN NUMERO.
 *
 * Estaba `fixed` con `margin-left: -452px`, el ancho que tenia el dock ese
 * dia. Una etiqueta mas larga en otro idioma, un area que aparece por
 * capabilities, otra resolucion o el zoom lo descolocaban sin aviso.
 */
/* Sin comentarios: la nota que EXPLICA el numero magico contiene el numero
   magico, y una prueba que encuentra su propia explicacion da un falso rojo.
   Ya paso con `proximamente` en el catalogo de modulos. */
check(/position: absolute/.test(guiaCss) && !/margin-left: -\d+px/.test(sinComentarios(guiaCss)),
  'y se ancla al boton, sin numeros magicos',
  'nada de un margen negativo sacado del ancho que tenia el dock ese dia');
check(/\.wxdock__anclaWybix \{ position: relative/.test(dockCss),
  'el boton vive en un contenedor relativo, que es todo el anclaje que hace falta');
check(/<wx-guia><\/wx-guia>/.test(dockHtml),
  'y el panel cuelga de ese contenedor, no de la carcasa');

// ===================================================================
seccion('11. Rive: preparado, documentado y sin asset falso');

check(existsSync(RIVE_DOC), 'el contrato del asset esta escrito');
const rive = existsSync(RIVE_DOC) ? leer(RIVE_DOC) : '';
for (const pieza of ['`Wybix`', 'Number', 'wybix.riv', '200 × 200']) {
  check(rive.includes(pieza), `el contrato dice ${pieza}`);
}
check(/no debe inventarse uno/.test(rive),
  'y deja claro que no se fabrica un binario falso');
check(!existsSync(join('src', 'assets', 'mascota', 'wybix.riv')),
  'no hay ningun .riv inventado en el arbol');
check(/Blobatar/i.test(rive) && /Sistema y evento/i.test(rive),
  'y el reparto con blobatar esta escrito');

console.log(`\nRESULTADO: ${fallos.length ? `${fallos.length} FALLO(S) de ${ok + fallos.length}` : `TODO BIEN · ${ok}/${ok}`}`);
process.exit(fallos.length ? 1 : 0);
