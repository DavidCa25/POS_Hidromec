/**
 * MESAS, CUENTAS, COMANDAS Y ACTIVIDAD POR HORA, CONTRA UNA BASE DE VERDAD.
 *
 *     node scripts/db/pruebas/mesas-comandas.mjs
 *
 * Levanta una base temporal como nace una caja -plantilla, todas las
 * migraciones y el alta del negocio- y recorre la vida de una mesa:
 *
 *   libre -> abrir -> enviar (latte con avena + croissant + agua)
 *         -> KDS por estacion -> preparar/lista/entregada
 *         -> segunda orden -> cancelar una comanda -> cobrar -> libre
 *
 * y el reporte de actividad por hora con ventas a horas conocidas.
 *
 * Nunca toca una base existente: crea la suya y la borra al terminar.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ejecutar, ejecutarVarios, restaurar, eliminar, exigirTemporal, ZONA_COMUN } from '../lib/temporal.mjs';
import { consultarTemporal } from '../lib/temporal-consulta.mjs';

const DB = 'Wybix_TmpMesas';
let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

function q(sql) {
  const r = consultarTemporal(DB, sql);
  if (!r.ok) throw new Error(r.error);
  return r.sets ?? [];
}
const uno = (sql) => (q(sql)[0] ?? [])[0] ?? {};
const escalar = (sql) => Object.values(uno(sql))[0];
/** Ejecuta y devuelve el mensaje de error, o null si no fallo. */
function falla(sql) {
  const r = consultarTemporal(DB, sql);
  return r.ok ? null : String(r.error);
}

const lotesDe = (ruta) => readFileSync(ruta, 'utf8').replace(/\r\n/g, '\n')
  .split(/\n\s*GO\s*\n/gi).map(x => x.trim()).filter(Boolean);

function nacer() {
  eliminar(DB);
  restaurar(DB, join(process.cwd(), 'installer', 'template.bak'));
  const dir = join(process.cwd(), 'electron', 'migrations');
  const lotes = readdirSync(dir).filter(f => f.endsWith('.sql')).sort().flatMap(f => lotesDe(join(dir, f)));
  const r = ejecutarVarios(DB, lotes);
  const malo = r.findIndex(x => !x.ok);
  if (malo >= 0) throw new Error(`migraciones, lote ${malo + 1}: ${r[malo].error}\n${lotes[malo].slice(0, 300)}`);
  ejecutar(DB, `EXEC dbo.sp_setup_inicial @usuario = N'mesas', @password = N'mesas1234',
      @business_name = N'Cafe de prueba', @business_profile = N'HOSPITALITY'`);
}

exigirTemporal(DB);
console.log(`Base temporal ${DB}  ·  zona comun ${ZONA_COMUN}`);

