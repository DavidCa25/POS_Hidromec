const { contextBridge, ipcRenderer } = require('electron');

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
    registerSale: (userId, paymentMethod, items, customerId, dueDate) =>
        ipcRenderer.invoke('sp-register-sale', userId, paymentMethod, items, customerId, dueDate),

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
    createCustomer: (code, customerName, email, phone, creditLimit, termsDays, active) => ipcRenderer.invoke('sp-create-customer', code, customerName, email, phone, creditLimit, termsDays, active),
    updateCustomer: (id, code, customerName, email, phone, creditLimit, termsDays, active) => ipcRenderer.invoke(
      'sp-update-customer', id, code, customerName, email, phone, creditLimit, termsDays, active),
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
    closeShift: (userId, cashDelivered, closureDate) =>
        ipcRenderer.invoke('sp-close-shift', { userId, cashDelivered, closureDate }),
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


});
