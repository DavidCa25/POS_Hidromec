/**
 * QUIEN HIZO QUE, DESDE QUE TABLET, Y SIN HACERLO DOS VECES.
 *
 * Cada accion que cambia algo desde una Pantalla Operativa deja una fila:
 * persona, dispositivo, funcion, entidad, accion, hora. No cada pantalla que
 * se pinta: solo lo que se hizo.
 *
 * IDEMPOTENCIA. La tablet manda con cada accion una clave (`Idempotency-Key`)
 * que no cambia al reintentar. La clave se RECLAMA antes de actuar, con un
 * indice unico: si ya existe, la accion ya se hizo (o se esta haciendo) y se
 * devuelve lo que se guardo. Una cola sin conexion que reenvia tres veces el
 * mismo «Terminar» termina UNA vez.
 */
const CLAVE = /^[A-Za-z0-9_-]{8,64}$/;

function crearAuditoria({ pool, sql, log = () => {} }) {
  const req = async () => (await pool()).request();

  function base(ctx, accion) {
    return {
      disp: ctx.disp?.id ?? null,
      ses: ctx.sesion?.id ?? null,
      u: ctx.sesion?.persona?.userId ?? null,
      p: ctx.sesion?.persona?.professionalId ?? null,
      sup: ctx.def?.tipo ?? ctx.disp?.superficie ?? 'DESCONOCIDA',
      accion,
    };
  }

  function entrada(r, b, extra = {}) {
    return r
      .input('disp', sql.UniqueIdentifier, b.disp)
      .input('ses', sql.UniqueIdentifier, b.ses)
      .input('u', sql.Int, b.u)
      .input('p', sql.Int, b.p)
      .input('sup', sql.NVarChar(30), b.sup)
      .input('acc', sql.NVarChar(40), b.accion)
      .input('ent', sql.NVarChar(30), extra.entidad ?? null)
      .input('eid', sql.NVarChar(40), extra.entidadId != null ? String(extra.entidadId) : null)
      .input('det', sql.NVarChar(400), extra.detalle ? String(extra.detalle).slice(0, 400) : null)
      .input('loc', sql.DateTime2(0), extra.localCreadoEn ?? null);
  }

  /** Una fila sin clave (acciones que no se encolan, entradas y salidas). */
  async function registrar(ctx, accion, extra = {}) {
    try {
      await entrada(await req(), base(ctx, accion), extra).query(`
        INSERT INTO dbo.superficie_auditoria (dispositivo_id, sesion_id, user_id, professional_id, superficie, accion, entidad, entidad_id, detalle, local_creado_en)
        VALUES (@disp, @ses, @u, @p, @sup, @acc, @ent, @eid, @det, @loc);`);
    } catch (e) { log(`auditoria: ${e.message}`); }
  }

  /**
   * Ejecuta `fn` una sola vez por clave. Devuelve { resultado, repetido }.
   * - clave nueva: se reclama, se ejecuta, se guarda el resultado.
   * - clave ya hecha: el resultado guardado, `repetido: true`.
   * - clave en curso (dos envios a la vez): error EN_CURSO, reintentable.
   * Si `fn` falla por algo pasajero, la clave se libera para poder reintentar;
   * si falla con un error de negocio o conflicto, se guarda: reintentar
   * devolveria lo mismo.
   */
  async function unaVez(ctx, accion, clave, extra, fn) {
    if (!clave) {
      const resultado = await fn();
      await registrar(ctx, accion, { ...extra, ...(resultado?.auditoria || {}) });
      return { resultado, repetido: false };
    }
    if (!CLAVE.test(clave)) throw Object.assign(new Error('Clave de acción no válida.'), { http: 400 });

    const b = base(ctx, accion);
    let id;
    try {
      const r = await entrada(await req(), b, extra).input('k', sql.NVarChar(64), clave).query(`
        INSERT INTO dbo.superficie_auditoria (dispositivo_id, sesion_id, user_id, professional_id, superficie, accion, entidad, entidad_id, detalle, local_creado_en, idem_key)
        OUTPUT inserted.id VALUES (@disp, @ses, @u, @p, @sup, @acc, @ent, @eid, @det, @loc, @k);`);
      id = r.recordset[0].id;
    } catch (e) {
      if (!/duplicate|UX_sup_aud_idem|2601|2627/i.test(String(e.message) + (e.number || ''))) throw e;
      const r = await (await req()).input('k', sql.NVarChar(64), clave)
        .query('SELECT accion, dispositivo_id, resultado FROM dbo.superficie_auditoria WHERE idem_key = @k;');
      const f = r.recordset?.[0];
      /* Una clave es de UN dispositivo: otra tablet no puede «reclamar» el
         resultado de una accion ajena adivinando su clave. */
      if (f && String(f.dispositivo_id).toLowerCase() !== String(b.disp).toLowerCase()) {
        throw Object.assign(new Error('Clave de acción no válida.'), { http: 400 });
      }
      if (!f?.resultado) throw Object.assign(new Error('Esa acción se está aplicando. Vuelve a intentarlo.'), { http: 409, codigo: 'EN_CURSO' });
      const guardado = JSON.parse(f.resultado);
      if (guardado.__error) throw Object.assign(new Error(guardado.__error), { http: guardado.http || 409, codigo: guardado.codigo, repetido: true });
      return { resultado: guardado, repetido: true };
    }

    try {
      const resultado = await fn();
      const aud = resultado?.auditoria || {};
      await (await req()).input('id', sql.BigInt, id)
        .input('r', sql.NVarChar(2000), JSON.stringify(resultado ?? {}).slice(0, 2000))
        .input('ent', sql.NVarChar(30), aud.entidad ?? extra.entidad ?? null)
        .input('eid', sql.NVarChar(40), aud.entidadId != null ? String(aud.entidadId) : (extra.entidadId != null ? String(extra.entidadId) : null))
        .input('det', sql.NVarChar(400), (aud.detalle ?? extra.detalle) ? String(aud.detalle ?? extra.detalle).slice(0, 400) : null)
        .query('UPDATE dbo.superficie_auditoria SET resultado = @r, entidad = @ent, entidad_id = @eid, detalle = @det WHERE id = @id;');
      return { resultado, repetido: false };
    } catch (e) {
      if (e.negocio || e.codigo === 'CONFLICTO') {
        await (await req()).input('id', sql.BigInt, id)
          .input('r', sql.NVarChar(2000), JSON.stringify({ __error: e.message, http: e.http || 409, codigo: e.codigo || null }).slice(0, 2000))
          .query('UPDATE dbo.superficie_auditoria SET resultado = @r WHERE id = @id;').catch(() => {});
      } else {
        await (await req()).input('id', sql.BigInt, id).query('DELETE FROM dbo.superficie_auditoria WHERE id = @id;').catch(() => {});
      }
      throw e;
    }
  }

  async function recientes(n = 50) {
    const r = await (await req()).input('n', sql.Int, n).query(`
      SELECT TOP (@n) a.momento, a.superficie, a.accion, a.entidad, a.entidad_id, a.detalle, d.nombre AS dispositivo,
             COALESCE(pu.full_name, pp.full_name, u.usuario) AS persona
        FROM dbo.superficie_auditoria a
        LEFT JOIN dbo.dispositivos_locales d ON d.id = a.dispositivo_id
        LEFT JOIN dbo.users u ON u.id = a.user_id
        LEFT JOIN dbo.professionals pu ON pu.user_id = a.user_id
        LEFT JOIN dbo.professionals pp ON pp.id = a.professional_id AND a.user_id IS NULL
       ORDER BY a.id DESC;`);
    return r.recordset || [];
  }

  return { registrar, unaVez, recientes };
}

module.exports = { crearAuditoria };
