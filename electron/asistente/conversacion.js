'use strict';
/**
 * LA CONVERSACIÓN: lo que entra al chat y lo que Wybix contesta.
 *
 * Entra una de dos cosas:
 *   texto   lo que la persona escribió → intérprete → respuesta.
 *   accion  un botón que Wybix ofreció ({ intent, params }): no se
 *           interpreta, ya se sabe qué es (hallazgo.ver, ir_a, planear…).
 *
 * Wybix recuerda, por persona:
 *   pendiente  si hizo una pregunta («¿De cuál dona?»): la siguiente frase
 *              se toma como respuesta salvo que sea claramente otra orden.
 *              Si la pregunta salió a media frase compuesta, lo que faltaba
 *              de la frase (`cola`) sigue después de la respuesta.
 *   contexto   lo último que se entendió (intent y datos), 10 minutos: así
 *              entiende «¿y ayer?», «¿y de las conchas?» o «¿y cuánto le
 *              gano?» sin repetir todo.
 *   turno      cuántos mensajes van: con eso varía las palabras (acciones/voz.js).
 *   ultimo     la lista que acaba de dar (qué es cada renglón) y de dónde
 *              salió el último número: así entiende «dime más del segundo»
 *              y «¿cómo lo calculaste?».
 *   prefs      cómo le gusta que le hable (asistente_preferencias): nombre,
 *              resumen, gráficas, observaciones, leer en voz alta.
 *
 * Además:
 *   compuestas  «registra $500 de luz y dime cuánto me queda en caja»: se
 *               parte (lenguaje/compuesto.js) y se contesta cada pedazo, en
 *               orden, con el contexto del anterior.
 *   aprende     si preguntó «¿cuál?» y la persona eligió, lo que dijo queda
 *               como apodo de lo que eligió («huevo» → Huevo blanco kilo).
 *
 * Todo mensaje (de la persona y de Wybix) queda en asistente_mensajes.
 */
const { porId } = require('./lenguaje/intents');
const { partir } = require('./lenguaje/compuesto');
const { normalizar } = require('./lenguaje/normalizar');
const ref = require('./lenguaje/referencias');
const voz = require('./acciones/voz');

const CONTEXTO_MS = 10 * 60_000;
/* Datos que, si Wybix preguntó «¿cuál?» y la persona eligió, se aprenden como apodo. */
const APRENDIBLES = { producto: 'producto', servicio: 'producto', cliente: 'cliente', proveedor: 'proveedor', profesional: 'profesional' };

