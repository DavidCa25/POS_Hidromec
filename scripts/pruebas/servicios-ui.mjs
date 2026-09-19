/**
 * SERVICIOS NO PUEDE VOLVER A VERSE PRESTADO DE OTRO PROGRAMA.
 *
 *     node scripts/pruebas/servicios-ui.mjs
 *
 * Servicios se escribió aparte del resto de Wybix y se le notaba: `<select>`
 * del sistema operativo, calendarios del navegador, cadenas de avisos con tres
 * ventanas para una sola decisión y valores sueltos sin unidad —«10», «120»,
 * «1850»— que podían ser por ciento, minutos o pesos.
 *
 * Esto no vuelve a mirar si se ve bonito: mira si se está usando lo que YA
 * estaba resuelto. Son regresiones, no gusto.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const raiz = process.cwd();
const MODULO = join(raiz, 'src', 'modulo-servicios');

let pasos = 0, fallos = 0;
const check = (cond, titulo, detalle) => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? `  · ${detalle}` : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? `\n            ${detalle}` : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

/** Todos los archivos de pantalla del módulo. */
function fuentes() {
  const salida = [];
  const recorrer = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) recorrer(p);
      else if (/\.(ts|html)$/.test(e.name)) salida.push({ p, rel: p.slice(raiz.length + 1), txt: readFileSync(p, 'utf8') });
    }
  };
  recorrer(MODULO);
  return salida;
}

const archivos = fuentes();

// ===========================================================================
seccion('1. Los controles son los de Wybix, no los del sistema operativo');
// ===========================================================================

/* Un `<select>` nativo toma el tipo, el tamaño y los colores del sistema
   operativo: en medio de una pantalla de Wybix se ve prestado de otro
   programa. `wx-select` existe justo por eso y ya estaba estabilizado —con su
   teclado, su búsqueda y su detección de colisión— antes de que Servicios se
   escribiera. */
/* Se quitan los comentarios ENTEROS, no sólo las líneas que empiezan por una
   marca: un bloque tiene líneas interiores que no empiezan por nada, y una de
   ellas explica justamente el `<select>` que se quitó. Un comentario que cita
   el fallo antiguo es documentación, no una regresión. */
const sinComentarios = (txt) => txt
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const conSelectNativo = archivos.filter(a => /<select[\s>]/.test(sinComentarios(a.txt)));
check(conSelectNativo.length === 0,
  'ningun <select> nativo en las plantillas del modulo',
  conSelectNativo.map(a => a.rel).join('\n            ') || 'se usa wx-select');

/* Lo mismo con las fechas y las horas: `wx-date` y `wx-time` son los que usan
   Compras y los reportes. El del navegador cambia de aspecto y de idioma en
   cada equipo. */
const conFechaNativa = archivos.filter(
  a => /type="date"|type="datetime-local"|type="time"/.test(sinComentarios(a.txt)));
check(conFechaNativa.length === 0,
  'ni un calendario u hora del navegador',
  conFechaNativa.map(a => a.rel).join('\n            ') || 'se usan wx-date y wx-time');

// ===========================================================================
seccion('2. Ningun desplegable puede ensenar «undefined»');
// ===========================================================================

/* El fallo real: `sp_get_active_products` devuelve la columna del nombre como
   `product_name`, y «añadir refacción» leía `nombre`. El desplegable enseñaba
   «undefined» en cada fila. No faltaba el dato -estaba entero en la base- sino
   que se leía con otro nombre, y eso sólo se ve pulsando el botón. */
const orden = readFileSync(join(MODULO, 'orden', 'orden.component.ts'), 'utf8');
check(/product_name/.test(orden),
  'la lista de materiales lee product_name, que es como lo devuelve inventario');
check(/\(sin nombre\)/.test(orden),
  'y si aun asi llegara vacio, se dice, no se ensena «undefined»');

/* Y nadie puede componer una etiqueta a partir de un campo que no existe sin
   respaldo. Se busca el patrón `etiqueta: x.algo` sin `??` detrás. */
const etiquetasSinRespaldo = [];
for (const a of archivos) {
  for (const m of a.txt.matchAll(/etiqueta:\s*(?:String\()?([a-z]\w*\.\w+)(?!\s*\?\?)\)?[,\n]/g)) {
    if (!/\?\?/.test(m[0])) etiquetasSinRespaldo.push(`${a.rel}: ${m[1]}`);
  }
}
check(etiquetasSinRespaldo.length === 0,
  'ninguna etiqueta de opcion se arma sin respaldo',
  etiquetasSinRespaldo.join('\n            ') || 'todas con ?? o con texto fijo');

