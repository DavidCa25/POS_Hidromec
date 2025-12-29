const fs = require('fs');
const path = require('path');

function splitSqlByGo(sqlText) {
  return sqlText
    .replace(/\r\n/g, '\n')
    .split(/\n\s*GO\s*\n/gi)
    .map(s => s.trim())
    .filter(Boolean);
}

async function ensureMigrationsTable(pool, sql) {
  await pool.request().batch(`
    IF OBJECT_ID('dbo.schema_migrations', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.schema_migrations (
        id INT IDENTITY(1,1) PRIMARY KEY,
        filename NVARCHAR(255) NOT NULL UNIQUE,
        applied_at DATETIME2(0) NOT NULL DEFAULT SYSDATETIME()
      );
    END
  `);
}

async function getApplied(pool, sql) {
  const r = await pool.request().query(`SELECT filename FROM dbo.schema_migrations;`);
  return new Set((r.recordset || []).map(x => x.filename));
}

async function applyOne(pool, sql, filename, fullpath) {
  const raw = fs.readFileSync(fullpath, 'utf8');
  const batches = splitSqlByGo(raw);

  const tx = new sql.Transaction(pool);
  await tx.begin();

  try {
    for (const b of batches) {
      await new sql.Request(tx).batch(b);
    }

    await new sql.Request(tx)
      .input('filename', sql.NVarChar(255), filename)
      .query(`INSERT INTO dbo.schema_migrations(filename) VALUES (@filename);`);

    await tx.commit();
  } catch (e) {
    try { await tx.rollback(); } catch {}
    throw e;
  }
}

async function runMigrations({ pool, sql, migrationsDir }) {
  await ensureMigrationsTable(pool, sql);

  const applied = await getApplied(pool, sql);

  if (!fs.existsSync(migrationsDir)) {
    return { ok: true, applied: [], pending: [] };
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.toLowerCase().endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en'));

  const pending = files.filter(f => !applied.has(f));
  const appliedNow = [];

  for (const f of pending) {
    const fullpath = path.join(migrationsDir, f);
    await applyOne(pool, sql, f, fullpath);
    appliedNow.push(f);
  }

  return { ok: true, applied: appliedNow, pending };
}

module.exports = { runMigrations };
