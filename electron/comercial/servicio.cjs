const { randomUUID } = require('node:crypto');
const { cotizar, validarPolitica, centavos } = require('./motor.cjs');
async function catalogo(pool) {
    const p = await pool.request().query('SELECT version,payload FROM dbo.commercial_policy WHERE id=1');
    const c = await pool.request().execute('sp_catalog_publication');
    const catalog = JSON.parse(c.recordset[0].catalog_json);
    const ids = (await pool.request().query('SELECT id,LOWER(CONVERT(VARCHAR(36),uuid)) uuid FROM dbo.products')).recordset;
    const optionIds = (await pool.request().query('SELECT id,group_id,LOWER(CONVERT(VARCHAR(36),uuid)) uuid FROM dbo.modifier_options')).recordset;
    const clock = (await pool.request().query("SELECT CONVERT(VARCHAR(19),GETDATE(),126) wallTime")).recordset[0];
    return { policy: JSON.parse(p.recordset[0].payload), catalog, ids, optionIds, wallTime: clock.wallTime };
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
    let coupon = null, pricedPolicy = policy;
    if (p.coupon) {
        if (p.channel && p.channel !== 'LOCAL')
            throw Error('Los cupones se usan en Mostrador.');
        if (input.some(l => l.combo))
            throw Error('El cupón no se acumula con combos.');
        const sql = require('mssql/msnodesqlv8');
        const c = (await pool.request().input('code', sql.NVarChar(24), p.coupon).execute('sp_coupon_validate')).recordset[0];
        if (!c?.ok)
            throw Error(c?.mensaje ?? 'Cupón no válido.');
        if (c.kind !== 'FREE_PRODUCT')
            throw Error('Este tipo de cupón aún no está habilitado. Usa una promoción de precio o porcentaje.');
        const product = ids.find(x => x.id === c.product_id)?.uuid;
        if (!product || !input.some(l => l.product === product))
            throw Error('Agrega el producto del cupón.');
        pricedPolicy = { ...policy, promotions: [{ id: 'coupon', name: c.nombre, active: true, priority: 0, kind: 'PRICE', value: '0.00', selector: { products: [product] }, maxApplications: 1 }] };
        coupon = { code: p.coupon, productId: c.product_id, instanceId: c.instance_id };
    }
    const result = cotizar(pricedPolicy, products.map(x => ({ id: x.uuid, price: x.price, category: x.category_uuid })), input, { ...clock, channel: p.channel ?? 'LOCAL', audiences: p.audiences ?? [] });
    const lines = result.lines.map((l, i) => { const source = p.lines[input.findIndex(x => x.key === l.source)]; return { line_no: i + 1, productId: Number(source.productId), qty: Number(l.quantity), unitPrice: Number(l.unitPrice), note: source.note ?? null, options: (source.options ?? []).map(o => ({ optionId: Number(o.optionId), quantity: Number(o.quantity ?? 1) })), audit: l }; });
    const id = randomUUID(), payload = { ...result, orderReference: p.orderReference ? String(p.orderReference).trim().slice(0, 100) : null, coupon: coupon ? { ...coupon, amountApplied: result.discount } : null, lines, optionPrices: options.filter(o => p.lines.some(l => l.options?.some(x => Number(x.optionId) === o.id))).map(o => ({ id: o.id, price: Number(o.price_delta) })), catalog: p.lines.map(l => ({ id: Number(l.productId), price: Number(products.find(x => x.uuid === ids.find(y => y.id === Number(l.productId))?.uuid).price) })) };
    const req = pool.request();
    const sql = require('mssql/msnodesqlv8');
    await req.input('id', sql.UniqueIdentifier, id).input('actor', sql.Int, actor).input('register', sql.Int, p.registerId ?? null).input('version', sql.Int, policy.version).input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
        .query('INSERT dbo.commercial_quotes(id,actor_id,register_id,policy_version,payload,expires_at) VALUES(@id,@actor,@register,@version,@payload,DATEADD(minute,5,SYSUTCDATETIME()))');
    return { id, registerId: p.registerId, ...payload };
}
module.exports = { catalogo, cotizacion };
