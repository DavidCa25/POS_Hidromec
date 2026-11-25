/**
 * CAJA MÓVIL — WYBIX POS MOBILE COMO CAJA DE LA SUCURSAL (POS 0094).
 *
 * La tablet vende con su base local (SQLite cifrado y outbox), igual que en
 * un evento. La diferencia es a quién le entrega lo que hizo: aquí no es la
 * nube sino este Local Host, por la red del local. Para la tablet, Local Host
 * habla el MISMO contrato que la nube (snapshot, eventos, latido), así que su
 * motor de sincronización no cambia.
 *
 *   snapshot   catálogo (sp_catalog_publication), personal con PIN
 *              (sp_staff_publication), existencias de la base y su caja.
 *              Catálogo y personal solo viajan si cambiaron.
 *   eventos    cada hecho de la tablet se registra con el SP de siempre:
 *                SHIFT_OPENED           sp_open_shift
 *                SALE_RECORDED          sp_register_sale (client_sale_key = sale_uuid)
 *                SALE_REFUNDED          sp_refund_sale
 *                CASH_MOVEMENT_RECORDED sp_register_cash_in / sp_register_cash_out
 *                INVENTORY_MOVEMENT     sp_inventory_count_apply (existencia + diferencia)
 *                SHIFT_CLOSED           sp_close_shift
 *              Cada evento se anota en caja_movil_eventos: reenviar uno ya
 *              registrado responde DUPLICATE y no toca nada otra vez.
 *
 * QUÉ CAJA ES. Cada tablet tiene su propia caja (dbo.registers), creada la
 * primera vez que pide snapshot: su turno, su folio y su corte son suyos.
 * Cuenta contra las cajas de la licencia (registers_max), no contra las
 * Pantallas Operativas.
 *
 * ERRORES. Un rechazo del negocio (THROW 51000: sin turno, sin existencia…)
 * es REJECTED: la tablet lo deja a la vista en Estado y no lo reintenta. Un
 * error técnico (la base no responde) es ERROR: se reintenta después.
 */
const crypto = require('node:crypto');

