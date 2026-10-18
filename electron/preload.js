const { contextBridge, ipcRenderer, webUtils } = require('electron');

/*
 * ROLES V2 · OPERACIONES QUE SE APRUEBAN.
 *
 * Cuando el proceso principal contesta «esto necesita autorización»
 * (`requiereAutorizacion` + `aprobable`), la pantalla no tiene que saberlo de
 * antemano: aquí se le pide a la ventana que muestre el diálogo (PIN de un
 * encargado, o pedírselo al dueño en su app) y, con el comprobante, la MISMA
 * operación se repite una vez. El comprobante es de un solo uso y lo valida el
 * proceso principal: lo que vuelva por aquí no da autoridad por sí mismo.
 *
 * El diálogo vive en Angular (AutorizacionService). Se habla con él por
 * `postMessage` porque el preload corre en otro mundo de JavaScript.
 */
let siguienteSolicitud = 0;
const esperandoAutorizacion = new Map();
if (typeof window !== 'undefined') window.addEventListener('message', (e) => {
  const d = e.data;
  if (e.source !== window || !d || d.tipo !== 'wx-autorizacion-respuesta') return;
  const resolver = esperandoAutorizacion.get(d.id);
  if (resolver) { esperandoAutorizacion.delete(d.id); resolver(typeof d.autorizacion === 'string' ? d.autorizacion : null); }
});
/** Solo lo legible y corto del payload: para el resumen que ve quien aprueba. */
function resumenDePayload(p) {
  if (!p || typeof p !== 'object') return null;
  const r = {};
  for (const k of ['amount', 'monto', 'total', 'refundAmount', 'note', 'nota', 'concepto', 'reason', 'motivo', 'nombre', 'name', 'sale_id', 'saleId']) {
    const v = p[k];
    if (v != null && (typeof v === 'number' || (typeof v === 'string' && v.length <= 200))) r[k] = v;
  }
  return r;
}
function pedirAutorizacion(respuesta, payload) {
  const id = ++siguienteSolicitud;
  return new Promise((resolve) => {
    esperandoAutorizacion.set(id, resolve);
    window.postMessage({ tipo: 'wx-autorizacion-pedir', id, canal: respuesta.canal, accion: respuesta.accion,
      motivo: respuesta.error, detalle: respuesta.detalle || null, payload: resumenDePayload(payload) }, '*');
  });
}
async function invoke(canal, ...args) {
  const r = await ipcRenderer['invoke'](canal, ...args);
  const primero = args[0];
  const objeto = primero == null || (typeof primero === 'object' && !Array.isArray(primero));
  if (!r || !r.requiereAutorizacion || !r.aprobable || !objeto) return r;
  const autorizacion = await pedirAutorizacion(r, primero);
  if (!autorizacion) return { ...r, cancelado: true, error: 'No se hizo: faltó la autorización.' };
  return ipcRenderer['invoke'](canal, { ...(primero || {}), autorizacion }, ...args.slice(1));
}

