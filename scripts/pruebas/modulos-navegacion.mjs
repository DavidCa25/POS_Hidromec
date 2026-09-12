/**
 * Aplicaciones y Fidelizacion en el menu: donde estan y cuando aparecen.
 *
 *     node scripts/pruebas/modulos-navegacion.mjs
 *
 * Esta prueba existe porque la ubicacion de estas dos entradas ya se movio
 * tres veces -dentro de Configuracion, dentro de Inventario, dentro del menu
 * de usuario- y cada vez parecia razonable al escribirla. Lo que decide no es
 * si cabe, es que clase de cosa es cada una:
 *
 *   Aplicaciones   catalogo de modulos del producto. Seccion propia, siempre.
 *   Fidelizacion   un dominio como Venta o Compra. Propio, pero solo si esta
 *                  encendido.
 *
 * Se lee el arbol, no la aplicacion en marcha: lo que se comprueba es que la
 * plantilla las declare donde toca y con la condicion correcta.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const RAIL = join('src', 'dashboard', 'dashboard.html');
const RUTAS = join('src', 'app', 'app.routes.ts');
const COMP = join('src', 'app', 'aplicaciones', 'aplicaciones.component.ts');
const MODULOS = join('src', 'core', 'modulos.ts');
const NEGOCIO = join('src', 'app', 'negocio-panel', 'negocio-panel.component.html');
const CAPS = join('src', 'core', 'capability.service.ts');

let ok = 0;
const fallos = [];
const check = (cond, titulo, detalle) => {
  if (cond) { ok++; console.log(`   ok     ${titulo}`); }
  else { fallos.push(titulo); console.log(`   FALLA  ${titulo}${detalle ? `\n            ${detalle}` : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

const rail = readFileSync(RAIL, 'utf8');
const rutas = readFileSync(RUTAS, 'utf8');
const comp = readFileSync(COMP, 'utf8');
const modulos = readFileSync(MODULOS, 'utf8');
const negocio = readFileSync(NEGOCIO, 'utf8');
const caps = readFileSync(CAPS, 'utf8');

/** El rail sin comentarios: lo que de verdad se pinta. */
const sinComentarios = rail.replace(/<!--[\s\S]*?-->/g, '');

/** El bloque `<li>` que contiene un enlace a esa ruta. */
function entrada(ruta) {
  const i = sinComentarios.indexOf(`routerLink="${ruta}"`);
  if (i < 0) return null;
  const ini = sinComentarios.lastIndexOf('<li', i);
  const fin = sinComentarios.indexOf('</li>', i);
  return sinComentarios.slice(ini, fin);
}

// ===================================================================
seccion('1. Aplicaciones es una entrada propia del menu lateral');

const apps = entrada('/dashboard/aplicaciones');
check(!!apps, 'existe la entrada Aplicaciones');
check(!!apps && /sidebar-link/.test(apps),
  'y es un enlace del menu lateral, no de un desplegable',
  'dentro de un dropdown seria una opcion de otra cosa, no una seccion');
check(!!apps && !/dropdown-item/.test(apps),
  'no vive dentro de ningun menu desplegable');

/*
 * El menu de usuario es para la sesion: cerrarla, cambiar de usuario. Un
 * catalogo de modulos del producto no es una preferencia de quien ha entrado.
 */
const menuUsuario = sinComentarios.slice(sinComentarios.indexOf('user-dropdown'));
check(!/\/dashboard\/aplicaciones/.test(menuUsuario.slice(0, 1200)),
  'y NO esta duplicada en el menu de usuario',
  'dos accesos a lo mismo acaban divergiendo');

check(/aplicaciones/.test(rutas) && /loadComponent/.test(rutas),
  'su pantalla se carga bajo demanda');

// ===================================================================
seccion('2. Fidelizacion es un dominio propio, condicionado');

const fid = entrada('/dashboard/fidelizacion');
check(!!fid, 'existe la entrada Fidelizacion');
check(!!fid && /sidebar-link/.test(fid),
  'y tambien es de primer nivel',
  'vivio colgada de Inventario, que es donde nadie buscaria una campana');
check(!!fid && /caps\.loyalty/.test(fid),
  'aparece SOLO con el modulo encendido');
check(!!apps && !/caps\.loyalty/.test(apps),
  'Aplicaciones, en cambio, no depende de ningun modulo',
  'es desde donde se encienden: esconderla dejaria sin forma de activarlos');

// ===================================================================
seccion('3. Un solo sitio donde encender un modulo');

check(!/loyalty_enabled/.test(negocio),
  'Datos del negocio ya no lleva el interruptor',
  'dos sitios para encender lo mismo acaban contradiciendose');
check(/setModulo/.test(caps),
  'CapabilityService concentra el encendido');
check(/business_config/.test(caps) || /updateBusinessConfig/.test(caps),
  'y sigue guardandolo donde ya vivia',
  'un modulo lo enciende el negocio y lo ven todas las cajas');

// ===================================================================
seccion('4. El catalogo describe el producto, no inventa modulos');

check(/id: 'loyalty'/.test(modulos), 'Fidelizacion esta en el catalogo');
const entradas = (modulos.match(/^\s{4}id: '/gm) || []).length;
check(entradas === 1,
  'y es el UNICO modulo declarado',
  `hay ${entradas}: una tarjeta "proximamente" que lleva dos anos ahi deja de leerse`);
check(/capability: 'loyalty'/.test(modulos),
  'apunta a una capacidad real de Capabilities');

// ===================================================================
seccion('5. Encender modulos exige ser administrador');

check(/esAdmin/.test(comp),
  'la pantalla comprueba el rol');
check(/puedeAdministrar/.test(comp) && /if \(!this\.puedeAdministrar\) return;/.test(comp),
  'y tambien al pulsar, no solo al entrar',
  'esconder un boton no es un permiso');
check(!!apps && /auth\.esAdmin/.test(apps),
  'y el enlace no se ofrece a quien no puede usarlo');

console.log(`\nRESULTADO: ${fallos.length ? `${fallos.length} FALLO(S) de ${ok + fallos.length}` : `OK (${ok} comprobaciones)`}`);
process.exit(fallos.length ? 1 : 0);
