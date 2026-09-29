/**
 * PANTALLAS OPERATIVAS SOBRE WYBIX LOCAL HOST, CONTRA UNA BASE DE VERDAD.
 *
 *     npm run test:pantallas
 *
 * Una base temporal con Hospitality + Mesas + Comandas + Servicios, personas
 * reales (usuarios y profesionales), citas, ordenes, productos y existencias,
 * sembrados con los procedimientos de siempre. Un Local Host real. Las tablets
 * son peticiones HTTP con cookies (como un navegador) y, para lo visual y la
 * cola sin conexion, un Chromium real.
 *
 * Numeracion por bloque: C (nucleo), P (preparacion con mesero), W (mesero),
 * S (mi jornada), T (tecnico), I (inventario), K (estado de pedidos),
 * O (sin conexion), X (seguridad), N (Internet / LAN), U (pantalla).
 */
import { createRequire } from 'node:module';
import {
  sql, dormir, crearMarcador, nacerBase, borrarBase, abrirPool, crearTablet, pedirCrudo,
  puertoAbierto, crearHost, emparejar,
} from './lib/arnes-local-host.mjs';
import { ejecutar } from '../db/lib/temporal.mjs';

const require = createRequire(import.meta.url);
const red = require('../../electron/local-host/red.js');
const { hash } = require('../../electron/local-host/credenciales.js');

const DB = 'Wybix_TmpPantallas';
const PUERTO = Number(process.env.WYBIX_PRUEBA_PUERTO) || 17527;
const CAPTURAS = process.env.WYBIX_CAPTURAS || null;
const { check, salto, seccion, resumen } = crearMarcador();

console.log(`\nPANTALLAS OPERATIVAS · base ${DB} · puerto ${PUERTO}\n`);

