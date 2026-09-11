/**
 * QUE OPCIONES LLEVA UNA LINEA DE VENTA.
 *
 *     node scripts/pruebas/opciones-linea.mjs
 *
 * EL FALLO QUE ORIGINA ESTA PRUEBA
 * --------------------------------
 * En QA, Retail no podia vender el Caramel Macchiato (id 5) ni el Taro Latte
 * (id 7): "no tiene receta configurada". La receta SI existia, pero solo la de
 * la variante:
 *
 *     recipes: product_id=5, variant_option_id=1, active=1
 *     EXEC sp_get_recipe @product_id=5, @variant_option_id=1    -> receta
 *     EXEC sp_get_recipe @product_id=5, @variant_option_id=NULL -> nada
 *
 * `sp_register_sale` resuelve la receta contra las opciones de rol SIZE que
 * trae la linea, y Retail anadia SIEMPRE sin opciones:
 *
 *     this.cart.addProduct(CatalogService.toLineSource(p), 1);   // venta.ts
 *
 * Asi que Retail no PERDIA el `variant_option_id`: nunca lo determinaba. Touch
 * si, porque su hoja de opciones lo resolvia... con una regla escrita solo
 * dentro de Touch.
 *
 * QUE SE COMPRUEBA
 * ----------------
 * La regla compartida (`src/core/opciones.ts`), compilada de verdad y
 * ejercitada: que un grupo obligatorio de una sola opcion se resuelve solo,
 * que uno con varias obliga a elegir, y que lo opcional no estorba.
 */
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

console.log('\nQUE OPCIONES LLEVA UNA LINEA DE VENTA');

/* El modulo se COMPILA y se ejecuta; no se reimplementa aqui. Sus dos imports
   son solo de tipos, asi que TypeScript los elide y el JavaScript resultante
   no depende de Angular. */
const salida = mkdtempSync(join(tmpdir(), 'wx-opc-'));
let M = null;
/* `--noResolve`: solo interesa ESTE archivo. Sus dos imports son de tipos y
   TypeScript los elide al emitir, asi que el JavaScript resultante no depende
   de Angular; sin `--noResolve`, tsc se pone a cargar `@angular/core` para
   comprobar tipos que aqui no hacen falta.
   El codigo de salida de tsc se ignora a proposito: con `--noResolve` quedan
   avisos de tipos sin resolver, pero el archivo se emite igual. Lo que decide
   si la prueba puede seguir es que el .js exista y se pueda importar. */
try {
  execFileSync('npx', ['tsc', join('src', 'core', 'opciones.ts'),
    '--outDir', salida, '--module', 'es2020', '--target', 'es2020',
    '--skipLibCheck', '--noResolve'],
    { stdio: 'pipe', shell: true });
} catch { /* ver arriba: el codigo de salida no decide nada */ }

const js = join(salida, 'opciones.js');
check(existsSync(js), 'src/core/opciones.ts compila a JavaScript');
if (existsSync(js)) {
  try {
    M = await import(pathToFileURL(js).href);
    check(typeof M.seleccionAutomatica === 'function', 'y exporta la regla compartida');
  } catch (e) {
    fallos++;
    console.log('   FALLA  no se pudo importar el modulo compilado: ' + e.message);
  }
}

