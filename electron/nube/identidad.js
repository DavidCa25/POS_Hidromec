'use strict';
/**
 * IDENTIDAD DE ESTE EQUIPO EN LA NUBE (Fase 1).
 *
 *   Company (negocios) -> OperationalLocation (sucursales) -> Device (devices)
 *
 * QUIÉN ES QUIÉN
 *   instance_uuid   la BASE de SQL Server de la sucursal (database_metadata).
 *                   Una base = una ubicación. Todas las cajas que comparten la
 *                   base (principal y secundarias) son la MISMA sucursal.
 *   device_uuid     ESTA computadora. Lo genera el propio POS y vive en su
 *                   configuración. El MachineGuid NO es identidad: solo viaja
 *                   su hash como huella informativa.
 *   install_secret  llave de instalación de la ubicación. La entrega la nube a
 *                   la caja principal y se guarda en database_metadata: quien
 *                   comparte la base puede unir su equipo a ESTA ubicación (y
 *                   solo a esta: la nube exige que la instancia coincida).
 *
 * FLUJOS
 *   principal, base nueva     bootstrap -> empresa + ubicación + equipo.
 *   principal, POS anterior   bootstrap con el token de sucursal -> conserva
 *                             SU empresa (no crea otra).
 *   principal reinstalada     enroll con la llave de instalación.
 *   secundaria                enroll con la llave de instalación (de la base).
 *   sucursal NUEVA (Norte)    enroll con el CÓDIGO que generó el dueño o la
 *                             principal de otra sucursal -> misma empresa.
 *
 * Nada aquí crea una empresa sola al arrancar: el alta ocurre cuando se activa
 * la nube o se usa la facturación (así una sucursal nueva puede unirse con su
 * código antes de que exista una empresa suelta).
 *
 * Todas las dependencias se inyectan: tests/unit/nube-identidad.test.js.
 */
const crypto = require('crypto');

class ErrorNube extends Error {
  constructor(mensaje, code) { super(mensaje); this.code = code; }
}

