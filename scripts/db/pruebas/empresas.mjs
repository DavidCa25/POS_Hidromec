/**
 * MultiEmpresa (0080) en SQL Server, con bases de verdad.
 *
 *     node scripts/db/pruebas/empresas.mjs [--conservar]
 *
 * QUE COMPRUEBA
 * -------------
 * Cuatro empresas, cada una en su propia base restaurada del baseline y
 * migrada como en una caja real. El grupo crece de 2 a 3 a 4 y en cada
 * vuelta, desde CADA base:
 *
 *   · sp_empresas_locales ve exactamente las del grupo (ni una base ajena
 *     del mismo servidor), marca la propia y dice en cuáles existe el usuario;
 *   · sp_empresas_resumen de cada una, leído desde OTRA (tres partes), da lo
 *     mismo que leído desde ella misma, y coincide con lo calculado aparte:
 *     ventas, tickets, utilidad (la de Reportes), turnos y efectivo.
 *
 * Después: salir del grupo, una base sin grupo (solo se ve a sí misma) y los
 * pedidos de otra empresa (sp_empresas_comando_aplicar): precio, alta, una
 * sola vez aunque llegue dos, candados de MultiSucursal y bitácora.
 *
 * Corre sobre restauraciones del baseline, no sobre ninguna base de trabajo.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { restaurar, eliminar } from '../lib/temporal.mjs';
import { consultarTemporal } from '../lib/temporal-consulta.mjs';
import { limpiar } from './lib.mjs';

const BAK = join('installer', 'template.bak');
const DIR_MIG = join('electron', 'migrations');
const BASES = ['Wybix_TmpEmp1', 'Wybix_TmpEmp2', 'Wybix_TmpEmp3', 'Wybix_TmpEmp4'];
const AJENA = 'Wybix_TmpEmpAjena';
const CONSERVAR = process.argv.includes('--conservar');

let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);
const q = (db, sql) => {
  const r = consultarTemporal(db, sql);
  if (!r.ok) throw new Error(`${db}: ${limpiar(r.error)}`);
  return r.sets.length ? r.sets[0] : [];
};
const uno = (db, sql) => q(db, sql)[0] ?? null;
const n = (v) => Number(v ?? 0);
/** La membresía como la escribe locales.escribirGrupo: el grupo y la lista completa, en cada base. */
const fijar = (db, g, bases) => q(db, `EXEC dbo.sp_empresas_grupo_fijar @grupo = ${g ? `'${g}'` : 'NULL'},
  @bases = ${bases ? `N'${JSON.stringify(bases)}'` : 'NULL'};`);
const cerca = (a, b) => Math.abs(n(a) - n(b)) <= 0.01;

/** Restaura el baseline y aplica las migraciones con la MISMA regla que migrationsRunner.js. */
function nacer(db) {
  restaurar(db, BAK);
  const aplicadas = new Set(q(db, 'SELECT filename FROM dbo.schema_migrations;').map(r => r.filename));
  for (const f of readdirSync(DIR_MIG, { withFileTypes: true })
      .filter(d => d.isFile() && d.name.toLowerCase().endsWith('.sql'))
      .map(d => d.name).sort((a, b) => a.localeCompare(b, 'en'))
      .filter(f => !aplicadas.has(f))) {
    for (const lote of readFileSync(join(DIR_MIG, f), 'utf8').replace(/\r\n/g, '\n').split(/\n\s*GO\s*\n/gi)) {
      if (lote.trim()) q(db, lote);
    }
    q(db, `INSERT INTO dbo.schema_migrations (filename) VALUES (N'${f}');`);
  }
}

