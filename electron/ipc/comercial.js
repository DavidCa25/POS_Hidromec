const sesion = require('../seguridad/sesion');
const { BUNDLES } = require('../seguridad/permisos');
const motor = require('../comercial/motor.cjs');
const servicio = require('../comercial/servicio.cjs');
function registrar({ ipcMain, sql, poolPromise, cajaDeLaOperacion }) {
    const safe = fn => async (...args) => { try {
        return { success: true, data: await fn(...args) };
    }
    catch (e) {
        return { success: false, error: String(e.message || e) };
    } };
    ipcMain.handle('commercial:catalog', sesion.proteger('commercial:catalog', safe(async () => servicio.catalogo(await poolPromise))));
    ipcMain.handle('commercial:save', sesion.proteger('commercial:save', safe(async (event, p, s) => {
        motor.validarPolitica(p.policy);
        const actor = sesion.actorDe(s);
        const pool = await poolPromise;
        const r = await pool.request().input('actor_id', sql.Int, actor).input('expected_version', sql.Int, p.version).input('payload', sql.NVarChar(sql.MAX), JSON.stringify(p.policy)).execute('sp_commercial_policy_save');
        return JSON.parse(r.recordset[0].payload);
    })));
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
