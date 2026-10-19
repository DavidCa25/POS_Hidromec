const { randomUUID } = require('node:crypto');
const { cotizar, validarPolitica, centavos } = require('./motor.cjs');
async function catalogo(pool) {
    const p = await pool.request().query('SELECT version,payload FROM dbo.commercial_policy WHERE id=1');
    const c = await pool.request().execute('sp_catalog_publication');
    const catalog = JSON.parse(c.recordset[0].catalog_json);
    const ids = (await pool.request().query('SELECT id,LOWER(CONVERT(VARCHAR(36),uuid)) uuid FROM dbo.products')).recordset;
    const optionIds = (await pool.request().query('SELECT id,group_id,LOWER(CONVERT(VARCHAR(36),uuid)) uuid FROM dbo.modifier_options')).recordset;
    const clock = (await pool.request().query("SELECT CONVERT(VARCHAR(19),GETDATE(),126) wallTime")).recordset[0];
    /* La version que AUTORIZA es la de la columna: es la que comparan
       sp_register_sale y sp_commercial_policy_save. La del JSON puede ser otra:
       en una sucursal, el catalogo de la matriz llegaba con la version de la
       matriz dentro y ninguna cotizacion de esa sucursal se podia cobrar
       ("La cotizacion cambio o ya se utilizo"). */
    return { policy: { ...JSON.parse(p.recordset[0].payload), version: p.recordset[0].version }, catalog, ids, optionIds, wallTime: clock.wallTime };
}
/* 0064 · Un descuento en PESOS sobre la cuenta (cupón de $ o canje de puntos
   de $). El motor rebaja por unidad, así que el monto se reparte aquí: del
   renglón más caro al más barato, sin dejar ninguno bajo $0. Devuelve lo que
   de verdad se aplicó (puede ser menos que el monto si la cuenta es menor). */
