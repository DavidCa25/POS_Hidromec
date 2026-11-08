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
 * TRES ROLES Y PAQUETES EXTRA POR PERSONA (0056)
 * ----------------------------------------------
 * Antes no habia permisos por usuario. Se reabrio con casos reales: un Operador
 * de confianza que hace los cortes de los demas, o que configura la impresora
 * cuando se traba la operacion, sin volverse Encargado (que trae devoluciones,
 * reportes e inventario de golpe).
 *
 * La regla que evita los estados raros que motivaron descartarlo:
 *   · los extras SOLO SUMAN. Nadie tiene «Encargado sin VENTAS_SUPERVISAR»;
 *   · solo se otorgan paquetes de OTORGABLES. CONFIGURACION_ADMINISTRAR no:
 *     quien necesita usuarios, respaldos y fiscal es Administrador;
 *   · un rol desconocido no recibe nada, ni sus extras.
 * Los extras viven en `user_permissions` (son del negocio); que paquetes
 * existen y cuales se pueden otorgar sigue viviendo aqui.
 *
 * SIN COMODINES
 * -------------
 * Ningun rol salvo Administrador se define por patron. El motivo es concreto:
 * con `servicios.*`, el dia que exista un permiso clinico todos los Encargados
 * lo heredarian sin que nadie lo decidiera. Anadir un paquete obliga a decir
 * quien lo tiene, y la prueba `catalogoCompleto` no deja olvidarlo.
 */

/**
 * LOS PAQUETES.
 *
 * Uno por decision de negocio, no por boton. Si al anadir una capacidad hacen
 * falta tres paquetes nuevos, el recorte esta mal hecho.
 */
