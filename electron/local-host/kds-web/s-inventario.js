/*
 * INVENTORY_FLOOR — buscar (o escanear con un lector de codigos: teclea el
 * codigo y Enter), ver existencia y precio, contar y reportar un faltante.
 * Sin permiso de inventario, o sin conexion, el conteo se REPORTA para que
 * alguien con permiso lo aplique en Wybix.
 */
(() => {
  'use strict';

  async function buscar(ctx) {
    const u = ctx.ui;
    const q = (u.q || '').trim();
    if (!q) return;
    u.buscando = true; ctx.pintar();
    const r = await ctx.consulta('buscar', { q });
    u.buscando = false;
    u.resultados = r?.productos || [];
    /* Un codigo exacto (lo que teclea un lector) abre el producto directo. */
    const exacto = u.resultados.find(p => p.exacto);
    if (exacto && u.resultados.length >= 1) abrir(ctx, exacto);
    ctx.pintar();
  }

  function abrir(ctx, p) {
    const u = ctx.ui;
    u.producto = p; u.conteo = ''; u.nota = '';
    ctx.hoja(() => hoja(ctx));
  }

  function hoja(ctx) {
    const { el } = ctx;
    const u = ctx.ui;
    const p = u.producto;
    const puede = !!ctx.datos?.puedeAjustar;
    return [
      el('div', { class: 'hoja__cab' },
        el('div', {}, el('h2', { text: p.nombre }), el('p', { text: [p.clave, p.codigo].filter(Boolean).join(' · ') })),
        el('button', { type: 'button', class: 'btn btn--chico', text: 'Cerrar', onclick: ctx.cerrarHoja })),
      el('div', { class: 'cifras-grandes' },
        el('div', { class: 'cifra' }, el('small', { text: 'Existencia' }),
          el('b', { text: p.receta ? '—' : p.sinInventario ? 'n/a' : p.existencia })),
        el('div', { class: 'cifra' }, el('small', { text: 'Precio' }), el('b', { text: ctx.dinero(p.precio) }))),
      p.receta ? el('p', { class: 'nota-pie', text: 'Se prepara con receta: su existencia es la de sus ingredientes.' }) : null,
      !p.receta ? el('div', { class: 'seccion' },
        el('h3', { text: 'Contar' }),
        el('input', { class: 'campo', id: 'conteo', type: 'number', inputmode: 'decimal', min: '0', step: '1', placeholder: `¿Cuántos hay? (${p.unidad})`, value: u.conteo,
          oninput: (e) => { u.conteo = e.target.value; } }),
        el('p', { class: 'nota-pie', text: puede
          ? 'Con conexión se ajusta la existencia al momento. Sin conexión se guarda como reporte para revisarlo en Wybix.'
          : 'Se envía como reporte: alguien con permiso de inventario lo revisa y lo aplica en Wybix.' }),
        el('button', { type: 'button', class: 'btn btn--primario btn--grande', text: 'Confirmar conteo',
          onclick: async () => {
            const n = Number(u.conteo);
            if (u.conteo === '' || !Number.isFinite(n) || n < 0) { ctx.avisar('Escribe cuántos contaste.'); return; }
            const r = await ctx.accion('CONTAR', { productId: p.id, cantidad: n });
            if (!r) return;
            if (r.encolada) { ctx.cerrarHoja(); return; }
            ctx.avisar(r.aplicado ? (r.diferencia ? `Existencia ajustada (${r.diferencia > 0 ? '+' : ''}${r.diferencia}).` : 'Coincide: no hubo que ajustar.') : 'Conteo reportado para revisión.');
            ctx.cerrarHoja();
            u.resultados = null; u.q = ''; ctx.pintar();
          } })) : null,
      el('div', { class: 'seccion' },
        el('h3', { text: 'Faltante' }),
        el('input', { class: 'campo', id: 'nota-faltante', maxlength: '200', placeholder: 'Nota (opcional)', value: u.nota, oninput: (e) => { u.nota = e.target.value; } }),
        el('button', { type: 'button', class: 'btn btn--grande btn--aviso', text: 'Reportar faltante',
          onclick: async () => {
            const r = await ctx.accion('FALTANTE', { productId: p.id, nota: u.nota.trim() || null }, { ok: 'Faltante reportado.' });
            if (r) ctx.cerrarHoja();
          } })),
    ];
  }

  window.WX.superficies.INVENTORY_FLOOR = {
    icono: 'package',
    titulo: (ctx) => ctx.sesion?.persona?.nombre || 'Inventario',
    progreso(ctx) {
      const r = ctx.datos?.reposo || {};
      return { hechas: 0, total: 0, texto: `${r.revisados ?? 0} contados hoy · ${r.faltantes ?? 0} faltantes` };
    },
    pestanas: () => [{ icono: 'magnifying-glass', texto: 'Buscar', activa: true, onclick: () => document.getElementById('buscar-producto')?.focus() }],
    render(ctx) {
      const { el } = ctx;
      const u = ctx.ui;
      const d = ctx.datos || { reposo: {}, recientes: [] };
      return [
        el('p', { class: 'nota-pie', text: d.puedeAjustar ? 'Tu permiso: los conteos ajustan la existencia al momento.' : 'Tu permiso: los conteos se envían para revisión.' }),
        el('div', { class: 'material' },
          el('input', { class: 'campo', id: 'buscar-producto', type: 'search', autocomplete: 'off', placeholder: 'Nombre, clave o código de barras', value: u.q || '',
            oninput: (e) => { u.q = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter') void buscar(ctx); } }),
          el('button', { type: 'button', class: 'btn btn--primario', text: u.buscando ? 'Buscando…' : 'Buscar', onclick: () => void buscar(ctx) })),
        el('p', { class: 'nota-pie', text: 'Con un lector de códigos USB o Bluetooth, escanea aquí. La cámara no está disponible desde el navegador en la red local.' }),
        u.resultados ? (u.resultados.length ? el('div', { class: 'lista' }, ...u.resultados.map(p =>
          el('button', { type: 'button', class: 'fila', 'data-producto': p.id, onclick: () => abrir(ctx, p) },
            el('span', { class: 'fila__hora', text: p.receta ? '—' : String(p.existencia ?? '') }),
            el('span', { class: 'fila__txt' }, el('b', { text: p.nombre }), el('span', { text: [p.clave, ctx.dinero(p.precio)].filter(Boolean).join(' · ') })),
            el('span', { class: 'pill', text: p.unidad })))) : el('p', { class: 'vacio-chico', text: 'Sin resultados.' })) : null,
        (d.recientes || []).length ? el('div', { class: 'seccion' }, el('h3', { text: 'Tus reportes de hoy' }),
          ...d.recientes.map(x => el('div', { class: 'material' },
            el('span', { text: `${x.producto}${x.tipo === 'CONTEO' ? ` · contaste ${x.cantidad}` : ' · faltante'}` }),
            el('span', { class: x.estado === 'APLICADO' ? 'pill pill--ok' : x.estado === 'DESCARTADO' ? 'pill' : 'pill pill--aviso',
              text: { PENDIENTE: 'Por revisar', APLICADO: 'Aplicado', DESCARTADO: 'Descartado' }[x.estado] })))) : null,
      ];
    },
  };
})();
