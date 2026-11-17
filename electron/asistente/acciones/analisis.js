'use strict';
/**
 * ANÁLISIS: las respuestas que salen del motor analítico (analitica/).
 *
 *   cubo          cualquier consulta de venta con filtros combinados
 *                 («¿cuánto vendí de refrescos los sábados después de las 6?»)
 *   venta.comparar  «¿por qué?»: clientes contra gasto, y dónde se concentró
 *   analisis.*    pronóstico, cuándo se acaba algo, «¿y si cambio el precio?»
 *   analisis.libre  cualquier pregunta de ventas agrupada o comparada
 *
 * Además de las palabras, cada respuesta puede llevar:
 *   grafica   los puntos para dibujarla en el chat (barras o línea)
 *   explica   de dónde salió el número («¿cómo lo calculaste?»)
 *   refs      qué es cada renglón de la lista («dime más del segundo»)
 * y, si algo se ve raro en el periodo, una observación («Ojo: …»).
 *
 * Ninguna escribe: a lo más ofrecen el botón de la acción que sigue
 * (planear la producción, cambiar el precio), que tiene su propia tarjeta.
 */
const { aCubo, describir, hTexto } = require('../lenguaje/filtros');
const { DIAS, DIAS_PLURAL, iso, mas, dia0 } = require('../analitica/periodos');

const METODO = { EFECTIVO: 'Efectivo', TARJETA: 'Tarjeta', TRANSFERENCIA: 'Transferencia', CREDITO: 'Crédito (fiado)', VALES: 'Vales' };

