/**
 * MULTISUCURSAL · pruebas unitarias del proceso principal (sin Electron, sin base, sin nube).
 *
 *     node scripts/pruebas/multisucursal-unidad.mjs
 *
 *   1. Sin el complemento no se publica, no se recibe y no se traspasa nada.
 *   2. La matriz publica solo si el catálogo cambió.
 *   3. La sucursal pide lo que tiene y aplica solo si hay algo nuevo.
 *   4. Un envío sin red queda hecho aquí y se sube en la siguiente sincronización.
 *   5. Un envío recibido o cancelado allá se cierra aquí; una recepción
 *      pendiente de subir se confirma.
 *   6. El candado: un producto de la matriz no se cambia en la sucursal.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { crearMultisucursal } = require('../../electron/nube/multisucursal.js');
const { motivoCandado, puedeCrearProductos } = require('../../electron/ipc/multisucursal.js');

let fallos = 0, total = 0;
const check = (ok, msg, det = '') => { total++; if (!ok) fallos++; console.log(`   ${ok ? 'ok   ' : 'FALLA'}  ${msg}${det ? '  · ' + det : ''}`); };
const seccion = (t) => console.log(`\n-- ${t}`);

/** SQL simulado: responde por procedimiento o por texto de consulta. */
function base({ meta = {}, export_json = '{"products":[]}', locales = [], lineas = {}, producto = null } = {}) {
  const ejecutados = [];
  const pedir = () => {
    const ins = {};
    const r = {
      input(n, _t, v) { ins[n] = v; return r; },
      async execute(sp) {
        ejecutados.push({ sp, ins: { ...ins } });
        if (sp === 'sp_corporate_catalog_export') return { recordset: [{ catalog_json: export_json }] };
        if (sp === 'sp_corporate_catalog_apply') return { recordset: [{ nuevos: 2, actualizados: 1, desactivados: 0, usuarios: 1, avisos: null }] };
        if (sp === 'sp_branch_transfer_send') return { recordsets: [[{ transfer_uuid: ins.transfer_uuid }], [{ product_uuid: 'p1', nombre: 'Dona', qty: 12 }]] };
        return { recordset: [] };
      },
      async query(q) {
        ejecutados.push({ q, ins: { ...ins } });
        if (/database_metadata WHERE clave IN/.test(q)) return { recordset: Object.entries(meta).map(([clave, valor]) => ({ clave, valor })) };
        if (/FROM dbo.stock_transfers t LEFT JOIN/.test(q)) return { recordset: locales };
        if (/FROM dbo.stock_transfer_lines/.test(q)) return { recordset: lineas[ins.id] ?? [] };
        if (/FROM dbo.products p WHERE p.id = @id/.test(q)) return { recordset: producto ? [producto] : [] };
        if (/AS reglas,/.test(q)) return { recordset: [{ reglas: meta.multi_reglas ?? null, version: meta.multi_version ?? null }] };
        return { recordset: [] };
      },
    };
    return r;
  };
  return { pool: async () => ({ request: pedir }), ejecutados };
}

function nube(respuestas = {}) {
  const llamadas = [];
  const llamar = async (accion, cuerpo = {}) => {
    llamadas.push({ accion, cuerpo });
    const r = typeof respuestas[accion] === 'function' ? respuestas[accion](cuerpo) : respuestas[accion];
    if (r instanceof Error) throw r;
    return r ?? { ok: true };
  };
  return { llamar, llamadas };
}

function config(inicial = {}) {
  let c = { ...inicial };
  return { leer: () => c, escribir: (p) => { c = { ...c, ...p }; } };
}

const sql = { Int: 'Int', NVarChar: () => 'NVarChar', VarChar: () => 'VarChar', UniqueIdentifier: 'Uid', MAX: -1 };

seccion('1. Sin MultiSucursal no pasa nada');
{
  const b = base(), n = nube({ multi_estado: { multisucursal: false, es_matriz: true } });
  const m = crearMultisucursal({ pool: b.pool, sql, llamar: n.llamar, cfg: config() });
  const r = await m.sincronizar();
  check(r.activo === false, 'el ciclo de fondo no hace nada');
  check(!n.llamadas.some((l) => /publicar|recibir|traspaso/.test(l.accion)), 'ni publica, ni recibe, ni traspasa');
}

