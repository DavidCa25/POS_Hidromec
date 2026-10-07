/**
 * FASE 1 · PRUEBAS UNITARIAS DEL PROCESO PRINCIPAL (sin Electron, sin base).
 *
 *     node scripts/pruebas/fase1-unidad.mjs
 *
 *   1. Contraseñas: SHA-256 heredado se acepta y pide migrar; scrypt nuevo.
 *   2. Comprobante de autorización: un solo uso, ligado a ventana/actor/canal.
 *   3. Autoridad de sesión: el renderer no cambia al actor.
 *   4. Secretos: safeStorage o nada (nunca base64).
 *   5. Identidad en la nube: dos PCs de Centro = una empresa; Norte por código.
 *   6. Envío de hechos: lotes, acuses y nunca rompe sin Internet.
 */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const contrasenas = require('../../electron/seguridad/contrasenas.js');
const reaut = require('../../electron/seguridad/reautenticacion.js');
const sesion = require('../../electron/seguridad/sesion.js');
const canales = require('../../electron/seguridad/canales.js');
const { crearSecretos } = require('../../electron/seguridad/secretos.js');
const { crearIdentidad } = require('../../electron/nube/identidad.js');
const { crearEnvioHechos } = require('../../electron/nube/hechos.js');

let fallos = 0, total = 0;
const check = (ok, msg, det = '') => {
  total++; if (!ok) fallos++;
  console.log(`   ${ok ? 'ok   ' : 'FALLA'}  ${msg}${det ? '  · ' + det : ''}`);
};
const seccion = (t) => console.log(`\n-- ${t}`);

// =========================================================== 1. contraseñas
seccion('1. Contraseñas: migración gradual sin forzar cambio');
{
  // Lo que guardaba sp_create_user: HASHBYTES('SHA2_256', NVARCHAR) = UTF-16LE, hex mayúsculas.
  const legado = createHash('sha256').update(Buffer.from('Caja#2026', 'utf16le')).digest('hex').toUpperCase();
  const v1 = contrasenas.verificar('Caja#2026', legado);
  check(v1.ok && v1.rehash, 'un hash SHA-256 heredado se acepta y pide migrar a scrypt');
  check(!contrasenas.verificar('otra', legado).ok, 'y una contraseña equivocada no entra');
  const nuevo = contrasenas.hashear('Caja#2026');
  check(nuevo.startsWith(contrasenas.PREFIJO) && !nuevo.includes('Caja'), 'el hash nuevo es scrypt con sal y no contiene la contraseña');
  const v2 = contrasenas.verificar('Caja#2026', nuevo);
  check(v2.ok && !v2.rehash, 'el hash nuevo se verifica sin pedir otra migración');
  check(contrasenas.hashear('Caja#2026') !== nuevo, 'misma contraseña, sal distinta: hashes distintos');
  check(!contrasenas.verificar('Caja#2026', '').ok && !contrasenas.verificar('', nuevo).ok, 'vacíos no entran');
}

// =========================================================== 2. comprobante
seccion('2. Comprobante de autorización: un solo uso, intransferible');
{
  reaut._reiniciar?.();
  const c = { webContentsId: 7, actorId: 3, autorizadorId: 9, autorizadorUsuario: 'marta', autorizadorRol: 'supervisor', canal: 'sp-close-shift', via: 'pin' };
  const { token } = reaut.emitir(c);
  check(reaut.consumir(token, { webContentsId: 8, actorId: 3, canal: 'sp-close-shift' }) === null, 'desde OTRA ventana no vale');
  check(reaut.consumir(token, { webContentsId: 7, actorId: 4, canal: 'sp-close-shift' }) === null, 'para OTRO actor no vale');
  check(reaut.consumir(token, { webContentsId: 7, actorId: 3, canal: 'sp-refund-sale' }) === null, 'para OTRA operación no vale');
  const ok = reaut.consumir(token, { webContentsId: 7, actorId: 3, canal: 'sp-close-shift' });
  check(ok?.autorizadorId === 9, 'un intento equivocado no lo gasta: el correcto sí lo usa');
  check(reaut.consumir(token, { webContentsId: 7, actorId: 3, canal: 'sp-close-shift' }) === null, 'y es de un solo uso');
  check(reaut.consumir('inventado', { webContentsId: 7, actorId: 3, canal: 'sp-close-shift' }) === null, 'un comprobante inventado no vale');
}

