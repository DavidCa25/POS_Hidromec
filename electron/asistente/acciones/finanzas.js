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

    /* «Juan retiró 500 de la caja», «Juan aportó 2,000», «le pagué 1,000 a Juan». */
    async 'socio.movimiento'(it) {
      const s = await h.uno('SELECT id, nombre FROM dbo.socios WHERE id = @id AND activo = 1;', [h.id(h.v(it, 'socio'))]);
      if (!s) return h.msg('No encuentro a ese socio activo.');
      const tipo = h.v(it, 'tipo');
      const monto = h.r2(h.v(it, 'monto'));
      if (!(monto > 0)) return h.msg('El monto tiene que ser mayor a cero.');
      /* Un retiro sin decir cómo: del cajón. Un pago o aportación: transferencia. */
      const metodo = h.v(it, 'metodo') || (tipo === 'RETIRO' ? 'EFECTIVO' : 'TRANSFERENCIA');
      const que = { RETIRO: 'Retiro', PAGO: 'Pago', APORTACION: 'Aportación' }[tipo] || tipo;
      const avisos = [];
      if (metodo === 'EFECTIVO') avisos.push(tipo === 'APORTACION' ? 'Entra al cajón y sale en el corte.' : 'Sale del cajón: necesita la caja abierta y sale en el corte.');
      avisos.push(tipo === 'APORTACION' ? 'Se le abona a su cuenta de socio.' : 'Se le descuenta de lo que le toca en la siguiente liquidación.');
      return h.msg('Este movimiento voy a registrar:', { plan: h.plan('socio.movimiento', {
        titulo: `${que} de ${s.nombre} · ${h.dinero(monto)}`,
        vista: [{ etiqueta: 'Socio', valor: s.nombre }, { etiqueta: 'Movimiento', valor: que }, { etiqueta: 'Monto', valor: h.dinero(monto) },
                { etiqueta: 'Cómo', valor: metodo === 'EFECTIVO' ? 'Efectivo de la caja' : metodo === 'TRANSFERENCIA' ? 'Transferencia' : metodo }],
        avisos,
        ejecutar: { api: 'electronAPI.sociosMovimiento', payload: { socioId: s.id, tipo, monto, metodo, registerId: h.cajaEquipo(), nota: 'Desde Wybix' } },
        permiso: 'SOCIOS_GESTIONAR',
      }) });
    },

    /* «Liquida a los socios»: cierra hasta ayer (solo días terminados). La
       tarjeta muestra lo de cada uno con sp_socios_resumen, sin cerrar nada. */
    async 'socio.liquidar'(it) {
      const d = new Date(); d.setDate(d.getDate() - 1);
      const hasta = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      let filas = [];
      try { [filas = []] = await h.sp('sp_socios_resumen', [['desde', h.sql.Date, null], ['hasta', h.sql.Date, hasta]]); }
      catch (e) { return h.msg(String(e.message || e).includes('activ') ? 'Socios no está activado.' : 'No pude calcular lo de cada socio.'); }
      const nombre = (f) => f.nombre || `Socio ${f.socio_id}`;
      const monto = (f) => f.saldo_final ?? f.resultado ?? 0;
      return h.msg('Así voy a liquidar a los socios:', { plan: h.plan('socio.liquidar', {
        titulo: `Liquidar socios hasta el ${h.diaTexto(d)}`,
        vista: filas.length ? filas.map((f) => ({ etiqueta: nombre(f), valor: h.dinero(monto(f)) })) : [{ etiqueta: 'Hasta', valor: h.diaTexto(d) }],
        avisos: ['Cierra el periodo: lo liquidado ya no se mueve. Hoy no entra porque no ha terminado.'],
        ejecutar: { api: 'electronAPI.sociosLiquidar', payload: { hasta } }, permiso: 'SOCIOS_GESTIONAR',
      }) });
    },

    /* «La compra 45 la pagó Juan»: de su bolsa (se le abona como aportación). */
    async 'socio.compra'(it) {
      const s = await h.uno('SELECT id, nombre FROM dbo.socios WHERE id = @id AND activo = 1;', [h.id(h.v(it, 'socio'))]);
      const c = await h.uno(`SELECT p.id, p.total, s.nombre AS proveedor FROM dbo.purchase p LEFT JOIN dbo.CAT_suppliers s ON s.id = p.supplier_id WHERE p.id = @id;`, [h.id(h.v(it, 'folio'))]);
      if (!s || !c) return h.msg(!s ? 'No encuentro a ese socio activo.' : `No encuentro la compra ${h.v(it, 'folio')}.`);
      return h.msg('Esto voy a registrar:', { plan: h.plan('socio.compra', {
        titulo: `La compra ${c.id} la pagó ${s.nombre}`,
        vista: [{ etiqueta: 'Compra', valor: `${c.id}${c.proveedor ? ' · ' + c.proveedor : ''} · ${h.dinero(c.total)}` }, { etiqueta: 'La pagó', valor: s.nombre }],
        avisos: ['Se le abona a su cuenta de socio como aportación.'],
        ejecutar: { api: 'electronAPI.sociosCompra', payload: { purchaseId: Number(c.id), pagadoPor: s.id } }, permiso: 'INVENTARIO_OPERAR',
      }) });
    },

    /* «El gasto 12 es de Juan» (a su cargo) / «el gasto 12 lo pagó Juan» (de su bolsa). */
    async 'socio.gasto'(it) {
      const s = await h.uno('SELECT id, nombre FROM dbo.socios WHERE id = @id AND activo = 1;', [h.id(h.v(it, 'socio'))]);
      const g = await h.uno(`SELECT e.id, e.amount, e.payment_method, c.name AS concepto FROM dbo.expenses e LEFT JOIN dbo.expense_categories c ON c.id = e.category_id WHERE e.id = @id;`, [h.id(h.v(it, 'folio'))]);
      if (!s || !g) return h.msg(!s ? 'No encuentro a ese socio activo.' : `No encuentro el gasto ${h.v(it, 'folio')}.`);
      const pago = !!h.v(it, 'pago');
      if (pago && g.payment_method === 'EFECTIVO') return h.msg('Ese gasto se pagó en efectivo: salió del cajón, lo pagó el negocio.');
      const payload = pago ? { expenseId: Number(g.id), modo: 'COMUN', lineas: [], pagadoPor: s.id }
        : { expenseId: Number(g.id), modo: 'SOCIOS', lineas: [{ socioId: s.id, pct: 100 }], pagadoPor: null };
      return h.msg('Esto voy a registrar:', { plan: h.plan('socio.gasto', {
        titulo: pago ? `El gasto ${g.id} lo pagó ${s.nombre}` : `El gasto ${g.id} es de ${s.nombre}`,
        vista: [{ etiqueta: 'Gasto', valor: `${g.id}${g.concepto ? ' · ' + g.concepto : ''} · ${h.dinero(g.amount)}` },
                { etiqueta: pago ? 'Lo pagó' : 'A cargo de', valor: s.nombre }],
        avisos: [pago ? 'Se reparte con la regla del negocio y a él se le abona lo que pagó.' : 'Todo el gasto se le descuenta a él en la liquidación.'],
        ejecutar: { api: 'electronAPI.sociosGasto', payload }, permiso: 'RETIROS_EGRESOS',
      }) });
    },

    /* «Reparte las propinas»: la tarjeta trae el cálculo de sp_propinas_repartir
       sin confirmar; al confirmar, el mismo procedimiento paga y cierra. */
    async 'propinas.repartir'(it, ctx) {
      const caja = h.cajaEquipo();
      let cab, lineas;
      try {
        const [c = [], l = []] = await h.sp('sp_propinas_repartir', [['register_id', h.sql.Int, caja], ['user_id', h.sql.Int, ctx.userId], ['confirmar', h.sql.Bit, 0]]);
        cab = c[0]; lineas = l;
      } catch (e) { return h.msg(String(e.message || e).replace(/^.*?:\s*/, '')); }
      if (!cab || !(Number(cab.total) > 0)) return h.msg('No hay propinas pendientes en esta caja.');
      const modo = { PAREJO: 'parejo', HORAS: 'por horas trabajadas', ATENDIO: 'a quien atendió' }[cab.modo] || String(cab.modo || '').toLowerCase();
      return h.msg('Así voy a repartir las propinas:', { plan: h.plan('propinas.repartir', {
        titulo: `Repartir ${h.dinero(cab.neto)} de propinas`,
        vista: [...lineas.map((l) => ({ etiqueta: l.usuario, valor: h.dinero(l.monto) })),
                { etiqueta: 'Propinas', valor: `${cab.propinas} · ${h.dinero(cab.total)}` },
                ...(Number(cab.comision) > 0 ? [{ etiqueta: 'Comisión de la terminal', valor: h.dinero(cab.comision) }] : []),
                { etiqueta: 'Reparto', valor: modo }],
        avisos: ['Sale del cajón en efectivo y queda en el corte.'],
        ejecutar: { api: 'electronAPI.propinasRepartir', payload: { registerId: caja, confirmar: true } }, permiso: 'CAJA_CORTES',
      }) });
    },
  };
};
