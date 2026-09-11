/**
 * Forma canonica y checksum de una definicion SQL.
 *
 * EL PROBLEMA
 * `sys.sql_modules.definition` devuelve el texto EXACTO de la ultima sentencia
 * que creo o modifico el objeto. Eso significa que el mismo procedure puede
 * aparecer como `CREATE PROCEDURE` en una instalacion nueva y como
 * `ALTER PROCEDURE` en una donde se corrigio algo — con el cuerpo identico.
 * Comparar el texto crudo daria deriva falsa en cada instalacion.
 *
 * LA NORMALIZACION (deliberadamente conservadora)
 *   1. Fin de linea a `\n`. CRLF y LF son el mismo codigo.
 *   2. Se recorta el espacio al final de cada linea. Invisible y sin efecto.
 *   3. Se quitan lineas en blanco al principio y al final.
 *   4. El verbo inicial `CREATE` / `ALTER` / `CREATE OR ALTER` se unifica a
 *      `CREATE OR ALTER`, con UN SOLO espacio antes del tipo. Es el unico
 *      cambio sintactico que introduce esta fase, y es exactamente el que
 *      hace que un archivo sirva para instalar y para actualizar.
 *
 *      El espacio unico no es cosmetico, es obligatorio. SQL Server NO guarda
 *      `CREATE OR ALTER` en `sys.sql_modules.definition`: al ejecutarlo
 *      reescribe la cabecera segun lo que hizo realmente —`CREATE` si el
 *      objeto no existia, `ALTER` si ya existia— y RELLENA CON ESPACIOS para
 *      conservar la longitud del texto original. Asi, un mismo procedure
 *      aparece como:
 *
 *          CREATE   PROCEDURE dbo.x     (recien creado)
 *          ALTER     PROCEDURE dbo.x    (actualizado)
 *          CREATE OR ALTER PROCEDURE    (en el archivo de Git)
 *
 *      Comparar sin colapsar ese hueco daria deriva en TODAS las
 *      instalaciones. Verificado ejecutando un CREATE OR ALTER y leyendo la
 *      definicion de vuelta.
 *
 * LO QUE NO SE TOCA, A PROPOSITO
 *   - Sangria interior, saltos de linea internos, comentarios, mayusculas.
 *   - Espacios dentro de una linea.
 *
 * Colapsar espacios haria el checksum mas "estable", pero tambien lo volveria
 * ciego a cambios reales dentro de una cadena o de un comentario. Se prefiere
 * un falso positivo que obligue a mirar, a un falso negativo que oculte una
 * modificacion hecha a mano en produccion.
 */
import { createHash } from 'node:crypto';

/** Verbo de cabecera de un modulo programable. */
const CABECERA =
  /^\s*CREATE\s+OR\s+ALTER\s+(PROCEDURE|PROC|VIEW|FUNCTION|TRIGGER)\b|^\s*(CREATE|ALTER)\s+(PROCEDURE|PROC|VIEW|FUNCTION|TRIGGER)\b/i;

/**
 * Unifica el verbo a `CREATE OR ALTER`.
 *
 * OJO con el anclaje: muchas definiciones de Wybix empiezan con un bloque de
 * comentarios (`-- ====` / `-- Author:`) ANTES del CREATE. Anclar al inicio
 * del texto dejaria esos procedures sin convertir, y al reaplicarlos fallarian
 * con "ya existe un objeto con ese nombre". Se busca la primera linea que
 * empieza por el verbo, en modo multilinea, y se sustituye solo esa.
 */
export function aCreateOrAlter(sql) {
  const t = String(sql).replace(/\r\n/g, '\n');
  let hecho = false;
  return t.replace(
    /^([ \t]*)(?:CREATE[ \t]+OR[ \t]+ALTER|CREATE|ALTER)([ \t]+)(PROCEDURE|PROC|VIEW|FUNCTION|TRIGGER)\b/gim,
    (m, pre, _sep, tipo) => {
      if (hecho) return m;          // solo la cabecera, no menciones interiores
      hecho = true;
      // Un unico espacio, a proposito: ver la nota sobre el relleno de SQL Server.
      return `${pre}CREATE OR ALTER ${tipo.toUpperCase()}`;
    },
  );
}

/** Forma canonica sobre la que se calcula el checksum. */
export function normalizar(sql) {
  return aCreateOrAlter(sql)
    .split('\n')
    .map(l => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '') + '\n';
}

/** Checksum de la forma canonica. Es lo que compara la herramienta de deriva. */
export function checksum(sql) {
  return createHash('sha256').update(normalizar(sql), 'utf8').digest('hex').slice(0, 16);
}

/** ¿El texto empieza por un verbo de modulo reconocible? */
export function tieneCabecera(sql) {
  return CABECERA.test(String(sql).replace(/\r\n/g, '\n'));
}

/**
 * Envoltorio del archivo canonico.
 *
 * `SET ANSI_NULLS` y `SET QUOTED_IDENTIFIER` se emiten con el valor real que
 * tenia el modulo al compilarse (`sys.sql_modules`), porque afectan a la
 * semantica de las comparaciones con NULL y al tratamiento de las comillas.
 * Reaplicarlos mal cambiaria comportamiento sin tocar una sola linea del
 * cuerpo.
 */
export function envolver({ nombre, definicion, ansiNulls, quotedIdentifier }) {
  const cuerpo = normalizar(definicion);
  return [
    `/* ${nombre}`,
    ' * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.',
    ' * No editar en SSMS: modificar este archivo y crear una migracion.',
    ' */',
    `SET ANSI_NULLS ${ansiNulls ? 'ON' : 'OFF'};`,
    `SET QUOTED_IDENTIFIER ${quotedIdentifier ? 'ON' : 'OFF'};`,
    'GO',
    cuerpo.trimEnd(),
    'GO',
    '',
  ].join('\n');
}

/**
 * Recupera el cuerpo del modulo desde un archivo canonico envuelto.
 *
 * No se busca el verbo: hay definiciones que arrancan con comentarios y el
 * cuerpo empieza antes del CREATE. Se usa la forma del envoltorio, que es
 * conocida: cabecera de comentario, dos SET, un `GO`, cuerpo, `GO` final.
 */
export function desenvolver(texto) {
  const lineas = String(texto).replace(/\r\n/g, '\n').split('\n');
  const i = lineas.findIndex(l => /^GO\s*$/i.test(l));
  if (i < 0) return null;

  let fin = lineas.length;
  for (let j = lineas.length - 1; j > i; j--) {
    if (/^GO\s*$/i.test(lineas[j])) { fin = j; break; }
  }
  const cuerpo = lineas.slice(i + 1, fin).join('\n');
  return cuerpo.trim() ? normalizar(cuerpo) : null;
}