seccion('2. La matriz publica solo lo que cambió');
{
  const b = base({ export_json: '{"products":[{"uuid":"p1","nombre":"Dona"}]}' });
  const n = nube({ multi_estado: { multisucursal: true, es_matriz: true }, multi_publicar: { ok: true, version: 3 }, multi_traspaso_bandeja: { entrantes: [], enviados: [] } });
  const c = config();
  const m = crearMultisucursal({ pool: b.pool, sql, llamar: n.llamar, cfg: c });
  const r1 = await m.sincronizar();
  check(r1.catalogo?.publicado && r1.catalogo.version === 3, 'primera vez: publica', JSON.stringify(r1.catalogo));
  const r2 = await m.sincronizar();
  check(r2.catalogo?.publicado === false && n.llamadas.filter((l) => l.accion === 'multi_publicar').length === 1, 'sin cambios: no vuelve a subir');
  const r3 = await m.publicar({ forzar: true });
  check(r3.publicado, '«Publicar ahora» sube aunque no haya cambios');
  check(!b.ejecutados.some((e) => e.sp === 'sp_corporate_catalog_apply'), 'la matriz nunca aplica su propio catálogo');
}

seccion('3. La sucursal recibe y aplica');
{
  const b = base({ meta: { multi_version: '2', multi_overrides_revision: '5' } });
  const n = nube({ multi_recibir: (c) => ({ ok: true, es_matriz: false, location_id: 'loc-n', version: 3, catalog: { products: [] }, overrides: null, overrides_revision: 5, reglas: { precios_sucursal: false } }) });
  const m = crearMultisucursal({ pool: b.pool, sql, llamar: n.llamar, cfg: config() });
  const r = await m.recibir();
  const pedido = n.llamadas.find((l) => l.accion === 'multi_recibir').cuerpo;
  check(pedido.version === 2 && pedido.overrides_revision === 5, 'pide desde lo que ya tiene', JSON.stringify(pedido));
  const ap = b.ejecutados.find((e) => e.sp === 'sp_corporate_catalog_apply');
  check(r.aplicado && ap?.ins.version === 3 && ap.ins.location_id === 'loc-n' && ap.ins.overrides === null, 'aplica la versión nueva con su sucursal; excepciones sin cambio = null');

  const b2 = base({ meta: { multi_version: '3', multi_overrides_revision: '5' } });
  const n2 = nube({ multi_recibir: { ok: true, es_matriz: false, version: 3, catalog: null, overrides: null, overrides_revision: 5, reglas: {} } });
  const r2 = await crearMultisucursal({ pool: b2.pool, sql, llamar: n2.llamar, cfg: config() }).recibir();
  check(r2.aplicado === false && !b2.ejecutados.some((e) => e.sp === 'sp_corporate_catalog_apply'), 'al día: no toca la base');

  const b3 = base({ meta: { multi_version: '3', multi_overrides_revision: '5' } });
  const n3 = nube({ multi_recibir: { ok: true, es_matriz: false, version: 3, catalog: null, overrides: [{ product_uuid: 'p1', price: 29, available: true }], overrides_revision: 6, reglas: {} } });
  await crearMultisucursal({ pool: b3.pool, sql, llamar: n3.llamar, cfg: config() }).recibir();
  const ap3 = b3.ejecutados.find((e) => e.sp === 'sp_corporate_catalog_apply');
  check(ap3 && ap3.ins.catalog === null && JSON.parse(ap3.ins.overrides)[0].price === 29 && ap3.ins.version === 3, 'solo cambiaron sus precios: aplica eso, sin catálogo');
}

seccion('4. Un envío sin red queda hecho y se sube después');
{
  const b = base(), sinRed = Object.assign(new Error('No hay conexión con Wybix en este momento.'), { code: 'OFFLINE' });
  const n = nube({ multi_traspaso_enviar: sinRed });
  const m = crearMultisucursal({ pool: b.pool, sql, llamar: n.llamar, cfg: config() });
  const r = await m.enviarTraspaso({ userId: 1, toLocationId: 'loc-n', toNombre: 'Norte', lineas: [{ product_uuid: 'p1', qty: 12 }] });
  check(b.ejecutados.some((e) => e.sp === 'sp_branch_transfer_send') && r.enNube === false, 'la existencia baja aquí aunque no haya red');

  const b2 = base({ locales: [{ id: r.id, kind: 'BRANCH_OUT', status: 'SENT', otra: 'loc-n', note: null, por: 'lupita' }],
    lineas: { [r.id]: [{ product_uuid: 'p1', nombre: 'Dona', qty: 12 }] } });
  const n2 = nube({ multi_traspaso_bandeja: { entrantes: [], enviados: [] } });
  await crearMultisucursal({ pool: b2.pool, sql, llamar: n2.llamar, cfg: config() }).sincronizarTraspasos();
  const subido = n2.llamadas.find((l) => l.accion === 'multi_traspaso_enviar');
  check(subido?.cuerpo.id === r.id && subido.cuerpo.lines[0].qty === 12 && subido.cuerpo.sent_by_name === 'lupita', 'la siguiente sincronización lo sube con el mismo id');
}

