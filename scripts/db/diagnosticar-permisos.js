/**
 * Que usuario usa la aplicacion y que puede hacer con el.
 *
 *     npx electron scripts/db/diagnosticar-permisos.js
 *
 * Solo lectura salvo la prueba final, que crea una tabla temporal propia y
 * la borra dentro de una transaccion con rollback.
 */
const { app } = require('electron');
const path = require('path');
const RAIZ = path.join(__dirname, '..', '..');

app.on('window-all-closed', () => { /* sin ventanas */ });

app.whenReady().then(async () => {
  const db = require(path.join(RAIZ, 'electron', 'db.js'));
  const sql = db.sql;
  const pool = await db.getPool();
  const q = async (t, s) => {
    try {
      const r = await pool.request().query(s);
      console.log(`\n--- ${t} ---`);
      console.table(r.recordset);
    } catch (e) { console.log(`\n--- ${t} --- ERROR: ${e.message}`); }
  };

  await q('identidad', `
    SELECT SUSER_SNAME() AS login_sql, USER_NAME() AS usuario_db,
           SCHEMA_NAME() AS esquema_por_defecto,
           IS_SRVROLEMEMBER('sysadmin') AS es_sysadmin,
           IS_ROLEMEMBER('db_owner') AS es_db_owner,
           IS_ROLEMEMBER('db_ddladmin') AS es_ddladmin;`);

  await q('permisos de base', `
    SELECT permission_name, state_desc FROM fn_my_permissions(NULL, 'DATABASE')
    WHERE permission_name IN ('CREATE TABLE','ALTER','REFERENCES','CONTROL','ALTER ANY SCHEMA') ORDER BY permission_name;`);

  await q('permisos sobre el esquema dbo', `
    SELECT permission_name, state_desc FROM fn_my_permissions('dbo', 'SCHEMA')
    WHERE permission_name IN ('ALTER','REFERENCES','CONTROL','SELECT','INSERT') ORDER BY permission_name;`);

  await q('permisos sobre dbo.products', `
    SELECT permission_name, state_desc FROM fn_my_permissions('dbo.products', 'OBJECT')
    WHERE permission_name IN ('ALTER','REFERENCES','CONTROL','SELECT') ORDER BY permission_name;`);

  // Reproduccion minima: crear una tabla y referenciarla desde otra, en la
  // misma transaccion, exactamente como hace la migracion.
  console.log('\n--- prueba minima: CREATE TABLE + FK en la misma transaccion ---');
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    await new sql.Request(tx).batch(`
      CREATE TABLE dbo.zz_diag_padre (code NVARCHAR(10) NOT NULL CONSTRAINT PK_zz_diag_padre PRIMARY KEY);`);
    console.log('  CREATE TABLE padre        : ok');

    const r1 = await new sql.Request(tx).query(`
      SELECT OBJECT_ID(N'dbo.zz_diag_padre') AS oid,
             (SELECT COUNT(*) FROM fn_my_permissions('dbo.zz_diag_padre','OBJECT') WHERE permission_name = 'REFERENCES') AS puede_referenciar;`);
    console.log(`  OBJECT_ID visible         : ${r1.recordset[0].oid != null}`);
    console.log(`  permiso REFERENCES        : ${r1.recordset[0].puede_referenciar > 0}`);

    await new sql.Request(tx).batch(`
      CREATE TABLE dbo.zz_diag_hijo (code NVARCHAR(10) NULL);`);
    await new sql.Request(tx).batch(`
      ALTER TABLE dbo.zz_diag_hijo WITH CHECK ADD CONSTRAINT FK_zz_diag FOREIGN KEY (code) REFERENCES dbo.zz_diag_padre (code);`);
    console.log('  ALTER ADD FOREIGN KEY     : ok  <-- no es este el problema');
  } catch (e) {
    console.log(`  ALTER ADD FOREIGN KEY     : FALLA  ${e.message}`);
    const prev = e.precedingErrors || [];
    for (const p of prev) console.log(`     previo: [${p.number}] ${p.message}`);
  } finally {
    try { await tx.rollback(); } catch { /* noop */ }
    console.log('  (rollback hecho: no queda nada)');
  }

  // El caso real: la FK apunta a products.base_uom, una columna ANADIDA en la
  // misma transaccion. Eso es distinto a referenciar una tabla nueva.
  console.log('\n--- prueba: FK sobre una COLUMNA anadida en la misma transaccion ---');
  const tx2 = new sql.Transaction(pool);
  await tx2.begin();
  try {
    await new sql.Request(tx2).batch(`
      CREATE TABLE dbo.zz_diag_uoms (code NVARCHAR(10) NOT NULL CONSTRAINT PK_zz_diag_uoms PRIMARY KEY);`);
    await new sql.Request(tx2).batch(`
      CREATE TABLE dbo.zz_diag_prod (id INT NOT NULL);`);
    await new sql.Request(tx2).batch(`
      ALTER TABLE dbo.zz_diag_prod ADD base_uom NVARCHAR(10) NOT NULL CONSTRAINT DF_zz_diag DEFAULT ('pza');`);
    await new sql.Request(tx2).batch(`
      ALTER TABLE dbo.zz_diag_prod WITH CHECK ADD CONSTRAINT FK_zz_diag2 FOREIGN KEY (base_uom) REFERENCES dbo.zz_diag_uoms (code);`);
    console.log('  FK sobre columna nueva    : ok');
  } catch (e) {
    console.log(`  FK sobre columna nueva    : FALLA  ${e.message}`);
    for (const p of (e.precedingErrors || [])) console.log(`     previo: [${p.number}] ${p.message}`);
  } finally {
    try { await tx2.rollback(); } catch { /* noop */ }
    console.log('  (rollback hecho)');
  }

  app.exit(0);
});