try {
  nacer();

  // ================================================================= SIEMBRA
  ejecutar(DB, `
    INSERT INTO dbo.CAT_categories (namee) VALUES (N'Cafes');
    INSERT INTO dbo.CAT_brands (namee) VALUES (N'Casa');`);
  const cat = escalar(`SELECT TOP 1 id FROM dbo.CAT_categories ORDER BY id DESC`);
  const marca = escalar(`SELECT TOP 1 id FROM dbo.CAT_brands ORDER BY id DESC`);
  const alta = (pn, nombre, precio, modo, stock = 0) => ejecutar(DB, `
    EXEC dbo.sp_add_product @brand = ${marca}, @category = ${cat}, @part_number = N'${pn}', @name = N'${nombre}',
         @price = ${precio}, @stock = ${stock}, @inventory_mode = '${modo}', @sellable = 1`);
  alta('LAT', 'Latte', 52, 'NONE');
  alta('CRO', 'Croissant', 45, 'NONE');
  alta('AGU', 'Agua embotellada', 20, 'DIRECT', 30);
  alta('CHE', 'Cheesecake', 72, 'NONE');
  const id = (pn) => escalar(`SELECT id FROM dbo.products WHERE part_number = N'${pn}'`);
  const [latte, cro, agua, che] = ['LAT', 'CRO', 'AGU', 'CHE'].map(id);

  ejecutar(DB, `
    INSERT INTO dbo.modifier_groups (name, role, min_select, max_select, required, active, sort_order)
    VALUES (N'Leche', 'SUBSTITUTION', 0, 1, 0, 1, 1), (N'Endulzante', 'NOTE', 0, 1, 0, 1, 2);`);
  const gLeche = escalar(`SELECT id FROM dbo.modifier_groups WHERE name = N'Leche'`);
  const gDulce = escalar(`SELECT id FROM dbo.modifier_groups WHERE name = N'Endulzante'`);
  ejecutar(DB, `
    INSERT INTO dbo.modifier_options (group_id, name, price_delta, effect, active, sort_order)
    VALUES (${gLeche}, N'Leche de avena', 8, 'NONE', 1, 1), (${gDulce}, N'Sin azúcar', 0, 'NONE', 1, 1);`);
  const avena = escalar(`SELECT id FROM dbo.modifier_options WHERE name = N'Leche de avena'`);
  const sinAzucar = escalar(`SELECT id FROM dbo.modifier_options WHERE name = N'Sin azúcar'`);

  // ============================================================ ESTACIONES
  seccion('1. Estaciones y lo que prepara cada una');
  const est = (nombre, salida = 'PANTALLA', imp = 'NULL') =>
    uno(`EXEC dbo.sp_prep_station_save @nombre = N'${nombre}', @salida = '${salida}', @impresora = ${imp}`).id;
  const barra = est('Barra'), cocina = est('Cocina'), postres = est('Postres', 'AMBOS', "N'Impresora Postres'");
  check(barra && cocina && postres, 'se crean Barra, Cocina y Postres');
  check(/impresora/i.test(falla(`EXEC dbo.sp_prep_station_save @nombre = N'Frios', @salida = 'IMPRESORA'`) || ''),
    'una estacion de impresora sin impresora se rechaza');
  check(/ya hay/i.test(falla(`EXEC dbo.sp_prep_station_save @nombre = N'Barra'`) || ''),
    'y no hay dos estaciones con el mismo nombre');

  q(`EXEC dbo.sp_product_prep_set @product_id = ${latte}, @station_id = ${barra}`);
  q(`EXEC dbo.sp_product_prep_set @product_id = ${cro}, @station_id = ${cocina}`);
  q(`EXEC dbo.sp_product_prep_set @product_id = ${che}, @station_id = ${postres}`);
  const prep = q(`EXEC dbo.sp_product_prep_get`)[0];
  check(prep.find(p => p.product_id === agua)?.station_id == null, 'el agua no se prepara');
  check(prep.find(p => p.product_id === latte)?.category_name === 'Cafes', 'y el catalogo trae su categoria');

  // ================================================================ SALON
  seccion('2. Salon');
  const salon = uno(`EXEC dbo.sp_salon_area_save @nombre = N'Salón', @orden = 1`).id;
  const terraza = uno(`EXEC dbo.sp_salon_area_save @nombre = N'Terraza', @orden = 2`).id;
  const mesa = (area, nombre) => uno(`EXEC dbo.sp_salon_mesa_save @area_id = ${area}, @nombre = N'${nombre}'`).id;
  const m1 = mesa(salon, 'Mesa 1'), m2 = mesa(salon, 'Mesa 2'), t1 = mesa(terraza, 'Terraza 1');
  check(m1 && m2 && t1, 'se crean tres mesas en dos areas');
  check(/ya hay/i.test(falla(`EXEC dbo.sp_salon_mesa_save @area_id = ${salon}, @nombre = N'Mesa 1'`) || ''),
    'dos mesas no se llaman igual en la misma area');
  const estadoMesa = (m) => (q(`EXEC dbo.sp_salon_get`)[1] || []).find(x => x.id === m);
  check(estadoMesa(m1)?.estado === 'LIBRE', 'Mesa 1 empieza LIBRE');

  // =============================================================== CUENTA
  seccion('3. Abrir la mesa');
  const c1 = uno(`EXEC dbo.sp_hosp_cuenta_abrir @mesa_id = ${m1}, @user_id = 1`).id;
  const otraVez = uno(`EXEC dbo.sp_hosp_cuenta_abrir @mesa_id = ${m1}, @user_id = 1`).id;
  check(c1 && c1 === otraVez, 'abrir dos veces la misma mesa da la MISMA cuenta', `cuenta ${c1}`);
  check(estadoMesa(m1)?.estado === 'ABIERTA', 'y la mesa pasa a ABIERTA');
  check(!!falla(`INSERT INTO dbo.hosp_cuentas (mesa_id) VALUES (${m1})`),
    'SQL impide una segunda cuenta abierta en la misma mesa, aunque dos cajas lo intenten a la vez');

  // ============================================================== ENVIAR
  seccion('4. Primera comanda: latte con avena y sin azucar, croissant y agua');
  const enviar = (cuenta, lineas, opciones = []) => q(`
    DECLARE @l dbo.HospOrdenLineaV2Type;
    INSERT INTO @l (linea, product_id, cantidad, nota, origen) VALUES ${lineas.map(l => `(${l[0]}, ${l[1]}, ${l[2]}, ${l[3] ? `N'${l[3]}'` : 'NULL'}, ${l[4] ? `'${l[4]}'` : 'NULL'})`).join(', ')};
    DECLARE @o dbo.HospOrdenOpcionType;
    ${opciones.length ? `INSERT INTO @o (linea, modifier_option_id, quantity) VALUES ${opciones.map(o => `(${o[0]}, ${o[1]}, ${o[2] ?? 1})`).join(', ')};` : ''}
    EXEC dbo.sp_hosp_orden_enviar @cuenta_id = ${cuenta}, @user_id = 1, @lineas = @l, @opciones = @o;`);

  const r1 = enviar(c1, [[1, latte, 2, null], [2, cro, 1, 'bien dorado'], [3, agua, 1, null]],
                    [[1, avena, 1], [1, sinAzucar, 1]]);
  const comandas1 = r1[1] || [];
  check(comandas1.length === 2, 'genera DOS comandas: barra y cocina', comandas1.map(c => c.estacion).join(', '));
  check(!comandas1.some(c => c.station_id == null), 'el agua no genera comanda');
  check(estadoMesa(m1)?.comandas_pendientes === 2, 'la mesa sabe que tiene dos comandas en marcha');

  const esperado = 2 * (52 + 8) + 45 + 20;
  check(Number(estadoMesa(m1)?.total) === esperado, 'el total de la mesa cuenta el precio de la avena',
    `${estadoMesa(m1)?.total} = 2×(52+8) + 45 + 20`);

  const cuenta = q(`EXEC dbo.sp_hosp_cuenta_get @cuenta_id = ${c1}`);
  check((cuenta[1] || []).length === 3, 'la cuenta guarda las tres lineas');
  check((cuenta[2] || []).map(o => o.option_name).sort().join('|') === 'Leche de avena|Sin azúcar',
    'y las opciones del latte, con su nombre copiado');

  check(/a la venta/i.test(
    falla(`DECLARE @l dbo.HospOrdenLineaV2Type; INSERT INTO @l VALUES (1, 999999, 1, NULL, NULL);
           DECLARE @o dbo.HospOrdenOpcionType;
           EXEC dbo.sp_hosp_orden_enviar @cuenta_id = ${c1}, @lineas = @l, @opciones = @o;`) || ''),
    'un producto que no existe no entra a la cuenta');

  // ================================================================== KDS
  seccion('5. KDS: cada estacion ve lo suyo');
  const kdsBarra = q(`EXEC dbo.sp_kds_get @station_id = ${barra}`);
  check((kdsBarra[0] || []).length === 1, 'la barra ve UNA comanda');
  check((kdsBarra[1] || []).map(l => `${Number(l.cantidad)} ${l.nombre}`).join() === '2 Latte',
    'con 2 Latte');
  check((kdsBarra[2] || []).some(o => o.option_name === 'Leche de avena'), 'y la leche de avena a la vista');
  check((kdsBarra[0] || [])[0]?.destino === 'Mesa 1', 'dice para que mesa es');
  const kdsCocina = q(`EXEC dbo.sp_kds_get @station_id = ${cocina}`);
  check((kdsCocina[1] || []).map(l => l.nombre).join() === 'Croissant', 'la cocina ve solo el croissant');
  check((kdsCocina[1] || [])[0]?.nota === 'bien dorado', 'con su nota');

  const kBarra = kdsBarra[0][0].id;
  check(uno(`EXEC dbo.sp_comanda_estado @comanda_id = ${kBarra}, @estado = 'PREPARANDO'`).estado === 'PREPARANDO',
    'Nueva -> Preparando');
  check(uno(`EXEC dbo.sp_comanda_estado @comanda_id = ${kBarra}, @estado = 'LISTA'`).estado === 'LISTA',
    'Preparando -> Lista');
  check(estadoMesa(m1)?.comandas_listas === 1, 'la mesa sabe que hay algo listo para llevar');
  check(/ya pas. por ese paso/i.test(falla(`EXEC dbo.sp_comanda_estado @comanda_id = ${kBarra}, @estado = 'PREPARANDO'`) || ''),
    'no se vuelve atras');
  check(uno(`EXEC dbo.sp_comanda_estado @comanda_id = ${kBarra}, @estado = 'ENTREGADA'`).estado === 'ENTREGADA',
    'Lista -> Entregada');
  check((q(`EXEC dbo.sp_kds_get @station_id = ${barra}`)[0] || []).length === 0,
    'y una comanda entregada sale de la pantalla');

  // ============================================================ SEGUNDA
  seccion('6. Segunda comanda, y una cancelacion');
  q(`EXEC dbo.sp_hosp_cuenta_estado @cuenta_id = ${c1}, @estado = 'POR_COBRAR'`);
  check(estadoMesa(m1)?.estado === 'POR_COBRAR', 'el cliente pide la cuenta: POR COBRAR');
  const r2 = enviar(c1, [[1, che, 1, null], [2, latte, 1, null]]);
  check((r2[1] || []).length === 2, 'la segunda orden genera sus propias comandas (postres y barra)');
  check((r2[1] || []).some(c => c.salida === 'AMBOS' && c.impresora === 'Impresora Postres'),
    'y avisa de la que va tambien a papel, con su impresora');
  check(estadoMesa(m1)?.estado === 'ABIERTA', 'pedir mas reabre la cuenta');

  const kPostres = (r2[1] || []).find(c => c.estacion === 'Postres').id;
  q(`EXEC dbo.sp_comanda_cancelar @comanda_id = ${kPostres}, @motivo = N'Se acabó', @user_id = 1`);
  check(Number(estadoMesa(m1)?.total) === esperado + 52, 'cancelar el cheesecake lo saca del total',
    `${estadoMesa(m1)?.total}`);
  check(/se entreg.: no se cancela/i.test(falla(`EXEC dbo.sp_comanda_cancelar @comanda_id = ${kBarra}`) || ''),
    'una comanda entregada no se cancela: se cobra');

  // ============================================================== COBRAR
  seccion('7. Cobrar y liberar');
  check(/consumo/i.test(falla(`EXEC dbo.sp_hosp_cuenta_liberar @cuenta_id = ${c1}`) || ''),
    'una mesa con consumo no se libera sin cobrar');
  ejecutar(DB, `INSERT INTO dbo.sales (datee, useer_id, total, payment_method, paid_amount, balance)
                VALUES (GETDATE(), 1, ${esperado + 52}, 'EFECTIVO', ${esperado + 52}, 0);`);
  const venta = escalar(`SELECT MAX(id) FROM dbo.sales`);
  check(uno(`EXEC dbo.sp_hosp_cuenta_cobrar @cuenta_id = ${c1}, @sale_id = ${venta}, @user_id = 1`).estado === 'COBRADA',
    'la cuenta queda COBRADA y enlazada a su venta');
  check(estadoMesa(m1)?.estado === 'LIBRE', 'y la mesa, LIBRE');
  check(uno(`EXEC dbo.sp_hosp_cuenta_cobrar @cuenta_id = ${c1}, @sale_id = ${venta}`).estado === 'COBRADA',
    'reintentar el enlace con la misma venta no falla');
  ejecutar(DB, `INSERT INTO dbo.sales (datee, useer_id, total, payment_method, paid_amount, balance)
                VALUES (GETDATE(), 1, 1, 'EFECTIVO', 1, 0);`);
  const otra = escalar(`SELECT MAX(id) FROM dbo.sales`);
  check(/otra venta/i.test(falla(`EXEC dbo.sp_hosp_cuenta_cobrar @cuenta_id = ${c1}, @sale_id = ${otra}`) || ''),
    'pero una segunda venta distinta se rechaza');
  check(/cerrada/i.test(falla(`DECLARE @l dbo.HospOrdenLineaV2Type; INSERT INTO @l VALUES (1, ${latte}, 1, NULL, NULL);
           DECLARE @o dbo.HospOrdenOpcionType; EXEC dbo.sp_hosp_orden_enviar @cuenta_id = ${c1}, @lineas = @l, @opciones = @o;`) || ''),
    'a una cuenta cobrada no se le envia nada');

  const c2 = uno(`EXEC dbo.sp_hosp_cuenta_abrir @mesa_id = ${m1}`).id;
  check(c2 && c2 !== c1, 'la mesa se vuelve a abrir con una cuenta NUEVA');
  q(`EXEC dbo.sp_hosp_cuenta_liberar @cuenta_id = ${c2}`);
  check(estadoMesa(m1)?.estado === 'LIBRE', 'una cuenta vacia se libera sin cobrar');

  const barraSinMesa = uno(`EXEC dbo.sp_hosp_cuenta_abrir @etiqueta = N'Para llevar: Ana'`);
  check(barraSinMesa.titulo === `Pedido ${barraSinMesa.numero_dia} · Para llevar: Ana` && barraSinMesa.numero_dia > 0,
    'una cuenta sin mesa existe con su número del día y su nombre', barraSinMesa.titulo);
  check(/nombre/i.test(falla(`EXEC dbo.sp_hosp_cuenta_abrir`) || ''), 'y sin mesa ni nombre se rechaza');

  // ===================================================== NUNCA REENVIAR
  seccion('7b. Enviar a preparacion nunca repite una linea');
  const pl = barraSinMesa.id;
  const G1 = 'a1a1a1a1-0000-4000-8000-000000000001';
  const G2 = 'a1a1a1a1-0000-4000-8000-000000000002';
  const lineasDe = () => (q(`EXEC dbo.sp_hosp_cuenta_get @cuenta_id = ${pl}`)[1] || []);
  const comandasDe = () => escalar(`SELECT COUNT(*) FROM dbo.comandas WHERE cuenta_id = ${pl}`);

  const e1 = enviar(pl, [[1, latte, 1, null, G1]], [[1, avena, 1]]);
  check(e1[0]?.[0]?.lineas === 1 && comandasDe() === 1, 'para llevar tambien va a la barra', `${comandasDe()} comanda`);
  check(String(lineasDe()[0]?.origen || '').toLowerCase() === G1, 'la linea guarda su origen');

  const e2 = enviar(pl, [[1, latte, 1, null, G1]], [[1, avena, 1]]);
  check(e2[0]?.[0]?.lineas === 0 && e2[0]?.[0]?.repetidas === 1, 'reenviar la MISMA linea no la duplica',
    `lineas ${e2[0]?.[0]?.lineas}, repetidas ${e2[0]?.[0]?.repetidas}`);
  check(e2[0]?.[0]?.orden_id == null && (e2[1] || []).length === 0, 'ni crea una orden vacia ni una comanda');
  check(lineasDe().length === 1 && comandasDe() === 1, 'la cuenta y la cocina siguen con UN latte');

  const e3 = enviar(pl, [[1, latte, 1, null, G1], [2, cro, 1, null, G2]]);
  check(e3[0]?.[0]?.lineas === 1 && e3[0]?.[0]?.repetidas === 1, 'en un envio mixto solo entra lo nuevo');
  check(lineasDe().map(l => l.nombre).join() === 'Latte,Croissant' && comandasDe() === 2,
    'el croissant va a cocina y el latte no se repite');
  check(!!falla(`INSERT INTO dbo.hosp_orden_lineas (orden_id, cuenta_id, product_id, nombre, cantidad, precio_unitario, origen)
                 SELECT TOP 1 orden_id, cuenta_id, product_id, nombre, 1, 1, origen FROM dbo.hosp_orden_lineas WHERE origen = '${G1}'`),
    'y SQL impide dos lineas con el mismo origen, aunque dos envios coincidan');

  // ================================================= ACTIVIDAD POR HORA
  seccion('8. Actividad por hora');
  /* Una semana conocida: lunes 2026-09-07 al domingo 2026-09-13. Las ventas
     de las secciones anteriores son de hoy, fuera de ese rango. */
  ejecutar(DB, `
    INSERT INTO dbo.sales (datee, useer_id, total, payment_method, paid_amount, balance) VALUES
      ('2026-09-07T08:15:00', 1, 100, 'EFECTIVO', 100, 0),
      ('2026-09-07T08:45:00', 1, 60,  'EFECTIVO', 60, 0),
      ('2026-09-07T13:05:00', 1, 200, 'TARJETA', 200, 0),
      ('2026-09-11T08:30:00', 1, 90,  'EFECTIVO', 90, 0),
      ('2026-09-11T20:59:59', 1, 300, 'EFECTIVO', 300, 0),
      ('2026-09-06T23:59:59', 1, 999, 'EFECTIVO', 999, 0),
      ('2026-09-14T00:00:00', 1, 999, 'EFECTIVO', 999, 0);
    INSERT INTO dbo.sale_refunds (sale_id, user_id, datee, payment_method, refund_total)
    SELECT id, 1, '2026-09-12T10:00:00', 'EFECTIVO', 50 FROM dbo.sales WHERE total = 300;`);
  const rep = q(`EXEC dbo.sp_report_actividad_horaria @desde = '2026-09-07', @hasta = '2026-09-13'`);
  const [res, celdas, porHora, porDia, porFecha] = rep;
  check(res[0].tickets === 5, 'cuenta solo las ventas del rango, bordes incluidos', `${res[0].tickets} tickets`);
  check(Number(res[0].ingresos) === 100 + 60 + 200 + 90 + 250, 'los ingresos son netos del reembolso',
    `${res[0].ingresos}`);
  check(res[0].dias === 7, 'la semana tiene 7 dias de calendario');
  check(porHora.length === 24, 'las 24 horas, aunque esten vacias');
  const h8 = porHora.find(h => h.hora === 8);
  check(h8.tickets === 3 && Number(h8.ingresos) === 250, 'a las 8 hubo 3 tickets por $250');
  check(porHora.find(h => h.hora === 20).tickets === 1, 'las 20:59:59 cuentan en las 20');
  const lunes = porDia.find(d => d.dia === 0), viernes = porDia.find(d => d.dia === 4);
  check(lunes.tickets === 3 && viernes.tickets === 2, 'el lunes es el dia 0 y el viernes el 4',
    `lunes ${lunes.tickets}, viernes ${viernes.tickets}`);
  check(porDia.every(d => d.dias_calendario === 1), 'cada dia aparece una vez en el calendario de la semana');
  check(celdas.find(c => c.dia === 0 && c.hora === 8)?.tickets === 2, 'la celda lunes 8:00 tiene 2');
  check(porFecha.length === 7 && porFecha.find(f => String(f.fecha).includes('2026-09-09') || f.dia === 2)?.tickets === 0,
    'por fecha salen los 7 dias, el miercoles vacio en cero');
  check(/anterior/i.test(falla(`EXEC dbo.sp_report_actividad_horaria @desde = '2026-09-10', @hasta = '2026-09-01'`) || ''),
    'un rango al reves se rechaza');
  const idioma = q(`SET LANGUAGE us_english; SET DATEFIRST 7;
     EXEC dbo.sp_report_actividad_horaria @desde = '2026-09-07', @hasta = '2026-09-13'`);
  check(idioma[3].find(d => d.dia === 0).tickets === 3,
    'el lunes sigue siendo el dia 0 aunque el servidor empiece la semana en domingo');

} catch (e) {
  fallos++;
  console.log(`\n   ERROR  ${e.message}`);
} finally {
  try { eliminar(DB); console.log(`\n${DB} eliminada.`); } catch { /* noop */ }
}

console.log(`\nRESULTADO: ${fallos ? `${fallos} FALLO(S) de ${pasos}` : `OK (${pasos} comprobaciones)`}`);
process.exit(fallos ? 1 : 0);
