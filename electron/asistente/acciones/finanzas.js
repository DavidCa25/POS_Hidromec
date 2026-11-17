'use strict';
/* FINANZAS: la ganancia de lo vendido y lo que queda después de gastos.
   La ganancia se calcula igual que sp_get_profit_overview (sin IVA, con el
   costo de la venta), para que el chat y Estadísticas digan lo mismo. */

module.exports = (h) => {
  async function ganancia(r) {
    return h.uno(`
      SELECT ISNULL(SUM(COALESCE(sd.base_neta, CASE WHEN ISNULL(sd.tax_object, '02') = '02' THEN sd.subtotal / (1 + ISNULL(sd.tax_rate, ISNULL(p.tasa_iva, 0))) ELSE sd.subtotal END)), 0) AS ventas,
             ISNULL(SUM(sd.quantity * COALESCE(sd.unit_cost, p.cost, 0)), 0) AS costo,
             SUM(CASE WHEN COALESCE(sd.unit_cost, p.cost, 0) = 0 THEN 1 ELSE 0 END) AS sin_costo
        FROM dbo.sales s JOIN dbo.sale_detail sd ON sd.sale_id = s.id JOIN dbo.products p ON p.id = sd.product_id
       WHERE s.datee >= ${r.desde} AND s.datee < ${r.hasta};`);
  }
  const gastos = (r) => h.uno(`SELECT ISNULL(SUM(amount), 0) AS t FROM dbo.expenses WHERE voided_at IS NULL AND expense_date >= ${r.desde} AND expense_date < ${r.hasta};`);

  return {
    async 'finanzas.ganancia'(it) {
      const r = h.rango(h.v(it, 'periodo'));
      const g = await ganancia(r);
      const util = Number(g.ventas) - Number(g.costo);
      const margen = Number(g.ventas) > 0 ? Math.round(util / Number(g.ventas) * 100) : 0;
      return h.msg(`${r.nombre} la ganancia de lo vendido es ${h.dinero(util)} (${margen}% de margen).`, {
        datos: [{ etiqueta: 'Ventas sin IVA', valor: h.dinero(g.ventas) }, { etiqueta: 'Costo de lo vendido', valor: h.dinero(g.costo) },
                ...(Number(g.sin_costo) ? [{ etiqueta: 'Renglones sin costo', valor: `${g.sin_costo} (cuentan como ganancia completa)` }] : [])],
        opciones: [{ etiqueta: 'Restando los gastos', intent: 'finanzas.resultado', params: { periodo: h.v(it, 'periodo') } }] });
    },

    async 'finanzas.resultado'(it) {
      const periodo = h.v(it, 'periodo') === 'hoy' ? 'mes' : h.v(it, 'periodo');
      const r = h.rango(periodo);
      const [g, e] = await Promise.all([ganancia(r), gastos(r)]);
      const bruta = Number(g.ventas) - Number(g.costo);
      const neta = bruta - Number(e.t);
      return h.msg(neta >= 0 ? `${r.nombre} te quedan ${h.dinero(neta)} limpios después de gastos.` : `${r.nombre} vas ${h.dinero(-neta)} abajo: los gastos superan la ganancia.`, {
        datos: [{ etiqueta: 'Ventas sin IVA', valor: h.dinero(g.ventas) }, { etiqueta: 'Costo de lo vendido', valor: `− ${h.dinero(g.costo)}` },
                { etiqueta: 'Ganancia bruta', valor: h.dinero(bruta) }, { etiqueta: 'Gastos', valor: `− ${h.dinero(e.t)}` },
                { etiqueta: 'Utilidad', valor: h.dinero(neta) }],
        opciones: [{ etiqueta: '¿En qué se va el dinero?', intent: 'gasto.resumen', params: { periodo } },
                   { etiqueta: 'Abrir estado de resultados', intent: 'ir_a', params: { ruta: '/dashboard/estado-resultados', etiqueta: 'Estado de resultados' } }],
        tono: neta < 0 ? 'atencion' : 'normal' });
    },
  };
};
