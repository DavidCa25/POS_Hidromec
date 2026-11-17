/**
 * El ticket dice la verdad sobre el dinero, y no lleva la marca de otro.
 *
 *     node scripts/pruebas/ticket.mjs
 *
 * QUE SE ROMPIO
 * -------------
 *   IMPUESTO   El desglose se calculaba dividiendo el TOTAL entre 1.16, con la
 *              tasa escrita a mano. Eso solo es cierto si todo lo vendido es
 *              objeto de impuesto a la tasa general: en una venta con algo
 *              exento el ticket declaraba un IVA que nadie cobro.
 *
 *   LOGO       Iba fijo `assets/LogoHidromec.jpg`. CUALQUIER negocio imprimia
 *              la marca de otro cliente en su ticket.
 *
 *   DOS COPIAS El PDF y la impresion tenian constructores separados, con los
 *              dos defectos duplicados. Arreglar uno dejaba el otro roto.
 *
 * QUE COMPRUEBA
 * -------------
 * El modulo puro `electron/lib/ticket.js`, que es el unico constructor que
 * queda. Sin abrir Electron ni tocar la base.
 */
import { construirTicketHtml, desglosar, tasaDeLinea, etiquetaPago } from '../../electron/lib/ticket.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);
const cerca = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) < eps;

const PLANTILLA = readFileSync(join('electron', 'templates', 'ticket.html'), 'utf8');

const negocio = {
  business_name: 'Café de la Esquina',
  address: 'Av. Juárez 120',
  phone: '33 1234 5678',
  rfc: 'XAXX010101000',
  ticket_footer: '¡Gracias por su compra!',
};

console.log('\nEL TICKET DE VENTA');

// =============================================================== 1
seccion('1. El impuesto sale de la tasa de CADA producto');

check(cerca(tasaDeLinea({ objeto_impuesto: '02', tasa_iva: 0.16 }), 0.16), 'objeto de impuesto: su tasa');
check(cerca(tasaDeLinea({ objeto_impuesto: '01', tasa_iva: 0.16 }), 0), 'no objeto de impuesto: cero');
check(cerca(tasaDeLinea({ objeto_impuesto: '02', tasa_iva: 0.08 }), 0.08), 'tasa de frontera: 8%');
check(cerca(tasaDeLinea({}), 0.16), 'sin datos, se cae a la tasa general, como antes');

// 116 con IVA -> base 100, IVA 16.  50 exento -> base 50, IVA 0.
const mixta = [
  { nombre: 'Café', quantity: 1, unitary_price: 116, line_total: 116, objeto_impuesto: '02', tasa_iva: 0.16 },
  { nombre: 'Libro', quantity: 1, unitary_price: 50, line_total: 50, objeto_impuesto: '01', tasa_iva: 0 },
];
const d = desglosar(mixta);
check(cerca(d.total, 166), 'total 166', String(d.total));
check(cerca(d.base, 150), 'base 150 = 100 gravado + 50 exento', d.base.toFixed(2));
check(cerca(d.impuesto, 16), 'IVA 16, no 22.90', d.impuesto.toFixed(2));

// Lo que hacia antes: 166 / 1.16 = 143.10, IVA 22.90. Casi 7 pesos inventados.
const ingenuo = 166 - 166 / 1.16;
check(Math.abs(ingenuo - d.impuesto) > 6,
  'el calculo viejo inventaba casi 7 pesos de impuesto',
  `${ingenuo.toFixed(2)} vs ${d.impuesto.toFixed(2)}`);

// =============================================================== 2
seccion('2. Sin logo configurado, no se imprime ninguna marca');
const sinLogo = construirTicketHtml(
  { id: 42, datee: '2026-09-10 12:30', payment_method: 'EFECTIVO', paid_amount: 200 },
  mixta, { plantilla: PLANTILLA, negocio, paperWidthMm: 58 });

check(!/Hidromec/i.test(sinLogo), 'no aparece la marca de otro cliente');
check(!/<img/.test(sinLogo), 'y no hay etiqueta de imagen vacia');
check(sinLogo.includes('Café de la Esquina'), 'el encabezado es el nombre del negocio');

