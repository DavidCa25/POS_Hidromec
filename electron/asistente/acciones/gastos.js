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

  /* «Cancela el gasto 12, era de otra sucursal». sp_void_expense pide el
     motivo y no deja cancelar uno de un corte ya entregado. */
  async 'gasto.cancelar'(it) {
    const g = await h.uno(`SELECT e.id, e.amount, e.payment_method, e.expense_date, e.voided_at, c.name AS concepto
                             FROM dbo.expenses e LEFT JOIN dbo.expense_categories c ON c.id = e.category_id WHERE e.id = @id;`, [h.id(h.v(it, 'folio'))]);
    if (!g) return h.msg(`No encuentro el gasto ${h.v(it, 'folio')}.`);
    if (g.voided_at) return h.msg(`El gasto ${g.id} ya estaba cancelado.`);
    const motivo = h.v(it, 'motivo');
    if (!motivo) return h.msg('¿Por qué se cancela?', { esperando: { intent: it.intent, slots: it.slots, falta: 'motivo' } });
    return h.msg('Este gasto voy a cancelar:', { plan: h.plan('gasto.cancelar', {
      titulo: `Cancelar el gasto ${g.id} · ${h.dinero(g.amount)}`,
      vista: [{ etiqueta: 'Gasto', valor: `${g.id}${g.concepto ? ' · ' + g.concepto : ''}` }, { etiqueta: 'Monto', valor: h.dinero(g.amount) },
              { etiqueta: 'Día', valor: h.diaTexto(g.expense_date) }, { etiqueta: 'Motivo', valor: motivo }],
      avisos: g.payment_method === 'EFECTIVO' ? ['Salió del cajón: el efectivo vuelve al turno (si ese corte ya se entregó, no se puede).'] : [],
      ejecutar: { api: 'electronAPI.egresosCancelar', payload: { expense_id: Number(g.id), reason: motivo } }, permiso: 'RETIROS_EGRESOS',
    }) });
  },

  /* Conceptos de gasto: crear, renombrar, activar o desactivar. */
  async 'gasto.concepto'(it) {
    const accion = h.v(it, 'accion');
    const nombre = String(h.v(it, 'nombre') || '').trim();
    if (accion === 'crear') {
      if (!nombre) return h.msg('¿Cómo se va a llamar el concepto?');
      if (nombre.length > 60) return h.msg('Ese nombre es muy largo (60 letras máximo).');
      const ya = await h.uno('SELECT TOP 1 name, active FROM dbo.expense_categories WHERE name = @n;', [['n', h.sql.NVarChar(60), nombre]]);
      if (ya) return h.msg(ya.active ? `Ya existe el concepto «${ya.name}».` : `El concepto «${ya.name}» existe pero está desactivado: dime «activa el concepto ${ya.name}».`);
      return h.msg('Este concepto voy a crear:', { plan: h.plan('gasto.concepto', {
        titulo: `Concepto de gasto nuevo · ${nombre}`, vista: [{ etiqueta: 'Concepto', valor: nombre }],
        ejecutar: { api: 'electronAPI.egresosConceptoGuardar', payload: { id: null, name: nombre, active: true, sort_order: null } },
        permiso: 'CONFIGURACION_ADMINISTRAR',
      }) });
    }
    const c = await h.uno('SELECT id, name, active, sort_order, is_system FROM dbo.expense_categories WHERE id = @id;', [h.id(h.v(it, 'concepto'))]);
    if (!c) return h.msg(`No encuentro el concepto «${it.slots.concepto?.texto || ''}».`);
    if (c.is_system) return h.msg(`«${c.name}» es un concepto del sistema: no se cambia.`);
    const cambios = accion === 'renombrar' ? { name: nombre } : { active: accion === 'activar' };
    if (accion === 'renombrar' && (!nombre || nombre.length > 60)) return h.msg('Dime el nombre nuevo (60 letras máximo).');
    if (accion !== 'renombrar' && !!c.active === cambios.active) return h.msg(`«${c.name}» ya está ${c.active ? 'activo' : 'desactivado'}.`);
    return h.msg('Esto voy a cambiar:', { plan: h.plan('gasto.concepto', {
      titulo: `Concepto «${c.name}»`,
      vista: [accion === 'renombrar' ? { etiqueta: 'Nombre', valor: `«${c.name}» → «${nombre}»` }
                                     : { etiqueta: 'Estado', valor: `${c.active ? 'activo' : 'desactivado'} → ${cambios.active ? 'activo' : 'desactivado'}` }],
      avisos: accion === 'desactivar' ? ['Los gastos ya registrados con él se quedan; solo deja de ofrecerse.'] : [],
      ejecutar: { api: 'electronAPI.egresosConceptoGuardar', payload: { id: Number(c.id), name: cambios.name ?? c.name, active: cambios.active ?? !!c.active, sort_order: c.sort_order } },
      permiso: 'CONFIGURACION_ADMINISTRAR',
    }) });
  },
});
