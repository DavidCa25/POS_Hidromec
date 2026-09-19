/**
 * EL MODULO SERVICIOS, CONTRA SQL SERVER DE VERDAD.
 *
 *     node scripts/db/pruebas/servicios.mjs
 *
 * Restaura la plantilla oficial, aplica todas las migraciones y ejercita el
 * modulo entero: catalogo, activos del cliente, profesionales, horarios,
 * ordenes, autorizacion versionada, cobro, comisiones y agenda.
 *
 * QUE SE COMPRUEBA, Y POR QUE ESTAS COSAS
 * ---------------------------------------
 * Las decisiones que se pueden romper sin que nadie se entere:
 *
 *   - un servicio es un producto, y lo sigue siendo despues de editarlo;
 *   - el precio congelado NO se mueve cuando cambia el catalogo;
 *   - anadir una linea invalida la autorizacion del cliente;
 *   - el estado economico se deriva de la venta y no de una columna;
 *   - una linea comisiona UNA vez, aunque se reintente el cobro;
 *   - dos citas no se enciman;
 *   - el inventario no se mueve hasta que se cobra.
 *
 * Nunca toca una base existente: crea la suya y la borra al terminar.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ejecutar, ejecutarVarios, restaurar, eliminar, exigirTemporal, ZONA_COMUN } from '../lib/temporal.mjs';
import { consultarTemporal } from '../lib/temporal-consulta.mjs';

const DB = 'Wybix_TmpServicios';
let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

function conjuntos(sql) {
  const r = consultarTemporal(DB, sql);
  if (!r.ok) throw new Error(`${r.error}\n---- consulta ----\n${sql.slice(0, 400)}`);
  return r.sets ?? [];
}
function filas(sql) { return conjuntos(sql)[0] ?? []; }
function fila(sql) { return filas(sql)[0] ?? {}; }
function escalar(sql) { return Object.values(fila(sql))[0]; }

/** Ejecuta esperando que FALLE, y devuelve el mensaje. */
function debeFallar(sql) {
  const r = consultarTemporal(DB, sql);
  return r.ok ? null : String(r.error);
}

function lotesDe(ruta) {
  return readFileSync(ruta, 'utf8').replace(/\r\n/g, '\n')
    .split(/\n\s*GO\s*\n/gi).map(x => x.trim()).filter(Boolean);
}

function aplicarLotes(lotes, origen) {
  const r = ejecutarVarios(DB, lotes);
  const malo = r.map((x, i) => ({ ...x, i })).find(x => !x.ok);
  if (malo) {
    throw new Error(`${origen} · lote ${malo.i + 1}/${lotes.length}: ${malo.error}\n----\n`
      + lotes[malo.i].slice(0, 600));
  }
}

const lit = (s) => `N'${String(s).replace(/'/g, "''")}'`;

/**
 * Las fechas llegan como /Date(ms)/ desde PowerShell. Convertirlas aqui, una
 * vez, evita que cada comprobacion invente su propio formato -y que una prueba
 * pase porque comparo dos cadenas raras entre si.
 */
function fecha(v) {
  if (v == null) return null;
  const m = /^\/Date\((-?\d+)\)\/$/.exec(String(v));
  return m ? new Date(Number(m[1])) : new Date(String(v));
}
/** La hora local en HH:MM, que es como se mira un horario. */
const hhmm = (v) => {
  const d = fecha(v);
  return d ? String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') : '';
};

exigirTemporal(DB);
console.log(`Base temporal ${DB}  ·  zona comun ${ZONA_COMUN}`);

