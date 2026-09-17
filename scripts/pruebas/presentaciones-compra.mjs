/**
 * COMPRAR POR BULTO Y VENDER POR UNIDAD, EN CUALQUIER GIRO.
 *
 *     node scripts/pruebas/presentaciones-compra.mjs
 *
 * QUE ESTABA MAL
 * --------------
 * `product_presentations` nacio con el dominio Hospitality y las pantallas
 * quedaron condicionadas a ese perfil, con este razonamiento escrito en el
 * codigo: "en Retail nadie compra cajas de 1 L". Es falso en cuanto se mira
 * cualquier mostrador. Una refaccionaria compra aceite en cajas de 12 y de 24,
 * lo vende por pieza, y la conversion que necesita es exactamente la misma.
 *
 * QUE DECIDE AHORA
 * ----------------
 * El DATO, no el giro: si el producto tiene presentaciones definidas, el
 * selector aparece; si no, no se dibuja. Un mostrador que no las use no ve
 * ninguna diferencia, y no hay una lista de perfiles que ampliar cada vez que
 * alguien las necesite.
 *
 * QUE COMPRUEBA ESTA PRUEBA, Y QUE NO
 * -----------------------------------
 * Que la puerta por perfil no vuelva. La aritmetica -5 cajas de 12 suben 60
 * piezas y el costo se divide entre 12- vive en `sp_register_purchase` y esta
 * probada contra SQL Server en `scripts/db/pruebas/compras.mjs`, que compra dos
 * cajas de doce de un producto por pieza y comprueba las 24 piezas, el costo de
 * 8 y el precio de venta derivado de la PIEZA. Aqui no se repite esa cuenta:
 * se comprueba quien puede llegar a ella.
 *
 * Es una prueba sobre el fuente. Las dos pantallas son componentes de Angular y
 * no se pueden instanciar en Node sin arrastrar medio framework; lo que se mira
 * es la condicion escrita, que es justamente lo que se quiere congelar.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

const leer = (...p) => readFileSync(join(process.cwd(), ...p), 'utf8');

/** El cuerpo de un metodo o getter, sin el resto del archivo. */
function cuerpo(fuente, firma) {
  const i = fuente.indexOf(firma);
  if (i < 0) return null;
  const desde = fuente.slice(i);
  const fin = desde.indexOf('\n  }');
  return fin < 0 ? desde : desde.slice(0, fin);
}

const inventario = leer('src', 'inventario', 'inventario.ts');
const compras = leer('src', 'compras', 'appRegistrarCompra', 'registrarCompra.ts');
const comprasHtml = leer('src', 'compras', 'appRegistrarCompra', 'registrarCompra.html');
const inventarioHtml = leer('src', 'inventario', 'inventario.html');

// ===================================================================
seccion('1. Definir presentaciones no depende del giro del negocio');

const gestiona = cuerpo(inventario, 'get gestionaPresentaciones()');
check(gestiona !== null, 'existe gestionaPresentaciones');
check(!/caps\.hospitality/.test(gestiona || ''),
  'no pregunta por el perfil de negocio', (gestiona || '').trim());
check(/capturaStock/.test(gestiona || ''),
  'pide que el producto lleve existencias propias',
  'definir cajas de algo que no se inventaria no significa nada');

for (const metodo of ['private async cargarPresentaciones(productId: number)',
                      'private async guardarPresentaciones(productId: number)']) {
  const c = cuerpo(inventario, metodo);
  check(c !== null, `existe ${metodo.split('(')[0].split(' ').pop()}`);
  check(!/caps\.hospitality/.test(c || ''),
    `y ${metodo.split('(')[0].split(' ').pop()} tampoco pregunta por el perfil`);
}

/* La seccion de la pantalla cuelga del getter, no de una condicion suelta que
   alguien pueda volver a atar al perfil sin tocar el getter. */
check(/\*ngIf="gestionaPresentaciones"/.test(inventarioHtml),
  'la pantalla de inventario cuelga de ese getter y de nada mas');

// ===================================================================
seccion('2. En la compra decide el producto, no el perfil');

const cargar = cuerpo(compras, 'private async cargarPresentaciones(item: PurchaseItem)');
check(cargar !== null, 'existe cargarPresentaciones en la compra');
check(!/caps\.hospitality|caps\./.test(cargar || ''),
  'no hay puerta por perfil antes de pedir las presentaciones');
check(/if \(!lista\.length\) return;/.test(cargar || ''),
  'sin presentaciones definidas la linea se queda en unidad base',
  'esa es la condicion que sustituye a la puerta');

/* Y el selector se dibuja por el dato. Si esto se atara a un perfil, el resto
   de la prueba pasaria igual y la columna no saldria en Retail. */
check(/\*ngIf="it\.presentaciones\.length > 1"/.test(comprasHtml),
  'el selector aparece solo si el producto tiene mas de una presentacion');
check(!/caps\./.test(comprasHtml),
  'y la plantilla de compras no consulta capabilities');

/* El componente ya no inyecta lo que no usa: una dependencia que sobra es la
   forma mas comoda de volver a atar la puerta sin darse cuenta. */
check(!/CapabilityService/.test(compras),
  'el componente de compra ya no inyecta CapabilityService');

// ===================================================================
seccion('3. Nada de esto vivia en la base: no hay que tocarla');

const guardar = leer('sql', 'procedures', 'hospitality', 'sp_save_product_presentation.sql');
const registrar = leer('sql', 'procedures', 'purchases', 'sp_register_purchase.sql');

for (const [nombre, sql] of [['sp_save_product_presentation', guardar],
                             ['sp_register_purchase', registrar]]) {
  check(!/business_profile/i.test(sql),
    `${nombre} no mira el perfil de negocio`,
    'la conversion por factor siempre fue de todos los giros');
}
check(!/inventory_mode/i.test(registrar),
  'y tampoco el tipo de inventario del producto');
check(/factor_to_base/.test(registrar),
  'la conversion sigue saliendo de factor_to_base');

/* La cuenta de verdad esta probada contra SQL Server, con un producto por
   pieza: dos cajas de doce entran como 24 piezas. Que esa prueba siga
   existiendo es parte de este cambio. */
const compraSql = leer('scripts', 'db', 'pruebas', 'compras.mjs');
check(/Caja 12/.test(compraSql) && /entran 24 piezas/.test(compraSql),
  'db:test-compras sigue cubriendo la compra por caja de un producto por pieza',
  'es la misma aritmetica del aceite por caja de 12 o de 24');

console.log(`\nRESULTADO: ${fallos ? `${fallos} FALLO(S) de ${pasos}` : `OK (${pasos} comprobaciones)`}`);
process.exit(fallos ? 1 : 0);
