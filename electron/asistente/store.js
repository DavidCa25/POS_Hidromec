'use strict';
/**
 * LO QUE EL ASISTENTE RECUERDA (tablas de 0082). Solo SQL; las decisiones
 * están en el motor (qué se encontró) y en el chat (qué se dice).
 *
 *   hallazgos   se sincronizan con cada pasada: los nuevos entran, los que
 *               siguen se actualizan y los que la regla ya no encuentra se
 *               resuelven solos. Un descartado no vuelve a aparecer.
 *   planes      se ejecutan UNA vez: cerrar un plan que ya no está en
 *               borrador no hace nada (la pantalla puede reintentar sin
 *               duplicar la merma).
 */

const ACTIVOS = "('abierto', 'visto', 'pospuesto')";
const json = (v) => (v == null ? null : JSON.stringify(v));
const leer = (s, def) => { try { return s ? JSON.parse(s) : def; } catch { return def; } };

function crearStore({ sql, pool }) {
  const req = async () => (await pool()).request();

  function filaAHallazgo(r) {
    return {
      id: r.id, clave: r.clave, regla: r.regla, version: r.version, dominio: r.dominio,
      severidad: r.severidad, prioridad: r.prioridad, titulo: r.titulo, detalle: r.detalle,
      evidencia: leer(r.evidencia, []), acciones: leer(r.acciones, []),
      entidad: r.entidad_tipo ? { tipo: r.entidad_tipo, id: r.entidad_id, nombre: r.entidad_nombre || undefined } : null,
      ruta: r.ruta || null, verPermiso: r.ver_permiso || null, estado: r.estado,
      detectadoEn: r.detectado_en ? new Date(r.detectado_en).toISOString() : null,
      actualizadoEn: r.actualizado_en ? new Date(r.actualizado_en).toISOString() : null,
    };
  }

  /**
   * Guarda lo que encontró una pasada. `evaluadas`: las reglas que corrieron
   * (solo de esas se resuelve lo que ya no aparece; una regla que no corrió
   * por falta de datos no resuelve nada).
   */
  async function sincronizar(hallazgos, evaluadas) {
    const filas = hallazgos.map((h) => ({
      clave: h.clave, regla: h.regla, version: h.version, dominio: h.dominio, severidad: h.severidad, prioridad: h.prioridad,
      titulo: String(h.titulo).slice(0, 200), detalle: String(h.detalle).slice(0, 600),
      evidencia: json(h.evidencia), acciones: json(h.acciones),
      entidad_tipo: h.entidad?.tipo ?? null, entidad_id: h.entidad ? String(h.entidad.id).slice(0, 80) : null,
      entidad_nombre: h.entidad?.nombre ? String(h.entidad.nombre).slice(0, 200) : null,
      ruta: h.ruta ?? null, ver_permiso: h.verPermiso ?? null,
    }));
    const r = await (await req())
      .input('filas', sql.NVarChar(sql.MAX), JSON.stringify(filas))
      .input('reglas', sql.NVarChar(sql.MAX), JSON.stringify(evaluadas || []))
      .query(`
        SET XACT_ABORT ON;
        BEGIN TRAN;
        DECLARE @n TABLE (clave NVARCHAR(200) PRIMARY KEY, regla VARCHAR(80), version INT, dominio VARCHAR(20), severidad VARCHAR(12),
                          prioridad INT, titulo NVARCHAR(200), detalle NVARCHAR(600), evidencia NVARCHAR(MAX), acciones NVARCHAR(MAX),
                          entidad_tipo VARCHAR(30), entidad_id NVARCHAR(80), entidad_nombre NVARCHAR(200), ruta NVARCHAR(200), ver_permiso VARCHAR(40));
        INSERT INTO @n
        SELECT * FROM OPENJSON(@filas) WITH (clave NVARCHAR(200), regla VARCHAR(80), version INT, dominio VARCHAR(20), severidad VARCHAR(12),
              prioridad INT, titulo NVARCHAR(200), detalle NVARCHAR(600), evidencia NVARCHAR(MAX), acciones NVARCHAR(MAX),
              entidad_tipo VARCHAR(30), entidad_id NVARCHAR(80), entidad_nombre NVARCHAR(200), ruta NVARCHAR(200), ver_permiso VARCHAR(40));

        /* Lo que sigue: se actualiza. Un resuelto que vuelve se reabre; un descartado se queda descartado. */
        UPDATE h SET version = n.version, dominio = n.dominio, severidad = n.severidad, prioridad = n.prioridad,
               titulo = n.titulo, detalle = n.detalle, evidencia = n.evidencia, acciones = n.acciones,
               entidad_tipo = n.entidad_tipo, entidad_id = n.entidad_id, entidad_nombre = n.entidad_nombre,
               ruta = n.ruta, ver_permiso = n.ver_permiso, actualizado_en = SYSDATETIME(),
               estado = CASE WHEN h.estado = 'resuelto' THEN 'abierto' ELSE h.estado END,
               resuelto_en = CASE WHEN h.estado = 'resuelto' THEN NULL ELSE h.resuelto_en END
          FROM dbo.asistente_hallazgos h JOIN @n n ON n.clave = h.clave;

        INSERT INTO dbo.asistente_hallazgos (clave, regla, version, dominio, severidad, prioridad, titulo, detalle, evidencia, acciones,
                                             entidad_tipo, entidad_id, entidad_nombre, ruta, ver_permiso)
        SELECT n.* FROM @n n WHERE NOT EXISTS (SELECT 1 FROM dbo.asistente_hallazgos h WHERE h.clave = n.clave);

        /* Lo que ya no aparece en una regla que SÍ corrió: resuelto. */
        UPDATE h SET estado = 'resuelto', resuelto_en = SYSDATETIME(), actualizado_en = SYSDATETIME()
          OUTPUT inserted.id, inserted.titulo
          FROM dbo.asistente_hallazgos h
         WHERE h.estado IN ${ACTIVOS}
           AND h.regla IN (SELECT value FROM OPENJSON(@reglas))
           AND NOT EXISTS (SELECT 1 FROM @n n WHERE n.clave = h.clave);
        COMMIT;`);
    return { resueltos: (r.recordset || []).map((x) => ({ id: x.id, titulo: x.titulo })) };
  }

  /** Lo que hay que mostrar: activo, no pospuesto, sin descarte de su regla. */
  async function listar({ incluirVistos = true } = {}) {
    const r = await (await req()).query(`
      SELECT h.* FROM dbo.asistente_hallazgos h
       WHERE (h.estado = 'abierto' ${incluirVistos ? "OR h.estado = 'visto'" : ''}
              OR (h.estado = 'pospuesto' AND h.pospuesto_hasta <= SYSDATETIME()))
         AND NOT EXISTS (SELECT 1 FROM dbo.asistente_descartes d
                          WHERE d.alcance = 'regla' AND d.valor = h.regla AND (d.hasta IS NULL OR d.hasta > SYSDATETIME()))
       ORDER BY h.prioridad DESC, h.id;`);
    return (r.recordset || []).map(filaAHallazgo);
  }

  async function porId(id) {
    const r = await (await req()).input('id', sql.Int, Number(id) || 0).query('SELECT * FROM dbo.asistente_hallazgos WHERE id = @id;');
    return r.recordset?.[0] ? filaAHallazgo(r.recordset[0]) : null;
  }

  /** visto · posponer (horas) · descartar (motivo, alcance 'clave' | 'regla'). */
  async function marcar(id, accion, { userId = null, horas = 24, motivo = null, alcance = 'clave' } = {}) {
    const h = await porId(id);
    if (!h) return null;
    const rq = (await req()).input('id', sql.Int, h.id).input('u', sql.Int, userId);
    if (accion === 'visto') {
      await rq.query(`UPDATE dbo.asistente_hallazgos SET estado = CASE WHEN estado = 'abierto' THEN 'visto' ELSE estado END,
                             visto_por = @u, visto_en = SYSDATETIME() WHERE id = @id;`);
    } else if (accion === 'posponer') {
      await rq.input('h', sql.Int, Math.max(1, Math.min(24 * 30, Number(horas) || 24)))
        .query(`UPDATE dbo.asistente_hallazgos SET estado = 'pospuesto', pospuesto_hasta = DATEADD(HOUR, @h, SYSDATETIME()) WHERE id = @id;`);
    } else if (accion === 'descartar') {
      await rq.input('alc', sql.VarChar(10), alcance === 'regla' ? 'regla' : 'clave')
        .input('val', sql.NVarChar(200), alcance === 'regla' ? h.regla : h.clave)
        .input('m', sql.NVarChar(200), motivo ? String(motivo).slice(0, 200) : null)
        .query(`UPDATE dbo.asistente_hallazgos SET estado = 'descartado' WHERE id = @id;
                INSERT INTO dbo.asistente_descartes (alcance, valor, user_id, motivo) VALUES (@alc, @val, @u, @m);`);
    }
    await bitacora(accion === 'descartar' ? 'HALLAZGO_DESCARTADO' : accion === 'posponer' ? 'HALLAZGO_POSPUESTO' : 'HALLAZGO_VISTO',
                   { userId, hallazgoId: h.id, detalle: motivo });
    return porId(h.id);
  }

  /** 0–0.8 por regla: cuánto la ha descartado este negocio en 60 días. */
  async function fatiga() {
    const r = await (await req()).query(`
      SELECT h.regla,
             SUM(CASE WHEN h.estado = 'descartado' THEN 1 ELSE 0 END) AS descartados, COUNT(*) AS total
        FROM dbo.asistente_hallazgos h WHERE h.detectado_en >= DATEADD(DAY, -60, SYSDATETIME())
       GROUP BY h.regla;`);
    const out = {};
    for (const x of r.recordset || []) out[x.regla] = x.total ? Math.min(0.8, x.descartados / x.total) : 0;
    return out;
  }

  async function config() {
    const r = await (await req()).query('SELECT regla, activa, umbrales FROM dbo.asistente_config;');
    const out = {};
    for (const x of r.recordset || []) out[x.regla] = { activa: !!x.activa, umbrales: leer(x.umbrales, {}) };
    return out;
  }

  // ------------------------------------------------------------- planes
  async function crearPlan(plan, { origen, texto = null, userId = null }) {
    await (await req())
      .input('id', sql.UniqueIdentifier, plan.id).input('intent', sql.VarChar(60), plan.intent)
      .input('nivel', sql.VarChar(12), plan.nivel).input('titulo', sql.NVarChar(200), String(plan.titulo).slice(0, 200))
      .input('vista', sql.NVarChar(sql.MAX), json(plan.vista)).input('ejecutar', sql.NVarChar(sql.MAX), json(plan.ejecutar))
      .input('origen', sql.VarChar(12), origen).input('texto', sql.NVarChar(400), texto ? String(texto).slice(0, 400) : null)
      .input('hid', sql.Int, plan.hallazgoId ?? null).input('u', sql.Int, userId)
      .input('caduca', sql.DateTime2(0), new Date(plan.caducaEn))
      .query(`INSERT INTO dbo.asistente_planes (id, intent, nivel, titulo, vista, ejecutar, origen, texto, hallazgo_id, user_id, caduca_en)
              VALUES (@id, @intent, @nivel, @titulo, @vista, @ejecutar, @origen, @texto, @hid, @u, @caduca);`);
    await bitacora('PLAN_PROPUESTO', { userId, planId: plan.id, hallazgoId: plan.hallazgoId ?? null, detalle: `${plan.intent}: ${plan.titulo}` });
  }

  async function leerPlan(id) {
    const r = await (await req()).input('id', sql.UniqueIdentifier, id).query('SELECT * FROM dbo.asistente_planes WHERE id = @id;');
    const x = r.recordset?.[0];
    return x ? { ...x, vista: leer(x.vista, []), ejecutar: leer(x.ejecutar, null), resultado: leer(x.resultado, null) } : null;
  }

  /** Cierra un plan en borrador. Devuelve false si ya estaba cerrado: no se duplica nada. */
  async function cerrarPlan(id, estado, resultado, userId = null) {
    const r = await (await req())
      .input('id', sql.UniqueIdentifier, id).input('e', sql.VarChar(12), estado)
      .input('res', sql.NVarChar(sql.MAX), json(resultado))
      .query(`UPDATE dbo.asistente_planes SET estado = @e, cerrado_en = SYSDATETIME(), resultado = @res
               OUTPUT inserted.intent, inserted.hallazgo_id
               WHERE id = @id AND estado = 'borrador';`);
    const x = r.recordset?.[0];
    if (!x) return false;
    await bitacora(estado === 'ejecutado' ? 'PLAN_EJECUTADO' : estado === 'fallido' ? 'PLAN_FALLIDO' : 'PLAN_CANCELADO',
                   { userId, planId: id, hallazgoId: x.hallazgo_id, detalle: resultado?.error || resultado?.resumen || x.intent });
    return true;
  }

  async function bitacora(evento, { userId = null, planId = null, hallazgoId = null, detalle = null } = {}) {
    await (await req())
      .input('e', sql.VarChar(30), evento).input('u', sql.Int, userId).input('p', sql.UniqueIdentifier, planId)
      .input('h', sql.Int, hallazgoId).input('d', sql.NVarChar(600), detalle ? String(detalle).slice(0, 600) : null)
      .query('INSERT INTO dbo.asistente_bitacora (evento, user_id, plan_id, hallazgo_id, detalle) VALUES (@e, @u, @p, @h, @d);');
  }

  // ----------------------------------------------------------- mensajes
  async function guardarMensaje(userId, mensaje) {
    const { texto, autor, ...resto } = mensaje;
    await (await req())
      .input('u', sql.Int, userId).input('a', sql.VarChar(10), autor).input('t', sql.NVarChar(1000), String(texto || '').slice(0, 1000))
      .input('p', sql.NVarChar(sql.MAX), json(resto))
      .query('INSERT INTO dbo.asistente_mensajes (user_id, autor, texto, payload) VALUES (@u, @a, @t, @p);');
  }

  async function historial(userId, limite = 40) {
    const r = await (await req()).input('u', sql.Int, userId).input('n', sql.Int, Math.min(200, Math.max(1, limite)))
      .query(`SELECT TOP (@n) id, autor, texto, payload, en FROM dbo.asistente_mensajes WHERE user_id = @u ORDER BY id DESC;`);
    return (r.recordset || []).reverse().map((x) => ({ ...leer(x.payload, {}), id: `m${x.id}`, autor: x.autor, texto: x.texto, en: new Date(x.en).toISOString() }));
  }

  // ------------------------------------------------------------- frases
  async function guardarFrase(texto, intent, userId = null) {
    if (!texto || !intent) return;
    await (await req()).input('t', sql.NVarChar(400), String(texto).slice(0, 400)).input('i', sql.VarChar(60), intent).input('u', sql.Int, userId)
      .query(`IF NOT EXISTS (SELECT 1 FROM dbo.asistente_frases WHERE texto = @t AND intent = @i)
                INSERT INTO dbo.asistente_frases (texto, intent, user_id) VALUES (@t, @i, @u);`);
  }

  async function frases(limite = 5000) {
    const r = await (await req()).input('n', sql.Int, limite)
      .query('SELECT TOP (@n) texto, intent FROM dbo.asistente_frases WHERE confirmado = 1 ORDER BY id DESC;');
    return r.recordset || [];
  }

  // -------------------------------------------------------------- apodos
  /* Si la tabla no existe todavía (base sin la migración), no hay apodos: el
     chat sigue igual. */
  async function apodos() {
    try {
      const r = await (await req()).query('SELECT alias, tipo, ref_id, origen FROM dbo.asistente_alias ORDER BY id;');
      return (r.recordset || []).map((x) => ({ alias: x.alias, tipo: x.tipo, refId: x.ref_id, origen: x.origen }));
    } catch { return []; }
  }

  /** Un apodo por texto: el nuevo reemplaza al anterior con el mismo texto. */
  async function guardarApodo({ alias, tipo, refId, origen = 'ensenado', userId = null }) {
    await (await req())
      .input('a', sql.NVarChar(60), String(alias).slice(0, 60)).input('t', sql.VarChar(12), tipo).input('r', sql.Int, Number(refId))
      .input('o', sql.VarChar(12), origen === 'aprendido' ? 'aprendido' : 'ensenado').input('u', sql.Int, userId)
      .query(`MERGE dbo.asistente_alias AS d USING (SELECT @a AS alias) AS s ON d.alias = s.alias
               WHEN MATCHED THEN UPDATE SET tipo = @t, ref_id = @r, origen = @o, user_id = @u, en = SYSDATETIME()
               WHEN NOT MATCHED THEN INSERT (alias, tipo, ref_id, origen, user_id) VALUES (@a, @t, @r, @o, @u);`);
    await bitacora('APODO_GUARDADO', { userId, detalle: `«${alias}» → ${tipo} ${refId} (${origen})` });
  }

  async function borrarApodo(alias, userId = null) {
    const r = await (await req()).input('a', sql.NVarChar(60), String(alias).slice(0, 60))
      .query('DELETE FROM dbo.asistente_alias OUTPUT deleted.id WHERE alias = @a;');
    if (r.recordset?.length) await bitacora('APODO_BORRADO', { userId, detalle: `«${alias}»` });
    return !!r.recordset?.length;
  }

  // -------------------------------------------------------- preferencias
  /* Cómo le gusta a cada quien que le hable Wybix (0084). Sin la tabla
     (base sin la migración): sin preferencias, el chat sigue igual. */
  const PREF_CLAVES = { nombre: 'string', resumen: 'boolean', graficas: 'boolean', observaciones: 'boolean', hablar: 'boolean' };
  const limpiarPrefs = (o = {}) => Object.fromEntries(Object.entries(o).filter(([k, v]) => PREF_CLAVES[k] && typeof v === PREF_CLAVES[k])
    .map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 30) : v]));

  async function preferencias(userId) {
    if (!userId) return {};
    try {
      const r = await (await req()).input('u', sql.Int, Number(userId)).query('SELECT datos FROM dbo.asistente_preferencias WHERE user_id = @u;');
      return limpiarPrefs(JSON.parse(r.recordset?.[0]?.datos || '{}'));
    } catch { return {}; }
  }

  async function guardarPreferencias(userId, cambios) {
    const todas = limpiarPrefs({ ...(await preferencias(userId)), ...cambios });
    await (await req()).input('u', sql.Int, Number(userId)).input('d', sql.NVarChar(1000), JSON.stringify(todas))
      .query(`MERGE dbo.asistente_preferencias AS t USING (SELECT @u AS user_id) AS s ON t.user_id = s.user_id
               WHEN MATCHED THEN UPDATE SET datos = @d, actualizado_en = SYSDATETIME()
               WHEN NOT MATCHED THEN INSERT (user_id, datos) VALUES (@u, @d);`);
    return todas;
  }

  async function olvidarPreferencias(userId) {
    await (await req()).input('u', sql.Int, Number(userId)).query('DELETE FROM dbo.asistente_preferencias WHERE user_id = @u;');
  }

  return { sincronizar, listar, porId, marcar, fatiga, config, crearPlan, leerPlan, cerrarPlan, bitacora,
           guardarMensaje, historial, guardarFrase, frases, apodos, guardarApodo, borrarApodo,
           preferencias, guardarPreferencias, olvidarPreferencias };
}

module.exports = { crearStore };
