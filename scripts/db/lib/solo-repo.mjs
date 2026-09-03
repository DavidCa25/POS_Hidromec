/**
 * Objetos cuyo codigo vive SOLO en el repositorio.
 *
 * La extraccion normal lee de la base, pero hay dos procedures que el codigo
 * invoca y que no existen en NINGUNA de las tres bases:
 *
 *   sp_cloud_daily_profit  cloudSync.js lo llama dentro de un try/catch con el
 *                          comentario "si el SP no existe aun, no rompe el
 *                          ciclo": nunca llego a desplegarse.
 *   sp_import_sales        importador de ventas, aun sin aplicar.
 *
 * Son el reflejo exacto de los huerfanos: alli el codigo estaba solo en la
 * base; aqui esta solo en el repositorio. En ambos casos falta la mitad.
 *
 * Se declaran aqui para que el arbol canonico quede completo y para que la
 * herramienta de deriva sepa que su ausencia en la base es ESPERADA hasta que
 * una migracion los aplique.
 */
export const SOLO_REPO = {
  sp_cloud_daily_profit: {
    fuente: 'sql/_heredado/utilidad.sql',
    dominio: 'cloud',
    nota: 'Nunca desplegado. cloudSync lo tolera ausente.',
  },
  sp_import_sales: {
    fuente: 'sql/_heredado/importador_ventas.sql',
    dominio: 'sales',
    nota: 'Nunca desplegado.',
  },
};

/** Extrae de un archivo suelto el bloque CREATE/ALTER de un procedure concreto. */
export function extraerDeArchivo(texto, nombre) {
  const t = String(texto).replace(/\r\n/g, '\n');
  const re = new RegExp(
    `^\\s*(?:CREATE|ALTER)(?:\\s+OR\\s+ALTER)?\\s+PROC(?:EDURE)?\\s+(?:\\[?dbo\\]?\\.)?\\[?${nombre}\\]?\\b`,
    'im',
  );
  const m = re.exec(t);
  if (!m) return null;
  const desde = t.slice(m.index);
  // Termina en el primer GO en su propia linea, o al final del archivo.
  const fin = desde.search(/^\s*GO\s*$/im);
  return (fin > 0 ? desde.slice(0, fin) : desde).trimEnd();
}
