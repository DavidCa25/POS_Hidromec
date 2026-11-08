'use strict';
/**
 * DAR DE ALTA UNA EMPRESA EN ESTA COMPUTADORA.
 *
 * Una empresa nueva es una base nueva en el MISMO SQL Server, nacida de la
 * misma plantilla que una instalación nueva y migrada con las mismas
 * migraciones. No hay un camino aparte: lo que ya prueba el instalador es lo
 * que crea la segunda empresa.
 *
 *   1. Nombre de base libre:  Wybix_POS_<Nombre>  (y _2, _3... si existe).
 *   2. Restaurar la plantilla con la conexión de Windows (la del instalador).
 *   3. Dar acceso a los MISMOS logins que operan la empresa actual: las cajas
 *      secundarias entran con el suyo y deben ver la nueva igual.
 *   4. Migrar y dar de alta el negocio (sp_setup_inicial), con el MISMO
 *      administrador: su contraseña se copia como hash, nunca viaja en claro.
 *   5. Poner las dos bases en el mismo grupo.
 *
 * Si algo falla después de restaurar, la base a medias se borra: una empresa
 * que no terminó de nacer no aparece en el selector ni ocupa disco.
 *
 * Solo en la computadora que tiene SQL Server (la principal) y solo con la
 * identidad de Windows que lo administra: el login de la aplicación no puede
 * crear bases, y no debe poder.
 *
 * Todas las dependencias se inyectan: scripts/pruebas/empresas.test.mjs.
 */
const crypto = require('crypto');
const { ErrorEmpresa } = require('./cambio');

const PREFIJO = 'Wybix_POS_';
const GIROS = new Set(['RETAIL', 'HOSPITALITY']);

