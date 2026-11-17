'use strict';
/**
 * EL MOTOR DE REGLAS DEL ASISTENTE. Puro: sin SQL, sin Electron, sin UI.
 *
 * Una regla es un MANIFIESTO más una función `evaluar(hechos, umbrales, ctx)`
 * que devuelve lo que encontró. El motor:
 *
 *   1. elige las reglas activas: las de los packs cuyo `requiere` cumple el
 *      negocio (capacidades, módulos y derechos de la licencia: la misma
 *      regla que la navegación). Nada de `if (giro === …)`;
 *   2. junta los sensores que piden y ejecuta cada uno UNA vez (diez reglas
 *      de inventario no son diez consultas), con caché por tiempo;
 *   3. evalúa cada regla aislada: una que falla no tumba a las demás;
 *   4. arma la clave (regla + entidad + periodo), la prioridad y aplica
 *      `supera` («agotado» supera a «se acaba pronto» en el mismo producto).
 *
 * Lo que hace con los hallazgos (guardarlos, resolverlos, mostrarlos) es del
 * store y del chat, no de aquí. Pruebas: scripts/pruebas/asistente.test.mjs.
 */

const PESO = { info: 20, aviso: 45, importante: 70, critico: 92 };

/**
 * 0–100. Explicable: severidad, cuánto cuesta en pesos (si se sabe), qué tan
 * seguros estamos de los datos y cuánto ha descartado ya este negocio esa
 * regla (fatiga).
 */
function prioridad({ severidad = 'aviso', impacto = 0, confianza = 1, fatiga = 0 }) {
  const base = PESO[severidad] ?? PESO.aviso;
  const porImpacto = 0.8 + 0.2 * Math.min(1, Math.max(0, Number(impacto) || 0) / 1000);
  const c = Math.min(1, Math.max(0.3, Number(confianza) || 1));
  const f = Math.min(0.8, Math.max(0, Number(fatiga) || 0));
  return Math.max(1, Math.min(100, Math.round(base * porImpacto * c * (1 - f))));
}

/** Umbrales: los del manifiesto con lo que el negocio cambió, siempre dentro de [min, max]. */
function umbralesDe(regla, propios = {}) {
  const out = {};
  for (const [k, d] of Object.entries(regla.umbrales || {})) {
    let v = propios[k] ?? d.def;
    v = Number(v);
    if (!Number.isFinite(v)) v = d.def;
    if (d.min != null) v = Math.max(d.min, v);
    if (d.max != null) v = Math.min(d.max, v);
    out[k] = v;
  }
  return out;
}

/** ¿El negocio tiene lo que la regla necesita? */
function cumple(requiere = {}, ctx) {
  const tiene = (lista, pregunta) => (lista || []).every((x) => pregunta(x));
  return tiene(requiere.capacidades, (c) => ctx.tieneCapacidad?.(c) ?? false)
      && tiene(requiere.entitlements, (e) => ctx.tieneDerecho?.(e) ?? true);
}

const claveEntidad = (e) => (e ? `${e.tipo}:${e.id}` : '-');

/**
 * @param {object} o
 *   packs      [{ id, reglas: [manifiesto…] }]
 *   sensores   { id: { leer(ctx) → Promise<hechos>, ttlMs? } }
 *   ahora      () => ms
 */
