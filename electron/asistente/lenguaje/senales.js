'use strict';
/**
 * SEÑALES: patrones de frase que delatan un intent mejor que sus palabras
 * sueltas. «de qué está hecho» es receta aunque diga «está» como «a cómo
 * está»; «la 4 pide la cuenta» es una mesa aunque no diga «mesa».
 *
 * Se prueban contra la frase marcada (con <prod>, <cliente>, <proveedor>…):
 * las palabras de un nombre de producto no cuentan como señal. Una señal sube el puntaje del intent;
 * no lo decide sola: el clasificador sigue votando.
 */
const SENALES = {
  'hosp.cuenta': [/^(?:la|el) (?:\d+|<num>) (?:quiere|pide|ya|cuanto)/, /\bmesa (?:\d+|<num>)/, /\bla (?:\d+|<num>) (?:quiere|pide)/],
  'hosp.mesas': [/\b(?:todas las mesas|mesas (?:abiertas|ocupadas|libres)|el salon|el restaurante)\b/, /\bmesas? (?:faltan|siguen|sin)\b/],
  'hosp.receta': [/\bde que esta hech[oa]\b/, /^(?!.*\bpara <num>).*\bingredientes\b/, /\bque lleva (?:el|la|los|las|un|una) <prod>/, /\breceta\b/],
  'hosp.cocina': [/\bcomandas?\b/, /\ben cocina\b/, /\bla barra\b/, /\bestan? listos?\b.*\b(servir|entregar)\b/],
  'consulta.ganancia': [/\b(?:de|por) cada <prod>/, /\bcada <prod>/, /\b(?:margen|ganancia|utilidad) de (?:la|el|las|los)? ?<prod>/],
  'proveedor.pago': [/^(?:paga|pagale|liquida|liquidale|abonale)\b/, /\b(?:pagale|liquidale|paga lo que le debo)\b/, /^(?:quiero |voy a )?pagar(?:le)? (?:a|al) (?:un )?proveedor/],
  'proveedor.deuda': [/^(?!.*(?:\b(?:paga|pagale|liquida|liquidale|abonale|cobrar)\b|<cl>)).*\b(?:cuanto|que) le debo\b/, /\bestado de cuenta (?:de|con|del) (?:proveedor )?<pv>/],
  'factura.cancelar': [/\bcancel\w* (?:la |una |el )?(?:factura|cfdi)\b/, /\bfactura\b.*\b(?:error|mal|equivocad)/],
  'venta.devolucion': [/\bcancela(?:r)? (?:la|el) (?:venta|ticket)\b/, /\b(?:me )?(?:devolvieron|regresaron|devolvio|regreso)\b/],
  'venta.buscar': [/^(?:busca|muestrame|ensename|detalles? del?)\b.*\b(?:venta|ticket|folio)\b/],
  'venta.reimprimir': [/\breimpr/, /\b(?:imprime|imprimir|imprimelo|saca|sacame|copia)\b.*\b(?:ticket|venta)\b/, /\bno salio el ticket\b/],
  'caja.corte': [/\b(?:haz|hacer|hagamos|hago)\b.*\bcorte\b/, /\b(?:cierra|cerrar|cierro)\b.*\b(?:caja|turno)\b/, /\bconte\b.*\b(?:caja|corte|turno)\b/, /\bcorte\b.*\bcontad/],
  'caja.abrir': [/\b(?:abre|abreme|abrir|abro|inicia|iniciar|empieza|empezar|apertura)\b.*\b(?:caja|turno)\b/],
  'caja.cajon': [/\b(?:abre|abreme|abrir|avienta)\b.*\b(?:cajon|gaveta)\b/],
  'caja.corte_correo': [/\bcorte\b.*\b(?:correo|mail|email)\b/, /\b(?:correo|mail|email)\b.*\bcorte\b/],
  'cliente.cumple': [/\bcumple/],
  'inventario.sin_movimiento': [/\bmenos se vend/, /\bmenos (?:sale|salen|jala)\b/, /\bdejar de (?:comprar|pedir)\b/, /\bno se (?:vende|mueve|mueven|venden)\b/],
  'inventario.agotados': [/\b(?:se acabaron|estan agotad|en cero|en ceros|ya no tengo)\b/],
  'consulta.comprar': [/\bque se (?:me )?va a (?:acabar|agotar|terminar)\b/, /\b(?:voy a necesitar|voy a ocupar|tengo que comprar|hay que comprar|lista de compras|que (?:pido|compro|surto))\b/],
  'compra.pedido': [/^(?!.*\b(?:recibi|llego|llegaron|trajo|entregaron|surtio)\b).*\b(?:productos? de|pedido (?:de|para)|pedirle a|le pido a) <pv>/],
  'compra.registrar': [/\b(?:recibi|llego|llegaron|me trajo|me entregaron|me surtio) (?:el|la|los)? ?(?:pedido|mercancia|camion|factura)?\b.*<pv>/, /\bregistra(?:r)? (?:una |la )?compra\b/],
  'sistema.estado': [/\b(?:disco|respaldo|licencia|impresora|espacio (?:de almacenamiento|en (?:el disco|la computadora)))\b/],
  'venta.comparar': [/\b(?:baje|subi|bajaron|subieron|comparad[oa]|compara|contra (?:la|el) (?:semana|mes))\b/,
                     /\bpor que (?:se )?(?:vendi|vendimos|vendio|vendo|vendieron|bajo|subio|bajaron|subieron|baje|subi|hubo|entro|entraron|gane|ganamos|cayo|cayeron|aumento|aumentaron)\b/],
  'analisis.pronostico': [/\b(?:crees que|calculas que|calcula|estimas que)\b.*\b(?:venda|vendamos|entre|vendo|vendere)\b/, /\b(?:voy a vender|vamos a vender|venderemos|vendere|se va a vender|se van a vender|espero vender|esperar vender|pronostico|proyeccion)\b/,
                          /\bcuant[oa]s? (?:<prod> )?(?:hago|preparo|horneo|produzco|saco) (?:para )?(?:manana|el|hoy|pasado)\b/],
  'analisis.agotar': [/\bcuando se (?:me )?(?:acaba|acabara|termina|terminara|agota|agotara)\b/, /\bpara cuant[oa]s dias\b/,
                      /\bcuant[oa]s? (?:dias )?me (?:alcanza|dura|duran|alcanzan)\b/, /\bhasta cuando me (?:alcanza|dura)\b/],
  'analisis.simular': [/^(?:y )?(?:si|que pasa si|que pasaria si|que tal si|y si|me conviene|conviene|cuanto ganaria si|simula)\b.*\b(?:subo|bajo|pongo|cobro|subiera|bajara|subimos|bajamos|subir|bajar|vendo|vendiera|dejo|dejara)\b/,
                       /\bsimula\b/, /\b(?:ganaria|perderia|que pasaria)\b/],
  'finanzas.resultado': [/\bmenos (?:costos|gastos)\b/, /\b(?:neta|neto|limpio|despues de (?:gastos|pagar)|gastos con lo que vendo|me conviene (?:seguir|el negocio|la tienda|tener)|vale la pena|numeros rojos)\b/],
  'finanzas.ganancia': [/\b(?:cuanto (?:he )?gane|ganancia (?:del (?:mes|dia)|de la semana|de hoy|bruta)|cuanto deja (?:el negocio|la venta))\b/],
  'gasto.resumen': [/\bcuanto (?:se ha ido|se va|he pagado|pago) (?:en|de)\b/],
  'inventario.traspaso': [/\b(?:transfier|traspas)/],
  'inventario.valor': [/\b(?:surtir todo|reponer todo|valor del inventario|cuanto vale (?:mi|lo que|todo))\b/],
  'inventario.movimientos': [/\bpor que (?:tengo|hay|me faltan) menos\b/, /\bpor que (?:me )?faltan <prod>/, /\b(?:kardex|movimientos)\b/],
  'inventario.ajuste': [/^ajusta/, /\b(?:en realidad|en fisico|el fisico|conte)\b/],
  'producto.crear': [/^(?:crea|crear|creame|da de alta|dar de alta|agrega|nuevo producto)\b(?!.*(?:<prod>|\bclientes?\b|\bproveedor(?:es)?\b|\bfondo\b|\bcaja\b|\bcajon\b|\bdistribuidora\b|<num>|<dinero> (?:a|al) (?:la )?caja))/],
  'cliente.alta': [/^(?:agrega|crea|registra|da de alta|nuevo)\b.*\bcliente\b/],
  'proveedor.alta': [/^(?:agrega|crea|registra|da de alta|nuevo)\b.*\b(?:proveedor|distribuidora)\b/],
  'produccion.faltantes': [/\bfalta\w* (?:para|de) (?:hacer |producir |preparar )?<num>/, /\balcanza\w*\b.*\bpara <num>/, /\bingredientes (?:para|que faltan para) <num>/],
  'producto.info': [/\b(?:a como|cuanto (?:sale|vale|cuesta)) (?:el|la|los|las|un|una)? ?(?:kilo de |orden de )?<prod>$/],
  'venta.top': [/\bcuanto (?:vendi|se ha vendido|se vendio|he vendido) de <prod>/, /\bcuant[oa]s <prod> (?:vendi|se vendieron|hice|vendimos)/],
  'personal.ventas': [/^(?:y )?cuanto (?:cobro|vendio|ha vendido|lleva) (?!<prod>|de\b|el <prod>|la <prod>|los <prod>|las <prod>)[a-z]+ (?:hoy|ayer|esta|este|la|el)\b/, /^(?:y )?quien (?:vende|vendio|cobra|cobro) mas\b/, /\bque cajer[oa] (?:vende|vendio|cobra) mas\b/],
  'produccion.hoy': [/\b(?:se hicieron|hicimos|se produjeron|se hornearon|salieron del horno)\b/],
  'compra.ultima': [/\ba como (?:lo |la |los |las |me )?(?:compre|compramos|dieron|vendieron)\b/],
  'consulta.hoy': [/^(?:las )?ventas (?:de|del) (?:la |el |este |esta )?(?:semana|mes|ano|anio|dia|hoy|ayer)/, /\b(?:ticket|compra) promedio\b/, /\bcuant[oa]s? (?:clientes|gente|personas) (?:atendimos|vinieron|ha comprado|compraron)\b/],
  'servicios.profesional': [/\b(?:hizo|atendio|cobro) <pf>|<pf> (?:hizo|atendio)\b/, /\b(?:profesionales|estilista|estilistas|barbero|barberos)\b/],
  'cita.cancelar': [/\bcancela\w* (?:la |una |su )?cita\b/, /\bno va a poder venir\b/, /\bya no viene\b/],
  'cita.lista': [/\b(?:confirmad[oa]|confirmar) (?:su )?cita/],
  'producto.precio': [/^(?:pon|ponle|deja|dejale) (?:el|la|los|las)? ?<prod> (?:a|en) <dinero>$/, /^(?!.*\b(?:si|ganaria|conviene|simula)\b).*\bprecio\b.*<dinero>/],
  'consulta.pendientes': [/^(?:hay )?(?:algun|algo de)? ?problemas?(?: hay)?$/, /\balertas?\b(?!.*\b(?:sistema|respaldo)\b)/, /^(?!.*\b(?:citas?|ordenes|pedidos|facturas|comandas|pagos|cobros)\b).*\bpendientes?\b/],
  'saludo': [/^(?:como estas|como te va|como andas|que tal estas)\b/],
  'ayuda': [/^(?:eres|quien eres|que eres|como te (?:uso|llamas|hablo|pido))\b/, /\beste chat\b/],
};

/** Intents cuya señal aparece en la frase. */
function senalesDe(norm, marcados) {
  /* Las marcas de persona se acortan (<pv>, <cl>, <pf>) para que la palabra
     «proveedor» de una señal no se encuentre dentro de la marca <proveedor>. */
  const m = marcados.join(' ').replace(/<proveedor>/g, '<pv>').replace(/<cliente>/g, '<cl>').replace(/<profesional>/g, '<pf>');
  const out = new Set();
  for (const [id, res] of Object.entries(SENALES)) if (res.some((re) => re.test(m))) out.add(id);
  return out;
}

module.exports = { SENALES, senalesDe };
