/**
 * Menú en línea: pedidos para recoger (0067).
 *
 *     node scripts/db/pruebas/menu-en-linea.mjs [--conservar]
 *
 * QUE COMPRUEBA
 * -------------
 *   1. La configuración: dirección corta válida, no se publica sin ella.
 *   2. Recibir un pedido es idempotente (bajarlo dos veces no lo duplica) y
 *      NO abre cuenta, NO crea comanda, NO toca inventario.
 *   3. Aceptar abre una cuenta sin mesa con número del día y seguimiento; las
 *      líneas devueltas, enviadas por sp_hosp_orden_enviar con su uuid como
 *      origen, crean la comanda (KDS) una sola vez aunque se reintente.
 *   4. El estado que ve el cliente sale de las comandas: RECIBIDO, PREPARANDO,
 *      LISTO, ENTREGADO (al cobrar), y solo se publica lo que cambió.
 *   5. Aceptar sigue sin descontar inventario; cobrar sí.
 *   6. Rechazar exige motivo; un pedido decidido no se vuelve a decidir.
 *   7. Un producto que ya no se vende deja el pedido PENDIENTE.
 *   8. Revertir una aceptación que no llegó a cocina la deshace.
 *
 * Corre sobre una restauracion del baseline, no sobre ninguna base de trabajo.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { restaurar, eliminar } from '../lib/temporal.mjs';
import { consultarTemporal } from '../lib/temporal-consulta.mjs';
import { limpiar } from './lib.mjs';

const BAK = join('installer', 'template.bak');
const DIR_MIG = join('electron', 'migrations');
const DB = 'Wybix_TmpMenuEnLinea';
const CONSERVAR = process.argv.includes('--conservar');

let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);
const sets = (sql) => { const r = consultarTemporal(DB, sql); if (!r.ok) throw new Error(limpiar(r.error)); return r.sets; };
const q = (sql) => { const s = sets(sql); return s.length ? s[s.length - 1] : []; };
const uno = (sql) => q(sql)[0] ?? null;
const escalar = (sql) => { const f = uno(sql); return f ? f[Object.keys(f)[0]] : null; };
const n = (v) => Number(v ?? 0);
const falla = (sql, frag) => {
  const r = consultarTemporal(DB, sql);
  if (r.ok) return { ok: false, error: null };
  const msg = limpiar(r.error);
  return { ok: frag ? msg.includes(frag) : true, error: msg };
};
const txt = (s) => String(s).replace(/'/g, "''");

/** Lo que hace salon.js#enviarOrden con las líneas que devuelve aceptar. */
function enviar(cuenta, lineas) {
  const l = lineas.map((x, i) => `(${i + 1}, ${x.product_id}, ${x.cantidad}, ${x.nota ? `N'${txt(x.nota)}'` : 'NULL'}, '${x.origen}')`).join(', ');
  const o = lineas.flatMap((x, i) => JSON.parse(x.opciones || '[]').map((op) => `(${i + 1}, ${op.option_id}, ${op.quantity || 1})`)).join(', ');
  return sets(`DECLARE @l dbo.HospOrdenLineaV2Type, @o dbo.HospOrdenOpcionType;
    INSERT INTO @l VALUES ${l};
    ${o ? `INSERT INTO @o VALUES ${o};` : ''}
    EXEC dbo.sp_hosp_orden_enviar @cuenta_id = ${cuenta}, @user_id = 1, @lineas = @l, @opciones = @o;`);
}

function recibir(p) {
  return uno(`EXEC dbo.sp_pedido_en_linea_recibir @uuid = '${p.uuid}', @origen = N'${p.origen ?? 'MOSTRADOR'}',
    @cliente_nombre = N'${txt(p.nombre)}', @cliente_telefono = N'${p.telefono}', @nota = ${p.nota ? `N'${txt(p.nota)}'` : 'NULL'},
    @lineas = N'${txt(JSON.stringify(p.lineas))}', @total_cliente = ${p.total}, @creado_en_nube = '2026-10-28T12:00:00';`);
}

