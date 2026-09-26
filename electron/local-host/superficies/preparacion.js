/**
 * PREPARATION — Cocina, Barra, Postres. La pantalla es un LUGAR, no una
 * persona: no importa quien cocina.
 *
 * Es el KDS que ya funcionaba, ahora registrado como superficie. El dominio
 * sigue en electron/lib/kds-dominio.js (sp_kds_get + sp_comanda_estado): aqui
 * solo se dice que ve y que puede hacer.
 *
 * AVANZAR es ONLINE_REQUIRED: un «Lista» encolado sin conexion diria en la
 * tablet algo que la caja todavia no sabe. Y ya es idempotente (se manda el
 * estado que se vio; ver kds-dominio.avanzar).
 */
const { negocio, prohibido, entero } = require('./comun');

module.exports = function preparacion({ dominio }) {
  const alcanza = (disp, stationId) => disp.todas || Number(disp.stationId) === Number(stationId);

  async function promedioMin(p, sql, stationId) {
    const r = await p.request().input('st', sql.Int, stationId || null).query(`
      SELECT AVG(CAST(DATEDIFF(SECOND, creada_en, lista_en) AS FLOAT)) / 60.0 AS m
        FROM dbo.comandas
       WHERE lista_en IS NOT NULL AND creada_en >= CAST(SYSDATETIME() AS DATE)
         AND (@st IS NULL OR station_id = @st);`).catch(() => null);
    const m = r?.recordset?.[0]?.m;
    return m == null ? null : Math.round(m);
  }

  return {
    tipo: 'PREPARATION',
    familia: 'ESTACION',
    nombre: 'Preparación',
    descripcion: 'Cocina, Barra o Postres: las comandas de una estación',
    icono: 'cooking-pot',
    identidad: 'NINGUNA',
    requiereEstacion: true,
    sonido: 'Cuando llega una comanda nueva',
    fuentes: ['comandas'],
    disponible: (c) => c.comandas,

    async estado(ctx) {
      const p = await ctx.pool();
      const stationId = ctx.disp.todas ? null : ctx.disp.stationId;
      const comandas = (await dominio.listar({ pool: p, sql: ctx.sql, stationId })).filter(k => alcanza(ctx.disp, k.stationId));
      const n = (e) => comandas.filter(k => k.estado === e).length;
      return {
        estacion: ctx.disp.todas ? null : ctx.disp.estacion,
        todas: ctx.disp.todas,
        umbrales: dominio.UMBRALES,
        comandas,
        reposo: { nuevas: n('NUEVA'), preparando: n('PREPARANDO'), listas: n('LISTA'), promedioMin: await promedioMin(p, ctx.sql, stationId) },
      };
    },

    acciones: {
      AVANZAR: {
        modo: 'ONLINE_REQUIRED',
        async ejecutar(ctx, datos) {
          const id = entero(datos?.id);
          const desde = ['NUEVA', 'PREPARANDO', 'LISTA'].includes(datos?.desde) ? datos.desde : null;
          if (!id || !desde) throw negocio('Falta la comanda o el estado que viste.', { http: 400 });
          const p = await ctx.pool();
          const actual = await dominio.una({ pool: p, sql: ctx.sql, comandaId: id });
          if (!actual) throw negocio('Esta comanda ya no existe.', { http: 404 });
          if (!alcanza(ctx.disp, actual.stationId)) throw prohibido('Esta comanda es de otra estación.');
          const r = await dominio.avanzar({ pool: p, sql: ctx.sql, comandaId: id, desde });
          ctx.avisarCambio?.();
          return { comanda: r.comanda, repetido: !!r.repetido, auditoria: { entidad: 'COMANDA', entidadId: id, detalle: `${desde} -> ${r.comanda?.estado}` } };
        },
      },
    },

    /** De un cambio en `comandas`, lo que esta estacion debe saber. */
    async evento(cambio, ctx) {
      if (cambio.fuente !== 'comandas' || !alcanza(ctx.disp, cambio.fila.station_id)) return null;
      const comanda = await cambio.detalle();
      if (cambio.nueva) return { tipo: 'PREPARATION_TICKET_CREATED', id: cambio.fila.id, sonar: true, datos: { comanda } };
      return { tipo: 'PREPARATION_UPDATED', id: cambio.fila.id, estado: cambio.fila.estado, datos: { comanda } };
    },
  };
};
