/**
 * La pantalla de cliente muestra la marca del NEGOCIO, no la del POS.
 *
 *     node scripts/pruebas/customer-display-marca.mjs
 *
 * Esta pantalla es el escaparate del comercio: es lo unico de Wybix que mira
 * un cliente que no trabaja ahi. Durante un tiempo encabezo la pantalla de
 * espera con el isotipo de Wybix, igual que el ticket llego a imprimir la
 * marca de OTRO cliente. Las dos cosas son el mismo error y ninguna se ve
 * desde el codigo: hay que mirar una caja encendida para notarlas.
 *
 * Por eso esta prueba: que no vuelva a entrar por descuido.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const VISTA = join('electron', 'customer-display', 'customer.html');
const MAIN = join('electron', 'main.js');
const PRELOAD = join('electron', 'customer-display', 'customer-preload.js');

let ok = 0;
const fallos = [];
const check = (cond, titulo, detalle) => {
  if (cond) { ok++; console.log(`   ok     ${titulo}`); }
  else { fallos.push(titulo); console.log(`   FALLA  ${titulo}${detalle ? `\n            ${detalle}` : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

const vista = readFileSync(VISTA, 'utf8');
const main = readFileSync(MAIN, 'utf8');
const preload = readFileSync(PRELOAD, 'utf8');

/** El HTML sin comentarios: lo que de verdad se pinta. */
const sinComentarios = vista
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

// ===================================================================
seccion('1. Ningun asset de marca ajena se pinta como identidad del comercio');

/*
 * Se buscan sobre el HTML SIN comentarios a proposito. Los comentarios
 * explican por que el logo de Wybix ya no esta, y esa explicacion nombra el
 * archivo: una busqueda ingenua sobre el texto completo fallaria por leer la
 * propia advertencia que evita el fallo.
 */
const ASSETS_PROHIBIDOS = ['wybie_logo', 'wybix_logo', 'LogoHidromec', 'FILURI', 'OcusCR'];
for (const asset of ASSETS_PROHIBIDOS) {
  check(!sinComentarios.includes(asset),
    `no referencia ${asset}`,
    `la pantalla del cliente no puede llevar un logo que no sea el del negocio`);
}

check(!/<img[^>]+src\s*=\s*["'][^"']*assets\//i.test(sinComentarios),
  'ninguna <img> apunta a los assets del instalador',
  'el logo tiene que venir de lo que configuro el negocio, no del paquete');

// ===================================================================
seccion('2. La identidad se pide y se pinta');

check(/getBusiness\s*:/.test(preload), 'el preload expone getBusiness()');
check(/customer:get-business/.test(main), 'el proceso principal atiende customer:get-business');

const handler = main.slice(main.indexOf("ipcMain.handle('customer:get-business'"));
const cuerpoHandler = handler.slice(0, handler.indexOf('});') + 3);
check(/logoUrl\s*:/.test(cuerpoHandler), 'y devuelve el logo del negocio',
  'sin esto la pantalla no tiene de donde sacarlo');
check(/name\s*:/.test(cuerpoHandler), 'y su nombre');
check(/ticketLogoUrl\(\)/.test(cuerpoHandler),
  'reutilizando el MISMO logo que encabeza el ticket',
  'dos copias de la misma marca acaban no coincidiendo');

check(/b\.logoUrl/.test(vista), 'la vista usa el logo que le llega');
check(/idleBiz/.test(vista) && /saleBiz/.test(vista), 'y el nombre del negocio en espera y en venta');

// ===================================================================
seccion('3. Sin logo hay un fallback neutro, no una marca prestada');

check(/idleInicial/.test(sinComentarios), 'existe el monograma de respaldo');
check(/charAt\(0\)\.toUpperCase\(\)/.test(vista),
  'que usa la inicial del negocio',
  'un negocio sin logo se ve con su inicial, no con la de nadie mas');
check(/onerror/.test(vista),
  'y si el archivo del logo falla, se cae al monograma',
  'antes que ensenarle al cliente el icono de imagen rota');

/*
 * El fallo original no fue solo el asset: la linea que pretendia personalizar
 * escribia `.textContent` sobre un `<img>`, que no renderiza texto. El logo
 * ajeno se quedaba puesto pasara lo que pasara.
 */
const marca = sinComentarios.slice(sinComentarios.indexOf('id="idleMarca"'), sinComentarios.indexOf('id="idleBiz"'));
check(marca.includes('id="idleInicial"') && /<span/.test(marca),
  'el monograma es un elemento de texto, no una <img>',
  'escribir texto dentro de una <img> no pinta nada: ese fue el fallo original');

// ===================================================================
seccion('4. Wybix puede firmar, pero no suplantar');

check(/Powered by Wybix/.test(vista), 'la firma discreta existe');
const firma = sinComentarios.slice(sinComentarios.indexOf('porwybix'));
check(!/#idle .marca/.test(firma.slice(0, 200)),
  'y no ocupa el lugar de la identidad del comercio');

// ===================================================================
seccion('5. Todos los estados, incluidos los de Fidelizacion');

for (const id of ['idle', 'sale', 'checkout', 'premios', 'dinamica', 'dinres']) {
  check(new RegExp(`id="${id}"`).test(vista), `existe el estado ${id}`);
}

const cuerpo = sinComentarios.slice(sinComentarios.indexOf('<body>'));
check(!/Wybix/.test(cuerpo.replace(/Powered by Wybix/g, '')),
  'ningun estado nombra a Wybix salvo la firma',
  'la marca del POS no aparece como si fuera la del comercio');

console.log(`\nRESULTADO: ${fallos.length ? `${fallos.length} FALLO(S) de ${ok + fallos.length}` : `OK (${ok} comprobaciones)`}`);
process.exit(fallos.length ? 1 : 0);