module.exports = (h) => {
  const A = h.analitica;

  /**
   * El periodo de la pregunta: el rango dicho («en octubre»), el periodo dicho
   * («la semana pasada»), 8 semanas si solo se dijeron días u horas («los
   * sábados»: uno solo no dice nada), o el de omisión del intent.
   */
  function periodoDe(it, { siNoSeDijo = null } = {}) {
    const f = it.slots.filtros?.valor || {};
    if (f.rango) return f.rango;
    const dicho = it.slots.periodo?.dicho;
    if (!dicho && (f.diasSemana || f.horaDesde != null || f.horaHasta != null)) {
      const hoy = dia0(new Date());
      return { desde: iso(mas(hoy, -55)), hasta: iso(mas(hoy, 1)), nombre: 'En las últimas 8 semanas', de: 'de las últimas 8 semanas', contra: 'las 8 semanas anteriores' };
    }
    return !dicho && siNoSeDijo ? siNoSeDijo : h.v(it, 'periodo') || 'hoy';
  }
  const rangoDe = (it, o) => A.rango(periodoDe(it, o));
  const titulo = (r, valor) => [r.nombre, describir(valor)].filter(Boolean).join(', ');

  /** Un miembro de una dimensión, dicho en español. */
  function nombreMiembro(dim, m) {
    if (dim === 'diaSemana') return `los ${DIAS_PLURAL[Number(m.clave)]}`;
    if (dim === 'hora') return `de ${hTexto(Number(m.clave))} a ${hTexto(Number(m.clave) + 1)}`;
    if (dim === 'metodo') return `en ${(METODO[m.nombre] || m.nombre).toLowerCase()}`;
    if (dim === 'cajero') return `en el turno de ${m.nombre}`;
    return m.nombre;
  }
  const conSigno = (n) => `${n >= 0 ? '+' : '−'}${h.dinero(Math.abs(n))}`;

  /* ----------------------------------------------- piezas comunes */
  const MEDIDA = {
    ventas: { nombre: 'ventas', fmt: (f) => h.dinero(f.ventas), val: (f) => f.ventas, dinero: true },
    piezas: { nombre: 'piezas vendidas', fmt: (f) => h.num(f.piezas), val: (f) => f.piezas, dinero: false },
    ganancia: { nombre: 'ganancia', fmt: (f) => h.dinero(f.ganancia), val: (f) => f.ganancia, dinero: true },
    tickets: { nombre: 'tickets', fmt: (f) => String(f.tickets), val: (f) => f.tickets, dinero: false },
    promedio: { nombre: 'ticket promedio', fmt: (f) => h.dinero(f.promedio), val: (f) => f.promedio, dinero: true },
  };
  const SUJETO = { producto: 'El producto', categoria: 'La categoría', hora: 'La hora', diaSemana: 'El día', dia: 'El día',
                   cajero: 'Quien', metodo: 'La forma de pago', cliente: 'El cliente' };
  /* Qué es cada renglón, para «dime más del segundo». */
  const TIPO_REF = { producto: 'producto', cliente: 'cliente', categoria: 'categoria', cajero: 'cajero' };

  function etiquetaDe(dim, f) {
    if (dim === 'hora') return `${hTexto(Number(f.clave))}–${hTexto(Number(f.clave) + 1)}`;
    if (dim === 'diaSemana') return DIAS_PLURAL[Number(f.clave)].replace(/^./, (c) => c.toUpperCase());
    if (dim === 'metodo') return METODO[f.nombre] || f.nombre;
    if (dim === 'dia') { const d = new Date(`${String(f.nombre).slice(0, 10)}T12:00:00`); return `${DIAS[d.getDay()].slice(0, 3)} ${d.getDate()}`; }
    return String(f.nombre);
  }

  /** De dónde salió el número: lo que contesta «¿cómo lo calculaste?». */
  function explicacion({ r, fv = {}, medida = 'ventas', tickets = null, producto = null, extra = [] }) {
    const quePasos = {
      ventas: 'sumé el total cobrado de cada ticket (con IVA, como en el corte)',
      piezas: 'sumé las piezas de cada renglón vendido',
      ganancia: 'a cada renglón vendido le quité los impuestos (IVA, IEPS…) y le resté su costo de ese momento',
      tickets: 'conté los tickets cobrados',
      promedio: 'dividí lo cobrado entre el número de tickets',
    };
    const lineas = [`Periodo: ${r.nombre.replace(/^./, (c) => c.toLowerCase())} (${h.diaTexto(new Date(`${r.desde.slice(0, 10)}T12:00:00`))} a ${h.diaTexto(new Date(new Date(`${r.hasta.slice(0, 10)}T12:00:00`).getTime() - 86_400_000))}).`];
    const filtrosTxt = [producto, describir(fv)].filter(Boolean).join(', ');
    if (filtrosTxt) lineas.push(`Solo ${filtrosTxt}.`);
    lineas.push(`Cómo: ${quePasos[medida] || quePasos.ventas}${tickets != null ? `, de ${h.plural(tickets, 'ticket')}` : ''}.`);
    if (medida === 'ganancia') lineas.push('Un renglón sin costo cuenta como ganancia completa; las devoluciones no se restan aquí.');
    else lineas.push('Las devoluciones no se restan aquí: están en el corte y en Estadísticas.');
    return { lineas: [...lineas, ...extra] };
  }

  /** «Ojo: el martes 11 vendiste 45% menos que un martes normal.» (o null) */
  async function observacion(base, r, ctx) {
    if (ctx?.prefs?.observaciones === false) return null;
    try {
      const x = await A.diaRaro(base, r);
      if (!x) return null;
      const d = new Date(`${x.dia}T12:00:00`);
      const cual = `el ${DIAS[d.getDay()]} ${d.getDate()}`;
      if (x.valor === 0) return `Ojo: ${cual} no hubo ventas, y un ${DIAS[d.getDay()]} normal vende ${h.dinero(x.normal)}. ¿Cerraste ese día?`;
      return `Ojo: ${cual} vendiste ${h.dinero(x.valor)}, ${Math.abs(x.pct)}% ${x.pct < 0 ? 'menos' : 'más'} que un ${DIAS[d.getDay()]} normal (${h.dinero(x.normal)}).`;
    } catch { return null; }
  }

  /**
   * PREGUNTA LIBRE: qué medir × cómo agrupar × filtros × orden, o comparar.
   * Sin periodo dicho: el mes (y 8 semanas si se agrupa por hora o día de la
   * semana, que con pocos días no dicen nada).
   */
  async function libre(it, ctx) {
    const q = h.v(it, 'pregunta') || {};
    const fv = it.slots.filtros?.valor || {};
    const pid = h.v(it, 'producto');
    if (q.medida === 'ganancia' && ctx?.puede && !ctx.puede('VER_COSTOS')) return h.msg('La ganancia solo la ve quien puede ver costos.');
    if (q.comparar) return comparar(it, q, fv, ctx);
    const dicho = it.slots.periodo?.dicho || fv.rango;
    const defecto = ['hora', 'diaSemana'].includes(q.agrupar)
      ? (() => { const hoy = dia0(new Date()); return { desde: iso(mas(hoy, -55)), hasta: iso(mas(hoy, 1)), nombre: 'En las últimas 8 semanas', de: 'de las últimas 8 semanas', contra: 'las 8 semanas anteriores' }; })()
      : q.agrupar === 'dia' ? 'semana' : 'mes';
    const r = A.rango(fv.rango || (dicho ? h.v(it, 'periodo') : defecto));
    const base = aCubo(fv, { producto: pid });
    const M = MEDIDA[q.medida] || MEDIDA.ventas;
    const linea = ['piezas', 'ganancia'].includes(q.medida);
    const todas = await A.cubo.consultar({ filtros: { ...base, desde: r.desde, hasta: r.hasta }, agrupar: q.agrupar, medidas: linea ? ['piezas'] : [],
                                           orden: q.agrupar === 'dia' || q.agrupar === 'hora' ? 'clave' : (q.medida === 'promedio' ? 'ventas' : q.medida), limite: 500 });
    const p = pid ? await h.producto(pid) : null;
    const t = [r.nombre, p?.nombre, describir(fv)].filter(Boolean).join(', ');
    if (!todas.length) return h.msg(`${t}: no hubo ventas.`);
    const asc = q.orden === 'asc';
    const ordenadas = [...todas].sort((a, b) => (asc ? M.val(a) - M.val(b) : M.val(b) - M.val(a)));
    const top = ordenadas[0];
    const n = q.limite || (q.agrupar === 'hora' ? 24 : q.agrupar === 'dia' ? 62 : 10);
    /* Hora y día van en su orden natural (para la gráfica); lo demás, por la medida. */
    const lista = q.agrupar === 'hora' || q.agrupar === 'dia' ? todas.slice(0, n) : ordenadas.slice(0, n);
    const lider = q.agrupar === 'cajero' ? `Quien ${asc ? 'menos' : 'más'} ${M.nombre === 'ventas' ? 'vendió' : `${M.nombre} tuvo`} fue ${top.nombre}`
      : `${SUJETO[q.agrupar] || 'Lo'} con ${asc ? 'menos' : 'más'} ${M.nombre} ${q.agrupar === 'hora' || q.agrupar === 'dia' || q.agrupar === 'diaSemana' ? 'fue' : 'es'} ${etiquetaDe(q.agrupar, top)}`;
    const partes = [`${t}: ${lider.charAt(0).toLowerCase()}${lider.slice(1)} (${M.fmt(top)}).`];
    if (q.medida === 'ganancia' && todas.some((f) => f.sinCosto)) partes.push('Hay renglones sin costo: cuentan como ganancia completa.');
    const obs = await observacion(base, r, ctx);
    if (obs) partes.push(obs);
    const tickets = todas.reduce((a, f) => a + (f.tickets || 0), 0);
    return h.msg(partes.join(' '), {
      datos: lista.map((f) => ({ etiqueta: etiquetaDe(q.agrupar, f), valor: q.medida === 'ventas' && f.tickets != null ? `${M.fmt(f)} · ${h.plural(f.tickets, 'ticket')}` : M.fmt(f) })),
      grafica: { tipo: q.agrupar === 'dia' ? 'linea' : 'barras', dinero: M.dinero, puntos: lista.map((f) => ({ etiqueta: etiquetaDe(q.agrupar, f), valor: h.r2(M.val(f)) })) },
      refs: TIPO_REF[q.agrupar] ? lista.map((f) => ({ tipo: TIPO_REF[q.agrupar], id: Number(f.clave), nombre: String(f.nombre) })) : undefined,
      explica: explicacion({ r, fv, medida: q.medida, tickets, producto: p?.nombre }),
    });
  }

  /** «Octubre contra septiembre», «esta semana contra la pasada», «café contra concha». */
  async function comparar(it, q, fv, ctx) {
    const M = MEDIDA[q.medida] || MEDIDA.ventas;
    const medidas = ['piezas', 'ganancia'].includes(q.medida) ? ['piezas'] : [];
    const base = aCubo(fv, {});
    if (q.comparar.tipo === 'periodos') {
      const ra = A.rango(q.comparar.a.rango || q.comparar.a.periodo), rb = A.rango(q.comparar.b.rango || q.comparar.b.periodo);
      const pid = h.v(it, 'producto');
      const b2 = aCubo(fv, { producto: pid });
      const [xa, xb] = await Promise.all([A.cubo.consultar({ filtros: { ...b2, desde: ra.desde, hasta: ra.hasta }, medidas: pid ? ['piezas'] : medidas }),
                                          A.cubo.consultar({ filtros: { ...b2, desde: rb.desde, hasta: rb.hasta }, medidas: pid ? ['piezas'] : medidas })]);
      const p = pid ? await h.producto(pid) : null;
      const pct = h.pct(M.val(xa), M.val(xb));
      const de = [p?.nombre, describir(fv)].filter(Boolean).join(', ');
      const texto = `${ra.nombre}${de ? ` (${de})` : ''}: ${M.fmt(xa)}; ${rb.nombre.charAt(0).toLowerCase()}${rb.nombre.slice(1)}: ${M.fmt(xb)}${pct != null ? `. Eso es ${h.signo(pct)}` : ''}.`;
      return h.msg(texto, {
        datos: [{ etiqueta: ra.nombre, valor: `${M.fmt(xa)} · ${h.plural(xa.tickets, 'ticket')}` }, { etiqueta: rb.nombre, valor: `${M.fmt(xb)} · ${h.plural(xb.tickets, 'ticket')}` }],
        grafica: { tipo: 'barras', dinero: M.dinero, puntos: [{ etiqueta: ra.nombre, valor: h.r2(M.val(xa)) }, { etiqueta: rb.nombre, valor: h.r2(M.val(xb)) }] },
        explica: explicacion({ r: ra, fv, medida: q.medida, tickets: xa.tickets, producto: p?.nombre, extra: [`Y lo mismo para ${rb.nombre.toLowerCase()}.`] }),
        opciones: [{ etiqueta: '¿Por qué?', texto: '¿por qué?' }],
      });
    }
    const p1 = h.v(it, 'producto'), p2 = h.v(it, 'producto2');
    if (!p1 || !p2) return h.msg('¿Qué dos productos comparo? Dímelo así: «café contra concha».');
    const dicho = it.slots.periodo?.dicho || fv.rango;
    const r = A.rango(fv.rango || (dicho ? h.v(it, 'periodo') : 'mes'));
    const [a, b, pa, pb] = await Promise.all([
      A.cubo.consultar({ filtros: { ...base, productos: [p1], desde: r.desde, hasta: r.hasta }, medidas: ['piezas'] }),
      A.cubo.consultar({ filtros: { ...base, productos: [p2], desde: r.desde, hasta: r.hasta }, medidas: ['piezas'] }),
      h.producto(p1), h.producto(p2)]);
    const na = pa?.nombre || 'el primero', nb = pb?.nombre || 'el segundo';
    const medida = q.medida === 'ventas' ? 'ventas' : q.medida;
    const Mx = MEDIDA[medida] || MEDIDA.ventas;
    const gana = Mx.val(a) >= Mx.val(b) ? [na, a, b] : [nb, b, a];
    const pct = h.pct(Mx.val(gana[1]), Mx.val(gana[2]));
    const partes = [`${r.nombre}: ${na} ${Mx.fmt(a)} (${h.num(a.piezas)} piezas) y ${nb} ${Mx.fmt(b)} (${h.num(b.piezas)} piezas).`];
    if (pct != null && pct !== 0) partes.push(`${gana[0]} ${medida === 'ganancia' ? 'deja' : 'vende'} ${pct}% más${medida === 'ventas' ? ' en dinero' : ''}.`);
    if (medida === 'ventas' && (a.piezas - b.piezas) * (a.ventas - b.ventas) < 0) partes.push(`Pero en piezas gana ${a.piezas > b.piezas ? na : nb}.`);
    return h.msg(partes.join(' '), {
      datos: [{ etiqueta: na, valor: `${Mx.fmt(a)} · ${h.num(a.piezas)} pzas` }, { etiqueta: nb, valor: `${Mx.fmt(b)} · ${h.num(b.piezas)} pzas` }],
      grafica: { tipo: 'barras', dinero: Mx.dinero, puntos: [{ etiqueta: na, valor: h.r2(Mx.val(a)) }, { etiqueta: nb, valor: h.r2(Mx.val(b)) }] },
      refs: [{ tipo: 'producto', id: Number(p1), nombre: na }, { tipo: 'producto', id: Number(p2), nombre: nb }],
      explica: explicacion({ r, fv, medida, tickets: a.tickets + b.tickets, extra: [`Cada producto por separado: solo sus renglones.`] }),
    });
  }

  /**
   * CUALQUIER CONSULTA DE VENTA CON FILTROS. El intent dice qué medir y cómo
   * agrupar (def.analitica); los filtros, de qué.
   */
  async function cubo(def, it, ctx) {
    const fv = it.slots.filtros?.valor || {};
    const r = rangoDe(it);
    const pid = h.v(it, 'producto');
    const base = aCubo(fv, { producto: pid });
    let agrupar = def.analitica.agrupar || null;
    if (agrupar === 'producto' && pid) agrupar = null;
    if (agrupar === 'metodo' && h.v(it, 'metodo')) { base.metodo = h.v(it, 'metodo'); agrupar = null; }
    const medidas = pid || def.analitica.medida === 'ganancia' ? ['piezas'] : [];
    const ahora = { ...base, desde: r.desde, hasta: r.hasta };
    const t = titulo(r, { ...fv, ...(base.metodo && !fv.metodo ? { metodo: base.metodo } : {}) });

    if (!agrupar) {
      const [x, antes] = await Promise.all([A.cubo.consultar({ filtros: ahora, medidas }),
                                            A.cubo.consultar({ filtros: { ...base, desde: r.antesDesde, hasta: r.antesHasta }, medidas })]);
      if (!x.tickets) return h.msg(`${t}: no hubo ventas.`);
      const comp = h.pct(x.ventas, antes.ventas);
      const contra = comp != null ? [{ etiqueta: `Contra ${r.contra}`, valor: h.signo(comp) }] : [];
      if (def.analitica.medida === 'ganancia') {
        const margen = x.base > 0 ? Math.round(x.ganancia / x.base * 100) : 0;
        return h.msg(`${t}: la ganancia de lo vendido es ${h.dinero(x.ganancia)} (${margen}% de margen).`, {
          datos: [{ etiqueta: 'Ventas sin IVA', valor: h.dinero(x.base) }, { etiqueta: 'Costo de lo vendido', valor: h.dinero(x.costo) },
                  ...(x.sinCosto ? [{ etiqueta: 'Renglones sin costo', valor: `${x.sinCosto} (cuentan como ganancia completa)` }] : [])] });
      }
      if (pid) {
        const p = await h.producto(pid);
        return h.msg(`${t}: vendiste ${h.num(x.piezas)} de ${p?.nombre || 'ese producto'} por ${h.dinero(x.ventas)}.`, {
          datos: [{ etiqueta: 'Piezas', valor: h.num(x.piezas) }, { etiqueta: 'Importe', valor: h.dinero(x.ventas) },
                  { etiqueta: 'Tickets', valor: String(x.tickets) }, ...contra] });
      }
      const obs = await observacion(base, r, ctx);
      return h.msg(`${t}: vendiste ${h.dinero(x.ventas)} en ${h.plural(x.tickets, 'ticket')}.${obs ? ` ${obs}` : ''}`, {
        datos: [{ etiqueta: 'Ventas', valor: h.dinero(x.ventas) }, { etiqueta: 'Tickets', valor: String(x.tickets) },
                { etiqueta: 'Ticket promedio', valor: h.dinero(x.promedio) }, ...contra],
        explica: explicacion({ r, fv, medida: 'ventas', tickets: x.tickets }),
        opciones: [{ etiqueta: '¿Qué se vendió más?', texto: '¿y qué se vendió más?' }] });
    }

    const filas = await A.cubo.consultar({ filtros: ahora, agrupar, medidas, orden: def.analitica.orden || 'ventas', limite: agrupar === 'hora' ? 24 : 10 });
    if (!filas.length) return h.msg(`${t}: no hubo ventas.`);
    const total = filas.reduce((a, f) => a + f.ventas, 0);
    const tickets = filas.reduce((a, f) => a + (f.tickets || 0), 0);
    const medidaDe = agrupar === 'producto' ? 'piezas' : 'ventas';
    const grafica = { tipo: 'barras', dinero: medidaDe !== 'piezas', puntos: filas.map((f) => ({ etiqueta: etiquetaDe(agrupar, f), valor: h.r2(medidaDe === 'piezas' ? f.piezas : f.ventas) })) };
    const explica = explicacion({ r, fv, medida: medidaDe, tickets: agrupar === 'producto' ? null : tickets });
    const refs = TIPO_REF[agrupar] ? filas.map((f) => ({ tipo: TIPO_REF[agrupar], id: Number(f.clave), nombre: String(f.nombre) })) : undefined;
    if (agrupar === 'producto') {
      return h.msg(`Lo más vendido (${t.charAt(0).toLowerCase()}${t.slice(1)}): ${filas[0].nombre}.`, {
        datos: filas.map((f) => ({ etiqueta: f.nombre, valor: `${h.num(f.piezas)} · ${h.dinero(f.ventas)}` })), grafica, explica, refs });
    }
    if (agrupar === 'metodo') {
      return h.msg(`${t}: vendiste ${h.dinero(total)}, así:`, {
        datos: filas.map((f) => ({ etiqueta: METODO[f.nombre] || f.nombre, valor: `${h.dinero(f.ventas)} · ${total ? Math.round(f.ventas / total * 100) : 0}%` })), grafica, explica });
    }
    if (agrupar === 'hora') {
      const pico = [...filas].sort((a, b) => b.ventas - a.ventas)[0];
      return h.msg(`${t}: tu hora más fuerte es ${nombreMiembro('hora', pico)}.`, {
        datos: filas.map((f) => ({ etiqueta: `${hTexto(Number(f.clave))} – ${hTexto(Number(f.clave) + 1)}`, valor: `${h.dinero(f.ventas)} · ${h.plural(f.tickets, 'ticket')}` })), grafica, explica });
    }
    return h.msg(`${t}: quien más vendió fue ${filas[0].nombre}.`, {
      datos: filas.map((f) => ({ etiqueta: f.nombre, valor: `${h.dinero(f.ventas)} · ${h.plural(f.tickets, 'ticket')}` })), grafica, explica, refs });
  }

  return {
    /** No es un intent: lo llama acciones/index.js cuando una consulta trae filtros. */
    _cubo: cubo,

    'analisis.libre': libre,

    async 'venta.comparar'(it) {
      const fv = it.slots.filtros?.valor || {};
      const pid = h.v(it, 'producto');
      const base = aCubo(fv, { producto: pid });
      const p = pid ? await h.producto(pid) : null;
      const x = await A.porQue(periodoDe(it, { siNoSeDijo: 'semana' }), base);
      const que = [p?.nombre, describir(fv)].filter(Boolean).join(', ');
      const de = que ? ` (${que})` : '';
      if (!x.antes.ventas) return h.msg(`${x.rango.nombre}${de} llevas ${h.dinero(x.ahora.ventas)}; no hay ventas en ${x.rango.contra} para comparar.`);
      const sube = x.delta >= 0;
      const igual = x.pct != null && Math.abs(x.pct) < 3;
      const partes = [];
      partes.push(igual ? `${x.rango.nombre}${de} vas prácticamente igual que ${x.rango.contra}: ${h.dinero(x.ahora.ventas)} contra ${h.dinero(x.antes.ventas)}.`
        : `${x.rango.nombre}${de} vendiste ${h.dinero(x.ahora.ventas)}: ${h.signo(x.pct)} contra ${x.rango.contra} (${h.dinero(x.antes.ventas)}).`);
      if (!igual) {
        /* ¿Vinieron menos o gastaron menos? */
        const pt = Math.abs(x.porTickets), pp = Math.abs(x.porPromedio);
        const clientes = `${h.plural(x.ticketsAhora, 'ticket')} contra ${x.ticketsAntes}`;
        const gasto = `${h.dinero(x.promAhora)} por ticket contra ${h.dinero(x.promAntes)}`;
        if (pt > pp * 1.5) partes.push(`Casi todo es porque ${x.porTickets < 0 ? 'vinieron menos' : 'vinieron más'} clientes (${clientes}); cada uno gastó parecido.`);
        else if (pp > pt * 1.5) partes.push(`Vinieron casi los mismos clientes, pero cada uno gastó ${x.porPromedio < 0 ? 'menos' : 'más'} (${gasto}).`);
        else partes.push(`Fueron las dos cosas: ${x.porTickets < 0 ? 'menos' : 'más'} clientes (${clientes}) y ${x.porPromedio < 0 ? 'menos' : 'más'} gasto por cliente (${gasto}).`);
        /* Dónde se concentró. */
        const [c1, c2] = x.causas;
        if (c1) partes.push(`Donde más se notó: ${c1.miembros.map((m) => `${nombreMiembro(c1.dimension, m)} (${conSigno(m.delta)})`).join(' y ')}.`);
        if (c2) partes.push(`También ${c2.miembros.slice(0, 1).map((m) => `${nombreMiembro(c2.dimension, m)} (${conSigno(m.delta)})`).join('')}.`);
      }
      const datos = (x.causas[0]?.miembros || []).concat(x.causas[1]?.miembros.slice(0, 1) || [])
        .map((m, i) => ({ etiqueta: nombreMiembro(i < (x.causas[0]?.miembros.length || 0) ? x.causas[0].dimension : x.causas[1].dimension, m).replace(/^./, (c) => c.toUpperCase()),
                          valor: `${h.dinero(m.antes)} → ${h.dinero(m.ahora)}` }));
      return h.msg(partes.join(' '), { datos, tono: !sube && x.pct != null && x.pct < -10 ? 'atencion' : 'normal',
        opciones: [{ etiqueta: '¿Qué se vendió más?', intent: 'venta.top', params: { periodo: h.v(it, 'periodo') } }] });
    },

    async 'analisis.pronostico'(it) {
      const ahora = new Date();
      const hoy = iso(dia0(ahora));
      const fecha = h.v(it, 'fecha') || (ahora.getHours() < 14 ? hoy : iso(mas(dia0(ahora), 1)));
      const pid = h.v(it, 'producto');
      const p = pid ? await h.producto(pid) : null;
      const x = await A.pronostico(fecha, pid ? { productos: [pid] } : {}, ahora);
      const cuando = fecha === hoy ? 'Hoy' : fecha === iso(mas(dia0(ahora), 1)) ? 'Mañana' : `El ${DIAS[new Date(`${fecha}T12:00:00`).getDay()]}`;
      if (x.confianza === 'ninguna') return h.msg(`Todavía no tengo ventas de ${DIAS_PLURAL[new Date(`${fecha}T12:00:00`).getDay()]}${p ? ` de ${p.nombre}` : ''} para calcularlo.`);
      const cuanto = p ? `${h.num(Math.round(x.estimado))} ${p.nombre}` : h.dinero(x.estimado);
      const rango = p ? `entre ${h.num(Math.round(x.bajo))} y ${h.num(Math.round(x.alto))}` : `entre ${h.dinero(x.bajo)} y ${h.dinero(x.alto)}`;
      const partes = [`${cuando} calculo ${p ? 'que se vendan unas' : 'unos'} ${cuanto} (un ${DIAS[new Date(`${fecha}T12:00:00`).getDay()]} normal va ${rango}).`];
      const datos = [{ etiqueta: 'Calculado con', valor: `${h.plural(x.semanas, 'semana')} de historia` }];
      if (x.tendencia >= 1.05 || x.tendencia <= 0.95) datos.push({ etiqueta: 'Tendencia del último mes', valor: h.signo(Math.round((x.tendencia - 1) * 100)) });
      if (fecha === hoy && !p) {
        const llevas = await A.cubo.consultar({ filtros: { desde: `${hoy}T00:00:00`, hasta: `${iso(mas(dia0(ahora), 1))}T00:00:00` } });
        partes.push(`Llevas ${h.dinero(llevas.ventas)}${x.estimado > llevas.ventas ? `; faltarían unos ${h.dinero(x.estimado - llevas.ventas)}` : ': ya pasaste lo normal'}.`);
      }
      if (x.confianza === 'poca') partes.push('Con tan poca historia, tómalo como referencia.');
      const opciones = p && p.inventory_mode === 'RECIPE' && x.estimado >= 1
        ? [{ etiqueta: `Planear ${Math.ceil(x.estimado)}`, intent: 'produccion.planear', params: { productId: p.id, cantidad: Math.ceil(x.estimado), fecha } }] : [];
      return h.msg(partes.join(' '), { datos, opciones });
    },

    async 'analisis.agotar'(it) {
      const pid = h.v(it, 'producto');
      if (!pid) {
        const xs = (await h.sensores.reorden.leer()).filter((x) => x.modo === 'DIRECT' && x.promDiario > 0).sort((a, b) => a.dias - b.dias);
        if (!xs.length) return h.msg('Nada se te acaba en los próximos 7 días al ritmo de venta de este mes.', { tono: 'exito' });
        return h.msg(`Esta semana se te ${xs.length === 1 ? 'acaba' : 'acaban'} ${h.plural(xs.length, 'producto')}. El primero: ${xs[0].nombre}${xs[0].dias <= 0 ? ', que ya está en cero' : ` en ${h.plural(Math.max(1, Math.round(xs[0].dias)), 'día')}`}.`, {
          datos: xs.slice(0, 10).map((x) => ({ etiqueta: x.nombre, valor: x.dias <= 0 ? 'ya en cero' : `${h.plural(Math.max(1, Math.round(x.dias)), 'día')} · quedan ${h.cant(x.stock, x.uom)}` })),
          opciones: [{ etiqueta: '¿Qué me falta comprar?', intent: 'consulta.comprar' }], tono: 'atencion' });
      }
      const p = await h.producto(pid);
      if (!p) return h.msg('No encontré ese producto.');
      if (p.inventory_mode !== 'DIRECT') return h.msg(`De ${p.nombre} no llevo existencia: se hace con su receta. Pregúntame por uno de sus ingredientes.`);
      const x = await A.cuandoSeAcaba(p.id, p.stock);
      const queda = h.cant(p.stock, p.base_uom || 'pza');
      if (x.dias === 0) return h.msg(`${p.nombre} ya se acabó (quedan ${queda}).`, { tono: 'atencion', opciones: [{ etiqueta: '¿Qué me falta comprar?', intent: 'consulta.comprar' }] });
      if (x.sinVenta) return h.msg(`${p.nombre} no se ha vendido en 4 semanas: tus ${queda} te duran mucho.`);
      if (x.dias == null) return h.msg(`Al ritmo de ${h.num(Math.round(x.porDia * 10) / 10)} al día, tus ${queda} de ${p.nombre} alcanzan para más de 2 meses.`, { tono: 'exito' });
      const fecha = new Date(`${x.fecha}T12:00:00`);
      return h.msg(`Al ritmo de ${h.num(Math.round(x.porDia * 10) / 10)} al día, ${p.nombre} se te acaba ${x.dias === 1 ? 'mañana' : `el ${DIAS[fecha.getDay()]} (${h.plural(x.dias, 'día')})`}. Quedan ${queda}.`, {
        tono: x.dias <= 3 ? 'atencion' : 'normal',
        datos: [{ etiqueta: 'Se vende al día', valor: h.num(Math.round(x.porDia * 10) / 10) }, { etiqueta: 'Se acaba', valor: h.diaTexto(fecha) }],
        opciones: [{ etiqueta: '¿Qué me falta comprar?', intent: 'consulta.comprar' }] });
    },

    async 'analisis.simular'(it) {
      const m = (await h.sensores.margenes.leer()).find((x) => x.id === Number(h.v(it, 'producto')));
      if (!m) return h.msg('Ese producto no se vende o no tiene precio.');
      const delta = it.slots.precio?.delta;
      const nuevo = h.r2(delta != null ? m.precio + delta : h.v(it, 'precio'));
      if (!(nuevo > 0)) return h.msg('El precio nuevo tiene que ser mayor a cero.');
      if (m.costo == null) return h.msg(`${m.nombre} no tiene costo todavía: sin él no puedo saber cuánto ganarías. Se llena con su primera compra.`);
      const x = A.simularPrecio({ precio: m.precio, nuevo, costo: m.costo, tasa: m.tasa, piezas: m.vendidos30 });
      const partes = [`Hoy le ganas ${h.dinero(x.porPieza)} a cada ${m.nombre}; a ${h.dinero(nuevo)} serían ${h.dinero(x.porPiezaNueva)}.`];
      if (m.vendidos30 > 0) {
        partes.push(`Vendiendo lo mismo que el último mes (${h.num(m.vendidos30)}), ${x.diferencia >= 0 ? 'ganarías' : 'perderías'} ${h.dinero(Math.abs(x.diferencia))} ${x.diferencia >= 0 ? 'más' : 'menos'} al mes.`);
        if (x.margenPiezas != null && x.margenPiezas > 0.5) partes.push(`Y aunque vendieras hasta ${h.num(Math.floor(x.margenPiezas))} menos (${Math.round(x.margenPct * 100)}%), seguirías ganando lo mismo que hoy.`);
        else if (x.margenPiezas != null && x.margenPiezas < -0.5) partes.push(`Para ganar lo mismo tendrías que vender ${h.num(Math.ceil(-x.margenPiezas))} más al mes (${Math.round(-x.margenPct * 100)}% más).`);
      } else partes.push('No se ha vendido en el último mes, así que no hay con qué comparar.');
      const avisos = [];
      if (x.perdida) avisos.push('Con ese precio vendes con pérdida.');
      if (x.saltoGrande) avisos.push(`Es un cambio de ${h.signo(Math.round(x.cambioPrecio * 100))}: los clientes lo notan.`);
      return h.msg([...partes, ...avisos].join(' '), {
        datos: [{ etiqueta: 'Precio', valor: `${h.dinero(m.precio)} → ${h.dinero(nuevo)}` }, { etiqueta: 'Costo', valor: h.dinero(m.costo) },
                { etiqueta: 'Ganancia por pieza', valor: `${h.dinero(x.porPieza)} → ${h.dinero(x.porPiezaNueva)}` },
                ...(m.vendidos30 > 0 ? [{ etiqueta: 'Ganancia al mes', valor: `${h.dinero(x.gananciaHoy)} → ${h.dinero(x.gananciaNueva)}` }] : [])],
        tono: x.perdida ? 'atencion' : 'normal',
        opciones: [{ etiqueta: `Cambiar el precio a ${h.dinero(nuevo)}`, intent: 'producto.precio', params: { productId: m.id, precio: nuevo } }] });
    },
  };
};
