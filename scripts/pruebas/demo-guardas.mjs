/**
 * QUE SE PUEDE BORRAR Y QUE NO.
 *
 *     node scripts/pruebas/demo-guardas.mjs
 *
 * Esta es la prueba que importa de todo el gestor de demos. El resto puede
 * fallar y lo peor que pasa es que una demostracion no se cree. Si fallan
 * estas, alguien se queda sin la base de su negocio.
 *
 * Por eso se ejercitan las guardas REALES -`electron/demo/guardas.js`, sin
 * copiarlas aqui- y se prueba sobre todo el caso negativo: no que borre lo
 * que debe, sino que NO borre lo que no debe, aunque le lleguen datos
 * cruzados a proposito.
 *
 * No toca ninguna base de datos. Corre en un segundo.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const G = require('../../electron/demo/guardas.js');

let ok = 0;
const fallos = [];
const check = (cond, titulo, detalle) => {
  if (cond) { ok++; console.log(`   ok     ${titulo}`); }
  else { fallos.push(titulo); console.log(`   FALLA  ${titulo}${detalle ? `\n            ${detalle}` : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

const PERFILES = [{ id: 'retail' }, { id: 'hospitality' }];

/** El identificador que la semilla dejo en la base y el gestor tiene anotado. */
const INSTANCIA = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const OTRA_INSTANCIA = '11111111-2222-3333-4444-555555555555';
const META_DEMO = { is_demo: 'true', demo_profile: 'retail', demo_instance_id: INSTANCIA };

/** Un caso completo y valido, del que las pruebas van estropeando una pieza. */
const VALIDO = {
  perfilId: 'retail',
  nombre: 'Wybix_Demo_Retail',
  perfilesInstalados: PERFILES,
  metadatos: META_DEMO,
  instanciaLocal: INSTANCIA,
};

// ===================================================================
seccion('1. El nombre se COMPONE, no se recibe');

check(G.nombreDeBase('retail') === 'Wybix_Demo_Retail', 'retail -> Wybix_Demo_Retail');
check(G.nombreDeBase('hospitality') === 'Wybix_Demo_Hospitality', 'hospitality -> Wybix_Demo_Hospitality');
check(G.nombreDeBase('punto-venta') === 'Wybix_Demo_PuntoVenta', 'punto-venta -> Wybix_Demo_PuntoVenta');

/* Lo importante: no hay identificador de perfil que produzca el nombre de una
   base real. Por eso el IPC acepta perfiles y no nombres. */
for (const veneno of [
  'Wybix_POS', '../Wybix_POS', 'retail; DROP DATABASE Wybix_POS', 'retail]', '',
  null, undefined, 'RETAIL', 'retail ', '1retail', 'a'.repeat(60),
]) {
  let salio = null;
  try { salio = G.nombreDeBase(veneno); } catch { salio = 'RECHAZADO'; }
  check(salio === 'RECHAZADO', `se rechaza el perfil ${JSON.stringify(veneno)}`,
    salio !== 'RECHAZADO' ? `produjo ${salio}` : '');
}

// ===================================================================
seccion('2. Wybix_POS no se puede borrar de ninguna manera');

/* El caso que esta prueba existe para impedir. Se intenta por todos los
   angulos: por el nombre, con el marcador puesto y con el perfil correcto. */
const ataques = [
  ['con el nombre directo', { ...VALIDO, nombre: 'Wybix_POS' }],
  ['en minusculas', { ...VALIDO, nombre: 'wybix_pos' }],
  ['con el marcador de demo puesto a mano', { ...VALIDO, nombre: 'Wybix_POS', metadatos: META_DEMO }],
  ['la base de produccion', { ...VALIDO, nombre: 'Wybix_Production' }],
  ['la plantilla', { ...VALIDO, nombre: 'Wybix_Template' }],
  ['master', { ...VALIDO, nombre: 'master' }],
  ['una base cualquiera', { ...VALIDO, nombre: 'ContabilidadDelCliente' }],
];
for (const [etiqueta, caso] of ataques) {
  const r = G.sePuedeDestruir(caso);
  check(r.ok === false, `NO se borra ${etiqueta}`, r.ok ? 'DEVOLVIO QUE SI' : '');
}

