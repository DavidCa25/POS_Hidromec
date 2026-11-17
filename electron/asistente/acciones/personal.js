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
});