const BUNDLES = {
  /** El trabajo del dia: turno, vender, cobrar, clientes, ticket y factura de venta. */
  VENTAS_OPERAR: 'VENTAS_OPERAR',

  /** Lo que toca dinero ya cobrado: devolver, anular, cajon sin venta, cancelar CFDI. */
  VENTAS_SUPERVISAR: 'VENTAS_SUPERVISAR',

  /**
   * Lo que MUEVE el inventario y el dinero de compras: conteos y ajustes,
   * compras, proveedores y sus pagos, traspasos, dar de baja productos.
   * (Hasta Roles v2 incluia tambien el catalogo; ahora eso es CATALOGO_EDITAR.)
   */
  INVENTARIO_OPERAR: 'INVENTARIO_OPERAR',
  /**
   * Roles v2 · El CATALOGO: dar de alta y editar productos, categorias, marcas,
   * fotos, presentaciones, recetas y modificadores. Es del Operador: no mueve
   * existencias ni dinero. Bajar un precio de mas queda vigilado (alerta).
   */
  CATALOGO_EDITAR: 'CATALOGO_EDITAR',

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

  /**
   * 0056 · Cortes de caja: cerrar el turno de OTRA persona (y autorizarlo).
   * Separado de VENTAS_SUPERVISAR para poder darselo a un Operador sin darle
   * devoluciones ni cancelaciones.
   */
  CAJA_CORTES: 'CAJA_CORTES',

  /**
   * 0056 · El equipo de ESTA caja: impresora, cajon, lector, bascula, pantalla
   * de cliente, teclado en pantalla. Lo que, si falla, para la operacion, sin
   * dar usuarios, respaldos ni datos fiscales.
   */
  CONFIGURACION_EQUIPO: 'CONFIGURACION_EQUIPO',

  /** 0056 · Promociones, combos y precios por canal. */
  COMERCIAL_ADMINISTRAR: 'COMERCIAL_ADMINISTRAR',

  /**
   * 0060 · Produccion por tandas: planear, empezar (salen los ingredientes) y
   * registrar lo que salio, con su merma. Es el trabajo de quien hornea, que
   * suele ser Operador: por eso va aparte de INVENTARIO_OPERAR (ajustes,
   * compras y traspasos), que mueve inventario sin una formula detras.
   */
  PRODUCCION_OPERAR: 'PRODUCCION_OPERAR',
  /**
   * 0071 · Asistencia: ver las horas de todos, asignar horarios, corregir
   * jornadas y exportar. Checar no lo necesita: cada quien checa con su
   * sesion (VENTAS_OPERAR).
   */
  ASISTENCIA_GESTIONAR: 'ASISTENCIA_GESTIONAR',
  /**
   * 0079 · Socios: ver lo de cada socio, liquidar y registrar retiros,
   * pagos y aportaciones. Es dinero de los duenos: solo Administrador, o a
   * quien se le de (un socio que entra como Encargado).
   */
  SOCIOS_GESTIONAR: 'SOCIOS_GESTIONAR',
  /**
   * 0080 · MultiEmpresa: cambiar a otra empresa del grupo y ver Mis
   * empresas. Solo Administrador; se puede OTORGAR a quien cobra para dos
   * empresas en el mismo mostrador. Dar de alta o enlazar empresas sigue
   * siendo CONFIGURACION_ADMINISTRAR.
   */
  EMPRESAS_CAMBIAR: 'EMPRESAS_CAMBIAR',

  /* ---------------------------------------------------------------------
   * PERMISOS POR PERSONA (0077). Lo delicado que se marca con una casilla
   * en «Usuarios y permisos» y lo que se puede VER. Salieron de paquetes
   * grandes (VENTAS_SUPERVISAR, REPORTES_VER) para poder darlos o quitarlos
   * uno por uno, sin volver a nadie Encargado.
   * ------------------------------------------------------------------- */
  /** Devoluciones y cambios. */
  DEVOLUCIONES: 'DEVOLUCIONES',
  /** Retiros de efectivo y egresos (registrar y cancelar). */
  RETIROS_EGRESOS: 'RETIROS_EGRESOS',
  /** Abrir el cajón sin una venta. */
  CAJON_SIN_VENTA: 'CAJON_SIN_VENTA',
  /** Modificar una venta cobrada, cancelar su factura o una comanda enviada. */
  MODIFICAR_VENTA: 'MODIFICAR_VENTA',
  /** Cambiar precios: en la venta y en la ficha del producto. */
  PRECIOS: 'PRECIOS',
  /** Límite de crédito, días y recargos de un cliente, y emitir cupones. */
  CREDITO_CUPONES: 'CREDITO_CUPONES',
  /** VER · Las ventas de los demás (sin él, solo las suyas). */
  VER_VENTAS_TODOS: 'VER_VENTAS_TODOS',
  /** VER · Los números del día: totales de Inicio y el cierre del día. */
  VER_NUMEROS_DIA: 'VER_NUMEROS_DIA',
  /** VER · Costos de productos y lo que se debe a proveedores. */
  VER_COSTOS: 'VER_COSTOS',
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
    BUNDLES.CATALOGO_EDITAR,
    BUNDLES.REPORTES_VER,
    BUNDLES.SERVICIOS_OPERAR,
    BUNDLES.SERVICIOS_ADMINISTRAR,
    // 0056: ya cerraba turnos ajenos y configuraba su equipo; ahora con nombre propio.
    BUNDLES.CAJA_CORTES,
    BUNDLES.CONFIGURACION_EQUIPO,
    // Roles v2: el Encargado tambien da de alta promociones y combos.
    BUNDLES.COMERCIAL_ADMINISTRAR,
    // 0060: produccion por tandas.
    BUNDLES.PRODUCCION_OPERAR,
    // 0071: las horas de su equipo.
    BUNDLES.ASISTENCIA_GESTIONAR,
    // 0077: lo que antes venia dentro de VENTAS_SUPERVISAR y REPORTES_VER.
    BUNDLES.DEVOLUCIONES,
    BUNDLES.RETIROS_EGRESOS,
    BUNDLES.CAJON_SIN_VENTA,
    BUNDLES.MODIFICAR_VENTA,
    BUNDLES.PRECIOS,
    BUNDLES.CREDITO_CUPONES,
    BUNDLES.VER_VENTAS_TODOS,
    BUNDLES.VER_NUMEROS_DIA,
    BUNDLES.VER_COSTOS,
  ],

  /**
   * cajero -> OPERADOR. Atiende y, si hace falta, mantiene el catalogo: da de
   * alta productos, promociones y combos, y hace cortes (el suyo y el de otros).
   * Lo que mueve dinero o inventario del negocio -retiros, egresos,
   * devoluciones, ajustes, compras- lo hace con la autorizacion de un Encargado
   * (PIN en la caja o aprobacion desde la app del dueno). Traspasos, bajas y
   * reportes no.
   */
  cajero: [
    BUNDLES.VENTAS_OPERAR,
    BUNDLES.SERVICIOS_OPERAR,
    BUNDLES.CATALOGO_EDITAR,
    BUNDLES.COMERCIAL_ADMINISTRAR,
    BUNDLES.CAJA_CORTES,
    // 0060: quien hornea registra sus tandas.
    BUNDLES.PRODUCCION_OPERAR,
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
  BUNDLES.SOCIOS_GESTIONAR,
  BUNDLES.EMPRESAS_CAMBIAR,
  BUNDLES.VENTAS_SUPERVISAR,
  BUNDLES.CAJA_CORTES,
  BUNDLES.CONFIGURACION_EQUIPO,
  BUNDLES.COMERCIAL_ADMINISTRAR,
  BUNDLES.INVENTARIO_OPERAR,
  BUNDLES.PRODUCCION_OPERAR,
  BUNDLES.ASISTENCIA_GESTIONAR,
  BUNDLES.CATALOGO_EDITAR,
  BUNDLES.CONFIGURACION_ADMINISTRAR,
  BUNDLES.SERVICIOS_ADMINISTRAR,
  BUNDLES.REPORTES_VER,
  BUNDLES.DEVOLUCIONES,
  BUNDLES.RETIROS_EGRESOS,
  BUNDLES.CAJON_SIN_VENTA,
  BUNDLES.MODIFICAR_VENTA,
  BUNDLES.PRECIOS,
  BUNDLES.CREDITO_CUPONES,
  BUNDLES.VER_VENTAS_TODOS,
  BUNDLES.VER_NUMEROS_DIA,
  BUNDLES.VER_COSTOS,
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
  // 0079: el dinero de los duenos. Se puede OTORGAR a un socio que entra con
  // otro rol, pero ningun rol lo trae.
  BUNDLES.SOCIOS_GESTIONAR,
  // 0080: entrar a otra empresa del dueno. Se OTORGA a un cajero de dos
  // empresas en el mismo mostrador; ningun rol lo trae.
  BUNDLES.EMPRESAS_CAMBIAR,
]);