// ===================================================================
seccion('3. Nombre de demo sin marcador: tampoco');

/* El caso 13 del encargo. Una base que se llama como una demo pero que no
   lleva el marcador no la creo este gestor, y no se sabe que es. */
const sinMarcador = G.sePuedeDestruir({ ...VALIDO, metadatos: {} });
check(sinMarcador.ok === false, 'una base Wybix_Demo_* sin is_demo no se borra',
  sinMarcador.ok ? 'DEVOLVIO QUE SI' : '');
check(/marcador/i.test(sinMarcador.motivo), 'y lo dice por su nombre', sinMarcador.motivo);

for (const valor of ['false', '0', '', 'TRUE ', 'si', null]) {
  const r = G.sePuedeDestruir({ ...VALIDO, metadatos: { is_demo: valor } });
  check(r.ok === false, `is_demo = ${JSON.stringify(valor)} no cuenta como marcador`);
}
check(G.sePuedeDestruir({
  ...VALIDO, metadatos: { ...META_DEMO, is_demo: 'TRUE' },
}).ok === true, 'pero TRUE en mayusculas si, porque es el mismo valor');

// ===================================================================
seccion('4. Marcador puesto pero nombre invalido: tampoco');

/* El caso 14. Aunque alguien marque una base como demo, si no se llama como
   una demo no se toca: el marcador solo. */
for (const nombre of ['Wybix_Demo', 'Wybix_Demo_', 'Demo_Retail', 'Wybix_Demo_Retail_Old',
                      'Wybix_Demo_Retail;DROP', 'Wybix_Demo_9Retail']) {
  const r = G.sePuedeDestruir({ ...VALIDO, nombre });
  check(r.ok === false, `${nombre} no encaja en el patron`, r.ok ? 'DEVOLVIO QUE SI' : '');
}

// ===================================================================
seccion('5. El nombre tiene que corresponder al perfil');

/* Que el nombre sea valido y el perfil exista no basta: tienen que ser el
   mismo. Si no, borrar "hospitality" podria llevarse la base de retail. */
const cruzado = G.sePuedeDestruir({ ...VALIDO, perfilId: 'hospitality' });
check(cruzado.ok === false, 'pedir hospitality y pasar la base de retail se rechaza',
  cruzado.ok ? 'DEVOLVIO QUE SI' : '');
check(/no corresponde/i.test(cruzado.motivo), 'y se dice por que', cruzado.motivo);

// ===================================================================
seccion('6. El perfil tiene que estar instalado');

const inventado = G.sePuedeDestruir({
  perfilId: 'farmacia', nombre: 'Wybix_Demo_Farmacia',
  perfilesInstalados: PERFILES, metadatos: META_DEMO, instanciaLocal: INSTANCIA,
});
check(inventado.ok === false, 'un perfil que no esta instalado se rechaza',
  inventado.ok ? 'DEVOLVIO QUE SI' : '');

/* Y en cuanto se instala, el mismo caso pasa: la lista es lo que manda, no
   una constante escrita en el codigo. */
const instalado = G.sePuedeDestruir({
  perfilId: 'farmacia', nombre: 'Wybix_Demo_Farmacia',
  perfilesInstalados: [...PERFILES, { id: 'farmacia' }],
  metadatos: META_DEMO, instanciaLocal: INSTANCIA,
});
check(instalado.ok === true, 'y anadiendo su carpeta, el mismo perfil ya vale',
  'los perfiles se anaden poniendo una carpeta, sin tocar codigo');

// ===================================================================
seccion('7. Tiene que ser la demo de ESTE gestor');

/* El marcador dice "soy una demo"; el identificador dice "soy TU demo". Sin
   el segundo bastaria con escribir is_demo a mano en cualquier base con
   nombre de demo para volverla destruible. */
const sinRegistro = G.sePuedeDestruir({ ...VALIDO, instanciaLocal: null });
check(sinRegistro.ok === false, 'sin registro local no se toca nada',
  sinRegistro.ok ? 'DEVOLVIO QUE SI' : '');
