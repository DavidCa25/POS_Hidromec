'use strict';
/**
 * LAS EMPRESAS DEL GRUPO EN OTRA COMPUTADORA, vistas desde aquí.
 *
 * Une lo que sabe la nube (electron/nube/grupo-empresas.js) con lo que hay en
 * este servidor: una empresa que es LOCAL no se muestra también como remota
 * aunque esté en el grupo de la nube (misma instancia). La local se abre; la
 * remota solo se consulta y se le piden cambios.
 *
 * Todas las dependencias se inyectan: scripts/pruebas/empresas.test.mjs.
 */

/**
 * @param {object} deps
 *   cloudSync   con `grupo` (crearGrupoEmpresas)
 *   locales     crearLocales()
 *   logError
 */
function crearRemotas({ cloudSync, locales, logError = () => {} }) {
  const grupo = () => cloudSync.grupo;

  /** Las del grupo de la nube que NO viven en este servidor. */
  async function listar() {
    const [nube, aqui] = await Promise.all([grupo().listar(), locales.listar()]);
    const instanciasLocales = new Set(aqui.map(e => e.instancia).filter(Boolean));
    return nube.filter(e => !e.instancias.some(i => instanciasLocales.has(i)));
  }

  /** Mis empresas: el resumen de cada remota. Una que no responde lleva su error. */
  async function resumen(periodo) {
    const filas = [];
    for (const e of await listar()) {
      try {
        filas.push({ nombre: e.nombre, ...(await grupo().resumen(e.companyId, periodo)), error: null });
      } catch (err) {
        logError(`[EMPRESA] resumen remoto de ${e.nombre}: ${err.message}`);
        filas.push({ nombre: e.nombre, companyId: e.companyId, ultimaSync: e.ultimaSync, error: err.message });
      }
    }
    return filas;
  }

  return {
    listar, resumen,
    codigo: () => grupo().codigo(),
    unir: (codigo) => grupo().unir(codigo),
    salir: () => grupo().salir(),
    catalogo: (companyId) => grupo().catalogo(companyId),
    pedir: (pedido) => grupo().pedir(pedido),
    pedidos: () => grupo().pedidos(),
    recibidos: () => grupo().recibidos(),
  };
}

module.exports = { crearRemotas };
