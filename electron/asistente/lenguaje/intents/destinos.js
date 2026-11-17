'use strict';
/**
 * Pantallas a las que Wybix puede llevar: palabras → ruta del dashboard.
 * El orden importa: lo más específico primero («registrar una compra» antes
 * que «compras», «corte» antes que «caja»).
 */
const DESTINOS = [
  [/\b(registrar una compra|registrar compra|nueva compra|capturar compra|meter compra)\b/, '/dashboard/registrarCompra', 'Registrar compra'],
  [/\b(historial de compras|compras anteriores|lista de compras hechas)\b/, '/dashboard/tablaCompra', 'Historial de compras'],
  [/\b(historial de ventas|ventas anteriores|tickets anteriores|lista de ventas)\b/, '/dashboard/tablaVenta', 'Historial de ventas'],
  [/\b(estado de resultados|resultados)\b/, '/dashboard/estado-resultados', 'Estado de resultados'],
  [/\b(pagos? al personal|nominas?|sueldos)\b/, '/dashboard/pagos-personal', 'Pagos al personal'],
  [/\b(ordenes de servicio|orden de servicio|taller)\b/, '/dashboard/ordenes-de-servicio', 'Órdenes de servicio'],
  [/\b(pedidos en linea|pedidos de internet|menu en linea|pedidos)\b/, '/dashboard/pedidos-en-linea', 'Pedidos en línea'],
  [/\b(lista de precios|precios)\b/, '/dashboard/inventario/precios', 'Precios'],
  [/\b(ofertas|promociones)\b/, '/dashboard/inventario/ofertas', 'Ofertas'],
  [/\b(conteo|contar inventario|inventario fisico)\b/, '/dashboard/conteo', 'Conteo de inventario'],
  [/\b(traspasos?|transferencias?)\b/, '/dashboard/traspasos', 'Traspasos'],
  [/\b(formulas?)\b/, '/dashboard/produccion/formulas', 'Fórmulas de producción'],
  [/\b(inventario|productos?|existencias?|almacen|bodega)\b/, '/dashboard/inventario', 'Inventario'],
  [/\b(compras?)\b/, '/dashboard/compras', 'Compras'],
  [/\b(corte|cortes|cierre de caja)\b/, '/dashboard/corte-dia', 'Corte de caja'],
  [/\b(cierre del dia|cierre de dia|cierre)\b/, '/dashboard/cierre-dia', 'Cierre del día'],
  [/\b(ventas?|vender|caja|cobrar|punto de venta)\b/, '/dashboard/venta', 'Venta'],
  [/\b(clientes?|fiados?)\b/, '/dashboard/clientes', 'Clientes'],
  [/\b(proveedores?)\b/, '/dashboard/proveedores', 'Proveedores'],
  [/\b(gastos?|egresos?)\b/, '/dashboard/egresos', 'Gastos'],
  [/\b(facturas?|facturacion|timbrar)\b/, '/dashboard/facturacion', 'Facturación'],
  [/\b(produccion|tandas?|hornear)\b/, '/dashboard/produccion', 'Producción'],
  [/\b(recetas?|menu)\b/, '/dashboard/recetas', 'Recetas'],
  [/\b(mesas?|salon)\b/, '/dashboard/mesas', 'Mesas'],
  [/\b(cocina|comandas?|kds)\b/, '/dashboard/cocina', 'Cocina'],
  [/\b(agenda|citas?)\b/, '/dashboard/agenda', 'Agenda'],
  [/\b(profesionales|estilistas|barberos)\b/, '/dashboard/profesionales', 'Profesionales'],
  [/\b(servicios)\b/, '/dashboard/servicios', 'Servicios'],
  [/\b(comisiones)\b/, '/dashboard/comisiones', 'Comisiones'],
  [/\b(propinas?)\b/, '/dashboard/propinas', 'Propinas'],
  [/\b(asistencia|checador|checadas)\b/, '/dashboard/asistencia', 'Asistencia'],
  [/\b(fidelizacion|puntos|lealtad|monedero)\b/, '/dashboard/fidelizacion', 'Fidelización'],
  [/\b(eventos)\b/, '/dashboard/eventos', 'Eventos'],
  [/\b(liquidaciones|plataformas|rappi|uber|didi)\b/, '/dashboard/liquidaciones', 'Liquidaciones'],
  [/\b(socios)\b/, '/dashboard/socios', 'Socios'],
  [/\b(usuarios|empleados|cajeros)\b/, '/dashboard/usuarios', 'Usuarios'],
  [/\b(importar|importador)\b/, '/dashboard/importador', 'Importador'],
  [/\b(empresas|sucursales)\b/, '/dashboard/empresas', 'Empresas'],
  [/\b(configuracion|ajustes|opciones|impresora)\b/, '/dashboard/configuracion', 'Configuración'],
  [/\b(reportes?|estadisticas|numeros|graficas)\b/, '/dashboard/estadisticas', 'Estadísticas'],
  [/\b(alertas|avisos)\b/, '/dashboard/alertas', 'Alertas'],
  [/\b(inicio|principal|home)\b/, '/dashboard/inicio', 'Inicio'],
];

module.exports = { DESTINOS };