seccion('5. Cerrar envíos y confirmar recepciones pendientes');
{
  const b = base({
    locales: [
      { id: 'out-1', kind: 'BRANCH_OUT', status: 'SENT', otra: 'loc-n' },
      { id: 'out-2', kind: 'BRANCH_OUT', status: 'SENT', otra: 'loc-n' },
      { id: 'in-1', kind: 'BRANCH_IN', status: 'RECEIVED', otra: 'loc-m' },
    ],
    lineas: { 'in-1': [{ product_uuid: 'p1', nombre: 'Dona', qty: 12, qty_received: 11 }] },
  });
  const n = nube({ multi_traspaso_bandeja: {
    enviados: [{ id: 'out-1', status: 'RECEIVED', received_lines: [{ product_uuid: 'p1', qty: 11 }] }, { id: 'out-2', status: 'CANCELLED' }],
    entrantes: [{ id: 'in-1', from_nombre: 'Matriz', lines: [] }, { id: 'in-2', from_nombre: 'Matriz', lines: [] }],
  } });
  const r = await crearMultisucursal({ pool: b.pool, sql, llamar: n.llamar, cfg: config() }).sincronizarTraspasos();
  const liq = b.ejecutados.filter((e) => e.sp === 'sp_branch_transfer_settle').map((e) => `${e.ins.transfer_uuid}:${e.ins.status}`);
  check(liq.includes('out-1:RECEIVED') && liq.includes('out-2:CANCELLED'), 'lo recibido y lo cancelado allá se cierra aquí', liq.join(', '));
  const conf = n.llamadas.find((l) => l.accion === 'multi_traspaso_recibir');
  check(conf?.cuerpo.id === 'in-1' && conf.cuerpo.received_lines[0].qty === 11, 'la recepción hecha aquí sin red se confirma con lo que llegó');
  check(r.porRecibir.length === 1 && r.porRecibir[0].id === 'in-2', 'la pantalla solo ve lo que de verdad falta recibir');
}

seccion('6. El candado de los productos de la matriz');
{
  const prod = { corporate: 1, nombre: 'Dona glaseada', part_number: 'DON-GLA', bar_code: null, price: 25, clave_prod_serv: null,
    clave_unidad: null, objeto_impuesto: '02', tasa_iva: 0.16, inventory_mode: 'NONE', sellable: 1, base_uom: 'pza', reglas: '{"precios_sucursal":false}' };
  const p1 = (await base({ producto: prod }).pool());
  check(/el nombre/.test(await motivoCandado(p1, sql, 1, { nombre: 'Dona rosa', part_number: 'DON-GLA', price: 25 })), 'no se renombra en la sucursal');
  check(/el precio/.test(await motivoCandado(p1, sql, 1, { nombre: 'Dona glaseada', part_number: 'DON-GLA', price: 30 })), 'ni se cambia el precio si la empresa no lo permite');
  check(await motivoCandado(p1, sql, 1, { nombre: 'Dona glaseada', part_number: 'DON-GLA', price: 25 }) === null, 'existencia y costo sí (los demás campos iguales)');
  const p2 = (await base({ producto: { ...prod, reglas: '{"precios_sucursal":true}' } }).pool());
  check(await motivoCandado(p2, sql, 1, { nombre: 'Dona glaseada', part_number: 'DON-GLA', price: 30 }) === null, 'con permiso de la empresa, el precio sí');
  const p3 = (await base({ producto: { ...prod, corporate: 0 } }).pool());
  check(await motivoCandado(p3, sql, 1, { nombre: 'Otra cosa', price: 99 }) === null, 'un producto propio de la sucursal no tiene candado');
  check(await puedeCrearProductos(await base({ meta: { multi_version: '3', multi_reglas: '{"productos_locales":false}' } }).pool()) === false, 'sin permiso, la sucursal no da de alta productos');
  check(await puedeCrearProductos(await base({ meta: {} }).pool()) === true, 'la matriz (o sin MultiSucursal) sí');
}

console.log(`\nRESULTADO: ${fallos ? fallos + ' FALLO(S)' : 'TODO BIEN'} · ${total - fallos}/${total}`);
process.exit(fallos ? 1 : 0);
