/**
 * QUE PAQUETE EXIGE CADA CANAL.
 *
 * UN MAPA, NO VEINTE `if`
 * -----------------------
 * La alternativa era comprobar el permiso dentro de cada handler. Con setenta
 * operaciones sensibles eso son setenta sitios donde alguien puede olvidarse, y
 * ninguna forma de responder «¿qué protege Wybix?» sin leer el archivo entero.
 *
 * Aquí está la respuesta en una tabla. El proceso principal la usa para
 * autorizar y el renderer para saber qué ofrecer, de modo que la interfaz y la
 * autoridad no pueden contradecirse: salen del mismo sitio.
 *
 * TODO CANAL ESTÁ CLASIFICADO
 * ---------------------------
 * No basta con listar lo protegido: un canal que nadie clasificó es un canal
 * que nadie miró. Por eso hay dos tablas y la prueba `sesion-permisos` exige
 * que cada `ipcMain.handle` del proyecto aparezca exactamente en una. Añadir un
 * canal nuevo sin decidir si es sensible rompe la prueba, que es justo lo que
 * tiene que pasar.
 *
 * `ABIERTOS` no significa «da igual»: cada entrada lleva el motivo por el que
 * exigir permiso ahí sería un error, no un olvido.
 */
const { BUNDLES } = require('./permisos');

const {
  VENTAS_OPERAR, VENTAS_SUPERVISAR, INVENTARIO_OPERAR,
  REPORTES_VER, CONFIGURACION_ADMINISTRAR,
  SERVICIOS_OPERAR, SERVICIOS_ADMINISTRAR,
} = BUNDLES;

/**
 * Canal IPC -> paquete exigido.
 *
 * El orden agrupa por área para que se pueda leer y auditar de un vistazo.
 */