const TIPO = 'CAJA_MOVIL';
const MAQUINA = (disp) => `movil:${String(disp.id).toLowerCase()}`.slice(0, 64);
const ROL = (r) => (r === 'admin' ? 'ADMIN' : r === 'supervisor' ? 'SUPERVISOR' : 'CASHIER');
const METODOS = new Set(['EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'PLATAFORMA']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Rechazo del negocio (THROW 51000 / RAISERROR 16) frente a una falla técnica. */
function esRechazo(e) {
  // THROW 51000 y RAISERROR('texto', 16, 1) (número 50000) son reglas del negocio.
  // Un deadlock (1205), un timeout o la base caída se reintentan.
  const n = Number(e?.number ?? e?.originalError?.info?.number);
  return n === 51000 || n === 50000;
}
const textoDe = (e) => String(e?.message || 'Error').replace(/^.*?\]\s*/, '').slice(0, 300);

function crearCajaMovil({ pool, sql, leerConfig, guardarConfig, licencia = () => null, log = () => {} }) {
  const req = async () => (await pool()).request();

  /* ------------------------------------------------ identidad estable */
  function estadoGuardado() {
    const cfg = leerConfig() || {};
    const c = cfg.localHost?.cajaMovil || {};
    if (!c.empresaUuid || !c.sucursalUuid) {
      const nuevo = { ...c, empresaUuid: c.empresaUuid || crypto.randomUUID(), sucursalUuid: c.sucursalUuid || crypto.randomUUID() };
      guardarEstado(nuevo);
      return nuevo;
    }
    return c;
  }
  function guardarEstado(c) {
    const cfg = leerConfig() || {};
    guardarConfig({ ...cfg, localHost: { ...(cfg.localHost || {}), cajaMovil: c } });
  }
  /** Versión que solo sube: cambia cuando cambia la huella del contenido. */
  function versionDe(clave, contenido) {
    const huella = crypto.createHash('sha256').update(JSON.stringify(contenido)).digest('hex');
    const c = estadoGuardado();
    const v = c[clave] || { hash: null, version: 0 };
    if (v.hash === huella) return v.version;
    const nueva = { hash: huella, version: Number(v.version || 0) + 1 };
    guardarEstado({ ...c, [clave]: nueva });
    return nueva.version;
  }

  /* ------------------------------------------------ la caja de la tablet */
  async function cajaDe(disp) {
    const cfg = disp.config || {};
    if (Number(cfg.registerId) > 0) {
      const r = await (await req()).input('id', sql.Int, Number(cfg.registerId))
        .query('SELECT id, code, name, uuid FROM dbo.registers WHERE id = @id AND is_active = 1;');
      if (r.recordset?.[0]) return r.recordset[0];
    }
    // Cuenta contra las cajas de la licencia.
    const max = Number(licencia()?.registersMax);
    if (Number.isFinite(max) && max > 0) {
      const n = (await (await req()).query('SELECT COUNT(*) AS n FROM dbo.registers WHERE is_active = 1;')).recordset[0].n;
      if (n >= max) throw Object.assign(new Error(`Tu licencia incluye ${max} ${max === 1 ? 'caja' : 'cajas'} y ya están en uso. Desactiva una en Configuración › Cajas o amplía tu plan.`), { negocio: true, http: 403 });
    }
    const nombre = `Móvil · ${disp.nombre}`.slice(0, 60);
    const nueva = (await (await req()).input('name', sql.NVarChar(60), nombre).input('code', sql.NVarChar(10), null).execute('sp_add_register')).recordset[0];
    const fila = (await (await req()).input('id', sql.Int, nueva.id).query('SELECT id, code, name, uuid FROM dbo.registers WHERE id = @id;')).recordset[0];
    await (await req()).input('id', sql.UniqueIdentifier, disp.id).input('cfg', sql.NVarChar(2000), JSON.stringify({ ...cfg, registerId: fila.id }))
      .query('UPDATE dbo.dispositivos_locales SET config = @cfg WHERE id = @id;');
    disp.config = { ...cfg, registerId: fila.id };
    log(`caja móvil: ${disp.nombre} -> caja ${fila.code}`);
    return fila;
  }

  /* ------------------------------------------------------- snapshot */
  async function snapshot(disp, desde = {}) {
    const caja = await cajaDe(disp);
    const id = estadoGuardado();
    const p = await pool();
    const catJson = (await p.request().execute('sp_catalog_publication')).recordset?.[0]?.catalog_json;
    const staffJson = (await p.request().execute('sp_staff_publication')).recordset?.[0]?.staff_json;
    const catalogo = catJson ? JSON.parse(catJson) : null;
    const personal = (staffJson ? JSON.parse(staffJson) : []).map((s) => ({
      uuid: s.uuid, name: s.name, role: ROL(s.branch_role), pin_hash: s.pin_hash, pin_sal: s.pin_sal, pin_algo: s.pin_algo, active: true,
    }));
    const vCat = catalogo ? versionDe('catalogo', catalogo) : 0;
    const vPer = versionDe('personal', personal);
    const tieneCat = Number(desde.catalog_version) || 0, tieneRev = Number(desde.security_revision) || 0;
    const mandaCat = !!catalogo && tieneCat < vCat;
    const mandaPer = tieneRev < vPer;
    const stock = (await p.request().query(`
      SELECT LOWER(CONVERT(VARCHAR(36), uuid)) AS product_uuid, CONVERT(VARCHAR(30), CAST(stock AS DECIMAL(12, 2))) AS qty
        FROM dbo.products WHERE ISNULL(active, 1) = 1 AND inventory_mode = 'DIRECT';`)).recordset;
    const negocio = (await p.request().query(`SELECT TOP 1 business_name AS nombre FROM dbo.business_config;`).catch(() => ({ recordset: [] }))).recordset?.[0]?.nombre;
    return {
      ok: true,
      modo: 'SUCURSAL',
      snapshot_version: Math.floor(Date.now() / 1000),
      security_revision: vPer,
      catalog_version: vCat,
      sin_cambios: !mandaCat && !mandaPer,
      device: { id: String(disp.id).toLowerCase(), uuid: String(disp.id).toLowerCase(), status: 'ACTIVE' },
      company: { uuid: id.empresaUuid, nombre: negocio || 'Mi negocio' },
      location: { uuid: id.sucursalUuid, nombre: negocio || 'Sucursal', tipo: 'BRANCH', timezone: 'America/Mexico_City', status: 'ACTIVE',
                  event_status: null, default_channel: null, home_location_uuid: null, starts_at: null, ends_at: null },
      register: { uuid: String(caja.uuid).toLowerCase(), code: caja.code, name: caja.name },
      catalog: mandaCat ? { ...catalogo, catalog_version: vCat } : null,
      staff: mandaPer ? personal : null,
      payment_methods: [
        { code: 'EFECTIVO', label: 'Efectivo', enabled: true },
        { code: 'TARJETA', label: 'Tarjeta (terminal)', enabled: true },
        { code: 'TRANSFERENCIA', label: 'Transferencia', enabled: true },
      ],
      trusted_keys: [],
      transfers: [],
      releases: null,
      /* Caja de sucursal: la existencia la manda la base, no los traspasos. */
      stock,
    };
  }

  /* ------------------------------------------------------- mapeos */
  async function mapas() {
    const r = await (await req()).query(`
      SELECT LOWER(CONVERT(VARCHAR(36), uuid)) AS u, id FROM dbo.users;
      SELECT LOWER(CONVERT(VARCHAR(36), uuid)) AS u, id FROM dbo.products;
      SELECT LOWER(CONVERT(VARCHAR(36), uuid)) AS u, id FROM dbo.modifier_options;`);
    const m = (rs) => new Map((rs || []).map((x) => [x.u, x.id]));
    return { usuario: m(r.recordsets[0]), producto: m(r.recordsets[1]), opcion: m(r.recordsets[2]) };
  }
  const exigir = (mapa, uuid, que) => {
    const id = mapa.get(String(uuid || '').toLowerCase());
    if (!id) throw Object.assign(new Error(`${que} no existe en la base de la sucursal.`), { number: 51000 });
    return id;
  };

  /* ------------------------------------------------------- traductores */
  async function abrirTurno(ctx, pl) {
    const user = exigir(ctx.m.usuario, pl.opened_by?.uuid, 'La persona que abre el turno');
    const r = await (await req())
      .input('user_id', sql.Int, user).input('opening_cash', sql.Decimal(12, 2), Number(pl.opening_cash) || 0)
      .input('opening_note', sql.NVarChar(255), 'Caja móvil').input('register_id', sql.Int, ctx.caja.id)
      .input('machine_id', sql.NVarChar(64), ctx.maquina).input('machine_name', sql.NVarChar(120), ctx.nombre)
      .execute('sp_open_shift');
    return String(r.recordset?.[0]?.closure_id ?? r.recordset?.[0]?.id ?? '');
  }

  async function venta(ctx, pl) {
    const user = exigir(ctx.m.usuario, pl.user?.uuid, 'La persona que vendió');
    const d1 = new sql.Table('dbo.SaleDetailType');
    d1.columns.add('product_id', sql.Int, { nullable: true });
    d1.columns.add('quantity', sql.Decimal(12, 2), { nullable: true });
    d1.columns.add('unit_price', sql.Decimal(10, 2), { nullable: true });
    const d2 = new sql.Table('dbo.SaleDetailType2');
    d2.columns.add('line_no', sql.Int, { nullable: false });
    d2.columns.add('product_id', sql.Int, { nullable: false });
    d2.columns.add('quantity', sql.Decimal(12, 2), { nullable: false });
    d2.columns.add('unit_price', sql.Decimal(10, 2), { nullable: false });
    d2.columns.add('note', sql.NVarChar(200), { nullable: true });
    const mo = new sql.Table('dbo.SaleModifierType');
    mo.columns.add('line_no', sql.Int, { nullable: false });
    mo.columns.add('modifier_option_id', sql.Int, { nullable: false });
    mo.columns.add('quantity', sql.Int, { nullable: false });
    (pl.lines || []).forEach((l, i) => {
      const n = i + 1;
      d2.rows.add(n, exigir(ctx.m.producto, l.product_uuid, `El producto «${l.product_name}»`), Number(l.quantity), Number(l.unit_price), l.note ?? null);
      for (const o of l.modifiers || []) mo.rows.add(n, exigir(ctx.m.opcion, o.option_uuid, 'Una opción'), Number(o.quantity ?? 1));
    });
    const pagos = (pl.payments || []).map((x) => ({
      method: METODOS.has(x.method) ? x.method : 'TRANSFERENCIA', amount: Number(x.amount),
      ...(x.method === 'EFECTIVO' && x.received != null ? { received: Number(x.received) } : {}),
      ...(x.reference ? { reference: String(x.reference).slice(0, 100) } : {}),
    }));
    if (!pagos.length) throw Object.assign(new Error('La venta llegó sin pagos.'), { number: 51000 });
    // La misma venta reenviada produce la misma huella: el SP la reconoce.
    const huella = crypto.createHash('sha256').update(JSON.stringify({ sale: pl.sale_uuid, lines: pl.lines, payments: pagos })).digest('hex');
    const ev = licencia();
    const r = await (await req())
      .input('user_id', sql.Int, user).input('payment_method', sql.NVarChar(50), pagos[0].method)
      .input('SaleDetails', d1).input('customer_id', sql.Int, null).input('due_date', sql.Date, null)
      .input('register_id', sql.Int, ctx.caja.id).input('SaleDetails2', d2).input('SaleModifiers', mo)
      .input('service_mode', sql.NVarChar(10), null)
      .input('machine_id', sql.NVarChar(64), ctx.maquina).input('machine_name', sql.NVarChar(120), ctx.nombre)
      .input('venta_esencial', sql.Bit, ev?.ventaEsencial ? 1 : 0)
      .input('payments_json', sql.NVarChar(sql.MAX), JSON.stringify(pagos))
      .input('client_sale_key', sql.UniqueIdentifier, pl.sale_uuid)
      .input('client_sale_hash', sql.VarChar(64), huella)
      .execute('sp_register_sale');
    return String(r.recordset?.[0]?.sale_id ?? '');
  }

  async function devolucion(ctx, pl) {
    const user = exigir(ctx.m.usuario, pl.user?.uuid, 'La persona que devolvió');
    const s = (await (await req()).input('k', sql.UniqueIdentifier, pl.sale_uuid).query('SELECT id FROM dbo.sales WHERE client_sale_key = @k;')).recordset?.[0];
    if (!s) throw Object.assign(new Error('La venta que se devuelve todavía no está en la base.'), { transitorio: true });
    const det = new sql.Table('dbo.SaleDetailType');
    det.columns.add('product_id', sql.Int, { nullable: true });
    det.columns.add('quantity', sql.Decimal(12, 2), { nullable: true });
    det.columns.add('unit_price', sql.Decimal(10, 2), { nullable: true });
    for (const l of pl.refund?.lines || []) {
      det.rows.add(exigir(ctx.m.producto, l.product_uuid, `El producto «${l.producto}»`), Number(l.cantidad), Number(l.precio_unitario));
    }
    await (await req())
      .input('sale_id', sql.Int, s.id).input('user_id', sql.Int, user).input('payment_method', sql.NVarChar(50), 'EFECTIVO')
      .input('RefundDetails', det).input('note', sql.NVarChar(400), String(pl.refund?.reason || 'Devolución en caja móvil').slice(0, 400))
      .input('register_id', sql.Int, ctx.caja.id).input('machine_id', sql.NVarChar(64), ctx.maquina).input('machine_name', sql.NVarChar(120), ctx.nombre)
      // El motivo es obligatorio (corto): el de la tablet, o «Caja móvil».
      .input('reason', sql.NVarChar(40), String(pl.refund?.reason || 'Caja móvil').slice(0, 40))
      .execute('sp_refund_sale');
    return String(s.id);
  }

  async function movimientoCaja(ctx, pl) {
    if (pl.type === 'SALE_RETURN_CASH' || pl.type === 'OPENING') return '';   // lo hacen la devolución y la apertura
    const user = exigir(ctx.m.usuario, pl.user?.uuid, 'La persona del movimiento');
    const nota = String(pl.note || '').slice(0, 255) || 'Caja móvil';
    const r = (await req()).input('user_id', sql.Int, user).input('amount', sql.Decimal(10, 2), Number(pl.amount))
      .input('register_id', sql.Int, ctx.caja.id).input('machine_id', sql.NVarChar(64), ctx.maquina).input('machine_name', sql.NVarChar(120), ctx.nombre);
    if (pl.type === 'CASH_IN') await r.input('concept', sql.NVarChar(60), 'Entrada').input('note', sql.NVarChar(255), nota).execute('sp_register_cash_in');
    else await r.input('note', sql.NVarChar(255), pl.type === 'EXPENSE' ? `Gasto: ${nota}`.slice(0, 255) : nota).execute('sp_register_cash_out');
    return '';
  }

  async function inventario(ctx, pl) {
    const m = pl.movement || {};
    if (!['WASTE', 'ADJUSTMENT'].includes(m.type)) throw Object.assign(new Error('Movimiento de inventario no válido en caja de sucursal.'), { number: 51000 });
    const user = exigir(ctx.m.usuario, pl.employee?.uuid, 'La persona del ajuste');
    const prod = exigir(ctx.m.producto, m.product_uuid, 'El producto');
    // La tablet manda la diferencia (merma en positivo); la base guarda lo físico.
    const delta = m.type === 'WASTE' ? -Math.abs(Number(m.quantity)) : Number(m.quantity);
    const actual = Number((await (await req()).input('id', sql.Int, prod).query('SELECT stock FROM dbo.products WHERE id = @id;')).recordset[0].stock);
    await (await req()).input('product_id', sql.Int, prod).input('fisico', sql.Decimal(12, 2), Math.max(0, actual + delta)).input('user_id', sql.Int, user)
      .execute('sp_inventory_count_apply');
    return '';
  }

  async function cerrarTurno(ctx, pl) {
    const user = exigir(ctx.m.usuario, pl.closed_by?.uuid, 'La persona que cierra el turno');
    const aut = pl.authorized_by?.uuid ? exigir(ctx.m.usuario, pl.authorized_by.uuid, 'Quien autorizó') : null;
    // El turno abierto de SU caja (la tablet tiene uno a la vez).
    const turno = (await (await req()).input('r', sql.Int, ctx.caja.id)
      .query('SELECT TOP 1 id FROM dbo.cash_closures WHERE register_id = @r AND closed_at IS NULL ORDER BY id DESC;')).recordset?.[0];
    if (!turno) return '';   // ya estaba cerrado (p. ej. desde la computadora): nada que hacer
    await (await req())
      .input('closure_id', sql.Int, turno.id)
      .input('user_id', sql.Int, user).input('cash_delivered', sql.Decimal(12, 2), Number(pl.cash_counted) || 0)
      .input('register_id', sql.Int, ctx.caja.id).input('machine_id', sql.NVarChar(64), ctx.maquina).input('machine_name', sql.NVarChar(120), ctx.nombre)
      .input('authorized_by', sql.Int, aut).input('blind_count', sql.Bit, pl.blind_count ? 1 : 0)
      .input('closing_note', sql.NVarChar(500), 'Corte de caja móvil')
      .execute('sp_close_shift');
    return '';
  }

  const TRADUCTORES = {
    SHIFT_OPENED: abrirTurno,
    SALE_RECORDED: venta,
    SALE_REFUNDED: devolucion,
    CASH_MOVEMENT_RECORDED: movimientoCaja,
    INVENTORY_MOVEMENT_RECORDED: inventario,
    SHIFT_CLOSED: cerrarTurno,
  };

  /* ------------------------------------------------------- eventos */
  async function yaVisto(uuid) {
    return (await (await req()).input('e', sql.UniqueIdentifier, uuid)
      .query('SELECT resultado, error FROM dbo.caja_movil_eventos WHERE event_uuid = @e;')).recordset?.[0] || null;
  }
  async function anotar(disp, ev, resultado, referencia, error) {
    await (await req())
      .input('e', sql.UniqueIdentifier, ev.event_uuid).input('d', sql.UniqueIdentifier, disp.id)
      .input('t', sql.NVarChar(40), String(ev.event_type).slice(0, 40)).input('r', sql.VarChar(12), resultado)
      .input('ref', sql.NVarChar(100), referencia ? String(referencia).slice(0, 100) : null)
      .input('err', sql.NVarChar(300), error ? String(error).slice(0, 300) : null)
      .query(`IF NOT EXISTS (SELECT 1 FROM dbo.caja_movil_eventos WHERE event_uuid = @e)
                INSERT INTO dbo.caja_movil_eventos (event_uuid, dispositivo_id, event_type, resultado, referencia, error) VALUES (@e, @d, @t, @r, @ref, @err);`);
  }

  async function eventos(disp, lista) {
    const caja = await cajaDe(disp);
    const ctx = { caja, maquina: MAQUINA(disp), nombre: `Caja móvil · ${disp.nombre}`.slice(0, 120), m: await mapas() };
    const results = [];
    for (const ev of (Array.isArray(lista) ? lista : []).slice(0, 500)) {
      if (!UUID.test(String(ev?.event_uuid || '')) || typeof ev.payload !== 'object' || !ev.payload) {
        results.push({ event_uuid: ev?.event_uuid ?? null, result: 'REJECTED', error: 'evento inválido' });
        continue;
      }
      const previo = await yaVisto(ev.event_uuid);
      if (previo) {
        results.push({ event_uuid: ev.event_uuid, result: previo.resultado === 'APPLIED' ? 'DUPLICATE' : previo.resultado, error: previo.error });
        continue;
      }
      const fn = TRADUCTORES[ev.event_type];
      if (!fn) {
        // Traspasos de evento y lo que no aplica en sucursal: se dice, no se pierde.
        await anotar(disp, ev, 'REJECTED', null, 'No aplica en caja de sucursal.');
        results.push({ event_uuid: ev.event_uuid, result: 'REJECTED', error: 'No aplica en caja de sucursal.' });
        continue;
      }
      try {
        const ref = await fn(ctx, ev.payload);
        await anotar(disp, ev, 'APPLIED', ref, null);
        results.push({ event_uuid: ev.event_uuid, result: 'APPLIED' });
      } catch (e) {
        if (!e.transitorio && esRechazo(e)) {
          await anotar(disp, ev, 'REJECTED', null, textoDe(e));
          results.push({ event_uuid: ev.event_uuid, result: 'REJECTED', error: textoDe(e) });
          log(`caja móvil ${disp.nombre}: ${ev.event_type} rechazado: ${textoDe(e)}`);
        } else {
          // Técnico o fuera de orden: se reintenta, y lo que sigue espera su turno.
          results.push({ event_uuid: ev.event_uuid, result: 'ERROR', error: textoDe(e) });
          log(`caja móvil ${disp.nombre}: ${ev.event_type} con error: ${textoDe(e)}`);
          for (const resto of lista.slice(lista.indexOf(ev) + 1)) results.push({ event_uuid: resto.event_uuid, result: 'ERROR', error: 'espera al anterior' });
          break;
        }
      }
    }
    return { ok: true, results };
  }

  return { TIPO, snapshot, eventos, cajaDe };
}

module.exports = { crearCajaMovil, TIPO };
