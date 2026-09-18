/**
 * QUIEN PUEDE HACER QUE.
 *
 * POR QUE VIVE EN EL CODIGO Y NO EN LA BASE
 * -----------------------------------------
 * Un permiso no es un dato del negocio: es una parte del producto, igual que
 * las pantallas que protege. Si viviera en SQL, una base de hace un ano
 * describiria mal los permisos de una version nueva y habria que migrar filas
 * en cada entrega. Aqui viaja con el binario, que es lo que de verdad sabe
 * que acciones existen.
 *
 * Lo que SI vive fuera es el rol de cada persona, en `users.rol`. Eso es del
 * negocio y cambia sin actualizar nada.
 *
 * TRES ROLES, SIETE PAQUETES, CERO EXCEPCIONES
 * --------------------------------------------
 * No hay permisos por usuario. Se evaluo anadirlos y se descarto: el unico
 * caso real que resolvian -"este cajero de confianza si puede devolver"- se
 * cubre subiendolo a Encargado, y a cambio traian una tabla, una pantalla, una
 * regla de precedencia y estados que nadie sabe nombrar, como un Encargado con
 * VENTAS_SUPERVISAR retirado.
 *
 * SIN COMODINES
 * -------------
 * Ningun rol salvo Administrador se define por patron. El motivo es concreto:
 * con `servicios.*`, el dia que exista un permiso clinico todos los Encargados
 * lo heredarian sin que nadie lo decidiera. Anadir un paquete obliga a decir
 * quien lo tiene, y la prueba `catalogoCompleto` no deja olvidarlo.
 */

/**
 * LOS SIETE PAQUETES.
 *
 * Uno por decision de negocio, no por boton. Si al anadir una capacidad hacen
 * falta tres paquetes nuevos, el recorte esta mal hecho.
 */
const BUNDLES = {
  /** El trabajo del dia: turno, vender, cobrar, clientes, ticket y factura de venta. */
  VENTAS_OPERAR: 'VENTAS_OPERAR',

  /** Lo que toca dinero ya cobrado: devolver, anular, cajon sin venta, cancelar CFDI. */
  VENTAS_SUPERVISAR: 'VENTAS_SUPERVISAR',

  /** Productos, precios, existencias, conteos, compras, proveedores, presentaciones. */
  INVENTARIO_OPERAR: 'INVENTARIO_OPERAR',

  /** Estadisticas, cortes historicos, reportes y comisiones. */
  REPORTES_VER: 'REPORTES_VER',

  /** El negocio: usuarios, modulos, MultiCaja, respaldos, fiscal, dispositivos. */
  CONFIGURACION_ADMINISTRAR: 'CONFIGURACION_ADMINISTRAR',

  /** Ordenes de servicio y agenda: el trabajo diario del modulo. */
  SERVICIOS_OPERAR: 'SERVICIOS_OPERAR',

  /**
   * La estructura del modulo: catalogo, profesionales, horarios, comisiones.
   *
   * Existe separado de CONFIGURACION_ADMINISTRAR por una razon concreta: un
   * Encargado debe poder dar de alta un servicio o un profesional sin recibir
   * de paso los respaldos, los usuarios y la configuracion fiscal.
   */
  SERVICIOS_ADMINISTRAR: 'SERVICIOS_ADMINISTRAR',
};

const PERMISOS = Object.values(BUNDLES);

/**
 * Los tres roles base. No crecen cuando crece el producto.
 *
 * Los codigos son los que YA estan en `users.rol` de las instalaciones
 * existentes. No se reescriben: cambia como se llaman en pantalla, no lo que
 * hay guardado. Reescribir valores en la base de un cliente para ganar un
 * nombre mas bonito es riesgo sin beneficio.
 */
const ROLES = {
  /** admin -> ADMINISTRADOR. El dueno: decide que es el negocio. */
  admin: '*',

  /** supervisor -> ENCARGADO. Responde de un turno y resuelve excepciones. */
  supervisor: [
    BUNDLES.VENTAS_OPERAR,
    BUNDLES.VENTAS_SUPERVISAR,
    BUNDLES.INVENTARIO_OPERAR,
    BUNDLES.REPORTES_VER,
    BUNDLES.SERVICIOS_OPERAR,
    BUNDLES.SERVICIOS_ADMINISTRAR,
  ],

  /** cajero -> OPERADOR. Atiende: el trabajo del dia y nada mas. */
  cajero: [
    BUNDLES.VENTAS_OPERAR,
    BUNDLES.SERVICIOS_OPERAR,
  ],
};