const EXIGE = {
  // ------------------------------------------------------------ venta diaria
  // El trabajo del turno. Un Operador tiene todo esto y nada más.
  'sp-register-sale': VENTAS_OPERAR,
  'sp-open-shift': VENTAS_OPERAR,
  'sp-close-shift': VENTAS_OPERAR,
  'sp-register-cash-out': VENTAS_OPERAR,
  'sp-create-customer': VENTAS_OPERAR,
  'sp-update-customer': VENTAS_OPERAR,
  'sp-register-customer-payment': VENTAS_OPERAR,
  'print-sale-ticket': VENTAS_OPERAR,
  'generate-sale-pdf': VENTAS_OPERAR,
  'fiscal-save-invoice': VENTAS_OPERAR,
  // La caja que atiende reclama y suelta su propio equipo: es operación, no
  // configuración. Liberar el de OTRA caja sí es administrar, y va abajo.
  'register-set-current': VENTAS_OPERAR,
  'register-release': VENTAS_OPERAR,
  // Fidelización en el mostrador: emitir y canjear mueven saldo del cliente.
  'coupons:issue': VENTAS_OPERAR,
  'coupons:redeem': VENTAS_OPERAR,
  'loyalty:evaluate-sale': VENTAS_OPERAR,
  'dynamics:play': VENTAS_OPERAR,
  // Terminal de cobro: crear y cancelar una orden PENDIENTE es parte del
  // cobro. Devolver una ya cobrada no está aquí, está en VENTAS_SUPERVISAR.
  'mp-create-order': VENTAS_OPERAR,
  'mp-cancel-order': VENTAS_OPERAR,
  'mp-simulate-order': VENTAS_OPERAR,

  // -------------------------------------------------------- dinero ya cobrado
  // Devolver, anular y abrir el cajón sin venta son las tres operaciones contra
  // las que nació el blindaje anti robo hormiga. Siguen admitiendo autorización
  // presencial: si quien opera no las tiene, otra persona con el paquete puede
  // autorizarlas con sus credenciales, y las dos identidades quedan registradas.
  'sp-refund-sale': VENTAS_SUPERVISAR,
  'sp-update-sale': VENTAS_SUPERVISAR,
  'open-cash-drawer': VENTAS_SUPERVISAR,
  'fiscal-cancel-invoice': VENTAS_SUPERVISAR,
  // Un sorteo reparte premio: quien lo cierra o lo celebra responde de él.
  'raffles:draw': VENTAS_SUPERVISAR,
  'raffles:close': VENTAS_SUPERVISAR,

  // --------------------------------------------------------------- inventario
  'sp-add-product': INVENTARIO_OPERAR,
  'sp-update-product': INVENTARIO_OPERAR,
  'sp-delete-product': INVENTARIO_OPERAR,
  'sp-add-brand': INVENTARIO_OPERAR,
  'sp-add-category': INVENTARIO_OPERAR,
  'inventory:apply-count': INVENTARIO_OPERAR,
  'sp-register-purchase': INVENTARIO_OPERAR,
  'sp-register-supplier-payment': INVENTARIO_OPERAR,
  'sp-pay-supplier': INVENTARIO_OPERAR,
  'sp-add-supplier': INVENTARIO_OPERAR,
  'sp-supplier-save': INVENTARIO_OPERAR,
  'sp-upsert-product-supplier': INVENTARIO_OPERAR,
  'sp-remove-product-supplier': INVENTARIO_OPERAR,
  'sp-set-product-default-supplier': INVENTARIO_OPERAR,
  'presentations:save': INVENTARIO_OPERAR,
  'presentations:delete': INVENTARIO_OPERAR,
  'images:set': INVENTARIO_OPERAR,
  'images:sync': INVENTARIO_OPERAR,
  // Una receta decide cuánto se descuenta de existencias al vender, y un grupo
  // de modificadores cambia lo que se cobra: los dos mueven inventario o precio
  // de forma indirecta, así que van con inventario y no con configuración.
  'recipes:save': INVENTARIO_OPERAR,
  'recipes:delete': INVENTARIO_OPERAR,
  'modifiers:save': INVENTARIO_OPERAR,
  'modifiers:delete': INVENTARIO_OPERAR,
  'modifiers:set-product-groups': INVENTARIO_OPERAR,

  // ------------------------------------------------------------------ reportes
  // Solo lo que enseña el dinero del negocio o señala a una persona. Las
  // consultas que el mostrador necesita para trabajar —su turno, sus ventas,
  // el catálogo— se quedan abiertas: exigirles permiso convertiría la pantalla
  // del Operador en una pantalla de errores.
  'export-sales-pdf': REPORTES_VER,
  'sp-cash-summary': REPORTES_VER,
  'sp-get-profit-overview': REPORTES_VER,
  'sp-dead-products': REPORTES_VER,
  'security:by-cashier': REPORTES_VER,
  'security:risk': REPORTES_VER,
  'alerts:refunds-by-cashier': REPORTES_VER,

  // ------------------------------------------------------------ configuración
  'users:list': CONFIGURACION_ADMINISTRAR,
  'users:create': CONFIGURACION_ADMINISTRAR,
  'users:update-role': CONFIGURACION_ADMINISTRAR,
  'users:reset-password': CONFIGURACION_ADMINISTRAR,
  'users:set-active': CONFIGURACION_ADMINISTRAR,
  'modules:set': CONFIGURACION_ADMINISTRAR,
  'update-business-config': CONFIGURACION_ADMINISTRAR,
  'backup-set-config': CONFIGURACION_ADMINISTRAR,
  'backup-run-now': CONFIGURACION_ADMINISTRAR,
  'export-database': CONFIGURACION_ADMINISTRAR,
  'import-database': CONFIGURACION_ADMINISTRAR,
  'registers-add': CONFIGURACION_ADMINISTRAR,
  'registers-set-active': CONFIGURACION_ADMINISTRAR,
  'register-release-admin': CONFIGURACION_ADMINISTRAR,
  'fiscal-save-config': CONFIGURACION_ADMINISTRAR,
  'fiscal-set-issuer-ref': CONFIGURACION_ADMINISTRAR,
  'devices:set-config': CONFIGURACION_ADMINISTRAR,
  'payments:set': CONFIGURACION_ADMINISTRAR,
  'cloud-set-config': CONFIGURACION_ADMINISTRAR,
  'cloud-set-anon-key': CONFIGURACION_ADMINISTRAR,
  'cloud-ensure-provisioned': CONFIGURACION_ADMINISTRAR,
  'cloud-push-now': CONFIGURACION_ADMINISTRAR,
  'cloud-delete-account': CONFIGURACION_ADMINISTRAR,
  'mp-set-config': CONFIGURACION_ADMINISTRAR,
  'mp-set-pdv': CONFIGURACION_ADMINISTRAR,
  'mp-create-pos': CONFIGURACION_ADMINISTRAR,
  'mp-create-store': CONFIGURACION_ADMINISTRAR,
  'mp-validate-token': CONFIGURACION_ADMINISTRAR,
  // MultiCaja: preparar el equipo servidor y enseñar la contraseña de SQL en
  // claro. Esto vive en el panel de red, que solo se abre con sesión iniciada.
  'network:prepare': CONFIGURACION_ADMINISTRAR,
  'network:reveal-password': CONFIGURACION_ADMINISTRAR,
  // Arrancar y parar el servicio de SQL Server desde el panel de red.
  'services:set-config': CONFIGURACION_ADMINISTRAR,
  'services:operate': CONFIGURACION_ADMINISTRAR,
  'services:clear': CONFIGURACION_ADMINISTRAR,
  // Actualizar reinicia la aplicación: no en mitad de un turno ajeno.
  'download-update': CONFIGURACION_ADMINISTRAR,
  'install-update': CONFIGURACION_ADMINISTRAR,
  // Cargas masivas. Escriben miles de filas de una vez y se hacen una vez.
  'sp-import-products': CONFIGURACION_ADMINISTRAR,
  'sp-import-customers': CONFIGURACION_ADMINISTRAR,
  'sp-import-suppliers': CONFIGURACION_ADMINISTRAR,
  'sp-import-sales': CONFIGURACION_ADMINISTRAR,
  // Definir una campaña o un sorteo es decidir cuánto regala el negocio.
  'loyalty:save-campaign': CONFIGURACION_ADMINISTRAR,
  'loyalty:save-definition': CONFIGURACION_ADMINISTRAR,
  'dynamics:save-segment': CONFIGURACION_ADMINISTRAR,
  'raffles:save': CONFIGURACION_ADMINISTRAR,

  // ------------------------------------------------------------- Servicios
  // El trabajo del dia: abrir la orden, anotar lo que se hizo, agendar. Un
  // Operador lo tiene, igual que tiene vender.
  'servicios:orden-crear': SERVICIOS_OPERAR,
  'servicios:orden-actualizar': SERVICIOS_OPERAR,
  'servicios:orden-estado': SERVICIOS_OPERAR,
  'servicios:orden-cancelar': SERVICIOS_OPERAR,
  'servicios:orden-autorizar': SERVICIOS_OPERAR,
  'servicios:linea-agregar': SERVICIOS_OPERAR,
  'servicios:linea-actualizar': SERVICIOS_OPERAR,
  'servicios:orden-enlazar-venta': SERVICIOS_OPERAR,
  'servicios:guardar-activo': SERVICIOS_OPERAR,
  'servicios:activar-activo': SERVICIOS_OPERAR,
  'servicios:cita-guardar': SERVICIOS_OPERAR,
  'servicios:cita-estado': SERVICIOS_OPERAR,
  'servicios:cita-reprogramar': SERVICIOS_OPERAR,
  'servicios:cita-a-orden': SERVICIOS_OPERAR,

  // La ESTRUCTURA del modulo: que se ofrece, quien lo hace y cuanto cobra.
  // Separado de CONFIGURACION_ADMINISTRAR por una razon concreta: un Encargado
  // debe poder dar de alta un servicio o un profesional sin recibir de paso
  // los respaldos, los usuarios y la configuracion fiscal.
  'servicios:guardar-servicio': SERVICIOS_ADMINISTRAR,
  'servicios:activar-servicio': SERVICIOS_ADMINISTRAR,
  'servicios:asignar-profesionales': SERVICIOS_ADMINISTRAR,
  'servicios:guardar-profesional': SERVICIOS_ADMINISTRAR,
  'servicios:activar-profesional': SERVICIOS_ADMINISTRAR,
  'servicios:guardar-horario': SERVICIOS_ADMINISTRAR,
  'servicios:guardar-ausencia': SERVICIOS_ADMINISTRAR,
  'servicios:borrar-ausencia': SERVICIOS_ADMINISTRAR,

  // Elegir el giro ENCIENDE el modulo, y encender modulos ya exigia
  // CONFIGURACION_ADMINISTRAR en 'modules:set'. Bajarlo aqui a
  // SERVICIOS_ADMINISTRAR no seria un permiso mas fino: seria la misma
  // puerta con una cerradura peor, abierta a quien no puede usar la otra.
  'servicios:elegir-giro': CONFIGURACION_ADMINISTRAR,

  // Cuanto gano cada persona es dinero del negocio, y va con los reportes.
  'servicios:comisiones': REPORTES_VER,
};

