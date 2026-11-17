'use strict';
/* HOSPITALITY: producción, mesas, cocina, recetas, pedidos en línea y propinas. */
const crypto = require('crypto');

module.exports = (h) => {
  /* ------------------------------------------- mesas, cuentas y comandas */
  /** «4», «mesa 4», «terraza 2»: la mesa activa con ese nombre (o ese número). */
  async function mesaDe(dicho) {
    const t = h.llano(dicho).replace(/^mesa\s+/, '');
    const mesas = await h.q(`SELECT m.id, m.nombre, a.nombre AS area FROM dbo.salon_mesas m LEFT JOIN dbo.salon_areas a ON a.id = m.area_id WHERE m.activa = 1;`).catch(() => []);
    const num = (x) => (String(x).match(/\d+/) || [])[0];
    return mesas.find((m) => h.llano(m.nombre) === t || h.llano(m.nombre).replace(/^mesa\s+/, '') === t)
      || (num(t) && mesas.filter((m) => num(m.nombre) === num(t)).length === 1 ? mesas.find((m) => num(m.nombre) === num(t)) : null);
  }
  const cuentaDe = (mesaId) => h.uno(`SELECT TOP 1 c.id, c.estado, c.personas, c.customer_id, cu.customerName AS cliente,
      (SELECT COUNT(*) FROM dbo.hosp_orden_lineas l JOIN dbo.hosp_ordenes o ON o.id = l.orden_id WHERE o.cuenta_id = c.id) AS renglones
      FROM dbo.hosp_cuentas c LEFT JOIN dbo.customers cu ON cu.id = c.customer_id
     WHERE c.mesa_id = @m AND c.estado IN ('ABIERTA', 'POR_COBRAR') ORDER BY c.id DESC;`, [['m', h.sql.Int, mesaId]]).catch(() => null);
  const nombreMesa = (m) => (/^\d+$/.test(String(m.nombre)) ? `Mesa ${m.nombre}` : m.nombre);
  async function mesaYCuenta(it) {
    const m = await mesaDe(h.v(it, 'mesa'));
    if (!m) return { error: h.msg(`No encuentro la mesa «${h.v(it, 'mesa')}».`) };
    const c = await cuentaDe(m.id);
    if (!c) return { error: h.msg(`${nombreMesa(m)} no tiene cuenta abierta.`, { opciones: [{ etiqueta: `Abrir ${nombreMesa(m)}`, texto: `abre la mesa ${m.nombre}` }] }) };
    return { m, c };
  }
  const comandaDe = (id) => h.uno(`SELECT c.id, c.estado, c.cuenta_id, s.nombre AS estacion, s.salida, m.nombre AS mesa
      FROM dbo.comandas c LEFT JOIN dbo.prep_stations s ON s.id = c.station_id LEFT JOIN dbo.hosp_cuentas hc ON hc.id = c.cuenta_id
      LEFT JOIN dbo.salon_mesas m ON m.id = hc.mesa_id WHERE c.id = @id;`, [h.id(id)]);
  const ESTADO_COMANDA = { NUEVA: 'nueva', PREPARANDO: 'preparando', LISTA: 'lista', ENTREGADA: 'entregada', CANCELADA: 'cancelada' };

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

    /* ================================================= MESAS Y CUENTAS */
    async 'cuenta.abrir'(it) {
      const etiqueta = h.v(it, 'etiqueta');
      if (etiqueta) {
        return h.msg('Esta cuenta voy a abrir:', { plan: h.plan('cuenta.abrir', {
          titulo: `Cuenta sin mesa · ${etiqueta}`, vista: [{ etiqueta: 'A nombre de', valor: etiqueta }],
          ejecutar: { api: 'wybix.cuentas.abrir', payload: { mesaId: null, etiqueta, personas: null, registerId: h.cajaEquipo(), customerId: null } },
          permiso: 'VENTAS_OPERAR',
        }) });
      }
      const m = await mesaDe(h.v(it, 'mesa'));
      if (!m) return h.msg(`No encuentro la mesa «${h.v(it, 'mesa')}».`);
      const ya = await cuentaDe(m.id);
      if (ya) return h.msg(`${nombreMesa(m)} ya está abierta${ya.cliente ? ' (' + ya.cliente + ')' : ''}.`);
      const personas = h.v(it, 'personas');
      return h.msg('Esta mesa voy a abrir:', { plan: h.plan('cuenta.abrir', {
        titulo: `Abrir ${nombreMesa(m)}`,
        vista: [{ etiqueta: 'Mesa', valor: `${nombreMesa(m)}${m.area ? ' · ' + m.area : ''}` }, ...(personas ? [{ etiqueta: 'Personas', valor: String(personas) }] : [])],
        ejecutar: { api: 'wybix.cuentas.abrir', payload: { mesaId: m.id, etiqueta: null, personas: personas ?? null, registerId: h.cajaEquipo(), customerId: null } },
        permiso: 'VENTAS_OPERAR',
      }) });
    },

    /* «La mesa 4 pide 2 tacos y una coca»: a preparación por el mismo envío que la caja. */
    async 'cuenta.enviar'(it) {
      const r = await mesaYCuenta(it);
      if (r.error) return r.error;
      const rs = h.v(it, 'renglones') || [];
      const lineas = [];
      for (const x of rs) {
        const p = await h.producto(x.productId);
        if (!p) continue;
        const op = await h.uno('SELECT TOP 1 1 AS x FROM dbo.product_modifier_groups pmg JOIN dbo.modifier_groups g ON g.id = pmg.group_id AND g.active = 1 WHERE pmg.product_id = @p;', [['p', h.sql.Int, p.id]]);
        if (op) return h.msg(`${p.nombre} lleva opciones (tamaño, término, sabor): mándalo desde la mesa en la caja.`);
        lineas.push({ p, cantidad: Number(x.cantidad) });
      }
      if (!lineas.length) return h.msg('¿Qué pide la mesa?');
      return h.msg('Este pedido voy a mandar:', { plan: h.plan('cuenta.enviar', {
        titulo: `${nombreMesa(r.m)} · pedido`,
        vista: [...lineas.map((l) => ({ etiqueta: `${h.num(l.cantidad)} × ${l.p.nombre}`, valor: h.dinero(Number(l.p.price) * l.cantidad) })),
                { etiqueta: 'Suma a la cuenta', valor: h.dinero(lineas.reduce((a, l) => a + Number(l.p.price) * l.cantidad, 0)) }],
        avisos: ['Sale la comanda a cada estación (pantalla o impresora), igual que al enviar desde la caja.'],
        ejecutar: { api: 'wybix.cuentas.enviar', payload: { cuentaId: Number(r.c.id), lineas: lineas.map((l) => ({ productId: l.p.id, cantidad: l.cantidad, nota: null, origen: crypto.randomUUID(), opciones: [] })) } },
        permiso: 'VENTAS_OPERAR',
      }) });
    },

    async 'cuenta.estado'(it) {
      const r = await mesaYCuenta(it);
      if (r.error) return r.error;
      const estado = h.v(it, 'estado');
      if (r.c.estado === estado) return h.msg(`${nombreMesa(r.m)} ya está ${estado === 'POR_COBRAR' ? 'por cobrar' : 'abierta'}.`);
      return h.msg('Esto voy a marcar:', { plan: h.plan('cuenta.estado', {
        titulo: `${nombreMesa(r.m)} · ${estado === 'POR_COBRAR' ? 'pidió la cuenta' : 'sigue abierta'}`,
        vista: [{ etiqueta: 'Mesa', valor: `${r.c.estado === 'POR_COBRAR' ? 'por cobrar' : 'abierta'} → ${estado === 'POR_COBRAR' ? 'por cobrar' : 'abierta'}` }],
        ejecutar: { api: 'wybix.cuentas.estado', payload: { cuentaId: Number(r.c.id), estado } }, permiso: 'VENTAS_OPERAR',
      }) });
    },

    async 'cuenta.cliente'(it) {
      const r = await mesaYCuenta(it);
      if (r.error) return r.error;
      const c = await h.cliente(h.v(it, 'cliente'));
      if (!c) return h.msg('No encontré a ese cliente.');
      return h.msg('Esto voy a cambiar:', { plan: h.plan('cuenta.cliente', {
        titulo: `${nombreMesa(r.m)} · ${c.nombre}`, vista: [{ etiqueta: 'Cliente', valor: `${r.c.cliente || 'sin cliente'} → ${c.nombre}` }],
        ejecutar: { api: 'wybix.cuentas.cliente', payload: { cuentaId: Number(r.c.id), customerId: c.id } }, permiso: 'VENTAS_OPERAR',
      }) });
    },

    async 'cuenta.liberar'(it) {
      const r = await mesaYCuenta(it);
      if (r.error) return r.error;
      if (Number(r.c.renglones) > 0) return h.msg(`${nombreMesa(r.m)} tiene consumo: cóbrala, o que un encargado cancele lo pedido.`);
      return h.msg('Esta mesa voy a liberar:', { plan: h.plan('cuenta.liberar', {
        titulo: `Liberar ${nombreMesa(r.m)}`, vista: [{ etiqueta: 'Mesa', valor: `${nombreMesa(r.m)} → libre` }],
        ejecutar: { api: 'wybix.cuentas.liberar', payload: { cuentaId: Number(r.c.id) } }, permiso: 'VENTAS_OPERAR',
      }) });
    },

    /* ======================================================== COMANDAS */
    async 'comanda.estado'(it) {
      const c = await comandaDe(h.v(it, 'comanda'));
      if (!c) return h.msg(`No encuentro la comanda ${h.v(it, 'comanda')}.`);
      const estado = h.v(it, 'estado');
      const orden = ['NUEVA', 'PREPARANDO', 'LISTA', 'ENTREGADA'];
      if (c.estado === 'CANCELADA') return h.msg(`La comanda ${c.id} se canceló.`);
      if (orden.indexOf(estado) <= orden.indexOf(c.estado)) return h.msg(`La comanda ${c.id} ya está ${ESTADO_COMANDA[c.estado]}.`);
      return h.msg('Esto voy a marcar:', { plan: h.plan('comanda.estado', {
        titulo: `Comanda ${c.id} · ${ESTADO_COMANDA[estado]}`,
        vista: [{ etiqueta: 'Comanda', valor: `${c.id}${c.mesa ? ' · mesa ' + c.mesa : ''}${c.estacion ? ' · ' + c.estacion : ''}` }, { etiqueta: 'Estado', valor: `${ESTADO_COMANDA[c.estado]} → ${ESTADO_COMANDA[estado]}` }],
        ejecutar: { api: 'wybix.kds.estado', payload: { comandaId: Number(c.id), estado } }, permiso: 'VENTAS_OPERAR',
      }) });
    },

    async 'comanda.cancelar'(it) {
      const c = await comandaDe(h.v(it, 'comanda'));
      if (!c) return h.msg(`No encuentro la comanda ${h.v(it, 'comanda')}.`);
      if (c.estado === 'CANCELADA' || c.estado === 'ENTREGADA') return h.msg(`La comanda ${c.id} ya está ${ESTADO_COMANDA[c.estado]}.`);
      const motivo = h.v(it, 'motivo');
      return h.msg('Esta comanda voy a cancelar:', { plan: h.plan('comanda.cancelar', {
        titulo: `Cancelar la comanda ${c.id}`,
        vista: [{ etiqueta: 'Comanda', valor: `${c.id}${c.mesa ? ' · mesa ' + c.mesa : ''}${c.estacion ? ' · ' + c.estacion : ''}` }, ...(motivo ? [{ etiqueta: 'Motivo', valor: motivo }] : [])],
        avisos: ['Sale de la pantalla de cocina. Lo pedido sigue en la cuenta hasta que se cancele ahí.'],
        ejecutar: { api: 'wybix.kds.cancelar', payload: { comandaId: Number(c.id), motivo: motivo || null } }, permiso: 'MODIFICAR_VENTA',
      }) });
    },

    async 'comanda.reimprimir'(it) {
      const c = await comandaDe(h.v(it, 'comanda'));
      if (!c) return h.msg(`No encuentro la comanda ${h.v(it, 'comanda')}.`);
      if (c.salida === 'PANTALLA') return h.msg(`La estación ${c.estacion} no tiene impresora: la comanda está en su pantalla.`);
      return h.msg('Esta comanda voy a reimprimir:', { plan: h.plan('comanda.reimprimir', {
        titulo: `Reimprimir la comanda ${c.id}`, vista: [{ etiqueta: 'Estación', valor: c.estacion || '—' }, ...(c.mesa ? [{ etiqueta: 'Mesa', valor: c.mesa }] : [])],
        ejecutar: { api: 'wybix.kds.reimprimir', payload: { comandaId: Number(c.id) } }, permiso: 'VENTAS_OPERAR',
      }) });
    },

    /* =================================================== SALÓN Y ESTACIONES */
    async 'salon.area'(it) {
      const nombre = String(h.v(it, 'nombre') || '').trim().slice(0, 60);
      const ya = await h.uno('SELECT TOP 1 nombre FROM dbo.salon_areas WHERE nombre = @n AND activa = 1;', [['n', h.sql.NVarChar(60), nombre]]).catch(() => null);
      if (ya) return h.msg(`Ya existe el área «${ya.nombre}».`);
      return h.msg('Esta área voy a crear:', { plan: h.plan('salon.area', {
        titulo: `Área nueva · ${nombre}`, vista: [{ etiqueta: 'Área', valor: nombre }],
        ejecutar: { api: 'wybix.salon.guardarArea', payload: { id: null, nombre, orden: 0, activa: true } }, permiso: 'CONFIGURACION_ADMINISTRAR',
      }) });
    },

    async 'salon.mesa'(it) {
      const nombre = String(h.v(it, 'nombre') || '').trim().slice(0, 40);
      const areas = await h.q('SELECT id, nombre FROM dbo.salon_areas WHERE activa = 1 ORDER BY orden, id;').catch(() => []);
      if (!areas.length) return h.msg('Primero crea un área: «crea el área Salón».');
      const dicha = h.v(it, 'textoArea');
      const area = dicha ? areas.find((a) => h.llano(a.nombre) === h.llano(dicha) || h.llano(a.nombre).includes(h.llano(dicha))) : areas.length === 1 ? areas[0] : null;
      if (!area) return h.msg(dicha ? `No encuentro el área «${dicha}». Hay: ${areas.map((a) => a.nombre).join(', ')}.` : `¿En qué área? ${areas.map((a) => a.nombre).join(', ')}.`);
      if (await mesaDe(nombre)) return h.msg(`Ya existe la mesa «${nombre}».`);
      const cap = h.v(it, 'capacidad');
      return h.msg('Esta mesa voy a agregar:', { plan: h.plan('salon.mesa', {
        titulo: `Mesa nueva · ${nombre}`, vista: [{ etiqueta: 'Mesa', valor: nombre }, { etiqueta: 'Área', valor: area.nombre }, ...(cap ? [{ etiqueta: 'Lugares', valor: String(cap) }] : [])],
        ejecutar: { api: 'wybix.salon.guardarMesa', payload: { id: null, areaId: area.id, nombre, capacidad: cap ?? null, orden: 0, activa: true } },
        permiso: 'CONFIGURACION_ADMINISTRAR',
      }) });
    },

    async 'estacion.crear'(it) {
      const nombre = String(h.v(it, 'nombre') || '').trim().slice(0, 40);
      const ya = await h.uno('SELECT TOP 1 nombre FROM dbo.prep_stations WHERE nombre = @n AND activa = 1;', [['n', h.sql.NVarChar(40), nombre]]).catch(() => null);
      if (ya) return h.msg(`Ya existe la estación «${ya.nombre}».`);
      const impresora = !!h.v(it, 'impresora');
      return h.msg('Esta estación voy a crear:', { plan: h.plan('estacion.crear', {
        titulo: `Estación nueva · ${nombre}`, vista: [{ etiqueta: 'Estación', valor: nombre }, { etiqueta: 'Comandas', valor: impresora ? 'pantalla e impresora' : 'en pantalla' }],
        avisos: impresora ? ['La impresora se elige en Configuración → Estaciones.'] : [],
        ejecutar: { api: 'wybix.estaciones.guardar', payload: { id: null, nombre, salida: impresora ? 'AMBOS' : 'PANTALLA', impresora: null, anchoMm: null, orden: 0, activa: true } },
        permiso: 'CONFIGURACION_ADMINISTRAR',
      }) });
    },

    async 'estacion.producto'(it) {
      const p = await h.producto(h.v(it, 'producto'));
      const e = await h.uno('SELECT id, nombre FROM dbo.prep_stations WHERE id = @id;', [h.id(h.v(it, 'estacion'))]);
      if (!p || !e) return h.msg('No encontré ese producto o esa estación.');
      const actual = await h.uno('SELECT s.nombre FROM dbo.product_prep_station ps JOIN dbo.prep_stations s ON s.id = ps.station_id WHERE ps.product_id = @p;', [['p', h.sql.Int, p.id]]).catch(() => null);
      if (actual?.nombre === e.nombre) return h.msg(`${p.nombre} ya se prepara en ${e.nombre}.`);
      return h.msg('Esto voy a cambiar:', { plan: h.plan('estacion.producto', {
        titulo: `${p.nombre} · se prepara en ${e.nombre}`, vista: [{ etiqueta: 'Estación', valor: `${actual?.nombre || 'ninguna'} → ${e.nombre}` }],
        ejecutar: { api: 'wybix.estaciones.asignar', payload: { productId: p.id, stationId: e.id } }, permiso: 'CONFIGURACION_ADMINISTRAR',
      }) });
    },
  };
};
