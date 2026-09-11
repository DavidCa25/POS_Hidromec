/**
 * Comprobacion de arranque: ¿estan los objetos SQL sin los que Wybix no puede
 * operar?
 *
 * POR QUE EXISTE
 * Hasta ahora, si a una instalacion le faltaba un procedure, cada handler IPC
 * devolvia su error y la pantalla se quedaba vacia. El fallo era silencioso y
 * parecia un problema de datos, no de instalacion. Se han encontrado
 * instalaciones a las que les faltaban objetos durante meses sin que nadie lo
 * supiera.
 *
 * QUE COMPRUEBA
 * Solo la lista de `electron/objetos-criticos.json`, que genera
 * `scripts/db/extraer.mjs`. Es una comprobacion de PRESENCIA, no de contenido:
 * dos consultas a `sys` y nada mas. Comparar checksums de 108 objetos en cada
 * arranque costaria mas de lo que aporta; para eso esta `npm run db:verify`,
 * que se ejecuta cuando hace falta.
 *
 * QUE NO HACE
 * No crea nada, no corrige nada y no escribe en la base.
 */
const path = require('path');
const fs = require('fs');

function cargarLista() {
  const p = path.join(__dirname, 'objetos-criticos.json');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')).objetos || [];
  } catch (e) {
    console.error('[OBJETOS] No se pudo leer objetos-criticos.json:', e.message);
    return [];
  }
}

/**
 * @returns {Promise<{ok: boolean, faltantes: string[], comprobados: number}>}
 */
async function verificarObjetosCriticos(pool) {
  const lista = cargarLista();
  if (!lista.length) {
    // Sin lista no se puede afirmar nada. No se bloquea el arranque por eso:
    // seria peor dejar al negocio sin vender por un archivo de metadatos.
    return { ok: true, faltantes: [], comprobados: 0, sinLista: true };
  }

  const modulos = lista.filter(o => o.tipo === 'modulo').map(o => o.nombre);
  const tipos = lista.filter(o => o.tipo === 'tipo').map(o => o.nombre);

  const presentes = new Set();

  if (modulos.length) {
    const r = await pool.request().query(`
      SELECT name FROM sys.objects
       WHERE schema_id = SCHEMA_ID('dbo') AND type IN ('P','V','FN','IF','TF')
         AND name IN (${modulos.map(n => `'${n.replace(/'/g, "''")}'`).join(',')});`);
    for (const f of r.recordset) presentes.add(f.name);
  }
  if (tipos.length) {
    const r = await pool.request().query(`
      SELECT name FROM sys.table_types
       WHERE schema_id = SCHEMA_ID('dbo')
         AND name IN (${tipos.map(n => `'${n.replace(/'/g, "''")}'`).join(',')});`);
    for (const f of r.recordset) presentes.add(f.name);
  }

  const faltantes = lista.map(o => o.nombre).filter(n => !presentes.has(n));
  return { ok: faltantes.length === 0, faltantes, comprobados: lista.length };
}

module.exports = { verificarObjetosCriticos };
