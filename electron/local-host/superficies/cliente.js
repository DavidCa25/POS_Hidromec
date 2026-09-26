/**
 * CUSTOMER_STATUS — la pantalla de pedidos que ve el cliente (una TV o una
 * tablet DEL NEGOCIO; el telefono del cliente no es de esta fase).
 *
 * Es la superficie mas expuesta, asi que es la mas pobre a proposito:
 *   - solo lectura: no tiene ninguna accion; cualquier POST se rechaza;
 *   - solo esto viaja: numero de pedido, PREPARANDO/LISTO y, si el negocio lo
 *     elige, la mesa. Nunca un nombre (la etiqueta de un «para llevar» suele
 *     ser el nombre del cliente), ni total, ni telefono, ni nada administrativo;
 *   - el numero es el DEL DIA (`hosp_cuentas.numero_dia`, 0046): el mismo que
 *     lleva impreso el ticket del cliente y que la caja le dice al cobrar. El
 *     id interno de la cuenta no lo conoce nadie fuera de la base;
 *   - solo salen las cuentas sin mesa (mostrador, para llevar): a una mesa le
 *     lleva la comida el mesero. Con «incluir mesas», salen tambien, por su
 *     nombre;
 *   - la credencial del dispositivo manda: conocer la IP, el puerto o las URLs
 *     no da nada sin ella, y con ella solo da esto.
 *
 * El estado sale de las comandas reales de Hospitality: PREPARANDO mientras
 * alguna este NUEVA o PREPARANDO; LISTO cuando todas estan listas. Un pedido
 * LISTO desaparece a los N minutos (config, 10 por omision) o al entregarse.
 */
const { pedidosPublicos, MIN_LISTO } = require('./pedidos-dia');

module.exports = function cliente() {
  const config = (ctx) => ({
    minutosListo: Math.min(60, Math.max(1, Number(ctx.disp.config?.minutosListo) || MIN_LISTO)),
    mostrarMesa: ctx.disp.config?.mostrarMesa === true,
    sonido: ctx.disp.config?.sonido === true,
    mensaje: typeof ctx.disp.config?.mensaje === 'string' ? ctx.disp.config.mensaje.slice(0, 80) : null,
  });

  return {
    tipo: 'CUSTOMER_STATUS',
    familia: 'PUBLICA',
    nombre: 'Estado de pedidos',
    descripcion: 'La pantalla que ve el cliente: «Pedido 42 · Listo»',
    icono: 'monitor-play',
    identidad: 'NINGUNA',
    sonido: 'Opcional: cuando un pedido pasa a Listo',
    fuentes: ['comandas'],
    disponible: (c) => c.comandas,

    async estado(ctx) {
      const cfg = config(ctx);
      const { pedidos, negocio } = await pedidosPublicos(await ctx.pool(), { mesas: cfg.mostrarMesa, minutosListo: cfg.minutosListo });
      return { pedidos, negocio, mensaje: cfg.mensaje, reposo: { preparando: pedidos.filter(p => p.estado === 'PREPARANDO').length, listos: pedidos.filter(p => p.estado === 'LISTO').length } };
    },

    evento(cambio, ctx) {
      if (cambio.fuente !== 'comandas') return null;
      const sonar = config(ctx).sonido && cambio.fila.estado === 'LISTA' && cambio.anterior !== 'LISTA';
      return { tipo: 'CUSTOMER_ORDER_STATUS_UPDATED', sonar };
    },
  };
};