/**
 * 0056 · Lo que un Administrador puede darle a una persona encima de su rol.
 * CONFIGURACION_ADMINISTRAR no: usuarios, respaldos y fiscal son del rol
 * Administrador, no de un extra.
 */
const OTORGABLES = [
  BUNDLES.SOCIOS_GESTIONAR,
  BUNDLES.EMPRESAS_CAMBIAR,
  BUNDLES.CAJA_CORTES,
  BUNDLES.CONFIGURACION_EQUIPO,
  BUNDLES.INVENTARIO_OPERAR,
  BUNDLES.CATALOGO_EDITAR,
  BUNDLES.COMERCIAL_ADMINISTRAR,
  BUNDLES.VENTAS_SUPERVISAR,
  BUNDLES.REPORTES_VER,
  BUNDLES.SERVICIOS_OPERAR,
  BUNDLES.SERVICIOS_ADMINISTRAR,
  BUNDLES.ASISTENCIA_GESTIONAR,
  // 0077
  BUNDLES.DEVOLUCIONES,
  BUNDLES.RETIROS_EGRESOS,
  BUNDLES.CAJON_SIN_VENTA,
  BUNDLES.MODIFICAR_VENTA,
  BUNDLES.PRECIOS,
  BUNDLES.CREDITO_CUPONES,
  BUNDLES.VER_VENTAS_TODOS,
  BUNDLES.VER_NUMEROS_DIA,
  BUNDLES.VER_COSTOS,
];

/**
 * 0077 · LO QUE SE AJUSTA POR PERSONA en «Usuarios y permisos»: se DA a quien
 * su puesto no lo trae o se QUITA a quien sí. Lo de todos los días (vender,
 * cobrar, clientes, su corte) no se ofrece: quitarlo deja a alguien sin poder
 * trabajar.
 *
 *   HACER  casillas, agrupadas como en la pantalla. pideAutorizacion: sin la
 *          casilla, la operación se pide con el PIN de un encargado o desde la
 *          app del dueño (APROBABLES); si es false, sin la casilla no se puede.
 *   VER    opciones de una sola elección: cada opción es el conjunto de
 *          permisos que da, de menos a más.
 *
 * Un quitado se guarda en user_permissions como «-PERMISO». Una versión
 * anterior lo ignora (no es otorgable), así que nunca da de más.
 */
