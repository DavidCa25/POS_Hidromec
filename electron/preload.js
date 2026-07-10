const { contextBridge, ipcRenderer } = require('electron');
const { ref } = require('pdfkit');

contextBridge.exposeInMainWorld('electronAPI', {
    makeSale: (data) => ipcRenderer.send('make-sale', data),
    onSaleResult: (callback) => ipcRenderer.on('sale-result', (event, data) => callback(data)),
    iniciarSesion: (usuario, contrasena) => ipcRenderer.invoke('sp-iniciar-sesion', { usuario, contrasena }),
    crearUsuario: (username, password, role) =>
        ipcRenderer.invoke('sp-add-user', { username, password, role }),

    consultarDetallesProducto: (CategoryID) => ipcRenderer.invoke('sp-Consultar-Detalle-Productos', CategoryID),
    agregarProducto: (brand, category, partNumber, name, price, stock) =>
        ipcRenderer.invoke('sp-add-product', brand, category, partNumber, name, price, stock),
    getCategories: () => ipcRenderer.invoke('sp-get-categories'),
    getBrands: () => ipcRenderer.invoke('sp-get-brands'),
    getActiveProducts: () => ipcRenderer.invoke('sp-get-active-products'),
    registerSale: (userId, paymentMethod, items, customerId, dueDate, registerId) =>
        ipcRenderer.invoke('sp-register-sale', userId, paymentMethod, items, customerId, dueDate, registerId),

    getSuppliers: () => ipcRenderer.invoke('sp-get-suppliers'),
    getNextPurchaseFolio: () => ipcRenderer.invoke('get-next-purchase-folio'),
    registerPurchase: (payload) => ipcRenderer.invoke('sp-register-purchase', payload),
    getPurchases: () => ipcRenderer.invoke('sp-get-purchases'),
    getUserById: (userId) => ipcRenderer.invoke('sp-get-user-by-id', userId),

    getTopSellingProducts: () => ipcRenderer.invoke('sp-get-top-selling-products'),
    getSalesMonthly: () => ipcRenderer.invoke('sp-get-total-sales-month'),
    getSalesDayly: () => ipcRenderer.invoke('sp-get-total-sales-today'),
    getTotalOrders: () => ipcRenderer.invoke('sp-get-total-orders'),
    getCashMovements: (opts) => ipcRenderer.invoke('sp-get-cash-movements', opts),

    getCustomers: () => ipcRenderer.invoke('sp-get-customers'),
    getCreditCustomers: () => ipcRenderer.invoke('sp-get-credit-customers'),
    getCustomersSummary: () => ipcRenderer.invoke('sp-get-customers-summary'),
    ccreateCustomer: (code, customerName, taxId, email, phone, creditLimit, termsDays, active, regimenFiscal, usoCfdi, razonSocial, graceDays, lateFeePct, lateFeeFixed, riskLevel) => 
    ipcRenderer.invoke(
      'sp-create-customer', 
      code, customerName, taxId, email, phone, creditLimit, termsDays, active, regimenFiscal, usoCfdi, razonSocial, graceDays, lateFeePct, lateFeeFixed, riskLevel
    ),

    updateCustomer: (id, code, customerName, taxId, email, phone, creditLimit, termsDays, active, regimenFiscal, usoCfdi, razonSocial, graceDays, lateFeePct, lateFeeFixed, riskLevel) => 
    ipcRenderer.invoke(
      'sp-update-customer', 
      id, code, customerName, taxId, email, phone, creditLimit, termsDays, active, regimenFiscal, usoCfdi, razonSocial, graceDays, lateFeePct, lateFeeFixed, riskLevel
    ),
    getCustomerOpenSales: (customerId) =>
    ipcRenderer.invoke('sp-get-customer-open-sales', customerId),
    registerCustomerPayment: (customerId, saleId, amount, userId, paymentMethod, note) =>
        ipcRenderer.invoke('sp-register-customer-payment',
        customerId, saleId, amount, userId, paymentMethod, note),
    openCashDrawer: () => ipcRenderer.invoke('open-cash-drawer'),
    getDailySalesLast7Days: () => ipcRenderer.invoke('sp-get-daily-sales-last-7-days'),
    getDailySalesCurrentMonth: () =>
        ipcRenderer.invoke('sp-get-daily-sales-current-month'),
    getProfitOverview: (fromDate, toDate) =>
        ipcRenderer.invoke('sp-get-profit-overview', { fromDate, toDate }),
    closeShift: (payload) => {
        console.log('🧾 preload closeShift payload:', payload);
        return ipcRenderer.invoke('sp-close-shift', payload);
    },

    getActiveUsers: () => ipcRenderer.invoke('sp-get-active-users'),
    registerSupplierPayment: (payload) =>
        ipcRenderer.invoke('sp-register-supplier-payment', payload),
    registerCashMovement: (payload) =>
        ipcRenderer.invoke('sp-register-cash-out', payload),
    generateSalePdf: (saleId) => ipcRenderer.invoke('generate-sale-pdf', saleId),
    getConfig: () => ipcRenderer.invoke("getConfig"),

    getSales: (payload) => ipcRenderer.invoke('sp-get-sales', payload),
    exportSalesPdf: (payload) => ipcRenderer.invoke('export-sales-pdf', payload),
    
    onUpdateStatus: (callback) => {
        ipcRenderer.on('update-status', (_event, data) => callback(data));
    },
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    downloadUpdate: () => ipcRenderer.invoke('download-update'),
    installUpdate: () => ipcRenderer.invoke('install-update'),

    getOpenShift: (payload) =>
        ipcRenderer.invoke('sp-get-open-shift', payload),

    openShift: (payload) =>
        ipcRenderer.invoke('sp-open-shift', payload),

    getActualFolio: () => ipcRenderer.invoke('sp-get-actual-folio'),

    getSaleByFolio: (payload) => ipcRenderer.invoke('sp-get-sale-by-folio', payload),
    updateSale: (payload) => ipcRenderer.invoke('sp-update-sale', payload),
    refundSale: (payload) => ipcRenderer.invoke('sp-refund-sale', payload),

    onBarcodeScan: (cb) => {
        const handler = (_event, payload) => cb(payload);
        ipcRenderer.on('barcode-scan', handler);
        return () => ipcRenderer.removeListener('barcode-scan', handler);
    },

    printSaleTicket: (payload) => ipcRenderer.invoke('print-sale-ticket', payload),
    listSerialPorts: () => ipcRenderer.invoke('devices:list-serial-ports'),
    listPrinters: () => ipcRenderer.invoke('devices:list-printers'),

    getDeviceConfig: () => ipcRenderer.invoke('devices:get-config'),
    setDeviceConfig: (cfg) => ipcRenderer.invoke('devices:set-config', cfg),

    exportDatabase: () => ipcRenderer.invoke('export-database'),
    importDatabase: () => ipcRenderer.invoke('import-database'),

    // Proveedores por producto
    getProductSuppliers: (productId, onlyActive = true) =>
    ipcRenderer.invoke('sp-get-product-suppliers', { product_id: productId, only_active: onlyActive ? 1 : 0 }),

    upsertProductSupplier: (payload) =>
    ipcRenderer.invoke('sp-upsert-product-supplier', payload),

    setProductDefaultSupplier: (productId, supplierId) =>
    ipcRenderer.invoke('sp-set-product-default-supplier', { product_id: productId, supplier_id: supplierId }),

    removeProductSupplier: (productId, supplierId) =>
    ipcRenderer.invoke('sp-remove-product-supplier', { product_id: productId, supplier_id: supplierId }),

    getProductDefaultSupplier: (productId) =>
    ipcRenderer.invoke('sp-get-product-default-supplier', { product_id: productId }),

    addSupplier: (nombre) =>
        ipcRenderer.invoke('sp-add-supplier', { nombre }),

    actualizarProducto: (payload) => ipcRenderer.invoke('sp-update-product', payload),

    createBrand: (payload) => ipcRenderer.invoke('sp-add-brand', payload),
    createCategory: (payload) => ipcRenderer.invoke('sp-add-category', payload),
    mpCreateOrder: (payload) => ipcRenderer.invoke('mp-create-order', payload),
    mpGetOrder: (orderId) => ipcRenderer.invoke('mp-get-order', orderId),
    mpCancelOrder: (orderId) => ipcRenderer.invoke('mp-cancel-order', orderId),
    mpListTerminals: () => ipcRenderer.invoke('mp-list-terminals'),
    mpGetConfig: () => ipcRenderer.invoke('mp-get-config'),
    mpSetConfig: (cfg) => ipcRenderer.invoke('mp-set-config', cfg),
    mpSimulateOrder: (orderId, status) => ipcRenderer.invoke('mp-simulate-order', { orderId, status }),

    mpValidateToken: () => ipcRenderer.invoke('mp-validate-token'),
    mpCreateStore: (payload) => ipcRenderer.invoke('mp-create-store', payload),
    mpCreatePos: (payload) => ipcRenderer.invoke('mp-create-pos', payload),
    mpSetPdv: (terminalId) => ipcRenderer.invoke('mp-set-pdv', terminalId),

    //Backup Manager
    backupGetConfig: () => ipcRenderer.invoke('backup-get-config'),
    backupSetConfig: (cfg) => ipcRenderer.invoke('backup-set-config', cfg),
    backupRunNow: () => ipcRenderer.invoke('backup-run-now'),
    backupList: () => ipcRenderer.invoke('backup-list'),
    backupOpenFolder: () => ipcRenderer.invoke('backup-open-folder'),
    logToFile: (level, message, meta) => ipcRenderer.send('app-log', { level, message, meta }),
    openLogsFolder: () => ipcRenderer.invoke('logs-open-folder'),
    logsInfo: () => ipcRenderer.invoke('logs-info'),

    // Cajas
    registersList: (onlyActive) => ipcRenderer.invoke('registers-list', onlyActive),
    registersAdd: (payload) => ipcRenderer.invoke('registers-add', payload),
    registersSetActive: (payload) => ipcRenderer.invoke('registers-set-active', payload),

    // Identidad de esta máquina
    registerGetCurrent: () => ipcRenderer.invoke('register-get-current'),
    registerSetCurrent: (payload) => ipcRenderer.invoke('register-set-current', payload),

    cloudGetConfig: () => ipcRenderer.invoke('cloud-get-config'),
    cloudSetConfig: (partial) => ipcRenderer.invoke('cloud-set-config', partial),
    cloudPushNow: () => ipcRenderer.invoke('cloud-push-now'),

    cloudEnsureProvisioned: (nombre) => ipcRenderer.invoke('cloud-ensure-provisioned', nombre),
    cloudGetPairing: () => ipcRenderer.invoke('cloud-get-pairing'),
    cloudSetAnonKey: (key) => ipcRenderer.invoke('cloud-set-anon-key', key),


    //FACTURACION
    setFiscalIssuerRef: (issuerId) => ipcRenderer.invoke('fiscal-set-issuer-ref', issuerId),
    getFiscalConfig: () => ipcRenderer.invoke('fiscal-get-config'),
    saveFiscalConfig: (cfg) => ipcRenderer.invoke('fiscal-save-config', cfg),

    getInvoices: (filtros) => ipcRenderer.invoke('fiscal-get-invoices', filtros),
    getInvoicesCounts: () => ipcRenderer.invoke('fiscal-get-invoices-counts'),

    saveInvoice: (inv) => ipcRenderer.invoke('fiscal-save-invoice', inv),
    getInvoiceFilesData: (id) => ipcRenderer.invoke('fiscal-get-invoice-files-data', id),

    cancelInvoice: (p) => ipcRenderer.invoke('fiscal-cancel-invoice', p),

    //Licencia
    getMachineId: () => ipcRenderer.invoke('get-machine-id'),

    licenseGet:   () => ipcRenderer.invoke('license:get'),
    licenseSave:  (d) => ipcRenderer.invoke('license:save', d),
    licenseClear: () => ipcRenderer.invoke('license:clear'),
    getMachineId: () => ipcRenderer.invoke('get-machine-id'),
});

