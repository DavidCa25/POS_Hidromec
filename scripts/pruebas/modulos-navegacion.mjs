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

/*
 * LA NAVEGACION YA NO ESTA EN EL RAIL.
 *
 * La navegacion se DECLARA como datos en un solo registro
 * (`NavegacionService`), que pintan el dock y la barra lateral. Esta prueba
 * lee ese registro: lo que valga ahi vale para las dos formas.
 *
 * Lo que comprueba NO ha cambiado, porque lo que protege no era el rail sino
 * una leccion que costo tres mudanzas: Aplicaciones y Fidelizacion tienen que
 * ser de PRIMER NIVEL. En el dock, primer nivel significa una de dos cosas:
 * un area, o una entrada de "Mas". Lo que NO vale es colgar de los `destinos`
 * de otro dominio, que es la forma que tiene el dock de repetir el error de
 * dejar una campana dentro de Inventario.
 */
const DOCK = join('src', 'app', 'wx-nav', 'navegacion.service.ts');
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

const dock = readFileSync(DOCK, 'utf8');
const rutas = readFileSync(RUTAS, 'utf8');
const comp = readFileSync(COMP, 'utf8');
const modulos = readFileSync(MODULOS, 'utf8');
const negocio = readFileSync(NEGOCIO, 'utf8');
const caps = readFileSync(CAPS, 'utf8');

/** El dock sin comentarios: lo que de verdad se declara. */
const sinComentarios = dock
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/** Las entradas de primer nivel que no caben en las seis plazas del dock. */
function bloqueMas() {
  const i = sinComentarios.indexOf('readonly mas =');
  if (i < 0) return '';
  return sinComentarios.slice(i, sinComentarios.indexOf('.filter(x => x.visible);', i));
}

/** Los bloques `destinos: [...]`: lo que cuelga DENTRO de un area. */
function bloquesDestinos() {
  const out = [];
  for (const m of sinComentarios.matchAll(/destinos:\s*\[([\s\S]*?)\]/g)) out.push(m[1]);
  return out.join('\n');
}

/**
 * La linea que declara el destino de esa ruta, sea area o entrada de "Mas".
 * Devuelve null si la ruta no se ofrece en ningun sitio.
 */
function entrada(ruta) {
  for (const linea of sinComentarios.split('\n')) {
    if (linea.includes(`'${ruta}'`)) return linea;
  }
  return null;
}

/** Esa ruta, ¿cuelga de los `destinos` de otro dominio? */
function cuelgaDeOtro(ruta) {
  return bloquesDestinos().includes(`'${ruta}'`);
}

/** ¿Es una entrada de "Mas", que es primer nivel? */
function estaEnMas(ruta) {
  return bloqueMas().includes(`'${ruta}'`);
}

// ===================================================================
seccion('1. Aplicaciones es una entrada propia de primer nivel');

const apps = entrada('/dashboard/aplicaciones');
check(!!apps, 'existe la entrada Aplicaciones');
check(estaEnMas('/dashboard/aplicaciones'),
  'y es de primer nivel: vive en "Mas", no dentro de otro dominio',
  'colgada de un area seria una opcion de otra cosa, no una seccion');
check(!cuelgaDeOtro('/dashboard/aplicaciones'),
  'no cuelga de los destinos de ningun area');

/*
 * El menu de usuario es para la sesion: cerrarla, cambiar de usuario. Un
 * catalogo de modulos del producto no es una preferencia de quien ha entrado.
 */
const menuUsuario = readFileSync(join('src', 'app', 'wx-dock', 'wx-dock.component.html'), 'utf8');
const bloqueYo = menuUsuario.slice(menuUsuario.indexOf('wxdock-pop--yo'));
check(!/aplicaciones/.test(bloqueYo),
  'y NO esta duplicada en el menu de usuario',
  'dos accesos a lo mismo acaban divergiendo');

check(/aplicaciones/.test(rutas) && /loadComponent/.test(rutas),
  'su pantalla se carga bajo demanda');

// ===================================================================
seccion('2. Fidelizacion es un dominio propio, condicionado');

