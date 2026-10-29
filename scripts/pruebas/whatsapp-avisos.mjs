/**
 * AVISO POR WHATSAPP «PEDIDO LISTO» (0068), CONTRA UNA BASE DE VERDAD.
 *
 *     npm run test:whatsapp
 *     (node scripts/pruebas/correr-con-electron.mjs scripts/pruebas/whatsapp-avisos.mjs)
 *
 * Levanta una base temporal como nace una caja Hospitality, aplica las
 * migraciones (la 0068 dos veces: idempotente) y corre el modulo REAL
 * (electron/nube/whatsapp-avisos.js) con el driver de la aplicacion. La nube
 * es un doble que contesta como la funcion whatsapp-avisos y anota cada
 * llamada:
 *
 *   1. Una comanda en preparacion no avisa; al quedar LISTA, avisa UNA vez
 *      con el numero del dia y el telefono del cliente.
 *   2. Barrer otra vez, o dos barridos a la vez, no repite el aviso.
 *   3. Mesa, cliente sin telefono, pedido entregado sin pasar por listo y
 *      pedido listo hace mas de 20 minutos no avisan.
 *   4. Sin internet queda ERROR y el reintento usa el MISMO id (la nube no
 *      duplica); la baja del cliente (OPT_OUT) queda OMITIDO y no se reintenta.
 *   5. Con el aviso apagado no se le pregunta nada a la nube por pedido.
 *
 * Nunca toca una base existente: crea la suya y la borra al terminar.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { ejecutar, ejecutarVarios, restaurar, eliminar, exigirTemporal } from '../db/lib/temporal.mjs';
import { consultarTemporal } from '../db/lib/temporal-consulta.mjs';
import { SERVIDOR } from '../db/lib/sql.mjs';

const require = createRequire(import.meta.url);
const sql = require('mssql/msnodesqlv8');
const { crearAvisosWhatsapp } = require('../../electron/nube/whatsapp-avisos.js');

const DB = 'Wybix_TmpWhatsapp';
let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

function q(texto) {
  const r = consultarTemporal(DB, texto);
  if (!r.ok) throw new Error(r.error);
  return r.sets ?? [];
}
const uno = (texto) => (q(texto)[0] ?? [])[0] ?? {};
const escalar = (texto) => Object.values(uno(texto))[0];
const lotesDe = (ruta) => readFileSync(ruta, 'utf8').replace(/\r\n/g, '\n')
  .split(/\n\s*GO\s*\n/gi).map(x => x.trim()).filter(Boolean);

function nacer() {
  eliminar(DB);
  restaurar(DB, join(process.cwd(), 'installer', 'template.bak'));
  const dir = join(process.cwd(), 'electron', 'migrations');
  const archivos = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  const lotes = [...archivos, '0068_whatsapp-avisos.sql'].flatMap(f => lotesDe(join(dir, f)));
  const r = ejecutarVarios(DB, lotes);
  const malo = r.findIndex(x => !x.ok);
  if (malo >= 0) throw new Error(`migraciones, lote ${malo + 1}: ${r[malo].error}\n${lotes[malo].slice(0, 300)}`);
  ejecutar(DB, `EXEC dbo.sp_setup_inicial @usuario = N'avisos', @password = N'avisos1234',
      @business_name = N'I Do Nut QA', @business_profile = N'HOSPITALITY'`);
  for (const m of ['hospitality', 'mesas', 'comandas']) ejecutar(DB, `EXEC dbo.sp_set_business_module @module_key = N'${m}', @enabled = 1`);
}

/* La nube de mentira: contesta como whatsapp-avisos y anota lo que recibe. */
function nubeDoble() {
  const llamadas = [];
  const ids = new Map();      // id del aviso -> veces
  let modo = 'OK', encendido = true, conectado = true;
  const cuenta = () => (conectado ? { status: 'ACTIVA', telefono: '+52 55 0000 1234', nombre: 'I Do Nut', plantillas: {} } : null);
  return {
    llamadas, ids,
    set modo(m) { modo = m; }, set encendido(v) { encendido = v; }, set conectado(v) { conectado = v; },
    llamar: async (b) => {
      llamadas.push(b);
      if (b.action === 'config') return { success: true, config: { pedido_listo: encendido, membresia: false, dias_antes: 3, como_renovar: 'paga en caja' }, principal: true, cuenta: cuenta(), conectable: true };
      if (b.action === 'conexion') return { success: true, cuenta: cuenta(), principal: true, conectable: true, url: 'https://web.test/whatsapp/conectar#t=' + 'a'.repeat(64) };
      if (modo === 'OFFLINE') { const e = new Error('No hay conexión con Wybix en este momento.'); e.code = 'OFFLINE'; throw e; }
      if (modo === 'OPT_OUT') return { success: true, code: 'OPT_OUT', enviado: false, error: 'Este cliente pidió no recibir avisos por WhatsApp.' };
      if (modo === 'SIN_NUMERO') return { success: true, code: 'SIN_NUMERO', enviado: false, error: 'El WhatsApp del negocio no está conectado.' };
      const visto = ids.get(b.id) ?? 0;
      ids.set(b.id, visto + 1);
      return { success: true, code: visto ? 'YA' : 'ENCOLADO', enviado: true, message_id: 1, status: 'SENT' };
    },
  };
}