/** "Los Pachoncitos" -> "LosPachoncitos". Solo letras y números, como nombre de base. */
function sufijoDeBase(nombre) {
  const plano = String(nombre || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const partes = plano.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const sufijo = partes.map(p => p[0].toUpperCase() + p.slice(1)).join('').slice(0, 40);
  if (!sufijo) throw new ErrorEmpresa('El nombre necesita al menos una letra o número.', 'BAD_NAME');
  return sufijo;
}

function validar({ nombre, giro, rfc }) {
  const n = String(nombre || '').trim();
  if (n.length < 2 || n.length > 120) throw new ErrorEmpresa('Escribe el nombre de la empresa (de 2 a 120 letras).', 'BAD_NAME');
  const g = String(giro || 'RETAIL').trim().toUpperCase();
  if (!GIROS.has(g)) throw new ErrorEmpresa('Elige si es tienda o restaurante.', 'BAD_PROFILE');
  const r = rfc ? String(rfc).trim().toUpperCase() : null;
  if (r && !/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(r)) throw new ErrorEmpresa('El RFC no tiene un formato válido.', 'BAD_RFC');
  return { nombre: n, giro: g, rfc: r };
}

/**
 * @param {object} deps
 *   sql                          el módulo mssql (tipos)
 *   poolActual()                 la conexión de la empresa activa
 *   servidor()                   el servidor de SQL de esta instalación
 *   esServidorLocal()            ¿SQL Server está en esta computadora?
 *   conectarMaster(server)       conexión de Windows a master
 *   conectarBase(server, base)   conexión de Windows a una base
 *   restaurarPlantilla(master, base)
 *   asegurarPermisos(server, base)   rol de la app + REFERENCES (setupServer)
 *   migrar(pool)                 runMigrations sobre esa base
 *   grupoActual()                { grupo, base, bases } de la empresa activa (locales.js)
 *   escribirGrupo(grupo, bases, { en })   la membresía en cada base (locales.js)
 *   log
 */
function crearAlta(deps) {
  const { sql, poolActual, servidor, esServidorLocal, conectarMaster, conectarBase,
          restaurarPlantilla, asegurarPermisos, migrar, grupoActual, escribirGrupo, log = () => {} } = deps;

  async function baseLibre(master, sufijo) {
    for (let i = 1; i < 100; i++) {
      const base = PREFIJO + sufijo + (i > 1 ? `_${i}` : '');
      const r = await master.request().input('n', sql.NVarChar(128), base).query('SELECT DB_ID(@n) AS id');
      if (r.recordset[0].id == null) return base;
    }
    throw new ErrorEmpresa('Ya hay demasiadas empresas con ese nombre.', 'BAD_NAME');
  }

  /** Los logins de SQL que operan la empresa actual (miembros del rol de la app). */
  async function loginsDeLaApp(pool) {
    const r = await pool.request().query(`
      SELECT u.name
        FROM sys.database_role_members rm
        JOIN sys.database_principals r ON r.principal_id = rm.role_principal_id AND r.name = N'ocus_app_full_role'
        JOIN sys.database_principals u ON u.principal_id = rm.member_principal_id AND u.type = 'S'
        JOIN sys.server_principals  l ON l.sid = u.sid;`);
    return r.recordset.map(x => x.name);
  }

  async function darAcceso(nueva, logins) {
    for (const login of logins) {
      await nueva.request().input('l', sql.NVarChar(128), login).query(`
        DECLARE @q NVARCHAR(MAX) =
          N'IF USER_ID(' + QUOTENAME(@l, '''') + N') IS NULL CREATE USER ' + QUOTENAME(@l) + N' FOR LOGIN ' + QUOTENAME(@l) + N';'
        + N' ALTER ROLE [ocus_app_full_role] ADD MEMBER ' + QUOTENAME(@l) + N';';
        EXEC (@q);`);
    }
  }

  /* SQL Express crea las bases con AUTO_CLOSE: cada vez que alguien las mira
     tardan en abrirse. Las del grupo se miran seguido (selector, Mis
     empresas), así que se quedan abiertas. */
  async function sinAutoClose(master, bases) {
    for (const b of bases) {
      await master.request().batch(`IF DB_ID(N'${b.replace(/'/g, "''")}') IS NOT NULL ALTER DATABASE ${'[' + b.replace(/]/g, ']]') + ']'} SET AUTO_CLOSE OFF;`);
    }
  }

  /**
   * @param {{nombre, giro, rfc, usuario}} pedido  usuario = el administrador que la crea (de la sesión)
   */
  async function crear(pedido) {
    const datos = validar(pedido);
    if (!esServidorLocal()) {
      throw new ErrorEmpresa('Da de alta la empresa desde la computadora principal: es la que tiene SQL Server.', 'NOT_PRIMARY');
    }
    const server = servidor();
    const actual = await poolActual();

    const admin = (await actual.request().input('u', sql.NVarChar(50), pedido.usuario)
      .query('SELECT usuario, password_hash FROM dbo.users WHERE usuario = @u AND active = 1')).recordset[0];
    if (!admin) throw new ErrorEmpresa('Tu usuario no está activo en esta empresa.', 'NO_USER');

    const yo = await grupoActual();
    const grupo = yo.grupo || crypto.randomUUID();
    const miembros = yo.grupo && yo.bases.length ? yo.bases : [yo.base];
    const logins = await loginsDeLaApp(actual);

    const master = await conectarMaster(server);
    let base = null;
    let nueva = null;
    try {
      base = await baseLibre(master, sufijoDeBase(datos.nombre));
      log(`[EMPRESA] alta de ${datos.nombre} en ${base}`);
      await restaurarPlantilla(master, base);
      await asegurarPermisos(server, base);

      nueva = await conectarBase(server, base);
      await darAcceso(nueva, logins);
      await migrar(nueva);

      /* El alta del negocio exige una contraseña; se da una al azar que nadie
         conoce y en la misma conexión se sustituye por el hash del
         administrador que la crea. Entra con la contraseña de siempre. */
      await nueva.request()
        .input('usuario', sql.NVarChar(50), admin.usuario)
        .input('password', sql.NVarChar(100), crypto.randomBytes(24).toString('base64'))
        .input('business_name', sql.NVarChar(200), datos.nombre)
        .input('address', sql.NVarChar(300), null)
        .input('phone', sql.NVarChar(50), null)
        .input('rfc', sql.NVarChar(50), datos.rfc)
        .input('business_profile', sql.NVarChar(20), datos.giro)
        .execute('sp_setup_inicial');
      await nueva.request()
        .input('u', sql.NVarChar(50), admin.usuario)
        .input('h', sql.NVarChar(255), admin.password_hash)
        .query('UPDATE dbo.users SET password_hash = @h WHERE usuario = @u;');

      /* La nueva primero: si falla, las demás no llegan a conocerla. */
      const todas = [...miembros, base];
      await escribirGrupo(grupo, todas, { en: [base, ...miembros] });
      await sinAutoClose(master, todas);
    } catch (e) {
      log(`[EMPRESA] el alta falló (${e.message}); se borra ${base || 'nada'}.`);
      if (nueva) { try { await nueva.close(); } catch { /* noop */ } nueva = null; }
      if (base) {
        try {
          await master.request().batch(
            `IF DB_ID(N'${base}') IS NOT NULL BEGIN ALTER DATABASE [${base}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${base}]; END`);
        } catch (e2) { log(`[EMPRESA] no se pudo borrar ${base}: ${e2.message}`); }
      }
      throw e instanceof ErrorEmpresa ? e : new ErrorEmpresa(`No se pudo dar de alta la empresa: ${e.message}`, 'CREATE_FAILED');
    } finally {
      if (nueva) { try { await nueva.close(); } catch { /* noop */ } }
      try { await master.close(); } catch { /* noop */ }
    }
    return { base, nombre: datos.nombre, giro: datos.giro, grupo };
  }

  return { crear };
}

module.exports = { crearAlta, sufijoDeBase, validar, PREFIJO };
