/**
 * LA LICENCIA DE ESTA INSTALACIÓN, EN UN SOLO LUGAR (proceso principal).
 *
 *   almacén     electron/license.js: cifrado, espejo, huella, ancla de reloj.
 *               Sigue siendo el almacén; ahora guarda el CERTIFICADO FIRMADO.
 *   certificado verificado con la clave pública (certificado.js).
 *   estado      TRIAL | ACTIVE | GRACE | SALE_ONLY | EXPIRED (estado.js).
 *   evaluador   qué se puede hacer (entitlements.js).
 *
 * Nada de esto consulta la red: la venta nunca espera a Supabase. Refrescar
 * el certificado lo hace `refrescar()` en segundo plano, o importar un
 * archivo (.wybix-license) llevado en USB.
 *
 * CERTIFICADO FIRMADO OBLIGATORIO. Una licencia en el formato anterior (sin
 * firma) se RECHAZA: estado TAMPER con motivo `sin-firma` («Esta licencia
 * necesita actualizarse»). No hay un estado especial para ella ni un periodo
 * de gracia: ese formato se podía fabricar, y los únicos registros que lo
 * usaban eran pruebas internas (auditoría 2026-09-26), que se reemiten
 * firmados. Actualizarla es refrescar en línea (el servidor responde el
 * certificado del equipo), importar el archivo o activar la clave.
 *
 * KIDs REVOCADOS. Un certificado nuevo puede traer `revoked_kids` (claves de
 * firma comprometidas). Se guardan en revocaciones.js, APARTE de la licencia,
 * y solo se suman: ni liberar el equipo ni importar un archivo viejo los
 * quita. Desde ahí, nada firmado con ellos se acepta en este equipo.
 */
const { verificarCertificado, leerArchivo } = require('./certificado');
const { calcularEstado } = require('./estado');
const { crearEvaluador, TODOS, GIROS } = require('./entitlements');
const { crearRevocaciones } = require('./revocaciones');

const MEMO_MS = 15_000;
const ANCLA_MS = 60_000;

