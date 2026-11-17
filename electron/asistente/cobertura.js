/**
 * COBERTURA DEL ASISTENTE
 *
 * Todo lo que se puede hacer a mano en Wybix lo tiene que poder hacer el
 * asistente. Este archivo dice, para CADA canal protegido de
 * electron/seguridad/canales.js, dónde está:
 *
 *   - Lo hace el asistente: NO se escribe aquí. Se calcula: un canal está
 *     cubierto si algún plan de electron/asistente/acciones llama a la función
 *     de preload que lo invoca (scripts/pruebas/asistente-cobertura.test.mjs).
 *   - LECTURA: el canal solo lee; no es una acción que hacer.
 *   - MANUAL: a propósito no lo hace el asistente, con el motivo (un archivo,
 *     un secreto, hardware, algo irreversible).
 *   - PENDIENTE: falta. Es la lista de trabajo, por área. Cuando una acción
 *     nueva cubre un canal, la prueba exige sacarlo de aquí.
 *
 * Un canal nuevo que no aparezca en ninguna parte rompe la prueba: alguien
 * tiene que decidir si el asistente lo hace.
 */
'use strict';

const LECTURA = [
  'menu-linea:diseno',
  'menu-linea:imagen-ver',
  'plataformas:ver',
  'estaciones:productos',
  'produccion:formula',
  'corte:correo-lista',
  'alerts:refunds-by-cashier',
  'aprobaciones:disponible',
  'aprobaciones:estado',
  'aprobaciones:politica',
  'asistencia:estado',
  'asistencia:horario',
  'asistencia:jornadas',
  'asistencia:mis-horas',
  'asistencia:reglas',
  'asistencia:resumen',
  'cloud-get-pairing',
  'cloud:estado',
  'club:admin',
  'club:estado',
  'commercial:catalog',
  'commercial:quote',
  'compras-doc:de-compra',
  'compras-doc:duplicados',
  'compras-doc:leer',
  'cuentas:obtener',
  'cuentas:preparacion',
  'devoluciones:ventas',
  'egresos:conceptos',
  'egresos:listar',
  'egresos:personal',
  'empresas:listar',
  'empresas:recibidos',
  'empresas:remota-pedidos',
  'empresas:resumen',
  'estaciones:listar',
  'export-sales-pdf',
  'fiscal:archivos',
  'inventario:reportes',
  'inventory:movements',
  'inventory:ultima-compra',
  'kds:listar',
  'localhost:diagnostico',
  'localhost:estado',
  'localhost:trabajadores',
  'menu-linea:config',
  'menu-linea:pedidos',
  'multi:estado',
  'multi:excepciones',
  'multi:productos-traspaso',
  'multi:traspasos',
  'multi:usuarios',
  'plataformas:canales',
  'plataformas:listar',
  'produccion:tablero',
  'propinas:historial',
  'puntos:admin',
  'puntos:costo',
  'puntos:estado',
  'puntos:historial',
  'reportes:actividad-horaria',
  'reportes:cierre-dia',
  'reportes:estado-resultados',
  'salon:get',
  'security:by-cashier',
  'security:risk',
  'servicios:comisiones',
  'socios:ejemplo',
  'socios:liquidacion',
  'socios:liquidaciones',
  'socios:movimientos',
  'socios:por-corte',
  'socios:resumen',
  'sp-cash-summary',
  'sp-dead-products',
  'sp-get-daily-sales-current-month',
  'sp-get-daily-sales-last-7-days',
  'sp-get-profit-overview',
  'sp-get-supplier-account-detail',
  'sp-get-suppliers-account',
  'sp-get-top-selling-products',
  'sp-get-total-orders',
  'sp-get-total-sales-month',
  'sp-get-total-sales-today',
  'sp-sales-by-payment',
  'terminal:auditar',
  'ticket:closures',
  'ticket:preview',
  'transferencias:listar',
  'users:list',
  'users:permissions',
  'users:pin-status',
  'whatsapp:config',
];

