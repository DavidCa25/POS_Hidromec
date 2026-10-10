/**
 * QUIEN USA LA TABLET AHORA.
 *
 * DISPOSITIVO != TRABAJADOR. La tablet ya esta emparejada (su credencial dice
 * QUE es: «Tablet empleados», funcion «Mi jornada»). Quien la usa entra y sale
 * con su QR o su PIN, sin volver a emparejar nada.
 *
 * IDENTIDAD: la que ya existe. Una persona es un `users` (con su rol y sus
 * paquetes de permisos) o un `professionals` sin usuario (una estilista que
 * nunca abre Wybix en la caja). Si el profesional tiene usuario, la persona es
 * el usuario y el profesional se alcanza por `professionals.user_id`.
 *
 * QR: un token opaco de 256 bits. En la base, solo su SHA-256. No lleva nombre,
 * ni contrasena, ni nada reutilizable fuera de esta red: solo sirve en una
 * tablet YA emparejada con este Host. Si alguien lo fotografia: se REVOCA o se
 * ROTA (generar otro invalida el anterior), la sesion que abre es corta y cada
 * accion queda auditada con dispositivo y persona.
 *
 * PIN: se elige tu nombre y se teclea el PIN. scrypt con sal; 5 fallos seguidos
 * lo bloquean 5 minutos, y el servidor limita intentos por dispositivo.
 *
 * SESION: ligada a UN dispositivo y a su funcion. Termina al salir, tras un
 * rato sin actividad (por funcion) o, como tarde, al final del dia local: una
 * tablet del salon nunca amanece siendo «Carlos».
 */
const { nuevoSecreto, hash, pareceSecreto, pinValido, hashPin, pinCoincide } = require('./credenciales');
const { permisosDeUsuario, normalizarRol } = require('../seguridad/permisos');

const FALLOS_MAX = 5;
const BLOQUEO_MIN = 5;
const CACHE_MS = 3000;
const TOQUE_MS = 30_000;

/** El final del dia LOCAL de la computadora principal, en UTC para la base. */
function finDelDia(ahora = new Date()) {
  const f = new Date(ahora);
  f.setHours(23, 59, 59, 0);
  return f;
}