contextBridge.exposeInMainWorld('electronAPI', {
    makeSale: (data) => ipcRenderer.send('make-sale', data),
    onSaleResult: (callback) => ipcRenderer.on('sale-result', (event, data) => callback(data)),
    iniciarSesion: (usuario, contrasena) => invoke('sp-iniciar-sesion', { usuario, contrasena }),
    /* Apuntaba a `sp-add-user`, un canal SIN handler: la llamada moria en
       "No handler registered" y la pantalla de alta no daba de alta a nadie.
       El camino real es `users:create`, que ademas valida el rol. */
    crearUsuario: (usuario, password, rol) =>
        invoke('users:create', { usuario, password, rol }),

    consultarDetallesProducto: (CategoryID) => invoke('sp-Consultar-Detalle-Productos', CategoryID),
    // `control` es opcional y va al final: inventory_mode, sellable, base_uom,
    // allow_decimal_qty y cost. El procedimiento ya los aceptaba desde el
    // dominio Hospitality, pero este canal no los pasaba, asi que todo producto
    // nacia DIRECT/vendible/pza. Omitirlo deja exactamente el Retail de antes.
    agregarProducto: (brand, category, partNumber, name, price, stock, claveProdServ, claveUnidad, objetoImpuesto, tasaIva, barCode, control) =>
        invoke('sp-add-product', brand, category, partNumber, name, price, stock, claveProdServ, claveUnidad, objetoImpuesto, tasaIva, barCode, control),
    getCategories: () => invoke('sp-get-categories'),
    getBrands: () => invoke('sp-get-brands'),
    getActiveProducts: () => invoke('sp-get-active-products'),
    /* ---------------------------------------------------------- QUICKSTART
       La carga inicial del catalogo. Una carga es un objeto que vive en la
       base: se puede cerrar Wybix a media captura y seguir manana. */
    /* La RUTA de un archivo que el usuario eligio o solto.
       Electron 32 quito `File.path`; `webUtils.getPathForFile` es su
       sustituto y tiene que vivir en el preload, porque `webUtils` no
       existe en el renderer aislado. Sin esto el proceso principal no
       sabria que archivo leer. */
    qsRutaDeArchivo: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
    qsContexto: () => invoke('quickstart:contexto'),
    qsCargas: (p) => invoke('quickstart:cargas', p),
    qsCarga: (p) => invoke('quickstart:carga', p),
    qsFilas: (p) => invoke('quickstart:filas', p),
    qsAnalizarArchivo: (p) => invoke('quickstart:analizar-archivo', p),
    qsAnalizarPegado: (p) => invoke('quickstart:analizar-pegado', p),
    qsOtraHoja: (p) => invoke('quickstart:otra-hoja', p),
    qsRemapear: (p) => invoke('quickstart:remapear', p),
    qsCargaManual: (p) => invoke('quickstart:carga-manual', p),
    qsCapturar: (p) => invoke('quickstart:capturar', p),
    qsResolverGrupo: (p) => invoke('quickstart:resolver-grupo', p),
    qsResolverFila: (p) => invoke('quickstart:resolver-fila', p),
    qsEjecutar: (p) => invoke('quickstart:ejecutar', p),
    qsUndoCheck: (p) => invoke('quickstart:undo-check', p),
    qsUndo: (p) => invoke('quickstart:undo', p),
    qsSoltarSiVacia: (p) => invoke('quickstart:soltar-si-vacia', p),
    qsDescartar: (p) => invoke('quickstart:descartar', p),
    qsGuardarPerfil: (p) => invoke('quickstart:guardar-perfil', p),
    qsLeerHoja: (p) => invoke('quickstart:leer-hoja', p),
    qsPlantilla: (p) => invoke('quickstart:plantilla', p),
    negocioGiro: () => invoke('negocio:giro'),
    // MultiSucursal
    multiEstado: () => invoke('multi:estado'),
    multiPublicar: () => invoke('multi:publicar'),
    multiRecibir: () => invoke('multi:recibir'),
    multiExcepciones: (p) => invoke('multi:excepciones', p),
    multiExcepcionesGuardar: (p) => invoke('multi:excepciones-guardar', p),
    multiReglasGuardar: (p) => invoke('multi:reglas-guardar', p),
    multiUsuarios: () => invoke('multi:usuarios'),
    multiUsuarioAlcance: (p) => invoke('multi:usuario-alcance', p),
    multiTraspasos: () => invoke('multi:traspasos'),
    multiTraspasoEnviar: (p) => invoke('multi:traspaso-enviar', p),
    multiTraspasoRecibir: (p) => invoke('multi:traspaso-recibir', p),
    multiTraspasoCancelar: (p) => invoke('multi:traspaso-cancelar', p),
    multiProductosTraspaso: () => invoke('multi:productos-traspaso'),
    negocioGiroGuardar: (p) => invoke('negocio:giro-guardar', p),
    /* El avance real de una importacion larga. Se escucha, no se sondea. */
    qsAlAvanzar: (fn) => {
      const h = (_e, d) => fn(d);
      ipcRenderer.on('quickstart:avance', h);
      return () => ipcRenderer.removeListener('quickstart:avance', h);
    },

    importProducts: (payload) => invoke('sp-import-products', payload),
    importCustomers: (payload) => invoke('sp-import-customers', payload),
    importSuppliers: (payload) => invoke('sp-import-suppliers', payload),
    importSales: (payload) => invoke('sp-import-sales', payload),
    getSuppliersAccount: () => invoke('sp-get-suppliers-account'),
    getSupplierAccountDetail: (payload) => invoke('sp-get-supplier-account-detail', payload),
    supplierSave: (payload) => invoke('sp-supplier-save', payload),
    topCustomers: (payload) => invoke('sp-top-customers', payload),
    salesByPayment: (payload) => invoke('sp-sales-by-payment', payload),
    deadProducts: (payload) => invoke('sp-dead-products', payload),
    cashSummary: (payload) => invoke('sp-cash-summary', payload),
    customersKpis: () => invoke('sp-customers-kpis'),
    // Acepta la forma antigua (posicional) y la nueva (un objeto con lineas,
    // modificadores y service_mode). Ver 'sp-register-sale' en main.js.
    registerSale: (userId, paymentMethod, items, customerId, dueDate, registerId) =>
        invoke('sp-register-sale', userId, paymentMethod, items, customerId, dueDate, registerId),
    registerSaleV2: (intent) => invoke('sp-register-sale', intent),

    getSuppliers: () => invoke('sp-get-suppliers'),
    getNextPurchaseFolio: () => invoke('get-next-purchase-folio'),
    registerPurchase: (payload) => invoke('sp-register-purchase', payload),
    getPurchases: () => invoke('sp-get-purchases'),
    getUserById: (userId) => invoke('sp-get-user-by-id', userId),

    getTopSellingProducts: () => invoke('sp-get-top-selling-products'),
    getSalesMonthly: () => invoke('sp-get-total-sales-month'),
    getSalesDayly: () => invoke('sp-get-total-sales-today'),
    getTotalOrders: () => invoke('sp-get-total-orders'),
    getCashMovements: (opts) => invoke('sp-get-cash-movements', opts),

    getCustomers: () => invoke('sp-get-customers'),
    getCreditCustomers: () => invoke('sp-get-credit-customers'),
    getCustomersSummary: () => invoke('sp-get-customers-summary'),
    createCustomer: (code, customerName, taxId, email, phone, creditLimit, termsDays, active, regimenFiscal, usoCfdi, razonSocial, graceDays, lateFeePct, lateFeeFixed, riskLevel) => 
    invoke(
      'sp-create-customer', 
      code, customerName, taxId, email, phone, creditLimit, termsDays, active, regimenFiscal, usoCfdi, razonSocial, graceDays, lateFeePct, lateFeeFixed, riskLevel
    ),

    updateCustomer: (id, code, customerName, taxId, email, phone, creditLimit, termsDays, active, regimenFiscal, usoCfdi, razonSocial, graceDays, lateFeePct, lateFeeFixed, riskLevel) => 
    invoke(
      'sp-update-customer', 
      id, code, customerName, taxId, email, phone, creditLimit, termsDays, active, regimenFiscal, usoCfdi, razonSocial, graceDays, lateFeePct, lateFeeFixed, riskLevel
    ),
    getCustomerOpenSales: (customerId) =>
    invoke('sp-get-customer-open-sales', customerId),
    registerCustomerPayment: (customerId, saleId, amount, userId, paymentMethod, note) =>
        invoke('sp-register-customer-payment',
        customerId, saleId, amount, userId, paymentMethod, note),
    openCashDrawer: (opts) => invoke('open-cash-drawer', opts),
    getDailySalesLast7Days: () => invoke('sp-get-daily-sales-last-7-days'),
    getDailySalesCurrentMonth: () =>
        invoke('sp-get-daily-sales-current-month'),
    getProfitOverview: (fromDate, toDate) =>
        invoke('sp-get-profit-overview', { fromDate, toDate }),
    // Sin console.log: el payload lleva el comprobante de autorización.
    closeShift: (payload) => invoke('sp-close-shift', payload),

    getActiveUsers: () => invoke('sp-get-active-users'),
    alertsReorder: (p) => invoke('alerts:reorder', p),
    alertsOutOfStock: () => invoke('alerts:out-of-stock'),
    alertsZeroSales: (p) => invoke('alerts:zero-sales', p),
    alertsCashClosures: (p) => invoke('alerts:cash-closures', p),
    alertsRefundsByCashier: () => invoke('alerts:refunds-by-cashier'),
    alertsOverdueCredit: () => invoke('alerts:overdue-credit'),
    alertsLowStock: (p) => invoke('alerts:low-stock', p),
    alertsCounts: (p) => invoke('alerts:counts', p),
    inventoryMovements: (p) => invoke('inventory:movements', p),
    inventoryApplyCount: (p) => invoke('inventory:apply-count', p),
    usersList: () => invoke('users:list'),
    usersCreate: (p) => invoke('users:create', p),
    usersUpdateRole: (p) => invoke('users:update-role', p),
    usersResetPassword: (p) => invoke('users:reset-password', p),
    // Fase 1: PIN personal (el mismo de Local Host).
    usersSetPin: (p) => invoke('users:set-pin', p),
    usersPinStatus: () => invoke('users:pin-status'),
    usersSetActive: (p) => invoke('users:set-active', p),
    // 0056: permisos adicionales por persona.
    usersPermissions: () => invoke('users:permissions'),
    usersSetPermissions: (p) => invoke('users:set-permissions', p),
    // Roles v2: autorizacion a distancia (el dueno aprueba en Owner).
    aprobacionesDisponible: () => invoke('aprobaciones:disponible'),
    reporteCierreDia: (p) => invoke('reportes:cierre-dia', p),
    aprobacionesSolicitar: (p) => invoke('aprobaciones:solicitar', p),
    aprobacionesEstado: (p) => invoke('aprobaciones:estado', p),
    aprobacionesCancelar: (p) => invoke('aprobaciones:cancelar', p),
    registerSupplierPayment: (payload) =>
        invoke('sp-register-supplier-payment', payload),
    registerCashMovement: (payload) =>
        invoke('sp-register-cash-out', payload),
    /* Egresos y pagos al personal (0049). Un pago al personal es un egreso de
       concepto "Pago al personal": mismo canal, misma fuente de verdad. */
    egresosConceptos: (p) => invoke('egresos:conceptos', p),
    egresosConceptoGuardar: (p) => invoke('egresos:concepto-guardar', p),
    egresosConceptoMover: (p) => invoke('egresos:concepto-mover', p),
    egresosPersonal: () => invoke('egresos:personal'),
    egresosRegistrar: (p) => invoke('egresos:registrar', p),
    egresosCancelar: (p) => invoke('egresos:cancelar', p),
    egresosListar: (p) => invoke('egresos:listar', p),
    generateSalePdf: (saleId) => invoke('generate-sale-pdf', saleId),
    commercialCatalog: () => invoke('commercial:catalog'),
    commercialSave: p => invoke('commercial:save',p),
    commercialQuote: p => invoke('commercial:quote',p),
    getConfig: () => invoke("getConfig"),
    // Solo lectura: dice si la BASE es de demostracion, para poder marcarlo en
    // pantalla. No habilita ninguna operacion del gestor.
    esDemo: () => invoke("app:es-demo"),
    updateBusinessConfig: (p) => invoke('update-business-config', p),
    /* El logo del negocio: el MISMO que encabeza el ticket y la pantalla del
       cliente. Se manda ya redimensionado desde la pantalla -ahi hay canvas y
       aqui no- y el proceso principal solo valida y escribe. */
    ticketGuardarLogo: (p) => invoke('ticket:guardar-logo', p),
    ticketBorrarLogo: () => invoke('ticket:borrar-logo'),
    ticketClosures: p => invoke('ticket:closures',p),
    ticketEmail: p => invoke('ticket:email',p),
    aprobacionesPolitica: () => invoke('aprobaciones:politica'),
    aprobacionesCambiar: (activas) => invoke('aprobaciones:politica-cambiar', { activas }),
    corteCorreoLista: p => invoke('corte:correo-lista',p),
    corteCorreoEnviar: p => invoke('corte:correo-enviar',p),
    estadoResultados: p => invoke('reportes:estado-resultados',p),
    ticketPreview: p => invoke('ticket:preview',p),
    ticketPrintDocument: p => invoke('ticket:print-document',p),
    ticketLogo: () => invoke('ticket:logo'),
    paymentsGet: () => invoke('payments:get'),
    paymentsSet: (c) => invoke('payments:set', c),
    getAppVersion: () => invoke('app:get-version'),

    getSales: (payload) => invoke('sp-get-sales', payload),
    exportSalesPdf: (payload) => invoke('export-sales-pdf', payload),
    
    onUpdateStatus: (callback) => {
        ipcRenderer.on('update-status', (_event, data) => callback(data));
    },
    checkForUpdates: () => invoke('check-for-updates'),
    downloadUpdate: () => invoke('download-update'),
    installUpdate: () => invoke('install-update'),

    getOpenShift: (payload) =>
        invoke('sp-get-open-shift', payload),

    openShift: (payload) =>
        invoke('sp-open-shift', payload),

    getActualFolio: () => invoke('sp-get-actual-folio'),

    getSaleByFolio: (payload) => invoke('sp-get-sale-by-folio', payload),
    updateSale: (payload) => invoke('sp-update-sale', payload),
    refundSale: (payload) => invoke('sp-refund-sale', payload),

    onBarcodeScan: (cb) => {
        const handler = (_event, payload) => cb(payload);
        ipcRenderer.on('barcode-scan', handler);
        return () => ipcRenderer.removeListener('barcode-scan', handler);
    },

    printSaleTicket: (payload) => invoke('print-sale-ticket', payload),
    listSerialPorts: () => invoke('devices:list-serial-ports'),
    listPrinters: () => invoke('devices:list-printers'),

    getDeviceConfig: () => invoke('devices:get-config'),
    setDeviceConfig: (cfg) => invoke('devices:set-config', cfg),

    // Pantalla de cliente (segundo monitor)
    customerDisplayListMonitors: () => invoke('customer-display:list-monitors'),
    customerDisplayOpen: (displayId) => invoke('customer-display:open', displayId),
    customerDisplayClose: () => invoke('customer-display:close'),
    customerDisplayState: (state) => invoke('customer-display:state', state),
    // La pantalla de cliente en una ventana normal, para probar sin segundo monitor.
    // Lo que el cliente pulsa en su pantalla llega aqui como intencion.
    onCustomerAction: (cb) => ipcRenderer.on('customer-display:action', (_e, a) => cb(a)),
    customerPreviewOpen: () => invoke('customer-display:preview-open'),
    customerPreviewClose: () => invoke('customer-display:preview-close'),
    customerDisplayStatus: () => invoke('customer-display:status'),
    onCustomerDisplayDisconnected: (cb) => ipcRenderer.on('customer-display:disconnected', () => cb()),

    // Modulos opcionales: Pago de servicios / recargas
    servicesGetConfig: () => invoke('services:get-config'),
    servicesSetConfig: (cfg) => invoke('services:set-config', cfg),
    servicesValidate: (payload) => invoke('services:validate', payload),
    servicesClear: () => invoke('services:clear'),
    servicesOperate: (op) => invoke('services:operate', op),

    // Blindaje / seguridad (anti robo hormiga)
    securityAuthorize: (creds) => invoke('security:authorize', creds),
    securityAutorizadores: (p) => invoke('security:autorizadores', p),

    /* ---- FASE CORE 0: sesion, permisos y modulos ----
       `sesion()` no recibe ni devuelve credenciales: pregunta al proceso
       principal quien esta operando ESTA ventana. Sirve para repintar tras
       un F5, no para decidir nada. */
    sesion: () => invoke('auth:sesion'),
    cerrarSesion: () => invoke('auth:cerrar-sesion'),
    modulosLista: () => invoke('modules:list'),
    modulosSet: (moduleKey, enabled) => invoke('modules:set', { moduleKey, enabled }),
    securityCatalogo: () => invoke('security:catalogo'),
    securityModelo: () => invoke('security:modelo'),
    securityLog: (evt) => invoke('security:log', evt),
    securityByCashier: (r) => invoke('security:by-cashier', r),
    securityRisk: (r) => invoke('security:risk', r),

    /* ------------------------------------------------------------ SERVICIOS
       El negocio que cobra por trabajo: catalogo, activos del cliente,
       profesionales, ordenes de servicio, agenda y comisiones.

       Los nombres van en espanol como el resto del dominio, y el canal lleva
       el prefijo `servicios:` y no `services:`, que ya significa los servicios
       de Windows del panel de red. */
    /* El giro: que clase de negocio de servicios es este. `serviciosGiros`
       es el catalogo (no toca la base), `serviciosConfig` lo que eligio este
       negocio y `serviciosElegirGiro` la eleccion, que ademas enciende el
       modulo. */
    serviciosGiros: () => invoke('servicios:giros'),
    serviciosConfig: () => invoke('servicios:config'),
    serviciosElegirGiro: (preset) => invoke('servicios:elegir-giro', { preset }),
    serviciosCatalogo: (p) => invoke('servicios:catalogo', p),
    serviciosGuardarServicio: (p) => invoke('servicios:guardar-servicio', p),
    serviciosActivarServicio: (p) => invoke('servicios:activar-servicio', p),
    serviciosAsignarProfesionales: (p) => invoke('servicios:asignar-profesionales', p),

    serviciosActivos: (p) => invoke('servicios:activos', p),
    serviciosGuardarActivo: (p) => invoke('servicios:guardar-activo', p),
    serviciosActivarActivo: (p) => invoke('servicios:activar-activo', p),

    serviciosProfesionales: (p) => invoke('servicios:profesionales', p),
    serviciosGuardarProfesional: (p) => invoke('servicios:guardar-profesional', p),
    serviciosActivarProfesional: (p) => invoke('servicios:activar-profesional', p),
    serviciosHorario: (p) => invoke('servicios:horario', p),
    serviciosGuardarHorario: (p) => invoke('servicios:guardar-horario', p),
    serviciosGuardarAusencia: (p) => invoke('servicios:guardar-ausencia', p),
    serviciosBorrarAusencia: (p) => invoke('servicios:borrar-ausencia', p),

    serviciosOrdenes: (p) => invoke('servicios:ordenes', p),
    serviciosOrden: (p) => invoke('servicios:orden', p),
    serviciosOrdenCrear: (p) => invoke('servicios:orden-crear', p),
    serviciosOrdenActualizar: (p) => invoke('servicios:orden-actualizar', p),
    serviciosOrdenEstado: (p) => invoke('servicios:orden-estado', p),
    serviciosOrdenAutorizar: (p) => invoke('servicios:orden-autorizar', p),
    serviciosOrdenCancelar: (p) => invoke('servicios:orden-cancelar', p),
    serviciosLineaAgregar: (p) => invoke('servicios:linea-agregar', p),
    serviciosLineaActualizar: (p) => invoke('servicios:linea-actualizar', p),

    serviciosCobroPrevia: (p) => invoke('servicios:cobro-previa', p),
    serviciosOrdenEnlazarVenta: (p) => invoke('servicios:orden-enlazar-venta', p),

    serviciosCitas: (p) => invoke('servicios:citas', p),
    serviciosCita: (p) => invoke('servicios:cita', p),
    serviciosCitaGuardar: (p) => invoke('servicios:cita-guardar', p),
    serviciosCitaEstado: (p) => invoke('servicios:cita-estado', p),
    serviciosCitaReprogramar: (p) => invoke('servicios:cita-reprogramar', p),
    serviciosCitaAOrden: (p) => invoke('servicios:cita-a-orden', p),
    serviciosDisponibilidad: (p) => invoke('servicios:disponibilidad', p),

    serviciosComisiones: (p) => invoke('servicios:comisiones', p),

    exportDatabase: () => invoke('export-database'),
    // Guarda bytes generados en el renderer (PDF, Excel) como archivo real.
    guardarArchivo: (payload) => invoke('files:save-bytes', payload),
    importDatabase: () => invoke('import-database'),

    // Proveedores por producto
    getProductSuppliers: (productId, onlyActive = true) =>
    invoke('sp-get-product-suppliers', { product_id: productId, only_active: onlyActive ? 1 : 0 }),

    upsertProductSupplier: (payload) =>
    invoke('sp-upsert-product-supplier', payload),

    setProductDefaultSupplier: (productId, supplierId) =>
    invoke('sp-set-product-default-supplier', { product_id: productId, supplier_id: supplierId }),

    removeProductSupplier: (productId, supplierId) =>
    invoke('sp-remove-product-supplier', { product_id: productId, supplier_id: supplierId }),

    getProductDefaultSupplier: (productId) =>
    invoke('sp-get-product-default-supplier', { product_id: productId }),

    addSupplier: (nombre) =>
        invoke('sp-add-supplier', { nombre }),

    actualizarProducto: (payload) => invoke('sp-update-product', payload),
    // Baja LOGICA. El procedimiento decide si se puede: si el producto sigue
    // siendo ingrediente de una receta viva o lo usa un modificador activo,
    // devuelve el motivo con los nombres, no un fallo generico.
    darDeBajaProducto: (productId) => invoke('sp-delete-product', productId),

    createBrand: (payload) => invoke('sp-add-brand', payload),
    createCategory: (payload) => invoke('sp-add-category', payload),
    mpCreateOrder: (payload) => invoke('mp-create-order', payload),
    mpGetOrder: (orderId) => invoke('mp-get-order', orderId),
    mpCancelOrder: (orderId) => invoke('mp-cancel-order', orderId),
    mpListTerminals: () => invoke('mp-list-terminals'),
    mpGetConfig: () => invoke('mp-get-config'),
    mpSetConfig: (cfg) => invoke('mp-set-config', cfg),
    mpSimulateOrder: (orderId, status) => invoke('mp-simulate-order', { orderId, status }),

    mpValidateToken: () => invoke('mp-validate-token'),
    mpCreateStore: (payload) => invoke('mp-create-store', payload),
    mpCreatePos: (payload) => invoke('mp-create-pos', payload),
    mpSetPdv: (terminalId) => invoke('mp-set-pdv', terminalId),

    //Backup Manager
    backupGetConfig: () => invoke('backup-get-config'),
    backupSetConfig: (cfg) => invoke('backup-set-config', cfg),
    backupRunNow: () => invoke('backup-run-now'),
    backupList: () => invoke('backup-list'),
    backupOpenFolder: () => invoke('backup-open-folder'),
    logToFile: (level, message, meta) => ipcRenderer.send('app-log', { level, message, meta }),
    openLogsFolder: () => invoke('logs-open-folder'),
    logsInfo: () => invoke('logs-info'),

    // Cajas
    registersList: (onlyActive) => invoke('registers-list', onlyActive),
    registersAdd: (payload) => invoke('registers-add', payload),
    registersSetActive: (payload) => invoke('registers-set-active', payload),

    // Identidad de esta mÃ¡quina
    registerGetCurrent: () => invoke('register-get-current'),
    registerSetCurrent: (payload) => invoke('register-set-current', payload),

    // Arriendo de caja: una caja, un equipo.
    registersAssignments: (onlyActive) => invoke('registers-assignments', onlyActive),
    registerLeaseStatus: () => invoke('register-lease-status'),
    registerRelease: () => invoke('register-release'),
    registerReleaseAdmin: (payload) => invoke('register-release-admin', payload),

    // Preparar esta mÃ¡quina como servidor de las demÃ¡s cajas
    networkDiagnose: (plan) => invoke('network:diagnose', plan),
    networkPrepare: (payload) => invoke('network:prepare', payload),
    networkRevealPassword: () => invoke('network:reveal-password'),

    cloudGetConfig: () => invoke('cloud-get-config'),
    cloudSetConfig: (partial) => invoke('cloud-set-config', partial),
    cloudPushNow: () => invoke('cloud-push-now'),

    cloudEnsureProvisioned: (nombre) => invoke('cloud-ensure-provisioned', nombre),
    cloudGetPairing: () => invoke('cloud-get-pairing'),
    cloudSetAnonKey: (key) => invoke('cloud-set-anon-key', key),
    cloudDeleteAccount: () => invoke('cloud-delete-account'),
    // Fase 1: empresa -> sucursal -> equipo.
    cloudUnirseCodigo: (codigo) => invoke('cloud:unirse-codigo', codigo),
    cloudCrearSucursal: (p) => invoke('cloud:crear-sucursal', p),
    cloudEstado: () => invoke('cloud:estado'),
    // Fase 2: transferencias con eventos (ferias).
    transferenciasListar: () => invoke('transferencias:listar'),
    transferenciasEnviar: (p) => invoke('transferencias:enviar', p),
    transferenciasRecibirRetorno: (p) => invoke('transferencias:recibir-retorno', p),


    //FACTURACION
    setFiscalIssuerRef: (issuerId) => invoke('fiscal-set-issuer-ref', issuerId),
    // Fase 1: CFDI por la nube; la credencial del equipo la pone el proceso principal.
    fiscalTimbrar: (cuerpo) => invoke('fiscal:timbrar', cuerpo),
    fiscalCancelar: (cuerpo) => invoke('fiscal:cancelar', cuerpo),
    fiscalArchivos: (cuerpo) => invoke('fiscal:archivos', cuerpo),
    fiscalRegistrarEmisor: (cuerpo) => invoke('fiscal:registrar-emisor', cuerpo),
    getFiscalConfig: () => invoke('fiscal-get-config'),
    saveFiscalConfig: (cfg) => invoke('fiscal-save-config', cfg),

    getInvoices: (filtros) => invoke('fiscal-get-invoices', filtros),
    getInvoicesCounts: () => invoke('fiscal-get-invoices-counts'),

    saveInvoice: (inv) => invoke('fiscal-save-invoice', inv),
    getInvoiceFilesData: (id) => invoke('fiscal-get-invoice-files-data', id),

    cancelInvoice: (p) => invoke('fiscal-cancel-invoice', p),

    // Abrir URL en el navegador del sistema
    openExternal: (url) => invoke('open-external', url),

    //Licencia
    getMachineId: () => invoke('get-machine-id'),

    licenseGet:   () => invoke('license:get'),
    // La licencia solo la escribe el proceso principal (servidor o archivo firmado).
    licenseRefresh: () => invoke('license:refresh'),
    licenseImport: () => invoke('license:import'),
    licenseRelease: () => invoke('license:release'),
    licenseInventoryReview: () => invoke('license:inventory-review'),
    licenseInventoryReviewDismiss: () => invoke('license:inventory-review-dismiss'),
    licenseActivate:  (d) => invoke('license:activate', d),
    licenseStartTrial: (d) => invoke('license:start-trial', d),
    /* El nombre real del negocio, una vez que el alta lo conoce. */
    licenseSyncTrialName: (d) => invoke('license:sync-trial-name', d),
    licenseTrialVertical: (d) => invoke('license:trial-vertical', d),
    licenseStatus: () => invoke('license:status'),

    setupStatus: () => invoke('setup-status'),
    setupInicial: (p) => invoke('setup-inicial', p),
});

