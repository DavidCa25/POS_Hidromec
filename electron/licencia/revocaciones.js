/**
 * KIDs REVOCADOS QUE CONOCE ESTE EQUIPO. MONOTÓNICO: solo crece.
 *
 * Una clave de firma comprometida se anuncia en `revoked_kids` dentro de los
 * certificados nuevos (y las versiones nuevas del POS la traen en
 * llaves-publicas.js -> REVOCADAS). Desde que este equipo la conoce, nada
 * firmado con ella se acepta: ni certificados nuevos ni viejos.
 *
 * Vive APARTE de la licencia guardada a propósito. Liberar el equipo, borrar
 * la licencia o importar un archivo viejo NO la tocan: una revocación no se
 * puede «deshacer» cambiando de licencia. No hay ninguna operación que quite
 * un KID de la lista.
 */
const fs = require('fs');
const path = require('path');

const KID = /^[a-z0-9-]{1,40}$/i;

function crearRevocaciones({ archivo = null, fijas = [] } = {}) {
  let memoria = new Set(fijas.filter(k => KID.test(k)));

  function leerArchivo() {
    if (!archivo) return [];
    try {
      const o = JSON.parse(fs.readFileSync(archivo, 'utf8'));
      return Array.isArray(o?.kids) ? o.kids.filter(k => typeof k === 'string' && KID.test(k)) : [];
    } catch { return []; }
  }

  function leer() {
    for (const k of leerArchivo()) memoria.add(k);
    return [...memoria];
  }

  /** Suma KIDs. Nunca quita. */
  function agregar(kids = []) {
    const antes = new Set(leer());
    const nuevos = (kids || []).filter(k => typeof k === 'string' && KID.test(k) && !antes.has(k));
    if (!nuevos.length) return false;
    for (const k of nuevos) memoria.add(k);
    if (archivo) {
      try {
        fs.mkdirSync(path.dirname(archivo), { recursive: true });
        const tmp = `${archivo}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({ kids: [...memoria].sort(), actualizado: new Date().toISOString() }, null, 2));
        fs.renameSync(tmp, archivo);
      } catch { /* queda en memoria para esta sesión; el siguiente certificado lo vuelve a anunciar */ }
    }
    return true;
  }

  return { leer, agregar };
}

module.exports = { crearRevocaciones };
