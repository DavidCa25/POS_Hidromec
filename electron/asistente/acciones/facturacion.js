'use strict';
/* FACTURACIÓN: se consulta aquí; timbrar y cancelar siempre en su pantalla
   (un CFDI no se deshace con un «Confirmar» de chat). */

module.exports = (h) => ({
  async 'factura.resumen'(it) {
    const r = h.rango(h.v(it, 'periodo') === 'hoy' ? 'mes' : h.v(it, 'periodo'));
    const filas = await h.q(`
      SELECT UPPER(ISNULL(estado, 'SIN ESTADO')) AS estado, COUNT(*) AS n, ISNULL(SUM(total), 0) AS total
        FROM dbo.invoices WHERE created_at >= ${r.desde} AND created_at < ${r.hasta}
       GROUP BY UPPER(ISNULL(estado, 'SIN ESTADO')) ORDER BY COUNT(*) DESC;`);
    if (!filas.length) return h.msg(`No hay facturas ${r.de}.`);
    const n = filas.reduce((a, f) => a + f.n, 0);
    const conError = filas.filter((f) => /ERROR|FALL|RECHAZ/.test(f.estado)).reduce((a, f) => a + f.n, 0);
    return h.msg(`${r.nombre}: ${h.plural(n, 'factura')}${conError ? `, ${conError} con error` : ''}.`, {
      datos: filas.map((f) => ({ etiqueta: f.estado.toLowerCase(), valor: `${f.n} · ${h.dinero(f.total)}` })),
      opciones: [{ etiqueta: 'Abrir facturación', intent: 'ir_a', params: { ruta: '/dashboard/facturacion', etiqueta: 'Facturación' } }],
      tono: conError ? 'atencion' : 'normal' });
  },

  async 'factura.emitir'(it) {
    const folio = h.v(it, 'folio');
    return h.ir(`Te llevo a Facturación${folio ? ` con la venta ${folio}` : ''}: capturas los datos fiscales del cliente y timbras.`, '/dashboard/facturacion', { folio: folio ?? null });
  },

  async 'factura.cancelar'(it) {
    const folio = h.v(it, 'folio');
    return h.ir(`Cancelar una factura se hace en Facturación${folio ? ` (folio ${folio})` : ''}, con el motivo del SAT. Te llevo.`, '/dashboard/facturacion', { folio: folio ?? null });
  },
});
