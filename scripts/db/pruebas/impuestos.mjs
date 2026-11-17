/**
 * IMPUESTOS ADEMÁS DEL IVA (migración 0083).
 *
 *     node scripts/db/pruebas/impuestos.mjs [--conservar]
 *
 * Contra SQL de verdad, sobre installer/template.bak con TODAS las migraciones:
 *
 *   1  el catálogo trae IEPS por tasa encendidos y las cuotas apagadas y sin
 *      valor; encender una sin valor no se puede
 *   2  un producto: marcar IEPS por cuota exige cuánto trae una pieza; uno
 *      apagado no se marca
 *   3  vender por sp_register_sale deja la foto: base sin ningún impuesto,
 *      IEPS por tasa, IEPS por cuota, impuesto local fuera de la base del IVA;
 *      y todo suma exactamente lo cobrado
 *   4  un producto sin otros impuestos no cambia (base_neta NULL)
 *   5  la utilidad (sp_get_profit_overview) ya no cuenta el IEPS como ganancia
 *   6  cambiar la tasa del catálogo no reescribe una venta pasada; apagarla
 *      deja de cobrarla en las nuevas
 *   7  (0085) el ticket desglosa IEPS y el local; el folio de la factura trae
 *      la foto; el corte separa el IVA de los otros impuestos (el local ya no
 *      infla el IVA)
 *
 * Solo escribe en la base temporal Wybix_TmpImpuestos.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { restaurar, eliminar } from '../lib/temporal.mjs';
import { consultarTemporal } from '../lib/temporal-consulta.mjs';
import { limpiar } from './lib.mjs';
import { createRequire } from 'node:module';
const { desglosar } = createRequire(import.meta.url)('../../../electron/lib/ticket.js');

const BAK = join('installer', 'template.bak');
const DIR_MIG = join('electron', 'migrations');
const DB = 'Wybix_TmpImpuestos';
const CONSERVAR = process.argv.includes('--conservar');

let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);
const q = (sql) => {
  const r = consultarTemporal(DB, sql);
  if (!r.ok) throw new Error(limpiar(r.error));
  return r.sets.length ? r.sets[r.sets.length - 1] : [];
};
const uno = (sql) => q(sql)[0] ?? null;
const escalar = (sql) => { const f = uno(sql); return f ? f[Object.keys(f)[0]] : null; };
const n = (v) => Number(v ?? 0);
const cerca = (a, b, tol = 0.005) => Math.abs(Number(a) - b) < tol;
const falla = (sql, frag) => {
  const r = consultarTemporal(DB, sql);
  if (r.ok) return { ok: false, error: '(no falló)' };
  const msg = limpiar(r.error);
  return { ok: frag ? msg.includes(frag) : true, error: msg };
};

try {
  console.log(`\nIMPUESTOS   (${DB})`);
  restaurar(DB, BAK);
  const aplicadas = new Set(q('SELECT filename FROM dbo.schema_migrations;').map((r) => r.filename));
  for (const f of readdirSync(DIR_MIG).filter((f) => f.toLowerCase().endsWith('.sql')).sort((a, b) => a.localeCompare(b, 'en')).filter((f) => !aplicadas.has(f))) {
    for (const lote of readFileSync(join(DIR_MIG, f), 'utf8').replace(/\r\n/g, '\n').split(/\n\s*GO\s*\n/gi)) if (lote.trim()) q(lote);
    q(`INSERT INTO dbo.schema_migrations (filename) VALUES (N'${f}');`);
  }

  // ============================================================ 1
  seccion('1. El catálogo');
  const cat = q('EXEC dbo.sp_impuestos_listar @todos = 1;');
  const por = (clave) => cat.find((i) => i.clave === clave);
  check(cerca(por('IEPS_ALIMENTOS')?.tasa, 0.08) && por('IEPS_ALIMENTOS')?.activo, 'IEPS alimentos: 8%, encendido');
  check(por('IEPS_BEBIDAS_AZUCAR')?.cuota == null && !por('IEPS_BEBIDAS_AZUCAR')?.activo, 'IEPS bebidas con azúcar: cuota sin valor y apagado (se captura la del año)');
  check(por('LOCAL_HOSPEDAJE') && !por('LOCAL_HOSPEDAJE').en_base_iva, 'hospedaje: local, fuera de la base del IVA');
  const bebidas = n(por('IEPS_BEBIDAS_AZUCAR')?.id), alimentos = n(por('IEPS_ALIMENTOS')?.id), hospedaje = n(por('LOCAL_HOSPEDAJE')?.id);
  let r = falla(`EXEC dbo.sp_impuesto_guardar @id=${bebidas}, @nombre=N'x', @clase='IEPS', @factor='Cuota', @activo=1;`, 'captura su tasa o su cuota');
  check(r.ok, 'encender una cuota sin valor se rechaza', r.error);
  /* Cuota de PRUEBA ($1.50/litro): no es la vigente; el negocio captura la suya. */
  q(`EXEC dbo.sp_impuesto_guardar @id=${bebidas}, @nombre=N'ignorado', @clase='LOCAL', @factor='Tasa', @tasa=0.5, @cuota=1.5, @activo=1;`);
  const beb = uno(`SELECT nombre, clase, factor, tasa, cuota, activo FROM dbo.CAT_impuestos WHERE id=${bebidas}`);
  check(beb.factor === 'Cuota' && beb.clase === 'IEPS' && beb.nombre.startsWith('IEPS') && beb.tasa == null && cerca(beb.cuota, 1.5) && beb.activo,
    'de uno del sistema solo cambia el valor (no nombre, clase ni factor)', JSON.stringify(beb));
  q(`EXEC dbo.sp_impuesto_guardar @id=${hospedaje}, @nombre=N'x', @clase='LOCAL', @factor='Tasa', @tasa=0.03, @activo=1;`);
  const propio = n(escalar(`EXEC dbo.sp_impuesto_guardar @nombre=N'QA Impuesto propio', @clase='IEPS', @factor='Tasa', @tasa=0.05, @activo=0;`));
  check(propio > 0 && uno(`SELECT clave FROM dbo.CAT_impuestos WHERE id=${propio}`).clave === `PROPIO_${propio}`, 'se crea uno propio', `PROPIO_${propio}`);
  r = falla(`EXEC dbo.sp_impuesto_guardar @nombre=N'QA Impuesto propio', @clase='IEPS', @factor='Tasa', @tasa=0.05;`, 'Ya hay');
  check(r.ok, 'sin nombres repetidos', r.error);

  // ============================================================ 2
  seccion('2. Impuestos de un producto');
  q(`INSERT INTO dbo.users (usuario, password_hash, rol, active, creation_date) VALUES (N'qa_imp', N'x', N'admin', 1, GETDATE());
     INSERT INTO dbo.CAT_categories (namee) VALUES (N'QA Imp'); INSERT INTO dbo.CAT_brands (namee) VALUES (N'QA Imp');`);
  const u = n(escalar(`SELECT id FROM dbo.users WHERE usuario = N'qa_imp'`));
  const prod = (pn, nombre, precio, costo, tasa = 0.16) => {
    q(`INSERT INTO dbo.products (part_number, nombre, price, stock, category_id, brand_id, cost, objeto_impuesto, tasa_iva, active, registrated_date, inventory_mode)
       VALUES (N'${pn}', N'${nombre}', ${precio}, 100, (SELECT id FROM dbo.CAT_categories WHERE namee = N'QA Imp'), (SELECT id FROM dbo.CAT_brands WHERE namee = N'QA Imp'),
               ${costo}, '02', ${tasa}, 1, GETDATE(), 'DIRECT');`);
    return n(escalar(`SELECT id FROM dbo.products WHERE part_number = N'${pn}'`));
  };
  const papas = prod('QA-PAPAS', 'Papas 45 g', 58, 30);
  const refresco = prod('QA-REFRESCO', 'Refresco 600 ml', 20, 9);
  const noche = prod('QA-NOCHE', 'Noche de hotel', 1190, 400);
  const taza = prod('QA-TAZA', 'Taza', 116, 40);
  r = falla(`EXEC dbo.sp_producto_impuestos_guardar @product_id=${refresco}, @impuestos=N'[{"id":${bebidas}}]';`, 'trae una pieza');
  check(r.ok, 'IEPS por cuota sin cantidad por pieza se rechaza', r.error);
  r = falla(`EXEC dbo.sp_producto_impuestos_guardar @product_id=${papas}, @impuestos=N'[{"id":${propio}}]';`, 'apagado');
  check(r.ok, 'un impuesto apagado no se marca', r.error);
  q(`EXEC dbo.sp_producto_impuestos_guardar @product_id=${papas}, @impuestos=N'[{"id":${alimentos}}]';`);
  const lr = q(`EXEC dbo.sp_producto_impuestos_guardar @product_id=${refresco}, @impuestos=N'[{"id":${bebidas},"cantidad":0.6}]';`);
  check(lr.length === 1 && cerca(lr[0].cantidad, 0.6), 'refresco: IEPS por litro, 0.6 L por pieza');
  q(`EXEC dbo.sp_producto_impuestos_guardar @product_id=${noche}, @impuestos=N'[{"id":${hospedaje}}]';`);

  // ============================================================ 3
  seccion('3. La venta deja la foto (sp_register_sale)');
  q(`EXEC dbo.sp_open_shift @user_id=${u}, @opening_cash=500, @register_id=1;`);
  const vender = (lineas) => n(uno(`DECLARE @d dbo.SaleDetailType; INSERT @d VALUES ${lineas.map(([p, c, pr]) => `(${p}, ${c}, ${pr})`).join(', ')};
     EXEC dbo.sp_register_sale @user_id=${u}, @payment_method=N'EFECTIVO', @SaleDetails=@d, @register_id=1;`).sale_id);
  const v1 = vender([[papas, 1, 58], [refresco, 2, 20], [noche, 1, 1190], [taza, 1, 116]]);
  const linea = (p) => uno(`SELECT d.id, d.subtotal, d.base_neta, d.otros_impuestos, d.tax_rate FROM dbo.sale_detail d WHERE d.sale_id=${v1} AND d.product_id=${p}`);
  const imp = (id) => q(`SELECT nombre, factor, tasa, cuota, cantidad, base, importe FROM dbo.sale_detail_impuestos WHERE sale_detail_id=${id}`);
  const iva = (l, enBase) => (n(l.base_neta) + enBase) * n(l.tax_rate);

  /* Papas $58: B = 58 / (1.08 × 1.16) = 46.2963; IEPS 3.7037; IVA 8.00. */
  const lp = linea(papas), ip = imp(lp.id);
  check(cerca(lp.base_neta, 58 / (1.08 * 1.16), 0.0001), 'papas: base sin impuestos $46.30', lp.base_neta);
  check(ip.length === 1 && cerca(ip[0].importe, 3.7037, 0.0001) && cerca(lp.otros_impuestos, 3.7037, 0.0001), 'papas: IEPS 8% = $3.70', ip[0]?.importe);
  check(cerca(n(lp.base_neta) + n(lp.otros_impuestos) + iva(lp, n(lp.otros_impuestos)), 58, 0.001), 'papas: base + IEPS + IVA = $58 exactos');

  /* Refresco 2 × $20: cuota 1.5 × 0.6 L × 2 = 1.80; B = (40 − 1.8×1.16)/1.16 = 32.6828. */
  const lr2 = linea(refresco), ir = imp(lr2.id);
  check(cerca(lr2.base_neta, (40 - 1.8 * 1.16) / 1.16, 0.0001), 'refresco: base $32.68', lr2.base_neta);
  check(ir.length === 1 && cerca(ir[0].importe, 1.8) && cerca(ir[0].cantidad, 1.2), 'refresco: IEPS por cuota $1.80 (1.2 L)', JSON.stringify(ir[0]));
  check(cerca(n(lr2.base_neta) + 1.8 + iva(lr2, 1.8), 40, 0.001), 'refresco: base + IEPS + IVA = $40 exactos');

  /* Noche $1,190: hospedaje 3% FUERA de la base del IVA → B = 1190 / 1.19 = 1000. */
  const ln = linea(noche), ih = imp(ln.id);
  check(cerca(ln.base_neta, 1000) && cerca(ih[0]?.importe, 30), 'hotel: base $1,000, hospedaje 3% = $30', `${ln.base_neta} / ${ih[0]?.importe}`);
  check(cerca(n(ln.base_neta) + 30 + iva(ln, 0), 1190, 0.001), 'hotel: base + hospedaje + IVA (sobre la base sola) = $1,190');

  // ============================================================ 4
  seccion('4. Sin otros impuestos, nada cambia');
  const lt = linea(taza);
  check(lt.base_neta == null && lt.otros_impuestos == null && imp(lt.id).length === 0, 'taza: base_neta NULL, sin desglose');

  // ============================================================ 5
  seccion('5. La utilidad ya no cuenta el IEPS como ganancia');
  const hoy = escalar('SELECT CONVERT(VARCHAR(10), CAST(GETDATE() AS DATE), 23)');
  const esperado = (58 / (1.08 * 1.16) - 30) + ((40 - 1.8 * 1.16) / 1.16 - 18) + (1000 - 400) + (100 - 40);
  const ov = q(`EXEC dbo.sp_get_profit_overview @from_date='${hoy}', @to_date='${hoy}';`);
  check(ov.length === 1 && cerca(ov[0].profit, esperado, 0.01), `utilidad del día $${esperado.toFixed(2)}`, ov[0]?.profit);
  const sem = consultarTemporal(DB, 'EXEC dbo.sp_get_weekly_profit;');
  check(sem.ok, 'sp_get_weekly_profit corre', sem.ok ? '' : limpiar(sem.error));
  const nube = consultarTemporal(DB, 'EXEC dbo.sp_cloud_daily_profit;');
  check(nube.ok, 'sp_cloud_daily_profit corre', nube.ok ? '' : limpiar(nube.error));
  const er = consultarTemporal(DB, `EXEC dbo.sp_income_statement @desde='${hoy}', @hasta='${hoy}';`);
  check(er.ok, 'sp_income_statement corre', er.ok ? '' : limpiar(er.error));

  // ============================================================ 6
  seccion('6. Cambiar el catálogo no reescribe el pasado');
  q(`EXEC dbo.sp_impuesto_guardar @id=${alimentos}, @nombre=N'x', @clase='IEPS', @factor='Tasa', @tasa=0.10, @activo=1;`);
  check(cerca(linea(papas).base_neta, 58 / (1.08 * 1.16), 0.0001), 'la venta pasada conserva su 8%');
  const v2 = vender([[papas, 1, 58]]);
  check(cerca(escalar(`SELECT base_neta FROM dbo.sale_detail WHERE sale_id=${v2}`), 58 / (1.10 * 1.16), 0.0001), 'la nueva usa el 10%');
  q(`EXEC dbo.sp_impuesto_guardar @id=${alimentos}, @nombre=N'x', @clase='IEPS', @factor='Tasa', @tasa=0.10, @activo=0;`);
  const v3 = vender([[papas, 1, 58]]);
  check(escalar(`SELECT base_neta FROM dbo.sale_detail WHERE sale_id=${v3}`) == null, 'apagado: deja de cobrarse aunque siga marcado en el producto');
  check(q(`EXEC dbo.sp_producto_impuestos_get @product_id=${papas}`)[0]?.activo === false, 'y el producto lo dice (marcado, apagado)');

  // ============================================================ 7
  seccion('7. Ticket, factura y corte (0085)');
  const lineas = q(`EXEC dbo.sp_get_sale_ticket @sale_id=${v1};`);
  const tk = desglosar(lineas);
  const otro = (et) => tk.otros.find((o) => o.etiqueta === et)?.importe;
  check(cerca(tk.total, 1404) && cerca(otro('IEPS 8%'), 3.7037, 0.001) && cerca(otro('IEPS cuota'), 1.8) && cerca(otro('Imp. local 3%'), 30),
    'el ticket trae IEPS 8%, IEPS por cuota y el local', JSON.stringify(tk.otros));
  check(cerca(tk.impuesto, 8 + 5.5172 + 160 + 16, 0.01), 'y el IVA sin contarlos', tk.impuesto.toFixed(4));
  const det = q(`EXEC dbo.sp_get_sale_by_folio @sale_id=${v1};`);
  const dp = det.find((d) => d.product_id === papas);
  check(dp && cerca(dp.base_neta, 46.2963, 0.0001) && JSON.parse(dp.impuestos_json)[0].clase === 'IEPS', 'el folio de la factura trae la foto del renglón');
  check(det.find((d) => d.product_id === taza).impuestos_json == null, 'un renglón sin otros impuestos no trae foto');
  const cierre = Number(escalar('SELECT TOP 1 id FROM dbo.cash_closures ORDER BY id DESC'));
  const corte = JSON.parse(escalar(`EXEC dbo.sp_cash_closure_ticket @closure_id=${cierre};`));
  /* v1 (8 + 5.5172 + 160 + 16) + v2 (IEPS 10%: 8) + v3 (sin IEPS: 8) = 205.5172.
     Antes: la noche de hotel daba 164.14 de IVA (1190 − 1190/1.16). */
  check(cerca(corte.tax, 205.5172, 0.01), 'el IVA del corte ya no cuenta el impuesto local ni el IEPS', String(corte.tax));
  check(cerca(corte.other_tax, 3.7037 + 1.8 + 30 + 58 / (1.1 * 1.16) * 0.1, 0.01), 'y los otros impuestos van aparte', String(corte.other_tax));
} catch (e) {
  fallos++;
  console.log(`\n   ERROR  ${e.message}`);
} finally {
  if (!CONSERVAR) { eliminar(DB); console.log(`\nBase temporal ${DB} eliminada.`); }
}

console.log(`\nRESULTADO: ${fallos ? `${fallos} FALLO(S)` : 'todo bien'} (${pasos} comprobaciones)`);
process.exit(fallos ? 1 : 0);