function repartirMonto(result, monto, regla, nombre) {
    const c = (x) => BigInt(Math.round(Number(x) * 100)), d = (n) => (Number(n) / 100).toFixed(2);
    let resta = c(monto), aplicado = 0n;
    for (const l of [...result.lines].sort((a, b) => Number(b.unitPrice) - Number(a.unitPrice))) {
        if (resta <= 0n)
            break;
        const unit = c(l.unitPrice), q100 = c(l.quantity);
        if (unit <= 0n || q100 <= 0n)
            continue;
        let porUnidad = resta * 100n / q100;
        if (porUnidad > unit)
            porUnidad = unit;
        const linea = porUnidad * q100 / 100n;
        if (linea <= 0n)
            continue;
        l.unitPrice = d(unit - porUnidad);
        l.discount = d(c(l.discount) + linea);
        if (!l.rule) {
            l.rule = regla;
            l.ruleName = nombre;
        }
        resta -= linea;
        aplicado += linea;
    }
    const total = result.lines.reduce((a, l) => a + c(l.unitPrice) * c(l.quantity) / 100n, 0n);
    result.total = d(total);
    result.discount = d(c(result.gross) - total);
    return d(aplicado);
}
async function cotizacion(pool, p, actor) {
    const { policy, catalog, ids } = await catalogo(pool);
    if (p.version !== policy.version)
        throw Error('Cambió la configuración comercial. Recarga la cuenta.');
    const products = catalog.products.filter(x => x.sellable && x.active);
    const clock = (await pool.request().query("SELECT CONVERT(VARCHAR(10),GETDATE(),23) date,CONVERT(VARCHAR(5),GETDATE(),108) time,DATEDIFF(day,'19000107',CONVERT(date,GETDATE()))%7 weekday")).recordset[0];
    const input = p.lines.map((l, i) => {
        const id = ids.find(x => x.id === Number(l.productId));
        const product = products.find(x => x.uuid === id?.uuid);
        if (!product)
            throw Error('Producto no disponible.');
        let variant;
        return { key: String(l.key ?? i + 1), product: product.uuid, quantity: Number(l.qty).toFixed(2), extras: '0.00', variant, combo: l.combo };
    });
    const options = (await pool.request().query('SELECT o.id,LOWER(CONVERT(VARCHAR(36),o.uuid)) uuid,o.price_delta,o.active,g.role FROM dbo.modifier_options o JOIN dbo.modifier_groups g ON g.id=o.group_id WHERE g.active=1')).recordset;
    for (let i = 0; i < input.length; i++) {
        let delta = 0n;
        for (const o of p.lines[i].options ?? []) {
            const option = options.find(x => x.id === Number(o.optionId) && x.active);
            const qty = Number(o.quantity ?? 1);
            if (!option || !Number.isInteger(qty) || qty < 1 || qty > 500)
                throw Error('Opción no disponible.');
            delta += BigInt(Math.round(Number(option.price_delta) * 100)) * BigInt(qty);
            if (option.role === 'SIZE')
                input[i].variant = option.uuid;
        }
        input[i].extras = (Number(delta) / 100).toFixed(2);
    }
    let coupon = null, pricedPolicy = policy, montoCupon = null;
    if (p.coupon) {
        if (p.channel && p.channel !== 'LOCAL')
            throw Error('Los cupones se usan en Mostrador.');
        if (input.some(l => l.combo))
            throw Error('El cupón no se acumula con combos.');
        const sql = require('mssql/msnodesqlv8');
        const c = (await pool.request().input('code', sql.NVarChar(24), p.coupon).execute('sp_coupon_validate')).recordset[0];
        if (!c?.ok)
            throw Error(c?.mensaje ?? 'Cupón no válido.');
        /* 0064: además del producto gratis, $ y %. El cupón no se acumula con
           las promociones: la cuenta se cotiza solo con él. */
        if (c.kind === 'FREE_PRODUCT') {
            const product = ids.find(x => x.id === c.product_id)?.uuid;
            if (!product || !input.some(l => l.product === product))
                throw Error('Agrega el producto del cupón.');
            pricedPolicy = { ...policy, promotions: [{ id: 'coupon', name: c.nombre, active: true, priority: 0, kind: 'PRICE', value: '0.00', selector: { products: [product] }, maxApplications: 1 }] };
        }
        else if (c.kind === 'PERCENT')
            pricedPolicy = { ...policy, promotions: [{ id: 'coupon', name: c.nombre, active: true, priority: 0, kind: 'PERCENT', value: Number(c.discount_pct).toFixed(2), selector: {} }] };
        else if (c.kind === 'AMOUNT') {
            pricedPolicy = { ...policy, promotions: [] };
            montoCupon = Number(c.amount);
        }
        else
            throw Error('Este tipo de cupón no se puede aplicar en caja.');
        coupon = { code: p.coupon, kind: c.kind, productId: c.product_id ?? null, instanceId: c.instance_id };
    }
    /* 0063 · CLUB: el beneficio del día de una membresía. Se comprueba aquí
       (que la caja no tenga que saber reglas) y OTRA VEZ, con bloqueo, dentro de
       sp_register_sale: si entre cotizar y cobrar ya lo usó en otra caja, la
       venta no se registra. Renovar en la misma venta (el producto del plan va
       en la cuenta) permite darlo aunque esté vencida. */
    let membership = null;
    if (p.membershipId) {
        if (p.channel && p.channel !== 'LOCAL')
            throw Error('El beneficio del Club se da en Mostrador.');
        const sql = require('mssql/msnodesqlv8');
        const st = await pool.request().input('customer_id', sql.Int, Number(p.customerId) || null).execute('sp_membership_status');
        const m = (st.recordsets[0] ?? []).find(x => x.id === Number(p.membershipId));
        if (!m)
            throw Error('Esa membresía no es del cliente de la cuenta.');
        const renueva = p.lines.some(l => Number(l.productId) === m.sale_product_id);
        if (m.estado !== 'ACTIVA' && !renueva)
            throw Error(m.estado === 'CANCELADA' ? 'La membresía está cancelada.' : 'La membresía venció: renuévala para dar el beneficio.');
        if (Number(m.disponibles_hoy) < 1)
            throw Error('El cliente ya usó su beneficio de hoy.');
        const elegibles = (st.recordsets[1] ?? []).filter(x => x.plan_id === m.plan_id).map(x => ids.find(y => y.id === x.product_id)?.uuid).filter(Boolean);
        if (!input.some(l => elegibles.includes(l.product)))
            throw Error('Agrega a la cuenta un producto del beneficio.');
        pricedPolicy = { ...pricedPolicy, promotions: [{ id: 'membership', name: 'Club · ' + m.plan_name, active: true, priority: 0, kind: 'PRICE', value: '0.00', selector: { products: elegibles }, maxApplications: Number(m.disponibles_hoy) }, ...pricedPolicy.promotions] };
        membership = { membershipId: m.id, customerId: Number(p.customerId), planName: m.plan_name };
    }
    /* 0064 · PUNTOS Y SELLOS: canjear una recompensa del catálogo con puntos o
       una tarjeta de sellos llena. Igual que el Club: se comprueba aquí y OTRA
       VEZ con candado en sp_register_sale (sp_loyalty_points_apply_sale). */
    let points = null, stamps = null, montoPuntos = null;
    if (p.pointsRewardId || p.stampCardId) {
        if (p.channel && p.channel !== 'LOCAL')
            throw Error('Los puntos y sellos se canjean en Mostrador.');
        const cid = Number(p.customerId);
        if (!cid)
            throw Error('Elige al cliente para canjear.');
        const sql = require('mssql/msnodesqlv8');
        const st = await pool.request().input('customer_id', sql.Int, cid).execute('sp_loyalty_customer_status');
        const [[cfg] = [], cards = [], cardProducts = [], rewards = []] = st.recordsets;
        const extra = [];
        if (p.pointsRewardId) {
            const r = rewards.find(x => x.id === Number(p.pointsRewardId));
            if (!r)
                throw Error('Esa recompensa ya no está en el catálogo de canje.');
            const faltan = r.points_cost - Number(cfg?.puntos ?? 0);
            if (faltan > 0)
                throw Error(`Le faltan ${faltan} puntos para ${r.name}.`);
            if (r.kind === 'FREE_PRODUCT') {
                const product = ids.find(x => x.id === r.product_id)?.uuid;
                if (!product || !input.some(l => l.product === product))
                    throw Error(`Agrega ${r.product_name || 'el producto'} a la cuenta para canjearlo.`);
                extra.push({ id: 'points', name: 'Puntos · ' + r.name, active: true, priority: 0, kind: 'PRICE', value: '0.00', selector: { products: [product] }, maxApplications: 1 });
            }
            else if (r.kind === 'PERCENT')
                extra.push({ id: 'points', name: 'Puntos · ' + r.name, active: true, priority: 0, kind: 'PERCENT', value: Number(r.discount_pct).toFixed(2), selector: {} });
            else
                montoPuntos = Number(r.amount);
            points = { rewardId: r.id, cost: r.points_cost, name: r.name, kind: r.kind };
        }
        if (p.stampCardId) {
            const card = cards.find(x => x.id === Number(p.stampCardId));
            if (!card)
                throw Error('Esa tarjeta de sellos ya no está activa.');
            const faltan = card.stamps_required - Number(card.sellos);
            if (faltan > 0)
                throw Error(`Le faltan ${faltan} sellos para ${card.name}.`);
            const elegibles = cardProducts.filter(x => x.card_id === card.id && x.es_premio).map(x => ids.find(y => y.id === x.product_id)?.uuid).filter(Boolean);
            if (!input.some(l => elegibles.includes(l.product)))
                throw Error(`Agrega a la cuenta ${card.reward_product_name || 'el producto que se regala'}.`);
            extra.push({ id: 'stamps', name: 'Sellos · ' + card.name, active: true, priority: 0, kind: 'PRICE', value: '0.00', selector: { products: elegibles }, maxApplications: 1 });
            stamps = { cardId: card.id, cost: card.stamps_required, name: card.name };
        }
        pricedPolicy = { ...pricedPolicy, promotions: [...extra, ...pricedPolicy.promotions] };
    }
    const result = cotizar(pricedPolicy, products.map(x => ({ id: x.uuid, price: x.price, category: x.category_uuid })), input, { ...clock, channel: p.channel ?? 'LOCAL', audiences: p.audiences ?? [] });
    const sumaRegla = (regla) => result.lines.filter(l => l.rule === regla).reduce((a, l) => a + Number(l.discount), 0).toFixed(2);
    if (points)
        points.amountApplied = montoPuntos != null ? repartirMonto(result, montoPuntos, 'points', 'Puntos · ' + points.name) : sumaRegla('points');
    if (coupon)
        coupon.amountApplied = montoCupon != null ? repartirMonto(result, montoCupon, 'coupon', 'Cupón') : sumaRegla('coupon');
    if (stamps)
        stamps.amountApplied = sumaRegla('stamps');
    if (membership) {
        const club = result.lines.filter(l => l.rule === 'membership');
        membership = club.length ? { ...membership, units: club.reduce((a, l) => a + Number(l.quantity), 0), amountApplied: club.reduce((a, l) => a + Number(l.discount), 0).toFixed(2) } : null;
    }
    const lines = result.lines.map((l, i) => { const source = p.lines[input.findIndex(x => x.key === l.source)]; return { line_no: i + 1, productId: Number(source.productId), qty: Number(l.quantity), unitPrice: Number(l.unitPrice), note: source.note ?? null, options: (source.options ?? []).map(o => ({ optionId: Number(o.optionId), quantity: Number(o.quantity ?? 1) })), audit: l }; });
    const id = randomUUID(), payload = { ...result, orderReference: p.orderReference ? String(p.orderReference).trim().slice(0, 100) : null, coupon, membership, points, stamps, loyaltyCustomerId: points || stamps ? Number(p.customerId) : null, lines, optionPrices: options.filter(o => p.lines.some(l => l.options?.some(x => Number(x.optionId) === o.id))).map(o => ({ id: o.id, price: Number(o.price_delta) })), catalog: p.lines.map(l => ({ id: Number(l.productId), price: Number(products.find(x => x.uuid === ids.find(y => y.id === Number(l.productId))?.uuid).price) })) };
    const req = pool.request();
    const sql = require('mssql/msnodesqlv8');
    await req.input('id', sql.UniqueIdentifier, id).input('actor', sql.Int, actor).input('register', sql.Int, p.registerId ?? null).input('version', sql.Int, policy.version).input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
        .query('INSERT dbo.commercial_quotes(id,actor_id,register_id,policy_version,payload,expires_at) VALUES(@id,@actor,@register,@version,@payload,DATEADD(minute,5,SYSUTCDATETIME()))');
    return { id, registerId: p.registerId, ...payload };
}
module.exports = { catalogo, cotizacion };