check(/no tiene registrada/i.test(sinRegistro.motivo), 'y se dice por que', sinRegistro.motivo);

const ajena = G.sePuedeDestruir({ ...VALIDO, instanciaLocal: OTRA_INSTANCIA });
check(ajena.ok === false, 'una demo creada por otra instalacion no se toca',
  ajena.ok ? 'DEVOLVIO QUE SI' : '');
check(/no coincide/i.test(ajena.motivo), 'y se dice por que', ajena.motivo);

/* La base tambien tiene que traerlo: una demo de una version anterior, o una
   base marcada a mano, no tiene identificador que comparar. */
for (const [caso, valor] of [
  ['sin identificador', undefined],
  ['vacio', ''],
  ['que no es un UUID', 'demo'],
  ['a medias', '7c9e6679-7425-40de-944b'],
]) {
  const r = G.sePuedeDestruir({
    ...VALIDO,
    metadatos: { is_demo: 'true', demo_profile: 'retail', demo_instance_id: valor },
    instanciaLocal: String(valor ?? ''),
  });
  check(r.ok === false, `una base con identificador ${caso} se rechaza`,
    r.ok ? 'DEVOLVIO QUE SI' : '');
}

/* Y la comprobacion es exacta: ni prefijos, ni mayusculas distintas, ni
   espacios de mas. Una coincidencia aproximada no es una coincidencia. */
for (const [caso, local] of [
  ['con un espacio detras', `${INSTANCIA} `],
  ['en mayusculas', INSTANCIA.toUpperCase()],
  ['solo el principio', INSTANCIA.slice(0, 8)],
]) {
  const r = G.sePuedeDestruir({ ...VALIDO, instanciaLocal: local });
  check(r.ok === false, `un identificador ${caso} no cuenta como igual`,
    r.ok ? 'DEVOLVIO QUE SI' : '');
}

// ===================================================================
seccion('7b. Cuanto se haya usado la demo NO decide nada');

/* Esto estuvo al reves: habia un tope de 200 ventas por encima del cual el
   gestor se negaba a tocar la base. Una demo se usa para capacitar a un
   equipo, para una prueba de carga o para ensenarla trescientas veces, y
   despues de eso sigue siendo desechable. */
check(G.VENTAS_MAXIMAS_DEMO === undefined,
  'ya no existe un tope de ventas en las guardas',
  `sigue exportandose: ${G.VENTAS_MAXIMAS_DEMO}`);

const codigo = readFileSync(new URL('../../electron/demo/guardas.js', import.meta.url), 'utf8');
const lineasConVentas = codigo.split(/\r?\n/)
  .filter(l => /\bventas\b/i.test(l) && !/^\s*[*/]/.test(l));
check(lineasConVentas.length === 0,
  'y ninguna linea de codigo de guardas.js mira las ventas',
  lineasConVentas.join(' | '));

for (const cantidad of [0, 4, 200, 201, 5000, 1e6]) {
  /* Se pasa a proposito un campo `ventas` que ya nadie lee: si alguien lo
     volviera a conectar, estas comprobaciones se caen. */
  const r = G.sePuedeDestruir({ ...VALIDO, ventas: cantidad });
  check(r.ok === true, `con ${cantidad} ventas se sigue pudiendo destruir`,
    r.ok ? '' : r.motivo);
}

// ===================================================================
seccion('8. El caso bueno sigue funcionando');

const bien = G.sePuedeDestruir(VALIDO);
check(bien.ok === true, 'una demo de verdad SI se puede destruir',
  bien.ok ? '' : bien.motivo);
check(G.sePuedeDestruir({
  perfilId: 'hospitality', nombre: 'Wybix_Demo_Hospitality',
  perfilesInstalados: PERFILES,
  metadatos: { is_demo: 'true', demo_instance_id: OTRA_INSTANCIA },
  instanciaLocal: OTRA_INSTANCIA,
}).ok === true, 'y la de hospitality tambien');

console.log(`\nRESULTADO: ${fallos.length ? `${fallos.length} FALLO(S) de ${ok + fallos.length}` : `OK (${ok} comprobaciones)`}`);
process.exit(fallos.length ? 1 : 0);
