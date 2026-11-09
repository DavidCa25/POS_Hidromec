'use strict';
/**
 * LICENCIA POR EMPRESA (0082) · ¿qué puede hacer la empresa activa?
 *
 * La licencia del equipo opera SU empresa —la base de la instalación— y las
 * «Empresa adicional» que se compraron: el certificado firmado lo dice en
 * `companies_max` (1 + adicionales). Las empresas REMOTAS de un grupo no
 * cuentan aquí: cada una paga la suya en su computadora.
 *
 *   PRINCIPAL  la base de la instalación: la cubre la licencia del equipo.
 *   INCLUIDA   una adicional dentro del cupo comprado.
 *   PRUEBA     una adicional fuera del cupo: 30 días desde que este equipo
 *              la vio por primera vez.
 *   CONSULTA   terminó su prueba: se ve todo (reportes, Mis empresas,
 *              respaldos) pero no se vende, ni se cobra, ni se cambia nada.
 *
 * QUIÉN OCUPA EL CUPO. Las adicionales en el orden en que este equipo las vio
 * por primera vez: la que se dio de alta primero no pierde su lugar porque
 * llegue otra. Esa fecha vive en el almacén blindado de la licencia (cifrado,
 * con espejo y ancla de reloj): borrar un archivo o atrasar Windows no
 * regala otra prueba.
 *
 * SIN RED Y SIN SQL EN CADA CANAL. `refrescar()` lee la lista de bases (al
 * arrancar, al cambiar de empresa y al dar de alta) y deja el estado listo;
 * `evaluador()` es síncrono, como el de la licencia, porque lo consulta cada
 * canal protegido.
 */
const DIA = 86_400_000;
const PRUEBA_DIAS = 30;

/** Lo que una empresa en CONSULTA sigue pudiendo hacer: ver y respaldar. */
const PAQUETES_EN_CONSULTA = new Set(['REPORTES_VER', 'VER_NUMEROS_DIA', 'VER_COSTOS', 'VER_VENTAS_TODOS', 'EMPRESAS_CAMBIAR']);
const CANALES_EN_CONSULTA = new Set(['backup-run-now', 'export-database']);
/** Entitlements que se conservan en CONSULTA (los demás se apagan). */
const ENTITLEMENTS_EN_CONSULTA = new Set(['reports', 'backup', 'customers']);

/**
 * El estado de UNA base, puro: sin SQL ni archivos.
 *
 * @param {object} o
 *   base         la base que se pregunta
 *   principal    la base de la instalación (null si no se conoce: se toma la activa)
 *   bases        todas las bases locales del grupo
 *   cupo         companies_max del certificado (1 = solo la principal)
 *   vistas       { [base]: ISO } cuándo vio este equipo cada adicional
 *   ahora        ms
 */
function estadoDeBase({ base, principal, bases, cupo, vistas, ahora }) {
  if (!principal || base === principal) return { modo: 'PRINCIPAL' };
  const adicionales = ordenarAdicionales(bases.filter(b => b !== principal), vistas);
  const lugar = adicionales.indexOf(base);
  const libres = Math.max(0, (Number(cupo) || 1) - 1);
  if (lugar >= 0 && lugar < libres) return { modo: 'INCLUIDA' };

  const vista = Date.parse(vistas?.[base] || '') || ahora;
  const fin = vista + PRUEBA_DIAS * DIA;
  if (ahora < fin) {
    return { modo: 'PRUEBA', diasRestantes: Math.max(1, Math.ceil((fin - ahora) / DIA)), hasta: new Date(fin).toISOString() };
  }
  return { modo: 'CONSULTA', hasta: new Date(fin).toISOString() };
}

/** Las adicionales en el orden en que se vieron (la más antigua primero). */
function ordenarAdicionales(bases, vistas) {
  const cuando = (b) => Date.parse(vistas?.[b] || '') || Number.MAX_SAFE_INTEGER;
  return [...bases].sort((a, b) => cuando(a) - cuando(b) || a.localeCompare(b));
}

/**
 * El evaluador de la licencia, recortado a «solo consulta».
 * Mismo contrato que electron/licencia/entitlements.js.
 */
function soloConsulta(ev) {
  const tiene = (ent) => !ent || (ENTITLEMENTS_EN_CONSULTA.has(ent) && ev.tiene(ent));
  return {
    ...ev,
    tiene,
    empresaEnConsulta: true,
    permiteCanal(canal, paquete, modulo) {
      if (CANALES_EN_CONSULTA.has(canal) || PAQUETES_EN_CONSULTA.has(paquete)) return ev.permiteCanal(canal, paquete, modulo);
      return { ok: false, requiere: 'empresa' };
    },
    permiteSuperficie: () => false,
  };
}

/**
 * @param {object} d
 *   licencia        crearLicencia(): estado() con companiesMax, empresasVistas(), recordarEmpresas()
 *   basesLocales    async () => string[]   las bases del grupo en este servidor
 *   baseActiva      () => string
 *   principal       () => string | null    la base de la instalación
 *   ahora           () => ms
 */
function crearLicenciaEmpresas({ licencia, basesLocales, baseActiva, principal, ahora = () => Date.now(), logError = () => {} }) {
  /** Por base: el último estado calculado. */
  let estados = new Map();

  function cupo() {
    try { return Number(licencia.estado()?.companiesMax) || 1; } catch { return 1; }
  }

  /**
   * Relee las bases, anota las que este equipo ve por primera vez y deja
   * listo el estado de cada una. Nunca lanza: sin lista, la activa sigue con
   * el último estado conocido.
   */
  async function refrescar() {
    try {
      const bases = await basesLocales();
      const prin = principal() || baseActiva();
      const vistas = { ...(licencia.empresasVistas() || {}) };
      let nuevas = false;
      const t = ahora();
      for (const b of bases) {
        if (b !== prin && !vistas[b]) { vistas[b] = new Date(t).toISOString(); nuevas = true; }
      }
      if (nuevas) licencia.recordarEmpresas(vistas);
      const c = cupo();
      estados = new Map(bases.map(b => [b, estadoDeBase({ base: b, principal: prin, bases, cupo: c, vistas, ahora: t })]));
      if (!estados.has(baseActiva())) {
        estados.set(baseActiva(), estadoDeBase({ base: baseActiva(), principal: prin, bases: [...bases, baseActiva()], cupo: c, vistas, ahora: t }));
      }
    } catch (e) {
      logError('[EMPRESAS] No se pudo calcular la licencia de las empresas:', e?.message || e);
    }
    return estado();
  }

  /** El estado de una base (por omisión, la activa). */
  function estado(base = baseActiva()) {
    const e = estados.get(base) ?? { modo: 'PRINCIPAL' };
    /* La prueba se vence mientras la app sigue abierta: se recalcula la fecha. */
    if (e.modo === 'PRUEBA' && Date.parse(e.hasta) <= ahora()) return { modo: 'CONSULTA', hasta: e.hasta };
    return e;
  }

  /** Lo que se muestra en el selector y en Mis empresas. */
  function resumen() {
    return { cupo: cupo(), empresas: Object.fromEntries([...estados.keys()].map(b => [b, estado(b)])) };
  }

  /** El evaluador de la licencia, recortado si la empresa activa está en consulta. */
  function evaluador(forzar = false) {
    const ev = licencia.evaluador(forzar);
    return estado().modo === 'CONSULTA' ? soloConsulta(ev) : ev;
  }

  return { refrescar, estado, resumen, evaluador };
}

module.exports = { crearLicenciaEmpresas, estadoDeBase, soloConsulta, PRUEBA_DIAS };
