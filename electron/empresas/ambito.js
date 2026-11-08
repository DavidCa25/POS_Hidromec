'use strict';
/**
 * DE QUÉ EMPRESA ES UN ARCHIVO DE CONFIGURACIÓN.
 *
 * Con MultiEmpresa una computadora atiende a varias empresas, cada una en su
 * base (docs/multiempresa.md). Algunos archivos de `userData` son del EQUIPO
 * —el servidor, el rol, la licencia— y otros son de la EMPRESA que se está
 * operando: su caja y su cajón, su credencial de la nube, su cuenta de Mercado
 * Pago. Si fueran del equipo, Los Pachoncitos abriría el cajón de B&J Super y
 * subiría sus ventas con la credencial de B&J Super.
 *
 * Este módulo es el ÚNICO que decide la ruta de un archivo de empresa:
 *
 *   empresa de la instalación   userData/<archivo>            (donde siempre)
 *   cualquier otra              userData/empresas/<base>/<archivo>
 *
 * La empresa de la instalación conserva sus rutas de siempre a propósito: una
 * caja que nunca usa MultiEmpresa no mueve ni un archivo, y una que empieza a
 * usarla no tiene que migrar nada.
 *
 * Se resuelve en CADA llamada, no al cargar: después de cambiar de empresa, la
 * siguiente lectura ya es la de la nueva.
 *
 * Todas las dependencias se inyectan: scripts/pruebas/empresas.test.mjs.
 */
const path = require('path');
const fs = require('fs');

/** Los archivos que son de la empresa. Cualquier otro es del equipo. */
const ARCHIVOS_DE_EMPRESA = Object.freeze([
  'device-config.json',     // caja, cajón con su pin, impresora, perfil del equipo
  'cloud-config.json',      // credencial de la nube de ESTA empresa
  'payments-config.json',   // formas de pago encendidas
  'services-config.json',
  'mp-config.json',         // cuenta de Mercado Pago
  'backup-config.json',     // carpeta y horario del respaldo de su base
  'ticket-logo.png', 'ticket-logo.jpg', 'ticket-logo.jpeg',   // el logo de SU ticket
]);

/** Las carpetas que son de la empresa (documentos de compras, miniaturas). */
const CARPETAS_DE_EMPRESA = Object.freeze(['compras-documentos', 'thumbs']);

/** Un nombre de base como nombre de carpeta: sin nada que escape de `empresas/`. */
function carpetaSegura(base) {
  const limpio = String(base || '').replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^\.+/, '_');
  if (!limpio) throw new Error('Empresa sin base.');
  return limpio;
}

/**
 * @param {object} deps
 *   userData()            la carpeta de datos de Wybix
 *   baseActiva()          la base a la que apunta la conexión ahora
 *   baseDeInstalacion()   la base con la que se instaló esta caja (o null)
 */
function crearAmbito({ userData, baseActiva, baseDeInstalacion }) {
  /** ¿Esta base es la de la instalación? Sin dato, se trata como tal. */
  function esDeInstalacion(base) {
    const instalada = baseDeInstalacion();
    return !instalada || !base || String(base).toLowerCase() === String(instalada).toLowerCase();
  }

  /** La carpeta de una empresa (la de la instalación es `userData`). */
  function carpetaDe(base) {
    return esDeInstalacion(base) ? userData() : path.join(userData(), 'empresas', carpetaSegura(base));
  }

  function validar(nombre) {
    if (!ARCHIVOS_DE_EMPRESA.includes(nombre) && !CARPETAS_DE_EMPRESA.includes(nombre)) {
      throw new Error(`${nombre} no es un archivo de empresa: decláralo en ambito.js o usa userData.`);
    }
  }

  /** Ruta de un archivo o carpeta de empresa, para una base dada. */
  function rutaDe(base, nombre) {
    validar(nombre);
    const carpeta = carpetaDe(base);
    fs.mkdirSync(carpeta, { recursive: true });
    return path.join(carpeta, nombre);
  }

  /** Ruta de un archivo o carpeta de la empresa ACTIVA. */
  function ruta(nombre) {
    return rutaDe(baseActiva(), nombre);
  }

  /**
   * Al dar de alta una empresa, hereda de la actual la configuración del
   * EQUIPO (impresora, cajón, escáner, pantalla de cliente) y el horario de
   * RESPALDO —una empresa nueva sin respaldo es un descuido esperando
   * pasar—, pero NUNCA su identidad ni su historia: ni la caja, ni la
   * credencial de la nube, ni la cuenta de Mercado Pago, ni el último
   * respaldo hecho. Lo que la nueva ya tenga no se pisa.
   */
  const HEREDABLE = {
    'device-config.json': (cfg) => { delete cfg.register; return cfg; },
    'backup-config.json': (cfg) => { delete cfg.lastBackupAt; delete cfg.lastStatus; delete cfg.lastError; delete cfg.lastAttemptAt; return cfg; },
  };

  function heredarEquipo(desdeBase, haciaBase) {
    let heredado = false;
    for (const [nombre, limpiar] of Object.entries(HEREDABLE)) {
      const origen = rutaDe(desdeBase, nombre);
      const destino = rutaDe(haciaBase, nombre);
      if (!fs.existsSync(origen) || fs.existsSync(destino)) continue;
      const cfg = limpiar(JSON.parse(fs.readFileSync(origen, 'utf8')));
      fs.writeFileSync(destino, JSON.stringify(cfg, null, 2), 'utf8');
      heredado = true;
    }
    return heredado;
  }

  return { ruta, rutaDe, carpetaDe, esDeInstalacion, heredarEquipo };
}

/* El ámbito del proceso. Los módulos lo piden con `ambito.ruta(...)`; main.js
   lo configura antes de que nadie lea un archivo. Sin configurar (pruebas de
   un módulo suelto, ventanas auxiliares) todo es de la instalación: el
   comportamiento de siempre. */
let actual = null;

function configurar(deps) { actual = crearAmbito(deps); return actual; }
function exigir() {
  if (!actual) {
    const { app } = require('electron');
    actual = crearAmbito({ userData: () => app.getPath('userData'), baseActiva: () => null, baseDeInstalacion: () => null });
  }
  return actual;
}

module.exports = {
  ARCHIVOS_DE_EMPRESA, CARPETAS_DE_EMPRESA, crearAmbito, configurar,
  ruta: (n) => exigir().ruta(n),
  rutaDe: (b, n) => exigir().rutaDe(b, n),
  carpetaDe: (b) => exigir().carpetaDe(b),
  esDeInstalacion: (b) => exigir().esDeInstalacion(b),
  heredarEquipo: (a, b) => exigir().heredarEquipo(a, b),
};