try {
  console.log(`\nMENÚ EN LÍNEA   (${DB})`);
  if (!existsSync(BAK)) { console.log(`   ----   falta ${BAK}`); process.exit(0); }
  restaurar(DB, BAK);
  const aplicadas = new Set(q('SELECT filename FROM dbo.schema_migrations;').map(r => r.filename));
  for (const f of readdirSync(DIR_MIG, { withFileTypes: true }).filter(d => d.isFile() && d.name.toLowerCase().endsWith('.sql'))
      .map(d => d.name).sort((a, b) => a.localeCompare(b, 'en')).filter(f => !aplicadas.has(f))) {
    for (const lote of readFileSync(join(DIR_MIG, f), 'utf8').replace(/\r\n/g, '\n').split(/\n\s*GO\s*\n/gi)) if (lote.trim()) q(lote);
    q(`INSERT INTO dbo.schema_migrations (filename) VALUES (N'${f}');`);
  }
  /* Reaplicar 0067 y 0070, en orden, no rompe nada (idempotentes). */
  for (const f of ['0067_menu-en-linea.sql', '0070_menu-diseno.sql'])
    for (const lote of readFileSync(join(DIR_MIG, f), 'utf8').replace(/\r\n/g, '\n').split(/\n\s*GO\s*\n/gi)) if (lote.trim()) q(lote);

  /* ---------------------------------------------------- el mundo */
  q(`INSERT INTO dbo.users (usuario, password_hash, rol, active, creation_date) VALUES (N'qa_caja', N'x', N'admin', 1, GETDATE());
     INSERT INTO dbo.CAT_brands (namee) VALUES (N'QA'); INSERT INTO dbo.CAT_categories (namee) VALUES (N'Cafés');`);
  const u = n(escalar(`SELECT id FROM dbo.users WHERE usuario = N'qa_caja'`));
  const brand = n(escalar(`SELECT TOP 1 id FROM dbo.CAT_brands ORDER BY id DESC`));
  const cat = n(escalar(`SELECT id FROM dbo.CAT_categories WHERE namee = N'Cafés'`));
  const alta = (pn, nombre, precio, stock) => n(escalar(`EXEC dbo.sp_add_product @brand=${brand}, @part_number=N'${pn}', @name=N'${nombre}',
      @price=${precio}, @stock=${stock}, @category=${cat}, @inventory_mode='DIRECT', @sellable=1, @base_uom='pza', @allow_decimal_qty=0, @cost=10;`));
  const latte = alta('ML-LATTE', 'Latte', 55, 40);
  const dona = alta('ML-DONA', 'Dona glaseada', 25, 30);
  const tam = uno(`DECLARE @o dbo.ModifierOptionType;
    INSERT INTO @o (name, price_delta, effect, qty_factor, sort_order) VALUES (N'Chico', 0, 'NONE', NULL, 1), (N'Grande', 10, 'NONE', NULL, 2);
    EXEC dbo.sp_save_modifier_group @name=N'Tamaño', @role='SIZE', @min_select=1, @max_select=1, @required=1, @Options=@o;`).group_id;
  const grande = n(escalar(`SELECT id FROM dbo.modifier_options WHERE group_id = ${tam} AND name = N'Grande'`));
  q(`INSERT INTO dbo.product_modifier_groups (product_id, group_id, sort_order) VALUES (${latte}, ${tam}, 1);`);
  const barra = n(uno(`EXEC dbo.sp_prep_station_save @nombre = N'Barra', @salida = 'PANTALLA'`).id);
  q(`EXEC dbo.sp_product_prep_set @product_id = ${latte}, @station_id = ${barra}; EXEC dbo.sp_product_prep_set @product_id = ${dona}, @station_id = ${barra};`);
  q(`EXEC dbo.sp_open_shift @user_id=${u}, @opening_cash=500, @register_id=1;`);
  const stock = (id) => n(escalar(`SELECT stock FROM dbo.products WHERE id = ${id}`));

  // ================================================================ 1
  seccion('1. Configuración');
  check(falla(`EXEC dbo.sp_menu_en_linea_config @guardar=1, @activo=1, @slug=NULL`, 'Elige la direcci').ok, 'no se publica sin dirección');
  check(falla(`EXEC dbo.sp_menu_en_linea_config @guardar=1, @slug=N'Mi Café!'`, 'de 3 a 40 letras').ok, 'la dirección solo lleva minúsculas, números y guiones');
  const cfg = uno(`EXEC dbo.sp_menu_en_linea_config @guardar=1, @activo=1, @slug=N'Cafe-Centro', @minutos_estimados=12, @user_id=${u}`);
  check(cfg.activo === true && cfg.slug === 'cafe-centro' && n(cfg.minutos_estimados) === 12, 'se guarda (en minúsculas)', cfg.slug);

  // ================================================================ 2
  seccion('2. Recibir');
  const ped = {
    uuid: randomUUID(), nombre: 'Ana Ruiz', telefono: '4771234567', nota: 'sin popote', total: 105,
    lineas: [
      { uuid: randomUUID(), product_id: latte, nombre: 'Latte', cantidad: 1, precio: 55, opciones: [{ option_id: grande, nombre: 'Grande', quantity: 1, price_delta: 10 }] },
      { uuid: randomUUID(), product_id: dona, nombre: 'Dona glaseada', cantidad: 2, precio: 25, nota: 'calientitas', opciones: [] },
    ],
  };
  const r1 = recibir(ped), r2 = recibir(ped);
  check(r1.nuevo === true && r2.nuevo === false && n(r1.id) === n(r2.id), 'bajarlo dos veces no lo duplica');
  check(n(escalar(`SELECT COUNT(*) FROM dbo.pedidos_en_linea`)) === 1, 'una sola fila');
  check(n(escalar(`SELECT COUNT(*) FROM dbo.hosp_cuentas`)) === 0 && n(escalar(`SELECT COUNT(*) FROM dbo.comandas`)) === 0,
    'recibir no abre cuenta ni crea comanda');
  check(stock(latte) === 40 && stock(dona) === 30, 'ni toca inventario');
  check(falla(`EXEC dbo.sp_pedido_en_linea_recibir @uuid='${randomUUID()}', @cliente_nombre=N'x', @cliente_telefono=N'1', @lineas=N'[]', @total_cliente=0`, 'no trae productos').ok,
    'un pedido vacío no entra');
  let lista = q(`EXEC dbo.sp_pedidos_en_linea_listar`);
  check(lista.length === 1 && lista[0].estado_cliente === 'RECIBIDO', 'la bandeja lo enseña RECIBIDO');
  check(Number(lista[0].minutos_espera) <= 1, 'la espera sale de SQL, sin desfase de zona horaria (no las 6 h del UTC)', `${lista[0].minutos_espera} min`);
  let pub = q(`EXEC dbo.sp_pedidos_en_linea_listar @por_publicar = 1`);
  check(pub.length === 1 && pub[0].estado_cliente === 'RECIBIDO', 'y está por publicarse a la nube');
  q(`EXEC dbo.sp_pedido_en_linea_publicado @uuid='${ped.uuid}', @estado=N'RECIBIDO'`);
  check(q(`EXEC dbo.sp_pedidos_en_linea_listar @por_publicar = 1`).length === 0, 'publicado: ya no se reenvía');

  // ================================================================ 3
  seccion('3. Aceptar y mandar a cocina');
  /* Una cuenta de mostrador anterior: el número del día sigue la misma serie. */
  q(`EXEC dbo.sp_hosp_cuenta_abrir @etiqueta = N'Mostrador', @user_id = ${u}, @register_id = 1;`);
  const acep = sets(`EXEC dbo.sp_pedido_en_linea_aceptar @id = ${r1.id}, @user_id = ${u}, @register_id = 1;`);
  const cab = acep[0][0], lineas = acep[1];
  check(cab && n(cab.numero_dia) === 2, 'abre una cuenta con el siguiente número del día', `#${cab?.numero_dia}`);
  const cuenta = uno(`SELECT etiqueta, mesa_id, estado, seguimiento FROM dbo.hosp_cuentas WHERE id = ${cab.cuenta_id}`);
  check(cuenta.mesa_id == null && cuenta.estado === 'ABIERTA' && /^[0-9A-F]{32}$/.test(String(cuenta.seguimiento).trim()) && cuenta.etiqueta === 'En línea · Ana Ruiz',
    'sin mesa, abierta, con código de seguimiento y etiqueta de origen', cuenta.etiqueta);
  check(lineas.length === 2 && lineas.every(l => l.origen), 'devuelve las líneas con su uuid como origen');
  const e1 = enviar(cab.cuenta_id, lineas);
  check(n(e1[0][0].comandas) === 1 && n(e1[0][0].lineas) === 2, 'enviar crea la comanda de Barra con sus dos líneas');
  const opc = uno(`SELECT o.option_name, o.price_delta FROM dbo.hosp_orden_linea_opciones o JOIN dbo.hosp_orden_lineas l ON l.id = o.linea_id WHERE l.cuenta_id = ${cab.cuenta_id}`);
  check(opc?.option_name === 'Grande' && Number(opc.price_delta) === 10, 'el modificador llega a cocina igual que desde la caja');
  /* Reintento completo: aceptar otra vez + enviar otra vez. */
  const acep2 = sets(`EXEC dbo.sp_pedido_en_linea_aceptar @id = ${r1.id}, @user_id = ${u}, @register_id = 1;`);
  check(n(acep2[0][0].cuenta_id) === n(cab.cuenta_id), 'aceptar dos veces devuelve la misma cuenta');
  const e2 = enviar(cab.cuenta_id, acep2[1]);
  check(n(e2[0][0].lineas) === 0 && n(escalar(`SELECT COUNT(*) FROM dbo.comandas WHERE cuenta_id = ${cab.cuenta_id}`)) === 1,
    'y reenviar no duplica nada en cocina');
  const kds = sets(`EXEC dbo.sp_kds_get @station_id = ${barra}, @comanda_id = NULL;`);
  check((kds[0] || []).some(c => n(c.numero_dia) === 2), 'el KDS de Barra lo enseña con su número');
  check(stock(latte) === 40 && stock(dona) === 30, 'aceptar NO descuenta inventario');

  // ================================================================ 4
  seccion('4. El estado que ve el cliente');
  const est = () => uno(`EXEC dbo.sp_pedidos_en_linea_listar @id = ${r1.id}`).estado_cliente;
  check(est() === 'PREPARANDO', 'con la comanda NUEVA: PREPARANDO');
  pub = q(`EXEC dbo.sp_pedidos_en_linea_listar @por_publicar = 1`);
  check(pub.length === 1 && pub[0].estado_cliente === 'PREPARANDO' && n(pub[0].numero_dia) === 2, 'por publicar, con su número del día');
  q(`EXEC dbo.sp_pedido_en_linea_publicado @uuid='${ped.uuid}', @estado=N'PREPARANDO'`);
  const comanda = n(escalar(`SELECT id FROM dbo.comandas WHERE cuenta_id = ${cab.cuenta_id}`));
  q(`EXEC dbo.sp_comanda_estado @comanda_id = ${comanda}, @estado = 'LISTA', @user_id = ${u};`);
  check(est() === 'LISTO', 'la cocina la marca lista: LISTO');
  check(q(`EXEC dbo.sp_pedidos_en_linea_listar @por_publicar = 1`)[0]?.estado_cliente === 'LISTO', 'y se publica el cambio');

  // ================================================================ 5
  seccion('5. Cobrar al recoger');
  const venta = uno(`DECLARE @d1 dbo.SaleDetailType; DECLARE @d2 dbo.SaleDetailType2; DECLARE @mo dbo.SaleModifierType;
    INSERT INTO @d2 (line_no, product_id, quantity, unit_price) VALUES (1, ${latte}, 1, 65), (2, ${dona}, 2, 25);
    INSERT INTO @mo (line_no, modifier_option_id, quantity) VALUES (1, ${grande}, 1);
    EXEC dbo.sp_register_sale @user_id=${u}, @payment_method=N'EFECTIVO', @SaleDetails=@d1, @register_id=1, @SaleDetails2=@d2, @SaleModifiers=@mo;`);
  const saleId = n(venta?.sale_id ?? venta?.id ?? venta?.SaleId ?? Object.values(venta || {})[0]);
  q(`EXEC dbo.sp_hosp_cuenta_cobrar @cuenta_id = ${cab.cuenta_id}, @sale_id = ${saleId}, @user_id = ${u};`);
  check(stock(latte) === 39 && stock(dona) === 28, 'el inventario baja al cobrar, no antes', `latte ${stock(latte)}, dona ${stock(dona)}`);
  check(est() === 'ENTREGADO', 'cobrada la cuenta: ENTREGADO');

  // ================================================================ 6
  seccion('6. Rechazar');
  const p2 = { ...ped, uuid: randomUUID(), nombre: 'Luis', lineas: [{ ...ped.lineas[1], uuid: randomUUID() }], total: 50 };
  const r3 = recibir(p2);
  check(falla(`EXEC dbo.sp_pedido_en_linea_rechazar @id = ${r3.id}, @motivo = N'  '`, 'motivo').ok, 'sin motivo no se rechaza');
  const rech = uno(`EXEC dbo.sp_pedido_en_linea_rechazar @id = ${r3.id}, @motivo = N'Se nos acabaron las donas', @user_id = ${u}`);
  check(rech.estado === 'RECHAZADO', 'con motivo, sí');
  check(uno(`EXEC dbo.sp_pedidos_en_linea_listar @id = ${r3.id}`).estado_cliente === 'RECHAZADO', 'el cliente lo ve RECHAZADO');
  check(falla(`EXEC dbo.sp_pedido_en_linea_aceptar @id = ${r3.id}`, 'ya se rechaz').ok, 'un rechazado no se acepta');
  check(falla(`EXEC dbo.sp_pedido_en_linea_rechazar @id = ${r1.id}, @motivo = N'x'`, 'ya se acept').ok, 'un aceptado no se rechaza');

  // ================================================================ 7
  seccion('7. Producto que ya no se vende');
  const agotado = alta('ML-TEMP', 'Pan de muerto', 40, 5);
  const r4 = recibir({ ...ped, uuid: randomUUID(), lineas: [{ uuid: randomUUID(), product_id: agotado, cantidad: 1, precio: 40, opciones: [] }], total: 40 });
  q(`UPDATE dbo.products SET active = 0 WHERE id = ${agotado}`);
  const cuentasAntes = n(escalar(`SELECT COUNT(*) FROM dbo.hosp_cuentas`));
  check(falla(`EXEC dbo.sp_pedido_en_linea_aceptar @id = ${r4.id}`, 'productos del pedido ya no').ok, 'aceptar lo detiene');
  check(uno(`SELECT estado FROM dbo.pedidos_en_linea WHERE id = ${r4.id}`).estado === 'PENDIENTE'
     && n(escalar(`SELECT COUNT(*) FROM dbo.hosp_cuentas`)) === cuentasAntes, 'sigue PENDIENTE y sin cuenta');

  // ================================================================ 8
  seccion('8. Revertir lo que no llegó a cocina');
  const r5 = recibir({ ...ped, uuid: randomUUID(), lineas: [{ uuid: randomUUID(), product_id: dona, cantidad: 1, precio: 25, opciones: [] }], total: 25 });
  const a5 = sets(`EXEC dbo.sp_pedido_en_linea_aceptar @id = ${r5.id}, @user_id = ${u}`)[0][0];
  const rev = uno(`EXEC dbo.sp_pedido_en_linea_revertir @id = ${r5.id}, @user_id = ${u}`);
  check(rev.revertido === true, 'sin líneas enviadas, se revierte');
  check(uno(`SELECT estado, cuenta_id FROM dbo.pedidos_en_linea WHERE id = ${r5.id}`).estado === 'PENDIENTE'
     && uno(`SELECT estado FROM dbo.hosp_cuentas WHERE id = ${a5.cuenta_id}`).estado === 'CANCELADA', 'el pedido vuelve a PENDIENTE y la cuenta se cancela');
  check(uno(`EXEC dbo.sp_pedido_en_linea_revertir @id = ${r1.id}`).revertido === false, 'uno que ya está en cocina no se revierte');

  // ================================================================ 9
  seccion('9. Diseño del menú (0070)');
  const dis = uno(`EXEC dbo.sp_menu_en_linea_config @diseno = 1, @color = N'#D0466C', @acento = N'#f6b8c8', @frase = N'Las donas, amordidas',
    @direccion = N'Av. Juárez 120, Centro', @horario = N'Lun a sáb · 8:00 a 21:00'`);
  check(dis.color === '#d0466c' && dis.frase === 'Las donas, amordidas' && dis.slug === 'cafe-centro', 'guarda colores (en minúsculas), frase y horario sin tocar la publicación');
  check(falla(`EXEC dbo.sp_menu_en_linea_config @diseno = 1, @color = N'rojo'`, '#rrggbb').ok, 'un color que no es #rrggbb no entra');
  const pub2 = uno(`EXEC dbo.sp_menu_en_linea_config @guardar = 1, @activo = 1, @slug = N'cafe-centro', @minutos_estimados = 10`);
  check(pub2.color === '#d0466c' && pub2.horario?.startsWith('Lun'), 'y guardar la publicación no borra el diseño');

  const pm = uno(`EXEC dbo.sp_menu_en_linea_producto_guardar @product_id = ${latte}, @descripcion = N'Espresso doble con leche cremosa', @etiquetas = N'nuevo, recomendado', @destacado = 1`);
  check(pm.etiquetas === 'NUEVO,RECOMENDADO' && pm.destacado === true, 'descripción y etiquetas del producto', pm.etiquetas);
  check(falla(`EXEC dbo.sp_menu_en_linea_producto_guardar @product_id = ${latte}, @etiquetas = N'BARATO'`, 'Etiqueta no').ok, 'una etiqueta inventada no entra');

  const img = (tipo, extra = '') => uno(`EXEC dbo.sp_menu_en_linea_imagen_guardar @tipo = '${tipo}', @mime = 'image/jpeg', @data = 0xFFD8FF00112233, @ancho = 1080, @alto = 720 ${extra}`);
  const po1 = img('PORTADA'), po2 = img('PORTADA');
  check(po1.id === po2.id && po2.version === 2, 'otra portada reemplaza la anterior y sube la versión', `v${po2.version}`);
  const fp = img('PRODUCTO', `, @product_id = ${latte}`);
  check(fp.product_id === latte, 'foto grande del latte');
  const promos = [];
  for (let k = 1; k <= 5; k++) promos.push(img('PROMO', `, @titulo = N'Promo ${k}', @product_id = ${dona}`));
  check(falla(`EXEC dbo.sp_menu_en_linea_imagen_guardar @tipo = 'PROMO', @mime = 'image/jpeg', @data = 0xFF, @ancho = 1, @alto = 1`, '5 promociones').ok, 'máximo 5 promociones');
  const ed = uno(`EXEC dbo.sp_menu_en_linea_imagen_guardar @tipo = 'PROMO', @id = ${promos[0].id}, @titulo = N'2x1 en glaseadas', @product_id = ${dona}`);
  check(ed.titulo === '2x1 en glaseadas' && ed.version === 1, 'editar el texto de una promo no cambia su foto');
  check(uno(`EXEC dbo.sp_menu_en_linea_imagen_borrar @id = ${promos[4].id}`).borradas === 1, 'quitar una promo');
  check(falla(`EXEC dbo.sp_menu_en_linea_imagen_guardar @tipo = 'LOGO', @mime = 'image/gif', @data = 0xFF, @ancho = 1, @alto = 1`).ok, 'solo JPEG, PNG o WebP');

  const ds = sets(`EXEC dbo.sp_menu_en_linea_diseno`);
  const [imgs, prods, top] = [ds[0], ds[1], ds[2]];
  check(imgs.length === 6 && !('data' in imgs[0]), 'el diseño lista 6 fotos sin sus bytes', imgs.map(x => x.tipo).join(','));
  const pl = prods.find(x => x.product_id === latte);
  check(pl?.descripcion?.startsWith('Espresso') && pl.foto_version === 1, 'cada producto con su descripción y su foto');
  check(top.length >= 2 && top[0].product_id === dona, 'lo más pedido sale de ventas reales (2 donas > 1 latte)', top.map(x => `${x.product_id}:${x.piezas}`).join(' '));
  q(`EXEC dbo.sp_menu_en_linea_producto_guardar @product_id = ${dona}, @oculto = 1`);
  check(!sets(`EXEC dbo.sp_menu_en_linea_diseno`)[2].some(x => x.product_id === dona), 'un producto oculto no sale en lo más pedido');
  check(uno(`EXEC dbo.sp_menu_en_linea_imagen_get @id = ${fp.id}`).version === 1 && !!uno(`SELECT DATALENGTH(data) AS n FROM dbo.menu_en_linea_imagenes WHERE id = ${fp.id}`).n, 'los bytes se leen aparte');
} catch (e) {
  fallos++;
  console.log(`   FALLA  la prueba se interrumpió  · ${e.message}`);
} finally {
  if (!CONSERVAR) { try { eliminar(DB); } catch { /* noop */ } }
}
console.log(`\n${pasos - fallos}/${pasos} correctas${fallos ? ` · ${fallos} FALLAS` : ''}`);
process.exit(fallos ? 1 : 0);
