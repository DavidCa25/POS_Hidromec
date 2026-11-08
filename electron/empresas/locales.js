'use strict';
/**
 * LAS EMPRESAS DEL GRUPO QUE VIVEN EN ESTE SERVIDOR.
 *
 * Quiénes son (`sp_empresas_locales`), qué vendieron (`sp_empresas_resumen`,
 * que cada base responde de sí misma) y mantenerlas al día: una empresa que no
 * está activa también se migra al arrancar, para que Mis empresas y el cambio
 * no se encuentren una base de una versión anterior.
 *
 * Para leer otra base se abre una conexión aparte con las MISMAS credenciales
 * que la de la aplicación y se cierra al terminar. La conexión de la
 * aplicación nunca deja de apuntar a la empresa activa.
 *
 * Todas las dependencias se inyectan: scripts/pruebas/empresas.test.mjs.
 */

/** Un nombre de base como identificador de SQL: entre corchetes, escapado. */
function corchetes(base) {
  return '[' + String(base).replace(/]/g, ']]') + ']';
}

/**
 * @param {object} deps
 *   sql                 mssql (tipos y ConnectionPool)
 *   pool()              la conexión de la empresa activa
 *   migrar(pool)        runMigrations sobre esa conexión
 *   logError
 */
function crearLocales({ sql, pool, migrar, logError = () => {} }) {
  /** Las empresas del grupo en este servidor, con el usuario de esa persona en cada una. */
  async function listar(usuario = null) {
    const p = await pool();
    const r = await p.request().input('usuario', sql.NVarChar(50), usuario).execute('sp_empresas_locales');
    return (r.recordset || []).map(e => ({
      base: e.base, nombre: e.nombre || e.base, giro: e.giro,
      user_id: e.user_id ?? null, rol: e.rol ?? null, esEsta: !!e.es_esta,
      instancia: e.instance_uuid ? String(e.instance_uuid).toLowerCase() : null,
    }));
  }

  /** Una conexión aparte a otra base, con las credenciales de la aplicación. */
  async function conOtraBase(base, fn) {
    const p = await pool();
    const otra = new sql.ConnectionPool({ ...p.config, database: base, pool: { max: 1, min: 0 } });
    await otra.connect();
    try { return await fn(otra); }
    finally { try { await otra.close(); } catch { /* noop */ } }
  }

  /**
   * Lo de cada empresa en el periodo. Una base que no responde aparece con su
   * error, no tumba a las demás: el dueño ve que esa no contestó.
   */
  async function resumen({ desde = null, hasta = null } = {}, usuario = null) {
    const empresas = (await listar(usuario)).filter(e => e.user_id);
    const p = await pool();
    const filas = [];
    for (const e of empresas) {
      try {
        const r = await p.request()
          .input('desde', sql.Date, desde).input('hasta', sql.Date, hasta)
          .query(`EXEC ${corchetes(e.base)}.dbo.sp_empresas_resumen @desde = @desde, @hasta = @hasta;`);
        filas.push({ ...e, ...normalizar(r.recordset?.[0]), error: null });
      } catch (err) {
        logError(`[EMPRESA] resumen de ${e.base}: ${err.message}`);
        filas.push({ ...e, ...normalizar(null), error: 'No respondió.' });
      }
    }
    return filas;
  }

  /** Migra las OTRAS empresas del grupo. La activa ya la migró el arranque. */
  async function migrarLasDemas() {
    const resultado = [];
    for (const e of (await listar()).filter(x => !x.esEsta)) {
      try {
        await conOtraBase(e.base, migrar);
        resultado.push({ base: e.base, ok: true });
      } catch (err) {
        logError(`[EMPRESA] no se pudo migrar ${e.base}: ${err.message}`);
        resultado.push({ base: e.base, ok: false, error: err.message });
      }
    }
    return resultado;
  }

  /**
   * Los permisos extra (0056) de una persona en OTRA base del grupo. Con su
   * rol de ahí, deciden si puede entrar y cambiar desde ahí. Una base sin la
   * tabla (anterior a 0056) no tiene extras.
   */
  async function extrasEn(base, userId) {
    const p = await pool();
    const tabla = `${corchetes(base)}.dbo.user_permissions`;
    const r = await p.request().input('id', sql.Int, userId)
      .query(`IF OBJECT_ID(N'${tabla.replace(/'/g, "''")}', N'U') IS NOT NULL SELECT permiso FROM ${tabla} WHERE user_id = @id;`);
    return (r.recordset || []).map(x => x.permiso);
  }

  /** El grupo de la empresa activa y las bases que conoce (sp_empresas_grupo). */
  async function grupoActual() {
    const r = await (await pool()).request().execute('sp_empresas_grupo');
    const yo = r.recordsets?.[0]?.[0] ?? {};
    return { grupo: yo.grupo ? String(yo.grupo).toLowerCase() : null, base: yo.base,
             bases: (r.recordsets?.[1] ?? []).map(x => x.base) };
  }

  /**
   * Escribe la membresía en CADA base indicada: el grupo y la lista completa
   * de sus bases. Es el único sitio que la cambia, para que todos los miembros
   * tengan siempre la misma lista. `grupo` null saca a esas bases del grupo.
   */
  async function escribirGrupo(grupo, bases, { en = bases } = {}) {
    const activa = (await grupoActual()).base;
    const fijar = (p) => p.request()
      .input('grupo', sql.UniqueIdentifier, grupo)
      .input('bases', sql.NVarChar(sql.MAX), grupo ? JSON.stringify(bases) : null)
      .execute('sp_empresas_grupo_fijar');
    for (const base of en) {
      if (String(base).toLowerCase() === String(activa).toLowerCase()) await fijar(await pool());
      else await conOtraBase(base, fijar);
    }
  }

  /**
   * Saca una empresa del grupo. No borra nada: sigue operando sola. Las que
   * quedan dejan de tenerla en su lista.
   */
  async function desvincular(base) {
    const { grupo, bases } = await grupoActual();
    const sale = bases.find(b => String(b).toLowerCase() === String(base).toLowerCase());
    if (!grupo || !sale) throw new Error('Esa empresa no es de este grupo.');
    const quedan = bases.filter(b => b !== sale);
    await escribirGrupo(null, [sale]);
    if (quedan.length) await escribirGrupo(grupo, quedan);
    return { base: sale };
  }

  return { listar, resumen, migrarLasDemas, desvincular, extrasEn, conOtraBase, grupoActual, escribirGrupo };
}

function normalizar(f) {
  const n = (v) => Number(v) || 0;
  return {
    ventas: n(f?.ventas), tickets: n(f?.tickets), utilidad: n(f?.utilidad),
    turnosAbiertos: n(f?.turnos_abiertos), efectivoEnCaja: n(f?.efectivo_en_caja),
    ultimaVenta: f?.ultima_venta ?? null,
  };
}

module.exports = { crearLocales, corchetes };