const conLogo = construirTicketHtml({ id: 42 }, mixta,
  { plantilla: PLANTILLA, negocio, logoUrl: 'file:///C:/datos/ticket-logo.png' });
check(/<img class="logo" src="file:\/\/\/C:\/datos\/ticket-logo.png"/.test(conLogo),
  'con logo configurado, se usa el del negocio');

// =============================================================== 3
seccion('3. Lo que el cajero necesita ver');
const html = construirTicketHtml(
  { id: 1007, datee: '2026-09-10 12:30', payment_method: 'EFECTIVO', paid_amount: 200,
    cashier: 'David', register_name: 'Caja 1', customer_name: 'Público General',
    service_mode: 'TAKEAWAY' },
  mixta,
  { plantilla: PLANTILLA, negocio, paperWidthMm: 80, fecha: '10/09/2026 12:30', pagado: 200, cambio: 34 });

for (const [que, texto] of [
  ['el folio', '1007'],
  ['la fecha y hora', '10/09/2026 12:30'],
  ['quien atendio', 'David'],
  ['la caja', 'Caja 1'],
  ['el cliente', 'Público General'],
  ['el tipo de servicio', 'Para llevar'],
  ['el RFC', 'XAXX010101000'],
  ['el mensaje final configurado', '¡Gracias por su compra!'],
  ['el nombre de cada producto', 'Café'],
  ['cantidad por precio', '1 x $116.00'],
  ['el subtotal', '$150.00'],
  ['el IVA', '$16.00'],
  ['el total', '$166.00'],
  ['el cambio', '$34.00'],
]) check(html.includes(texto), `aparece ${que}`, texto);

check(html.includes('80mm'), 'el ancho de papel es el configurado', '80 mm');
check(!html.includes('{{'), 'no queda ningun hueco de plantilla sin rellenar');

// =============================================================== 4
seccion('4. Lo que NO debe aparecer');
const soloExento = [{ nombre: 'Libro', quantity: 1, unitary_price: 50, line_total: 50,
                      objeto_impuesto: '01', tasa_iva: 0 }];
const sinIva = construirTicketHtml({ id: 5, payment_method: 'TARJETA' }, soloExento,
  { plantilla: PLANTILLA, negocio });
check(!sinIva.includes('IVA incluido'),
  'una venta sin impuesto no lleva una linea de IVA en cero');
check(sinIva.includes('Tarjeta'), 'y la forma de pago se escribe legible', 'Tarjeta');

const conTarjeta = construirTicketHtml({ id: 6, payment_method: 'TARJETA', paid_amount: 166 },
  mixta, { plantilla: PLANTILLA, negocio, cambio: 0 });
check(!conTarjeta.includes('Cambio'), 'con tarjeta no se habla de cambio');

const aCredito = construirTicketHtml({ id: 7, payment_method: 'CREDITO', paid_amount: 0, balance: 166 },
  mixta, { plantilla: PLANTILLA, negocio });
check(aCredito.includes('Saldo pendiente'), 'una venta a credito muestra el saldo');

// =============================================================== 5
seccion('5. Nada de lo que escribe el usuario puede romper el ticket');
const travieso = construirTicketHtml(
  { id: 8, cashier: '<script>alert(1)</script>' },
  [{ nombre: 'Producto <b>raro</b> & "comillas"', quantity: 1, unitary_price: 10, line_total: 10 }],
  { plantilla: PLANTILLA, negocio: { ...negocio, business_name: 'Bar & Grill <Norte>' } });
check(!travieso.includes('<script>'), 'una etiqueta escrita en un nombre se escapa');
check(travieso.includes('Bar &amp; Grill &lt;Norte&gt;'), 'y los simbolos se ven tal cual');
check(travieso.includes('Producto &lt;b&gt;raro&lt;/b&gt;'), 'tambien en los nombres de producto');

// =============================================================== 6
seccion('6. Etiquetas de pago');
check(etiquetaPago('EFECTIVO') === 'Efectivo', 'EFECTIVO -> Efectivo');
check(etiquetaPago('TRANSFERENCIA') === 'Transferencia', 'TRANSFERENCIA -> Transferencia');
check(etiquetaPago('') === '—', 'sin metodo, una raya, no la cadena vacia');