let pool, host, navegador;
try {
  // ================================================================ SIEMBRA
  nacerBase(DB, { perfil: 'HOSPITALITY' });
  for (const m of ['hospitality', 'mesas', 'comandas']) ejecutar(DB, `EXEC dbo.sp_set_business_module @module_key = N'${m}', @enabled = 1`);
  /* Mantenimiento: agenda Y ordenes -> Mi jornada y Tecnico a la vez. */
  ejecutar(DB, `EXEC dbo.sp_set_services_preset @preset = N'MANTENIMIENTO'`);
  pool = await abrirPool(DB);
  const q = async (t) => (await pool.request().query(t)).recordsets;
  const uno = async (t) => (await q(t))[0]?.[0] ?? {};

  /* Personas. El login de Wybix usa SHA2_256; aqui solo importa la identidad. */
  const usuario = async (u, rol) => (await uno(`
    INSERT INTO dbo.users (usuario, password_hash, rol, active, creation_date)
    OUTPUT inserted.id VALUES (N'${u}', CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256', N'x${u}1234'), 2), N'${rol}', 1, GETDATE());`)).id;
  const dueno = (await uno(`SELECT TOP 1 id FROM dbo.users ORDER BY id`)).id;
  const carlos = await usuario('carlos', 'cajero');      // mesero
  const luis = await usuario('luis', 'cajero');          // piso, sin permiso de inventario
  const marta = await usuario('marta', 'supervisor');    // encargada: inventario
  const cteUser = await usuario('ctecnico', 'cajero');   // tecnico con usuario
  const prof = async (nombre, userId = null) => (await q(`EXEC dbo.sp_professional_save @full_name = N'${nombre}', @user_id = ${userId ?? 'NULL'}`))[0][0].id;
  const sofia = await prof('Sofía Ramírez');
  const ana = await prof('Ana Torres');
  const cte = await prof('Carlos Técnico', cteUser);
  const pedro = await prof('Pedro Mecánico');
  /* Clientes con TODO lo privado lleno: el tablero publico no debe soltar nada. */
  const clienteDe = async (nombre, correo, tel, rfc) => (await uno(`
    DECLARE @id INT; EXEC dbo.sp_create_customer @customerName = N'${nombre}', @email = N'${correo}', @phone = N'${tel}',
      @tax_id = N'${rfc}', @street = N'Calle Secreta 123', @NewId = @id OUTPUT; SELECT @id AS id;`)).id;
  const davidC = await clienteDe('David Casillas', 'david@correo.mx', '5512345678', 'CAKD800101AB1');
  const maria = await clienteDe('María López', 'maria@correo.mx', '5587654321', 'LOMA900202CD2');

  /* Catalogo. */
  await q(`INSERT INTO dbo.CAT_categories (namee) VALUES (N'Bebidas'); INSERT INTO dbo.CAT_brands (namee) VALUES (N'General');`);
  const cat = (await uno(`SELECT TOP 1 id FROM dbo.CAT_categories ORDER BY id DESC`)).id;
  const marca = (await uno(`SELECT TOP 1 id FROM dbo.CAT_brands ORDER BY id DESC`)).id;
  const alta = async (pn, n, pr, modo, stock = 0, codigo = null) => {
    await q(`EXEC dbo.sp_add_product @brand = ${marca}, @category = ${cat}, @part_number = N'${pn}', @name = N'${n}',
             @price = ${pr}, @stock = ${stock}, @inventory_mode = '${modo}', @sellable = 1`);
    const id = (await uno(`SELECT id FROM dbo.products WHERE part_number = N'${pn}'`)).id;
    if (codigo) await q(`UPDATE dbo.products SET bar_code = N'${codigo}' WHERE id = ${id}`);
    return id;
  };
  const latte = await alta('LAT', 'Latte', 52, 'NONE');
  const sandwich = await alta('SAN', 'Sandwich', 85, 'NONE');
  const coca = await alta('COC600', 'Coca-Cola 600 ml', 22, 'DIRECT', 14, '7501055300075');
  const gel = await alta('GEL-R', 'Gel rojo', 30, 'DIRECT', 40);
  const aceite = await alta('ACE-5W30', 'Aceite 5W30 1L', 180, 'DIRECT', 25);
  const corte = (await q(`EXEC dbo.sp_service_save @nombre = N'Corte', @price = 200, @duration_minutes = 60`))[0][0].product_id
    ?? (await uno(`SELECT TOP 1 product_id FROM dbo.services ORDER BY product_id DESC`)).product_id;
  await q(`EXEC dbo.sp_service_save @nombre = N'Cambio de aceite', @price = 350, @duration_minutes = 60`);
  const servAceite = (await uno(`SELECT p.id FROM dbo.products p JOIN dbo.services s ON s.product_id = p.id WHERE p.nombre = N'Cambio de aceite'`)).id;

  /* Modificadores: la leche del Latte es obligatoria. */
  await q(`INSERT INTO dbo.modifier_groups (name, role, min_select, max_select, required, active, sort_order) VALUES (N'Leche', 'SUBSTITUTION', 1, 1, 1, 1, 1);`);
  const gLeche = (await uno(`SELECT id FROM dbo.modifier_groups WHERE name = N'Leche'`)).id;
  await q(`INSERT INTO dbo.modifier_options (group_id, name, price_delta, effect, active, sort_order) VALUES (${gLeche}, N'Entera', 0, 'NONE', 1, 1), (${gLeche}, N'Avena', 8, 'NONE', 1, 2);
           INSERT INTO dbo.product_modifier_groups (product_id, group_id, sort_order) VALUES (${latte}, ${gLeche}, 1);`);
  const avena = (await uno(`SELECT id FROM dbo.modifier_options WHERE name = N'Avena'`)).id;

  /* Estaciones y salon. */
  const barra = (await uno(`EXEC dbo.sp_prep_station_save @nombre = N'Barra', @salida = 'PANTALLA'`)).id;
  const cocina = (await uno(`EXEC dbo.sp_prep_station_save @nombre = N'Cocina', @salida = 'PANTALLA'`)).id;
  await q(`EXEC dbo.sp_product_prep_set @product_id = ${latte}, @station_id = ${barra}`);
  await q(`EXEC dbo.sp_product_prep_set @product_id = ${sandwich}, @station_id = ${cocina}`);
  const salon = (await uno(`EXEC dbo.sp_salon_area_save @nombre = N'Salón', @orden = 1`)).id;
  const terraza = (await uno(`EXEC dbo.sp_salon_area_save @nombre = N'Terraza', @orden = 2`)).id;
  const mesa = async (a, n) => (await uno(`EXEC dbo.sp_salon_mesa_save @area_id = ${a}, @nombre = N'${n}'`)).id;
  const m1 = await mesa(salon, '1'), m2 = await mesa(salon, '2');
  const t1 = await mesa(terraza, 'T1');
  void m2;

  /* Clientes, un vehiculo, citas de hoy y ordenes de taller. */
  const cliente = async (n, tel) => (await q(`DECLARE @id INT; EXEC dbo.sp_create_customer @customerName = N'${n}', @phone = N'${tel}', @email = N'${n.split(' ')[0].toLowerCase()}@correo.mx', @NewId = @id OUTPUT; SELECT @id AS id;`))[0][0].id;
  const andrea = await cliente('Andrea López', '3312345678');
  const mariana = await cliente('Mariana Díaz', '3398765432');
  const david = await cliente('David Demo', '3300001111');
  const vehiculo = (await q(`EXEC dbo.sp_customer_asset_save @customer_id = ${david}, @kind = 'VEHICULO', @label = N'Mazda 3', @identifier = N'ABC-123', @brand = N'Mazda', @model = N'3', @year_or_age = N'2019', @color = N'Gris'`))[0][0].id;
  const cita = async (prof, cli, h, m) => (await q(`
    DECLARE @i DATETIME2(0) = DATEADD(MINUTE, ${h * 60 + m}, CAST(CAST(SYSDATETIME() AS DATE) AS DATETIME2(0)));
    EXEC dbo.sp_appointment_save @customer_id = ${cli}, @professional_id = ${prof}, @service_product_id = ${corte},
         @starts_at = @i, @permitir_encimar = 1, @user_id = ${dueno};`))[0][0].id;
  const cSofia1 = await cita(sofia, mariana, 9, 0);
  const cSofia2 = await cita(sofia, andrea, 10, 30);
  const cAna = await cita(ana, mariana, 12, 0);
  const orden = (await q(`EXEC dbo.sp_service_order_create @customer_id = ${david}, @customer_asset_id = ${vehiculo}, @reported_issue = N'Ruido al frenar', @user_id = ${dueno}`))[0][0].id;
  const linea = async (o, p, pr) => { await q(`EXEC dbo.sp_service_order_add_line @order_id = ${o}, @product_id = ${p}, @quantity = 1, @professional_id = ${pr}, @user_id = ${dueno}`); return (await uno(`SELECT TOP 1 id FROM dbo.service_order_lines WHERE order_id = ${o} ORDER BY id DESC`)).id; };
  const lCte = await linea(orden, servAceite, cte);
  const lPedro = await linea(orden, servAceite, pedro);

  host = crearHost({ pool, puerto: PUERTO });
  await host.iniciar();
  const T = host.trabajadores;
  const qrDe = async (persona) => (await T.generarQr(persona, dueno)).token;
  const pinDe = async (persona, pin) => { const r = await T.fijarPin(persona, pin, dueno); if (!r.ok) throw new Error(r.error); return r.accesoId; };

  const accion = (tab, nombre, cuerpo, h = {}) => tab.pedir(`/api/s/accion/${nombre}`, { metodo: 'POST', cuerpo, cabeceras: { 'Idempotency-Key': h.clave || `k${Math.random().toString(36).slice(2, 12)}${Date.now()}`, ...(h.diferida ? { 'X-Wx-Diferida': '1' } : {}) } });
  const estado = (tab) => tab.get('/api/s/estado');

  // ================================================================= NUCLEO
  seccion('Núcleo: registro, capacidades, dispositivo y trabajador');
  const reg = host.registro;
  const tipos = reg.todas().map(d => d.tipo);
  check('C01', tipos.length === 6 && ['PREPARATION', 'WAITER', 'STAFF_DAY', 'TECHNICIAN', 'INVENTORY_FLOOR', 'CUSTOMER_STATUS'].every(t => tipos.includes(t)),
    'el registro tiene las seis superficies definidas por Wybix', tipos.join(', '));
  const todasAcc = reg.todas().flatMap(d => Object.entries(d.acciones || {}).map(([n, a]) => ({ t: d.tipo, n, modo: a.modo })));
  check('C01', todasAcc.every(a => a.modo) && !todasAcc.some(a => /PAY|COBRAR|PRECIO|USUARIO|CONFIG/.test(a.n)),
    'cada acción declara su modo sin conexión, y ninguna cobra, cambia precios ni administra', `${todasAcc.length} acciones`);
  check('C01', reg.obtener('CUSTOMER_STATUS').familia === 'PUBLICA' && !Object.keys(reg.obtener('CUSTOMER_STATUS').acciones).length,
    'Estado de pedidos es pública y no tiene acciones');

  const disponibles = async () => (await host.superficiesDisponibles()).map(x => x.tipo).sort().join(',');
  check('C02', (await disponibles()) === 'CUSTOMER_STATUS,INVENTORY_FLOOR,PREPARATION,STAFF_DAY,TECHNICIAN,WAITER', 'con todo encendido se ofrecen las seis', await disponibles());
  ejecutar(DB, `EXEC dbo.sp_set_services_preset @preset = N'BELLEZA'`); host.capacidades.olvidar();
  const conBelleza = await disponibles();
  ejecutar(DB, `EXEC dbo.sp_set_services_preset @preset = N'TALLER_AUTOMOTRIZ'`); host.capacidades.olvidar();
  const conTaller = await disponibles();
  ejecutar(DB, `EXEC dbo.sp_set_business_module @module_key = N'hospitality', @enabled = 0`); host.capacidades.olvidar();
  const sinHosp = await disponibles();
  ejecutar(DB, `EXEC dbo.sp_set_business_module @module_key = N'hospitality', @enabled = 1`);
  ejecutar(DB, `EXEC dbo.sp_set_services_preset @preset = N'MANTENIMIENTO'`); host.capacidades.olvidar();
  check('C02', conBelleza.includes('STAFF_DAY') && !conBelleza.includes('TECHNICIAN'), 'Belleza: Mi jornada sí, Técnico no', conBelleza);
  check('C02', conTaller.includes('TECHNICIAN') && !conTaller.includes('STAFF_DAY'), 'Taller: Técnico sí, Mi jornada no', conTaller);
  check('C02', !/PREPARATION|WAITER|CUSTOMER_STATUS/.test(sinHosp) && sinHosp.includes('INVENTORY_FLOOR'), 'sin Hospitality no hay Preparación, Mesero ni Estado de pedidos', sinHosp);
  const noDisp = await host.emparejar({ superficie: 'TECHNICIAN', nombre: 'x', userId: 1 });
  check('C02', (await disponibles()).includes('TECHNICIAN') && noDisp.ok, 'y al volver el giro, vuelven');

  /* Dispositivos. */
  const eMesero = await emparejar(host, PUERTO, { superficie: 'WAITER', nombre: 'Tablet Meseros', config: { areas: [salon] } });
  const tabMesero = eMesero.tablet;
  const e0 = await estado(tabMesero);
  check('C03', e0.status === 200 && e0.json.superficie.tipo === 'WAITER' && e0.json.requiereTrabajador === true && e0.json.datos === null,
    'una tablet se empareja con una FUNCIÓN y, sin trabajador, no ve datos');
  check('C04', (await pedirCrudo('/api/s/estado', { puerto: PUERTO })).status === 401, 'sin credencial de dispositivo: 401');
  check('C04', (await tabMesero.get('/api/s/consulta/menu')).status === 401, 'con dispositivo pero sin trabajador, las consultas se niegan');

  const qrCarlos = await qrDe({ userId: carlos });
  const ent = await tabMesero.post('/api/trabajador/entrar', { qr: qrCarlos });
  const ck = [].concat(ent.headers['set-cookie'] || []).join(';');
  check('C05', ent.status === 200 && ent.json.sesion.persona.nombre === 'carlos' && /wx_trab=/.test(ck) && /HttpOnly/i.test(ck) && /SameSite=Strict/i.test(ck),
    'el trabajador entra con su QR; su sesión va en cookie HttpOnly y SameSite=Strict');
  check('C05', !JSON.stringify(ent.json).includes(qrCarlos) && (await uno(`SELECT COUNT(*) AS n FROM dbo.trabajadores_acceso WHERE qr_hash = '${hash(qrCarlos)}'`)).n === 1,
    'el QR es un token opaco: en la base solo su hash, y no se devuelve');
  const e1 = await estado(tabMesero);
  check('C05', e1.json.sesion?.persona?.nombre === 'carlos' && Array.isArray(e1.json.datos?.mesas), 'con sesión, la función ya muestra sus datos');

  const tabOtra = crearTablet(PUERTO);
  for (const [k, v] of eMesero.tablet.galletas) if (k === 'wx_disp') tabOtra.galletas.set(k, v);
  const porUrl = await tabOtra.post('/api/trabajador/entrar', { qr: `http://192.168.1.20:7427/w/${qrCarlos}` });
  check('C06', porUrl.status === 200, 'el QR también se acepta como la URL que abre la cámara (/w/TOKEN)');

  const accCarlos = (await uno(`SELECT id FROM dbo.trabajadores_acceso WHERE user_id = ${carlos}`)).id;
  check('C09', !(await T.fijarPin({ userId: carlos }, '1234', dueno)).ok && !(await T.fijarPin({ userId: carlos }, '7777', dueno)).ok && !(await T.fijarPin({ userId: carlos }, '12', dueno)).ok,
    'PIN: se rechazan series, repetidos y cortos');
  await pinDe({ userId: carlos }, '4826');
  const pinGuardado = await uno(`SELECT pin_hash, pin_sal FROM dbo.trabajadores_acceso WHERE id = ${accCarlos}`);
  check('C07', pinGuardado.pin_hash?.length === 64 && pinGuardado.pin_sal?.length === 32 && pinGuardado.pin_hash !== '4826', 'el PIN se guarda con scrypt y sal propia');
  const personas = (await tabOtra.get('/api/trabajador/personas')).json.personas || [];
  check('C07', personas.some(p => p.nombre === 'carlos') && !JSON.stringify(personas).match(/pin|hash|rol/i), 'para entrar con PIN se ven nombres, nada más');
  tabOtra.olvidarTrabajador();
  const malo = await tabOtra.post('/api/trabajador/entrar', { accesoId: accCarlos, pin: '0000' });
  const bueno = await tabOtra.post('/api/trabajador/entrar', { accesoId: accCarlos, pin: '4826' });
  check('C07', malo.status === 401 && bueno.status === 200, 'PIN incorrecto: no entra; correcto: entra');

  tabOtra.olvidarTrabajador();
  let bloqueo = null;
  for (let i = 0; i < 5; i++) bloqueo = await tabOtra.post('/api/trabajador/entrar', { accesoId: accCarlos, pin: '9991' });
  const conBloqueo = await tabOtra.post('/api/trabajador/entrar', { accesoId: accCarlos, pin: '4826' });
  check('C08', bloqueo.status === 429 && bloqueo.json.codigo === 'BLOQUEADO' && conBloqueo.status === 429,
    'cinco fallos bloquean el PIN; ni el correcto entra mientras dura', `${bloqueo.status}/${conBloqueo.status}`);
  await q(`UPDATE dbo.trabajadores_acceso SET bloqueado_hasta = NULL, pin_fallos = 0 WHERE id = ${accCarlos}`);

  /* Rotar y revocar. La «otra tablet» de arriba usa la misma credencial de
     dispositivo: al entrar cerro la sesion de esta (una por dispositivo). */
  await tabMesero.post('/api/trabajador/entrar', { qr: qrCarlos });
  const sesTab = eMesero.tablet.escuchar();
  await sesTab.esperar(e => e.evento === 'hola');
  const qrNuevo = await qrDe({ userId: carlos });
  const cerro = await sesTab.esperar(e => e.evento === 'sesion', 3000);
  const viejo = await tabOtra.post('/api/trabajador/entrar', { qr: qrCarlos });
  check('C10', viejo.status === 401 && !!cerro && cerro.datos.motivo === 'REVOCADA', 'rotar el QR invalida el anterior y cierra sus sesiones al momento');
  const reEnt = await tabMesero.post('/api/trabajador/entrar', { qr: qrNuevo });
  check('C10', reEnt.status === 200, 'el QR nuevo sí entra');

  /* Inactividad y caducidad. */
  const sesId = (await uno(`SELECT TOP 1 id FROM dbo.trabajador_sesiones WHERE dispositivo_id = '${eMesero.canje.json.dispositivo.id}' AND cerrada_en IS NULL`)).id;
  await q(`UPDATE dbo.trabajador_sesiones SET ultima_actividad = DATEADD(HOUR, -3, SYSUTCDATETIME()) WHERE id = '${sesId}'`);
  T.olvidar();
  const inact = await estado(tabMesero);
  const motivo1 = (await uno(`SELECT motivo_cierre FROM dbo.trabajador_sesiones WHERE id = '${sesId}'`)).motivo_cierre;
  check('C11', inact.json.requiereTrabajador === true && motivo1 === 'INACTIVIDAD', 'tras el tiempo sin actividad de la función, la sesión se cierra', motivo1);
  await tabMesero.post('/api/trabajador/entrar', { qr: qrNuevo });
  const sesId2 = (await uno(`SELECT TOP 1 id FROM dbo.trabajador_sesiones WHERE dispositivo_id = '${eMesero.canje.json.dispositivo.id}' AND cerrada_en IS NULL`)).id;
  const exp = await uno(`SELECT DATEDIFF(MINUTE, SYSUTCDATETIME(), expira_en) AS m FROM dbo.trabajador_sesiones WHERE id = '${sesId2}'`);
  check('C12', exp.m > 0 && exp.m <= 24 * 60, 'toda sesión termina, como tarde, al final del día', `${exp.m} min`);
  await q(`UPDATE dbo.trabajador_sesiones SET expira_en = DATEADD(MINUTE, -1, SYSUTCDATETIME()) WHERE id = '${sesId2}'`);
  T.olvidar();
  const cad = await estado(tabMesero);
  check('C12', cad.json.requiereTrabajador === true && (await uno(`SELECT motivo_cierre FROM dbo.trabajador_sesiones WHERE id = '${sesId2}'`)).motivo_cierre === 'CADUCADA',
    'una sesión vencida ya no entra: la tablet del salón no amanece siendo Carlos');
  await tabMesero.post('/api/trabajador/entrar', { qr: qrNuevo });

  // ============================================================ PREPARACION
  seccion('Preparación con el mesero (regresión del KDS por el nuevo camino)');
  const eBarra = await emparejar(host, PUERTO, { superficie: 'PREPARATION', stationId: barra, nombre: 'Tablet Barra' });
  const eCocina = await emparejar(host, PUERTO, { superficie: 'PREPARATION', stationId: cocina, nombre: 'Tablet Cocina' });
  const sBarra = eBarra.tablet.escuchar();
  const sCocina = eCocina.tablet.escuchar();
  await sBarra.esperar(e => e.evento === 'hola'); await sCocina.esperar(e => e.evento === 'hola');

  // ================================================================= MESERO
  seccion('Mesero');
  const est = (await estado(tabMesero)).json.datos;
  check('W01', est.mesas.every(m => m.areaId === salon) && !est.mesas.some(m => m.id === t1), 've solo las mesas de sus áreas permitidas (Salón, no Terraza)');
  check('W01', est.puedeCobrar === false, 'y no puede cobrar (V1)');
  const abre = await accion(tabMesero, 'ABRIR_MESA', { mesaId: m1 });
  const cuentaId = abre.json?.resultado?.cuentaId;
  const due = await uno(`SELECT abierta_por, mesa_id, estado FROM dbo.hosp_cuentas WHERE id = ${cuentaId || 0}`);
  check('W02', abre.status === 200 && due.abierta_por === carlos && due.mesa_id === m1 && due.estado === 'ABIERTA', 'abre la Mesa 1 a su nombre, con el mismo procedimiento que la caja');
  check('W02', (await accion(tabMesero, 'ABRIR_MESA', { mesaId: t1 })).status === 403, 'una mesa de Terraza no la puede abrir');
  const menu = (await tabMesero.get('/api/s/consulta/menu')).json;
  check('W03', menu.productos.some(p => p.id === latte && p.grupos.length) && !JSON.stringify(menu).match(/"cost"|costo/i), 'el menú trae productos y opciones, sin costos');
  const sinLeche = await accion(tabMesero, 'ENVIAR', { cuentaId, lineas: [{ productId: latte, cantidad: 1, origen: '11111111-1111-4111-8111-111111111111', opciones: [] }] });
  check('W03', sinLeche.status === 400 && /Leche/.test(sinLeche.json.error), 'un Latte sin elegir leche (obligatoria) se rechaza en el servidor', sinLeche.json.error);
  const ajena = await accion(tabMesero, 'ENVIAR', { cuentaId, lineas: [{ productId: sandwich, cantidad: 1, origen: '22222222-2222-4222-8222-222222222222', opciones: [{ optionId: avena }] }] });
  check('W03', ajena.status === 400, 'una opción que no es del producto se rechaza');
  const clave = 'envio-mesa1-aaaaaaaa';
  const envio = await accion(tabMesero, 'ENVIAR', { cuentaId, lineas: [
    { productId: latte, cantidad: 1, origen: '33333333-3333-4333-8333-333333333333', opciones: [{ optionId: avena, quantity: 1 }] },
    { productId: sandwich, cantidad: 1, origen: '44444444-4444-4444-8444-444444444444', nota: 'Sin cebolla', opciones: [] },
  ] }, { clave });
  const destinos = (envio.json?.resultado?.comandas || []).map(k => k.estacion).sort().join(',');
  check('W04', envio.status === 200 && destinos === 'Barra,Cocina', 'Latte + Sandwich: una comanda a Barra y otra a Cocina', destinos);
  const kB = await sBarra.esperar(e => e.datos?.tipo === 'PREPARATION_TICKET_CREATED', 6000);
  const kC = await sCocina.esperar(e => e.datos?.tipo === 'PREPARATION_TICKET_CREATED', 6000);
  check('W04', !!kB && kB.datos.sonar && kB.datos.datos.comanda.lineas[0].nombre === 'Latte' && kB.datos.datos.comanda.lineas[0].opciones.includes('Avena'),
    'la Barra recibe el Latte con Avena en tiempo real, y suena');
  check('W04', !!kC && kC.datos.datos.comanda.lineas[0].nota === 'Sin cebolla' && !sBarra.eventos.some(e => e.datos?.datos?.comanda?.lineas?.some(l => l.nombre === 'Sandwich')),
    'la Cocina recibe el Sandwich (con su nota) y la Barra no');
  const otraVez = await accion(tabMesero, 'ENVIAR', { cuentaId, lineas: [{ productId: sandwich, cantidad: 1, origen: '55555555-5555-4555-8555-555555555555', opciones: [] }] }, { clave });
  const nComandas = (await uno(`SELECT COUNT(*) AS n FROM dbo.comandas WHERE cuenta_id = ${cuentaId}`)).n;
  check('W09', otraVez.status === 200 && otraVez.json.repetido === true && nComandas === 2, 'reenviar con la misma clave no manda nada otra vez', `${nComandas} comandas`);

  const sMesero = tabMesero.escuchar();
  await sMesero.esperar(e => e.evento === 'hola');
  const cuentaVista = (await tabMesero.get(`/api/s/consulta/cuenta?id=${cuentaId}`)).json;
  check('W05', cuentaVista.lineas.length === 2 && cuentaVista.lineas.every(l => l.prep === 'NUEVA') && cuentaVista.total === 145,
    'el mesero ve su cuenta: cada cosa con su estado en cocina y el total', `total ${cuentaVista.total}`);
  const kLatte = (await uno(`SELECT id FROM dbo.comandas WHERE cuenta_id = ${cuentaId} AND station_id = ${barra}`)).id;
  await accion(eBarra.tablet, 'AVANZAR', { id: kLatte, desde: 'NUEVA' });
  await accion(eBarra.tablet, 'AVANZAR', { id: kLatte, desde: 'PREPARANDO' });
  const listo = await sMesero.esperar(e => e.datos?.tipo === 'ORDER_READY', 6000);
  check('W05', !!listo && listo.datos.sonar === true && Number(listo.datos.id) === Number(cuentaId), 'cuando la Barra lo marca listo, al mesero le suena «listo para servir»');
  check('W05', ((await tabMesero.get(`/api/s/consulta/cuenta?id=${cuentaId}`)).json.lineas.find(l => l.nombre === 'Latte') || {}).prep === 'LISTA', 'y su cuenta lo muestra listo');

  const pay = await accion(tabMesero, 'PAY', { cuentaId, monto: 145 });
  const cobrar = await accion(tabMesero, 'COBRAR', { cuentaId });
  check('W06', pay.status === 403 && cobrar.status === 403 && (await uno(`SELECT estado FROM dbo.hosp_cuentas WHERE id = ${cuentaId}`)).estado === 'ABIERTA',
    'el mesero no puede cobrar: PAY y COBRAR no existen para él (403) y la cuenta sigue abierta');
  check('W06', (await uno(`SELECT COUNT(*) AS n FROM dbo.superficie_auditoria WHERE accion = 'RECHAZADA' AND detalle LIKE N'PAY%'`)).n >= 1, 'y el intento queda en la auditoría');
  const online = await accion(tabMesero, 'ENVIAR', { cuentaId, lineas: [{ productId: sandwich, cantidad: 1, origen: '66666666-6666-4666-8666-666666666666' }] }, { diferida: true });
  check('W10', online.status === 409 && online.json.codigo === 'ONLINE_REQUIRED', 'enviar a preparación desde la cola sin conexión se rechaza: pide conexión');

  const salida = await tabMesero.post('/api/trabajador/salir', {});
  const trasSalir = await estado(tabMesero);
  const cuentaTras = await tabMesero.get(`/api/s/consulta/cuenta?id=${cuentaId}`);
  check('W08', salida.status === 200 && trasSalir.json.requiereTrabajador && trasSalir.json.datos === null && cuentaTras.status === 401,
    'al salir, la tablet vuelve a «¿quién eres?» y no se puede ver la cuenta');

  // ============================================================ MI JORNADA
  seccion('Mi jornada');
  const eJor = await emparejar(host, PUERTO, { superficie: 'STAFF_DAY', nombre: 'Tablet empleados' });
  const tabJor = eJor.tablet;
  const qrSofia = await qrDe({ professionalId: sofia });
  const entS = await tabJor.post('/api/trabajador/entrar', { qr: qrSofia });
  const jor = (await estado(tabJor)).json.datos;
  const idsCitas = jor.agenda.filter(x => x.tipo === 'CITA').map(x => x.id).sort();
  check('S01', entS.status === 200 && idsCitas.join() === [cSofia1, cSofia2].sort().join(), 'Sofía (profesional sin usuario) entra y ve SOLO sus citas de hoy', idsCitas.join());
  check('S01', !idsCitas.includes(cAna) && jor.reposo.citas === 2 && jor.reposo.siguiente, 'la de Ana no viaja a su tablet; resumen con la siguiente');
  const crudo = JSON.stringify(jor);
  check('S02', !/3312345678|3398765432|@correo|credit|saldo|rfc/i.test(crudo) && /Andrea López/.test(crudo), 've nombre de clienta, servicio y hora; nunca teléfono, correo ni saldo');
  check('S02', jor.agenda.some(x => x.tipo === 'LIBRE'), 'los huecos de media hora o más aparecen como «Disponible»');

  const llego = await accion(tabJor, 'LLEGO', { citaId: cSofia1 });
  const trasLlegar = await uno(`SELECT status, service_order_id FROM dbo.appointments WHERE id = ${cSofia1}`);
  check('S03', llego.status === 200 && trasLlegar.status === 'ATENDIDA' && trasLlegar.service_order_id, 'Llegó: la cita queda atendida y se abre su orden, como en la Agenda');
  const llego2 = await accion(tabJor, 'LLEGO', { citaId: cSofia1 });
  check('S03', llego2.status === 200 && (await uno(`SELECT COUNT(*) AS n FROM dbo.service_orders WHERE id = ${trasLlegar.service_order_id}`)).n === 1 && llego2.json.resultado.ordenId === trasLlegar.service_order_id,
    'marcarlo otra vez no abre otra orden');
  const empieza = await accion(tabJor, 'EMPEZAR', { citaId: cSofia1 });
  const lineaS = await uno(`SELECT l.id, l.status, o.status AS orden FROM dbo.service_order_lines l JOIN dbo.service_orders o ON o.id = l.order_id WHERE l.order_id = ${trasLlegar.service_order_id} AND l.line_kind = 'SERVICIO'`);
  check('S04', empieza.status === 200 && lineaS.status === 'EN_PROCESO' && lineaS.orden === 'EN_PROCESO', 'Empezar: su trabajo y la orden pasan a En proceso (la recepción lo ve)');
  const nota = await accion(tabJor, 'NOTA', { citaId: cSofia1, texto: 'Pidió tono 148' });
  check('S05', nota.status === 200 && (await uno(`SELECT COUNT(*) AS n FROM dbo.service_order_events WHERE order_id = ${trasLlegar.service_order_id} AND event_type = 'NOTA' AND detail = N'Sofía Ramírez: Pidió tono 148'`)).n === 1,
    'la nota rápida queda en el historial de la orden, con quién la escribió');
  const consumo = await accion(tabJor, 'CONSUMO', { citaId: cSofia1, items: [{ productId: gel, cantidad: 2 }] });
  const lGel = await uno(`SELECT quantity, unit_price_snapshot, line_kind FROM dbo.service_order_lines WHERE order_id = ${trasLlegar.service_order_id} AND product_id = ${gel}`);
  check('S06', consumo.status === 200 && Number(lGel.quantity) === 2 && Number(lGel.unit_price_snapshot) === 30 && lGel.line_kind === 'PRODUCTO',
    'el material usado entra a la orden como producto, al precio del catálogo (se descuenta al cobrar)');
  const noServicio = await accion(tabJor, 'CONSUMO', { citaId: cSofia1, items: [{ productId: corte, cantidad: 1 }] });
  check('S06', noServicio.status === 409, 'un servicio no se registra como material');
  const termina = await accion(tabJor, 'TERMINAR', { citaId: cSofia1 });
  const trasTerminar = await uno(`SELECT l.status, o.status AS orden FROM dbo.service_order_lines l JOIN dbo.service_orders o ON o.id = l.order_id WHERE l.id = ${lineaS.id}`);
  check('S07', termina.status === 200 && trasTerminar.status === 'HECHA' && trasTerminar.orden === 'TERMINADA', 'Terminar: su trabajo hecho y la orden terminada, lista para cobrar en caja');

  const entA = await crearTablet(PUERTO);
  for (const [k, v] of tabJor.galletas) if (k === 'wx_disp') entA.galletas.set(k, v);
  await entA.post('/api/trabajador/entrar', { qr: await qrDe({ professionalId: ana }) });
  const deOtra = await accion(entA, 'EMPEZAR', { citaId: cSofia2 });
  check('S10', deOtra.status === 403, 'Ana no puede tocar una cita de Sofía (403)');
  check('S12', !JSON.stringify((await estado(entA)).json.datos).includes('Andrea'), 'y al entrar Ana en la misma tablet, no ve nada de la jornada de Sofía');
  /* Ana entro en la misma tablet: la sesion de Sofia se cerro (una por dispositivo). */
  check('S12', (await estado(tabJor)).json.requiereTrabajador === true, 'una tablet, una sesión: entrar Ana saca a Sofía');
  await tabJor.post('/api/trabajador/entrar', { qr: qrSofia });

  /* Sin conexion: nota encolada, reenviada, y un conflicto. */
  const claveNota = 'nota-offline-sofia-01';
  const n1 = await accion(tabJor, 'NOTA', { citaId: cSofia2, texto: 'Llega 10 min tarde' }, { clave: claveNota, diferida: true });
  const n2 = await accion(tabJor, 'NOTA', { citaId: cSofia2, texto: 'Llega 10 min tarde' }, { clave: claveNota, diferida: true });
  const notasCita = (await uno(`SELECT notes FROM dbo.appointments WHERE id = ${cSofia2}`)).notes || '';
  check('S08', n1.status === 200 && n2.status === 200 && n2.json.repetido === true && (notasCita.match(/Llega 10 min tarde/g) || []).length === 1,
    'una nota hecha sin conexión se acepta al volver, y reenviarla no la duplica');
  const conflictoS = await accion(tabJor, 'EMPEZAR', { citaId: cSofia1 }, { diferida: true });
  check('S09', conflictoS.status === 409 && conflictoS.json.codigo === 'CONFLICTO' && /cambió mientras/.test(conflictoS.json.error),
    '«Empezar» encolado sobre algo que ya se terminó: conflicto, no se pisa', conflictoS.json.error);

  const sJor = tabJor.escuchar();
  await sJor.esperar(e => e.evento === 'hola');
  const nueva = await cita(sofia, andrea, 16, 0);
  const deAna = await cita(ana, andrea, 17, 0);
  const aviso = await sJor.esperar(e => e.datos?.tipo === 'APPOINTMENT_ASSIGNED' && Number(e.datos.id) === Number(nueva), 6000);
  await dormir(1200);
  check('S11', !!aviso && aviso.datos.sonar === true && !sJor.eventos.some(e => Number(e.datos?.id) === Number(deAna)),
    'una cita nueva para Sofía le llega en tiempo real y suena; la de Ana no');
  await q(`EXEC dbo.sp_appointment_to_order @appointment_id = ${nueva}, @user_id = ${dueno}`);
  const llega = await sJor.esperar(e => e.datos?.tipo === 'CLIENT_ARRIVED' && Number(e.datos.id) === Number(nueva), 6000);
  check('S11', !!llega && llega.datos.sonar, 'cuando recepción marca que llegó su clienta, suena «llegó»');

  // =============================================================== TECNICO
  seccion('Técnico');
  const eTec = await emparejar(host, PUERTO, { superficie: 'TECHNICIAN', nombre: 'Laptop taller' });
  const tabTec = eTec.tablet;
  await pinDe({ professionalId: cte }, '5813');   // profesional con usuario -> el acceso es del usuario
  const accCte = (await uno(`SELECT id, user_id, professional_id FROM dbo.trabajadores_acceso WHERE user_id = ${cteUser}`));
  check('T01', accCte.id && accCte.user_id === cteUser && accCte.professional_id == null, 'un profesional con usuario tiene UNA identidad: la de su usuario');
  await tabTec.post('/api/trabajador/entrar', { accesoId: accCte.id, pin: '5813' });
  const tec = (await estado(tabTec)).json.datos;
  check('T01', tec.trabajos.length === 1 && tec.trabajos[0].lineaId === lCte && tec.trabajos[0].identificador === 'ABC-123' && tec.trabajos[0].reportado === 'Ruido al frenar',
    've SUS trabajos (no el de Pedro), con el vehículo y lo que reportó el cliente');
  check('T01', !/350|price|precio|total|3300001111/i.test(JSON.stringify(tec)), 'sin precios, totales ni teléfono');
  const tEmp = await accion(tabTec, 'EMPEZAR', { lineaId: lCte });
  const tPau = await accion(tabTec, 'PAUSAR', { lineaId: lCte });
  const pausado = (await estado(tabTec)).json.datos.trabajos[0].pausado;
  const tRea = await accion(tabTec, 'REANUDAR', { lineaId: lCte });
  const evs = (await q(`SELECT event_type FROM dbo.service_order_events WHERE order_id = ${orden} AND event_type IN ('PAUSA', 'REANUDA') ORDER BY id`))[0].map(x => x.event_type).join(',');
  check('T02', tEmp.status === 200 && tPau.status === 200 && pausado === true && tRea.status === 200 && evs === 'PAUSA,REANUDA',
    'Empezar, Pausar y Continuar: la pausa queda en el historial (el dominio no inventa un estado)', evs);
  const tNota = await accion(tabTec, 'NOTA', { ordenId: orden, texto: 'Balatas traseras al 20%' });
  const tMat = await accion(tabTec, 'MATERIAL', { ordenId: orden, productId: aceite, cantidad: 4, unitPrice: 1 });
  const lAce = await uno(`SELECT quantity, unit_price_snapshot FROM dbo.service_order_lines WHERE order_id = ${orden} AND product_id = ${aceite}`);
  check('T03', tNota.status === 200 && tMat.status === 200 && Number(lAce.quantity) === 4 && Number(lAce.unit_price_snapshot) === 180,
    'nota y material: el aceite entra a precio de catálogo aunque la tablet mande otro precio', `${lAce.unit_price_snapshot}`);
  check('T04', (await accion(tabTec, 'EMPEZAR', { lineaId: lPedro })).status === 403, 'el trabajo de Pedro no lo puede tocar');
  const tPay = await accion(tabTec, 'PAY', { ordenId: orden });
  const tPrecio = await accion(tabTec, 'CAMBIAR_PRECIO', { lineaId: lCte, precio: 1 });
  check('T05', tPay.status === 403 && tPrecio.status === 403, 'no puede cobrar ni cambiar precios (esas acciones no existen para él)');
  const tFin = await accion(tabTec, 'TERMINAR', { lineaId: lCte, desde: 'EN_PROCESO' });
  const ordenTras = await uno(`SELECT status FROM dbo.service_orders WHERE id = ${orden}`);
  check('T02', tFin.status === 200 && ordenTras.status === 'EN_PROCESO', 'Terminar su parte: la orden sigue en proceso porque falta el trabajo de Pedro');
  const sTec = tabTec.escuchar();
  await sTec.esperar(e => e.evento === 'hola');
  const lNueva = await linea(orden, servAceite, cte);
  const asig = await sTec.esperar(e => e.datos?.tipo === 'WORK_ASSIGNED' && Number(e.datos.id) === Number(lNueva), 6000);
  check('T06', !!asig && asig.datos.sonar, 'un trabajo nuevo asignado le llega en tiempo real y suena');

  // ============================================================ INVENTARIO
  seccion('Inventario de piso');
  const eInv = await emparejar(host, PUERTO, { superficie: 'INVENTORY_FLOOR', nombre: 'Tablet piso' });
  const tabInv = eInv.tablet;
  await tabInv.post('/api/trabajador/entrar', { qr: await qrDe({ userId: luis }) });
  const bus = (await tabInv.get('/api/s/consulta/buscar?q=coca')).json;
  const cod = (await tabInv.get('/api/s/consulta/buscar?q=7501055300075')).json;
  check('I01', bus.productos.length === 1 && bus.productos[0].existencia === 14 && bus.productos[0].precio === 22, 'busca por nombre: existencia 14 y precio $22');
  check('I01', cod.productos[0]?.exacto === true && cod.productos[0].id === coca, 'el código de barras (lo que teclea un lector) encuentra el producto exacto');
  check('I01', !/cost|proveedor|supplier/i.test(JSON.stringify(bus)), 'sin costo ni proveedor');
  const cLuis = await accion(tabInv, 'CONTAR', { productId: coca, cantidad: 12 });
  const stock1 = (await uno(`SELECT stock FROM dbo.products WHERE id = ${coca}`)).stock;
  check('I02', cLuis.status === 200 && cLuis.json.resultado.aplicado === false && Number(stock1) === 14 && cLuis.json.resultado.motivo === 'SIN_PERMISO',
    'sin permiso de inventario, el conteo se REPORTA y la existencia no cambia');
  const fLuis = await accion(tabInv, 'FALTANTE', { productId: coca, nota: 'Anaquel vacío' });
  check('I05', fLuis.status === 200 && (await uno(`SELECT COUNT(*) AS n FROM dbo.inventario_reportes WHERE tipo = 'FALTANTE' AND product_id = ${coca}`)).n === 1, 'reporta un faltante');
  const invLuis = (await estado(tabInv)).json.datos;
  check('I01', invLuis.puedeAjustar === false && invLuis.reposo.faltantes === 1 && invLuis.recientes.length === 2, 'su resumen: lo que contó y reportó hoy');

  await tabInv.post('/api/trabajador/salir', {});
  await tabInv.post('/api/trabajador/entrar', { qr: await qrDe({ userId: marta }) });
  const cMarta = await accion(tabInv, 'CONTAR', { productId: coca, cantidad: 12 });
  const stock2 = (await uno(`SELECT stock FROM dbo.products WHERE id = ${coca}`)).stock;
  const mov = await uno(`SELECT TOP 1 typee, quantity, reference FROM dbo.inventory_movements WHERE product_id = ${coca} ORDER BY id DESC`);
  check('I03', cMarta.status === 200 && cMarta.json.resultado.aplicado === true && Number(stock2) === 12 && mov.reference === 'CONTEO' && mov.typee === 'salida' && Number(mov.quantity) === 2,
    'con permiso y en línea, el conteo ajusta con el mismo procedimiento que Conteo (-2, movimiento CONTEO)');
  const cDif = await accion(tabInv, 'CONTAR', { productId: coca, cantidad: 5 }, { diferida: true });
  check('I04', cDif.status === 200 && cDif.json.resultado.aplicado === false && cDif.json.resultado.motivo === 'SIN_CONEXION' && Number((await uno(`SELECT stock FROM dbo.products WHERE id = ${coca}`)).stock) === 12,
    'un conteo que llega de la cola sin conexión NO pisa la existencia: queda para revisión');
  await tabInv.post('/api/trabajador/salir', {});
  const sofiaInv = await tabInv.post('/api/trabajador/entrar', { qr: qrSofia });
  check('I06', sofiaInv.status === 401, 'una profesional sin usuario no entra a Inventario', sofiaInv.json?.error);

  /* Reconciliar desde Wybix: los mismos canales IPC que usa la pantalla, con
     una sesion de escritorio de verdad (sesion.proteger decide). */
  const sesion = require('../../electron/seguridad/sesion.js');
  const canales = {};
  host.registrarIpc({ handle: (n, fn) => { canales[n] = fn; } });
  await sesion.abrir(901, { id: marta, usuario: 'marta', rol: 'supervisor' });
  await sesion.abrir(902, { id: luis, usuario: 'luis', rol: 'cajero' });
  const ipc = (id, canal, p) => canales[canal]({ sender: { id } }, p);
  const pendientes = (await ipc(901, 'inventario:reportes', {})).data || [];
  const repConteo = pendientes.find(x => x.tipo === 'CONTEO' && Number(x.cantidad) === 5);
  const sinPermisoIpc = await ipc(902, 'inventario:reporte-resolver', { id: repConteo?.id, accion: 'APLICAR' });
  const aplica = await ipc(901, 'inventario:reporte-resolver', { id: repConteo?.id, accion: 'APLICAR' });
  const otraVezIpc = await ipc(901, 'inventario:reporte-resolver', { id: repConteo?.id, accion: 'APLICAR' });
  check('I07', pendientes.length >= 3 && sinPermisoIpc.success === false && aplica.success === true && Number((await uno(`SELECT stock FROM dbo.products WHERE id = ${coca}`)).stock) === 5 && otraVezIpc.success === false,
    'en Wybix, quien tiene permiso aplica un conteo reportado (una sola vez); un cajero no puede', `stock ${(await uno(`SELECT stock FROM dbo.products WHERE id = ${coca}`)).stock}`);
  const falt = pendientes.find(x => x.tipo === 'FALTANTE');
  check('I07', (await ipc(901, 'inventario:reporte-resolver', { id: falt?.id, accion: 'APLICAR' })).success === false && (await ipc(901, 'inventario:reporte-resolver', { id: falt?.id, accion: 'DESCARTAR' })).success === true,
    'un faltante no se «aplica»: se atiende y se descarta');
  check('C21', (await ipc(902, 'localhost:trabajador-pin', { userId: luis, pin: '4455' })).success === false && (await ipc(902, 'localhost:cambiar-funcion', { id: eMesero.canje.json.dispositivo.id, superficie: 'INVENTORY_FLOOR' })).success === false,
    'administrar dispositivos y accesos exige Configuración: un cajero no puede desde Wybix');

  // ======================================================= ESTADO DE PEDIDOS
  seccion('Estado de pedidos');
  const ePub = await emparejar(host, PUERTO, { superficie: 'CUSTOMER_STATUS', nombre: 'TV mostrador', config: { minutosListo: 2 } });
  const tabPub = ePub.tablet;
  /* Un «para llevar» con el nombre del cliente en la etiqueta: no debe salir.
     Se abre como en la caja: la base le da su numero del dia. */
  const abiertaLl = await uno(`EXEC dbo.sp_hosp_cuenta_abrir @etiqueta = N'Rodrigo Pérez', @user_id = ${carlos}, @customer_id = ${davidC}`);
  const llevar = abiertaLl.id;
  const num = abiertaLl.numero_dia;
  await q(`DECLARE @l dbo.HospOrdenLineaV2Type; INSERT INTO @l VALUES (1, ${sandwich}, 1, NULL, NEWID());
           DECLARE @o dbo.HospOrdenOpcionType; EXEC dbo.sp_hosp_orden_enviar @cuenta_id = ${llevar}, @user_id = ${carlos}, @lineas = @l, @opciones = @o;`);
  const pub = await estado(tabPub);
  const txt = JSON.stringify(pub.json.datos);
  check('K06', Number.isInteger(num) && num > 0 && num < 1000 && abiertaLl.titulo === `Pedido ${num} · Rodrigo Pérez`,
    'una cuenta sin mesa recibe un número de pedido corto del día', `${abiertaLl.titulo}`);
  const siguiente = await uno(`EXEC dbo.sp_hosp_cuenta_abrir @etiqueta = N'Para llevar', @user_id = ${carlos}`);
  const deMesaHoy = await uno(`SELECT COUNT(*) AS n FROM dbo.hosp_cuentas WHERE mesa_id IS NOT NULL AND numero_dia IS NOT NULL`);
  check('K06', siguiente.numero_dia === num + 1 && deMesaHoy.n === 0, 'el siguiente toma el número que sigue; una mesa no lleva número',
    `${num} → ${siguiente.numero_dia}`);
  await q(`UPDATE dbo.hosp_cuentas SET estado = 'CANCELADA' WHERE id = ${siguiente.id}`);
  /* Ayer ya se uso el 1: hoy vuelve a empezar igual. El indice es por dia. */
  await q(`INSERT INTO dbo.hosp_cuentas (etiqueta, estado, abierta_en, numero_dia) VALUES (N'Ayer', 'COBRADA', DATEADD(DAY, -1, SYSDATETIME()), ${num});`);
  check('K06', (await uno(`SELECT COUNT(*) AS n FROM dbo.hosp_cuentas WHERE numero_dia = ${num}`)).n === 2, 'el número es del día: mañana vuelve a empezar sin chocar con hoy');
  check('K01', pub.json.requiereTrabajador === false && pub.json.datos.pedidos.some(p => p.numeroPedido === num && p.estado === 'PREPARANDO' && p.nombrePublico === 'David'), 'muestra «Pedido N · Preparando» sin pedir a nadie que entre');
  check('K01', !/Rodrigo|Pérez|Casillas|correo|5512345678|CAKD|Secreta|total|145|mesa|carlos|Sandwich/i.test(txt), 'solo el primer nombre: sin apellido, correo, teléfono, RFC, dirección, totales, mesas (si no se eligió) ni productos', txt.slice(0, 120));
  const CLAVES = ['numeroPedido', 'estado', 'nombrePublico', 'reciente', 'mesa'];
  check('K11', pub.json.datos.pedidos.every(p => Object.keys(p).every(k => CLAVES.includes(k))), 'el DTO público es cerrado: numeroPedido, estado, nombrePublico (y reciente / mesa)');
  const nombres = await q(`SELECT dbo.fn_nombre_publico_cliente(N'David Casillas') AS a, dbo.fn_nombre_publico_cliente(N'  maría   lópez ') AS b,
    dbo.fn_nombre_publico_cliente(N'Público en General') AS c, dbo.fn_nombre_publico_cliente(N'juan@correo.mx') AS d,
    dbo.fn_nombre_publico_cliente(N'5512345678') AS e, dbo.fn_nombre_publico_cliente(NULL) AS f, dbo.fn_nombre_publico_cliente(N'Maximilianoaurelioextralargo Pérez') AS g`);
  const nn = nombres[0][0];
  check('K11', nn.a === 'David' && nn.b === 'maría' && nn.c === null && nn.d === null && nn.e === null && nn.f === null && nn.g.length === 20,
    'el nombre público es solo el primer nombre; nada si parece un correo o un teléfono, o si es «Público en general»', JSON.stringify(nn));
  const sPub = tabPub.escuchar();
  await sPub.esperar(e => e.evento === 'hola');
  const kLl = (await uno(`SELECT id FROM dbo.comandas WHERE cuenta_id = ${llevar}`)).id;
  const kds = await uno(`EXEC dbo.sp_kds_get @comanda_id = ${kLl}`);
  check('K06', kds.destino === `Pedido ${num} · Rodrigo Pérez` && kds.numero_dia === num, 'la cocina canta el mismo número que ve el cliente', kds.destino);
  await accion(eCocina.tablet, 'AVANZAR', { id: kLl, desde: 'NUEVA' });
  await accion(eCocina.tablet, 'AVANZAR', { id: kLl, desde: 'PREPARANDO' });
  const cambioPub = await sPub.esperar(e => e.datos?.tipo === 'CUSTOMER_ORDER_STATUS_UPDATED', 6000);
  const pub2 = (await estado(tabPub)).json.datos;
  check('K02', !!cambioPub && pub2.pedidos.find(p => p.numeroPedido === num)?.estado === 'LISTO', 'cuando la cocina termina, pasa a LISTO y la pantalla se entera');
  await q(`UPDATE dbo.comandas SET lista_en = DATEADD(MINUTE, -3, lista_en) WHERE id = ${kLl}`);
  check('K03', !(await estado(tabPub)).json.datos.pedidos.some(p => p.numeroPedido === num), 'un pedido LISTO desaparece a los minutos configurados');
  check('K04', (await accion(tabPub, 'AVANZAR', { id: kLl, desde: 'LISTA' })).status === 403 && (await tabPub.get('/api/s/consulta/cuenta?id=1')).status === 404 &&
    (await tabPub.post('/api/trabajador/entrar', { qr: qrSofia })).status === 404, 'solo lectura: ni acciones, ni consultas, ni entrar trabajadores');
  const intrusa = crearTablet(PUERTO);
  const rutas = ['/api/s/estado', '/api/s/eventos', '/api/kds/estado', '/api/s/consulta/cuenta?id=1', '/api/trabajador/personas', '/api/dispositivo/funciones'];
  const sinCred = await Promise.all(rutas.map(r => intrusa.get(r)));
  check('K05', sinCred.every(r => r.status === 401), 'conocer la IP, el puerto y las URLs no da nada sin credencial', sinCred.map(r => r.status).join(','));

  /* Mesas: fuera por omision (a la mesa le lleva la comida el mesero); con
     «incluir mesas», salen por su nombre y sin numero. Una mesa propia, que
     se retira al terminar para no mover el salon de las demas pruebas. */
  const mP = await mesa(terraza, 'P9');
  const ctaP = (await uno(`EXEC dbo.sp_hosp_cuenta_abrir @mesa_id = ${mP}, @user_id = ${carlos}`)).id;
  await q(`DECLARE @l dbo.HospOrdenLineaV2Type; INSERT INTO @l VALUES (1, ${sandwich}, 1, NULL, NEWID());
           DECLARE @o dbo.HospOrdenOpcionType; EXEC dbo.sp_hosp_orden_enviar @cuenta_id = ${ctaP}, @user_id = ${carlos}, @lineas = @l, @opciones = @o;`);
  const sinMesas = (await estado(tabPub)).json.datos.pedidos;
  const tvMesas = (await emparejar(host, PUERTO, { superficie: 'CUSTOMER_STATUS', nombre: 'TV con mesas', config: { mostrarMesa: true } })).tablet;
  const conMesas = (await estado(tvMesas)).json.datos.pedidos;
  check('K07', sinMesas.every(p => p.numeroPedido != null && !p.mesa) && conMesas.some(p => p.numeroPedido == null && p.mesa === 'P9'),
    'por omisión solo salen pedidos con número; con «incluir mesas», la mesa sale por su nombre', JSON.stringify(conMesas).slice(0, 120));
  /* SEGUIMIENTO: el QR de la pantalla de la caja lleva al telefono del
     cliente, que no esta emparejado ni es de nadie de Wybix. */
  const segCod = String((await uno(`SELECT seguimiento FROM dbo.hosp_cuentas WHERE id = ${llevar}`)).seguimiento || '').trim();
  const telefono = crearTablet(PUERTO);
  const pagTel = await telefono.get(`/p/${segCod}`);
  const apiTel = await telefono.get(`/api/p/${segCod.toLowerCase()}`);
  check('K08', /^[0-9A-F]{32}$/.test(segCod) && pagTel.status === 200 && /pedido\.js/.test(pagTel.texto) && !/app\.js/.test(pagTel.texto)
    && apiTel.status === 200 && apiTel.json?.numeroPedido === num && apiTel.json?.estado === 'LISTO' && !pagTel.headers['set-cookie'] && !apiTel.headers['set-cookie'],
    'con el QR, un teléfono sin credencial ve su pedido; no recibe cookie ni la app de trabajo', JSON.stringify(apiTel.json).slice(0, 110));
  check('K08', !/Rodrigo|Pérez|Casillas|correo|5512345678|CAKD|total|Sandwich|carlos|cuenta_id|seguimiento|mesa/i.test(apiTel.texto) && Array.isArray(apiTel.json?.pedidos)
    && apiTel.json.pedidos.every(p => Object.keys(p).every(k => CLAVES.includes(k))),
    'el seguimiento individual (conservado) usa el mismo DTO público: ni nombre completo, ni productos, ni totales, ni ids internos');
  const cuentaGet = JSON.stringify((await q(`EXEC dbo.sp_hosp_cuenta_get @cuenta_id = ${llevar}`))[0]);
  check('K08', !cuentaGet.includes(segCod) && !/seguimiento/i.test(cuentaGet), 'el código de seguimiento no sale hacia las pantallas de Wybix (solo el proceso principal lo convierte en QR)');
  await q(`INSERT INTO dbo.hosp_cuentas (etiqueta, estado, abierta_en, numero_dia, seguimiento)
           VALUES (N'Ayer', 'COBRADA', DATEADD(DAY, -1, SYSDATETIME()), 998, 'ABCDEF0123456789ABCDEF0123456789');`);
  const inventado = await telefono.get(`/api/p/${'0'.repeat(32)}`);
  const deAyer = await telefono.get('/api/p/ABCDEF0123456789ABCDEF0123456789');
  const escribe = await telefono.post(`/api/p/${segCod}`, {});
  const otraPuerta = await telefono.post('/api/s/accion/AVANZAR', { id: kLl, desde: 'LISTA' });
  check('K09', inventado.status === 404 && deAyer.status === 404 && escribe.status === 405 && otraPuerta.status === 401 && (await telefono.get('/api/s/estado')).status === 401,
    'un código inventado o de ayer no da nada; es solo lectura; y no abre ninguna otra puerta',
    [inventado.status, deAyer.status, escribe.status, otraPuerta.status].join(','));
  const { urlDeSeguimiento } = require('../../electron/local-host/seguimiento.js');
  const arriendo = await uno(`SELECT direccion, puerto FROM dbo.local_host_lease WHERE id = 1`);
  const urlSeg = await urlDeSeguimiento({ pool: async () => pool, sql, cuentaId: llevar });
  const conHost = arriendo.direccion
    ? urlSeg?.url === `http://${arriendo.direccion}:${arriendo.puerto}/p/${segCod}`
    : urlSeg?.url === null && urlSeg?.motivo === 'SIN_HOST';
  await q(`UPDATE dbo.local_host_lease SET lease_until = DATEADD(MINUTE, -5, SYSUTCDATETIME()) WHERE id = 1`);
  const sinHost = await urlDeSeguimiento({ pool: async () => pool, sql, cuentaId: llevar });
  await q(`UPDATE dbo.local_host_lease SET lease_until = DATEADD(SECOND, 90, SYSUTCDATETIME()) WHERE id = 1`);
  const deMesaUrl = await urlDeSeguimiento({ pool: async () => pool, sql, cuentaId: ctaP });
  check('K10', urlSeg?.numero === num && conHost && sinHost?.url === null && sinHost?.numero === num && deMesaUrl === null,
    'el seguimiento individual (conservado) sigue resolviendo su dirección; sin Host, sin QR', urlSeg?.url || urlSeg?.motivo);

  /* TABLERO PUBLICO GENERAL: lo que abre el QR de la pantalla del cliente. */
  const pagTab = await telefono.get('/pedidos');
  const apiTab = await telefono.get('/api/pedidos');
  const deLaTv = (await estado(tvMesas)).json.datos.pedidos.filter(p => p.numeroPedido != null);
  check('K12', pagTab.status === 200 && /s-cliente\.js/.test(pagTab.texto) && /tablero\.js/.test(pagTab.texto) && !/app\.js/.test(pagTab.texto)
    && apiTab.status === 200 && !pagTab.headers['set-cookie'] && !apiTab.headers['set-cookie'],
    'el tablero general se abre en un teléfono sin credencial: la misma superficie (s-cliente.js), sin la app de trabajo ni cookie');
  check('K12', JSON.stringify(apiTab.json.pedidos) === JSON.stringify(deLaTv) && apiTab.json.pedidos.some(p => p.numeroPedido === num && p.nombrePublico === 'David'),
    'el teléfono recibe exactamente lo mismo que la TV (una sola fuente: pedidosPublicos)', JSON.stringify(apiTab.json.pedidos).slice(0, 110));
  check('K12', !/Casillas|correo|5512345678|CAKD|Secreta|Rodrigo|total|Sandwich|cuenta|seguimiento/i.test(apiTab.texto)
    && apiTab.json.pedidos.every(p => Object.keys(p).every(k => CLAVES.includes(k))),
    'la ruta pública no suelta nada más: ni apellido, correo, teléfono, RFC, dirección, productos ni ids');
  check('K12', (await telefono.post('/api/pedidos', {})).status === 405 && (await telefono.get('/api/s/estado')).status === 401 && (await telefono.get('/api/trabajador/personas')).status === 401,
    'el tablero es solo lectura y no abre ninguna otra puerta');

  /* QR de la pantalla del cliente: el GENERAL, no el individual. */
  const QRCode = require('qrcode');
  const { pedidoParaPantallaCliente, urlDelTablero } = require('../../electron/local-host/qr-pantalla-cliente.js');
  const opcQr = { margin: 1, width: 420, errorCorrectionLevel: 'M' };
  const pc = await pedidoParaPantallaCliente({ pool: async () => pool, sql, QRCode, pedido: { numero: num, cuentaId: llevar, cliente: 'David Casillas' } });
  const urlTab = await urlDelTablero({ pool: async () => pool });
  const qrTablero = urlTab ? await QRCode.toDataURL(urlTab, opcQr) : null;
  const qrIndividual = arriendo.direccion ? await QRCode.toDataURL(`http://${arriendo.direccion}:${arriendo.puerto}/p/${segCod}`, opcQr) : null;
  check('K13', pc?.numero === num && pc?.cliente === 'David Casillas'
    && (arriendo.direccion ? (urlTab === `http://${arriendo.direccion}:${arriendo.puerto}/pedidos` && pc.qr === qrTablero && pc.qr !== qrIndividual) : pc.qr === null),
    'la pantalla del cliente recibe número, nombre completo y el QR del tablero general (no el de /p/<token>)', urlTab || 'sin red local');
  await q(`UPDATE dbo.local_host_lease SET lease_until = DATEADD(MINUTE, -5, SYSUTCDATETIME()) WHERE id = 1`);
  const pcSinHost = await pedidoParaPantallaCliente({ pool: async () => pool, sql, QRCode, pedido: { numero: num, cliente: 'David Casillas' } });
  await q(`UPDATE dbo.local_host_lease SET lease_until = DATEADD(SECOND, 90, SYSUTCDATETIME()) WHERE id = 1`);
  const pcSinCliente = await pedidoParaPantallaCliente({ pool: async () => pool, sql, QRCode, pedido: { numero: num } });
  check('K13', pcSinHost?.qr === null && pcSinHost?.numero === num && pcSinHost?.cliente === 'David Casillas' && pcSinCliente?.cliente === null,
    'sin Local Host: número y cliente igual, sin QR; sin cliente: sin nombre');

  /* El cliente de la cuenta: cambiarlo y quitarlo cambia el tablero. */
  await q(`EXEC dbo.sp_hosp_cuenta_cliente @cuenta_id = ${llevar}, @customer_id = ${maria}`);
  const conMaria = (await telefono.get('/api/pedidos')).json.pedidos.find(p => p.numeroPedido === num);
  await q(`EXEC dbo.sp_hosp_cuenta_cliente @cuenta_id = ${llevar}, @customer_id = NULL`);
  const sinNadie = (await telefono.get('/api/pedidos')).json.pedidos.find(p => p.numeroPedido === num);
  await q(`EXEC dbo.sp_hosp_cuenta_cliente @cuenta_id = ${llevar}, @customer_id = ${davidC}`);
  check('K14', conMaria?.nombrePublico === 'María' && sinNadie && sinNadie.nombrePublico === null && sinNadie.numeroPedido === num,
    'cambiar David → María y quitar el cliente se ve en el tablero; sin cliente, el número sigue', `${conMaria?.nombrePublico} / ${sinNadie?.nombrePublico}`);
  const prepIds = await q(`EXEC dbo.sp_hosp_productos_con_preparacion @ids = N'${sandwich},${latte},${coca},999999'`);
  const conPrep = prepIds[0].map(r => r.product_id).sort();
  check('K15', conPrep.includes(sandwich) && conPrep.includes(latte) && !conPrep.includes(coca) && !conPrep.includes(999999),
    'antes de cobrar, la caja sabe qué va a preparación: los productos con estación activa, no los demás', conPrep.join(','));

  await q(`UPDATE dbo.comandas SET estado = 'ENTREGADA', entregada_en = SYSDATETIME() WHERE cuenta_id = ${ctaP};
           UPDATE dbo.hosp_cuentas SET estado = 'CANCELADA' WHERE id = ${ctaP};
           UPDATE dbo.salon_mesas SET activa = 0 WHERE id = ${mP};`);

  // ===================================================== CAMBIO DE FUNCION
  seccion('Cambiar la función de una tablet');
  const accDueno = await pinDe({ userId: dueno }, '2580');
  const accMarta = (await uno(`SELECT id FROM dbo.trabajadores_acceso WHERE user_id = ${marta}`)).id;
  await pinDe({ userId: marta }, '3691');
  const funcs = (await tabJor.get('/api/dispositivo/funciones')).json;
  check('C14', funcs.funciones.length === 6 && funcs.autorizan.some(p => p.id === accDueno) && !funcs.autorizan.some(p => p.id === accMarta),
    'la tablet ofrece solo las funciones del negocio, y solo un administrador puede autorizar');
  const sinPerm = await tabJor.post('/api/dispositivo/funcion', { superficie: 'WAITER', accesoId: accMarta, pin: '3691' });
  const pinMal = await tabJor.post('/api/dispositivo/funcion', { superficie: 'WAITER', accesoId: accDueno, pin: '0000' });
  check('C14', sinPerm.status === 403 && pinMal.status === 403, 'una encargada no puede reasignar la tablet, ni con PIN incorrecto');
  const sFun = tabJor.escuchar();
  await sFun.esperar(e => e.evento === 'hola');
  const cambia = await tabJor.post('/api/dispositivo/funcion', { superficie: 'WAITER', accesoId: accDueno, pin: '2580' });
  const evF = await sFun.esperar(e => e.evento === 'funcion', 3000);
  const trasCambio = await estado(tabJor);
  check('C14', cambia.status === 200 && !!evF && trasCambio.json.superficie.tipo === 'WAITER' && trasCambio.json.requiereTrabajador,
    'con PIN de administrador: la tablet pasa a Mesero, cierra la sesión anterior y avisa a la pantalla');
  const r15 = await host.cambiarFuncion({ id: eJor.canje.json.dispositivo.id, superficie: 'STAFF_DAY', userId: dueno });
  check('C15', r15.ok && (await estado(tabJor)).json.superficie.tipo === 'STAFF_DAY', 'y desde Wybix (Configuración) se reasigna igual');

  /* Revocar, ultimo contacto, auditoria. */
  const listaDisp = await host.dispositivos();
  const dMes = listaDisp.find(d => d.nombre === 'Tablet Meseros');
  check('C19', !!dMes?.ultimoContacto && dMes.superficieNombre === 'Mesero' && dMes.config.areas?.[0] === salon, 'la administración ve cada dispositivo: función, áreas y último contacto');
  const dJor = listaDisp.find(d => d.nombre === 'Tablet empleados');
  check('C19', dJor && 'sesion' in dJor, 'y quién está en cada uno (si hay alguien)');
  await host.revocar(eInv.canje.json.dispositivo.id, dueno);
  check('C16', (await estado(tabInv)).status === 401, 'revocar un dispositivo lo deja fuera al momento');
  const aud = await uno(`SELECT TOP 1 a.accion, a.superficie, a.entidad, a.entidad_id, u.usuario, d.nombre AS disp
    FROM dbo.superficie_auditoria a JOIN dbo.users u ON u.id = a.user_id JOIN dbo.dispositivos_locales d ON d.id = a.dispositivo_id
    WHERE a.accion = 'ENVIAR' ORDER BY a.id DESC`);
  check('C20', aud.accion === 'ENVIAR' && aud.superficie === 'WAITER' && aud.usuario === 'carlos' && aud.disp === 'Tablet Meseros' && aud.entidad === 'MESA',
    'auditoría: Carlos · Tablet Meseros · WAITER · Mesa · ENVIAR', JSON.stringify(aud));
  check('C17', (await accion(tabJor, 'AVANZAR', { id: kLatte, desde: 'LISTA' })).status === 403 && (await tabJor.get('/api/s/consulta/menu')).status !== 200,
    'cada función solo tiene sus acciones y consultas: Mi jornada no mueve comandas ni ve el menú');
  const cajeroJornada = await tabJor.post('/api/trabajador/entrar', { qr: await qrDe({ userId: luis }) });
  check('C18', cajeroJornada.status === 401 && /profesional/i.test(cajeroJornada.json.error), 'un usuario que no es profesional no entra a Mi jornada', cajeroJornada.json.error);

  // ============================================================= SEGURIDAD
  seccion('Seguridad');
  const cors = await tabMesero.get('/api/s/estado', { cabeceras: { Origin: 'http://evil.example' } });
  check('X01', !cors.headers['access-control-allow-origin'], 'sin CORS');
  const todo = [e0, e1, ent, envio, cuentaVista && { texto: JSON.stringify(cuentaVista) }, pub, bus && { texto: JSON.stringify(bus) }].filter(Boolean).map(x => x.texto || '').join('\n');
  check('X02', !/Server=|Integrated Security|mssql|1433|Wybix_Tmp|\bat .+\.js:\d+/i.test(todo), 'ninguna respuesta trae SQL, rutas ni trazas');
  let lim = null;
  for (let i = 0; i < 25 && !lim; i++) { const r = await intrusa.post('/api/pair', { token: 'A'.repeat(43) }); if (r.status === 429) lim = r; }
  check('X03', !!lim, 'emparejar tiene límite de intentos');
  const inyeccion = await tabInv.get(`/api/s/consulta/buscar?q=${encodeURIComponent("'; DROP TABLE products;--")}`);
  check('X04', (await uno(`SELECT COUNT(*) AS n FROM dbo.products`)).n > 0 && inyeccion.status !== 500, 'las búsquedas van parametrizadas (una inyección no hace nada)');
  const grande = await accion(tabJor, 'NOTA', { citaId: cSofia2, texto: 'x'.repeat(20000) });
  check('X05', grande.status === 413, 'un cuerpo enorme se rechaza (413)');
  const escape = await Promise.all(['/app/..%2f..%2fservidor.js', '/app/%2e%2e/index.js', '/kds/../../main.js', '/app/..\servidor.js', '/w/..%2f..%2fdb.js']
    .map(r => pedirCrudo(r, { puerto: PUERTO })));
  const iconos = await pedirCrudo('/app/iconos.woff2', { puerto: PUERTO });
  check('X07', iconos.status === 200 && iconos.headers['content-type'] === 'font/woff2' && iconos.texto.length > 1000,
    'los iconos salen de la fuente Phosphor que ya usa Wybix, servida por el propio Host');
  check('X06', escape.every(r => r.status === 404 && !r.texto.includes('require(')), 'las rutas estáticas no salen de la carpeta de la página', escape.map(r => r.status).join(','));

  // ====================================================== INTERNET / LAN
  seccion('Con y sin Internet');
  const real = red.hayInternet;
  for (const [n, conInternet] of [['N01', true], ['N02', false]]) {
    red.hayInternet = async () => conInternet;
    await host.detener();
    host = crearHost({ pool, puerto: PUERTO });
    await host.iniciar();
    const e = await emparejar(host, PUERTO, { superficie: 'STAFF_DAY', nombre: `Tablet ${n}` });
    const entrar = await e.tablet.post('/api/trabajador/entrar', { qr: qrSofia });
    const s = e.tablet.escuchar();
    const hola = await s.esperar(ev => ev.evento === 'hola', 4000);
    const nta = await accion(e.tablet, 'NOTA', { citaId: cSofia2, texto: `prueba ${n}` });
    check(n, host.instantanea().internet === conInternet && entrar.status === 200 && !!hola && nta.status === 200,
      `${conInternet ? 'con' : 'sin'} Internet: emparejar, entrar, tiempo real y acciones funcionan igual`, `internet=${host.instantanea().internet}`);
    s.cerrar();
  }
  red.hayInternet = real;

  // ================================================== PANTALLA (Chromium)
  seccion('La pantalla en un navegador');
  let chromium = null, devices = null;
  try { ({ chromium, devices } = require('playwright')); } catch { /* sin playwright */ }
  if (!chromium) salto('U01', 'pruebas de navegador', 'playwright no está disponible');
  else {
    navegador = await chromium.launch();
    const base = `http://127.0.0.1:${PUERTO}`;
    const errores = [];
    const abrirTablet = async (superficie, nombre, opciones = {}, dispositivo = 'Galaxy Tab S4') => {
      const c = await navegador.newContext({ ...devices[dispositivo], baseURL: base });
      const p = await c.newPage();
      p.on('pageerror', e => errores.push(`${superficie}: ${e.message}`));
      const qr = await host.emparejar({ superficie, nombre, userId: 1, ...opciones });
      await p.goto(qr.url.replace(/^http:\/\/[^/]+/, base));
      await p.getByRole('button', { name: 'Conectar esta pantalla' }).tap();
      return { c, p };
    };
    const entrarPin = async (p, nombre, pin) => {
      await p.getByRole('button', { name: 'Usar PIN' }).tap();
      await p.getByRole('button', { name: new RegExp(nombre) }).tap();
      for (const d of pin) await p.getByRole('button', { name: d, exact: true }).tap();
      await p.getByRole('button', { name: 'Entrar' }).tap();
    };
    const foto = async (p, n) => { if (CAPTURAS) await p.screenshot({ path: `${CAPTURAS}/${n}.png` }); };
    const sinScroll = async (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

    await pinDe({ professionalId: sofia }, '1470');
    /* Mi jornada: entrar con PIN, ver su día, nota sin conexión, salir limpio. */
    const j = await abrirTablet('STAFF_DAY', 'Tablet empleados UI', {}, 'iPad (gen 7)');
    await j.p.getByText('Hola. ¿Quién eres?').waitFor({ timeout: 8000 });
    await foto(j.p, 'u-entrar');
    await entrarPin(j.p, 'Sofía', '1470');
    await j.p.getByText(/Sofía$/).first().waitFor({ timeout: 8000 });
    await j.p.getByText('Andrea López').first().waitFor();
    check('U01', await sinScroll(j.p), 'Mi jornada: entra con PIN y ve su día (iPad vertical, sin scroll horizontal)');
    check('U01', await j.p.locator('.trab__cab').count() === 1 && await j.p.locator('.trab__barra-inf button', { hasText: 'Salir' }).count() === 1 && await j.p.locator('.tl .tl__it').count() >= 2,
      'carcasa B: banda con la persona, línea de tiempo y barra inferior con Salir');
    await foto(j.p, 'u-jornada');
    await j.p.locator(`[data-cita="${cSofia2}"]`).tap();
    await j.p.getByRole('dialog').waitFor();
    await host.detener();
    await j.p.locator('#nota-cita').fill('Trae foto de referencia');
    await j.p.getByRole('dialog').getByRole('button', { name: 'Guardar nota' }).tap();
    await j.p.getByText('Guardado sin conexión').waitFor({ timeout: 8000 });
    const enCola = await j.p.evaluate(() => JSON.parse(localStorage.getItem('wx_cola') || '[]').length);
    check('O01', enCola === 1, 'sin conexión, una nota (OFFLINE_SAFE) se guarda en la cola de la tablet');
    await j.p.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).tap();
    await j.p.locator(`[data-cita="${cSofia2}"]`).tap();
    const hojaCita = j.p.getByRole('dialog');
    await hojaCita.getByRole('button', { name: 'Empezar' }).waitFor();
    await hojaCita.getByRole('button', { name: 'Llegó', exact: true }).tap();
    await dormir(300);
    const enCola2 = await j.p.evaluate(() => JSON.parse(localStorage.getItem('wx_cola') || '[]').length);
    check('O02', enCola2 === 2, 'Llegó también es seguro sin conexión (idempotente en el dominio): a la cola');
    await j.p.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).tap();
    host = crearHost({ pool, puerto: PUERTO });
    await host.iniciar();
    await j.p.getByText(/Se enviaron 2 acciones guardadas sin conexión/).waitFor({ timeout: 25000 });
    const notaFinal = (await uno(`SELECT notes FROM dbo.appointments WHERE id = ${cSofia2}`)).notes || '';
    const ordenCita = (await uno(`SELECT service_order_id FROM dbo.appointments WHERE id = ${cSofia2}`)).service_order_id;
    const notasOrden = ordenCita ? (await uno(`SELECT COUNT(*) AS n FROM dbo.service_order_events WHERE order_id = ${ordenCita} AND detail LIKE N'%Trae foto de referencia%'`)).n : 0;
    check('O03', ((notaFinal.match(/Trae foto de referencia/g) || []).length + notasOrden) === 1 && ordenCita,
      'al volver la red, la cola se envía en orden, una sola vez (la nota y la llegada)');
    check('O03', await j.p.evaluate(() => JSON.parse(localStorage.getItem('wx_cola') || '[]').length) === 0, 'y la cola queda vacía');
    await j.p.getByRole('button', { name: 'Salir' }).tap();
    await j.p.getByText('Hola. ¿Quién eres?').waitFor({ timeout: 8000 });
    const limpio = await j.p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('wx_cache')).length === 0 && !document.body.innerText.includes('Andrea'));
    check('U02', limpio, 'al salir no queda nada de Sofía: ni en pantalla ni en la caché de la tablet');

    /* Mesero: salon, mesa, producto con opción obligatoria, enviar; sin cobro. */
    await pinDe({ userId: carlos }, '4826');
    const w = await abrirTablet('WAITER', 'Tablet meseros UI', { config: { areas: [salon] } });
    await entrarPin(w.p, 'carlos', '4826');
    await w.p.locator(`[data-mesa="${m2}"]`).waitFor({ timeout: 8000 });
    await foto(w.p, 'u-mesero-salon');
    await w.p.locator(`[data-mesa="${m2}"]`).tap();
    await w.p.locator(`[data-producto="${latte}"]`).tap();
    await w.p.getByRole('button', { name: /Avena/ }).tap();
    await w.p.getByRole('button', { name: 'Agregar a la orden' }).tap();
    await w.p.locator(`[data-producto="${sandwich}"]`).tap();
    await foto(w.p, 'u-mesero-mesa');
    await w.p.getByRole('button', { name: /Enviar a preparación/ }).tap();
    await w.p.getByText(/Enviado a (Barra y Cocina|Cocina y Barra)/).waitFor({ timeout: 8000 });
    const cuentaM2 = (await uno(`SELECT id FROM dbo.hosp_cuentas WHERE mesa_id = ${m2} AND estado = 'ABIERTA'`)).id;
    check('U03', (await uno(`SELECT COUNT(*) AS n FROM dbo.comandas WHERE cuenta_id = ${cuentaM2}`)).n === 2 && !(await w.p.getByRole('button', { name: /Cobrar/i }).count()),
      'Mesero en tablet: Mesa 2 → Latte con avena + Sandwich → Barra y Cocina; no hay botón de cobrar');

    /* Tecnico, Inventario y la pantalla publica: que pinten, sin errores. */
    await pinDe({ userId: luis }, '2468');
    const inv = await abrirTablet('INVENTORY_FLOOR', 'Piso UI', {}, 'Pixel 7');
    await entrarPin(inv.p, 'luis', '2468');
    await inv.p.locator('#buscar-producto').fill('7501055300075');
    await inv.p.locator('#buscar-producto').press('Enter');
    await inv.p.getByRole('dialog').waitFor({ timeout: 8000 });
    await foto(inv.p, 'u-inventario');
    check('U04', await inv.p.getByText('Coca-Cola 600 ml').first().isVisible() && await sinScroll(inv.p), 'Inventario en un teléfono: el código abre el producto con existencia y precio');

    const tv = await abrirTablet('CUSTOMER_STATUS', 'TV UI');
    await tv.p.setViewportSize({ width: 1920, height: 1080 });
    await tv.p.locator('.pub__listos').waitFor({ timeout: 8000 });
    await tv.p.emulateMedia({ colorScheme: 'light' });
    const fondoTv = await tv.p.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check('U05', fondoTv === 'rgb(10, 17, 25)', 'la TV es oscura siempre, aunque el sistema esté en claro', fondoTv);
    await foto(tv.p, 'u-pedidos');
    check('U05', !(await tv.p.getByRole('button', { name: 'Ajustes' }).count()) && await sinScroll(tv.p), 'Estado de pedidos: pantalla pública sin controles de trabajo, a 1920×1080');

    /* TV y telefono: la MISMA superficie y los mismos datos. Un pedido de
       María en preparacion; luego listo: los dos lo reflejan. */
    const deMaria = await uno(`EXEC dbo.sp_hosp_cuenta_abrir @etiqueta = N'Para llevar', @user_id = ${carlos}, @customer_id = ${maria}`);
    await q(`DECLARE @l dbo.HospOrdenLineaV2Type; INSERT INTO @l VALUES (1, ${sandwich}, 1, NULL, NEWID());
             DECLARE @o dbo.HospOrdenOpcionType; EXEC dbo.sp_hosp_orden_enviar @cuenta_id = ${deMaria.id}, @user_id = ${carlos}, @lineas = @l, @opciones = @o;`);
    const nM = String(deMaria.numero_dia);
    const movil = await (await navegador.newContext({ ...devices['iPhone 13'], baseURL: base })).newPage();
    movil.on('pageerror', e => errores.push(`tablero: ${e.message}`));
    await movil.goto('/pedidos');
    const enPrep = (p) => p.locator(`.pub__nums [data-pedido="${nM}"]`);
    await enPrep(movil).waitFor({ timeout: 8000 });
    await enPrep(tv.p).waitFor({ timeout: 12000 });
    const txtPrep = async (p) => (await enPrep(p).textContent()).replace(/\s+/g, ' ').trim();
    check('U10', (await txtPrep(tv.p)).includes(nM) && (await txtPrep(tv.p)).includes('María') && (await txtPrep(movil)).includes('María') && !(await movil.content()).includes('López'),
      'en preparación, TV y teléfono muestran el mismo número y el mismo primer nombre', `${await txtPrep(tv.p)} / ${await txtPrep(movil)}`);
    await foto(movil, 'u-tablero-movil-prep');
    await q(`UPDATE dbo.comandas SET estado = 'LISTA', empezada_en = SYSDATETIME(), lista_en = SYSDATETIME() WHERE cuenta_id = ${deMaria.id}`);
    const heroDe = (p) => p.locator(`.hero[data-pedido="${nM}"]`);
    await heroDe(tv.p).waitFor({ timeout: 15000 });
    await heroDe(movil).waitFor({ timeout: 12000 });
    check('U10', (await heroDe(tv.p).textContent()).includes('María') && (await heroDe(movil).textContent()).includes('María')
      && await sinScroll(movil) && await sinScroll(tv.p),
      'al quedar listo, los dos lo ponen en el hero «Acaba de estar listo» con su nombre');
    await foto(tv.p, 'u-pedidos-hero');
    await foto(movil, 'u-tablero-movil-listo');
    const filaMovil = await movil.locator('.muro__n').first().evaluate(e => getComputedStyle(e).flexDirection).catch(() => 'sin muro');
    check('U10', await movil.evaluate(() => window.innerWidth) < 500 && ['row', 'sin muro'].includes(filaMovil),
      'en el teléfono es una lista vertical, no el mural de la TV encogido', filaMovil);

    const tt = await abrirTablet('TECHNICIAN', 'Laptop taller UI');
    await tt.p.setViewportSize({ width: 1366, height: 768 });
    await entrarPin(tt.p, 'Carlos Técnico', '5813');
    await tt.p.locator(`[data-linea="${lNueva}"]`).waitFor({ timeout: 8000 });
    await foto(tt.p, 'u-tecnico');
    check('U06', await sinScroll(tt.p), 'Técnico en una laptop 1366×768');

    for (const esquema of ['dark', 'light']) {
      await tt.p.emulateMedia({ colorScheme: esquema });
      const fondo = await tt.p.evaluate(() => getComputedStyle(document.body).backgroundColor);
      check('U07', esquema === 'dark' ? fondo === 'rgb(10, 17, 25)' : fondo === 'rgb(242, 245, 249)', `tema ${esquema === 'dark' ? 'oscuro' : 'claro'} compartido`, fondo);
    }
    /* El telefono del cliente, tras escanear el QR: uno listo y uno en preparacion. */
    const otroLl = await uno(`EXEC dbo.sp_hosp_cuenta_abrir @etiqueta = N'Para llevar', @user_id = ${carlos}`);
    await q(`DECLARE @l dbo.HospOrdenLineaV2Type; INSERT INTO @l VALUES (1, ${sandwich}, 1, NULL, NEWID());
             DECLARE @o dbo.HospOrdenOpcionType; EXEC dbo.sp_hosp_orden_enviar @cuenta_id = ${otroLl.id}, @user_id = ${carlos}, @lineas = @l, @opciones = @o;`);
    const codOtro = String((await uno(`SELECT seguimiento FROM dbo.hosp_cuentas WHERE id = ${otroLl.id}`)).seguimiento).trim();
    const tel = await (await navegador.newContext({ ...devices['iPhone 13'], baseURL: base })).newPage();
    tel.on('pageerror', e => errores.push(`seguimiento: ${e.message}`));
    await tel.goto(`/p/${segCod}`);
    await tel.locator('.seg__tuyo.es-listo').waitFor({ timeout: 8000 });
    await foto(tel, 'u-seguimiento-listo');
    const listoOk = await tel.locator('.seg__num').textContent() === String(num) && await sinScroll(tel);
    await tel.goto(`/p/${codOtro}`);
    await tel.locator('.seg__tuyo.es-preparando').waitFor({ timeout: 8000 });
    await foto(tel, 'u-seguimiento-preparando');
    const marcado = await tel.locator('.seg__chips span.es-mio').textContent();
    await tel.emulateMedia({ colorScheme: 'light' });
    const fondoTel = await tel.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check('U09', listoOk && marcado === String(otroLl.numero_dia) && fondoTel === 'rgb(10, 17, 25)' && await sinScroll(tel),
      'en el teléfono del cliente: su número en grande, su estado, y el suyo marcado entre los demás', `${num} / ${marcado}`);
    check('U08', !errores.length, 'ninguna pantalla tuvo errores de JavaScript', errores.join(' | '));
  }

  /* Al final: agota el limite de consultas de 127.0.0.1. */
  let limitado = false;
  for (let i = 0; i < 70 && !limitado; i++) limitado = (await pedirCrudo(`/api/p/${'1'.repeat(32)}`, { puerto: PUERTO })).status === 429;
  check('K09', limitado, 'quien prueba códigos a ciegas se topa con el límite por IP');
} catch (e) {
  console.error('\nERROR', e.stack || e.message);
  check('Z', false, 'la prueba se interrumpió', e.message);
} finally {
  try { await navegador?.close(); } catch { /* noop */ }
  try { await host?.detener(); } catch { /* noop */ }
  try { await pool?.close(); } catch { /* noop */ }
  borrarBase(DB);
}

const { falla } = resumen({ grupos: { 'Core Local Host': 'C', Preparation: 'P', Waiter: 'W', 'Staff Day': 'S', Technician: 'T', 'Inventory Floor': 'I', 'Customer Status': 'K', Offline: 'O', Security: 'X', 'Internet/LAN': 'N', Pantalla: 'U' } });
process.exit(falla.length ? 1 : 0);