const MANUAL = {
  'plataformas:guardar': 'Una liquidación se captura con el archivo que descarga la plataforma (miles de pedidos): se sube en su pantalla.',
  'users:create': 'Crear un usuario pide su contraseña o PIN: lo escribe la persona en su pantalla; el asistente no maneja contraseñas.',
  'export-database': 'Saca un archivo de la base a una carpeta que se elige en el diálogo del sistema.',
  'socios:activar': 'Socios se enciende con un asistente de varias preguntas (quiénes son, de quién es cada categoría y producto, cómo se reparte): se contesta en su pantalla.',
  'socios:config-guardar': 'Cambiar esas mismas respuestas de Socios (dueños de cada categoría y reglas de reparto) es el mismo asistente de varias preguntas.',
  'cuentas:cobrada': 'Lo hace Venta sola al cobrar la cuenta de la mesa (cierra la cuenta con la venta en el mismo cobro); no es un paso aparte.',
  'coupons:redeem': 'El cupón se consume solo al cobrar la venta que lo trae (SaleService.checkout); no es un paso aparte.',
  'club:wallet-resolver': 'Se dispara al escanear el pase de la cartera del cliente en la caja: es lectura de un código, no una orden hablada.',
  'dynamics:play': 'La ruleta la gira el cliente en la pantalla de cliente después de pagar; el resultado lo decide SQL, no quien opera.',
  'servicios:orden-enlazar-venta': 'Lo hace Venta sola al cobrar una orden (liga la venta con la orden en el mismo cobro); no es un paso aparte que alguien haga a mano.',
  'egresos:concepto-mover': 'Sube o baja un concepto en la lista: es acomodo visual, se hace arrastrando en la pantalla, no es una operación del negocio.',
  'cloud-delete-account': 'Borra la cuenta de la nube: irreversible, solo desde Configuración.',
  'cloud-ensure-provisioned': 'Alta en la nube: la hace la configuración inicial.',
  'cloud-push-now': 'Sincronización interna con la nube.',
  'cloud-set-anon-key': 'Llave de la nube: no se dice en un chat.',
  'cloud-set-config': 'Conexión con la nube: Configuración.',
  'cloud:unirse-codigo': 'Unirse a una empresa con un código de otra pantalla.',
  'club:sincronizar': 'Sincronización interna con la nube.',
  'compras-doc:aprender': 'Aprende de una factura subida como archivo.',
  'compras-doc:archivo': 'La factura del proveedor se sube como archivo.',
  'devices:set-config': 'Impresora, cajón y báscula: hardware, se prueban en pantalla.',
  'download-update': 'Descarga una versión: va junto con instalarla.',
  'empresas:enlace-codigo': 'Enlazar empresas con un código de otra pantalla.',
  'empresas:enlace-unir': 'Enlazar empresas con un código de otra pantalla.',
  'fiscal-save-config': 'Certificados y llaves del SAT: se suben como archivo.',
  'fiscal-set-issuer-ref': 'Alta del emisor fiscal: Configuración.',
  'fiscal:registrar-emisor': 'Certificados y llaves del SAT: se suben como archivo.',
  'generate-sale-pdf': 'Genera un archivo PDF.',
  'images:set': 'La foto se sube como archivo.',
  'images:sync': 'Sincronización interna de imágenes.',
  'import-database': 'Reemplaza la base completa con un respaldo.',
  'install-update': 'Instala una versión y reinicia la caja.',
  'license:release': 'Liberar la licencia de este equipo.',
  'localhost:emparejar': 'Emparejar un equipo se hace con el código en pantalla.',
  'localhost:firewall': 'Firewall de Windows: pide permisos de administrador del equipo.',
  'localhost:firewall-abrir': 'Firewall de Windows: pide permisos de administrador del equipo.',
  'localhost:red': 'Configuración de red del equipo.',
  'localhost:trabajador-pin': 'Un PIN no se dice en un chat.',
  'localhost:trabajador-qr': 'El QR se escanea en pantalla.',
  'loyalty:evaluate-sale': 'Lo hace la venta sola al cobrar.',
  'menu-linea:imagen-guardar': 'La foto se sube como archivo.',
  'menu-linea:sincronizar': 'Sincronización interna con la nube.',
  'mp-cancel-order': 'Cobro con terminal: es parte de cobrar en Venta.',
  'mp-create-order': 'Cobro con terminal: es parte de cobrar en Venta.',
  'mp-create-pos': 'Alta en Mercado Pago: Configuración.',
  'mp-create-store': 'Alta en Mercado Pago: Configuración.',
  'mp-set-config': 'Token de Mercado Pago: no se dice en un chat.',
  'mp-set-pdv': 'Alta en Mercado Pago: Configuración.',
  'mp-simulate-order': 'Solo para pruebas de Mercado Pago.',
  'mp-validate-token': 'Token de Mercado Pago: no se dice en un chat.',
  'network:prepare': 'Configura la red del equipo (Windows).',
  'network:reveal-password': 'Muestra una contraseña: no se dice en un chat.',
  'payments:set': 'Formas de pago y comisiones de terminal: Configuración.',
  'quickstart:analizar-archivo': 'Carga inicial desde archivos: pantalla de QuickStart.',
  'quickstart:analizar-pegado': 'Carga inicial desde archivos: pantalla de QuickStart.',
  'quickstart:capturar': 'Carga inicial desde archivos: pantalla de QuickStart.',
  'quickstart:carga-manual': 'Carga inicial desde archivos: pantalla de QuickStart.',
  'quickstart:descartar': 'Carga inicial desde archivos: pantalla de QuickStart.',
  'quickstart:ejecutar': 'Carga inicial desde archivos: pantalla de QuickStart.',
  'quickstart:guardar-perfil': 'Carga inicial desde archivos: pantalla de QuickStart.',
  'quickstart:leer-hoja': 'Carga inicial desde archivos: pantalla de QuickStart.',
  'quickstart:otra-hoja': 'Carga inicial desde archivos: pantalla de QuickStart.',
  'quickstart:plantilla': 'Carga inicial desde archivos: pantalla de QuickStart.',
  'quickstart:remapear': 'Carga inicial desde archivos: pantalla de QuickStart.',
  'quickstart:resolver-fila': 'Carga inicial desde archivos: pantalla de QuickStart.',
  'quickstart:resolver-grupo': 'Carga inicial desde archivos: pantalla de QuickStart.',
  'quickstart:soltar-si-vacia': 'Carga inicial desde archivos: pantalla de QuickStart.',
  'quickstart:undo': 'Carga inicial desde archivos: pantalla de QuickStart.',
  'quickstart:undo-check': 'Carga inicial desde archivos: pantalla de QuickStart.',
  'register-release': 'Qué caja es este equipo: se elige con el equipo enfrente.',
  'register-release-admin': 'Qué caja es este equipo: se elige con el equipo enfrente.',
  'register-set-current': 'Qué caja es este equipo: se elige con el equipo enfrente.',
  'sp-import-customers': 'Importación desde un archivo de Excel.',
  'sp-import-products': 'Importación desde un archivo de Excel.',
  'sp-import-sales': 'Importación desde un archivo de Excel.',
  'sp-import-suppliers': 'Importación desde un archivo de Excel.',
  'terminal:activar': 'Terminal bancaria: se configura con el equipo enfrente.',
  'terminal:restaurar': 'Terminal bancaria: se configura con el equipo enfrente.',
  'ticket:guardar-logo': 'El logo se sube como archivo.',
  'users:reset-password': 'Una contraseña no se dice en un chat.',
  'users:set-pin': 'Un PIN no se dice en un chat.',
  'whatsapp:conexion': 'Vincular WhatsApp pide el código que llega al teléfono.',
  'whatsapp:registro': 'Vincular WhatsApp pide el código que llega al teléfono.',
  'whatsapp:telefono': 'Vincular WhatsApp pide el código que llega al teléfono.',
};

