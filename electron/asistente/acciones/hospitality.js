'use strict';
/* HOSPITALITY: producción, mesas, cocina, recetas, pedidos en línea y propinas. */
const crypto = require('crypto');

module.exports = (h) => {
  /**
   * Empezar, terminar o cancelar la tanda de un producto. Mismas reglas que
   * sp_production_*: se empieza una PLANEADA (salen los ingredientes), se
   * termina una EN PROCESO (piezas buenas; lo que falta es merma con motivo),
   * se cancela solo una PLANEADA.
   */
  async function tanda(it, que) {
    const p = await h.producto(h.v(it, 'producto'));
    if (!p) return h.msg('No encontré ese producto.');
    const estado = { empezar: ['PLANNED'], terminar: ['IN_PROGRESS', 'PLANNED'], cancelar: ['PLANNED', 'IN_PROGRESS'] }[que];
    const b = await h.uno(`
      SELECT TOP 1 id, status, planned_qty, production_date FROM dbo.production_batches
       WHERE product_id = @p AND status IN (${estado.map((x) => `'${x}'`).join(',')})
       ORDER BY CASE WHEN production_date = CAST(GETDATE() AS DATE) THEN 0 ELSE 1 END, CASE status WHEN '${estado[0]}' THEN 0 ELSE 1 END, production_date DESC, id DESC;`,
      [['p', h.sql.Int, p.id]]);
    if (!b) {
      return h.msg(`No hay tanda de ${p.nombre} ${que === 'empezar' ? 'planeada' : 'abierta'}.`, {
        opciones: [{ etiqueta: `Planear ${p.nombre}`, texto: `planea una tanda de ${p.nombre.toLowerCase()}` }] });
    }
    const cuando = String(b.production_date).slice(0, 10) === h.hoyIso() ? 'hoy' : h.diaTexto(b.production_date);
    const vista = [{ etiqueta: 'Producto', valor: p.nombre }, { etiqueta: 'Planeadas', valor: h.num(b.planned_qty) }, { etiqueta: 'Día', valor: cuando }];
    if (que === 'empezar') {
      return h.msg('Esta tanda voy a empezar:', { plan: h.plan('produccion.empezar', {
        titulo: `Empezar ${h.num(b.planned_qty)} ${p.nombre}`, vista,
        avisos: ['Al empezar salen del inventario los ingredientes de la fórmula.'],
        ejecutar: { api: 'wybix.produccion.empezar', payload: { batchId: Number(b.id) } }, permiso: 'PRODUCCION_OPERAR',
      }) });
    }
    if (que === 'cancelar') {
      if (b.status === 'IN_PROGRESS') return h.msg(`La tanda de ${p.nombre} ya empezó: no se cancela. Si no salió nada, dime «salieron 0 ${p.nombre.toLowerCase()}».`);
      return h.msg('Esta tanda voy a cancelar:', { plan: h.plan('produccion.cancelar', {
        titulo: `Cancelar ${h.num(b.planned_qty)} ${p.nombre}`, vista,
        ejecutar: { api: 'wybix.produccion.cancelar', payload: { batchId: Number(b.id) } }, permiso: 'PRODUCCION_OPERAR',
      }) });
    }
    if (b.status === 'PLANNED') return h.msg(`La tanda de ${p.nombre} no ha empezado: primero dime «empieza la tanda de ${p.nombre.toLowerCase()}» para que salgan sus ingredientes.`);
    const buenas = Number(h.v(it, 'cantidad'));
    if (!(buenas >= 0)) return h.msg('¿Cuántas salieron buenas?');
    const merma = Math.max(0, Number(b.planned_qty) - buenas);
    const motivo = h.v(it, 'motivo');
    if (merma > 0 && !motivo) return h.msg(`Faltan ${h.num(merma)} de las ${h.num(b.planned_qty)}. ¿Qué pasó con ellas?`, {
      opciones: h.MOTIVOS.map((m) => ({ etiqueta: m.etiqueta, texto: m.etiqueta })),
      esperando: { intent: it.intent, slots: it.slots, falta: 'motivo' } });
    vista.push({ etiqueta: 'Buenas', valor: h.num(buenas) });
    if (merma > 0) vista.push({ etiqueta: 'Merma', valor: `${h.num(merma)} · ${(h.MOTIVOS.find((m) => m.valor === motivo) || {}).etiqueta || motivo}` });
    return h.msg('Esta tanda voy a registrar:', { plan: h.plan('produccion.terminar', {
      titulo: `Salieron ${h.num(buenas)} ${p.nombre}`, vista,
      avisos: ['Las piezas buenas entran al inventario con el costo de la tanda.'],
      ejecutar: { api: 'wybix.produccion.terminar', payload: { batchId: Number(b.id), buenas, motivo: merma > 0 ? motivo : null } },
      permiso: 'PRODUCCION_OPERAR',
    }) });
  }

  /** Ingredientes de una fórmula para N piezas, contra la existencia. */
  async function faltantes(productId, n) {
    const p = await h.producto(productId);
    if (!p) return { error: h.msg('No encontré ese producto.') };
    if (!(n > 0)) return { error: h.msg('La cantidad tiene que ser mayor a cero.') };
    const lineas = await h.q(`
      SELECT i.nombre, i.base_uom AS uom, i.stock AS hay,
             l.qty_base * (1 + l.waste_pct / 100.0) * @n / NULLIF(f.yield_qty, 0) AS necesita
        FROM dbo.production_formulas f
        JOIN dbo.production_formula_lines l ON l.product_id = f.product_id
        JOIN dbo.products i ON i.id = l.ingredient_product_id
       WHERE f.product_id = @id;`, [h.id(p.id), ['n', h.sql.Decimal(12, 2), n]]);
    if (!lineas.length) return { error: h.msg(`${p.nombre} no tiene fórmula de producción. Con su fórmula puedo decirte qué ingredientes necesitas.`, {
      opciones: [{ etiqueta: 'Crear la fórmula', intent: 'ir_a', params: { ruta: '/dashboard/produccion/formulas', etiqueta: 'Fórmulas' } }] }) };
    return { p, n, lineas: lineas.map((l) => ({ nombre: l.nombre, uom: l.uom || '', hay: Number(l.hay) || 0, necesita: h.r2(l.necesita),
                                                falta: Math.max(0, h.r2(Number(l.necesita) - Number(l.hay))) })) };
  }

  /** La mesa por número o nombre («4», «Mesa 4», «Terraza 2»). */
  const mesa = (n) => h.uno(`
    SELECT TOP 1 m.id, m.nombre FROM dbo.salon_mesas m
     WHERE m.activa = 1 AND (m.nombre = @n OR m.nombre = CONCAT('Mesa ', @n) OR m.nombre LIKE CONCAT('% ', @n))
     ORDER BY CASE WHEN m.nombre = @n THEN 0 WHEN m.nombre = CONCAT('Mesa ', @n) THEN 1 ELSE 2 END;`, [['n', h.sql.NVarChar(40), String(n)]]);

  return {
    async 'produccion.faltantes'(it) {
      const r = await faltantes(h.v(it, 'producto'), Number(h.v(it, 'cantidad')));
      if (r.error) return r.error;
      const { p, n, lineas } = r;
      const faltan = lineas.filter((l) => l.falta > 0);
      const fecha = it.slots.fecha?.texto ? ` para ${it.slots.fecha.texto}` : '';
      const opciones = [{ etiqueta: `Planear ${h.num(n)} ${p.nombre}${fecha}`, intent: 'produccion.planear',
                          params: { productId: p.id, cantidad: n, fecha: it.slots.fecha?.valor ?? null } }];
      if (!faltan.length) return h.msg(`Sí alcanza para ${h.num(n)} ${p.nombre}${fecha}.`, {
        datos: lineas.map((l) => ({ etiqueta: l.nombre, valor: `necesitas ${h.cant(l.necesita, l.uom)} · hay ${h.cant(l.hay, l.uom)}` })), opciones, tono: 'exito' });
      opciones.push({ etiqueta: 'Registrar compra', intent: 'ir_a', params: { ruta: '/dashboard/registrarCompra', etiqueta: 'Registrar compra' } });
      return h.msg(`Para ${h.num(n)} ${p.nombre}${fecha} te falta${faltan.length === 1 ? '' : 'n'} ${h.plural(faltan.length, 'ingrediente')}:`, {
        datos: faltan.map((l) => ({ etiqueta: l.nombre, valor: `comprar ${h.cant(l.falta, l.uom)} (hay ${h.cant(l.hay, l.uom)})` })), opciones, tono: 'atencion' });
    },

    async 'produccion.planear'(it) {
      const r = await faltantes(h.v(it, 'producto'), Number(h.v(it, 'cantidad')));
      if (r.error) return r.error;
      const { p, n, lineas } = r;
      const faltan = lineas.filter((l) => l.falta > 0);
      const fecha = h.v(it, 'fecha');
      return h.msg('Esta tanda voy a planear:', { plan: h.plan('produccion.planear', {
        titulo: `Producir ${h.num(n)} ${p.nombre}${it.slots.fecha?.texto ? ' · ' + it.slots.fecha.texto : ''}`,
        vista: [{ etiqueta: 'Piezas', valor: h.num(n) }, { etiqueta: 'Ingredientes', valor: faltan.length ? `faltan ${faltan.length}` : 'alcanzan' }],
        avisos: faltan.map((l) => `Falta ${h.cant(l.falta, l.uom)} de ${l.nombre}.`),
        ejecutar: { api: 'wybix.produccion.planear', payload: { productId: p.id, cantidad: n, fecha, uuid: crypto.randomUUID() } },
        permiso: 'PRODUCCION_OPERAR',
      }) });
    },

    /* La tanda del producto en el estado que la acción necesita: la de hoy
       primero, luego la más reciente. */
    async 'produccion.empezar'(it) { return tanda(it, 'empezar'); },
    async 'produccion.terminar'(it) { return tanda(it, 'terminar'); },
    async 'produccion.cancelar'(it) { return tanda(it, 'cancelar'); },

    async 'produccion.hoy'(it) {
      const fecha = h.v(it, 'fecha') || h.hoyIso();
      const filas = await h.q(`
        SELECT p.nombre, b.status, b.planned_qty, b.good_qty, b.waste_qty
          FROM dbo.production_batches b JOIN dbo.products p ON p.id = b.product_id
         WHERE b.production_date = @f AND b.status <> 'CANCELLED' ORDER BY b.status, p.nombre;`, [['f', h.sql.Date, fecha]]);
      const cuando = fecha === h.hoyIso() ? 'hoy' : `el ${h.diaTexto(h.cuando(fecha))}`;
      if (!filas.length) return h.msg(`No hay producción planeada ${cuando}.`, { opciones: [{ etiqueta: 'Abrir producción', intent: 'ir_a', params: { ruta: '/dashboard/produccion', etiqueta: 'Producción' } }] });
      const estado = { PLANNED: 'por hacer', IN_PROGRESS: 'en proceso', DONE: 'terminada' };
      const hechas = filas.filter((f) => f.status === 'DONE').length;
      return h.msg(`Producción ${cuando}: ${hechas} de ${h.plural(filas.length, 'tanda')} terminadas.`, {
        datos: filas.map((f) => ({ etiqueta: f.nombre, valor: `${estado[f.status] || f.status} · ${h.num(f.status === 'DONE' ? f.good_qty : f.planned_qty)}${Number(f.waste_qty) > 0 ? ` · merma ${h.num(f.waste_qty)}` : ''}` })) });
    },

    async 'hosp.mesas'() {
      const filas = await h.q(`
        SELECT c.id, ISNULL(m.nombre, c.etiqueta) AS mesa, c.estado, c.personas, c.abierta_en,
               (SELECT ISNULL(SUM(l.cantidad * l.precio_unitario), 0) FROM dbo.hosp_orden_lineas l WHERE l.cuenta_id = c.id AND ISNULL(l.estado, '') <> 'CANCELADA') AS total
          FROM dbo.hosp_cuentas c LEFT JOIN dbo.salon_mesas m ON m.id = c.mesa_id
         WHERE c.estado IN ('ABIERTA', 'POR_COBRAR') ORDER BY c.abierta_en;`);
      const libres = await h.uno(`SELECT COUNT(*) AS n FROM dbo.salon_mesas m WHERE m.activa = 1
                                    AND NOT EXISTS (SELECT 1 FROM dbo.hosp_cuentas c WHERE c.mesa_id = m.id AND c.estado IN ('ABIERTA', 'POR_COBRAR'));`);
      if (!filas.length) return h.msg(`No hay cuentas abiertas${libres?.n ? `; tienes ${h.plural(libres.n, 'mesa')} libre${libres.n === 1 ? '' : 's'}` : ''}.`);
      const total = filas.reduce((a, f) => a + Number(f.total), 0);
      const personas = filas.reduce((a, f) => a + (Number(f.personas) || 0), 0);
      return h.msg(`Hay ${h.plural(filas.length, 'cuenta')} abierta${filas.length === 1 ? '' : 's'}${personas ? ` con ${personas} personas` : ''} por ${h.dinero(total)}${libres ? ` · ${libres.n} mesas libres` : ''}.`, {
        datos: filas.map((f) => ({ etiqueta: f.mesa || `Cuenta ${f.id}`, valor: `${h.dinero(f.total)} · desde ${h.horaTexto(f.abierta_en)}${f.estado === 'POR_COBRAR' ? ' · pidió la cuenta' : ''}` })) });
    },

    async 'hosp.cuenta'(it) {
      const n = h.v(it, 'mesa');
      const m = await mesa(n);
      const cuenta = m && await h.uno(`SELECT TOP 1 id, estado, personas, abierta_en FROM dbo.hosp_cuentas WHERE mesa_id = @id AND estado IN ('ABIERTA', 'POR_COBRAR') ORDER BY abierta_en DESC;`, [h.id(m.id)]);
      if (!m) return h.msg(`No encuentro la mesa ${n}.`);
      if (!cuenta) return h.msg(`${m.nombre} no tiene cuenta abierta.`);
      const lineas = await h.q(`
        SELECT nombre, SUM(cantidad) AS cantidad, SUM(cantidad * precio_unitario) AS importe
          FROM dbo.hosp_orden_lineas WHERE cuenta_id = @id AND ISNULL(estado, '') <> 'CANCELADA'
         GROUP BY nombre ORDER BY MIN(id);`, [h.id(cuenta.id)]);
      const total = lineas.reduce((a, l) => a + Number(l.importe), 0);
      return h.msg(`${m.nombre} lleva ${h.dinero(total)}${cuenta.personas ? ` (${cuenta.personas} personas)` : ''}.`, {
        datos: lineas.map((l) => ({ etiqueta: `${h.num(l.cantidad)} × ${l.nombre}`, valor: h.dinero(l.importe) })),
        opciones: [{ etiqueta: 'Cobrar en Mesas', intent: 'ir_a', params: { ruta: '/dashboard/mesas', etiqueta: 'Mesas' } }] });
    },

    async 'hosp.cocina'() {
      const filas = await h.q(`
        SELECT k.id, k.estado, k.creada_en, ISNULL(m.nombre, c.etiqueta) AS mesa,
               (SELECT STRING_AGG(CONCAT(CAST(l.cantidad AS INT), ' ', l.nombre), ', ') FROM dbo.hosp_orden_lineas l WHERE l.comanda_id = k.id) AS que
          FROM dbo.comandas k LEFT JOIN dbo.hosp_cuentas c ON c.id = k.cuenta_id LEFT JOIN dbo.salon_mesas m ON m.id = c.mesa_id
         WHERE k.estado IN ('NUEVA', 'PREPARANDO', 'LISTA') ORDER BY k.creada_en;`);
      if (!filas.length) return h.msg('La cocina está al día: no hay comandas pendientes.', { tono: 'exito' });
      const min = (d) => Math.round((Date.now() - Date.parse(d)) / 60000);
      const atrasadas = filas.filter((f) => f.estado !== 'LISTA' && min(f.creada_en) > 15);
      const estado = { NUEVA: 'en espera', PREPARANDO: 'preparando', LISTA: 'lista para servir' };
      return h.msg(`Hay ${h.plural(filas.length, 'comanda')} pendiente${filas.length === 1 ? '' : 's'}${atrasadas.length ? `, ${atrasadas.length} con más de 15 minutos` : ''}.`, {
        datos: filas.slice(0, 10).map((f) => ({ etiqueta: `${f.mesa || 'Para llevar'} · ${min(f.creada_en)} min`, valor: `${estado[f.estado] || f.estado}${f.que ? ` · ${f.que}` : ''}` })),
        tono: atrasadas.length ? 'atencion' : 'normal' });
    },

    async 'hosp.receta'(it) {
      const p = await h.producto(h.v(it, 'producto'));
      if (!p) return h.msg('No encontré ese producto.');
      let lineas = await h.q(`
        SELECT i.nombre, l.qty_base AS cantidad, i.base_uom AS uom, ISNULL(i.cost, 0) AS costo
          FROM dbo.recipes r JOIN dbo.recipe_lines l ON l.recipe_id = r.id JOIN dbo.products i ON i.id = l.ingredient_product_id
         WHERE r.product_id = @id AND r.active = 1 AND r.variant_option_id IS NULL ORDER BY l.sort_order;`, [h.id(p.id)]);
      let por = '';
      if (!lineas.length) {
        lineas = await h.q(`
          SELECT i.nombre, l.qty_base / NULLIF(f.yield_qty, 0) AS cantidad, i.base_uom AS uom, ISNULL(i.cost, 0) AS costo
            FROM dbo.production_formulas f JOIN dbo.production_formula_lines l ON l.product_id = f.product_id JOIN dbo.products i ON i.id = l.ingredient_product_id
           WHERE f.product_id = @id;`, [h.id(p.id)]);
        por = ' (por pieza, de su fórmula de producción)';
      }
      if (!lineas.length) return h.msg(`${p.nombre} no tiene receta todavía.`, { opciones: [{ etiqueta: 'Abrir recetas', intent: 'ir_a', params: { ruta: '/dashboard/recetas', etiqueta: 'Recetas' } }] });
      return h.msg(`${p.nombre} lleva${por}:`, { datos: lineas.map((l) => ({ etiqueta: l.nombre, valor: h.cant(l.cantidad, l.uom) })) });
    },

    async 'hosp.pedidos'() {
      const filas = await h.q(`SELECT id, origen, cliente_nombre, total_cliente, recibido_en FROM dbo.pedidos_en_linea WHERE estado = 'PENDIENTE' ORDER BY recibido_en;`);
      if (!filas.length) return h.msg('No hay pedidos en línea por aceptar.', { tono: 'exito' });
      return h.msg(`Tienes ${h.plural(filas.length, 'pedido')} por aceptar:`, {
        datos: filas.map((f) => ({ etiqueta: `${f.cliente_nombre || 'Cliente'} · ${f.origen || 'en línea'}`, valor: `${h.dinero(f.total_cliente)} · ${h.horaTexto(f.recibido_en)}` })),
        opciones: [{ etiqueta: 'Abrir pedidos', intent: 'ir_a', params: { ruta: '/dashboard/pedidos-en-linea', etiqueta: 'Pedidos en línea' } }], tono: 'atencion' });
    },

    async 'hosp.propinas'(it) {
      const r = h.rango(h.v(it, 'periodo'));
      const filas = await h.q(`
        SELECT UPPER(ISNULL(metodo, 'EFECTIVO')) AS metodo, SUM(monto) AS total, COUNT(*) AS n,
               SUM(CASE WHEN reparto_id IS NULL THEN monto ELSE 0 END) AS sin_repartir
          FROM dbo.propinas WHERE fecha >= ${r.desde} AND fecha < ${r.hasta} GROUP BY UPPER(ISNULL(metodo, 'EFECTIVO'));`);
      if (!filas.length) return h.msg(`No hay propinas ${r.de}.`);
      const total = filas.reduce((a, f) => a + Number(f.total), 0);
      const pend = filas.reduce((a, f) => a + Number(f.sin_repartir), 0);
      return h.msg(`${r.nombre} se juntaron ${h.dinero(total)} de propinas${pend > 0 ? ` (${h.dinero(pend)} sin repartir)` : ''}.`, {
        datos: filas.map((f) => ({ etiqueta: f.metodo.toLowerCase(), valor: h.dinero(f.total) })),
        opciones: pend > 0 ? [{ etiqueta: 'Repartir propinas', intent: 'ir_a', params: { ruta: '/dashboard/propinas', etiqueta: 'Propinas' } }] : [] });
    },
  };
};