// =========================================================== 3. sesión
seccion('3. Autoridad de sesión: el renderer no decide quién opera');
{
  const eventos = [];
  sesion.configurar({ registrar: (e) => eventos.push(e) });
  const ses = { userId: 5 };
  const [venta] = sesion.conActorDeSesion('sp-register-sale', [{ user_id: 99, total: 10 }], ses, 1);
  check(venta.user_id === 5 && venta.total === 10, 'venta: el user_id que mandó la pantalla se reemplaza por el de la sesión');
  check(eventos.some(e => e.tipo === 'ACTOR_IGNORADO' && e.canal === 'sp-register-sale'), 'y queda registrado como ACTOR_IGNORADO');
  const [turno] = sesion.conActorDeSesion('sp-open-shift', [{ user_id: 99, opening_user_id: 98, register_id: 2 }], ses, 1);
  check(turno.user_id === 5 && turno.opening_user_id === 5 && turno.register_id === 2, 'abrir turno: quien abre sale de la sesión');
  const sinNada = sesion.conActorDeSesion('sp-register-purchase', [{ items: [] }], ses, 1);
  check(sinNada[0].userId === 5 || sinNada[0].user_id === 5, 'compra sin usuario: se le pone el de la sesión');
  const n = eventos.length;
  sesion.conActorDeSesion('sp-register-sale', [{ user_id: 5 }], ses, 1);
  check(eventos.length === n, 'si manda el mismo usuario no hay alarma');
  const posicional = sesion.conActorDeSesion('sp-register-customer-payment', [1, 100, 'EFECTIVO', 77], ses, 1);
  check(posicional[3] === 5, 'argumento posicional: también lo decide la sesión');
  check(sesion.conActorDeSesion('get-products', [{ user_id: 99 }], ses, 1)[0].user_id === 99, 'canales sin actor no se tocan');
  for (const canal of ['sp-register-sale', 'sp-register-purchase', 'sp-open-shift', 'sp-close-shift', 'sp-update-sale', 'sp-refund-sale',
                       'sp-import-sales', 'sp-register-cash-out', 'sp-register-supplier-payment']) {
    check(!!canales.actorPara(canal), `${canal}: el actor sale de la sesión`);
  }
}

// =========================================================== 4. secretos
seccion('4. Secretos: safeStorage o nada');
{
  const falso = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('ENC:' + s), decryptString: (b) => b.toString().slice(4) };
  const s1 = crearSecretos(falso);
  const c = s1.cifrar('wxd_token');
  check(c.method === 'safeStorage' && s1.descifrar(c.enc, c.method).valor === 'wxd_token', 'con cifrado del sistema: se guarda y se lee');
  const sin = crearSecretos({ isEncryptionAvailable: () => false });
  check(sin.cifrar('secreto') === null, 'sin cifrado del sistema: NO se guarda (antes caía a base64)');
  const viejo = Buffer.from('pass-anterior').toString('base64');
  const r = s1.descifrar(viejo, 'base64');
  check(r.valor === 'pass-anterior' && r.legado, 'lo guardado en base64 se lee una vez y se marca para volver a cifrarlo');
  check(crearSecretos(null).cifrar('x') === null, 'sin safeStorage en absoluto: tampoco');
}

