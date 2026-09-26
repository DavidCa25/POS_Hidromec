/**
 * STAFF_DAY — «Mi jornada». Belleza, unas, servicios con agenda.
 *
 * La persona entra con su QR o PIN y ve SU dia: sus citas de hoy, la
 * siguiente, los huecos. No la agenda del negocio: la de otra estilista no
 * viaja a esta tablet.
 *
 * VE (y el servidor solo manda esto): hora, nombre de la clienta, servicio,
 * estado y la nota de la cita. NO: telefono, correo, historial, saldo,
 * facturacion.
 *
 * HACE, con los procedimientos de la Agenda y de las Ordenes:
 *   LLEGO      sp_appointment_to_order (abre la orden de la cita; si ya
 *              existe, devuelve la misma: repetirla no crea otra)
 *   EMPEZAR    la linea de su servicio pasa a EN_PROCESO
 *   TERMINAR   ... a HECHA (y la orden a TERMINADA si no queda trabajo)
 *   NOTA       en el historial de la orden, o en la nota de la cita
 *   CONSUMO    material usado: linea PRODUCTO en la orden (ver servicios-comun)
 * Todas se pueden encolar sin conexion: son idempotentes y, si algo cambio
 * mientras tanto, dan conflicto en vez de pisar.
 * Mover o cancelar una cita no esta aqui: es de recepcion y necesita conexion.
 */
const { negocio, conflicto, prohibido, entero, texto, sp } = require('./comun');
const trabajo = require('./servicios-comun');

const HUECO_MIN = 30;

function estadoDeCita(c) {
  if (c.status === 'NO_ASISTIO') return 'NO_ASISTIO';
  if (c.linea_status === 'HECHA') return 'TERMINADA';
  if (c.linea_status === 'EN_PROCESO') return 'EN_CURSO';
  if (c.status === 'ATENDIDA') return 'LLEGO';
  return 'PENDIENTE';
}