function crearConversacion({ interprete, acciones, store, datos, listarHallazgos, log = () => {}, aprender = null }) {
  const pendientes = new Map();   // userId → { intent, slots, falta, cola? }
  const contextos = new Map();    // userId → { intent, slots, en }
  const turnos = new Map();       // userId → n
  const ultimos = new Map();      // userId → { refs, explica }

  const prefsDe = async (userId) => { try { return (await store.preferencias?.(userId)) || {}; } catch { return {}; } };

  /** Lo que sale al chat: sin lo interno (refs, explica), con lo que pidió la persona. */
  function vestir(userId, m, prefs) {
    if (!m || m.autor !== 'wybix') return m;
    const u = ultimos.get(userId) || {};
    if (m.refs?.length) u.refs = m.refs;
    else if (m.datos?.length > 1) u.refs = null;   // otra lista: «el segundo» ya no es el de antes
    if (m.explica || m.plan || m.datos) u.explica = m.explica || null;
    ultimos.set(userId, u);
    const { refs, explica, preferencias, ...limpio } = m;
    if (explica && !limpio.opciones?.some((o) => /calcul/i.test(o.etiqueta))) {
      limpio.opciones = [...(limpio.opciones || []), { etiqueta: '¿Cómo lo calculé?', texto: '¿Cómo lo calculaste?' }];
    }
    if (prefs.graficas === false) delete limpio.grafica;
    if ((preferencias?.hablar ?? prefs.hablar) === true) limpio.hablar = true;
    return limpio;
  }

  const ahoraIso = () => new Date().toISOString();
  const id = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const sello = (m) => ({ id: id(), en: ahoraIso(), ...m });
  const turno = (userId) => { const n = (turnos.get(userId) || 0) + 1; turnos.set(userId, n); return n; };

  function contextoDe(userId) {
    const c = contextos.get(userId);
    return c && Date.now() - c.en < CONTEXTO_MS ? c : null;
  }
  function recordar(userId, interp) {
    if (!interp?.intent || interp.intent === 'saludo' || interp.intent === 'ayuda') return;
    /* Solo los datos ya resueltos: un dato dudoso no se hereda. */
    const slots = Object.fromEntries(Object.entries(interp.slots || {}).filter(([, v]) => v && v.confianza !== 'dudoso' && (v.valor != null || v.delta != null)));
    contextos.set(userId, { intent: interp.intent, slots, en: Date.now() });
  }

  async function guardar(userId, ...mensajes) {
    for (const m of mensajes) { try { await store.guardarMensaje(userId, m); } catch (e) { log(`[ASISTENTE] mensaje: ${e.message}`); } }
    return mensajes;
  }

  /** Interpretación armada desde un botón: los datos ya vienen exactos. */
  async function desdeAccion(intent, params = {}) {
    const slots = {};
    const ex = (valor, texto) => ({ valor, texto, confianza: 'exacto' });
    const d = await datos();
    const nombreDe = (lista, idv) => lista.find((x) => x.id === Number(idv))?.nombre || '';
    if (params.productId != null) slots.producto = ex(Number(params.productId), nombreDe(d.catalogo, params.productId) || params.nombre || '');
    if (params.clienteId != null) slots.cliente = ex(Number(params.clienteId), nombreDe(d.personas.filter((p) => p.tipo === 'cliente'), params.clienteId));
    if (params.proveedorId != null) slots.proveedor = ex(Number(params.proveedorId), nombreDe(d.personas.filter((p) => p.tipo === 'proveedor'), params.proveedorId));
    if (params.cantidad != null) slots.cantidad = ex(Number(params.cantidad), String(params.cantidad));
    if (params.precio != null) slots.precio = ex(Number(params.precio), String(params.precio));
    if (params.fecha) slots.fecha = ex(params.fecha, params.fecha);
    if (params.periodo) slots.periodo = { ...ex(params.periodo, params.periodo), dicho: true };
    if (params.folio != null) slots.folio = ex(Number(params.folio), String(params.folio));
    if (params.ruta) slots.destino = ex(params.ruta, params.etiqueta || 'esa pantalla');
    const def = porId(intent);
    if (def?.slots?.periodo && !slots.periodo) slots.periodo = ex('hoy', 'hoy');
    let falta = null;
    for (const [k, s] of Object.entries(def?.slots || {})) if (s.requerido && !slots[k]) { falta = k; break; }
    return { intent, puntaje: 1, alternativas: [], slots, falta };
  }

  /**
   * ¿Se aprende un apodo? Wybix preguntó «¿cuál?» por algo que se dijo de
   * otra forma, y la respuesta lo resolvió.
   */
  async function quizaAprender(userId, esperando, interp) {
    const k = esperando?.falta;
    const tipo = APRENDIBLES[k];
    if (!tipo || !aprender || interp.intent !== esperando.intent) return null;
    const antes = esperando.slots?.[k], ahora = interp.slots?.[k];
    if (!antes || antes.confianza !== 'dudoso' || !antes.texto || ahora?.valor == null || ahora.confianza === 'dudoso') return null;
    const dicho = normalizar(String(antes.texto)).texto;
    const nombre = String(ahora.texto || '');
    if (!dicho || /^\d+$/.test(dicho) || dicho.split(' ').length > 4 || dicho === normalizar(nombre).texto) return null;
    try {
      const r = await aprender({ alias: dicho, tipo, refId: ahora.valor }, userId);
      return r?.alias ? { alias: r.alias, nombre } : null;
    } catch (e) { log(`[ASISTENTE] no aprendí «${dicho}»: ${e.message}`); return null; }
  }

  /** Un pedazo de texto → la respuesta de Wybix (sin el mensaje de la persona). */
  async function contestar(ctx, texto, profundidad = 0) {
    const userId = ctx.userId;
    const esperando = pendientes.get(userId) || null;
    const norm = normalizar(texto).texto;
    const u = ultimos.get(userId) || {};

    /* «¿Cómo lo calculaste?»: de dónde salió la última respuesta. */
    if (!esperando && ref.explica(norm)) {
      const c0 = { ...ctx, turno: turno(userId) };
      if (!u.explica) return { m: { autor: 'wybix', texto: 'Esa respuesta no lleva cálculo: sale tal cual de lo registrado en Wybix.' } };
      return { m: { autor: 'wybix', texto: `Lo saqué así: ${u.explica.lineas.join(' ')}`, explicacion: true, turno: c0.turno } };
    }

    /* «Dime más del segundo», «¿y el último?», «¿cuánto deja ese?»: un
       renglón de la lista que Wybix acaba de dar. */
    const r0 = !esperando && profundidad === 0 && u.refs?.length ? ref.referencia(norm) : null;
    if (r0 && !ref.porQue(norm)) {
      const item = r0.indice < 0 ? u.refs[u.refs.length - 1] : u.refs[r0.indice];
      if (!item) return { m: { autor: 'wybix', texto: `La lista que te di tiene ${u.refs.length} ${u.refs.length === 1 ? 'renglón' : 'renglones'}.` } };
      const resto = norm.replace(r0.texto, ' ').replace(/\s+/g, ' ').trim();
      if (ref.MAS_DE.test(resto)) {
        const intent = { producto: 'producto.info', cliente: 'cliente.info' }[item.tipo];
        if (intent) {
          const interp = await desdeAccion(intent, item.tipo === 'producto' ? { productId: item.id } : { clienteId: item.id });
          const r = await acciones.responder(interp, { ...ctx, turno: turno(userId) });
          if (!r.esperando) recordar(userId, interp);
          return { m: r };
        }
        if (item.tipo === 'categoria') return contestar(ctx, `cuanto vendi de ${item.nombre} este mes`, 1);
      }
      /* «¿Cuánto deja ese?» → «¿cuánto deja Concha?» */
      return contestar(ctx, `${norm.replace(r0.texto, ` ${item.tipo === 'categoria' ? 'de ' : ''}${item.nombre} `)}`.replace(/\s+/g, ' ').trim(), profundidad + 1);
    }

    const d = await datos();
    const interp = interprete().interpretar(texto, { ...d, ahora: new Date(), esperando, contexto: contextoDe(userId) });
    interp.texto = texto;
    pendientes.delete(userId);
    const c = { ...ctx, turno: turno(userId) };

    if (!interp.intent) {
      return { m: { autor: 'wybix', texto: voz.di(interp.alternativas.length ? 'no.entendi' : 'no.entendi.nada', c),
        opciones: interp.alternativas.length
          ? interp.alternativas.map((a) => ({ etiqueta: a.etiqueta, intent: a.intent }))
          : [{ etiqueta: '¿Qué puedes hacer?', intent: 'ayuda' }, { etiqueta: '¿Qué debo revisar?', intent: 'consulta.pendientes' }],
        tono: 'normal' }, cola: esperando?.cola };
    }
    /* Poca seguridad entre dos intents: se pregunta cuál, sin adivinar. */
    if (interp.puntaje < 0.45 && !esperando && !interp.deContexto) {
      return { m: { autor: 'wybix', texto: voz.di('cual', c),
        opciones: [{ etiqueta: porId(interp.intent)?.etiqueta, intent: interp.intent }, ...interp.alternativas.map((a) => ({ etiqueta: a.etiqueta, intent: a.intent }))] } };
    }
    const r = await acciones.responder(interp, c);
    if (r.esperando) pendientes.set(userId, { ...r.esperando, cola: esperando?.cola });
    else recordar(userId, interp);
    const aprendido = esperando && !r.esperando ? await quizaAprender(userId, esperando, interp) : null;
    if (aprendido) r.texto = `${r.texto} ${voz.di('aprendi', c, aprendido)}`;
    /* Lo que se entendió bien y no es pregunta queda como ejemplo del negocio
       (las acciones, al confirmarse; las consultas, al responderse). */
    if (!r.esperando && porId(interp.intent)?.tipo === 'consulta' && interp.puntaje >= 0.6 && !interp.deContexto) {
      try { await store.guardarFrase(texto, interp.intent, userId); } catch { /* no es crítico */ }
    }
    if (r.plan) r.plan.texto = texto;
    return { m: r, cola: r.esperando ? null : esperando?.cola };
  }

  /**
   * ¿Es una frase compuesta? Solo si cada pedazo, solo, se entiende bien y
   * no son todos lo mismo (eso es una sola pregunta con «y»).
   */
  async function piezas(ctx, texto) {
    const ps = partir(texto);
    if (ps.length < 2 || pendientes.get(ctx.userId)) return [texto];
    const d = await datos();
    const its = ps.map((p) => interprete().interpretar(p, { ...d, ahora: new Date(), contexto: contextoDe(ctx.userId) }));
    const buenas = its.every((x, i) => x.intent && (x.puntaje >= 0.5 || i > 0));
    const distintas = new Set(its.map((x) => `${x.intent}|${JSON.stringify(x.slots)}`)).size === its.length;
    return buenas && distintas ? ps : [texto];
  }

  /**
   * @param ctx { userId, usuario, puede(paquete) }
   * @param entrada { texto } | { accion: { intent, params, etiqueta } }
   * @returns Mensaje[] (lo de la persona y la respuesta)
   */
  async function procesar(ctx0, entrada) {
    const userId = ctx0.userId;
    const prefs = await prefsDe(userId);
    const ctx = { ...ctx0, prefs };
    const salida = [];
    /* Todo lo que dice Wybix sale «vestido» (sin lo interno, con lo que pidió la persona). */
    const decir = (m) => sello(vestir(userId, m, prefs));

    if (entrada.accion) {
      const { intent, params = {}, etiqueta } = entrada.accion;
      salida.push(decir({ autor: 'persona', texto: etiqueta || porId(intent)?.etiqueta || intent }));
      pendientes.delete(userId);
      if (intent === 'hallazgo.ver') {
        const x = await store.porId(params.id);
        if (!x) salida.push(decir({ autor: 'wybix', texto: 'Eso ya se resolvió.' }));
        else {
          await store.marcar(x.id, 'visto', { userId });
          salida.push(decir(mensajeDeHallazgo(x)));
        }
        return guardar(userId, ...salida);
      }
      if (intent === 'hallazgo.posponer' || intent === 'hallazgo.descartar') {
        await store.marcar(params.id, intent === 'hallazgo.posponer' ? 'posponer' : 'descartar',
                           { userId, horas: params.horas ?? 24, motivo: params.motivo ?? null, alcance: params.alcance ?? 'clave' });
        salida.push(decir({ autor: 'wybix', texto: intent === 'hallazgo.posponer' ? 'Va, te lo recuerdo mañana.' : 'Listo, no te lo vuelvo a mostrar.' }));
        return guardar(userId, ...salida);
      }
      const interp = await desdeAccion(intent, params);
      const r = await acciones.responder(interp, { ...ctx, turno: turno(userId), hallazgoId: params.hallazgoId ?? null });
      if (r.esperando) pendientes.set(userId, r.esperando);
      else recordar(userId, interp);
      salida.push(decir(r));
      return guardar(userId, ...salida);
    }

    const texto = String(entrada.texto || '').trim().slice(0, 400);
    if (!texto) return [];
    salida.push(decir({ autor: 'persona', texto }));

    /* Una frase, o varias en una. Si un pedazo pregunta algo, lo que falta
       de la frase espera a la respuesta. */
    let cola = await piezas(ctx, texto);
    while (cola.length) {
      const [actual, ...resto] = cola;
      const { m, cola: siguen } = await contestar(ctx, actual);
      salida.push(decir(m));
      if (m.esperando) {
        const p = pendientes.get(userId);
        if (resto.length && p) pendientes.set(userId, { ...p, cola: [...resto, ...(p.cola || [])] });
        break;
      }
      cola = [...resto, ...(siguen || [])];
    }
    return guardar(userId, ...salida);
  }

  return { procesar, contextoDe, olvidar: (userId) => { pendientes.delete(userId); contextos.delete(userId); } };
}

/** Un hallazgo dicho como mensaje del chat, con sus botones. */
function mensajeDeHallazgo(x) {
  return {
    autor: 'wybix', texto: `${x.titulo}. ${x.detalle}`, hallazgo: x, datos: x.evidencia,
    tono: x.severidad === 'critico' || x.severidad === 'importante' ? 'atencion' : 'normal',
    opciones: [
      ...(x.acciones || []).map((a) => ({ etiqueta: a.etiqueta, intent: a.intent, params: { ...(a.params || {}), hallazgoId: x.id } })),
      { etiqueta: 'Recuérdamelo mañana', intent: 'hallazgo.posponer', params: { id: x.id, horas: 24 } },
      { etiqueta: 'Ya lo sé', intent: 'hallazgo.descartar', params: { id: x.id } },
    ],
  };
}

module.exports = { crearConversacion, mensajeDeHallazgo };
