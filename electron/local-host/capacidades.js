/**
 * LO QUE ESTE NEGOCIO TIENE ENCENDIDO, VISTO DESDE EL LOCAL HOST.
 *
 * El mismo modelo que CapabilityService en la pantalla, leido de la misma
 * fuente: los modulos (`sp_get_business_modules`) y, para Servicios, el giro
 * (`services_config.preset` + presets.json). Nunca `business_profile` como
 * interruptor: un taller es Retail + Servicios y una cafeteria con estetica es
 * Hospitality + Servicios; los modulos se suman.
 *
 *   hospitality   modulo `hospitality`
 *   mesas         hospitality Y `mesas`       (cuelgan de Hospitality)
 *   comandas      hospitality Y `comandas`
 *   servicios     modulo `servicios`
 *   agenda        servicios Y el giro trabaja con agenda (presets.json)
 *   ordenes       servicios Y el giro empieza por ordenes (taller, reparacion)
 *   inventario    siempre: todo negocio de Wybix tiene catalogo y existencias
 *
 * Cinco segundos de cache: una tablet que pregunta seguido no convierte cada
 * toque en una consulta.
 */
const presets = require('../servicios/presets');

const CACHE_MS = 5000;

function crearCapacidades({ pool, log = () => {} }) {
  let cache = null;
  let leidoEn = 0;

  async function leer(forzar = false) {
    if (!forzar && cache && Date.now() - leidoEn < CACHE_MS) return cache;
    const p = await pool();
    const modulos = new Set();
    try {
      const r = await p.request().execute('sp_get_business_modules');
      for (const f of r.recordset || []) if (f.enabled === true || f.enabled === 1) modulos.add(String(f.module_key));
    } catch (e) { log(`capacidades: modulos: ${e.message}`); }

    let giro = null;
    if (modulos.has('servicios')) {
      try {
        const r = await p.request().query('SELECT TOP 1 preset FROM dbo.services_config;');
        const id = r.recordset?.[0]?.preset;
        giro = id ? (presets.PRESETS.find(x => x.id === id) || null) : null;
      } catch (e) { log(`capacidades: giro: ${e.message}`); }
    }

    const hospitality = modulos.has('hospitality');
    const servicios = modulos.has('servicios');
    cache = {
      hospitality,
      mesas: hospitality && modulos.has('mesas'),
      comandas: hospitality && modulos.has('comandas'),
      servicios,
      giro: giro ? giro.id : null,
      /* Sin giro elegido, Servicios muestra agenda y ordenes (asi arranca el
         modulo): no se le quita nada a quien aun no eligio. */
      agenda: servicios && (giro ? giro.agenda === true : true),
      ordenes: servicios && (giro ? giro.inicio === 'ordenes' : true),
      activo: giro?.activo?.singular || 'Activo',
      inventario: true,
    };
    leidoEn = Date.now();
    return cache;
  }

  return { leer, olvidar: () => { cache = null; } };
}

module.exports = { crearCapacidades };