/**
 * CANALES DELIBERADAMENTE ABIERTOS, con el motivo.
 *
 * Existe para que la prueba de cobertura pueda distinguir «decidido que no» de
 * «nadie lo miró». El motivo no es documentación de cortesía: es lo que permite
 * revisar la decisión dentro de un año sin reconstruir el razonamiento.
 */
const ABIERTOS = {
  // --- Antes de que exista sesión -----------------------------------------
  // El asistente de primera ejecución corre cuando todavía no hay usuarios, y
  // la licencia se activa antes de poder iniciar sesión. Exigir permiso aquí
  // haría imposible instalar Wybix.
  'setup-status': 'primera ejecución: aún no hay usuarios',
  'setup-inicial': 'primera ejecución: crea al primer administrador',
  'setup-run': 'primera ejecución: prepara la base',
  'setup-normalizar-servidor': 'primera ejecución: corrige el nombre del servidor',
  'db-status': 'diagnóstico de conexión, disponible sin sesión',
  'db-get-connection': 'diagnóstico de conexión, disponible sin sesión',
  'db-set-connection': 'el asistente configura la conexión antes de que haya usuarios',
  'db-reconnect': 'reintento de conexión: sin base no hay a quién preguntar permisos',
  'license:get': 'la licencia se consulta antes del login',
  'license:status': 'la licencia se consulta antes del login',
  'license:save': 'la licencia se activa antes del login',
  'license:activate': 'la licencia se activa antes del login',
  'license:clear': 'parte del mismo flujo de licencia, sin sesión',
  'license:start-trial': 'la prueba gratuita empieza antes del login',
  'get-machine-id': 'identificador del equipo, necesario para licenciar sin sesión',
  'network:diagnose': 'diagnóstico de red, disponible sin sesión',
  'services:validate': 'comprueba el servicio de SQL durante la instalación',
  'services:get-config': 'lectura del servicio de SQL durante la instalación',
  'sp-iniciar-sesion': 'ES el login: exigir sesión sería circular',

  // --- Ventanas que no son la principal ------------------------------------
  // Tienen su propio preload y nunca inician sesión. No pueden autorizar nada
  // porque no tienen identidad, y ese es justamente el blindaje.
  'app:es-demo': 'ventana de demo, sin sesión por diseño',
  'app:get-version': 'dato de versión, sin identidad',
  'getConfig': 'configuración de arranque de la ventana',
  'demo:estado': 'gestor de demos: ventana aparte, sin sesión',
  'demo:crear': 'gestor de demos: ventana aparte, sin sesión',
  'demo:abrir': 'gestor de demos: ventana aparte, sin sesión',
  'demo:eliminar': 'gestor de demos: ventana aparte, sin sesión',
  'demo:restablecer': 'gestor de demos: ventana aparte, sin sesión',
  'customer-display:open': 'pantalla de cliente: no toca datos',
  'customer-display:close': 'pantalla de cliente: no toca datos',
  'customer-display:state': 'pantalla de cliente: solo pinta el ticket en curso',
  'customer-display:status': 'pantalla de cliente: lectura',
  'customer-display:list-monitors': 'pantalla de cliente: lectura del hardware',
  'customer-display:preview-open': 'vista previa de la pantalla de cliente',
  'customer-display:preview-close': 'vista previa de la pantalla de cliente',
  'customer:action': 'lo emite la pantalla de cliente, que no tiene sesión',
  'customer:get-business': 'datos del negocio para la pantalla de cliente',

  // --- La sesión misma -----------------------------------------------------
  'auth:sesion': 'devuelve la sesión: preguntarla no requiere tenerla',
  'auth:cerrar-sesion': 'cerrar sesión no puede depender de tener permisos',
  'security:authorize': 'valida credenciales de un tercero; comprueba el paquete por dentro',
  'security:log': 'registrar lo ocurrido no puede fallar por permisos',
  'security:catalogo': 'el catálogo que la interfaz necesita para pintarse',
  'security:modelo': 'versión del modelo de seguridad, para avisar de desajustes',

  // --- Lecturas ------------------------------------------------------------
  // Catálogo, existencias, estado del turno y del equipo. Lo que el mostrador
  // necesita para trabajar. Exigirles permiso solo convertiría una pantalla
  // vacía en un error.
  'sp-get-products': 'lectura de catálogo',
  'sp-get-active-products': 'lectura de catálogo',
  'sp-Consultar-Detalle-Productos': 'lectura de catálogo',
  'sp-get-brands': 'lectura de catálogo',
  'sp-get-categories': 'lectura de catálogo',
  'sp-get-product-suppliers': 'lectura de catálogo',
  'sp-get-product-default-supplier': 'lectura de catálogo',
  'sp-get-suppliers': 'lectura de catálogo',
  'sp-get-suppliers-account': 'lectura de cuentas por pagar',
  'sp-get-supplier-account-detail': 'lectura de cuentas por pagar',
  'sp-get-purchases': 'lectura de compras',
  'get-next-purchase-folio': 'lectura del siguiente folio',
  'sp-get-customers': 'lectura de clientes',
  'sp-get-customer': 'lectura de clientes',
  'sp-get-customers-summary': 'lectura de clientes',
  'sp-get-credit-customers': 'lectura de clientes a crédito',
  'sp-get-customer-open-sales': 'lectura de saldos del cliente',
  'sp-customers-kpis': 'lectura de clientes',
  'sp-top-customers': 'lectura de clientes',
  'sp-get-sales': 'lectura de ventas: el mostrador reimprime y consulta',
  'sp-get-sale-by-folio': 'lectura de ventas: el mostrador reimprime y consulta',
  'sp-get-actual-folio': 'lectura del folio en curso',
  'sp-get-open-shift': 'lectura del turno propio',
  'sp-get-cash-movements': 'lectura del turno propio',
  'sp-get-total-sales-today': 'lectura del propio mostrador',
  'sp-get-total-sales-month': 'lectura del propio mostrador',
  'sp-get-total-orders': 'lectura del propio mostrador',
  'sp-get-daily-sales-last-7-days': 'lectura del propio mostrador',
  'sp-get-daily-sales-current-month': 'lectura del propio mostrador',
  'sp-get-top-selling-products': 'lectura del propio mostrador',
  'sp-sales-by-payment': 'lectura del propio mostrador',
  'sp-get-active-users': 'lista de nombres para elegir cajero en el turno',
  'sp-get-user-by-id': 'nombre del usuario para pintarlo',
  'alerts:counts': 'avisos operativos del día',
  'alerts:low-stock': 'avisos operativos del día',
  'alerts:out-of-stock': 'avisos operativos del día',
  'alerts:reorder': 'avisos operativos del día',
  'alerts:overdue-credit': 'avisos operativos del día',
  'alerts:zero-sales': 'avisos operativos del día',
  'alerts:cash-closures': 'avisos operativos del día',
  'catalog:menu': 'lectura del menú de Hospitality',
  'catalog:uoms': 'lectura de unidades de medida',
  'catalog:ingredients': 'lectura de ingredientes',
  'recipes:get': 'lectura de recetas',
  'modifiers:list': 'lectura de modificadores',
  'presentations:list': 'lectura de presentaciones',
  'hospitality:availability': 'lectura de disponibilidad',
  'loyalty:catalog': 'lectura de fidelización',
  'loyalty:instances': 'lectura de fidelización',
  'coupons:validate': 'comprueba un cupón sin consumirlo',
  'dynamics:pending': 'lectura de dinámicas',
  'dynamics:segments': 'lectura de dinámicas',
  'raffles:detail': 'lectura de sorteos',
  'raffles:winner-status': 'lectura de sorteos',
  'fiscal-get-config': 'lectura de configuración fiscal, sin secretos',
  'fiscal-get-invoices': 'lectura de facturas emitidas',
  'fiscal-get-invoices-counts': 'lectura de facturas emitidas',
  'fiscal-get-invoice-files-data': 'descarga del PDF y XML que ya se emitieron',
  'backup-get-config': 'lectura de la configuración de respaldo',
  'backup-list': 'lectura de los respaldos existentes',
  'backup-open-folder': 'abre una carpeta: no lee ni escribe datos',
  'devices:get-config': 'lectura de impresoras y cajón configurados',
  'devices:list-printers': 'lectura del hardware del equipo',
  'devices:list-serial-ports': 'lectura del hardware del equipo',
  'cloud-get-config': 'lectura de la configuración de nube, sin secretos',
  'cloud-get-pairing': 'código de vinculación de la app del dueño',
  'mp-get-config': 'lectura de la configuración de terminal',
  'mp-get-order': 'lectura del estado de un cobro en curso',
  'mp-list-terminals': 'lectura de terminales disponibles',
  'payments:get': 'lectura de formas de pago',
  'registers-list': 'lectura de cajas registradas',
  'registers-assignments': 'lectura de asignaciones de caja',
  'register-get-current': 'lectura de la caja de este equipo',
  'register-lease-status': 'lectura del arriendo de este equipo',
  'modules:list': 'lectura de módulos activos: la interfaz la necesita al entrar',
  'check-for-updates': 'consulta si hay versión nueva; instalarla sí exige permiso',
  'logs-info': 'lectura de la bitácora técnica',
  'logs-open-folder': 'abre una carpeta: no lee ni escribe datos',
  'open-external': 'abre un enlace en el navegador',
  'files:save-bytes': 'guarda en disco lo que el renderer ya generó, con diálogo',

  // --- Lecturas del módulo Servicios ---------------------------------------
  // El mostrador consulta el catálogo, la agenda del día y la orden que tiene
  // delante. Exigirles permiso convertiría la pantalla de un Operador con
  // SERVICIOS_OPERAR en una pantalla de errores justo donde trabaja.
  'servicios:catalogo': 'lectura del catálogo de servicios',
  'servicios:giros': 'el catálogo de giros no toca la base: sale de presets.json, y la pantalla que ofrece elegir uno lo necesita antes de que nadie pulse nada',
  'servicios:config': 'saber si este negocio es un taller o una estética no es información sensible, y el módulo necesita cómo llamarse para dibujarse',
  'servicios:activos': 'lectura de los activos del cliente: el coche, la mascota',
  'servicios:profesionales': 'lectura de quién hace el trabajo',
  'servicios:horario': 'lectura de horarios y ausencias',
  'servicios:ordenes': 'lectura del tablero de órdenes',
  'servicios:orden': 'lectura de una orden',
  'servicios:cobro-previa': 'qué habría que cobrar: no cobra nada',
  'servicios:citas': 'lectura de la agenda de un rango',
  'servicios:cita': 'lectura de una cita',
  'servicios:disponibilidad': 'huecos libres: la pregunta del teléfono',
};

/** El paquete que exige un canal, o `null` si no es una operación sensible. */
function exigePara(canal) {
  return Object.prototype.hasOwnProperty.call(EXIGE, canal) ? EXIGE[canal] : null;
}

/** Todos los canales protegidos. Para la prueba de cobertura. */
function canalesProtegidos() {
  return Object.keys(EXIGE);
}

/** ¿Este canal está clasificado, de una forma o de otra? */
function estaClasificado(canal) {
  return Object.prototype.hasOwnProperty.call(EXIGE, canal)
      || Object.prototype.hasOwnProperty.call(ABIERTOS, canal);
}

module.exports = { EXIGE, ABIERTOS, exigePara, canalesProtegidos, estaClasificado };
