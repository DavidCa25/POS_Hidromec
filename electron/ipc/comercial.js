const sesion = require('../seguridad/sesion');
const { BUNDLES } = require('../seguridad/permisos');
const motor = require('../comercial/motor.cjs');
const servicio = require('../comercial/servicio.cjs');
const limites = require('../comercial/limites.cjs');
function registrar({ ipcMain, sql, poolPromise, cajaDeLaOperacion, autorizacionEnCanal, pideAutorizacion, registrarEventoSeguridad, aprobacionesActivas = () => true }) {
    const safe = fn => async (...args) => { try {
        return { success: true, data: await fn(...args) };
    }
    catch (e) {
        return { success: false, error: String(e.message || e) };
    } };
    ipcMain.handle('commercial:catalog', sesion.proteger('commercial:catalog', safe(async () => servicio.catalogo(await poolPromise))));
    /* ROLES V2. Promociones y combos los da de alta tambien el Operador, con
       dos cuidados (ver comercial/limites.cjs): lo que se pase de 30% o deje un
       producto bajo costo lo autoriza un Encargado (PIN o app), y todo cambio
       queda en bitacora; si lo hizo alguien que no es Encargado, avisa al dueno. */
    ipcMain.handle('commercial:save', sesion.proteger('commercial:save', async (event, p, s) => {
        try {
            motor.validarPolitica(p.policy);
            const actor = sesion.actorDe(s);
            const pool = await poolPromise;
            const { policy: anterior, catalog } = await servicio.catalogo(pool);
            const revision = limites.revisar(p.policy, anterior, catalog.products || []);
            const supervisa = s.permisos.has(BUNDLES.VENTAS_SUPERVISAR);
            let c = null;
            if (revision.excesos.length && !supervisa && aprobacionesActivas()) {
                c = autorizacionEnCanal(event, s, p, 'commercial:save');
                if (!c)
                    return pideAutorizacion('commercial:save', `Pasa el límite de un operador (${limites.LIMITE_PORCENTAJE}% o bajo costo): lo autoriza un encargado.`,
                        { 'Promoción': revision.excesos.join('; ').slice(0, 300) });
            }
            const r = await pool.request().input('actor_id', sql.Int, actor).input('expected_version', sql.Int, p.version).input('payload', sql.NVarChar(sql.MAX), JSON.stringify(p.policy)).execute('sp_commercial_policy_save');
            if (revision.cambios.length || c) {
                const quien = c ? ` · ${c.via === 'APP' ? 'aprobado desde la app por' : 'autorizó'} ${c.autorizadorUsuario}` : '';
                registrarEventoSeguridad({ userId: actor, autorizadoPor: c && c.via !== 'APP' ? Number(c.autorizadorId) || null : null,
                    tipo: c ? 'PROMO_AUTHORIZED' : 'PROMO_CHANGED',
                    detalle: `${s.usuario} ${revision.cambios.join(', ')}${revision.excesos.length ? ' · ' + revision.excesos.join('; ') : ''}${quien}`.slice(0, 400),
                    alertar: !supervisa }).catch(() => {});
            }
            return { success: true, data: JSON.parse(r.recordset[0].payload) };
        }
        catch (e) {
            return { success: false, error: String(e.message || e) };
        }
    }));
    ipcMain.handle('commercial:quote', sesion.proteger('commercial:quote', safe(async (event, p, s) => {
        if (!Array.isArray(p.lines) || p.lines.length > 500)
            throw Error('Cuenta inválida.');
        if (p.audiences?.length) {
            const a = await sesion.comprobar(event.sender.id, BUNDLES.VENTAS_SUPERVISAR);
            if (!a.ok)
                throw Error('La elegibilidad del descuento debe confirmarla un supervisor.');
        }
        const pool = await poolPromise, op = cajaDeLaOperacion(p);
        const resolved = (await pool.request().input('asked', sql.Int, op.registerId).input('machine', sql.NVarChar(64), op.machineId).query('DECLARE @r INT=@asked;IF @r IS NULL SELECT @r=register_id FROM dbo.register_assignments WHERE machine_id=@machine AND released_at IS NULL AND lease_until>SYSUTCDATETIME();IF @r IS NULL SELECT TOP 1 @r=id FROM dbo.registers ORDER BY id;SELECT @r AS id;')).recordset[0]?.id;
        if (!resolved)
            throw Error('Configura la caja antes de calcular precios.');
        return servicio.cotizacion(pool, { ...p, registerId: resolved }, sesion.actorDe(s));
    })));
}
module.exports = { registrar };
