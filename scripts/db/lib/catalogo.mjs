/**
 * Catalogo de objetos SQL de Wybix: dominio, criticidad y clasificacion.
 *
 * Es la unica fuente de la organizacion en carpetas. Si un objeto no aparece
 * aqui, el extractor lo deja en `sin-clasificar/` y lo reporta, para que nunca
 * se cuele nada en el arbol canonico sin decision explicita.
 */

/** Objetos sin los que Wybix no puede operar. Su ausencia detiene el arranque. */
export const CRITICOS = [
  // Escritura del nucleo transaccional.
  'sp_register_sale',
  'sp_register_purchase',
  'sp_refund_sale',
  'sp_register_customer_payment',
  'sp_register_supplier_payment',
  'sp_register_cash_out',
  'sp_open_shift',
  'sp_close_shift',
  // Sin esto no se puede ni entrar.
  'sp_login_user',
  // La pantalla de venta no funciona sin ellos.
  'sp_get_active_products',
  'sp_get_open_shift',
  'sp_get_actual_folio',
  // Multicaja: `sp_register_sale` resuelve el register contra esta tabla.
  'sp_get_registers',
];

/** Tipos de tabla que reciben los procedures transaccionales. */
export const TIPOS_CRITICOS = ['SaleDetailType', 'PurchaseDetailType'];

/**
 * Clasificacion de lo que NO invoca el codigo actual.
 *
 *   legacy    -> resto confirmado de una etapa anterior. Se versiona en
 *                cuarentena para no perderlo, pero NO entra en el baseline ni
 *                en las migraciones.
 *   incierto  -> existe y esta completo, pero ningun punto del codigo lo
 *                invoca. No se borra ni se despliega: queda versionado en su
 *                propia carpeta hasta que haya decision.
 *
 * Lo que NO aparece aqui y tampoco invoca el codigo se trata como procedure
 * del producto todavia sin conectar (users, facturacion, informes): se
 * versiona con normalidad, porque perderlo seria perder trabajo hecho.
 */
export const NO_INVOCADOS = {
  sp_mig_test: 'legacy',
  sp_WA_AddHistorial: 'incierto',
  sp_WA_DeletePlantilla: 'incierto',
  sp_WA_GetConfiguracion: 'incierto',
  sp_WA_GetHistorial: 'incierto',
  sp_WA_GetPlantillas: 'incierto',
  sp_WA_UpdateConfiguracion: 'incierto',
  sp_WA_UpsertPlantilla: 'incierto',
};

/** nombre -> carpeta de dominio. */
const DOMINIO = new Map();
const asignar = (carpeta, nombres) => nombres.forEach(n => DOMINIO.set(n, carpeta));

asignar('sales', [
  'sp_register_sale', 'sp_refund_sale', 'sp_update_sale', 'sp_get_sale_by_folio',
  'sp_get_sale_ticket', 'sp_get_sales_filtered', 'sp_get_actual_folio',
  'sp_get_total_sales_today', 'sp_get_total_sales_month', 'sp_get_total_orders',
  'sp_get_top_selling_product', 'sp_get_daily_sales_current_month',
  'sp_get_daily_sales_last_7_days', 'sp_sales_by_payment', 'sp_import_sales',
]);

asignar('purchases', [
  'sp_register_purchase', 'sp_get_purchases', 'sp_get_next_purchase_folio',
]);

asignar('inventory', [
  'sp_add_product', 'sp_update_product', 'sp_delete_product', 'sp_reactivate_product',
  'sp_get_active_products', 'sp_get_product_by_id', 'sp_add_brand', 'sp_add_categories',
  'sp_get_brands', 'sp_get_categories', 'sp_dead_products', 'sp_reorder_suggestions',
  'sp_import_products', 'sp_Consultar_Detalle_Productos', 'sp_Consultar_Detalles_Producto',
]);

asignar('cash', [
  'sp_open_shift', 'sp_close_shift', 'sp_get_open_shift', 'sp_register_cash_out',
  'sp_cash_summary', 'sp_get_cash_closures', 'sp_get_cash_movements',
]);

asignar('customers', [
  'sp_create_customer', 'sp_update_customer', 'sp_get_customer', 'sp_get_customers',
  'sp_get_customer_open_credit_sales', 'sp_get_customers_credit_summary',
  'sp_get_customers_with_credit_available', 'sp_get_customers_open_credit_not_overdue',
  'sp_register_customer_payment', 'sp_top_customers', 'sp_customers_kpis',
]);

asignar('suppliers', [
  'sp_add_supplier', 'sp_get_suppliers', 'sp_supplier_save', 'sp_get_suppliers_account',
  'sp_get_supplier_account_detail', 'sp_get_supplier_payments', 'sp_register_supplier_payment',
  'sp_get_product_suppliers', 'sp_get_product_default_supplier',
  'sp_set_product_default_supplier', 'sp_upsert_product_supplier', 'sp_remove_product_supplier',
]);

asignar('billing', [
  'sp_save_invoice', 'sp_cancel_invoice', 'sp_get_invoices', 'sp_get_invoices_counts',
  'sp_get_invoice_by_id', 'sp_get_invoice_files_data', 'sp_get_fiscal_config',
  'sp_save_fiscal_config', 'sp_set_fiscal_issuer_ref', 'sp_upsert_fiscal_receiver',
  'sp_create_invoice_request', 'sp_get_invoice_requests', 'sp_get_invoice_request_detail',
  'sp_update_invoice_request_status',
]);

