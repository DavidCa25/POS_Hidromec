'use strict';
/* PERSONAL: quién vino y cuánto vendió cada quien. */

module.exports = (h) => ({
  async 'personal.asistencia'() {
    const filas = await h.q(`
      SELECT u.usuario, j.entrada_en, j.salida_en, j.estado
        FROM dbo.asistencia_jornadas j JOIN dbo.users u ON u.id = j.user_id
       WHERE j.dia = CAST(GETDATE() AS DATE) ORDER BY j.entrada_en;`);
    const activos = await h.uno('SELECT COUNT(*) AS n FROM dbo.users WHERE active = 1;');
    if (!filas.length) return h.msg('Nadie ha checado entrada hoy.');
    const trabajando = filas.filter((f) => !f.salida_en);
    return h.msg(`Hoy checaron ${h.plural(filas.length, 'persona')}${activos?.n ? ` de ${activos.n} usuarios` : ''}; ${trabajando.length} siguen trabajando.`, {
      datos: filas.map((f) => ({ etiqueta: f.usuario, valor: `entró ${h.horaTexto(f.entrada_en)}${f.salida_en ? ` · salió ${h.horaTexto(f.salida_en)}` : ' · trabajando'}` })) });
  },

  async 'personal.ventas'(it) {
    const r = h.rango(h.v(it, 'periodo'));
    const filas = await h.q(`
      SELECT ISNULL(u.usuario, 'Sin usuario') AS usuario, COUNT(*) AS tickets, SUM(s.total) AS total
        FROM dbo.sales s LEFT JOIN dbo.users u ON u.id = s.useer_id
       WHERE s.datee >= ${r.desde} AND s.datee < ${r.hasta}
       GROUP BY u.usuario ORDER BY SUM(s.total) DESC;`);
    if (!filas.length) return h.msg(`${r.nombre} no hay ventas todavía.`);
    return h.msg(`${r.nombre} quien más vendió fue ${filas[0].usuario}.`, {
      datos: filas.map((f) => ({ etiqueta: f.usuario, valor: `${h.dinero(f.total)} · ${h.plural(f.tickets, 'ticket')}` })) });
  },

  /* «Checa mi entrada», «salgo a comer», «ya regresé», «checa mi salida». */
  async 'asistencia.marcar'(it) {
    const tipo = h.v(it, 'tipo');
    const NOMBRE = { ENTRADA: 'Entrada', INICIO_DESCANSO: 'Salida a descanso', FIN_DESCANSO: 'Regreso de descanso', SALIDA: 'Salida' };
    return h.msg('Esto voy a checar:', { plan: h.plan('asistencia.marcar', {
      titulo: `${NOMBRE[tipo]} · ${h.horaTexto(new Date())}`, vista: [{ etiqueta: 'Marca', valor: NOMBRE[tipo] }, { etiqueta: 'Hora', valor: h.horaTexto(new Date()) }],
      avisos: ['Se registra a tu usuario, con la hora de la caja.'],
      ejecutar: { api: 'electronAPI.asistenciaMarcar', payload: { tipo, registerId: h.cajaEquipo() } }, permiso: 'VENTAS_OPERAR',
    }) });
  },

  /* «El horario de Pedro es de lunes a viernes de 9 a 6»: esos días se reemplazan. */
  async 'asistencia.horario'(it) {
    const u = await h.uno('SELECT id, usuario FROM dbo.users WHERE id = @id;', [h.id(h.v(it, 'usuario'))]);
    if (!u) return h.msg('No encontré a ese usuario.');
    const dias = h.v(it, 'dias') || [], desde = h.v(it, 'desde'), hasta = h.v(it, 'hasta'), descanso = Number(h.v(it, 'descanso')) || 0;
    if (!(desde < hasta)) return h.msg('La salida tiene que ser después de la entrada.');
    const actual = await h.q(`SELECT weekday, CONVERT(CHAR(5), entrada, 108) AS entrada, CONVERT(CHAR(5), salida, 108) AS salida, descanso_min
                               FROM dbo.asistencia_horarios WHERE user_id = @id;`, [h.id(u.id)]).catch(() => []);
    const nuevo = [...actual.filter((x) => !dias.includes(x.weekday)).map((x) => ({ weekday: x.weekday, entrada: x.entrada, salida: x.salida, descansoMin: x.descanso_min || 0 })),
                   ...dias.map((d) => ({ weekday: d, entrada: desde, salida: hasta, descansoMin: descanso }))].sort((a, b) => a.weekday - b.weekday);
    const DIA = ['', 'domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    return h.msg('Así queda su horario:', { plan: h.plan('asistencia.horario', {
      titulo: `Horario de ${u.usuario}`,
      vista: [2, 3, 4, 5, 6, 7, 1].map((d) => { const x = nuevo.find((n) => n.weekday === d); return { etiqueta: DIA[d], valor: x ? `${x.entrada}–${x.salida}${x.descansoMin ? ` (${x.descansoMin} min de descanso)` : ''}` : 'descansa' }; }),
      ejecutar: { api: 'electronAPI.asistenciaHorarioGuardar', payload: { personaId: Number(u.id), dias: nuevo } }, permiso: 'ASISTENCIA_GESTIONAR',
    }) });
  },

  async 'propinas.config'(it) {
    const c = await h.uno('SELECT TOP 1 reparto, sugeridas, comision_pct, comision_a FROM dbo.propinas_config;').catch(() => null);
    if (!c) return h.msg('Propinas no está encendida: dime «activa propinas».');
    const reparto = h.v(it, 'reparto');
    const N = { PAREJO: 'parejo entre quienes trabajaron', HORAS: 'por horas trabajadas', ATENDIO: 'a quien atendió' };
    if (c.reparto === reparto) return h.msg(`Las propinas ya se reparten ${N[reparto]}.`);
    return h.msg('Esto voy a cambiar:', { plan: h.plan('propinas.config', {
      titulo: 'Reparto de propinas', vista: [{ etiqueta: 'Reparto', valor: `${N[c.reparto] || c.reparto} → ${N[reparto]}` }],
      ejecutar: { api: 'electronAPI.propinasConfigGuardar', payload: { reparto, sugeridas: String(c.sugeridas || '').split(',').filter(Boolean).map(Number),
                                                                       comisionPct: Number(c.comision_pct) || 0, comisionA: c.comision_a || 'NEGOCIO' } },
      permiso: 'CONFIGURACION_ADMINISTRAR',
    }) });
  },

  /* Reglas de asistencia: se guardan todas, con solo la dicha cambiada. */
  async 'asistencia.reglas'(it) {
    const r = await h.uno('SELECT TOP 1 cuenta_extra, tolerancia_min, descanso_pagado, dia_libre_extra, marca_retardos, entrada_para_vender FROM dbo.asistencia_reglas;').catch(() => null);
    if (!r) return h.msg('Asistencia no está encendida: dime «activa asistencia».');
    const actual = { cuentaExtra: !!r.cuenta_extra, tolerancia: Number(r.tolerancia_min) > 0, descansoPagado: !!r.descanso_pagado, diaLibreExtra: !!r.dia_libre_extra,
                     marcaRetardos: !!r.marca_retardos, entradaParaVender: !!r.entrada_para_vender };
    const regla = h.v(it, 'regla'), valor = !!h.v(it, 'valor');
    const N = { marcaRetardos: 'Marcar retardos', entradaParaVender: 'Checar entrada para poder vender', descansoPagado: 'Descanso pagado' };
    if (actual[regla] === valor) return h.msg(`«${N[regla]}» ya está en ${valor ? 'sí' : 'no'}.`);
    return h.msg('Esto voy a cambiar:', { plan: h.plan('asistencia.reglas', {
      titulo: 'Reglas de asistencia', vista: [{ etiqueta: N[regla], valor: `${actual[regla] ? 'sí' : 'no'} → ${valor ? 'sí' : 'no'}` }],
      ejecutar: { api: 'electronAPI.asistenciaReglasGuardar', payload: { ...actual, [regla]: valor } }, permiso: 'CONFIGURACION_ADMINISTRAR',
    }) });
  },

  /* «Corrige la entrada de Pedro de ayer a las 9». */
  async 'asistencia.corregir'(it) {
    const u = await h.uno('SELECT id, usuario FROM dbo.users WHERE id = @id;', [h.id(h.v(it, 'usuario'))]);
    if (!u) return h.msg('No encontré a ese usuario.');
    const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    const hoy = new Date(); const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    const dicho = h.v(it, 'dia');
    if (dicho === 'ayer') d.setDate(d.getDate() - 1); else if (dicho === 'antier') d.setDate(d.getDate() - 2);
    else if (DIAS.includes(dicho)) { let dif = (d.getDay() - DIAS.indexOf(dicho) + 7) % 7; if (dif === 0) dif = 7; d.setDate(d.getDate() - dif); }
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const j = await h.uno(`SELECT TOP 1 id, CONVERT(VARCHAR(16), entrada_en, 126) AS entrada, CONVERT(VARCHAR(16), salida_en, 126) AS salida
                            FROM dbo.asistencia_jornadas WHERE user_id = @u AND dia = @d ORDER BY id;`, [['u', h.sql.Int, u.id], ['d', h.sql.Date, iso]]).catch(() => null);
    const cual = h.v(it, 'cual'), hora = h.v(it, 'hora');
    const entrada = cual === 'entrada' ? `${iso}T${hora}` : j?.entrada || null;
    const salida = cual === 'salida' ? `${iso}T${hora}` : j?.salida || null;
    if (!entrada) return h.msg(`${u.usuario} no tiene entrada ese día: dime primero su entrada.`);
    if (salida && salida <= entrada) return h.msg('La salida tiene que ser después de la entrada.');
    const motivo = h.v(it, 'motivo') || 'Corrección desde Wybix';
    return h.msg('Esta corrección voy a registrar:', { plan: h.plan('asistencia.corregir', {
      titulo: `${u.usuario} · ${cual} del ${h.diaTexto(d)}`,
      vista: [{ etiqueta: cual === 'entrada' ? 'Entrada' : 'Salida', valor: `${(cual === 'entrada' ? j?.entrada : j?.salida)?.slice(11, 16) || 'sin marca'} → ${hora}` },
              { etiqueta: 'Motivo', valor: motivo }],
      avisos: ['Queda la corrección con quién la hizo y por qué.'],
      ejecutar: { api: 'electronAPI.asistenciaCorregir', payload: { jornadaId: j?.id ?? null, personaId: Number(u.id), entrada, salida, motivo } },
      permiso: 'ASISTENCIA_GESTIONAR',
    }) });
  },
});
