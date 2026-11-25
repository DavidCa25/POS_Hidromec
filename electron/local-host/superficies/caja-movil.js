/**
 * CAJA_MOVIL — Wybix POS Mobile como una caja más de esta sucursal (0094).
 *
 * No es una página que sirva Local Host: es la app nativa. Por eso no tiene
 * consultas ni acciones de superficie; habla por /api/caja/* (servidor.js)
 * con el mismo contrato que la nube (caja-movil.js). Se registra aquí para
 * que se empareje, se liste, se renombre y se revoque como cualquier
 * dispositivo del Local Host.
 *
 * Las personas entran en la tablet con su PIN, sin red: el personal con PIN
 * llega en el snapshot (sp_staff_publication), igual que a un evento.
 */
module.exports = function cajaMovil() {
  return {
    tipo: 'CAJA_MOVIL',
    familia: 'ESTACION',
    nombre: 'Caja móvil (Wybix POS Mobile)',
    descripcion: 'Una caja más en una tablet o teléfono: vende con el mismo inventario, precios y corte',
    icono: 'device-mobile',
    identidad: 'NINGUNA',
    sonido: null,
    fuentes: [],
    disponible: () => true,
    async estado() {
      return { app: 'Abre Wybix POS Mobile en la tablet: esta función no es una página.' };
    },
  };
};
