'use strict';
/**
 * APODOS: «a la coca de 600 dile la roja» y «olvida la roja».
 *
 * Un apodo vale para todo el negocio, así que se confirma con tarjeta como
 * cualquier otro cambio. La tarjeta lo guarda por asistente:alias.
 */
const TIPO = { producto: 'el producto', cliente: 'el cliente', proveedor: 'el proveedor', profesional: 'el profesional' };

module.exports = (h) => ({
  async 'sistema.alias'(it) {
    const alias = String(h.v(it, 'alias'));
    const o = h.v(it, 'objetivo');
    const nombre = o.tipo === 'producto' ? (await h.producto(o.id))?.nombre
      : o.tipo === 'cliente' ? (await h.cliente(o.id))?.nombre
      : o.tipo === 'proveedor' ? (await h.proveedor(o.id))?.nombre
      : (await h.uno('SELECT full_name AS nombre FROM dbo.professionals WHERE id = @id;', [h.id(o.id)]))?.nombre;
    if (!nombre) return h.msg('No encontré a quién se refiere ese apodo.');
    const antes = (await h.apodos.listar()).find((x) => x.alias === alias);
    const avisos = antes && !(antes.tipo === o.tipo && antes.refId === o.id) ? [`Hasta ahora «${alias}» era ${antes.nombre || 'otra cosa'}: lo cambio.`] : [];
    return h.msg('Este apodo voy a aprender:', { plan: h.plan('sistema.alias', {
      titulo: `«${alias}» = ${nombre}`,
      vista: [{ etiqueta: 'Cuando digan', valor: `«${alias}»` }, { etiqueta: 'Entiendo', valor: `${TIPO[o.tipo] || ''} ${nombre}`.trim() }],
      avisos: [...avisos, 'Vale para todos en este negocio. Para borrarlo: «olvida ' + alias + '».'],
      ejecutar: { api: 'electronAPI.asistenteAlias', payload: { accion: 'guardar', tipo: o.tipo, alias, refId: o.id } },
    }) });
  },

  async 'sistema.alias_olvidar'(it) {
    const alias = String(h.v(it, 'alias'));
    const x = (await h.apodos.listar()).find((a) => a.alias === alias);
    if (!x) return h.msg(`No tengo ningún apodo «${alias}».`);
    return h.msg('Este apodo voy a olvidar:', { plan: h.plan('sistema.alias_olvidar', {
      titulo: `Olvidar «${alias}»`,
      vista: [{ etiqueta: 'Apodo', valor: `«${alias}»` }, { etiqueta: 'Era', valor: x.nombre || '—' }],
      ejecutar: { api: 'electronAPI.asistenteAlias', payload: { accion: 'borrar', alias } },
    }) });
  },
});