const PENDIENTE = {
  'aprobaciones': ['aprobaciones:cancelar', 'aprobaciones:politica-cambiar', 'aprobaciones:solicitar'],
  'configuracion': ['update-business-config'],
  'cloud': ['cloud:crear-sucursal'],
  'fidelizacion': ['club:plan-guardar', 'club:wallet-emitir', 'dynamics:save-segment', 'loyalty:save-campaign', 'loyalty:save-definition', 'puntos:tarjeta-guardar', 'raffles:save'],
  'commercial': ['commercial:save'],
  'ventas': ['devoluciones:cambio', 'sp-update-sale', 'venta-suelta:guardar'],
  'empresas': ['empresas:cambiar', 'empresas:crear', 'empresas:desvincular', 'empresas:enlace-salir', 'empresas:remota-catalogo', 'empresas:remota-pedir'],
  'fiscal': ['fiscal-cancel-invoice', 'fiscal-save-invoice', 'fiscal:cancelar', 'fiscal:timbrar'],
  'impuestos': ['impuestos:guardar'],
  'localhost': ['localhost:activar', 'localhost:cambiar-funcion', 'localhost:renombrar', 'localhost:revocar', 'localhost:trabajador-revocar'],
  'multi': ['multi:excepciones-guardar', 'multi:publicar', 'multi:recibir', 'multi:reglas-guardar', 'multi:traspaso-cancelar', 'multi:traspaso-enviar', 'multi:traspaso-recibir', 'multi:usuario-alcance'],
  'services': ['services:clear', 'services:operate', 'services:set-config'],
  'servicios': ['servicios:activar-activo'],
  'ticket': ['ticket:borrar-logo', 'ticket:email', 'ticket:print-document'],
  'transferencias': ['transferencias:enviar', 'transferencias:recibir-retorno'],
  'whatsapp': ['whatsapp:config-guardar'],
};

/**
 * Planes que ejecuta la PANTALLA y no una función de preload, porque la
 * operación tiene efectos que viven en ella. Cobrar es SaleService.checkout:
 * cotización con ofertas, ticket, cajón, premios y cupones, en el mismo
 * orden que el botón Cobrar. Método de AsistenteService → canal que invoca.
 */
const PANTALLA = {
  cobrar: 'sp-register-sale',
};

/**
 * Canales que hacen LO MISMO que otro que el asistente ya cubre (dos
 * pantallas, dos formas de la misma alta). Canal → el que lo cubre.
 * La prueba exige que el de la derecha esté cubierto.
 */
const EQUIVALE = {
  /* Alta rápida de proveedor desde Inventario; el asistente da de alta con
     sp-supplier-save, que además guarda teléfono, correo y RFC. */
  'sp-add-supplier': 'sp-supplier-save',
};

module.exports = { LECTURA, MANUAL, PENDIENTE, PANTALLA, EQUIVALE };