/** Como se llama cada rol en pantalla. El codigo guardado no cambia. */
const ETIQUETAS = {
  admin: 'Administrador',
  supervisor: 'Encargado',
  cajero: 'Operador',
};

/**
 * Un rol que la base trae y este binario no conoce.
 *
 * NO se mapea al rol mas restringido: se deja SIN NINGUN paquete. Operador
 * puede vender, abrir turno y tocar clientes, asi que asignarlo por omision
 * seria regalar privilegios a un valor que nadie entiende. La persona entra,
 * se identifica, y hasta ahi. Un administrador lo resuelve desde la pantalla
 * de usuarios.
 *
 * Es un estado transitorio de compatibilidad, no un cuarto rol comercial.
 */
const SIN_ROL = 'sin-rol';

function normalizarRol(rol) {
  const r = String(rol || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(ROLES, r) ? r : SIN_ROL;
}

function etiquetaDeRol(rol) {
  return ETIQUETAS[normalizarRol(rol)] || 'Sin rol asignado';
}

function esRolConocido(rol) {
  return normalizarRol(rol) !== SIN_ROL;
}

/**
 * Los paquetes de un rol. Devuelve un Set nuevo en cada llamada: quien lo
 * reciba puede quedarselo sin riesgo de modificar el catalogo por accidente.
 */
function permisosDeRol(rol) {
  const r = normalizarRol(rol);
  if (r === SIN_ROL) return new Set();
  const def = ROLES[r];
  return new Set(def === '*' ? PERMISOS : def);
}

/**
 * OPERACIONES DE ALTO RIESGO.
 *
 * Si la autorizacion no se puede comprobar -por ejemplo porque la base no
 * responde-, estas NO se ejecutan. `VENTAS_OPERAR` y `SERVICIOS_OPERAR` son
 * la excepcion deliberada: una caja con sesion valida y permisos ya
 * comprobados puede seguir vendiendo dentro de la ventana de cache aunque un
 * refresco falle. Dejar de vender por un corte de red de un segundo es un
 * fallo peor que el que se intenta evitar.
 */
const ALTO_RIESGO = new Set([
  BUNDLES.VENTAS_SUPERVISAR,
  BUNDLES.INVENTARIO_OPERAR,
  BUNDLES.CONFIGURACION_ADMINISTRAR,
  BUNDLES.SERVICIOS_ADMINISTRAR,
  BUNDLES.REPORTES_VER,
]);

function esAltoRiesgo(permiso) {
  return ALTO_RIESGO.has(permiso);
}

/**
 * PAQUETES RESERVADOS AL ADMINISTRADOR, dicho a proposito.
 *
 * Administrador se define con `*`, asi que un paquete nuevo lo hereda solo. Sin
 * esta lista, «solo lo tiene el Administrador» y «nadie se acordo de repartirlo»
 * se escriben igual en el catalogo y no hay forma de distinguirlos.
 *
 * Con ella, `catalogoCompleto` puede senalar el paquete que no aparece ni en un
 * rol ni aqui, y la prueba obliga a decidir antes de seguir.
 */
const SOLO_ADMIN = new Set([
  BUNDLES.CONFIGURACION_ADMINISTRAR,
]);

/**
 * Para la prueba que impide anadir un paquete sin decidir quien lo tiene.
 * Devuelve los que no estan ni repartidos ni reservados explicitamente.
 */
function catalogoCompleto() {
  const sinDecidir = PERMISOS.filter(p =>
    !ROLES.supervisor.includes(p) && !ROLES.cajero.includes(p) && !SOLO_ADMIN.has(p));
  return {
    permisos: [...PERMISOS],
    roles: Object.keys(ROLES),
    soloAdmin: [...SOLO_ADMIN],
    sinDecidir,
  };
}

module.exports = {
  BUNDLES, PERMISOS, ROLES, ETIQUETAS, SIN_ROL, ALTO_RIESGO, SOLO_ADMIN,
  normalizarRol, etiquetaDeRol, esRolConocido,
  permisosDeRol, esAltoRiesgo, catalogoCompleto,
};
