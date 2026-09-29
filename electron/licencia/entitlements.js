/**
 * LICENSE ENTITLEMENT SERVICE: qué puede hacer ESTE negocio según su licencia.
 *
 * Tres preguntas distintas, que no se mezclan:
 *
 *   CAPABILITY   ¿Wybix tiene la función y está encendida?  (módulos: CapabilityService,
 *                sp_get_business_modules)
 *   ENTITLEMENT  ¿El cliente tiene derecho?                  (este archivo + certificado)
 *   PERMISSION   ¿Esta persona puede usarla?                 (seguridad/canales.js)
 *
 *   disponible = capability && entitlement && estado de la licencia && permiso
 *
 * QUÉ OTORGA CADA GIRO NO SE DECIDE AQUÍ: viene resuelto en el certificado
 * (`entitlements`), desde el catálogo de Supabase. Aquí solo se traduce cada
 * entitlement a lo que el POS protege (canales, módulos, pantallas) y se
 * aplica el Modo Venta Esencial.
 */

/** Lo que sigue funcionando en Venta Esencial: vender, consultar, respaldar. */
const EN_VENTA_ESENCIAL = new Set(['sales', 'customers', 'reports', 'backup', 'invoicing']);

/** Módulo del negocio -> entitlement que lo cubre. */
const POR_MODULO = {
  hospitality: 'hospitality',
  mesas: 'hospitality.tables',
  comandas: 'hospitality.kds',
  servicios: 'services',
  loyalty: 'loyalty',
};

/** Paquete de permisos -> entitlement (lo operativo que no es vender). */
const POR_PAQUETE = {
  INVENTARIO_OPERAR: 'inventory',
  SERVICIOS_OPERAR: 'services',
  SERVICIOS_ADMINISTRAR: 'services',
};

/** Canales con su propio entitlement (por prefijo). */
const POR_CANAL = [
  // Vender exige licencia EN EL BACKEND, no solo en la pantalla: una licencia
  // rechazada (sin firma, manipulada) o una prueba vencida no registra ventas
  // aunque se llame el canal a mano. Lo tienen la edición, la prueba, la demo
  // y la Venta Esencial.
  ['sp-register-sale', 'sales'],
  ['localhost:', 'operational_surfaces'],
  ['inventario:', 'inventory'],
  ['loyalty:', 'loyalty'],
  // Servicios conectados. Borrar la cuenta en la nube NO se bloquea: los
  // datos son del cliente, pague o no.
  ['cloud-push-now', 'cloud_sync'],
  ['cloud-set-config', 'cloud_sync'],
  ['cloud-ensure-provisioned', 'cloud_sync'],
  ['sp-import-suppliers', 'suppliers'],
];

/** Pantalla Operativa -> su entitlement y el GIRO cuya cuota consume. */
const SUPERFICIES = {
  PREPARATION:     { ent: 'operational.preparation',     giro: 'HOSPITALITY' },
  WAITER:          { ent: 'operational.waiter',          giro: 'HOSPITALITY' },
  CUSTOMER_STATUS: { ent: 'operational.customer_status', giro: 'HOSPITALITY' },
  STAFF_DAY:       { ent: 'operational.staff_day',       giro: 'SERVICES' },
  TECHNICIAN:      { ent: 'operational.technician',      giro: 'SERVICES' },
  // El inventario de piso es de cualquier giro: cuenta en Comercio si la
  // licencia lo tiene y, si no, en el primer giro de la licencia.
  INVENTORY_FLOOR: { ent: 'operational.inventory_floor', giro: 'COMMERCE', cualquierGiro: true },
};

/** Los giros y las etiquetas que ve el cliente. */
const GIROS = {
  COMMERCE: 'Comercios',
  HOSPITALITY: 'Restaurantes y Cafeterías',
  SERVICES: 'Negocios de Servicios',
};

/** Todo lo que conoce el POS: lo que tiene la instancia del gestor de demos (interna). */
const TODOS = [
  'sales', 'customers', 'reports', 'invoicing', 'loyalty', 'inventory', 'purchases', 'suppliers', 'cloud_sync', 'backup',
  'commerce', 'hospitality', 'hospitality.tables', 'hospitality.kds', 'services', 'services.agenda', 'services.orders',
  'operational_surfaces', ...Object.values(SUPERFICIES).map(s => s.ent),
];

/**
 * Evaluador para UN estado de licencia.
 * @param lic { modo, entitlements[], verticals[], screens{}, edition, registers_max }
 */
function crearEvaluador(lic) {
  const ents = new Set(lic?.entitlements || []);
  const modo = lic?.modo || 'NONE';
  const operativo = ['TRIAL', 'ACTIVE', 'GRACE', 'DEMO'].includes(modo);

  function tiene(ent) {
    if (!ent) return true;
    if (!ents.has(ent)) return false;
    if (operativo) return true;
    if (modo === 'SALE_ONLY') return EN_VENTA_ESENCIAL.has(ent);
    return false;
  }

  /** El entitlement que exige un canal protegido (o null si es de venta básica). */
  function requisitoDeCanal(canal, paquete, modulo) {
    if (modulo && POR_MODULO[modulo]) return POR_MODULO[modulo];
    for (const [prefijo, ent] of POR_CANAL) if (String(canal || '').startsWith(prefijo)) return ent;
    if (paquete && POR_PAQUETE[paquete]) return POR_PAQUETE[paquete];
    return null;
  }

  function permiteCanal(canal, paquete, modulo) {
    const req = requisitoDeCanal(canal, paquete, modulo);
    return { ok: tiene(req), requiere: req };
  }

  /** El giro cuya cuota consume una Pantalla Operativa. */
  function giroDeSuperficie(tipo) {
    const s = SUPERFICIES[tipo];
    if (!s) return null;
    const giros = lic?.verticals || [];
    if (!s.cualquierGiro || giros.includes(s.giro)) return s.giro;
    return giros[0] ?? s.giro;
  }

  /** Cuántas pantallas permite un giro (null = ilimitadas, 0 = ninguna). */
  function cuotaDe(giro) {
    const sc = lic?.screens || {};
    if (!(giro in sc)) return 0;
    return sc[giro] === null ? null : Number(sc[giro]) || 0;
  }

  function permiteSuperficie(tipo) {
    const s = SUPERFICIES[tipo];
    return !!s && tiene('operational_surfaces') && tiene(s.ent);
  }

  return {
    modo, tiene, permiteCanal, requisitoDeCanal, permiteSuperficie, giroDeSuperficie, cuotaDe,
    ventaEsencial: modo === 'SALE_ONLY',
    entitlements: [...ents],
    verticals: [...(lic?.verticals || [])],
  };
}

module.exports = { crearEvaluador, SUPERFICIES, GIROS, TODOS, EN_VENTA_ESENCIAL };