function crearTrabajadores({ pool, sql, log = () => {} }) {
  const cache = new Map();   // token_hash -> { s, t }
  let alCerrar = () => {};

  const req = async () => (await pool()).request();

  /* ------------------------------------------------------------ personas */
  /* 0056: paquetes extra de la persona, encima de su rol. Una base que aun no
     tiene la tabla (antes de migrar) no puede ni compilar la consulta, asi que
     la columna se pide solo si existe; una vez vista, se recuerda. */
  let conExtras = false;
  async function sqlPersona() {
    if (!conExtras) {
      try {
        const r = await (await req()).query(`SELECT CASE WHEN OBJECT_ID(N'dbo.user_permissions','U') IS NULL THEN 0 ELSE 1 END AS hay;`);
        conExtras = !!r.recordset?.[0]?.hay;
      } catch { /* sin tabla: sin extras */ }
    }
    return SQL_PERSONA.replace('/*EXTRAS*/', conExtras
      ? "(SELECT STRING_AGG(up.permiso, ',') FROM dbo.user_permissions up WHERE up.user_id = a.user_id)"
      : 'CAST(NULL AS NVARCHAR(400))');
  }

  const SQL_PERSONA = `
    SELECT a.id AS acceso_id, a.user_id, a.professional_id, a.revocado_en, a.bloqueado_hasta,
           a.pin_hash, a.pin_sal, a.pin_fallos,
           CASE WHEN a.qr_hash IS NULL THEN 0 ELSE 1 END AS tiene_qr,
           CASE WHEN a.pin_hash IS NULL THEN 0 ELSE 1 END AS tiene_pin,
           u.usuario, u.rol, ISNULL(u.active, 1) AS u_activo,
           /*EXTRAS*/ AS extras,
           COALESCE(pu.id, pp.id) AS prof_id,
           COALESCE(pu.full_name, pp.full_name) AS prof_nombre,
           COALESCE(pu.active, pp.active) AS prof_activo
      FROM dbo.trabajadores_acceso a
      LEFT JOIN dbo.users u ON u.id = a.user_id
      LEFT JOIN dbo.professionals pu ON pu.user_id = a.user_id
      LEFT JOIN dbo.professionals pp ON pp.id = a.professional_id`;

  function persona(f) {
    if (!f) return null;
    const esUsuario = f.user_id != null;
    const activo = esUsuario ? !!f.u_activo : !!f.prof_activo;
    return {
      accesoId: f.acceso_id,
      userId: f.user_id ?? null,
      professionalId: f.prof_id ?? null,
      nombre: f.prof_nombre || f.usuario || 'Sin nombre',
      rol: esUsuario ? normalizarRol(f.rol) : null,
      paquetes: esUsuario ? permisosDeUsuario(f.rol, f.extras ? String(f.extras).split(',') : []) : new Set(),
      activo: activo && !f.revocado_en,
      revocado: !!f.revocado_en,
    };
  }

  /**
   * ¿Puede esta persona usar esta funcion?
   *   - funciones de trabajador con profesional (Mi jornada, Tecnico): hace
   *     falta ser un profesional; un usuario sin profesional no tiene jornada.
   *   - un profesional SIN usuario solo entra en funciones que lo permiten,
   *     y alli solo ve y toca SU trabajo.
   *   - un usuario necesita alguno de los paquetes que pide la funcion.
   */
  function puedeUsar(p, def) {
    if (!p || !p.activo) return 'Este acceso no está activo.';
    if (def.requiereProfesional && !p.professionalId) return `${p.nombre} no está dado de alta como profesional.`;
    if (p.userId == null) {
      return def.permiteProfesionalSinUsuario ? null : 'Esta función necesita un usuario de Wybix.';
    }
    const pide = def.paquetes || [];
    if (pide.length && !pide.some(x => p.paquetes.has(x))) return 'Tu rol no tiene permiso para esta función.';
    return null;
  }

  /* ---------------------------------------------------- administracion */
  async function listarPersonas() {
    const r = await (await req()).query(`
      SELECT 'U' AS tipo, u.id AS user_id, NULL AS professional_id, u.usuario, u.rol,
             p.id AS prof_id, p.full_name, a.id AS acceso_id,
             CASE WHEN a.qr_hash IS NULL THEN 0 ELSE 1 END AS tiene_qr,
             CASE WHEN a.pin_hash IS NULL THEN 0 ELSE 1 END AS tiene_pin,
             a.revocado_en, a.bloqueado_hasta
        FROM dbo.users u
        LEFT JOIN dbo.professionals p ON p.user_id = u.id
        LEFT JOIN dbo.trabajadores_acceso a ON a.user_id = u.id
       WHERE ISNULL(u.active, 1) = 1
      UNION ALL
      SELECT 'P', NULL, p.id, NULL, NULL, p.id, p.full_name, a.id,
             CASE WHEN a.qr_hash IS NULL THEN 0 ELSE 1 END,
             CASE WHEN a.pin_hash IS NULL THEN 0 ELSE 1 END,
             a.revocado_en, a.bloqueado_hasta
        FROM dbo.professionals p
        LEFT JOIN dbo.trabajadores_acceso a ON a.professional_id = p.id
       WHERE p.active = 1 AND p.user_id IS NULL
       ORDER BY 7, 4;`);
    return (r.recordset || []).map(f => ({
      clave: f.tipo === 'U' ? `u${f.user_id}` : `p${f.professional_id}`,
      userId: f.user_id, professionalId: f.prof_id ?? f.professional_id,
      nombre: f.full_name || f.usuario, usuario: f.usuario, rol: f.rol ? normalizarRol(f.rol) : null,
      profesional: f.prof_id != null,
      accesoId: f.acceso_id ?? null,
      qr: !!f.tiene_qr && !f.revocado_en, pin: !!f.tiene_pin && !f.revocado_en,
      revocado: !!f.revocado_en,
      bloqueado: !!(f.bloqueado_hasta && new Date(f.bloqueado_hasta) > new Date()),
    }));
  }

  /** La fila de acceso de una persona; se crea (o se reactiva) si hace falta. */
  async function asegurarAcceso({ userId = null, professionalId = null, porUsuario = null }) {
    if (!!userId === !!professionalId) throw new Error('Una persona: usuario o profesional.');
    if (professionalId) {
      /* Un profesional CON usuario se identifica como el usuario: una persona,
         una identidad. */
      const r = await (await req()).input('p', sql.Int, professionalId)
        .query('SELECT user_id FROM dbo.professionals WHERE id = @p AND active = 1;');
      if (!r.recordset?.length) throw new Error('Ese profesional no existe o está dado de baja.');
      if (r.recordset[0].user_id) { userId = r.recordset[0].user_id; professionalId = null; }
    }
    const r = await (await req())
      .input('u', sql.Int, userId).input('p', sql.Int, professionalId).input('por', sql.Int, porUsuario)
      .query(`
        SET NOCOUNT ON;
        IF NOT EXISTS (SELECT 1 FROM dbo.trabajadores_acceso WHERE (@u IS NOT NULL AND user_id = @u) OR (@p IS NOT NULL AND professional_id = @p))
            INSERT INTO dbo.trabajadores_acceso (user_id, professional_id, creado_por) VALUES (@u, @p, @por);
        UPDATE dbo.trabajadores_acceso SET revocado_en = NULL, revocado_por = NULL
         WHERE ((@u IS NOT NULL AND user_id = @u) OR (@p IS NOT NULL AND professional_id = @p)) AND revocado_en IS NOT NULL;
        SELECT id FROM dbo.trabajadores_acceso WHERE (@u IS NOT NULL AND user_id = @u) OR (@p IS NOT NULL AND professional_id = @p);`);
    return r.recordset[0].id;
  }

  /** Genera (o ROTA) el QR. El anterior deja de valer en el acto. */
  async function generarQr(persona, porUsuario) {
    const accesoId = await asegurarAcceso({ ...persona, porUsuario });
    const token = nuevoSecreto();
    await (await req()).input('id', sql.Int, accesoId).input('h', sql.Char(64), hash(token))
      .query('UPDATE dbo.trabajadores_acceso SET qr_hash = @h, qr_creado_en = SYSUTCDATETIME() WHERE id = @id;');
    await cerrarSesionesDeAcceso(accesoId, 'REVOCADA');
    return { accesoId, token };
  }

  async function fijarPin(persona, pin, porUsuario) {
    const malo = pinValido(pin);
    if (malo) return { ok: false, error: malo };
    const accesoId = await asegurarAcceso({ ...persona, porUsuario });
    const { hash: h, sal } = hashPin(pin);
    await (await req()).input('id', sql.Int, accesoId).input('h', sql.VarChar(128), h).input('s', sql.VarChar(64), sal)
      .query(`UPDATE dbo.trabajadores_acceso
                 SET pin_hash = @h, pin_sal = @s, pin_creado_en = SYSUTCDATETIME(), pin_fallos = 0, bloqueado_hasta = NULL
               WHERE id = @id;`);
    return { ok: true, accesoId };
  }

  async function revocarAcceso(accesoId, porUsuario) {
    const r = await (await req()).input('id', sql.Int, accesoId).input('por', sql.Int, porUsuario)
      .query(`UPDATE dbo.trabajadores_acceso SET revocado_en = SYSUTCDATETIME(), revocado_por = @por, qr_hash = NULL
               WHERE id = @id AND revocado_en IS NULL; SELECT @@ROWCOUNT AS n;`);
    await cerrarSesionesDeAcceso(accesoId, 'REVOCADA');
    return (r.recordset?.[0]?.n ?? 0) > 0;
  }

  /* ----------------------------------------------------------- entrar */
  /** Del QR se acepta el token o la URL entera (un lector de codigos la teclea). */
  function tokenDeQr(texto) {
    const t = String(texto ?? '').trim();
    const m = t.match(/\/w\/([A-Za-z0-9_-]{40,60})\/?$/);
    return m ? m[1] : t;
  }

  async function personaPorQr(texto) {
    const token = tokenDeQr(texto);
    if (!pareceSecreto(token)) return null;
    const r = await (await req()).input('h', sql.Char(64), hash(token)).query(`${await sqlPersona()} WHERE a.qr_hash = @h;`);
    return persona(r.recordset?.[0]);
  }

  async function crearSesion(p, disp, def, via) {
    const token = nuevoSecreto();
    /* Segundos hasta el final del dia LOCAL: la base guarda UTC y asi no hay
       zona horaria que convertir en ningun lado. */
    const seg = Math.max(60, Math.round((finDelDia().getTime() - Date.now()) / 1000));
    const r = await (await req())
      .input('h', sql.Char(64), hash(token))
      .input('d', sql.UniqueIdentifier, disp.id)
      .input('a', sql.Int, p.accesoId)
      .input('u', sql.Int, p.userId)
      .input('p', sql.Int, p.professionalId)
      .input('s', sql.NVarChar(30), def.tipo)
      .input('v', sql.NVarChar(8), via)
      .input('seg', sql.Int, seg)
      .query(`
        SET NOCOUNT ON;
        /* Una sesion por dispositivo: si alguien no salio, sale ahora. */
        UPDATE dbo.trabajador_sesiones SET cerrada_en = SYSUTCDATETIME(), motivo_cierre = 'OTRA_SESION'
         WHERE dispositivo_id = @d AND cerrada_en IS NULL;
        DECLARE @id UNIQUEIDENTIFIER = NEWID();
        INSERT INTO dbo.trabajador_sesiones (id, token_hash, dispositivo_id, acceso_id, user_id, professional_id, superficie, via, expira_en)
        VALUES (@id, @h, @d, @a, @u, @p, @s, @v, DATEADD(SECOND, @seg, SYSUTCDATETIME()));
        SELECT @id AS id, inicio FROM dbo.trabajador_sesiones WHERE id = @id;`);
    cache.clear();
    const f = r.recordset[0];
    /* `persona` es para la auditoria del Host; a la tablet solo viaja `sesion`. */
    return { token, sesion: { id: f.id, inicio: f.inicio, persona: publica(p) }, persona: p };
  }

  async function entrarQr(texto, disp, def) {
    const p = await personaPorQr(texto);
    if (!p) return { ok: false, error: 'Este código no es válido. Pide uno nuevo a tu encargado.' };
    const no = puedeUsar(p, def);
    if (no) return { ok: false, error: no };
    return { ok: true, ...(await crearSesion(p, disp, def, 'QR')) };
  }

  /** Quienes pueden entrar con PIN en esta funcion: nombre, nada mas. */
  async function personasConPin(def) {
    const r = await (await req()).query(`${await sqlPersona()} WHERE a.pin_hash IS NOT NULL AND a.revocado_en IS NULL;`);
    return (r.recordset || []).map(persona).filter(p => !puedeUsar(p, def))
      .map(p => ({ id: p.accesoId, nombre: p.nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  async function entrarPin(accesoId, pin, disp, def) {
    const r = await (await req()).input('id', sql.Int, Number(accesoId) || 0).query(`${await sqlPersona()} WHERE a.id = @id;`);
    const f = r.recordset?.[0];
    const p = persona(f);
    if (!p || !f.pin_hash) return { ok: false, error: 'PIN incorrecto.' };
    if (f.bloqueado_hasta && new Date(f.bloqueado_hasta) > new Date()) {
      return { ok: false, bloqueado: true, error: 'Demasiados intentos. Espera unos minutos o usa tu QR.' };
    }
    if (!pinCoincide(pin, f.pin_hash, f.pin_sal)) {
      const fallos = (f.pin_fallos || 0) + 1;
      await (await req()).input('id', sql.Int, p.accesoId).input('f', sql.Int, fallos).input('min', sql.Int, BLOQUEO_MIN)
        .query(`UPDATE dbo.trabajadores_acceso SET pin_fallos = CASE WHEN @f >= ${FALLOS_MAX} THEN 0 ELSE @f END,
                  bloqueado_hasta = CASE WHEN @f >= ${FALLOS_MAX} THEN DATEADD(MINUTE, @min, SYSUTCDATETIME()) ELSE bloqueado_hasta END
                 WHERE id = @id;`);
      log(`PIN incorrecto para acceso ${p.accesoId} desde ${disp.nombre}`);
      return fallos >= FALLOS_MAX
        ? { ok: false, bloqueado: true, error: 'Demasiados intentos. Espera unos minutos o usa tu QR.' }
        : { ok: false, error: 'PIN incorrecto.' };
    }
    await (await req()).input('id', sql.Int, p.accesoId)
      .query('UPDATE dbo.trabajadores_acceso SET pin_fallos = 0, bloqueado_hasta = NULL WHERE id = @id;');
    const no = puedeUsar(p, def);
    if (no) return { ok: false, error: no };
    return { ok: true, ...(await crearSesion(p, disp, def, 'PIN')) };
  }

  /**
   * Un PIN de administrador para una decision de la tablet (cambiar su
   * funcion). No abre sesion: solo dice si ese PIN es de alguien con ese
   * paquete. Cuenta como intento fallido igual que al entrar.
   */
  async function autorizarConPin(accesoId, pin, paquete) {
    const r = await (await req()).input('id', sql.Int, Number(accesoId) || 0).query(`${await sqlPersona()} WHERE a.id = @id;`);
    const f = r.recordset?.[0];
    const p = persona(f);
    if (!p || !f.pin_hash || !p.activo) return { ok: false, error: 'PIN incorrecto.' };
    if (f.bloqueado_hasta && new Date(f.bloqueado_hasta) > new Date()) return { ok: false, error: 'Demasiados intentos. Espera unos minutos.' };
    if (!pinCoincide(pin, f.pin_hash, f.pin_sal)) {
      const fallos = (f.pin_fallos || 0) + 1;
      await (await req()).input('id', sql.Int, p.accesoId).input('f', sql.Int, fallos).input('min', sql.Int, BLOQUEO_MIN)
        .query(`UPDATE dbo.trabajadores_acceso SET pin_fallos = CASE WHEN @f >= ${FALLOS_MAX} THEN 0 ELSE @f END,
                  bloqueado_hasta = CASE WHEN @f >= ${FALLOS_MAX} THEN DATEADD(MINUTE, @min, SYSUTCDATETIME()) ELSE bloqueado_hasta END
                 WHERE id = @id;`);
      return { ok: false, error: 'PIN incorrecto.' };
    }
    if (!p.paquetes.has(paquete)) return { ok: false, error: 'Ese PIN no es de un administrador.' };
    return { ok: true, persona: publica(p) };
  }

  /** Quienes pueden autorizar un cambio de funcion (nombres de administradores con PIN). */
  async function administradoresConPin(paquete) {
    const r = await (await req()).query(`${await sqlPersona()} WHERE a.pin_hash IS NOT NULL AND a.revocado_en IS NULL AND a.user_id IS NOT NULL;`);
    return (r.recordset || []).map(persona).filter(p => p.activo && p.paquetes.has(paquete))
      .map(p => ({ id: p.accesoId, nombre: p.nombre }));
  }

  /* ------------------------------------------------------ cada peticion */
  /**
   * La sesion de trabajador de esta peticion, si sigue viva y es de ESTE
   * dispositivo y de SU funcion actual. Cierra la que caduco o se quedo quieta.
   */
  async function sesionDe(token, disp, def) {
    if (!pareceSecreto(token)) return null;
    const h = hash(token);
    const c = cache.get(h);
    if (c && Date.now() - c.t < CACHE_MS) return c.s && c.s.dispositivoId === String(disp.id).toLowerCase() ? c.s : null;

    const r = await (await req()).input('h', sql.Char(64), h).query(`
      SELECT s.id, s.dispositivo_id, s.superficie, s.inicio, s.ultima_actividad, s.expira_en, s.cerrada_en, s.via,
             DATEDIFF(SECOND, s.ultima_actividad, SYSUTCDATETIME()) AS quieta_s,
             CASE WHEN s.expira_en <= SYSUTCDATETIME() THEN 1 ELSE 0 END AS caducada,
             x.*
        FROM dbo.trabajador_sesiones s
        CROSS APPLY (${await sqlPersona()} WHERE a.id = s.acceso_id) x
       WHERE s.token_hash = @h;`);
    const f = r.recordset?.[0];
    let s = null;
    if (f && !f.cerrada_en) {
      const p = persona(f);
      const limite = (def?.sesion?.inactividadMin ?? 45) * 60;
      let motivo = null;
      if (f.caducada) motivo = 'CADUCADA';
      else if (f.quieta_s > limite) motivo = 'INACTIVIDAD';
      else if (!p.activo) motivo = 'REVOCADA';
      else if (String(f.dispositivo_id).toLowerCase() !== String(disp.id).toLowerCase()) motivo = null;
      else if (f.superficie !== disp.superficie) motivo = 'FUNCION';
      if (motivo) await cerrarSesion(f.id, motivo);
      else if (String(f.dispositivo_id).toLowerCase() === String(disp.id).toLowerCase()) {
        s = {
          id: f.id, dispositivoId: String(f.dispositivo_id).toLowerCase(), superficie: f.superficie, via: f.via,
          inicio: f.inicio, ultimaActividad: f.ultima_actividad, persona: p,
        };
        if (f.quieta_s * 1000 > TOQUE_MS) {
          (await req()).input('id', sql.UniqueIdentifier, f.id)
            .query('UPDATE dbo.trabajador_sesiones SET ultima_actividad = SYSUTCDATETIME() WHERE id = @id;').catch(() => {});
        }
      }
    }
    cache.set(h, { s, t: Date.now() });
    return s;
  }

  async function cerrarSesion(id, motivo = 'SALIR') {
    await (await req()).input('id', sql.UniqueIdentifier, id).input('m', sql.NVarChar(20), motivo)
      .query('UPDATE dbo.trabajador_sesiones SET cerrada_en = SYSUTCDATETIME(), motivo_cierre = @m WHERE id = @id AND cerrada_en IS NULL;');
    cache.clear();
    alCerrar({ sesionId: String(id).toLowerCase(), motivo });
  }

  async function cerrarSesionesDeDispositivo(dispId, motivo) {
    const r = await (await req()).input('d', sql.UniqueIdentifier, dispId).input('m', sql.NVarChar(20), motivo).query(`
      UPDATE dbo.trabajador_sesiones SET cerrada_en = SYSUTCDATETIME(), motivo_cierre = @m
      OUTPUT inserted.id WHERE dispositivo_id = @d AND cerrada_en IS NULL;`);
    cache.clear();
    for (const f of r.recordset || []) alCerrar({ sesionId: String(f.id).toLowerCase(), motivo });
  }

  async function cerrarSesionesDeAcceso(accesoId, motivo) {
    const r = await (await req()).input('a', sql.Int, accesoId).input('m', sql.NVarChar(20), motivo).query(`
      UPDATE dbo.trabajador_sesiones SET cerrada_en = SYSUTCDATETIME(), motivo_cierre = @m
      OUTPUT inserted.id WHERE acceso_id = @a AND cerrada_en IS NULL;`);
    cache.clear();
    for (const f of r.recordset || []) alCerrar({ sesionId: String(f.id).toLowerCase(), motivo });
  }

  /** Para la administracion: quien esta en cada dispositivo ahora. */
  async function sesionesAbiertas() {
    const r = await (await req()).query(`
      SELECT s.id, s.dispositivo_id, s.inicio, s.ultima_actividad, s.via,
             COALESCE(pu.full_name, pp.full_name, u.usuario) AS nombre
        FROM dbo.trabajador_sesiones s
        JOIN dbo.trabajadores_acceso a ON a.id = s.acceso_id
        LEFT JOIN dbo.users u ON u.id = a.user_id
        LEFT JOIN dbo.professionals pu ON pu.user_id = a.user_id
        LEFT JOIN dbo.professionals pp ON pp.id = a.professional_id
       WHERE s.cerrada_en IS NULL AND s.expira_en > SYSUTCDATETIME();`);
    const m = new Map();
    for (const f of r.recordset || []) {
      m.set(String(f.dispositivo_id).toLowerCase(), { id: f.id, nombre: f.nombre, inicio: f.inicio, ultimaActividad: f.ultima_actividad, via: f.via });
    }
    return m;
  }

  function publica(p) {
    return { nombre: p.nombre, profesional: !!p.professionalId, rol: p.rol };
  }

  return {
    listarPersonas, generarQr, fijarPin, revocarAcceso, puedeUsar,
    entrarQr, entrarPin, personasConPin, autorizarConPin, administradoresConPin,
    sesionDe, cerrarSesion, cerrarSesionesDeDispositivo, cerrarSesionesDeAcceso, sesionesAbiertas,
    tokenDeQr, publica,
    alCerrarSesion: (fn) => { alCerrar = fn; },
    olvidar: () => cache.clear(),
  };
}

module.exports = { crearTrabajadores, finDelDia, FALLOS_MAX, BLOQUEO_MIN };