exigirTemporal(DB);
let pool = null;
try {
  nacer();
  pool = await new sql.ConnectionPool({
    server: SERVIDOR, database: DB, connectionTimeout: 8000, requestTimeout: 30000,
    options: { trustedConnection: true, trustServerCertificate: true, encrypt: false, enableArithAbort: true },
  }).connect();

  // ================================================================= SIEMBRA
  ejecutar(DB, `INSERT INTO dbo.CAT_categories (namee) VALUES (N'Donas'); INSERT INTO dbo.CAT_brands (namee) VALUES (N'Casa');`);
  const cat = escalar(`SELECT TOP 1 id FROM dbo.CAT_categories ORDER BY id DESC`);
  const marca = escalar(`SELECT TOP 1 id FROM dbo.CAT_brands ORDER BY id DESC`);
  ejecutar(DB, `EXEC dbo.sp_add_product @brand = ${marca}, @category = ${cat}, @part_number = N'DON', @name = N'Dona glaseada',
         @price = 25, @stock = 0, @inventory_mode = 'NONE', @sellable = 1`);
  const dona = escalar(`SELECT id FROM dbo.products WHERE part_number = N'DON'`);
  const barra = uno(`EXEC dbo.sp_prep_station_save @nombre = N'Barra'`).id;
  q(`EXEC dbo.sp_product_prep_set @product_id = ${dona}, @station_id = ${barra}`);
  ejecutar(DB, `INSERT INTO dbo.customers (customerName, phone) VALUES (N'Ana López', N'55 1234 5678'), (N'Sin teléfono', NULL);`);
  const ana = escalar(`SELECT id FROM dbo.customers WHERE customerName = N'Ana López'`);
  const sinTel = escalar(`SELECT id FROM dbo.customers WHERE customerName = N'Sin teléfono'`);

  const mostrador = (cliente, etiqueta) => uno(`EXEC dbo.sp_hosp_cuenta_abrir @etiqueta = N'${etiqueta}', @user_id = 1${cliente ? `, @customer_id = ${cliente}` : ''}`);
  const enviar = (cuenta) => (q(`
    DECLARE @l dbo.HospOrdenLineaV2Type; INSERT INTO @l (linea, product_id, cantidad, nota, origen) VALUES (1, ${dona}, 2, NULL, NULL);
    DECLARE @o dbo.HospOrdenOpcionType;
    EXEC dbo.sp_hosp_orden_enviar @cuenta_id = ${cuenta}, @user_id = 1, @lineas = @l, @opciones = @o;`)[1] || [])[0].id;
  const paso = (k, e) => q(`EXEC dbo.sp_comanda_estado @comanda_id = ${k}, @estado = '${e}'`);
  const bandera = (cuenta) => uno(`SELECT status, code, attempts, CONVERT(CHAR(36), id) AS id FROM dbo.whatsapp_pedido_avisos WHERE cuenta_id = ${cuenta}`);

  const nube = nubeDoble();
  const avisos = crearAvisosWhatsapp({
    pool: async () => pool, sql, llamar: nube.llamar, disponible: async () => true,
    urlDeSeguimiento: async () => ({ url: 'http://192.168.1.20:8787/p/0123456789ABCDEF0123456789ABCDEF' }),
  });
  const pedidos = () => nube.llamadas.filter(b => b.action === 'pedido_listo');

  // ================================================================== 1
  seccion('1. Del KDS al WhatsApp');
  const c1 = mostrador(ana, 'Ana');
  const k1 = enviar(c1.id);
  paso(k1, 'PREPARANDO');
  await avisos.revisar();
  check(pedidos().length === 0, 'en preparación todavía no se avisa');
  paso(k1, 'LISTA');
  const r1 = await avisos.revisar();
  const p1 = pedidos()[0];
  check(r1.avisados === 1 && pedidos().length === 1, 'al quedar LISTA se avisa una vez', JSON.stringify(r1));
  check(p1?.numero === c1.numero_dia && p1?.telefono === '55 1234 5678', 'con el número del día y el teléfono del cliente', `#${p1?.numero}`);
  check(/\/p\/[0-9A-F]{32}$/.test(p1?.url || ''), 'y el enlace de seguimiento del pedido');
  check(bandera(c1.id).status === 'ENVIADO' && bandera(c1.id).id.toLowerCase() === p1.id, 'la bandera queda ENVIADO con el id que viajó');

  // ================================================================== 2
  seccion('2. Sin duplicados');
  await avisos.revisar(); await avisos.revisar();
  check(pedidos().length === 1, 'barrer otra vez no repite el aviso');
  const c2 = mostrador(ana, 'Ana 2'); paso(enviar(c2.id), 'LISTA');
  /* Dos procesos (p. ej. la caja se reinició a medio barrido) sobre la misma
     base: la reserva en SQL deja pasar a uno solo. */
  const otro = crearAvisosWhatsapp({ pool: async () => pool, sql, llamar: nube.llamar, disponible: async () => true });
  await Promise.all([avisos.revisar(), otro.revisar(), avisos.revisar()]);
  check(pedidos().filter(b => b.numero === c2.numero_dia).length === 1, 'dos procesos barriendo a la vez mandan UN aviso');
  const reserva2 = uno(`EXEC dbo.sp_whatsapp_pedido_job @cuenta_id = ${c2.id}, @accion = 'RESERVAR'`);
  check(reserva2.resultado === 'YA', 'reservar un aviso ya enviado contesta YA');

  // ================================================================== 3
  seccion('3. Quién no se avisa');
  const mesaArea = uno(`EXEC dbo.sp_salon_area_save @nombre = N'Salón', @orden = 1`).id;
  const mesa = uno(`EXEC dbo.sp_salon_mesa_save @area_id = ${mesaArea}, @nombre = N'Mesa 1'`).id;
  const cMesa = uno(`EXEC dbo.sp_hosp_cuenta_abrir @mesa_id = ${mesa}, @user_id = 1, @customer_id = ${ana}`);
  paso(enviar(cMesa.id), 'LISTA');
  const cSin = mostrador(sinTel, 'Sin tel'); paso(enviar(cSin.id), 'LISTA');
  const cAnon = mostrador(null, 'Anónimo'); paso(enviar(cAnon.id), 'LISTA');
  const cEnt = mostrador(ana, 'Directo'); const kEnt = enviar(cEnt.id); paso(kEnt, 'LISTA'); paso(kEnt, 'ENTREGADA');
  const cViejo = mostrador(ana, 'Viejo'); const kViejo = enviar(cViejo.id); paso(kViejo, 'LISTA');
  ejecutar(DB, `UPDATE dbo.comandas SET lista_en = DATEADD(MINUTE, -25, SYSDATETIME()) WHERE id = ${kViejo}`);
  const antes = pedidos().length;
  await avisos.revisar();
  check(pedidos().length === antes, 'mesa, sin teléfono, sin cliente, ya entregado y listo hace 25 min: ninguno avisa');
  const cDos = mostrador(ana, 'Dos estaciones');
  const kA = enviar(cDos.id); const kB = enviar(cDos.id);
  paso(kA, 'LISTA');
  await avisos.revisar();
  check(pedidos().length === antes, 'con una comanda lista y otra pendiente todavía no se avisa');
  paso(kB, 'LISTA');
  await avisos.revisar();
  check(pedidos().length === antes + 1, 'cuando todas quedan listas, sí');

  // ================================================================== 4
  seccion('4. Sin internet y bajas');
  nube.modo = 'OFFLINE';
  const c4 = mostrador(ana, 'Offline'); paso(enviar(c4.id), 'LISTA');
  const r4 = await avisos.revisar();
  const b4 = bandera(c4.id);
  check(r4.errores === 1 && b4.status === 'ERROR', 'sin internet el aviso queda ERROR', b4.code);
  await avisos.revisar();
  check(bandera(c4.id).attempts === 1, 'y espera antes de reintentar (30 s por intento)');
  ejecutar(DB, `UPDATE dbo.whatsapp_pedido_avisos SET last_attempt_at = DATEADD(MINUTE, -5, last_attempt_at) WHERE cuenta_id = ${c4.id}`);
  nube.modo = 'OK';
  await avisos.revisar();
  const intentos = nube.llamadas.filter(b => b.action === 'pedido_listo' && b.numero === c4.numero_dia);
  check(bandera(c4.id).status === 'ENVIADO' && intentos.length === 2 && intentos[0].id === intentos[1].id,
    'el reintento sale con el MISMO id: la nube no puede duplicarlo');
  nube.modo = 'OPT_OUT';
  const c5 = mostrador(ana, 'Baja'); paso(enviar(c5.id), 'LISTA');
  await avisos.revisar();
  check(bandera(c5.id).status === 'OMITIDO' && bandera(c5.id).code === 'OPT_OUT', 'la baja del cliente queda OMITIDO');
  ejecutar(DB, `UPDATE dbo.whatsapp_pedido_avisos SET last_attempt_at = DATEADD(HOUR, -1, last_attempt_at) WHERE cuenta_id = ${c5.id}`);
  const n5 = pedidos().length;
  await avisos.revisar();
  check(pedidos().length === n5, 'y no se reintenta nunca');
  nube.modo = 'OK';

  // ================================================================== 5
  seccion('5. Apagado');
  nube.encendido = false;
  await avisos.leerConfig(true);
  const c6 = mostrador(ana, 'Apagado'); paso(enviar(c6.id), 'LISTA');
  const n6 = nube.llamadas.length;
  await avisos.revisar();
  check(nube.llamadas.length === n6 && !bandera(c6.id).status, 'con el aviso apagado no se llama a la nube ni se marca el pedido');
  nube.encendido = true;

  // ================================================================== 6
  seccion('6. El WhatsApp del negocio');
  nube.conectado = false;
  await avisos.leerConfig(true);
  const n7 = nube.llamadas.length;
  await avisos.revisar();
  check(nube.llamadas.length === n7 && !bandera(c6.id).status, 'encendido pero sin el número del negocio conectado: no se barre');
  const est = await avisos.conexion('estado');
  check(est.cuenta === null, 'la caja pregunta el estado de la conexión a la nube');
  nube.conectado = true;
  await avisos.conexion('estado');
  await avisos.revisar();
  check(bandera(c6.id).status === 'ENVIADO', 'al conectarse, el pedido que seguía listo se avisa');
  nube.modo = 'SIN_NUMERO';
  const c7 = mostrador(ana, 'Desconectado'); paso(enviar(c7.id), 'LISTA');
  await avisos.revisar();
  check(bandera(c7.id).status === 'OMITIDO' && bandera(c7.id).code === 'SIN_NUMERO', 'si la nube ya no tiene el número (Meta lo desconectó) queda OMITIDO, sin reintentos');
  nube.modo = 'OK';
} catch (e) {
  fallos++;
  console.log(`\n   ERROR  ${e.stack || e.message}`);
} finally {
  await pool?.close().catch(() => {});
  eliminar(DB);
}

console.log(`\n${pasos - fallos}/${pasos} comprobaciones${fallos ? `, ${fallos} FALLA(N)` : ''}`);
process.exit(fallos ? 1 : 0);