const HACER = [
  { grupo: 'Dinero', icono: 'ph-money', permisos: [
    [BUNDLES.DEVOLUCIONES, 'Devoluciones y cambios', true],
    [BUNDLES.RETIROS_EGRESOS, 'Retiros y egresos', true],
    [BUNDLES.CAJON_SIN_VENTA, 'Abrir el cajón sin venta', true],
    [BUNDLES.MODIFICAR_VENTA, 'Modificar o cancelar una venta cobrada', true],
    [BUNDLES.CAJA_CORTES, 'Cerrar el corte de otra persona', false],
  ] },
  { grupo: 'Precios y clientes', icono: 'ph-tag', permisos: [
    [BUNDLES.PRECIOS, 'Cambiar precios', true],
    [BUNDLES.COMERCIAL_ADMINISTRAR, 'Promociones y combos', false],
    [BUNDLES.CREDITO_CUPONES, 'Crédito y cupones a clientes', false],
  ] },
  { grupo: 'Inventario y equipo', icono: 'ph-package', permisos: [
    [BUNDLES.INVENTARIO_OPERAR, 'Compras, ajustes y proveedores', true],
    [BUNDLES.CONFIGURACION_EQUIPO, 'Equipo de la caja', false],
    [BUNDLES.ASISTENCIA_GESTIONAR, 'Asistencia del equipo', false],
    [BUNDLES.SOCIOS_GESTIONAR, 'Socios: ver, liquidar y retiros', false],
    [BUNDLES.EMPRESAS_CAMBIAR, 'Cambiar a otra empresa del dueño', false],
  ] },
].map(g => ({ ...g, permisos: g.permisos.map(([clave, nombre, pideAutorizacion]) => ({ clave, nombre, pideAutorizacion })) }));

const VER = [
  { clave: 'ventas', nombre: 'Ventas', icono: 'ph-receipt', opciones: [
    { valor: 'propias', nombre: 'Solo las suyas', permisos: [] },
    { valor: 'todas', nombre: 'De todos', permisos: [BUNDLES.VER_VENTAS_TODOS] },
  ] },
  { clave: 'numeros', nombre: 'Números', icono: 'ph-chart-line',
    ayuda: 'Totales de hoy y cierre del día. «Todo» suma estadísticas, cortes anteriores y reportes.', opciones: [
    { valor: 'nada', nombre: 'Nada', permisos: [] },
    { valor: 'dia', nombre: 'Del día', permisos: [BUNDLES.VER_NUMEROS_DIA] },
    { valor: 'todo', nombre: 'Todo', permisos: [BUNDLES.VER_NUMEROS_DIA, BUNDLES.REPORTES_VER] },
  ] },
  { clave: 'costos', nombre: 'Costos', icono: 'ph-currency-dollar',
    ayuda: 'Costo de los productos y lo que se debe a proveedores.', opciones: [
    { valor: 'ocultos', nombre: 'Ocultos', permisos: [] },
    { valor: 'visibles', nombre: 'Visibles', permisos: [BUNDLES.VER_COSTOS] },
  ] },
];

const AJUSTABLES = [...new Set([
  ...HACER.flatMap(g => g.permisos.map(p => p.clave)),
  ...VER.flatMap(v => v.opciones.flatMap(o => o.permisos)),
])];

/**
 * Paquetes que ANTES traían lo que ahora va aparte. Quien tenía el paquete
 * grande como extra (dado en la 0056) conserva exactamente lo que podía hacer.
 */
const HEREDADOS = {
  [BUNDLES.VENTAS_SUPERVISAR]: [BUNDLES.DEVOLUCIONES, BUNDLES.RETIROS_EGRESOS, BUNDLES.CAJON_SIN_VENTA, BUNDLES.MODIFICAR_VENTA],
  [BUNDLES.REPORTES_VER]: [BUNDLES.VER_NUMEROS_DIA],
};

