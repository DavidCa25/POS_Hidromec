/**
 * Reparte las sentencias de `sql/schema/tables/` en fases de aplicacion.
 *
 * Hace falta porque una FK no puede crearse antes que la tabla a la que
 * apunta, y los archivos estan organizados por tabla, no por dependencia.
 *
 * Se clasifica por lo que HACE la sentencia, no por el marcador que la
 * envuelve: las constraints que en origen no tenian nombre se emiten sin
 * guarda `IF OBJECT_ID`, y clasificarlas por la guarda las mandaba a la fase
 * de tablas — creando una FK antes que la tabla referenciada.
 */
export const ORDEN = ['tabla', 'check', 'fk', 'indice'];

export function fases(sql) {
  const bloques = sql.replace(/\r\n/g, '\n').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  const r = { tabla: [], check: [], fk: [], indice: [] };
  for (const b of bloques) {
    const codigo = b.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (!codigo) continue;                                   // solo comentario
    if (/\bFOREIGN\s+KEY\b/i.test(codigo)) r.fk.push(b);
    else if (/^\s*(IF[\s\S]*?)?ALTER\s+TABLE[\s\S]*\bCHECK\b/i.test(codigo)) r.check.push(b);
    else if (/\bCREATE\s+(UNIQUE\s+)?(NON)?CLUSTERED\s+INDEX\b/i.test(codigo)) r.indice.push(b);
    else r.tabla.push(b);
  }
  return r;
}
