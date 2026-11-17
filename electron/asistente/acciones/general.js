'use strict';
/* Conversación, ayuda, navegación, pendientes y el estado del sistema. */
const { DESTINOS } = require('../lenguaje/intents');
const { normalizar } = require('../lenguaje/normalizar');

/* Cómo se hace cada cosa en Wybix: la pantalla y el paso clave. */
const COMO = [
  [/devoluci|devolver|reembolso|cancelar una venta|cancelo una venta/, '/dashboard/venta', 'En Venta, toca «Devolución», busca el ticket por folio y elige qué regresa. Pide autorización si tu usuario no tiene el permiso.'],
  [/factur|timbr/, '/dashboard/facturacion', 'En Facturación eliges la venta por folio, capturas los datos fiscales del cliente y timbras.'],
  [/corte|cerrar (?:la )?caja|arqueo/, '/dashboard/corte-dia', 'En Corte de caja cuentas el efectivo, Wybix lo compara con lo esperado y cierras el turno.'],
  [/compra|surti|factura de compra/, '/dashboard/registrarCompra', 'En Registrar compra eliges al proveedor, agregas los productos con su costo y guardas: la existencia sube sola.'],
  [/precio/, '/dashboard/inventario/precios', 'En Precios buscas el producto y cambias el precio; también puedes pedírmelo aquí: «sube la coca a 22».'],
  [/producto|articulo/, '/dashboard/inventario', 'En Inventario, «Nuevo producto». O dímelo aquí: «crea pay de queso a 45».'],
  [/cliente|credito/, '/dashboard/clientes', 'En Clientes, «Nuevo cliente». El crédito (fiado) se asigna en su ficha.'],
  [/proveedor/, '/dashboard/proveedores', 'En Proveedores, «Nuevo proveedor». Los pagos se registran en su estado de cuenta, o aquí: «págale 500 a Bimbo».'],
  [/gasto|egreso/, '/dashboard/egresos', 'En Gastos eliges el concepto, el monto y cómo se pagó. O dímelo aquí: «pagué 850 de luz».'],
  [/cambio a la caja|meto|entrada|saco|retiro|salida/, '/dashboard/venta', 'Desde Venta: «Entrada de efectivo» o «Retiro». O aquí: «mete 500 de cambio».'],
  [/conteo|inventario fisico|contar/, '/dashboard/conteo', 'En Conteo de inventario capturas lo que hay en físico y Wybix ajusta las diferencias.'],
  [/traspaso|transferencia|sucursal/, '/dashboard/traspasos', 'En Traspasos eliges la sucursal destino y los productos; la otra sucursal lo recibe.'],
  [/receta|ingrediente|formula/, '/dashboard/recetas', 'En Recetas eliges el producto y le agregas sus ingredientes con la cantidad que lleva cada uno.'],
  [/cita|agenda/, '/dashboard/agenda', 'En Agenda tocas el horario libre del profesional y eliges cliente y servicio. O aquí: «agenda a Laura mañana a las 5».'],
  [/mesa|comanda|cuenta/, '/dashboard/mesas', 'En Mesas abres la mesa, agregas lo que piden y «Enviar a cocina». La cuenta se cobra desde la misma mesa.'],
  [/oferta|descuento|promocion/, '/dashboard/inventario/ofertas', 'En Ofertas creas la promoción, eliges los productos y las fechas.'],
  [/usuario|permiso|cajero/, '/dashboard/usuarios', 'En Usuarios das de alta a la persona y eliges su rol y sus permisos.'],
  [/impresora|cajon|ticket|configur/, '/dashboard/configuracion', 'En Configuración, sección Equipo: impresora de tickets y cajón de dinero.'],
  [/import|excel/, '/dashboard/importador', 'En el Importador subes tu archivo de Excel y relacionas las columnas.'],
  [/respald/, '/dashboard/configuracion', 'En Configuración, Respaldos: activa el respaldo automático y elige la carpeta.'],
  [/propina/, '/dashboard/propinas', 'En Propinas ves lo que se juntó y haces el reparto.'],
  [/punto|lealtad|monedero/, '/dashboard/fidelizacion', 'En Fidelización eliges cómo se ganan y se canjean los puntos.'],
  [/reporte|venta.* mes|estadistic/, '/dashboard/estadisticas', 'En Estadísticas ves las ventas por día, por producto y por forma de pago. O pregúntame: «¿cómo voy este mes?».'],
];

