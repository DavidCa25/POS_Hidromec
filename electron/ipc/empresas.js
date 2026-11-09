'use strict';
/*
 * MULTIEMPRESA (0080). docs/multiempresa.md.
 *
 *   empresas:listar        la empresa activa y las del grupo a las que esta
 *                          persona puede entrar (locales y, con nube, remotas)
 *   empresas:cambiar       entrar a otra empresa LOCAL del grupo
 *   empresas:resumen       Mis empresas: lo de cada una en un periodo
 *   empresas:crear         dar de alta una empresa en esta computadora
 *   empresas:desvincular   sacar una empresa del grupo (no borra nada)
 *
 *   En otra computadora, por la nube (Fases 2 y 3):
 *   empresas:enlace-codigo   código para que otra empresa se una al grupo
 *   empresas:enlace-unir     escribir el código de otra empresa
 *   empresas:enlace-salir    sacar a ESTA empresa del grupo de la nube
 *   empresas:remota-catalogo lo que vende otra empresa (su catálogo publicado)
 *   empresas:remota-pedir    pedirle un alta de producto o un cambio de precio
 *   empresas:remota-pedidos  lo que esta empresa pidió y en qué quedó
 *   empresas:recibidos       lo que otras empresas cambiaron aquí (bitácora)
 *
 * Quien actúa sale de la sesión, nunca del payload. Las reglas viven en
 * electron/empresas/ y en SQL; aquí solo se traduce.
 */
const sesion = require('../seguridad/sesion');
const { BUNDLES } = require('../seguridad/permisos');

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const fechaOpcional = (v) => {
  if (v == null || v === '') return null;
  const s = String(v).slice(0, 10);
  if (!FECHA.test(s)) throw new Error('Indica una fecha válida.');
  return s;
};

/** `{ success, data }` o `{ success: false, code, error }`: nunca un stack. */
async function seguro(fn) {
  try { return { success: true, data: await fn() }; }
  catch (e) { return { success: false, code: e.code ?? null, error: e.message || 'No se pudo completar.' }; }
}

/**
 * El cuerpo de un canal protegido, con sus partes por nombre.
 *
 * `sesion.proteger` agrega la sesión como ÚLTIMO argumento, así que un canal
 * que se invoca sin payload la recibe donde iría el payload. Se separan aquí,
 * una vez, para que ningún canal tenga que adivinar posiciones.
 */
function manejar(fn) {
  return (evento, ...resto) => {
    const s = resto.length ? resto[resto.length - 1] : null;
    const p = resto.length > 1 && resto[0] && typeof resto[0] === 'object' ? resto[0] : {};
    return seguro(() => fn({ evento, p, s }));
  };
}

/**
 * @param {object} deps
 *   ipcMain
 *   locales     crearLocales()
 *   cambio      crearCambio()
 *   alta        crearAlta()
 *   remotas     crearRemotas() o null (sin nube)
 *   permisosEn(base, fila)   los permisos de esa persona en esa base
 *   alCrear(base)            después de un alta (heredar la config del equipo)
 *   licenciaDe(base)         0082: { modo, diasRestantes?, hasta? } de esa empresa
 */