/** El negocio, sus usuarios y unas ventas con números conocidos. Devuelve lo esperado. */
function sembrar(db, i) {
  q(db, `EXEC dbo.sp_setup_inicial @usuario = N'david', @password = N'secreta1', @business_name = N'Empresa ${i}',
           @address = NULL, @phone = NULL, @rfc = NULL, @business_profile = N'${i % 2 ? 'RETAIL' : 'HOSPITALITY'}';`);
  // Ana solo existe en las dos primeras; Leo existe en la 3 pero inactivo.
  if (i <= 2) q(db, `INSERT INTO dbo.users (usuario, password_hash, rol, active) VALUES (N'ana', N'x', N'cajero', 1);`);
  if (i === 3) q(db, `INSERT INTO dbo.users (usuario, password_hash, rol, active) VALUES (N'leo', N'x', N'admin', 0);`);
  // La identidad en la nube la escribe nube/identidad.js al encender la nube.
  // Las tres primeras la tienen; la cuarta nunca encendió la nube.
  const instancia = i <= 3 ? randomUUID().toUpperCase() : null;
  if (instancia) q(db, `INSERT INTO dbo.database_metadata (clave, valor) VALUES (N'instance_uuid', N'${instancia}');`);
  const user = n(uno(db, `SELECT id FROM dbo.users WHERE usuario = N'david';`).id);
  const brand = n(uno(db, `INSERT INTO dbo.CAT_brands (namee) VALUES (N'QA'); SELECT CAST(SCOPE_IDENTITY() AS INT) AS id;`).id);
  const cat = n(uno(db, `INSERT INTO dbo.CAT_categories (namee) VALUES (N'QA'); SELECT CAST(SCOPE_IDENTITY() AS INT) AS id;`).id);
  const prod = n(uno(db, `EXEC dbo.sp_add_product @brand=${brand}, @part_number=N'P${i}', @name=N'Producto ${i}', @price=116,
                          @stock=100, @category=${cat}, @cost=50;`).id);

  // i ventas de 116 (IVA incluido) con costo 50: utilidad por venta = 100 - 50.
  for (let k = 0; k < i; k++) {
    const sale = n(uno(db, `INSERT INTO dbo.sales (useer_id, total, payment_method, paid_amount, register_id)
                            VALUES (${user}, 116, N'EFECTIVO', 116, 1); SELECT CAST(SCOPE_IDENTITY() AS INT) AS id;`).id);
    q(db, `INSERT INTO dbo.sale_detail (sale_id, product_id, quantity, unitary_price, unit_cost, tax_rate, tax_object)
           VALUES (${sale}, ${prod}, 1, 116, 50, 0.16, '02');`);
  }
  // Una venta de ayer: no entra en el periodo de hoy.
  q(db, `INSERT INTO dbo.sales (useer_id, total, payment_method, paid_amount, register_id, datee)
         VALUES (${user}, 999, N'EFECTIVO', 999, 1, DATEADD(DAY, -1, GETDATE()));`);
  // Turno abierto con fondo 1000*i, una entrada de 200 y un retiro de 50.
  q(db, `EXEC dbo.sp_open_shift @user_id = ${user}, @opening_cash = ${1000 * i}, @register_id = 1;`);
  const turno = n(uno(db, `SELECT TOP 1 id FROM dbo.cash_closures WHERE closed_at IS NULL ORDER BY id DESC;`).id);
  q(db, `INSERT INTO dbo.cash_movements (userId, typee, amount, closure_id, register_id) VALUES (${user}, 'DEPOSIT', 200, ${turno}, 1);
         INSERT INTO dbo.cash_movements (userId, typee, amount, closure_id, register_id) VALUES (${user}, 'WITHDRAW', -50, ${turno}, 1);`);
  return { ventas: 116 * i, tickets: i, utilidad: 50 * i, turnos: 1, efectivo: 1000 * i + 150, user, prod,
           instancia: instancia?.toLowerCase() ?? null };
}