// =========================================================== 5. identidad
seccion('5. Identidad: empresa -> sucursal -> equipo');
function nubeFalsa() {
  const empresas = new Map(); const porInstancia = new Map(); const secretos = new Map(); const codigos = new Map();
  let n = 0;
  const emitir = (loc, kind) => ({ token: 'wxd_' + (++n), device_id: 'dev-' + n, company_id: loc.empresa, location_id: loc.id, kind,
                                   install_secret: kind === 'POS_PRIMARY' ? (secretos.set('wxi_' + loc.id + n, loc), 'wxi_' + loc.id + n) : null });
  return {
    empresas, codigos,
    async llamar(action, b) {
      if (action === 'bootstrap') {
        if (porInstancia.has(b.instance_uuid)) { const e = new Error('INSTANCE_KNOWN'); e.code = 'INSTANCE_KNOWN'; throw e; }
        const empresa = 'emp-' + (empresas.size + 1); empresas.set(empresa, b.nombre_negocio);
        const loc = { id: 'loc-' + b.instance_uuid, empresa }; porInstancia.set(b.instance_uuid, loc);
        return { success: true, created: true, ...emitir(loc, 'POS_PRIMARY') };
      }
      if (action === 'enroll') {
        let loc = b.install_secret ? secretos.get(b.install_secret) : null;
        if (b.install_secret && (!loc || porInstancia.get(b.instance_uuid) !== loc)) { const e = new Error('DENIED'); e.code = 'DENIED'; throw e; }
        if (b.code) {
          const empresa = codigos.get(b.code); if (!empresa) { const e = new Error('DENIED'); e.code = 'DENIED'; throw e; }
          codigos.delete(b.code); loc = { id: 'loc-' + b.instance_uuid, empresa }; porInstancia.set(b.instance_uuid, loc);
        }
        return { success: true, ...emitir(loc, b.kind) };
      }
      throw new Error('acción ' + action);
    },
  };
}
function pc({ nube, base, principal, demo = false }) {
  let cfg = {}; const sec = {};
  return crearIdentidad({
    meta: {
      async asegurarInstancia() { base.instance_uuid ??= 'inst-' + Math.random().toString(16).slice(2); },
      async leer() { return { ...base, is_demo: demo ? 'true' : undefined }; },
      async escribir(v) { for (const [k, x] of Object.entries(v)) if (x != null) base[k] = x; },
    },
    llamar: (a, b) => nube.llamar(a, b),
    cfg: { leer: () => cfg, escribir: (p) => { cfg = { ...cfg, ...p }; } },
    secreto: { leer: (k) => sec[k] || '', guardar: (k, v) => { sec[k] = v; }, borrar: (k) => { delete sec[k]; } },
    esPrincipal: () => principal,
    nombres: () => ({ negocio: 'I Do Nut', sucursal: 'Matriz', equipo: 'CAJA' }),
  });
}
{
  const nube = nubeFalsa();
  const baseCentro = {};
  const centro1 = pc({ nube, base: baseCentro, principal: true });
  const centro2 = pc({ nube, base: baseCentro, principal: false });
  let err = null;
  try { await centro2.asegurar(); } catch (e) { err = e; }
  check(err?.code === 'SIN_PRINCIPAL', 'la secundaria no da de alta la sucursal: espera a la principal');
  const e1 = await centro1.asegurar();
  check(e1.registrado && !!baseCentro.install_secret && baseCentro.company_uuid === e1.companyId, 'la principal registra la base y deja la llave de instalación en ella');
  const e2 = await centro2.asegurar();
  check(e2.companyId === e1.companyId && e2.locationId === e1.locationId && e2.kind === 'POS_SECONDARY' && nube.empresas.size === 1,
    'dos PCs de Centro: UNA empresa, UNA sucursal');
  const [a, b] = await Promise.all([centro1.asegurar(), centro1.asegurar()]);
  check(a.deviceId === b.deviceId, 'pedir la credencial dos veces a la vez no da de alta dos veces');

  nube.codigos.set('ABCD2345EFGH', e1.companyId);
  const norte = pc({ nube, base: {}, principal: true });
  let mal = null; try { await norte.unirseConCodigo('123'); } catch (e) { mal = e; }
  check(mal?.code === 'BAD_CODE', 'un código mal escrito se rechaza antes de ir a la nube');
  const en = await norte.unirseConCodigo('abcd-2345-efgh');
  check(en.companyId === e1.companyId && en.locationId !== e1.locationId && nube.empresas.size === 1,
    'Norte (otra base) entra a la MISMA empresa con el código');
  let otra = null; try { await norte.unirseConCodigo('ABCD2345EFGH'); } catch (e) { otra = e; }
  check(otra?.code === 'YA_REGISTRADO', 'una caja ya registrada no se une a otra empresa');
  let demo = null; try { await pc({ nube, base: {}, principal: true, demo: true }).asegurar(); } catch (e) { demo = e; }
  check(demo?.code === 'DEMO' && nube.empresas.size === 1, 'una base de demostración no se registra en la nube');
}