const fid = entrada('/dashboard/fidelizacion');
check(!!fid, 'existe la entrada Fidelizacion');
check(estaEnMas('/dashboard/fidelizacion') && !cuelgaDeOtro('/dashboard/fidelizacion'),
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
check(/id: 'servicios'/.test(modulos), 'y Servicios tambien');

/*
 * La regla NO es "hay un solo modulo": es que TODOS los declarados existan de
 * verdad.
 *
 * Esta comprobacion decia `entradas === 1`, que era cierto el dia que se
 * escribio y dejo de serlo en cuanto el producto crecio. Lo que se queria
 * proteger es otra cosa: que no aparezcan tarjetas "proximamente", que llevan
 * dos anos ahi y dejan de leerse. Un modulo real tiene capacidad y tiene ruta;
 * uno inventado, no.
 */
const entradas = (modulos.match(/^\s{4}id: '([a-z-]+)'/gm) || [])
  .map(l => l.replace(/^\s+id: '/, '').replace(/'$/, ''));
const capacidades = (modulos.match(/capability: '([A-Za-z]+)'/g) || []).length;
const conRuta = (modulos.match(/route: '/g) || []).length;

check(entradas.length >= 1, 'el catalogo declara modulos', entradas.join(', '));
check(capacidades === entradas.length,
  'cada modulo apunta a una capacidad real de Capabilities',
  `${capacidades} capacidades para ${entradas.length} modulos`);
check(conRuta === entradas.length,
  'y cada uno lleva a una pantalla que existe',
  'una tarjeta sin destino es una tarjeta "proximamente"');
/* Sin los comentarios: el propio `modulos.ts` EXPLICA por que no debe haber
   tarjetas "proximamente", y esa frase encajaba con la busqueda. Ya paso antes
   con `rol IN (` en sp_authorize_supervisor: una prueba que encuentra su propia
   explicacion da un falso rojo. */
const declaraciones = modulos
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
check(!/proximamente|próximamente|coming soon/i.test(declaraciones),
  'sin tarjetas "proximamente"');

for (const id of entradas) {
  check(new RegExp(`'${id}'`).test(caps),
    `la capacidad de ${id} existe en CapabilityService`);
}

// ===================================================================
seccion('5. Encender modulos exige el paquete de configuracion');

/* Antes esto preguntaba `esAdmin`. El problema no era que fuera laxo -lo era
   al reves-, sino que el nombre del rol y lo que la operacion exige eran dos
   cosas distintas escritas en dos sitios. Ahora las dos preguntan por el mismo
   paquete, y el de verdad lo comprueba el proceso principal. */
check(/CONFIGURACION_ADMINISTRAR/.test(comp),
  'la pantalla pregunta por el paquete, no por el nombre del rol');
check(/puedeAdministrar/.test(comp) && /if \(!this\.puedeAdministrar\) return;/.test(comp),
  'y tambien al pulsar, no solo al entrar',
  'esconder un boton no es un permiso');
check(!!apps && /administrarNegocio/.test(apps),
  'y el enlace no se ofrece a quien no puede usarlo');

/* Lo anterior es cortesia. Esto es la seguridad: el canal que enciende un
   modulo esta en el mapa del proceso principal y exige el paquete. Sin esto,
   cualquiera con la consola abierta encenderia Hospitality a mano. */
const canales = readFileSync(join('electron', 'seguridad', 'canales.js'), 'utf8');
check(/'modules:set': CONFIGURACION_ADMINISTRAR/.test(canales),
  'y el proceso principal lo exige de verdad, no solo la pantalla');
const main = readFileSync(join('electron', 'main.js'), 'utf8');
check(/ipcMain\.handle\('modules:set', sesion\.proteger\('modules:set'/.test(main),
  'el handler pasa por la puerta de autorizacion');
check(/VERSION_ATRASADA/.test(main),
  'y una caja con version anterior no puede administrar modulos',
  'interpretaria los paquetes con reglas viejas; vender si puede');

console.log(`\nRESULTADO: ${fallos.length ? `${fallos.length} FALLO(S) de ${ok + fallos.length}` : `OK (${ok} comprobaciones)`}`);
process.exit(fallos.length ? 1 : 0);
