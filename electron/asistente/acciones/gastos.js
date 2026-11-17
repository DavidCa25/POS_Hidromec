'use strict';
/* GASTOS: registrar un gasto y ver en qué se va el dinero. */

module.exports = (h) => ({
  async 'gasto.registrar'(it, ctx) {
    const cat = await h.uno('SELECT id, name AS nombre, kind FROM dbo.expense_categories WHERE id = @id;', [h.id(h.v(it, 'concepto'))]);
    if (!cat) return h.msg('No encontré ese concepto de gasto.');
    const monto = h.r2(h.v(it, 'monto'));
    if (!(monto > 0)) return h.msg('El monto tiene que ser mayor a cero.');
    const metodo = h.v(it, 'metodo');
    const mes = await h.uno(`SELECT ISNULL(SUM(amount), 0) AS t FROM dbo.expenses WHERE category_id = @id AND voided_at IS NULL
                               AND expense_date >= DATEADD(DAY, 1 - DAY(GETDATE()), CAST(GETDATE() AS DATE));`, [h.id(cat.id)]);
    return h.msg('Este gasto voy a registrar:', { plan: h.plan('gasto.registrar', {
      titulo: `Gasto · ${cat.nombre} · ${h.dinero(monto)}`,
      vista: [{ etiqueta: 'Concepto', valor: cat.nombre }, { etiqueta: 'Monto', valor: h.dinero(monto) }, { etiqueta: 'Forma de pago', valor: metodo.toLowerCase() },
              { etiqueta: `${cat.nombre} en el mes`, valor: `${h.dinero(mes?.t || 0)} → ${h.dinero(Number(mes?.t || 0) + monto)}` }],
      avisos: metodo === 'EFECTIVO' ? ['Sale del cajón: se abre y el corte lo descuenta.'] : [],
      nivel: ctx.puede('RETIROS_EGRESOS') ? 'confirmar' : 'autorizar',
      ejecutar: { api: 'electronAPI.egresosRegistrar', payload: { category_id: cat.id, amount: monto, payment_method: metodo, expense_date: h.hoyIso(), note: 'Registrado desde Wybix' } },
      permiso: 'RETIROS_EGRESOS',
    }) });
  },

  async 'gasto.resumen'(it) {
    const r = h.rango(h.v(it, 'periodo') === 'hoy' ? 'mes' : h.v(it, 'periodo'));
    const cid = h.v(it, 'concepto');
    const filas = await h.q(`
      SELECT c.id, c.name AS concepto, SUM(e.amount) AS total, COUNT(*) AS n
        FROM dbo.expenses e JOIN dbo.expense_categories c ON c.id = e.category_id
       WHERE e.voided_at IS NULL AND e.expense_date >= ${r.desde} AND e.expense_date < ${r.hasta}
       GROUP BY c.id, c.name ORDER BY SUM(e.amount) DESC;`);
    if (!filas.length) return h.msg(`No hay gastos registrados ${r.de}.`);
    const total = filas.reduce((a, f) => a + Number(f.total), 0);
    if (cid) {
      const f = filas.find((x) => x.id === cid);
      return h.msg(f ? `${r.nombre} llevas ${h.dinero(f.total)} de ${f.concepto} (${Math.round(Number(f.total) / total * 100)}% de tus gastos).` : `${r.nombre} no hay gastos de ese concepto.`);
    }
    return h.msg(`${r.nombre} llevas ${h.dinero(total)} de gastos. Lo que más pesa: ${filas[0].concepto}.`, {
      datos: filas.slice(0, 10).map((f) => ({ etiqueta: f.concepto, valor: `${h.dinero(f.total)} · ${Math.round(Number(f.total) / total * 100)}%` })) });
  },
});