const grupo = randomUUID();
const esperado = {};
try {
  console.log('\nMULTIEMPRESA (0080)   cuatro empresas, cada una en su base');
  if (!existsSync(BAK)) {
    console.log(`   ----   falta ${BAK}: es un artefacto derivado (npm run db:baseline).`);
    process.exit(0);
  }

  seccion('cada empresa nace de la plantilla y se migra');
  for (const [k, db] of BASES.entries()) {
    nacer(db);
    esperado[db] = sembrar(db, k + 1);
    check(true, `${db}: Empresa ${k + 1}`);
  }
  nacer(AJENA);
  q(AJENA, `EXEC dbo.sp_setup_inicial @usuario = N'david', @password = N'secreta1', @business_name = N'Ajena', @address = NULL,
              @phone = NULL, @rfc = NULL, @business_profile = N'RETAIL';`);
  // OTRO grupo, en el mismo servidor, que además dice conocer a la primera.
  fijar(AJENA, randomUUID(), [AJENA, BASES[0]]);

  seccion('sin grupo, una empresa solo se ve a sí misma');
  const sola = q(BASES[0], `EXEC dbo.sp_empresas_locales @usuario = N'david';`);
  check(sola.length === 1 && sola[0].base === BASES[0] && sola[0].es_esta === true && n(sola[0].user_id) > 0,
    'una fila: ella, con su usuario', JSON.stringify(sola.map(x => x.base)));
  check(uno(BASES[0], 'EXEC dbo.sp_empresas_grupo;').grupo === null, 'y sp_empresas_grupo dice que no tiene grupo');

  const hoy = uno(BASES[0], `SELECT CONVERT(CHAR(10), CAST(GETDATE() AS DATE), 23) AS d;`).d;
  for (let tam = 2; tam <= BASES.length; tam++) {
    seccion(`grupo de ${tam} empresas`);
    const miembros = BASES.slice(0, tam);
    for (const db of miembros) fijar(db, grupo, miembros);

    for (const desde of miembros) {
      const l = q(desde, `EXEC dbo.sp_empresas_locales @usuario = N'david';`);
      const bases = l.map(x => x.base);
      check(bases.length === tam && miembros.every(m => bases.includes(m)) && !bases.includes(AJENA),
        `desde ${desde}: ve las ${tam} del grupo y ninguna ajena`, bases.join(','));
      check(l[0].base === desde && l[0].es_esta === true && l.filter(x => x.es_esta).length === 1, `  y se marca a sí misma primero`);
      check(l.every(x => n(x.user_id) > 0 && x.rol === 'admin'), '  david existe en todas');
      check(l.every(x => (x.instance_uuid ?? null) === esperado[x.base].instancia),
        '  cada una con su identidad para la nube, en minúsculas (o ninguna si nunca la encendió)');
    }
    const conAna = q(miembros[0], `EXEC dbo.sp_empresas_locales @usuario = N'ana';`).filter(x => x.user_id != null).map(x => x.base);
    check(JSON.stringify(conAna) === JSON.stringify(miembros.slice(0, 2)), 'ana solo entra donde existe', conAna.join(','));
    if (tam >= 3) {
      const leo = q(miembros[0], `EXEC dbo.sp_empresas_locales @usuario = N'leo';`).filter(x => x.user_id != null);
      check(leo.length === 0, 'un usuario inactivo no cuenta');
    }

    for (const db of miembros) {
      const propio = uno(db, `EXEC dbo.sp_empresas_resumen @desde = '${hoy}', @hasta = '${hoy}';`);
      const otra = miembros.find(x => x !== db);
      const ajeno = uno(otra, `EXEC [${db}].dbo.sp_empresas_resumen @desde = '${hoy}', @hasta = '${hoy}';`);
      const e = esperado[db];
      check(cerca(propio.ventas, e.ventas) && n(propio.tickets) === e.tickets && cerca(propio.utilidad, e.utilidad)
        && n(propio.turnos_abiertos) === e.turnos && cerca(propio.efectivo_en_caja, e.efectivo),
        `${db}: ventas ${e.ventas}, ${e.tickets} tickets, utilidad ${e.utilidad}, efectivo ${e.efectivo}`,
        `${propio.ventas}/${propio.tickets}/${propio.utilidad}/${propio.efectivo_en_caja}`);
      check(JSON.stringify(propio) === JSON.stringify(ajeno), `  y leído desde ${otra} da lo mismo`);
    }
  }

  seccion('periodo');
  const ayer = uno(BASES[0], `SELECT CONVERT(CHAR(10), DATEADD(DAY, -1, CAST(GETDATE() AS DATE)), 23) AS d;`).d;
  const dos = uno(BASES[0], `EXEC dbo.sp_empresas_resumen @desde = '${ayer}', @hasta = '${hoy}';`);
  check(cerca(dos.ventas, esperado[BASES[0]].ventas + 999) && n(dos.tickets) === 2, 'con ayer entra la venta de ayer', `${dos.ventas}`);
  const alReves = uno(BASES[0], `EXEC dbo.sp_empresas_resumen @desde = '${hoy}', @hasta = '${ayer}';`);
  check(cerca(alReves.ventas, esperado[BASES[0]].ventas), 'un periodo al revés se toma como un día');

  seccion('salir del grupo');
  // Primero solo ELLA sale: las demás aún la tienen en su lista (como si se cortara a medias).
  fijar(BASES[3], null, null);
  const tres = q(BASES[0], `EXEC dbo.sp_empresas_locales;`).map(x => x.base);
  check(tres.length === 3 && !tres.includes(BASES[3]), 'la que sale deja de verse aunque las demás no se hayan enterado', tres.join(','));
  check(n(uno(BASES[0], `SELECT COUNT(*) AS n FROM dbo.empresas_grupo_bases;`).n) === 4, '  (la lista vieja de las demás sigue con cuatro)');
  for (const db of BASES.slice(0, 3)) fijar(db, grupo, [...BASES.slice(0, 3), 'Wybix_TmpEmpNoExiste']);
  const conFantasma = q(BASES[0], `EXEC dbo.sp_empresas_locales;`).map(x => x.base);
  check(conFantasma.length === 3, 'una base que ya no existe en el servidor se salta', conFantasma.join(','));
  check(q(BASES[0], 'EXEC dbo.sp_empresas_grupo;').length === 1 && uno(BASES[0], 'EXEC dbo.sp_empresas_grupo;').grupo !== null, 'sp_empresas_grupo sigue diciendo su grupo');
  check(q(BASES[3], `EXEC dbo.sp_empresas_locales;`).length === 1, 'y ella solo se ve a sí misma');
  check(n(uno(BASES[3], `SELECT COUNT(*) AS n FROM dbo.sales;`).n) === 5, 'sin perder nada de lo suyo');

  seccion('pedidos de otra empresa (sp_empresas_comando_aplicar)');
  const D = BASES[1];
  const prodUuid = uno(D, `SELECT LOWER(CONVERT(VARCHAR(36), uuid)) AS u FROM dbo.products WHERE id = ${esperado[D].prod};`).u;
  const aplicar = (id, tipo, payload) => uno(D, `EXEC dbo.sp_empresas_comando_aplicar @comando_id = '${id}', @tipo = N'${tipo}',
      @origen_empresa = N'Empresa 1', @origen_usuario = N'david', @payload = N'${JSON.stringify(payload).replace(/'/g, "''")}';`);
  const c1 = randomUUID();
  const r1 = aplicar(c1, 'PRODUCTO_PRECIO', { product_uuid: prodUuid, precio: 130 });
  check(r1.resultado === 'APLICADO' && n(uno(D, `SELECT price FROM dbo.products WHERE id = ${esperado[D].prod};`).price) === 130,
    'cambio de precio aplicado', r1.detalle);
  const r1b = aplicar(c1, 'PRODUCTO_PRECIO', { product_uuid: prodUuid, precio: 1 });
  check(r1b.resultado === 'APLICADO' && n(uno(D, `SELECT price FROM dbo.products WHERE id = ${esperado[D].prod};`).price) === 130,
    'el mismo comando otra vez no vuelve a tocar nada');
  check(aplicar(randomUUID(), 'PRODUCTO_PRECIO', { product_uuid: randomUUID(), precio: 5 }).resultado === 'RECHAZADO', 'un producto que no existe se rechaza');
  check(aplicar(randomUUID(), 'PRODUCTO_PRECIO', { product_uuid: prodUuid, precio: -5 }).resultado === 'RECHAZADO', 'un precio negativo se rechaza');
  check(aplicar(randomUUID(), 'PRODUCTO_PRECIO', 'no es json').resultado === 'RECHAZADO', 'un pedido que no es JSON se rechaza sin error');

  q(D, `UPDATE dbo.products SET corporate = 1 WHERE id = ${esperado[D].prod};
        MERGE dbo.database_metadata t USING (SELECT N'multi_reglas' AS clave) s ON t.clave = s.clave
          WHEN MATCHED THEN UPDATE SET valor = N'{"precios_sucursal":false,"productos_locales":false}'
          WHEN NOT MATCHED THEN INSERT (clave, valor) VALUES (N'multi_reglas', N'{"precios_sucursal":false,"productos_locales":false}');
        MERGE dbo.database_metadata t USING (SELECT N'multi_version' AS clave) s ON t.clave = s.clave
          WHEN MATCHED THEN UPDATE SET valor = N'3' WHEN NOT MATCHED THEN INSERT (clave, valor) VALUES (N'multi_version', N'3');`);
  const cand = aplicar(randomUUID(), 'PRODUCTO_PRECIO', { product_uuid: prodUuid, precio: 99 });
  check(cand.resultado === 'RECHAZADO' && /matriz/.test(cand.detalle), 'un producto de la matriz conserva su candado de precio', cand.detalle);
  const sinAlta = aplicar(randomUUID(), 'PRODUCTO_ALTA', { nombre: 'Quesabirria', precio: 55 });
  check(sinAlta.resultado === 'RECHAZADO' && /matriz/.test(sinAlta.detalle), 'y una sucursal sin altas propias no da de alta', sinAlta.detalle);
  q(D, `UPDATE dbo.database_metadata SET valor = N'{"precios_sucursal":true,"productos_locales":true}' WHERE clave = N'multi_reglas';`);
  check(aplicar(randomUUID(), 'PRODUCTO_PRECIO', { product_uuid: prodUuid, precio: 125 }).resultado === 'APLICADO', 'con permiso de precios por sucursal, sí');

  const c2 = randomUUID();
  const alta = aplicar(c2, 'PRODUCTO_ALTA', { nombre: 'Quesabirria', precio: 55, categoria: 'Antojitos' });
  const nuevo = uno(D, `SELECT p.nombre, p.price, p.inventory_mode, p.sellable, c.namee AS cat FROM dbo.products p
                          JOIN dbo.CAT_categories c ON c.id = p.category_id WHERE p.id = ${n(alta.product_id) || 0};`);
  check(alta.resultado === 'APLICADO' && nuevo?.nombre === 'Quesabirria' && n(nuevo.price) === 55 && nuevo.inventory_mode === 'NONE'
    && nuevo.sellable === true && nuevo.cat === 'Antojitos', 'alta: vendible desde ya, sin inventario, en su categoría (nueva)', alta.detalle);
  check(aplicar(c2, 'PRODUCTO_ALTA', { nombre: 'Quesabirria', precio: 55 }).product_id === alta.product_id
    && n(uno(D, `SELECT COUNT(*) AS n FROM dbo.products WHERE nombre = N'Quesabirria';`).n) === 1, 'el mismo alta otra vez no duplica');
  check(/nombre/.test(aplicar(randomUUID(), 'PRODUCTO_ALTA', { nombre: 'Quesabirria', precio: 60 }).detalle), 'otro alta con el mismo nombre se rechaza');
  check(aplicar(randomUUID(), 'PRODUCTO_ALTA', { nombre: 'Con código', precio: 10, codigo: 'P2' }).resultado === 'RECHAZADO', 'y con un código que ya existe');
  const sinCat = aplicar(randomUUID(), 'PRODUCTO_ALTA', { nombre: 'Agua', precio: 20 });
  check(sinCat.resultado === 'APLICADO' && uno(D, `SELECT c.namee FROM dbo.products p JOIN dbo.CAT_categories c ON c.id = p.category_id
                                                   WHERE p.id = ${n(sinCat.product_id)};`).namee === 'General', 'sin categoría va a General');
  check(aplicar(randomUUID(), 'BORRAR_TODO', { precio: 1 }).resultado === 'RECHAZADO', 'un tipo desconocido se rechaza');

  const bitacora = q(D, `SELECT resultado, origen_empresa, origen_usuario FROM dbo.empresas_comandos;`);
  check(bitacora.length === 12 && bitacora.every(x => x.origen_empresa === 'Empresa 1' && x.origen_usuario === 'david'),
    'cada pedido queda en la bitácora una vez (12 distintos; los dos repetidos no suman), con quién lo pidió', `${bitacora.length} filas`);
} catch (e) {
  check(false, 'la prueba se interrumpió', e.message);
} finally {
  if (!CONSERVAR) for (const db of [...BASES, AJENA]) { try { eliminar(db); } catch { /* noop */ } }
}

console.log(`\n${fallos ? 'HAY FALLOS' : 'TODO BIEN'} · ${pasos - fallos}/${pasos}\n`);
process.exit(fallos ? 1 : 0);
