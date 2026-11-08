'use strict';
/**
 * CAMBIAR DE EMPRESA, DE PRINCIPIO A FIN.
 *
 *   1. Comprobar ANTES de tocar nada que la otra empresa existe en este grupo
 *      y que la persona puede entrar ahí (mismo usuario, activo, con permiso).
 *   2. Detener los servicios de la empresa actual.
 *   3. Apuntar la conexión a la otra base y prepararla (migraciones, objetos).
 *   4. Olvidar lo memorizado de la anterior.
 *   5. Abrir la sesión de la persona en la nueva, con SUS permisos de ahí.
 *   6. Iniciar los servicios y recargar la ventana.
 *
 * Si 3 o 5 fallan se vuelve a la empresa anterior y se reinician sus
 * servicios: la caja nunca queda a medias, conectada a una base y con la
 * sesión o los servicios de otra.
 *
 * Un cambio a la vez: un segundo pedido mientras el primero trabaja se
 * rechaza (BUSY) en vez de cruzarse con él.
 *
 * Todas las dependencias se inyectan: scripts/pruebas/empresas.test.mjs.
 */

class ErrorEmpresa extends Error {
  constructor(mensaje, code) { super(mensaje); this.code = code; }
}

/**
 * @param {object} deps
 *   ciclo                        crearCiclo()
 *   baseActiva()                 la base de la conexión actual
 *   empresasPara(usuario)        las locales del grupo, con user_id/rol de ese usuario
 *   conectar(base)               apunta la conexión a esa base (persiste la elección)
 *   prepararBase()               migraciones y objetos críticos de la base actual
 *   abrirSesion(webContentsId, base, usuario)   sesión en la base actual; lanza si no puede
 *   puedeCambiar(fila)           ¿con esos rol/permisos de destino puede usar MultiEmpresa?
 *   recargar(webContentsId)      recarga la ventana
 *   log, logError
 */
function crearCambio(deps) {
  const { ciclo, baseActiva, empresasPara, conectar, prepararBase, abrirSesion, puedeCambiar, recargar,
          log = () => {}, logError = () => {} } = deps;

  let enCurso = null;

  async function destinoValido(base, usuario) {
    const empresas = await empresasPara(usuario);
    const destino = empresas.find(e => String(e.base).toLowerCase() === String(base).toLowerCase());
    if (!destino) throw new ErrorEmpresa('Esa empresa no es de este grupo.', 'NOT_IN_GROUP');
    if (!destino.user_id) {
      throw new ErrorEmpresa(`Tu usuario no existe o está inactivo en ${destino.nombre || destino.base}.`, 'NO_USER');
    }
    if (!(await puedeCambiar(destino))) {
      throw new ErrorEmpresa(`En ${destino.nombre || destino.base} tu usuario no puede cambiar de empresa.`, 'DENIED');
    }
    return destino;
  }

  async function ejecutar({ webContentsId, base, usuario }) {
    const anterior = baseActiva();
    if (String(anterior).toLowerCase() === String(base).toLowerCase()) {
      return { cambiada: false, base: anterior };
    }
    const destino = await destinoValido(base, usuario);

    log(`[EMPRESA] ${anterior} -> ${destino.base} (${usuario})`);
    await ciclo.detenerTodo();

    try {
      await conectar(destino.base);
      await prepararBase();
      ciclo.olvidarTodo();
      await abrirSesion(webContentsId, destino.base, usuario);
    } catch (e) {
      logError(`[EMPRESA] no se pudo abrir ${destino.base}: ${e.message}. Se vuelve a ${anterior}.`);
      await volver(webContentsId, anterior, usuario);
      throw new ErrorEmpresa(`No se pudo abrir ${destino.nombre || destino.base}: ${e.message}`, e.code || 'SWITCH_FAILED');
    }

    await ciclo.iniciarTodo();
    recargar(webContentsId);
    return { cambiada: true, base: destino.base, nombre: destino.nombre };
  }

  /** La vuelta atrás. Lo que falle aquí se registra: no hay a dónde más volver. */
  async function volver(webContentsId, anterior, usuario) {
    try {
      await conectar(anterior);
      ciclo.olvidarTodo();
      await abrirSesion(webContentsId, anterior, usuario);
    } catch (e) {
      logError(`[EMPRESA] tampoco se pudo volver a ${anterior}: ${e.message}`);
    }
    await ciclo.iniciarTodo();
  }

  async function cambiar(pedido) {
    if (enCurso) throw new ErrorEmpresa('Ya se está cambiando de empresa. Espera a que termine.', 'BUSY');
    enCurso = ejecutar(pedido);
    try { return await enCurso; } finally { enCurso = null; }
  }

  return { cambiar };
}

module.exports = { crearCambio, ErrorEmpresa };
