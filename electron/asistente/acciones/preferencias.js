'use strict';
/**
 * CÓMO LE GUSTA A CADA QUIEN: «llámame Jesús», «sin gráficas», «no me des el
 * resumen», «léeme las respuestas», «no me des observaciones».
 *
 * Solo cambia cómo le habla Wybix a esa persona (asistente_preferencias, una
 * fila por usuario). No hay tarjeta de confirmar: no toca nada del negocio y
 * se deshace diciendo lo contrario u «olvida mis preferencias».
 */
const LISTO = {
  nombre: (p) => `Listo, ${p.nombre}. Así te voy a decir.`,
  resumen: (p) => (p.resumen ? 'Va, cuando me saludes te doy el resumen del día.' : 'Va, ya no te doy el resumen cuando me saludes. Pídemelo con «¿cómo voy?».'),
  graficas: (p) => (p.graficas ? 'Listo, vuelvo a poner gráficas.' : 'Listo, sin gráficas: solo te doy la lista.'),
  observaciones: (p) => (p.observaciones ? 'Va, si veo algo raro en tus números te aviso.' : 'Va, ya no te digo lo que se ve raro; solo contesto.'),
  hablar: (p) => (p.hablar ? 'Listo, te leo las respuestas en voz alta (si esta caja tiene voz en español).' : 'Listo, ya no te leo las respuestas.'),
};

module.exports = (h) => ({
  async 'sistema.preferencia'(it, ctx) {
    const p = h.v(it, 'preferencia') || {};
    if (!h.preferencias?.guardar) return h.msg('En esta caja no puedo guardar preferencias todavía.');
    if (p.olvidar) {
      await h.preferencias.olvidar(ctx.userId);
      return h.msg('Listo, olvidé tus preferencias: te hablo como al principio.');
    }
    const cambios = { ...(p.cambios || {}) };
    if (!Object.keys(cambios).length) return h.msg('No entendí qué quieres cambiar.');
    const todas = await h.preferencias.guardar(ctx.userId, cambios);
    const clave = Object.keys(cambios)[0];
    return h.msg((LISTO[clave] || (() => 'Listo.'))(todas || cambios), { tono: 'exito', preferencias: todas || cambios });
  },
});