// =========================================================== 6. hechos
seccion('6. Envío de hechos');
{
  const outbox = [
    { event_uuid: 'E1', event_type: 'SALE_RECORDED', aggregate_type: 'SALE', aggregate_uuid: 'A1', aggregate_version: '9007199254740993', occurred_at: new Date('2026-10-02T10:00:00Z'), payload_version: 1, payload: '{"total":10}', status: 'PENDING' },
    { event_uuid: 'E2', event_type: 'SHIFT_CLOSED', aggregate_type: 'SHIFT', aggregate_uuid: 'A2', aggregate_version: '12', occurred_at: new Date(), payload_version: 1, payload: '{"status":"CLOSED"}', status: 'PENDING' },
  ];
  const llamadas = { capture: 0, envios: [] };
  const pool = {
    request() {
      const ins = {};
      return {
        input(k, _t, v) { ins[k] = v; return this; },
        async execute(sp) {
          if (sp === 'sp_sync_capture') { llamadas.capture++; return { recordset: [] }; }
          if (sp === 'sp_sync_outbox_next') return { recordsets: [outbox.filter(o => o.status === 'PENDING'), [{ instance_uuid: 'I', company_uuid: 'C', location_uuid: 'L' }]] };
          if (sp === 'sp_sync_outbox_ack') { for (const a of JSON.parse(ins.acuses)) { const o = outbox.find(x => x.event_uuid.toLowerCase() === a.event_uuid.toLowerCase()); if (a.result === 'APPLIED' || a.result === 'DUPLICATE') o.status = 'SENT'; } return {}; }
        },
      };
    },
  };
  const sql = { Int: 'int', NVarChar: () => 'nvarchar', MAX: -1 };
  let red = true;
  const envio = crearEnvioHechos({
    pool: async () => pool, sql, puedeEnviar: async () => true,
    llamar: async (_a, cuerpo) => {
      if (!red) throw new Error('sin Internet');
      llamadas.envios.push(cuerpo);
      return { results: cuerpo.events.map(e => ({ event_uuid: e.event_uuid, result: 'APPLIED' })) };
    },
  });
  red = false;
  const r0 = await envio.enviar();
  check(r0.enviados === 0 && r0.error && outbox.every(o => o.status === 'PENDING'), 'sin Internet no lanza: el outbox sigue pendiente');
  red = true;
  const r1 = await envio.enviar();
  const ev = llamadas.envios[0]?.events?.[0];
  check(r1.enviados === 2 && outbox.every(o => o.status === 'SENT'), 'con Internet se envía el lote y se confirma con el acuse');
  check(ev?.aggregate_version === '9007199254740993' && typeof ev.payload === 'object' && llamadas.envios[0].envelope.company_uuid === 'C',
    'la versión BIGINT viaja como texto (sin perder precisión) y el sobre lleva la identidad de la base');
  check(llamadas.capture === 2, 'cada envío captura antes (sp_sync_capture)');
  const sinPermiso = crearEnvioHechos({ pool: async () => pool, sql, puedeEnviar: async () => false, llamar: async () => { throw new Error('no debía llamar'); } });
  check((await sinPermiso.enviar()).omitido === true, 'si la caja no es la principal (o la nube está apagada) no envía nada');
}

console.log(`\n${fallos ? 'HAY FALLOS' : 'TODO BIEN'} · ${total - fallos}/${total}\n`);
process.exit(fallos ? 1 : 0);