/** database_metadata vía SQL Server. */
function metadataSql({ pool, sql }) {
  const CLAVES = ['instance_uuid', 'company_uuid', 'location_uuid', 'install_secret', 'is_demo', 'server_fingerprint'];
  return {
    async asegurarInstancia() {
      // Instalaciones nuevas (restauradas del baseline) no la traen: cada base
      // genera la suya, nunca se hornea en la plantilla.
      await (await pool()).request().query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.database_metadata WHERE clave = 'instance_uuid')
          INSERT INTO dbo.database_metadata (clave, valor) VALUES ('instance_uuid', LOWER(CONVERT(NVARCHAR(36), NEWID())));`);
    },
    /**
     * Fase 2 · HUELLA DEL SERVIDOR: equipo + instancia de SQL Server + nombre
     * de la base. Una copia de esta base restaurada en OTRO servidor tiene
     * otra huella: la nube no la deja sincronizar como si fuera la original.
     */
    async huellaServidor() {
      const r = await (await pool()).request().query(`
        SELECT LOWER(CONVERT(VARCHAR(64), HASHBYTES('SHA2_256', CONCAT(
                 CONVERT(NVARCHAR(128), SERVERPROPERTY('MachineName')), N'|',
                 ISNULL(CONVERT(NVARCHAR(128), SERVERPROPERTY('InstanceName')), N'MSSQLSERVER'), N'|', DB_NAME())), 2)) AS fp;`);
      return r.recordset?.[0]?.fp ?? null;
    },
    async leer() {
      const r = await (await pool()).request().query(
        `SELECT clave, valor FROM dbo.database_metadata WHERE clave IN (${CLAVES.map(c => `'${c}'`).join(',')});`);
      const m = {};
      for (const f of r.recordset) m[f.clave] = f.valor;
      return m;
    },
    async escribir(valores) {
      for (const [clave, valor] of Object.entries(valores)) {
        if (!CLAVES.includes(clave) || valor == null) continue;
        await (await pool()).request()
          .input('clave', sql.NVarChar(64), clave)
          .input('valor', sql.NVarChar(255), String(valor))
          .query(`MERGE dbo.database_metadata AS t USING (SELECT @clave AS clave) s ON t.clave = s.clave
                  WHEN MATCHED THEN UPDATE SET valor = @valor, actualizado_en = SYSDATETIME()
                  WHEN NOT MATCHED THEN INSERT (clave, valor) VALUES (@clave, @valor);`);
      }
    },
  };
}

/**
 * deps = {
 *   meta: metadataSql(...) | doble,
 *   llamar(action, cuerpo, { token?, legado? }) -> data   (lanza con .code/.status)
 *   cfg: { leer(), escribir(parcial) }
 *   secreto: { leer(nombre), guardar(nombre, valor), borrar(nombre) }
 *   esPrincipal(), nombres() -> { negocio, sucursal, equipo }, huella(), version
 * }
 */
function crearIdentidad(deps) {
  const log = deps.log || (() => {});
  let enCurso = null;

  function deviceUuid() {
    const c = deps.cfg.leer();
    if (c.deviceUuid) return c.deviceUuid;
    const nuevo = crypto.randomUUID();
    deps.cfg.escribir({ deviceUuid: nuevo });
    return nuevo;
  }

  function comun(kind) {
    return { device_uuid: deviceUuid(), kind, name: deps.nombres().equipo, machine_fingerprint: deps.huella?.() ?? null, app_version: deps.version ?? null };
  }

  async function guardar(r) {
    if (!r?.token) throw new ErrorNube('La nube no entregó la credencial del equipo.', 'SIN_TOKEN');
    deps.secreto.guardar('equipo', r.token);
    deps.cfg.escribir({ deviceId: r.device_id, companyId: r.company_id, locationId: r.location_id, deviceKind: r.kind,
                        sucursalId: r.location_id, negocioId: r.company_id });
    await deps.meta.escribir({ company_uuid: r.company_id, location_uuid: r.location_id, install_secret: r.install_secret ?? null,
                               server_fingerprint: deps.meta.huellaServidor ? await deps.meta.huellaServidor() : null });
    // El token por sucursal de versiones anteriores ya no vale tras actualizar.
    if (r.upgraded) deps.secreto.borrar('legado');
    log(`equipo ${r.kind} de la ubicación ${r.location_id}`);
    return estado();
  }

  function estado() {
    const c = deps.cfg.leer();
    return { registrado: !!deps.secreto.leer('equipo'), deviceId: c.deviceId ?? null, companyId: c.companyId ?? null,
             locationId: c.locationId ?? null, kind: c.deviceKind ?? null };
  }

  async function alta() {
    const m0 = await deps.meta.leer();
    if (String(m0.is_demo).toLowerCase() === 'true') throw new ErrorNube('Una base de demostración no se registra en la nube.', 'DEMO');
    await deps.meta.asegurarInstancia();
    const m = await deps.meta.leer();
    const principal = deps.esPrincipal();

    if (m.install_secret) {
      return guardar(await deps.llamar('enroll', {
        ...comun(principal ? 'POS_PRIMARY' : 'POS_SECONDARY'), install_secret: m.install_secret, instance_uuid: m.instance_uuid,
      }));
    }
    if (!principal) {
      throw new ErrorNube('La caja principal todavía no registra esta sucursal en la nube. Ábrela con Internet y vuelve a intentar.', 'SIN_PRINCIPAL');
    }
    try {
      return await guardar(await deps.llamar('bootstrap', {
        ...comun('POS_PRIMARY'), instance_uuid: m.instance_uuid,
        nombre_negocio: deps.nombres().negocio, nombre_sucursal: deps.nombres().sucursal,
      }, { legado: deps.secreto.leer('legado') || null }));
    } catch (e) {
      if (e.code === 'INSTANCE_KNOWN') {
        throw new ErrorNube('Esta base ya está registrada en la nube, pero falta su llave de instalación. Pide un código de unión al dueño.', 'INSTANCE_KNOWN');
      }
      throw e;
    }
  }

  /** La credencial del equipo; la da de alta si hace falta (una sola a la vez). */
  async function asegurar() {
    if (deps.secreto.leer('equipo')) return estado();
    if (!enCurso) enCurso = alta().finally(() => { enCurso = null; });
    return enCurso;
  }

  /** Sucursal NUEVA de una empresa existente, con el código del dueño. */
  async function unirseConCodigo(codigo) {
    const limpio = String(codigo ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (limpio.length !== 12) throw new ErrorNube('El código tiene 12 letras y números (XXXX-XXXX-XXXX).', 'BAD_CODE');
    if (deps.secreto.leer('equipo')) throw new ErrorNube('Esta caja ya pertenece a una empresa en la nube.', 'YA_REGISTRADO');
    if (!deps.esPrincipal()) throw new ErrorNube('Solo la caja principal une la sucursal; las demás cajas la siguen solas.', 'NO_PRINCIPAL');
    await deps.meta.asegurarInstancia();
    const m = await deps.meta.leer();
    return guardar(await deps.llamar('enroll', { ...comun('POS_PRIMARY'), code: limpio, instance_uuid: m.instance_uuid }));
  }

  return { asegurar, estado, unirseConCodigo, deviceUuid };
}

module.exports = { crearIdentidad, metadataSql, ErrorNube };