asignar('cloud', [
  'sp_cloud_daily_summary', 'sp_cloud_shifts_today', 'sp_cloud_top_products',
  'sp_cloud_sales_trend', 'sp_cloud_shift_detail', 'sp_cloud_daily_profit',
]);

asignar('security', [
  'sp_login_user', 'sp_authorize_supervisor', 'sp_log_security_event',
  'sp_security_by_cashier', 'sp_cashier_risk', 'sp_get_user_by_id',
  'sp_add_user', 'sp_update_user', 'sp_delete_user', 'sp_reactivate_user',
]);

asignar('reports', ['sp_get_profit_overview', 'sp_get_weekly_profit']);

asignar('setup', [
  'sp_setup_inicial', 'sp_setup_status', 'sp_add_register', 'sp_set_register_active',
  'sp_get_registers', 'sp_get_business_config', 'sp_update_business_config',
]);

asignar('whatsapp', [
  'sp_WA_AddHistorial', 'sp_WA_DeletePlantilla', 'sp_WA_GetConfiguracion',
  'sp_WA_GetHistorial', 'sp_WA_GetPlantillas', 'sp_WA_UpdateConfiguracion',
  'sp_WA_UpsertPlantilla',
]);

asignar('_cuarentena', ['sp_mig_test']);

export function dominioDe(nombre) {
  return DOMINIO.get(nombre) || 'sin-clasificar';
}

export function esCritico(nombre) {
  return CRITICOS.includes(nombre);
}

/* ------------------------------------------------------------------------ *
 * Clasificacion para WYBIX DATABASE BASELINE V1
 *
 * Decide QUE se despliega en una instalacion nueva. Es distinta de
 * `NO_INVOCADOS`, que solo dice si el codigo actual llama al objeto:
 *
 *   current   Forma parte del producto. Se despliega en el baseline.
 *   incierto  Existe, compila y HOY viaja dentro de template.bak, pero ningun
 *             punto del codigo lo invoca. Se sigue desplegando para no alterar
 *             lo que las instalaciones ya reciben; queda marcado para decidir.
 *   futuro    Escrito pero nunca desplegado, y hoy NO compila contra el
 *             esquema real. Se versiona, no se despliega.
 *   legacy    Resto de una etapa anterior. Se conserva en cuarentena y queda
 *             fuera del baseline productivo.
 * ------------------------------------------------------------------------ */

/** Escrito pero nunca desplegado. No compila contra el esquema actual. */
export const FUTUROS = {
  sp_import_sales: 'Importador de ventas. Nunca aplicado; su primer parametro no existe en el esquema.',
  sp_cloud_daily_profit: 'cloudSync lo llama en try/catch tolerando su ausencia. Referencia products.last_cost, columna inexistente.',
};

export function clasificacionDe(nombre) {
  if (FUTUROS[nombre]) return 'futuro';
  const n = NO_INVOCADOS[nombre];
  if (n === 'legacy') return 'legacy';
  if (n === 'incierto') return 'incierto';
  return 'current';
}

/** ¿Entra este objeto en una instalacion nueva? */
export function esDesplegable(nombre) {
  const c = clasificacionDe(nombre);
  return c === 'current' || c === 'incierto';
}

/**
 * Reparte los objetos de un manifiesto por clase de despliegue.
 *
 * Esta es la UNICA definicion de "que entra en una instalacion". Antes cada
 * script decidia por su cuenta y no coincidian: `db:test-rebuild` desplegaba
 * los 108 del manifiesto sin mirar la clasificacion, asi que metia
 * `sp_mig_test` —legacy— en la base y reportaba 106 donde el baseline
 * reportaba 105. Cualquier herramienta que necesite el conjunto desplegable
 * debe llamar aqui, no filtrar por su cuenta.
 *
 * `desplegables` conserva el orden del manifiesto a proposito: no se
 * reconstruye concatenando grupos.
 */
export function repartirPorClase(objetos) {
  const grupos = { current: [], incierto: [], futuro: [], legacy: [] };
  for (const o of objetos) grupos[clasificacionDe(o.nombre)].push(o);
  return {
    ...grupos,
    desplegables: objetos.filter(o => esDesplegable(o.nombre)),
    noDesplegables: objetos.filter(o => !esDesplegable(o.nombre)),
  };
}

/** Resumen de una linea por clase, para que los informes digan lo mismo. */
export function lineasDeClase(r) {
  return [
    `   CURRENT   ${String(r.current.length).padStart(3)}  desplegados`,
    `   UNCERTAIN ${String(r.incierto.length).padStart(3)}  desplegados (hoy ya viajan dentro del template)`,
    `   FUTURE    ${String(r.futuro.length).padStart(3)}  NO desplegados: ${r.futuro.map(o => o.nombre).join(', ') || '-'}`,
    `   LEGACY    ${String(r.legacy.length).padStart(3)}  NO desplegados: ${r.legacy.map(o => o.nombre).join(', ') || '-'}`,
  ].join('\n');
}