function registrar({ ipcMain, locales, cambio, alta, remotas = null, permisosEn, alCrear = () => {},
                     licenciaDe = () => ({ modo: 'PRINCIPAL' }) }) {
  /** Las locales donde esta persona existe y PUEDE cambiar (para no quedar atrapada). */
  async function localesPara(usuario) {
    const todas = await locales.listar(usuario);
    const salida = [];
    for (const e of todas) {
      if (!e.user_id) continue;
      const permisos = await permisosEn(e.base, { id: e.user_id, rol: e.rol });
      salida.push({ ...e, puedeEntrar: e.esEsta || permisos.has(BUNDLES.EMPRESAS_CAMBIAR), licencia: licenciaDe(e.base) });
    }
    return salida;
  }

  /** Los de la nube: sin nube configurada, lo dicen con su código. */
  const conNube = (fn) => (args) => {
    if (!remotas) { const e = new Error('Esta caja no tiene la nube configurada.'); e.code = 'NO_CLOUD'; throw e; }
    return fn(args);
  };

  ipcMain.handle('empresas:listar', sesion.proteger('empresas:listar', manejar(async ({ s }) => {
    const lista = await localesPara(s.usuario);
    let remotasDelGrupo = [];
    if (remotas) {
      try { remotasDelGrupo = await remotas.listar(); }
      catch (e) { if (e.code !== 'NO_CLOUD') throw e; }
    }
    return {
      activa: lista.find(e => e.esEsta) ?? null,
      locales: lista.filter(e => !e.esEsta && e.puedeEntrar),
      remotas: remotasDelGrupo,
      administra: s.permisos.has(BUNDLES.CONFIGURACION_ADMINISTRAR),
    };
  })));

  ipcMain.handle('empresas:cambiar', sesion.proteger('empresas:cambiar', manejar(({ evento, p, s }) => {
    const base = String(p.base || '').trim();
    if (!base) throw new Error('Elige la empresa.');
    return cambio.cambiar({ webContentsId: evento.sender.id, base, usuario: s.usuario });
  })));

  ipcMain.handle('empresas:resumen', sesion.proteger('empresas:resumen', manejar(async ({ p, s }) => {
    const desde = fechaOpcional(p.desde);
    const hasta = fechaOpcional(p.hasta) ?? desde;
    const localesFilas = await locales.resumen({ desde, hasta }, s.usuario);
    let remotasFilas = [];
    if (remotas) {
      try { remotasFilas = await remotas.resumen({ desde, hasta }); }
      catch (e) { if (e.code !== 'NO_CLOUD') remotasFilas = [{ error: e.message }]; }
    }
    return { desde, hasta, locales: localesFilas, remotas: remotasFilas };
  })));

  ipcMain.handle('empresas:crear', sesion.proteger('empresas:crear', manejar(async ({ p, s }) => {
    const r = await alta.crear({ nombre: p.nombre, giro: p.giro, rfc: p.rfc, usuario: s.usuario });
    await alCrear(r.base);
    return r;
  })));

  ipcMain.handle('empresas:desvincular', sesion.proteger('empresas:desvincular',
    manejar(({ p }) => locales.desvincular(String(p.base || '')))));

  // ------------------------------------- empresas en otra computadora (nube)
  ipcMain.handle('empresas:enlace-codigo', sesion.proteger('empresas:enlace-codigo', manejar(conNube(() => remotas.codigo()))));
  ipcMain.handle('empresas:enlace-unir', sesion.proteger('empresas:enlace-unir', manejar(conNube(({ p }) => remotas.unir(p.codigo)))));
  ipcMain.handle('empresas:enlace-salir', sesion.proteger('empresas:enlace-salir', manejar(conNube(() => remotas.salir()))));
  ipcMain.handle('empresas:remota-catalogo', sesion.proteger('empresas:remota-catalogo',
    manejar(conNube(({ p }) => remotas.catalogo(String(p.companyId || ''))))));
  ipcMain.handle('empresas:remota-pedir', sesion.proteger('empresas:remota-pedir', manejar(conNube(({ p, s }) => remotas.pedir({
    companyId: String(p.companyId || ''), tipo: String(p.tipo || ''), datos: p.datos || {},
    claveCliente: String(p.claveCliente || ''), usuario: s.usuario,
  })))));
  ipcMain.handle('empresas:remota-pedidos', sesion.proteger('empresas:remota-pedidos', manejar(conNube(() => remotas.pedidos()))));
  ipcMain.handle('empresas:recibidos', sesion.proteger('empresas:recibidos', manejar(conNube(() => remotas.recibidos()))));
}

module.exports = { registrar, manejar };