function crearLicencia({ store, contexto, ahora = () => Date.now(), llaves = undefined, revocaciones = crearRevocaciones() }) {
  // `llaves`: las públicas de confianza. Por omisión, las de producción
  // (llaves-publicas.js); las pruebas pasan las suyas.
  const verificar = (c) => verificarCertificado(c, llaves, revocaciones.leer());
  let memo = null;
  let memoEn = 0;

  const olvidar = () => { memo = null; memoEn = 0; };

  function machineIdEsperado(data) {
    return data?.machineId || store.machineIdEstable(contexto());
  }

  /**
   * Lo que no es un certificado: la instancia del gestor de demos (interna,
   * fuera del instalador público), nada guardado, o una licencia sin firma,
   * que se rechaza.
   */
  function sinCertificado(st) {
    if (st.state === 'demo') return { modo: 'DEMO', state: 'demo', type: 'demo', plan: 'demo', entitlements: TODOS, verticals: Object.keys(GIROS), screens: { COMMERCE: null, HOSPITALITY: null, SERVICES: null }, registersMax: null };
    if (st.state === 'tamper') return { modo: 'TAMPER', ...st };
    if (st.state === 'none') return { modo: 'NONE', state: 'none' };
    return { modo: 'TAMPER', state: 'tamper', motivo: 'sin-firma', type: st.type === 'trial' ? 'trial' : 'paid' };
  }

  function calcular() {
    const ctx = contexto();
    // Una demo del gestor es una demostración, tenga lo que tenga guardado.
    if (store.esDemo?.()) return sinCertificado(store.computeStatus(ctx));
    const { data, tampered, identidad } = store.readLicense(ctx);
    if (!data?.certificado || tampered || identidad === 'otra') return sinCertificado(store.computeStatus(ctx));

    const v = verificar(data.certificado);
    if (!v.ok) return { modo: 'TAMPER', state: 'tamper', motivo: v.motivo === 'FIRMA' ? 'firma' : v.motivo.toLowerCase().replace(/_/g, '-'),
                        type: tipoDe(data.certificado) };
    const p = v.payload;
    if (p.machine_id !== machineIdEsperado(data)) return { modo: 'TAMPER', state: 'tamper', motivo: 'otro-equipo' };

    const t = ahora();
    const e = calcularEstado(p, { ahora: t, ultimaVista: data.lastSeen });

    // Ancla de reloj: se guarda como mucho una vez por minuto.
    let cambios = null;
    if (t > (Number(data.lastSeen) || 0) + ANCLA_MS) cambios = { lastSeen: t };
    // Seguimiento de la Venta Esencial, para avisar al renovar.
    if (e.modo === 'SALE_ONLY' && !data.ventaEsencialDesde) {
      cambios = { ...(cambios || {}), ventaEsencialDesde: new Date(Date.parse(e.ahoraEfectivo)).toISOString() };
    }
    if (['ACTIVE', 'GRACE', 'TRIAL'].includes(e.modo) && data.ventaEsencialDesde) {
      cambios = { ...(cambios || {}), ventaEsencialDesde: null,
                  revisionInventario: { desde: data.ventaEsencialDesde, hasta: new Date(t).toISOString() } };
    }
    if (cambios) store.saveLicense(ctx, { ...data, ...cambios }, data.fp);

    const legacyState = { TRIAL: 'trial', ACTIVE: 'active', GRACE: 'active', SALE_ONLY: 'active', EXPIRED: 'expired' }[e.modo];
    return {
      ...e,
      state: legacyState,
      type: p.kind === 'TRIAL' ? 'trial' : 'paid',
      plan: p.kind === 'TRIAL' ? 'trial' : p.edition,
      edition: p.edition,
      customerName: p.customer || '',
      licenseId: p.license_id,
      registersMax: p.registers_max,
      verticals: p.verticals,
      screens: p.screens,
      entitlements: p.entitlements,
      addons: p.addons || [],
      origin: p.origin ?? null,
      firstActivatedAt: p.first_activated_at,
      paidUntil: p.paid_until,
      graceUntil: p.grace_until,
      trialEndsAt: p.trial_ends_at,
      expiresAt: p.trial_ends_at,
      daysRemaining: e.diasRestantes ?? 0,
      issuedAt: p.issued_at,
      validUntil: p.valid_until,
      revisionInventario: (cambios?.revisionInventario ?? data.revisionInventario) || null,
    };
  }

  /** 'trial' | 'paid' del certificado guardado, SIN verificarlo: solo para
      saber a qué servicio pedirle el refresco (el servidor decide). */
  function tipoDe(cert) {
    try { return JSON.parse(Buffer.from(cert.payload, 'base64url').toString('utf8')).kind === 'TRIAL' ? 'trial' : 'paid'; }
    catch { return null; }
  }
  function tipoGuardado() {
    const { data } = store.readLicense(contexto());
    if (data?.certificado) return tipoDe(data.certificado);
    return data?.type === 'trial' ? 'trial' : (data ? 'paid' : null);
  }

  function estado(forzar = false) {
    if (!forzar && memo && ahora() - memoEn < MEMO_MS) return memo;
    try { memo = calcular(); } catch (e) { memo = { modo: 'NONE', state: 'none', error: e.message }; }
    memoEn = ahora();
    return memo;
  }

  const evaluador = (forzar = false) => crearEvaluador(estado(forzar));

  /**
   * Guarda lo que respondió el SERVIDOR (activar, refrescar, prueba). Solo lo
   * llama el proceso principal con respuestas que él mismo pidió: el renderer
   * no puede escribir una licencia.
   */
  function aplicarRespuesta(resp) {
    const ctx = contexto();
    const previo = store.readLicense(ctx).data || {};
    // Sin certificado firmado no se guarda nada: la licencia actual queda como estaba.
    if (!resp?.certificate) return { ok: false, error: 'El servicio de licencias no devolvió una licencia firmada. Intenta más tarde.' };
    const v = verificar(resp.certificate);
    if (!v.ok) return { ok: false, error: 'El servidor devolvió una licencia que no pudo verificarse.', motivo: v.motivo };
    // Las revocaciones que trae este certificado aplican a partir de ya (y
    // para siempre), incluso a él mismo.
    if ((v.payload.revoked_kids || []).includes(v.kid)) return { ok: false, error: 'La licencia recibida está firmada con una clave revocada.', motivo: 'CLAVE_REVOCADA' };
    revocaciones.agregar(v.payload.revoked_kids || []);
    const esperado = store.machineIdEstable(ctx);
    if (v.payload.machine_id !== esperado) return { ok: false, error: 'La licencia recibida es de otra computadora.' };
    store.saveLicense(ctx, {
      certificado: resp.certificate, machineId: v.payload.machine_id, lastSeen: previo.lastSeen,
      ventaEsencialDesde: previo.ventaEsencialDesde ?? null, revisionInventario: previo.revisionInventario ?? null,
      // El giro de prueba pendiente se conserva hasta que el servidor lo confirme.
      giroPruebaPendiente: v.payload.kind === 'TRIAL' && !(v.payload.verticals || []).includes(previo.giroPruebaPendiente)
        ? (previo.giroPruebaPendiente ?? null) : null,
    });
    olvidar();
    return { ok: true, payload: v.payload };
  }

  /**
   * El giro que eligió el alta para la PRUEBA, cuando no se pudo mandar (sin
   * red). Se manda en el siguiente refresco. No otorga nada por sí solo: lo
   * que vale es el certificado que responde el servidor.
   */
  function recordarGiroPrueba(giro) {
    const ctx = contexto();
    const { data } = store.readLicense(ctx);
    if (!data) return { ok: false };
    store.saveLicense(ctx, { ...data, giroPruebaPendiente: giro }, data.fp);
    olvidar();
    return { ok: true };
  }
  const giroPruebaPendiente = () => {
    try { return store.readLicense(contexto()).data?.giroPruebaPendiente ?? null; } catch { return null; }
  };

  /**
   * Importar un archivo .wybix-license (sin Internet en la caja).
   * No se aplica nada que no verifique: un archivo editado, de otro equipo o
   * más viejo que el actual se rechaza y la licencia actual queda intacta.
   */
  function importar(texto) {
    const cert = leerArchivo(texto);
    if (!cert) return { ok: false, error: 'El archivo no es una licencia de Wybix.' };
    const v = verificar(cert);
    if (!v.ok) {
      return { ok: false, error: v.motivo === 'FIRMA'
        ? 'La licencia fue modificada o no es de Wybix: su firma no es válida.'
        : v.motivo === 'CLAVE_DESCONOCIDA' ? 'Esta licencia está firmada con una clave que esta versión de Wybix no conoce. Actualiza Wybix.'
        : v.motivo === 'CLAVE_REVOCADA' ? 'Esta licencia está firmada con una clave que ya no es válida. Descarga tu licencia otra vez.'
        : 'El archivo de licencia está dañado o es de una versión no compatible.' };
    }
    const ctx = contexto();
    if (v.payload.machine_id !== store.machineIdEstable(ctx)) {
      return { ok: false, error: 'Esta licencia es de otra computadora. Descarga la de este equipo con su código.' };
    }
    const actual = store.readLicense(ctx).data;
    if (actual?.certificado) {
      const va = verificar(actual.certificado);
      if (va.ok && va.payload.license_id === v.payload.license_id && Date.parse(v.payload.issued_at) < Date.parse(va.payload.issued_at)) {
        return { ok: false, error: 'Este archivo es más antiguo que la licencia que ya tienes. No se cambió nada.' };
      }
    }
    const r = aplicarRespuesta({ certificate: cert });
    return r.ok ? { ok: true, estado: estado(true) } : r;
  }

  /** Se leyó el aviso de inventario: no volver a mostrarlo. */
  function descartarRevisionInventario() {
    const ctx = contexto();
    const { data } = store.readLicense(ctx);
    if (data?.revisionInventario) { store.saveLicense(ctx, { ...data, revisionInventario: null }, data.fp); olvidar(); }
    return { ok: true };
  }

  function certificadoActual() {
    return store.readLicense(contexto()).data?.certificado ?? null;
  }

  return { estado, evaluador, aplicarRespuesta, importar, olvidar, descartarRevisionInventario, certificadoActual,
           tipoGuardado, recordarGiroPrueba, giroPruebaPendiente };
}

module.exports = { crearLicencia };