/** Como se llama cada paquete otorgable en pantalla, y que da. */
const DESCRIPCIONES = {
  CAJA_CORTES: ['Cortes de caja', 'Cerrar el turno de otra persona y autorizarlo.'],
  CONFIGURACION_EQUIPO: ['Equipo de la caja', 'Impresora, cajón, lector, báscula, pantalla de cliente y teclado.'],
  INVENTARIO_OPERAR: ['Movimientos de inventario', 'Conteos y ajustes, compras, proveedores, traspasos y bajas de productos, sin pedir autorización.'],
  CATALOGO_EDITAR: ['Catálogo', 'Dar de alta y editar productos, categorías, recetas y modificadores.'],
  COMERCIAL_ADMINISTRAR: ['Promociones y combos', 'Combos, promociones y precios por canal.'],
  VENTAS_SUPERVISAR: ['Supervisar ventas', 'Devoluciones, retiros, egresos y abrir el cajón sin pedir autorización; autorizar a otros.'],
  REPORTES_VER: ['Reportes', 'Estadísticas, cortes históricos y reportes.'],
  SERVICIOS_OPERAR: ['Órdenes y agenda', 'El trabajo diario de Servicios.'],
  SERVICIOS_ADMINISTRAR: ['Administrar Servicios', 'Catálogo de servicios, profesionales, horarios y comisiones.'],
  PRODUCCION_OPERAR: ['Producción', 'Planear tandas, empezarlas y registrar lo que salió, con su merma.'],
  ASISTENCIA_GESTIONAR: ['Asistencia', 'Ver las horas de todos, asignar horarios, corregir jornadas y exportar.'],
  SOCIOS_GESTIONAR: ['Socios', 'Ver lo de cada socio, liquidar y registrar retiros, pagos y aportaciones.'],
  EMPRESAS_CAMBIAR: ['Otras empresas', 'Cambiar a otra empresa del mismo dueño y ver Mis empresas.'],
  DEVOLUCIONES: ['Devoluciones y cambios', 'Devolver o cambiar sin pedir autorización.'],
  RETIROS_EGRESOS: ['Retiros y egresos', 'Sacar dinero del cajón y registrar gastos sin pedir autorización.'],
  CAJON_SIN_VENTA: ['Abrir el cajón sin venta', 'Abrir el cajón sin un cobro, sin pedir autorización.'],
  MODIFICAR_VENTA: ['Modificar una venta cobrada', 'Corregir o cancelar una venta, su factura o una comanda enviada.'],
  PRECIOS: ['Cambiar precios', 'En la venta y en la ficha del producto.'],
  CREDITO_CUPONES: ['Crédito y cupones', 'Límite de crédito, días y recargos de un cliente; emitir cupones.'],
  VER_VENTAS_TODOS: ['Ventas de todos', 'Ver las ventas de los demás, no solo las suyas.'],
  VER_NUMEROS_DIA: ['Números del día', 'Totales de hoy en Inicio y el cierre del día.'],
  VER_COSTOS: ['Costos', 'Costo de los productos y lo que se debe a proveedores.'],
};

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

/**
 * Los paquetes de UNA PERSONA: los de su rol mas sus extras otorgables. Un
 * extra que no es otorgable (o que ya no existe en esta version) se ignora;
 * un rol desconocido no recibe nada, tampoco sus extras.
 */
function permisosDeUsuario(rol, extras = []) {
  const base = permisosDeRol(rol);
  const r = normalizarRol(rol);
  if (r === SIN_ROL) return base;
  /* El Administrador lo tiene todo: no se le quita nada desde la pantalla. */
  if (ROLES[r] === '*') return base;
  const lista = extras || [];
  for (const p of lista) {
    if (!OTORGABLES.includes(p)) continue;
    base.add(p);
    for (const h of HEREDADOS[p] || []) base.add(h);
  }
  /* 0077 · Quitados: solo los AJUSTABLES. «-VENTAS_OPERAR» no deja a nadie sin vender. */
  for (const p of lista) {
    if (typeof p !== 'string' || !p.startsWith('-')) continue;
    const q = p.slice(1);
    if (AJUSTABLES.includes(q)) base.delete(q);
  }
  /* Ver «Todo» incluye ver lo del día. */
  if (base.has(BUNDLES.REPORTES_VER)) base.add(BUNDLES.VER_NUMEROS_DIA);
  return base;
}

module.exports = {
  BUNDLES, PERMISOS, ROLES, ETIQUETAS, SIN_ROL, ALTO_RIESGO, SOLO_ADMIN, OTORGABLES, DESCRIPCIONES,
  HACER, VER, AJUSTABLES, HEREDADOS,
  normalizarRol, etiquetaDeRol, esRolConocido,
  permisosDeRol, permisosDeUsuario, esAltoRiesgo, catalogoCompleto,
};
