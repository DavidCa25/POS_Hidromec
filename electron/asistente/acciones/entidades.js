/**
 * FICHAS QUE EL ASISTENTE PUEDE EDITAR
 *
 * Una entidad dice qué campos tiene, cómo se muestra el valor de ahora, qué
 * permiso pide cambiarlo y cómo se arma el payload del MISMO canal que usa la
 * pantalla. El asistente nunca escribe en la base: arma una tarjeta y, al
 * confirmar, la pantalla llama al canal de siempre (con sus permisos,
 * autorizaciones, candados de sucursal y bitácora).
 *
 * Agregar un campo editable es agregar una entrada aquí y su forma de decirlo
 * en lenguaje/edicion.js.
 */
'use strict';

const dinero = (n) => `$${Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (t) => (t == null ? 'sin definir' : Number(t) === 0 ? '0% / exento' : `${Math.round(Number(t) * 100)}%`);

/** Lo que el canal sp-update-product necesita siempre: la ficha tal como está. */
function payloadProducto(p, cambios = {}) {
  return {
    product_id: p.id, nombre: p.nombre, precio: Number(p.price), stock: Number(p.stock) || 0, numero_parte: p.part_number || '',
    bar_code: p.bar_code ?? null, clave_prod_serv: p.clave_prod_serv ?? null, clave_unidad: p.clave_unidad ?? null,
    objeto_impuesto: p.objeto_impuesto ?? null, tasa_iva: p.tasa_iva ?? null,
    ...cambios,
  };
}

const producto = {
  canal: 'sp-update-product',
  api: 'electronAPI.actualizarProducto',
  payload: payloadProducto,
  campos: {
    nombre: {
      etiqueta: 'Nombre', dicho: 'el nombre',
      leer: (p) => p.nombre,
      mostrar: (v) => `«${v}»`,
      validar: (v) => (!String(v || '').trim() ? 'El nombre no puede quedar vacío.' : String(v).length > 100 ? 'El nombre es muy largo (100 letras máximo).' : null),
      cambios: (v) => ({ nombre: String(v).trim() }),
    },
    costo: {
      etiqueta: 'Costo sin IVA', dicho: 'el costo',
      permiso: 'VER_COSTOS',
      leer: (p) => Number(p.cost) || 0,
      mostrar: dinero,
      validar: (v) => (!(Number(v) >= 0) ? 'El costo tiene que ser un número de cero o más.' : null),
      igual: (a, b) => Math.abs(Number(a) - Number(b)) < 0.005,
      cambios: (v) => ({ cost: Number(v) }),
    },
    codigo_barras: {
      etiqueta: 'Código de barras', dicho: 'el código de barras',
      leer: (p) => p.bar_code || '',
      mostrar: (v) => (v ? v : 'sin código'),
      validar: (v) => (String(v).length > 50 ? 'El código es muy largo.' : null),
      cambios: (v) => ({ bar_code: v || '' }),
    },
    sku: {
      etiqueta: 'Número de parte (SKU)', dicho: 'el número de parte',
      leer: (p) => p.part_number || '',
      mostrar: (v) => (v ? v : 'sin número de parte'),
      validar: (v) => (!String(v || '').trim() ? 'El número de parte no puede quedar vacío.' : String(v).length > 100 ? 'El número de parte es muy largo.' : null),
      cambios: (v) => ({ numero_parte: String(v).trim() }),
    },
    iva: {
      etiqueta: 'IVA', dicho: 'el IVA',
      leer: (p) => (p.tasa_iva == null ? null : Number(p.tasa_iva)),
      mostrar: pct,
      validar: (v) => (![0, 0.08, 0.16].includes(Number(v)) ? 'El IVA puede ser 16%, 8% (frontera) o 0% / exento.' : null),
      igual: (a, b) => a != null && Math.abs(Number(a) - Number(b)) < 0.0001,
      cambios: (v) => ({ tasa_iva: Number(v) }),
    },
  },
};

module.exports = { producto, payloadProducto, dinero, pct };