/**
 * API de Hospitality, agrupada por dominio.
 *
 * Se expone aparte de `electronAPI` a proposito: los 158 metodos de esa
 * superficie crecieron sin orden, y lo nuevo no repite ese camino. Cada
 * grupo corresponde a un dominio y a un modulo de electron/ipc/.
 */
contextBridge.exposeInMainWorld('wybix', {
    catalog: {
        menu: () => invoke('catalog:menu'),
        uoms: () => invoke('catalog:uoms'),
        ingredients: (p) => invoke('catalog:ingredients', p),
        // Cuantas unidades se pueden preparar CON las opciones elegidas. Es
        // UX, no autorizacion: la venta vuelve a validar dentro de su
        // transaccion, con los productos bloqueados.
        disponibilidad: (p) => invoke('hospitality:availability', p),
    },
    // 0060 · Produccion por tandas. Los ingredientes salen al EMPEZAR una
    // tanda; al terminarla entran las piezas buenas y se registra la merma.
    produccion: {
        tablero: (p) => invoke('produccion:tablero', p),
        planear: (p) => invoke('produccion:planear', p),
        empezar: (p) => invoke('produccion:empezar', p),
        terminar: (p) => invoke('produccion:terminar', p),
        cancelar: (p) => invoke('produccion:cancelar', p),
        // Merma de producto terminado: lo que estaba a la venta y se tiro.
        merma: (p) => invoke('produccion:merma', p),
        formula: (p) => invoke('produccion:formula', p),
        guardarFormula: (p) => invoke('produccion:formula-guardar', p),
        quitarFormula: (p) => invoke('produccion:formula-quitar', p),
    },
    recipes: {
        get: (p) => invoke('recipes:get', p),
        save: (p) => invoke('recipes:save', p),
        remove: (p) => invoke('recipes:delete', p),
    },
    modifiers: {
        list: (p) => invoke('modifiers:list', p),
        save: (p) => invoke('modifiers:save', p),
        remove: (p) => invoke('modifiers:delete', p),
        setProductGroups: (p) => invoke('modifiers:set-product-groups', p),
    },
    presentations: {
        list: (p) => invoke('presentations:list', p),
        save: (p) => invoke('presentations:save', p),
        remove: (p) => invoke('presentations:delete', p),
    },
    images: {
        set: (p) => invoke('images:set', p),
        sync: (p) => invoke('images:sync', p),
    },
    loyalty: {
        catalog: () => invoke('loyalty:catalog'),
        // Lo repartido de verdad, para auditarlo sin abrir SSMS.
        instances: (p) => invoke('loyalty:instances', p),
        saveCampaign: (p) => invoke('loyalty:save-campaign', p),
        saveDefinition: (p) => invoke('loyalty:save-definition', p),
        // Se llama DESPUES de cobrar. Si falla, la venta ya esta hecha: el
        // renderer se lo calla y sigue, no le ensena un error a quien ya pago.
        evaluateSale: (p) => invoke('loyalty:evaluate-sale', p),
    },
    dynamics: {
        pending: (p) => invoke('dynamics:pending', p),
        play: (p) => invoke('dynamics:play', p),
        // Sectores de la ruleta. Quien decide cual sale es SQL, no la rueda.
        segments: (p) => invoke('dynamics:segments', p),
        saveSegment: (p) => invoke('dynamics:save-segment', p),
    },
    coupons: {
        // Mirar sin consumir, antes de cobrar.
        issue: (p) => invoke('coupons:issue', p),
        validate: (p) => invoke('coupons:validate', p),
        // Consumir, con la venta ya cobrada. Un fallo aqui SI se ensena.
        redeem: (p) => invoke('coupons:redeem', p),
    },
    /*
     * Mesas, cuentas y cocina. Enviar NO cobra y cobrar NO envia: son canales
     * distintos a proposito. El cobro sigue siendo `registerSale`.
     */
    salon: {
        get: () => invoke('salon:get'),
        guardarArea: (p) => invoke('salon:area-guardar', p),
        guardarMesa: (p) => invoke('salon:mesa-guardar', p),
    },
    cuentas: {
        abrir: (p) => invoke('cuentas:abrir', p),
        obtener: (p) => invoke('cuentas:obtener', p),
        cliente: (p) => invoke('cuentas:cliente', p),
        preparacion: (p) => invoke('cuentas:preparacion', p),
        enviar: (p) => invoke('cuentas:enviar', p),
        estado: (p) => invoke('cuentas:estado', p),
        cobrada: (p) => invoke('cuentas:cobrada', p),
        liberar: (p) => invoke('cuentas:liberar', p),
    },
    estaciones: {
        listar: () => invoke('estaciones:listar'),
        guardar: (p) => invoke('estaciones:guardar', p),
        productos: () => invoke('estaciones:productos'),
        asignar: (p) => invoke('estaciones:producto-asignar', p),
    },
    kds: {
        listar: (p) => invoke('kds:listar', p),
        estado: (p) => invoke('kds:estado', p),
        cancelar: (p) => invoke('comandas:cancelar', p),
        reimprimir: (p) => invoke('comandas:reimprimir', p),
    },
    /* Wybix Local Host: pantallas de la red local (KDS en tablets). */
    localHost: {
        estado: () => invoke('localhost:estado'),
        activar: (p) => invoke('localhost:activar', p),
        emparejar: (p) => invoke('localhost:emparejar', p),
        revocar: (p) => invoke('localhost:revocar', p),
        red: () => invoke('localhost:red'),
        firewall: () => invoke('localhost:firewall'),
        abrirFirewall: () => invoke('localhost:firewall-abrir'),
        cambiarFuncion: (p) => invoke('localhost:cambiar-funcion', p),
        renombrar: (p) => invoke('localhost:renombrar', p),
        trabajadores: () => invoke('localhost:trabajadores'),
        qrTrabajador: (p) => invoke('localhost:trabajador-qr', p),
        pinTrabajador: (p) => invoke('localhost:trabajador-pin', p),
        revocarTrabajador: (p) => invoke('localhost:trabajador-revocar', p),
        diagnostico: () => invoke('localhost:diagnostico'),
    },
    /* Conteos y faltantes reportados desde las Pantallas de inventario. */
    inventarioReportes: {
        listar: (p) => invoke('inventario:reportes', p),
        resolver: (p) => invoke('inventario:reporte-resolver', p),
    },
    reportes: {
        actividadHoraria: (p) => invoke('reportes:actividad-horaria', p),
    },
    /* Wybix Guide: el contexto de demo lo decide el proceso principal. */
    guide: {
        contexto: () => invoke('guide:contexto'),
        autorizar: (p) => invoke('guide:autorizar', p),
        preparar: (p) => invoke('guide:preparar', p),
    },
    terminal: {
        auditar: (p) => invoke('terminal:auditar', p),
        activar: (p) => invoke('terminal:activar', p),
        restaurar: () => invoke('terminal:restaurar'),
    },
    raffles: {
        save: (p) => invoke('raffles:save', p),
        // Cerrar y sortear son dos actos distintos.
        close: (p) => invoke('raffles:close', p),
        detail: (p) => invoke('raffles:detail', p),
        draw: (p) => invoke('raffles:draw', p),
        winnerStatus: (p) => invoke('raffles:winner-status', p),
    },
});


