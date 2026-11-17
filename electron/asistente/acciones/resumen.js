'use strict';
/**
 * EL RESUMEN QUE WYBIX DA SIN QUE SE LO PIDAN: al abrir el chat por primera
 * vez en el día (y cada vez que lo saludan).
 *
 *   mañana  cómo cerró ayer, cuánto se espera hoy, lo urgente y quién debe
 *   tarde   cómo va el día contra un día igual
 *   noche   cómo va cerrando el día
 *
 * Cada pieza se calcula aparte y, si falla o no hay datos, se omite: el
 * saludo nunca se rompe. Lo que la persona no puede ver (números del día)
 * no se dice.
 */
const { DIAS, DIAS_PLURAL, iso, dia0, mas } = require('../analitica/periodos');

module.exports = (h) => {
  const A = h.analitica;
  const intenta = async (fn) => { try { return await fn(); } catch { return null; } };

  /** «Es tu mejor martes en 8 semanas», «vas abajo de un martes normal». */
  async function comentarioHoy(ahora = new Date()) {
    const x = await intenta(() => A.hoyContraSusIguales(ahora));
    if (!x) return null;
    const dia = DIAS[ahora.getDay()];
    if (x.lugar === 1) return `Es tu mejor ${dia} en ${x.de} semanas a esta hora.`;
    if (x.peor) return `Va siendo tu ${dia} más flojo en ${x.de} semanas a esta hora.`;
    const pct = x.promedio > 0 ? Math.round((x.hoy / x.promedio - 1) * 100) : 0;
    if (Math.abs(pct) < 5) return `Vas como un ${dia} normal.`;
    return `Vas ${Math.abs(pct)}% ${pct > 0 ? 'arriba' : 'abajo'} de un ${dia} normal a esta hora.`;
  }

  async function briefing(ctx, ahora = new Date()) {
    const partes = [h.saludo(ahora, ctx.prefs?.nombre || h.nombreDe(ctx.usuario))];
    /* «No me des el resumen»: solo el saludo. */
    if (ctx.prefs?.resumen === false) return h.msg(`${partes[0]} ¿En qué te ayudo?`);
    const datos = [];
    const hora = ahora.getHours();
    const numeros = !ctx.puede || ctx.puede('VER_NUMEROS_DIA');

    if (numeros) {
      const hoy = dia0(ahora);
      if (hora < 12) {
        const r = A.rango('ayer', ahora);
        const [ayer, antes] = await Promise.all([intenta(() => A.cubo.consultar({ filtros: { desde: r.desde, hasta: r.hasta } })),
                                                 intenta(() => A.cubo.consultar({ filtros: { desde: r.antesDesde, hasta: r.antesHasta } }))]);
        if (ayer?.tickets) {
          const pct = h.pct(ayer.ventas, antes?.ventas);
          partes.push(`Ayer vendiste ${h.dinero(ayer.ventas)}${pct != null ? ` (${h.signo(pct)} contra el ${DIAS[mas(hoy, -8).getDay()]} anterior)` : ''}.`);
          datos.push({ etiqueta: 'Ayer', valor: `${h.dinero(ayer.ventas)} · ${h.plural(ayer.tickets, 'ticket')}` });
        }
        const p = await intenta(() => A.pronostico(iso(hoy), {}, ahora));
        if (p && p.confianza !== 'ninguna') {
          partes.push(`Para hoy calculo unos ${h.dinero(p.estimado)}.`);
          datos.push({ etiqueta: `Un ${DIAS[hoy.getDay()]} normal`, valor: `${h.dinero(p.bajo)} – ${h.dinero(p.alto)}` });
        }
      } else {
        const hoyV = await intenta(() => A.cubo.consultar({ filtros: { desde: `${iso(hoy)}T00:00:00`, hasta: `${iso(mas(hoy, 1))}T00:00:00` } }));
        if (hoyV?.tickets) {
          partes.push(`${hora >= 19 ? 'Así va cerrando el día' : 'Hoy llevas'}: ${h.dinero(hoyV.ventas)} en ${h.plural(hoyV.tickets, 'ticket')}.`);
          const c = await comentarioHoy(ahora);
          if (c) partes.push(c);
        } else if (hora >= 10) partes.push('Hoy todavía no hay ventas.');
      }
    }

    /* Lo urgente: los dos hallazgos más importantes, por título. */
    const hs = (await intenta(() => h.listarHallazgos(ctx))) || [];
    if (hs.length) {
      partes.push(hs.length === 1 ? `Para revisar: ${hs[0].titulo}.` : `Tienes ${h.plural(hs.length, 'cosa')} por revisar; lo primero: ${hs[0].titulo}.`);
    }

    /* Quién lleva más tiempo sin pagar (más de 3 semanas). */
    const deudor = await intenta(() => h.uno(`
      SELECT TOP 1 c.id, c.customerName AS nombre, SUM(s.balance) AS saldo, DATEDIFF(DAY, MIN(s.datee), GETDATE()) AS dias
        FROM dbo.sales s JOIN dbo.customers c ON c.id = s.customer_id
       WHERE s.balance > 0.005
       GROUP BY c.id, c.customerName
      HAVING MIN(s.datee) < DATEADD(DAY, -21, GETDATE())
       ORDER BY SUM(s.balance) DESC;`));
    if (deudor && hs.length < 3) partes.push(`${deudor.nombre} te debe ${h.dinero(deudor.saldo)} desde hace ${h.plural(deudor.dias, 'día')}.`);

    if (partes.length === 1) partes.push(hs.length ? '' : 'Todo en orden por aquí.');
    const opciones = [];
    if (hs.length) opciones.push({ etiqueta: 'Ver pendientes', intent: 'consulta.pendientes' });
    if (deudor) opciones.push({ etiqueta: `Fiado de ${deudor.nombre}`, intent: 'cliente.deuda', params: { clienteId: deudor.id } });
    if (numeros) opciones.push({ etiqueta: '¿Cómo voy hoy?', intent: 'consulta.hoy', params: { periodo: 'hoy' } });
    if (!opciones.length) opciones.push({ etiqueta: '¿Qué puedes hacer?', intent: 'ayuda' });
    return h.msg(partes.filter(Boolean).join(' '), { datos, opciones: opciones.slice(0, 3),
                                                     tono: hs.some((x) => ['critico', 'importante'].includes(x.severidad)) ? 'atencion' : 'normal' });
  }

  return { briefing, comentarioHoy, DIAS_PLURAL };
};