module.exports = (h) => ({
  /* El saludo es el resumen del día (acciones/resumen.js): al abrir el chat
     la primera vez del día, y cada vez que lo saludan. */
  async saludo(_it, ctx) {
    return h.resumen.briefing(ctx);
  },

  async ayuda() {
    return h.msg('Soy Wybix. Conozco tu negocio: ventas, caja, inventario, compras, proveedores, clientes, gastos y más. Escríbeme como le hablarías a tu encargado, por ejemplo:', {
      opciones: [
        { etiqueta: '¿Cómo voy hoy?', texto: '¿Cómo voy hoy?' },
        { etiqueta: '¿Qué me falta comprar?', texto: '¿Qué me falta comprar?' },
        { etiqueta: '¿Quién me debe?', texto: '¿Quién me debe?' },
        { etiqueta: '¿Cuánto hay en caja?', texto: '¿Cuánto hay en caja?' },
        { etiqueta: 'Pagué 850 de luz', texto: 'Pagué 850 de luz' },
        { etiqueta: '¿Qué debo revisar?', texto: '¿Qué pendientes tengo?' },
      ] });
  },

  async 'ayuda.como'(it) {
    const texto = normalizar(it.texto || it.slots.destino?.texto || '').texto;
    const c = COMO.find(([re]) => re.test(texto));
    /* Explica y ofrece llevar; no navega solo (la persona preguntó cómo, no pidió ir). */
    if (c) return h.msg(c[2], { opciones: [{ etiqueta: 'Llévame ahí', intent: 'ir_a', params: { ruta: c[1] } }] });
    const d = it.slots.destino;
    if (d?.valor) return h.msg(`Eso está en ${d.texto}.`, { opciones: [{ etiqueta: `Ir a ${d.texto}`, intent: 'ir_a', params: { ruta: d.valor, etiqueta: d.texto } }] });
    return h.msg('Dime qué quieres hacer y te digo dónde, o abre «Recorridos» en Wybix Guide para verlo paso a paso.');
  },

  async ir_a(it) {
    const d = it.slots.destino;
    const dest = DESTINOS.find(([, ruta]) => ruta === d.valor);
    return h.ir(`Te llevo a ${dest ? dest[2] : d.texto}.`, d.valor);
  },

  async 'consulta.pendientes'(_it, ctx) {
    const hs = (await h.listarHallazgos(ctx)).slice(0, 5);
    if (!hs.length) return h.msg('Todo en orden por aquí. Te aviso si algo cambia.', { tono: 'exito' });
    return h.msg(`Tienes ${h.plural(hs.length, 'cosa')} por revisar. La más urgente primero:`, {
      opciones: hs.map((x) => ({ etiqueta: x.titulo, intent: 'hallazgo.ver', params: { id: x.id } })), tono: 'atencion' });
  },

  async 'sistema.estado'() {
    const s = await h.sistema();
    const datos = [];
    const mal = [];
    if (s.respaldo) {
      const cuando = s.respaldo.ultimo ? h.fechaCorta(s.respaldo.ultimo) : 'nunca';
      datos.push({ etiqueta: 'Respaldo', valor: s.respaldo.activo ? `automático · último ${cuando}` : 'apagado' });
      if (!s.respaldo.activo || s.respaldo.error) mal.push('el respaldo');
    }
    if (s.nube) {
      datos.push({ etiqueta: 'Nube', valor: !s.nube.activa ? 'no configurada' : s.nube.pendientes ? `${s.nube.pendientes} cambios por subir` : 'al día' });
      if (s.nube.activa && s.nube.error) mal.push('la nube');
    }
    if (s.licencia) {
      datos.push({ etiqueta: 'Licencia', valor: s.licencia.dias != null ? `${s.licencia.dias} días` : (s.licencia.modo || '—') });
      if (s.licencia.relojAtrasado) mal.push('la hora de la computadora');
    }
    if (s.impresora) { datos.push({ etiqueta: 'Impresora', valor: s.impresora.configurada ? 'configurada' : 'sin configurar' }); if (!s.impresora.configurada) mal.push('la impresora'); }
    if (s.disco) { datos.push({ etiqueta: 'Disco libre', valor: `${s.disco.libreGB} GB` }); if (s.disco.libreGB < 5) mal.push('el espacio en disco'); }
    return h.msg(mal.length ? `Hay que revisar ${mal.join(', ')}.` : 'Todo el sistema está en orden.', {
      datos, tono: mal.length ? 'atencion' : 'exito',
      opciones: mal.length ? [{ etiqueta: 'Abrir configuración', intent: 'ir_a', params: { ruta: '/dashboard/configuracion' } }] : [] });
  },
});