function crearMotor({ packs = [], sensores = {}, ahora = () => Date.now(), log = () => {} }) {
  const reglas = packs.flatMap((p) => (p.reglas || []).map((r) => ({ ...r, pack: p.id })));
  const ids = new Set();
  for (const r of reglas) {
    if (!r.id || typeof r.evaluar !== 'function') throw new Error(`Regla sin id o sin evaluar en el pack ${r.pack}`);
    if (ids.has(r.id)) throw new Error(`Regla repetida: ${r.id}`);
    ids.add(r.id);
    for (const s of r.sensores || []) if (!sensores[s]) throw new Error(`La regla ${r.id} pide el sensor ${s}, que no existe`);
  }
  const cache = new Map();   // sensor → { en, valor }

  function activas(ctx) {
    return reglas.filter((r) => cumple(r.requiere, ctx) && (!ctx.config?.[r.id] || ctx.config[r.id].activa !== false));
  }

  async function leerSensor(id, ctx, forzar) {
    const s = sensores[id];
    const c = cache.get(id);
    if (!forzar && c && ahora() - c.en < (s.ttlMs ?? 60_000)) return c.valor;
    const valor = await s.leer(ctx);
    cache.set(id, { en: ahora(), valor });
    return valor;
  }

  /**
   * Evalúa y devuelve los hallazgos de esta pasada, ya ordenados.
   * @param ctx { tieneCapacidad, tieneDerecho, config: {reglaId: {activa, umbrales}}, fatiga: {reglaId: 0–0.8} }
   * @param o   { dominios?: string[], forzar?: boolean }
   */
  async function evaluar(ctx, { dominios = null, forzar = false } = {}) {
    const elegidas = activas(ctx).filter((r) => !dominios || dominios.includes(r.dominio));
    const hechos = {};
    const errores = [];
    for (const id of new Set(elegidas.flatMap((r) => r.sensores || []))) {
      try { hechos[id] = await leerSensor(id, ctx, forzar); }
      catch (e) { errores.push({ sensor: id, error: e.message }); log(`[ASISTENTE] sensor ${id}: ${e.message}`); }
    }

    const salida = [];
    const evaluadas = [];
    for (const r of elegidas) {
      if ((r.sensores || []).some((s) => !(s in hechos))) continue;   // sin datos no se opina
      let nuevos;
      try { nuevos = r.evaluar(hechos, umbralesDe(r, ctx.config?.[r.id]?.umbrales), ctx) || []; }
      catch (e) { errores.push({ regla: r.id, error: e.message }); log(`[ASISTENTE] regla ${r.id}: ${e.message}`); continue; }
      evaluadas.push(r.id);
      for (const n of nuevos) {
        const severidad = n.severidad || r.severidad || 'aviso';
        salida.push({
          clave: `${r.id}|${claveEntidad(n.entidad)}|${n.periodo || '-'}`,
          regla: r.id,
          version: r.version || 1,
          dominio: r.dominio,
          severidad,
          prioridad: prioridad({ severidad, impacto: n.impacto, confianza: n.confianza, fatiga: ctx.fatiga?.[r.id] }),
          titulo: n.titulo,
          detalle: n.detalle,
          evidencia: n.evidencia || [],
          entidad: n.entidad || null,
          acciones: n.acciones || [],
          ruta: n.ruta ?? r.ruta ?? null,
          verPermiso: r.verPermiso || null,
          supera: r.supera || [],
        });
      }
    }

    /* `supera`: en la misma entidad, la regla más fuerte esconde a la otra. */
    const porEntidad = new Map();
    for (const h of salida) {
      const k = claveEntidad(h.entidad);
      if (!porEntidad.has(k)) porEntidad.set(k, []);
      porEntidad.get(k).push(h);
    }
    const quedan = salida.filter((h) => {
      if (!h.entidad) return true;
      return !porEntidad.get(claveEntidad(h.entidad)).some((o) => o !== h && o.supera.includes(h.regla));
    });
    quedan.sort((a, b) => b.prioridad - a.prioridad || a.clave.localeCompare(b.clave));
    return { hallazgos: quedan.map(({ supera, ...h }) => h), evaluadas, errores };
  }

  function olvidarCache() { cache.clear(); }

  return { evaluar, activas, reglas: () => reglas.map((r) => ({ id: r.id, pack: r.pack, dominio: r.dominio, umbrales: r.umbrales || {} })), olvidarCache };
}

module.exports = { crearMotor, prioridad, umbralesDe };