if (M) {
  const grupo = (id, name, role, extra = {}) => ({
    id, name, role, min_select: 0, max_select: 1, required: false, sort_order: 0,
    options: [], ...extra,
  });
  const opcion = (id, group_id, name, price_delta = 0) =>
    ({ id, group_id, name, price_delta, effect: 'SCALE', sort_order: 0, available_units: 99 });

  // ==========================================================================
  seccion('1. Un tamano obligatorio con UNA sola opcion se resuelve solo');

  // Es exactamente la forma de los productos 5 y 7 del QA: un grupo SIZE
  // obligatorio con una unica opcion, "Chico" (option_id = 1).
  const soloChico = [grupo(10, 'Tamano', 'SIZE', {
    required: true, min_select: 1, max_select: 1, options: [opcion(1, 10, 'Chico')],
  })];

  check(M.exigeElegir(soloChico) === false, 'no hace falta preguntar nada',
    'pedirle al cajero que confirme lo obvio en cada venta seria peor');
  const auto = M.seleccionAutomatica(soloChico);
  check(auto.length === 1 && auto[0].optionId === 1,
    'y la variante viaja en la linea igualmente', `option_id ${auto[0]?.optionId}`);
  check(auto[0].groupId === 10 && auto[0].quantity === 1, 'con su grupo y cantidad');
  check(M.gruposQuePreguntar(soloChico).length === 0, 'no queda ningun grupo pendiente');

  // ==========================================================================
  seccion('2. Con varias opciones, hay que elegir');

  const chicoGrande = [grupo(10, 'Tamano', 'SIZE', {
    required: true, min_select: 1, max_select: 1,
    options: [opcion(1, 10, 'Chico'), opcion(2, 10, 'Grande', 15)],
  })];

  check(M.exigeElegir(chicoGrande) === true, 'exige elegir', 'no se puede adivinar el tamano');
  check(M.seleccionAutomatica(chicoGrande).length === 0, 'y NO se elige ninguna por su cuenta',
    'elegir "la primera" seria vender un tamano que nadie pidio');
  const pend = M.gruposQuePreguntar(chicoGrande);
  check(pend.length === 1 && pend[0].grupo.id === 10, 'queda un grupo que preguntar', pend[0]?.grupo?.name);
  check(M.opcionesElegibles(pend[0].grupo).length === 2, 'con sus dos opciones');

  // ==========================================================================
  seccion('3. Lo opcional no estorba');

  const extras = [grupo(20, 'Extras', 'ADDON', {
    required: false, min_select: 0, max_select: 3,
    options: [opcion(5, 20, 'Shot extra', 10), opcion(6, 20, 'Vainilla', 8)],
  })];
  check(M.exigeElegir(extras) === false, 'un grupo opcional no bloquea la venta');
  check(M.seleccionAutomatica(extras).length === 0, 'ni se auto-agrega nada',
    'un extra que nadie pidio se cobraria y se descontaria de inventario');

  // Un grupo de varias opciones pero no obligatorio tampoco se pregunta.
  const opcionalUnico = [grupo(21, 'Leche', 'SUBSTITUTION', {
    required: false, min_select: 0, max_select: 1, options: [opcion(7, 21, 'Deslactosada', 5)],
  })];
  check(M.exigeElegir(opcionalUnico) === false && M.seleccionAutomatica(opcionalUnico).length === 0,
    'una sustitucion opcional de una sola opcion NO se aplica sola',
    'cambiar la leche sin que nadie lo pida cambiaria receta y precio');

  // ==========================================================================
  seccion('4. Una opcion desactivada no puede ser la elegida');

  const conInactiva = [grupo(30, 'Tamano', 'SIZE', {
    required: true, min_select: 1, max_select: 1,
    options: [{ ...opcion(1, 30, 'Chico'), active: false }, opcion(2, 30, 'Grande')],
  })];
  const auto4 = M.seleccionAutomatica(conInactiva);
  check(auto4.length === 1 && auto4[0].optionId === 2,
    'con una sola opcion ACTIVA, se resuelve con esa', `option_id ${auto4[0]?.optionId}`);

  // ==========================================================================
  seccion('5. Que falta por elegir (la regla que compartia Touch)');

  const sel = new Map();
  check(M.faltanPorElegir(chicoGrande, sel).length === 1, 'sin elegir nada, falta el tamano');
  sel.set(10, [{ id: 2 }]);
  check(M.faltanPorElegir(chicoGrande, sel).length === 0, 'elegido, ya no falta');

  const dosDeTres = [grupo(40, 'Acompanamientos', 'ADDON', {
    required: true, min_select: 2, max_select: 3,
    options: [opcion(1, 40, 'A'), opcion(2, 40, 'B'), opcion(3, 40, 'C')],
  })];
  const sel2 = new Map([[40, [{ id: 1 }]]]);
  check(M.faltanPorElegir(dosDeTres, sel2).length === 1, 'un minimo de 2 con 1 elegida sigue faltando');
  sel2.set(40, [{ id: 1 }, { id: 2 }]);
  check(M.faltanPorElegir(dosDeTres, sel2).length === 0, 'con 2, ya no');

  // ==========================================================================
  seccion('6. Sin grupos, nada cambia');
  check(M.exigeElegir([]) === false && M.seleccionAutomatica([]).length === 0,
    'un producto sin opciones entra igual que siempre',
    'esto es la inmensa mayoria del catalogo de Retail');
}

// ============================================================================
seccion('7. Las dos pantallas usan la MISMA regla');

const retail = readFileSync(join('src', 'venta', 'appVenta', 'venta.ts'), 'utf8');
check(!/addProduct\(CatalogService\.toLineSource\(p\), 1\);/.test(retail),
  'Retail ya no agrega siempre sin opciones',
  'era la linea exacta que dejaba las lineas sin variante');
check(/seleccionAutomatica|gruposQuePreguntar/.test(retail), 'Retail usa core/opciones');

const touch = readFileSync(join('src', 'touch', 'touch-pos.ts'), 'utf8');
check(/faltanPorElegir|gruposPendientes/.test(touch), 'Touch tambien');
check(!/g\.required \|\| g\.min_select > 0\) && g\.max_select === 1/.test(touch),
  'y ya no lleva su propia copia de la regla');

try { rmSync(salida, { recursive: true, force: true }); } catch { /* noop */ }

console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S) de ${pasos}` : `\nRESULTADO: OK (${pasos} comprobaciones)`);
process.exit(fallos ? 1 : 0);