// ===========================================================================
seccion('3. Los modales son los de Wybix, y llevan etiquetas');
// ===========================================================================

const ordenHtml = readFileSync(join(MODULO, 'orden', 'orden.component.html'), 'utf8');
check(/class="modal fade show d-block srv-modal"/.test(ordenHtml),
  'la orden usa el mismo marcado de modal que Clientes y el punto de venta');

const modales = (ordenHtml.match(/class="modal fade show d-block/g) || []).length;
check(modales >= 4, `y son ${modales}: recepcion, linea, autorizacion, datos y activo`);

/* Un campo sin etiqueta obliga a adivinar. Los `swal2-input` sueltos que había
   antes no tenían ninguna: sólo un `placeholder`, que desaparece al escribir. */
const etiquetas = (ordenHtml.match(/class="form-label"/g) || []).length;
check(etiquetas >= 10, `los campos llevan etiqueta visible`, `${etiquetas} etiquetas`);

check(/aria-modal="true"/.test(ordenHtml) && /aria-labelledby=/.test(ordenHtml),
  'y se anuncian como dialogo a quien no ve la pantalla');

/* Un número sin unidad no dice si son pesos, minutos o por ciento. */
check(/Importe\s*<b/.test(ordenHtml) && /moneda\(importeLinea\)/.test(ordenHtml),
  'lo que va a costar la linea se dice en pesos mientras se escribe');

// ===========================================================================
seccion('4. El vocabulario sale del giro, no del taller');
// ===========================================================================

/* Lo que se buscaba: palabras de taller escritas a mano en sitios que ve
   cualquier giro. «Refacción» en una barbería era el caso que apareció. */
const PALABRAS = ['Refacción', 'Refacciones', 'vehículo', 'Vehículo', 'placa', 'Placa', 'coche'];
const sospechosos = [];
for (const a of archivos) {
  /* El componente de activos y el JSON de giros pueden nombrarlas: uno tiene
     el catálogo de clases y el otro ES el vocabulario. */
  if (/activos\.component/.test(a.rel)) continue;
  const lineas = a.txt.split('\n');
  lineas.forEach((l, i) => {
    if (/^\s*(\/\/|\*|\/\*|<!--)/.test(l)) return;        // comentarios, no
    for (const w of PALABRAS) {
      if (l.includes(w)) sospechosos.push(`${a.rel}:${i + 1}  ${l.trim().slice(0, 70)}`);
    }
  });
}
check(sospechosos.length === 0,
  'ninguna pantalla nombra un vehiculo o una refaccion por su cuenta',
  sospechosos.join('\n            ') || 'todo sale de giro.textos y giro.material');

const giroSrv = readFileSync(join(raiz, 'src', 'core', 'giro-servicios.service.ts'), 'utf8');
check(/get material\(\)/.test(giroSrv) && /get textos\(\)/.test(giroSrv),
  'y el vocabulario tiene una sola puerta');

// ===========================================================================
seccion('5. Las citas que ya no ocupan horario no lo parecen');
// ===========================================================================

const agenda = readFileSync(join(MODULO, 'agenda', 'agenda.component.ts'), 'utf8');
check(/viva \? Math\.max\(22/.test(agenda),
  'una cita cancelada o no-llego se encoge a una banda',
  'con la altura completa tapa el hueco que acaba de quedar libre');
check(/CITA_ENCIMADA/.test(agenda),
  'el choque llega con quien y de cuando a cuando');
check(/ya tiene una cita de \$\{c\.desde\} a \$\{c\.hasta\}/.test(agenda),
  'y se cuenta en castellano, no con una marca de tiempo');
/* Y el titulo viejo no vuelve. Se mira la cadena que veia el usuario, no el
   comentario que explica por que se fue: un comentario que cita el error
   antiguo es documentacion, no una regresion. */
check(!/title: 'Esa hora ya está ocupada'/.test(agenda),
  'el aviso viejo -«Esa hora ya esta ocupada»- no vuelve');

const agendaCss = readFileSync(join(MODULO, 'agenda', 'agenda.component.css'), 'utf8');
check(/\.ag-bloque--pasada/.test(agendaCss), 'con estilo propio, detras de las vivas');

// ===========================================================================
seccion('6. El tablero no promete cobrar lo ya cobrado');
// ===========================================================================

const ordenes = readFileSync(join(MODULO, 'ordenes', 'ordenes.component.ts'), 'utf8');
check(/'por-entregar'/.test(ordenes),
  'existe «Por entregar»: lo cobrado y no entregado tiene donde estar');
check(/economic_status === 'SIN_COBRAR'/.test(ordenes),
  '«Por cobrar» mira el estado ECONOMICO, no solo el operativo',
  'una orden cobrada seguia apareciendo ahi porque el filtro preguntaba otra cosa');
check(/'por-entregar': t\.filter/.test(ordenes),
  'y los conteos cuentan lo mismo que ensena cada pestana');

// ===========================================================================
seccion('7. Un servicio no esta agotado');
// ===========================================================================

const invHtml = readFileSync(join(raiz, 'src', 'inventario', 'inventario.html'), 'utf8');
const invTs = readFileSync(join(raiz, 'src', 'inventario', 'inventario.ts'), 'utf8');
check(/sinInventario\(item\)/.test(invHtml) && /sinInventario\(item: any\)/.test(invTs),
  'inventario distingue lo que no lleva existencias');
check(/stock-na/.test(invHtml),
  'y lo dice en vez de responder «0 pza»',
  'un cero se lee como agotado, y una afinacion no se agota');

// ===========================================================================
seccion('8. El avatar no engorda el arranque');
// ===========================================================================

const avatar = readFileSync(join(raiz, 'src', 'app', 'wx-avatar', 'wx-avatar.component.ts'), 'utf8');
check(/import\('blobatar\/uri'\)/.test(avatar),
  'blobatar se carga de forma dinamica y por subruta',
  'ni entra en el paquete inicial ni arrastra el barril entero');
check(/CACHE\.set/.test(avatar), 'y cada semilla se calcula una sola vez');
const pkg = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8'));
check(!pkg.dependencies['@blobatar/react'] && !pkg.devDependencies?.['@blobatar/react'],
  'sin el adaptador de React',
  'pide react>=18 como dependencia par, y esto es Angular');
check(!existsSync(join(raiz, 'pnpm-lock.yaml')),
  'y sin un segundo gestor de paquetes discutiendo sobre node_modules');

// ===========================================================================
seccion('9. Touch es la misma arquitectura, no otro modulo');
// ===========================================================================

/* La regla de producto: UNA arquitectura. Core + Servicios + giro. Si la
   pantalla tactil trajera su propio servicio, su propio calculo de solapes o
   su propia copia de la aritmetica de la agenda, tendriamos dos Servicios que
   se separan, y el sintoma seria una cita colocada media hora mas abajo en
   una de las dos pantallas. */
const touch = readFileSync(join(raiz, 'src', 'touch', 'servicios', 'touch-servicios.ts'), 'utf8');
check(/from '\.\.\/\.\.\/modulo-servicios\/servicios\.service'/.test(touch),
  'Touch usa el MISMO servicio que el Backoffice');
check(/from '\.\.\/\.\.\/modulo-servicios\/agenda\/agenda-layout'/.test(touch),
  'y la misma aritmetica para colocar el dia',
  'copiarla habria dado dos versiones de la misma cuenta');
check(!/serviciosCitas|ipcRenderer|electronAPI\.servicios/.test(touch),
  'sin hablar con el proceso principal por su cuenta');

const layout = readFileSync(
  join(raiz, 'src', 'modulo-servicios', 'agenda', 'agenda-layout.ts'), 'utf8');
check(/export function ventanaDe/.test(layout) && /export function bloquesDe/.test(layout),
  'la aritmetica del dia vive en un solo archivo');
check(/altoHora/.test(layout),
  'y la ergonomia entra como parametro',
  'en Touch la hora mide mas porque el dedo es mas gordo que el cursor');

const agendaEscritorio = readFileSync(
  join(MODULO, 'agenda', 'agenda.component.ts'), 'utf8');
check(/agenda-layout/.test(agendaEscritorio) || /minutosDe/.test(agendaEscritorio),
  'y la agenda de escritorio sigue en pie');

const rutas = readFileSync(join(raiz, 'src', 'app', 'app.routes.ts'), 'utf8');
check(/path: 'touch\/servicios'[\s\S]{0,200}puedeVerServicios/.test(rutas),
  'la ruta tactil pasa por el MISMO guard que la de escritorio',
  'dos puertas para lo mismo son dos sitios donde equivocarse');

const touchCss = readFileSync(
  join(raiz, 'src', 'touch', 'servicios', 'touch-servicios.css'), 'utf8');
check(/--tp-touch/.test(touchCss) && /--tp-tap/.test(touchCss),
  'y hereda la densidad tactil que ya estaba declarada',
  'no inventa una escala nueva');
check(/ts-cita--pasada/.test(touchCss),
  'las citas cerradas tampoco compiten por el sitio en la tableta');

// ===========================================================================
console.log(`\n${fallos === 0 ? 'TODO BIEN' : 'HAY FALLOS'} · ${pasos - fallos}/${pasos}`);
process.exit(fallos === 0 ? 0 : 1);