module.exports = function jornada() {
  async function citasDeHoy(ctx) {
    const { sql } = ctx;
    const r = await (await ctx.pool()).request().input('p', sql.Int, ctx.sesion.persona.professionalId).query(`
      SELECT a.id, a.starts_at, a.ends_at, a.status, a.notes, a.service_order_id,
             CONVERT(CHAR(5), a.starts_at, 108) AS hora_ini, CONVERT(CHAR(5), a.ends_at, 108) AS hora_fin,
             DATEDIFF(MINUTE, SYSDATETIME(), a.ends_at) AS min_para_fin,
             c.customerName AS cliente, sv.nombre AS servicio,
             l.id AS linea_id, l.status AS linea_status
        FROM dbo.appointments a
        JOIN dbo.customers c ON c.id = a.customer_id
        LEFT JOIN dbo.products sv ON sv.id = a.service_product_id
        OUTER APPLY (SELECT TOP 1 x.id, x.status FROM dbo.service_order_lines x
                      WHERE x.order_id = a.service_order_id AND x.professional_id = a.professional_id
                        AND x.line_kind = 'SERVICIO' AND x.status <> 'CANCELADA' ORDER BY x.id) l
       WHERE a.professional_id = @p
         AND a.starts_at >= CAST(CAST(SYSDATETIME() AS DATE) AS DATETIME2)
         AND a.starts_at < DATEADD(DAY, 1, CAST(CAST(SYSDATETIME() AS DATE) AS DATETIME2))
         AND a.status <> 'CANCELADA'
       ORDER BY a.starts_at;`);
    return r.recordset || [];
  }

  /** La cita, si es de esta persona. */
  async function citaMia(ctx, citaId) {
    const { sql } = ctx;
    const id = entero(citaId);
    if (!id) throw negocio('Falta la cita.', { http: 400 });
    const r = await (await ctx.pool()).request().input('id', sql.Int, id).query(`
      SELECT a.id, a.professional_id, a.status, a.service_order_id,
             (SELECT TOP 1 x.id FROM dbo.service_order_lines x
               WHERE x.order_id = a.service_order_id AND x.professional_id = a.professional_id
                 AND x.line_kind = 'SERVICIO' AND x.status <> 'CANCELADA' ORDER BY x.id) AS linea_id
        FROM dbo.appointments a WHERE a.id = @id;`);
    const c = r.recordset?.[0];
    if (!c) throw negocio('Esa cita ya no existe.', { http: 404 });
    if (Number(c.professional_id) !== Number(ctx.sesion.persona.professionalId)) throw prohibido('Esa cita no es tuya.');
    return c;
  }

  async function llegada(ctx, cita) {
    if (cita.service_order_id) return cita;
    if (['CANCELADA', 'NO_ASISTIO'].includes(cita.status)) throw conflicto('Esta cita se canceló mientras tanto.');
    await sp(await ctx.pool(), 'sp_appointment_to_order', (r) => r
      .input('appointment_id', ctx.sql.Int, cita.id)
      .input('user_id', ctx.sql.Int, ctx.sesion.persona.userId));
    return citaMia(ctx, cita.id);
  }

  return {
    tipo: 'STAFF_DAY',
    familia: 'TRABAJADOR',
    nombre: 'Mi jornada',
    descripcion: 'Cada persona ve sus citas de hoy y las atiende',
    icono: 'calendar-check',
    identidad: 'TRABAJADOR',
    requiereProfesional: true,
    permiteProfesionalSinUsuario: true,
    paquetes: ['SERVICIOS_OPERAR'],
    sesion: { inactividadMin: 120 },
    sonido: 'Cuando llega una clienta o te asignan una cita',
    fuentes: ['citas', 'lineas'],
    disponible: (c) => c.agenda,

    async estado(ctx) {
      const filas = await citasDeHoy(ctx);
      /* Las horas de la agenda son LOCALES: se mandan ya escritas («10:30») y
         las comparaciones con «ahora» las hace SQL. */
      const citas = filas.map(c => ({
        id: c.id,
        inicio: c.hora_ini, fin: c.hora_fin, _ini: c.starts_at, _fin: c.ends_at, _minFin: c.min_para_fin,
        cliente: c.cliente, servicio: c.servicio || 'Servicio',
        estado: estadoDeCita(c),
        nota: c.notes || null,
        ordenId: c.service_order_id || null,
        lineaId: c.linea_id || null,
      }));
      /* Huecos de al menos media hora entre citas: «12:00 Disponible». */
      const agenda = [];
      citas.forEach((c, i) => {
        const { _ini, _fin, _minFin, ...visible } = c;
        void _ini; void _minFin;
        agenda.push({ tipo: 'CITA', ...visible });
        const sig = citas[i + 1];
        if (sig && new Date(sig._ini) - new Date(_fin) >= HUECO_MIN * 60000) {
          agenda.push({ tipo: 'LIBRE', inicio: c.fin, fin: sig.inicio });
        }
      });
      const activas = citas.filter(c => c.estado !== 'NO_ASISTIO');
      const siguiente = activas.find(c => c.estado !== 'TERMINADA' && c._minFin >= -15)
        || activas.find(c => c.estado !== 'TERMINADA') || null;
      /* «Ahora» con el reloj de la computadora principal (el de la agenda), no
         con el de la tablet: la linea de tiempo marca donde va el dia. */
      const d = new Date();
      const ahora = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      return {
        agenda,
        ahora,
        reposo: {
          citas: activas.length,
          completadas: activas.filter(c => c.estado === 'TERMINADA').length,
          siguiente: siguiente ? { id: siguiente.id, inicio: siguiente.inicio, cliente: siguiente.cliente, servicio: siguiente.servicio } : null,
        },
      };
    },

    consultas: {
      materiales: (ctx, q) => trabajo.buscarMateriales(ctx, q.q),
    },

    acciones: {
      LLEGO: {
        modo: 'OFFLINE_SAFE',
        async ejecutar(ctx, d) {
          const c = await llegada(ctx, await citaMia(ctx, d?.citaId));
          return { citaId: c.id, ordenId: c.service_order_id, auditoria: { entidad: 'CITA', entidadId: c.id, detalle: 'llegó' } };
        },
      },
      EMPEZAR: {
        modo: 'OFFLINE_SAFE',
        async ejecutar(ctx, d) {
          /* Empezar implica que llego: si recepcion no lo marco, se marca. */
          const c = await llegada(ctx, await citaMia(ctx, d?.citaId));
          if (!c.linea_id) throw negocio('Esta cita no tiene un servicio tuyo que empezar.');
          return trabajo.moverLinea(ctx, c.linea_id, ['PENDIENTE'], 'EN_PROCESO');
        },
      },
      TERMINAR: {
        modo: 'OFFLINE_SAFE',
        async ejecutar(ctx, d) {
          const c = await citaMia(ctx, d?.citaId);
          if (!c.linea_id) throw conflicto('Esta cita todavía no empezó.');
          return trabajo.moverLinea(ctx, c.linea_id, ['PENDIENTE', 'EN_PROCESO'], 'HECHA');
        },
      },
      NOTA: {
        modo: 'OFFLINE_SAFE',
        async ejecutar(ctx, d) {
          const c = await citaMia(ctx, d?.citaId);
          const t = texto(d?.texto, 300);
          if (!t) throw negocio('La nota está vacía.', { http: 400 });
          if (c.service_order_id) return trabajo.nota(ctx, c.service_order_id, t);
          /* Sin orden todavia, la nota va a la cita (el procedimiento la anade
             a la que ya tenia, sin cambiar su estado). */
          await sp(await ctx.pool(), 'sp_appointment_set_status', (r) => r
            .input('id', ctx.sql.Int, c.id)
            .input('status', ctx.sql.NVarChar(15), c.status)
            .input('notes', ctx.sql.NVarChar(400), `${ctx.sesion.persona.nombre}: ${t}`)
            .input('user_id', ctx.sql.Int, ctx.sesion.persona.userId));
          return { citaId: c.id, auditoria: { entidad: 'CITA', entidadId: c.id, detalle: 'nota' } };
        },
      },
      CONSUMO: {
        modo: 'OFFLINE_SAFE',
        async ejecutar(ctx, d) {
          const c = await llegada(ctx, await citaMia(ctx, d?.citaId));
          const items = Array.isArray(d?.items) ? d.items.slice(0, 20) : [];
          if (!items.length) throw negocio('No elegiste ningún material.', { http: 400 });
          const hechos = [];
          for (const it of items) hechos.push(await trabajo.material(ctx, c.service_order_id, it.productId, it.cantidad));
          return { citaId: c.id, ordenId: c.service_order_id, materiales: hechos.map(h => ({ nombre: h.nombre, cantidad: h.cantidad })),
            auditoria: { entidad: 'ORDEN', entidadId: c.service_order_id, detalle: `consumo: ${hechos.map(h => `${h.nombre} x${h.cantidad}`).join(', ')}`.slice(0, 400) } };
        },
      },
    },

    evento(cambio, ctx) {
      const yo = Number(ctx.sesion?.persona?.professionalId);
      if (!yo) return null;
      if (cambio.fuente === 'citas' && Number(cambio.fila.professional_id) === yo) {
        if (cambio.nueva) return { tipo: 'APPOINTMENT_ASSIGNED', id: cambio.fila.id, sonar: true };
        /* Suena al LLEGAR (el estado pasa a ATENDIDA), no en cada cambio posterior. */
        if (cambio.fila.status === 'ATENDIDA' && cambio.anterior && cambio.anterior !== 'ATENDIDA') {
          return { tipo: 'CLIENT_ARRIVED', id: cambio.fila.id, sonar: true };
        }
        return { tipo: 'APPOINTMENT_UPDATED', id: cambio.fila.id };
      }
      if (cambio.fuente === 'lineas' && Number(cambio.fila.professional_id) === yo) {
        return { tipo: 'WORK_UPDATED', id: cambio.fila.id };
      }
      return null;
    },
  };
};