// =============================================================== 7
seccion('7. El numero de pedido del dia, en grande');
const conPedido = construirTicketHtml({ id: 1010, payment_method: 'EFECTIVO', service_mode: 'TAKEAWAY' },
  mixta, { plantilla: PLANTILLA, negocio, pedido: 23 });
check(/<div class="pedido"><span>Tu pedido<\/span><b class="num">23<\/b>/.test(conPedido), 'una venta de mostrador lleva «Tu pedido 23»');
check(!conPedido.includes('{{'), 'no queda ninguna marca de plantilla sin rellenar');
check(conPedido.indexOf('class="pedido"') < conPedido.indexOf('<table class="items"'), 'va arriba, antes de los productos');
check(!sinLogo.includes('class="pedido"') && !construirTicketHtml({ id: 9 }, mixta, { plantilla: PLANTILLA, negocio, pedido: 'x' }).includes('class="pedido"'),
  'sin numero (o con uno invalido) no se imprime el bloque');
check(!sinLogo.includes('{{PEDIDO_BLOCK}}'), 'y la marca desaparece aunque no haya numero');

// ---------------------------------------------------------- 0083
// IEPS y locales con la foto de la venta (sp_venta_impuestos): papas $58 con
// IEPS 8%, dos refrescos $40 con cuota $1.80, noche $1,190 con hospedaje 3%.
const conIeps = [
  { quantity: 1, unitary_price: 58, line_total: 58, objeto_impuesto: '02', tasa_iva: 0.16, base_neta: 46.2963,
    impuestos_json: JSON.stringify([{ clase: 'IEPS', factor: 'Tasa', tasa: 0.08, importe: 3.7037 }]) },
  { quantity: 2, unitary_price: 20, line_total: 40, objeto_impuesto: '02', tasa_iva: 0.16, base_neta: 32.6828,
    impuestos_json: [{ clase: 'IEPS', factor: 'Cuota', tasa: null, importe: 1.8 }] },
  { quantity: 1, unitary_price: 1190, line_total: 1190, objeto_impuesto: '02', tasa_iva: 0.16, base_neta: 1000,
    impuestos_json: JSON.stringify([{ clase: 'LOCAL', factor: 'Tasa', tasa: 0.03, importe: 30 }]) },
  { quantity: 1, unitary_price: 116, line_total: 116, objeto_impuesto: '02', tasa_iva: 0.16, base_neta: null, impuestos_json: null },
];
const di = desglosar(conIeps);
check(cerca(di.total, 1404), 'IEPS: total $1,404', di.total.toFixed(2));
check(cerca(di.base, 46.2963 + 32.6828 + 1000 + 100), 'IEPS: subtotal = bases sin ningun impuesto', di.base.toFixed(2));
const iepsTasa = di.otros.find((o) => o.etiqueta === 'IEPS 8%'), iepsCuota = di.otros.find((o) => o.etiqueta === 'IEPS cuota'), local = di.otros.find((o) => o.etiqueta === 'Imp. local 3%');
check(iepsTasa && cerca(iepsTasa.importe, 3.70) && iepsCuota && cerca(iepsCuota.importe, 1.80) && local && cerca(local.importe, 30), 'IEPS 8% $3.70, IEPS cuota $1.80, Imp. local 3% $30', JSON.stringify(di.otros));
check(cerca(di.impuesto, 8 + 5.5172 + 160 + 16), 'IVA: el resto, sin contar IEPS ni el local', di.impuesto.toFixed(2));
check(cerca(di.base + di.impuesto + di.otros.reduce((a, o) => a + o.importe, 0), di.total), 'subtotal + impuestos = total exacto');
const htmlIeps = construirTicketHtml({ payment_method: 'EFECTIVO' }, conIeps, { plantilla: PLANTILLA, negocio, paperWidthMm: 58 });
check(htmlIeps.includes('IEPS 8% incluido') && htmlIeps.includes('$3.70') && htmlIeps.includes('Imp. local 3% incluido'), 'el ticket dice IEPS y el local antes del IVA');

console.log(fallos ? `\nRESULTADO: ${fallos} fallas de ${pasos}` : `\nRESULTADO: ${pasos} ok · 0 fallas`);
console.log('El ticket es lo unico que el cliente se lleva.');
process.exit(fallos ? 1 : 0);