try {
  eliminar(DB);
  restaurar(DB, join(process.cwd(), 'installer', 'template.bak'));

  // =================================================================
  seccion('1. La migracion 0031 se aplica sobre una base real');

  const dir = join(process.cwd(), 'electron', 'migrations');
  const archivos = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  const todos = [];
  for (const f of archivos) for (const l of lotesDe(join(dir, f))) todos.push(l);
  aplicarLotes(todos, 'migraciones');
  check(archivos.includes('0031_servicios.sql'), 'se aplico 0031 — Servicios');

  for (const t of ['services', 'customer_assets', 'professionals', 'service_professionals',
                   'professional_schedules', 'professional_time_off', 'service_orders',
                   'service_order_lines', 'service_order_events', 'appointments',
                   'service_commissions']) {
    check(Number(escalar(`SELECT COUNT(*) FROM sys.tables WHERE name='${t}'`)) === 1,
      `existe ${t}`);
  }

  check(Number(escalar("SELECT COUNT(*) FROM sys.procedures WHERE name LIKE 'sp_service%' OR name LIKE 'sp_appointment%' OR name LIKE 'sp_professional%' OR name LIKE 'sp_set_service%' OR name LIKE 'sp_set_professional%' OR name LIKE 'sp_commissions%' OR name LIKE 'sp_customer_asset%' OR name IN ('sp_get_services','sp_get_professionals','sp_get_customer_assets','sp_get_professional_schedule')")) >= 33,
    'y sus 33 procedimientos');

  /* El modulo nace apagado: una instalacion que actualiza no puede
     despertarse con Servicios encendido sin que nadie lo pidiera. */
  check(Number(escalar("SELECT enabled FROM business_modules WHERE module_key='servicios'")) === 0,
    'el modulo queda registrado y APAGADO',
    'encenderlo es una decision del negocio, no de una migracion');

  // -------------------------------------------------- el negocio de prueba
  ejecutar(DB, `EXEC dbo.sp_setup_inicial
      @usuario = N'srv', @password = N'srv12345',
      @business_name = N'Taller de prueba', @address = N'Calle 1',
      @phone = N'0000000000', @business_profile = N'RETAIL'`);
  const userId = Number(escalar('SELECT TOP 1 id FROM users ORDER BY id'));
  check(userId > 0, 'hay negocio y usuario', `user ${userId}`);

  // =================================================================
  seccion('2. Un servicio es un producto, no un catalogo aparte');

  const srv = fila(`EXEC dbo.sp_service_save
      @nombre = N'Cambio de aceite', @price = 450.00,
      @duration_minutes = 45, @default_commission_pct = 10`);
  const servicioId = Number(srv.product_id);
  check(servicioId > 0, 'se da de alta un servicio', `product_id ${servicioId}`);
  check(String(srv.part_number).startsWith('SRV-'), 'con una clave legible', String(srv.part_number));
  check(Number(escalar(`SELECT COUNT(*) FROM products WHERE id=${servicioId}`)) === 1,
    'y vive en products, con todo lo que eso trae',
    'impuestos, clave del SAT, reportes y la venta, sin duplicar nada');
  check(String(escalar(`SELECT inventory_mode FROM products WHERE id=${servicioId}`)) === 'NONE',
    'sin existencias: cobrar una hora de trabajo no resta piezas');

  /* El caso del taller que llevaba anos cobrando "Mano de obra" como producto
     y ahora quiere agendarla y comisionarla. */
  ejecutar(DB, `INSERT INTO products (part_number, nombre, price, stock, active, cost, inventory_mode, sellable, base_uom)
                VALUES (N'MO-001', N'Mano de obra', 300, 0, 1, 0, 'DIRECT', 1, 'pza')`);
  const viejoId = Number(escalar("SELECT id FROM products WHERE part_number='MO-001'"));
  ejecutar(DB, `EXEC dbo.sp_service_save @product_id = ${viejoId},
      @nombre = N'Mano de obra', @price = 300, @duration_minutes = 60`);
  check(Number(escalar(`SELECT COUNT(*) FROM services WHERE product_id=${viejoId}`)) === 1,
    'un producto que ya existia se convierte en servicio');
  check(String(escalar(`SELECT inventory_mode FROM products WHERE id=${viejoId}`)) === 'NONE',
    'y deja de descontar inventario',
    'cobrar mano de obra no puede restar piezas de un almacen');
  check(Number(escalar(`SELECT id FROM products WHERE part_number='MO-001'`)) === viejoId,
    'conservando su identidad y su historial de ventas');

  // ------------------------------------------------------- una refaccion
  ejecutar(DB, `INSERT INTO products (part_number, nombre, price, stock, active, cost, inventory_mode, sellable, base_uom)
                VALUES (N'ACE-5W30', N'Aceite 5W30 1L', 180, 100, 1, 90, 'DIRECT', 1, 'pza')`);
  const aceiteId = Number(escalar("SELECT id FROM products WHERE part_number='ACE-5W30'"));
  check(aceiteId > 0, 'y hay una refaccion de verdad para el resto de la prueba');

  // =================================================================
  seccion('3. Profesionales: un dato del negocio, no un permiso');

  const prof = fila(`EXEC dbo.sp_professional_save
      @full_name = N'Luis Mecanico', @title = N'Mecanico',
      @default_commission_pct = 15, @user_id = ${userId}`);
  const profId = Number(prof.id);
  check(profId > 0, 'se da de alta un profesional');
  check(Number(prof.user_id) === userId, 'enlazado con un usuario');

  const dup = debeFallar(`EXEC dbo.sp_professional_save
      @full_name = N'Otro', @user_id = ${userId}`);
  check(!!dup && /enlazado/i.test(dup),
    'y ese usuario no puede enlazarse con un segundo profesional',
    'sus comisiones se repartirian entre dos filas y ninguna seria la suya');

  const prof2 = fila(`EXEC dbo.sp_professional_save @full_name = N'Ana Tecnica', @default_commission_pct = 20`);
  const prof2Id = Number(prof2.id);
  check(prof2Id > 0 && prof2.user_id === null, 'y hay profesionales sin usuario',
    'el mecanico que no toca la caja no necesita credenciales');

  // ------------------------------------------------ quien hace que
  ejecutar(DB, `EXEC dbo.sp_set_service_professionals
      @service_product_id = ${servicioId},
      @asignaciones_json = N'[{"professionalId":${profId},"commissionPct":12}]'`);
  check(Number(escalar(`SELECT COUNT(*) FROM service_professionals WHERE service_product_id=${servicioId}`)) === 1,
    'se asigna quien puede hacer un servicio');

  const noAsignado = debeFallar(`EXEC dbo.sp_service_order_add_line
      @order_id = 1, @product_id = ${servicioId}, @professional_id = ${prof2Id}`);
  check(!!noAsignado, 'y quien no lo tiene asignado no puede quedarse con la linea');

  ejecutar(DB, `EXEC dbo.sp_set_service_professionals
      @service_product_id = ${servicioId}, @asignaciones_json = N'[]'`);
  check(Number(escalar(`SELECT COUNT(*) FROM service_professionals WHERE service_product_id=${servicioId}`)) === 0,
    'una lista vacia significa "lo hace cualquiera", no un error');
  ejecutar(DB, `EXEC dbo.sp_set_service_professionals
      @service_product_id = ${servicioId},
      @asignaciones_json = N'[{"professionalId":${profId},"commissionPct":12},{"professionalId":${prof2Id}}]'`);

  // =================================================================
  seccion('4. El activo del cliente: uno solo y generico');

  ejecutar(DB, `INSERT INTO customers (customerName, phone) VALUES (N'Cliente Uno', N'3330001111')`);
  const cliId = Number(escalar("SELECT id FROM customers WHERE customerName='Cliente Uno'"));

  const activo = fila(`EXEC dbo.sp_customer_asset_save
      @customer_id = ${cliId}, @kind = N'VEHICULO', @label = N'Jetta 2018 gris',
      @identifier = N'ABC-123-D', @brand = N'VW', @model = N'Jetta', @year_or_age = N'2018'`);
  const activoId = Number(activo.id);
  check(activoId > 0, 'se registra el coche de un cliente');

  const porPlaca = filas(`EXEC dbo.sp_get_customer_assets @busqueda = N'ABC-123'`);
  check(porPlaca.length === 1 && String(porPlaca[0].customer_name) === 'Cliente Uno',
    'y se encuentra por la placa, con el nombre de su dueno',
    'en un taller llega el coche, no llega el nombre');

  ejecutar(DB, `INSERT INTO customers (customerName) VALUES (N'Cliente Dos')`);
  const cli2 = Number(escalar("SELECT id FROM customers WHERE customerName='Cliente Dos'"));
  const ajeno = debeFallar(`EXEC dbo.sp_service_order_create
      @customer_id = ${cli2}, @customer_asset_id = ${activoId}`);
  check(!!ajeno && /no es de este cliente/i.test(ajeno),
    'el coche de alguien no puede acabar en el expediente de otro');

  // =================================================================
  seccion('5. La orden: abrir con lo minimo');

  const orden = fila(`EXEC dbo.sp_service_order_create
      @customer_id = ${cliId}, @customer_asset_id = ${activoId},
      @reported_issue = N'Hace un ruido al frenar', @user_id = ${userId}`);
  const ordenId = Number(orden.id);
  check(ordenId > 0, 'se abre una orden sin cotizar nada todavia',
    'cuando el coche entra nadie sabe aun que hay que hacerle');
  check(String(orden.folio).startsWith('OS-'), 'con folio legible', String(orden.folio));
  check(String(orden.status) === 'ABIERTA', 'y nace ABIERTA, no BORRADOR',
    'el coche ya esta dentro: eso no es un borrador');
  check(Number(orden.total) === 0, 'sin importe');
  check(String(orden.economic_status) === 'SIN_COBRAR', 'y sin cobrar');
  check(Number(orden.needs_reauthorization) === 1, 'nada autorizado todavia');

  // =================================================================
  seccion('6. Las lineas congelan lo que se cobra');

  const conLinea = conjuntos(`EXEC dbo.sp_service_order_add_line
      @order_id = ${ordenId}, @product_id = ${servicioId},
      @quantity = 1, @professional_id = ${profId}, @user_id = ${userId}`);
  const cab1 = conLinea[0][0];
  check(Number(cab1.total) === 450, 'anadir el servicio suma su precio', String(cab1.total));
  check(Number(cab1.quote_version) === 2, 'y sube la version del presupuesto');

  const lineas1 = conLinea[1];
  check(lineas1.length === 1 && String(lineas1[0].line_kind) === 'SERVICIO',
    'la linea se clasifica sola como SERVICIO',
    'se deduce del producto: no hay nada que elegir mal');
  check(Number(lineas1[0].commission_pct_snapshot) === 12,
    'con la comision pactada para esa persona en ese servicio',
    'de lo mas concreto a lo mas general');

  ejecutar(DB, `EXEC dbo.sp_service_order_add_line
      @order_id = ${ordenId}, @product_id = ${aceiteId},
      @quantity = 4, @user_id = ${userId}`);
  const cab2 = fila(`EXEC dbo.sp_service_order_get @id = ${ordenId}`);
  check(Number(cab2.total) === 450 + 720, 'servicios y refacciones en la misma lista',
    `total ${cab2.total}`);
  check(Number(cab2.total_servicios) === 450 && Number(cab2.total_productos) === 720,
    'separados para poder mirarlos, no para cobrarlos aparte');

  /* El inventario NO se toca al anadir: eso pasa al cobrar. */
  check(Number(escalar(`SELECT stock FROM products WHERE id=${aceiteId}`)) === 100,
    'anadir una refaccion NO la saca del almacen',
    'una orden abierta tres dias dejaria el inventario mintiendo');

  // --------------------------------------------- el precio no se mueve
  ejecutar(DB, `UPDATE products SET price = 999 WHERE id = ${servicioId}`);
  const trasSubida = conjuntos(`EXEC dbo.sp_service_order_get @id = ${ordenId}`);
  const lineaSrv = trasSubida[1].find(l => Number(l.product_id) === servicioId);
  check(Number(lineaSrv.unit_price_snapshot) === 450,
    'subir el precio del catalogo NO reescribe lo cotizado',
    'el presupuesto que el cliente vio ayer sigue costando lo de ayer');
  check(Number(lineaSrv.current_price) === 999,
    'y la pantalla puede avisar de que cambio');
  ejecutar(DB, `UPDATE products SET price = 450 WHERE id = ${servicioId}`);

  // =================================================================
  seccion('7. La autorizacion es de una version, no de "la orden"');

  ejecutar(DB, `EXEC dbo.sp_service_order_authorize
      @id = ${ordenId}, @by_name = N'Cliente Uno', @channel = N'TELEFONO', @user_id = ${userId}`);
  const autorizada = fila(`EXEC dbo.sp_service_order_get @id = ${ordenId}`);
  check(Number(autorizada.needs_reauthorization) === 0, 'el cliente autoriza y queda autorizado');
  check(Number(autorizada.authorized_version) === Number(autorizada.quote_version),
    'con la version exacta que aprobo');

  const repetida = debeFallar(`EXEC dbo.sp_service_order_authorize
      @id = ${ordenId}, @by_name = N'Cliente Uno'`);
  check(!!repetida && /ya estaba autorizado/i.test(repetida),
    'autorizar dos veces lo mismo no es un hecho nuevo');

  ejecutar(DB, `EXEC dbo.sp_service_order_add_line
      @order_id = ${ordenId}, @product_id = ${viejoId}, @quantity = 2,
      @professional_id = ${prof2Id}, @user_id = ${userId}`);
  const tras = fila(`EXEC dbo.sp_service_order_get @id = ${ordenId}`);
  check(Number(tras.needs_reauthorization) === 1,
    'anadir trabajo invalida lo que el cliente habia aprobado',
    'lo que autorizo ya no es lo que se le va a cobrar');

  /* Poner una linea en marcha NO mueve el dinero, asi que no invalida nada. */
  ejecutar(DB, `EXEC dbo.sp_service_order_authorize @id = ${ordenId}, @by_name = N'Cliente Uno'`);
  const lineaId = Number(filas(`SELECT TOP 1 id FROM service_order_lines WHERE order_id=${ordenId} ORDER BY id`)[0].id);
  ejecutar(DB, `EXEC dbo.sp_service_order_update_line @line_id = ${lineaId}, @status = N'EN_PROCESO', @user_id = ${userId}`);
  check(Number(fila(`EXEC dbo.sp_service_order_get @id = ${ordenId}`).needs_reauthorization) === 0,
    'empezar a trabajar no invalida la autorizacion',
    'un aviso que aparece siempre no se lee');

  // =================================================================
  seccion('8. Concurrencia: dos personas en la misma orden');

  const rowver = fila(`EXEC dbo.sp_service_order_get @id = ${ordenId}`).rowver;
  check(!!rowver, 'la orden lleva testigo de version');
  const viejo = '0x0000000000000001';
  const conflicto = debeFallar(`EXEC dbo.sp_service_order_update
      @id = ${ordenId}, @diagnosis = N'Balatas gastadas', @rowver = ${viejo}`);
  check(!!conflicto && /CONFLICTO_DE_VERSION/.test(conflicto),
    'guardar con un testigo viejo no pisa lo que escribio el otro',
    'sin esto, el diagnostico del taller desaparecia sin que nadie se enterara');

  ejecutar(DB, `EXEC dbo.sp_service_order_update
      @id = ${ordenId}, @diagnosis = N'Balatas gastadas', @user_id = ${userId}`);
  check(String(fila(`EXEC dbo.sp_service_order_get @id = ${ordenId}`).diagnosis) === 'Balatas gastadas',
    'y con el testigo bueno, si guarda');
  check(Number(escalar(`SELECT COUNT(*) FROM service_order_events WHERE order_id=${ordenId} AND event_type='DIAGNOSTICO'`)) === 1,
    'el diagnostico deja su propio evento en el historial');

  // =================================================================
  seccion('9. Cobrar: la venta de siempre, y despues el enlace');

  const previa = fila(`EXEC dbo.sp_service_order_charge_preview @order_id = ${ordenId}`);
  check(Number(previa.can_charge) === 1, 'la orden se puede cobrar');
  const partidas = conjuntos(`EXEC dbo.sp_service_order_charge_preview @order_id = ${ordenId}`)[1];
  check(partidas.length === 3, 'con sus tres partidas listas para la venta');
  check(Number(partidas.find(p => Number(p.product_id) === servicioId).unit_price) === 450,
    'al precio congelado, no al de hoy');

  /* La venta, por el camino de siempre. Necesita turno abierto, que es
     exactamente lo que se quiere que siga exigiendo. */
  const sinTurno = debeFallar(`DECLARE @d dbo.SaleDetailType2;
      INSERT INTO @d (line_no, product_id, quantity, unit_price)
      SELECT ROW_NUMBER() OVER (ORDER BY id), product_id, quantity, unit_price_snapshot
        FROM service_order_lines WHERE order_id=${ordenId} AND status<>'CANCELADA';
      DECLARE @v dbo.SaleDetailType; DECLARE @m dbo.SaleModifierType;
      EXEC dbo.sp_register_sale @user_id=${userId}, @payment_method=N'EFECTIVO',
           @SaleDetails=@v, @SaleDetails2=@d, @SaleModifiers=@m;`);
  check(!!sinTurno && /turno/i.test(sinTurno),
    'cobrar una orden sigue exigiendo turno abierto',
    'el modulo no estrena una segunda forma de vender');

  ejecutar(DB, `EXEC dbo.sp_open_shift @user_id = ${userId}, @opening_cash = 1000`);
  const venta = fila(`DECLARE @d dbo.SaleDetailType2;
      INSERT INTO @d (line_no, product_id, quantity, unit_price)
      SELECT ROW_NUMBER() OVER (ORDER BY id), product_id, quantity, unit_price_snapshot
        FROM service_order_lines WHERE order_id=${ordenId} AND status<>'CANCELADA';
      DECLARE @v dbo.SaleDetailType; DECLARE @m dbo.SaleModifierType;
      EXEC dbo.sp_register_sale @user_id=${userId}, @payment_method=N'EFECTIVO',
           @SaleDetails=@v, @SaleDetails2=@d, @SaleModifiers=@m,
           @customer_id=${cliId};`);
  const ventaId = Number(venta.sale_id);
  check(ventaId > 0, 'la venta se registra por el camino de siempre', `venta ${ventaId}`);
  check(Number(escalar(`SELECT stock FROM products WHERE id=${aceiteId}`)) === 96,
    'y AHORA si se mueve el inventario: cuatro litros menos',
    'el inventario se toca al cobrar, no al cotizar');

  const enlazada = fila(`EXEC dbo.sp_service_order_link_sale
      @order_id = ${ordenId}, @sale_id = ${ventaId}, @user_id = ${userId}`);
  check(Number(enlazada.sale_id) === ventaId, 'la orden queda atada a su venta');
  check(String(enlazada.status) === 'TERMINADA', 'y pasa a TERMINADA');
  check(String(enlazada.economic_status) === 'PAGADA',
    'el estado economico sale de la venta, no de una columna',
    'un abono en otra caja no puede dejarlo mintiendo');

  // =================================================================
  seccion('10. Las comisiones se devengan una vez');

  const comisiones = Number(escalar(`SELECT COUNT(*) FROM service_commissions WHERE order_id=${ordenId}`));
  check(comisiones === 2, 'comisionan las lineas con persona y porcentaje', `${comisiones} de 3 lineas`);
  check(Number(escalar(`SELECT amount FROM service_commissions c JOIN service_order_lines l ON l.id=c.order_line_id WHERE l.product_id=${servicioId}`)) === 54,
    'el 12% de 450 son 54');

  ejecutar(DB, `EXEC dbo.sp_service_order_link_sale @order_id = ${ordenId}, @sale_id = ${ventaId}`);
  check(Number(escalar(`SELECT COUNT(*) FROM service_commissions WHERE order_id=${ordenId}`)) === 2,
    'reintentar el enlace NO duplica lo que alguien gano',
    'entre la venta y el enlace puede caerse la red');

  /* Una segunda venta de verdad: con el mismo id no habria nada que rechazar. */
  const venta2 = fila(`DECLARE @d dbo.SaleDetailType2;
      INSERT INTO @d (line_no, product_id, quantity, unit_price) VALUES (1, ${aceiteId}, 1, 180);
      DECLARE @v dbo.SaleDetailType; DECLARE @m dbo.SaleModifierType;
      EXEC dbo.sp_register_sale @user_id=${userId}, @payment_method=N'EFECTIVO',
           @SaleDetails=@v, @SaleDetails2=@d, @SaleModifiers=@m;`);
  const otraVenta = debeFallar(`EXEC dbo.sp_service_order_link_sale @order_id = ${ordenId}, @sale_id = ${Number(venta2.sale_id)}`);
  check(!!otraVenta && /ya estaba cobrada/i.test(otraVenta),
    'y enlazarla con OTRA venta se rechaza',
    'significaria que se cobro dos veces');

  const cerrada = debeFallar(`EXEC dbo.sp_service_order_add_line
      @order_id = ${ordenId}, @product_id = ${aceiteId}, @quantity = 1`);
  check(!!cerrada && /ya se cobro/i.test(cerrada),
    'una orden cobrada no admite lineas nuevas');

  const reporte = filas(`EXEC dbo.sp_commissions_report
      @desde = '2000-01-01', @hasta = '2100-01-01'`);
  check(reporte.length === 2, 'el reporte reparte por persona', `${reporte.length} personas`);
  check(reporte.reduce((s, r) => s + Number(r.comision), 0) === 54 + 120,
    'y suma lo que de verdad se devengo');

  // =================================================================
  seccion('11. Entregar exige haber cobrado');

  ejecutar(DB, `EXEC dbo.sp_service_order_set_status @id = ${ordenId}, @status = N'ENTREGADA', @user_id = ${userId}`);
  check(String(fila(`EXEC dbo.sp_service_order_get @id = ${ordenId}`).status) === 'ENTREGADA',
    'cobrada y terminada, se entrega');

  const orden2 = fila(`EXEC dbo.sp_service_order_create @customer_id = ${cliId}, @user_id = ${userId}`);
  const orden2Id = Number(orden2.id);
  ejecutar(DB, `EXEC dbo.sp_service_order_add_line @order_id = ${orden2Id}, @product_id = ${servicioId}, @quantity = 1`);
  ejecutar(DB, `UPDATE service_order_lines SET status='HECHA' WHERE order_id=${orden2Id}`);
  const sinCobrar = debeFallar(`EXEC dbo.sp_service_order_set_status @id = ${orden2Id}, @status = N'ENTREGADA'`);
  check(!!sinCobrar && /[Cc]obra/.test(sinCobrar),
    'entregar sin cobrar deja el trabajo fuera y el dinero dentro');

  const vacia = fila(`EXEC dbo.sp_service_order_create @customer_id = ${cliId}`);
  const sinHecho = debeFallar(`EXEC dbo.sp_service_order_set_status @id = ${Number(vacia.id)}, @status = N'TERMINADA'`);
  check(!!sinHecho && /hecha/i.test(sinHecho),
    'y una orden sin una sola linea hecha no esta terminada: esta vacia');

  // =================================================================
  seccion('12. Cancelar pide motivo y no toca lo cobrado');

  const sinMotivo = debeFallar(`EXEC dbo.sp_service_order_cancel @id = ${orden2Id}, @reason = N''`);
  check(!!sinMotivo && /por que/i.test(sinMotivo), 'cancelar sin motivo se rechaza',
    'dentro de seis meses nadie sabria si fue el cliente, la refaccion o un error');

  ejecutar(DB, `EXEC dbo.sp_service_order_cancel @id = ${orden2Id}, @reason = N'El cliente se arrepintio', @user_id = ${userId}`);
  const cancelada = fila(`EXEC dbo.sp_service_order_get @id = ${orden2Id}`);
  check(String(cancelada.status) === 'CANCELADA', 'con motivo, se cancela');
  check(Number(escalar(`SELECT COUNT(*) FROM service_order_lines WHERE order_id=${orden2Id} AND status='PENDIENTE'`)) === 0,
    'y sus lineas pendientes se cancelan con ella',
    'dejarlas contaria como trabajo por hacer en la carga de cada persona');
  check(Number(escalar(`SELECT COUNT(*) FROM service_order_lines WHERE order_id=${orden2Id} AND status='HECHA'`)) === 1,
    'pero lo que YA se hizo se conserva',
    'el trabajo existio aunque la orden se cancelara despues');

  const yaCobrada = debeFallar(`EXEC dbo.sp_service_order_cancel @id = ${ordenId}, @reason = N'x'`);
  check(!!yaCobrada && /devolucion/i.test(yaCobrada),
    'lo ya cobrado no se cancela: se devuelve');

  // =================================================================
  seccion('13. La agenda: no se prometen dos cosas a la vez');

  ejecutar(DB, `EXEC dbo.sp_set_professional_schedule
      @professional_id = ${profId},
      @franjas_json = N'[{"weekday":2,"startsAt":"09:00","endsAt":"14:00"},{"weekday":2,"startsAt":"16:00","endsAt":"19:00"}]'`);
  check(Number(escalar(`SELECT COUNT(*) FROM professional_schedules WHERE professional_id=${profId}`)) === 2,
    'un dia puede tener dos franjas, con la comida en medio');

  const encimadas = debeFallar(`EXEC dbo.sp_set_professional_schedule
      @professional_id = ${profId},
      @franjas_json = N'[{"weekday":2,"startsAt":"09:00","endsAt":"14:00"},{"weekday":2,"startsAt":"13:00","endsAt":"19:00"}]'`);
  check(!!encimadas && /encim/i.test(encimadas), 'pero no dos que se pisen');

  const cita = fila(`EXEC dbo.sp_appointment_save
      @customer_id = ${cliId}, @customer_asset_id = ${activoId},
      @professional_id = ${profId}, @service_product_id = ${servicioId},
      @starts_at = '2026-10-05T10:00:00', @user_id = ${userId}`);
  const citaId = Number(cita.id);
  check(citaId > 0, 'se agenda una cita');
  check(hhmm(cita.ends_at) === '10:45', 'y su fin sale de la duracion del servicio',
    hhmm(cita.starts_at) + ' -> ' + hhmm(cita.ends_at));

  const choque = debeFallar(`EXEC dbo.sp_appointment_save
      @customer_id = ${cli2}, @professional_id = ${profId},
      @service_product_id = ${servicioId}, @starts_at = '2026-10-05T10:30:00'`);
  /* El procedimiento ya no devuelve una frase: devuelve los HECHOS -quien y
     de cuando a cuando- para que la pantalla pueda decirlo en castellano en
     vez de ensenar una marca de tiempo de base de datos. Se comprueba que el
     choque se impida Y que traiga con que explicarlo. */
  /* El codigo viene ENVUELTO: PowerShell adorna la excepcion de SQL con su
     propia traza, asi que anclar al principio de la cadena fallaba aunque el
     procedimiento devolviera justo lo que debia. Se busca el codigo donde
     este, que es lo que hace la pantalla tambien. */
  const codigo = /CITA_ENCIMADA\|([^|]*)\|(\d{2}:\d{2})\|(\d{2}:\d{2})/.exec(String(choque || ''));
  check(!!codigo, 'dos citas encimadas se impiden: alguien iba a esperar',
    String(choque || '').slice(0, 90));
  check(!!codigo && !!codigo[1],
    'y dice de quien es la cita que estorba y su horario',
    codigo ? `${codigo[1]} ${codigo[2]}-${codigo[3]}` : '');

  const forzada = fila(`EXEC dbo.sp_appointment_save
      @customer_id = ${cli2}, @professional_id = ${profId},
      @service_product_id = ${servicioId}, @starts_at = '2026-10-05T10:30:00',
      @permitir_encimar = 1`);
  check(Number(forzada.id) > 0 && /Encimada/.test(String(forzada.notes)),
    'forzarlo se puede, y queda dicho',
    'hay negocios que sobreagendan a proposito; lo que no puede es pasar en silencio');
  ejecutar(DB, `EXEC dbo.sp_appointment_set_status @id = ${Number(forzada.id)}, @status = N'CANCELADA'`);

  // ------------------------------------------------------ reprogramar
  const nueva = fila(`EXEC dbo.sp_appointment_reschedule
      @id = ${citaId}, @starts_at = '2026-10-06T11:00:00',
      @reason = N'El cliente no puede el lunes', @user_id = ${userId}`);
  check(Number(nueva.rescheduled_from_id) === citaId,
    'reprogramar crea una cita nueva enlazada con la anterior',
    'tres reprogramaciones son tres filas y se ven');
  check(String(escalar(`SELECT status FROM appointments WHERE id=${citaId}`)) === 'CANCELADA',
    'y la original queda cancelada, no reescrita');

  // -------------------------------------------------- de cita a trabajo
  const desdeCita = fila(`EXEC dbo.sp_appointment_to_order
      @appointment_id = ${Number(nueva.id)}, @user_id = ${userId}`);
  const ordenCitaId = Number(desdeCita.id);
  check(ordenCitaId > 0, 'el cliente llega y la cita se convierte en orden');
  check(String(escalar(`SELECT status FROM appointments WHERE id=${Number(nueva.id)}`)) === 'ATENDIDA',
    'la cita queda atendida en el mismo movimiento',
    'si fueran dos llamadas, la mitad de las veces quedaria AGENDADA');
  check(Number(desdeCita.total) === 450,
    'y la orden nace con la linea del servicio acordado',
    `total ${desdeCita.total}`);

  const otraVez = fila(`EXEC dbo.sp_appointment_to_order @appointment_id = ${Number(nueva.id)}`);
  check(Number(otraVez.id) === ordenCitaId,
    'dos clics en "el cliente llego" no abren dos ordenes');

  // ---------------------------------------------------- disponibilidad
  const huecos = filas(`EXEC dbo.sp_professional_availability
      @fecha = '2026-10-12', @professional_id = ${profId}, @service_product_id = ${servicioId}`);
  check(huecos.length > 0, 'la disponibilidad devuelve huecos del tamano del servicio',
    `${huecos.length} huecos`);
  const fuera = huecos.filter(h => {
    const desde = hhmm(h.starts_at), hasta = hhmm(h.ends_at);
    return desde < '09:00' || hasta > '19:00' || (desde < '16:00' && hasta > '14:00');
  });
  check(fuera.length === 0, 'y ninguno cae fuera del horario declarado ni en la comida',
    fuera.slice(0, 3).map(h => hhmm(h.starts_at) + '-' + hhmm(h.ends_at)).join(' '));

  // =================================================================
  seccion('14. Nada de lo anterior se rompio');

  check(Number(escalar("SELECT COUNT(*) FROM sys.procedures WHERE name='sp_register_sale'")) === 1,
    'sp_register_sale sigue existiendo y sin tocar');
  check(Number(escalar('SELECT COUNT(*) FROM sales')) >= 1, 'y las ventas siguen registrandose');
  check(Number(escalar("SELECT COUNT(*) FROM sys.tables")) >= 66,
    'el esquema crecio sin perder nada', String(escalar('SELECT COUNT(*) FROM sys.tables')));

} finally {
  try { eliminar(DB); console.log(`\n${DB} eliminada.`); } catch { /* noop */ }
}

console.log(`\nRESULTADO: ${fallos ? `${fallos} FALLO(S) de ${pasos}` : `OK (${pasos} comprobaciones)`}`);
process.exit(fallos ? 1 : 0);
