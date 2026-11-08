'use strict';
/**
 * EL CICLO DE VIDA DE LA EMPRESA ACTIVA.
 *
 * Cambiar de empresa no es cambiar el nombre de la base en la conexión.
 * Wybix tiene servicios que trabajan solos en segundo plano —la nube, el menú
 * en línea, el Club, los avisos de WhatsApp, el Local Host, los respaldos, el
 * arriendo de la caja— y memorias de lo que leyó de la base: la configuración
 * del negocio, los módulos encendidos, la política de aprobaciones. Si uno solo
 * sigue vivo con lo de la empresa anterior, sube las ventas de Los Pachoncitos
 * con la credencial de B&J Super o le enseña a un cajero los módulos de otra.
 *
 * Por eso el cambio es un CICLO, no una lista de pasos repartida por main.js:
 *
 *   servicios   se registran con `detener` e `iniciar`. Se detienen en orden
 *               inverso al registro y se inician en el orden del registro.
 *   memorias    se registran con `olvidar`. Se olvidan todas, después de
 *               apuntar a la base nueva y antes de iniciar nada.
 *
 * Quien añade a Wybix un servicio en segundo plano o una memoria de la base la
 * registra aquí. `SERVICIOS_CONOCIDOS` y `MEMORIAS_CONOCIDAS` son la lista que
 * la prueba exige: olvidar registrar una conocida es un error de arranque,
 * no un fallo silencioso en la caja de un cliente.
 *
 * Todas las dependencias se inyectan: scripts/pruebas/empresas.test.mjs.
 */

const SERVICIOS_CONOCIDOS = Object.freeze([
  'caja-arrendada',   // el arriendo de la caja de ESTA empresa
  'local-host',       // KDS y tablets: sirven los datos de la base activa
  'respaldos',
  'nube',             // sincronización, Club y menú en línea, con la credencial de la empresa
  'avisos-whatsapp',  // barre los pedidos listos de la base activa
]);

/* La licencia NO está aquí: es del equipo, no de la empresa. */
const MEMORIAS_CONOCIDAS = Object.freeze([
  'negocio',          // business_config memorizada
  'modulos',          // módulos encendidos
  'aprobaciones',     // política de aprobaciones
  'sesiones',         // revisión de seguridad de la base
  'fiscal-historico', // emisor ya reclamado en la nube
]);

function crearCiclo({ log = () => {}, logError = () => {} } = {}) {
  const servicios = [];
  const memorias = [];

  function registrarServicio(nombre, { iniciar, detener }) {
    if (servicios.some(s => s.nombre === nombre)) throw new Error(`Servicio de empresa repetido: ${nombre}`);
    if (typeof iniciar !== 'function' || typeof detener !== 'function') {
      throw new Error(`El servicio ${nombre} necesita iniciar y detener.`);
    }
    servicios.push({ nombre, iniciar, detener });
  }

  function registrarMemoria(nombre, olvidar) {
    if (memorias.some(m => m.nombre === nombre)) throw new Error(`Memoria de empresa repetida: ${nombre}`);
    if (typeof olvidar !== 'function') throw new Error(`La memoria ${nombre} necesita olvidar.`);
    memorias.push({ nombre, olvidar });
  }

  /** Lo conocido que nadie registró. Vacío = el ciclo está completo. */
  function faltantes() {
    const s = new Set(servicios.map(x => x.nombre));
    const m = new Set(memorias.map(x => x.nombre));
    return [
      ...SERVICIOS_CONOCIDOS.filter(n => !s.has(n)).map(n => `servicio ${n}`),
      ...MEMORIAS_CONOCIDAS.filter(n => !m.has(n)).map(n => `memoria ${n}`),
    ];
  }

  /**
   * Detener NO se detiene ante un error: un servicio que falla al parar no
   * puede dejar a los demás corriendo con la empresa anterior. Se registra y
   * se sigue; los errores se devuelven para quien quiera reportarlos.
   */
  async function detenerTodo() {
    const errores = [];
    for (const s of [...servicios].reverse()) {
      try { await s.detener(); log(`[EMPRESA] detenido ${s.nombre}`); }
      catch (e) { errores.push({ nombre: s.nombre, error: e }); logError(`[EMPRESA] ${s.nombre} no se detuvo: ${e.message}`); }
    }
    return errores;
  }

  function olvidarTodo() {
    for (const m of memorias) {
      try { m.olvidar(); }
      catch (e) { logError(`[EMPRESA] ${m.nombre} no se olvidó: ${e.message}`); }
    }
  }

  /**
   * Iniciar tampoco se detiene: que no arranque el menú en línea no es razón
   * para dejar la caja sin arriendo. Cada servicio ya sabe operar degradado.
   */
  async function iniciarTodo() {
    const errores = [];
    for (const s of servicios) {
      try { await s.iniciar(); log(`[EMPRESA] iniciado ${s.nombre}`); }
      catch (e) { errores.push({ nombre: s.nombre, error: e }); logError(`[EMPRESA] ${s.nombre} no arrancó: ${e.message}`); }
    }
    return errores;
  }

  return {
    registrarServicio, registrarMemoria, faltantes, detenerTodo, olvidarTodo, iniciarTodo,
    servicios: () => servicios.map(s => s.nombre),
    memorias: () => memorias.map(m => m.nombre),
  };
}

module.exports = { crearCiclo, SERVICIOS_CONOCIDOS, MEMORIAS_CONOCIDAS };
