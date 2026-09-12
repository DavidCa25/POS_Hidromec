/**
 * Que bases tienen los objetos que acaba de crear una migracion.
 *
 *     node scripts/db/estado-objetos.mjs
 *
 * Antes de construir la plantilla hay que saber de que base se puede
 * extraer: la autoridad tiene que ir POR DELANTE, no por detras. Extraer de
 * una base atrasada revierte procedimientos en Git, que ya paso una vez.
 */
import { consultar } from './lib/sql.mjs';

const BASES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['Wybix_Production', 'Wybix_MigTest', 'Wybix_Template'];

const PREGUNTA = `
  SELECT
    CASE WHEN COL_LENGTH('dbo.raffle_definitions','tickets_total') IS NULL
         THEN 'FALTA' ELSE 'si' END AS tickets_total,
    CASE WHEN OBJECT_ID('dbo.sp_coupon_issue') IS NULL
         THEN 'FALTA' ELSE 'si' END AS sp_coupon_issue,
    (SELECT COUNT(*) FROM dbo.schema_migrations) AS migraciones,
    (SELECT COUNT(*) FROM sys.procedures) AS procedures;`;

for (const base of BASES) {
  try {
    const r = consultar(base, PREGUNTA)[0];
    console.log(`${base.padEnd(18)} tickets_total=${String(r.tickets_total).padEnd(5)}` +
      ` sp_coupon_issue=${String(r.sp_coupon_issue).padEnd(5)}` +
      ` migraciones=${String(r.migraciones).padEnd(3)} procedures=${r.procedures}`);
  } catch (e) {
    console.log(`${base.padEnd(18)} no se pudo leer: ${String(e.message).split('\n')[0].slice(0, 70)}`);
  }
}
