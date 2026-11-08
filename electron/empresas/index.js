'use strict';
/**
 * MULTIEMPRESA: arma las piezas con lo que main.js ya tiene.
 *
 *   ambito.js    de qué empresa es cada archivo de configuración
 *   ciclo.js     servicios y memorias de la empresa activa
 *   locales.js   las empresas del grupo en este servidor y su resumen
 *   cambio.js    entrar a otra empresa local, con vuelta atrás
 *   alta.js      dar de alta una empresa en esta computadora
 *   remotas.js   las empresas del grupo en otras computadoras, por la nube
 *
 * main.js solo llama a `crearEmpresas` y registra sus canales. Ninguna regla
 * de MultiEmpresa vive en main.js. docs/multiempresa.md.
 */
const fs = require('fs');
const path = require('path');
const { crearLocales, corchetes } = require('./locales');
const { crearCambio, ErrorEmpresa } = require('./cambio');
const { crearAlta } = require('./alta');
const { crearRemotas } = require('./remotas');

/**
 * @param {object} d
 *   sql, db, poolPromise, ciclo, sesion, permisos, ambito
 *   setupServer, servidorEsLocal, migrar(pool), prepararBase(pool)
 *   carpetaDeRespaldos()         donde SQL Server lee y escribe archivos
 *   cloudSync                    la nube de la empresa activa
 *   recargarVentana(wcId)
 */
function crearEmpresas(d) {
  const pool = () => d.poolPromise;
  const baseActiva = () => d.db.getConnectionConfig().database;

  const locales = crearLocales({ sql: d.sql, pool, migrar: d.migrar, logError: console.error });

  /** Los permisos de una persona en una base del grupo, con su rol y extras de ahí. */
  async function permisosEn(base, { id, rol }) {
    const extras = await locales.extrasEn(base, id);
    return d.permisos.permisosDeUsuario(rol, extras);
  }

  const cambio = crearCambio({
    ciclo: d.ciclo,
    baseActiva,
    empresasPara: (usuario) => locales.listar(usuario),
    async conectar(base) {
      const r = await d.db.setConnectionConfig({ database: base });
      if (!r.success) throw new ErrorEmpresa(r.error, 'CONNECT_FAILED');
    },
    prepararBase: async () => d.prepararBase(await pool()),
    async abrirSesion(webContentsId, _base, usuario) {
      const p = await pool();
      const fila = (await p.request().input('u', d.sql.NVarChar(50), usuario)
        .query('SELECT id, usuario, rol, active, creation_date FROM dbo.users WHERE usuario = @u AND active = 1;')).recordset[0];
      if (!fila) throw new ErrorEmpresa('Tu usuario no está activo en esa empresa.', 'NO_USER');
      fila.extras = await locales.extrasEn(baseActiva(), fila.id);
      d.sesion.cerrar(webContentsId);
      await d.sesion.abrir(webContentsId, fila);
    },
    puedeCambiar: async (destino) =>
      (await permisosEn(destino.base, { id: destino.user_id, rol: destino.rol })).has(d.permisos.BUNDLES.EMPRESAS_CAMBIAR),
    recargar: d.recargarVentana,
    log: console.log,
    logError: console.error,
  });

  const alta = crearAlta({
    sql: d.sql,
    poolActual: pool,
    servidor: () => d.db.getConnectionConfig().server,
    esServidorLocal: () => d.servidorEsLocal(d.db.getConnectionConfig().server),
    conectarMaster: (server) => d.setupServer.connectMaster(server),
    conectarBase: (server, base) => d.setupServer.connectDb(server, base),
    restaurarPlantilla: (master, base) => restaurarDesdeCarpetaDeSql(master, base),
    async asegurarPermisos(server, base) {
      await d.setupServer.ensureRole(server, base);
      await d.setupServer.ensureSchemaPermissions(server, base);
    },
    migrar: d.migrar,
    grupoActual: () => locales.grupoActual(),
    escribirGrupo: (grupo, bases, opciones) => locales.escribirGrupo(grupo, bases, opciones),
    log: console.log,
  });

  /**
   * RESTORE lo ejecuta el SERVICIO de SQL Server, con su propia cuenta, y esa
   * cuenta no puede leer cualquier carpeta: la plantilla dentro del perfil de
   * un usuario falla con «RESTORE FILELIST is terminating abnormally». Se copia
   * antes a la carpeta de respaldos —que SQL Server ya debe poder escribir, y
   * por tanto leer, para respaldar— y se borra al terminar.
   */
  async function restaurarDesdeCarpetaDeSql(master, base) {
    const plantilla = d.setupServer.resolvePaths().templateBak;
    if (!fs.existsSync(plantilla)) throw new ErrorEmpresa('No se encontró la plantilla de Wybix para crear la empresa.', 'NO_TEMPLATE');
    const carpeta = d.carpetaDeRespaldos();
    fs.mkdirSync(carpeta, { recursive: true });
    const copia = path.join(carpeta, `_plantilla_${base}.bak`);
    fs.copyFileSync(plantilla, copia);
    try { await d.setupServer.restoreTemplate(master, base, copia); }
    finally { try { fs.unlinkSync(copia); } catch { /* noop */ } }
  }

  const remotas = d.cloudSync ?crearRemotas({ cloudSync: d.cloudSync, locales, logError: console.error }) : null;

  function registrarIpc(ipcMain) {
    require('../ipc/empresas').registrar({
      ipcMain, locales, cambio, alta, remotas, permisosEn,
      alCrear: (base) => d.ambito.heredarEquipo(baseActiva(), base),
    });
  }

  return { locales, cambio, alta, remotas, permisosEn, registrarIpc };
}

module.exports = { crearEmpresas, corchetes };
