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

/* Campos que comparten cliente y proveedor. */
const vacio = (que) => (v) => (v ? v : `sin ${que}`);
const campoNombre = (col) => ({
  etiqueta: 'Nombre', dicho: 'el nombre', leer: (r) => r[col] || '', mostrar: (v) => `«${v}»`,
  validar: (v) => (!String(v || '').trim() ? 'El nombre no puede quedar vacío.' : String(v).length > 100 ? 'El nombre es muy largo.' : null),
});
const campoTelefono = (col) => ({
  etiqueta: 'Teléfono', dicho: 'el teléfono', leer: (r) => r[col] || '', mostrar: vacio('teléfono'),
  validar: (v) => (v && !/^\d{10}$/.test(String(v)) ? 'El teléfono va con 10 dígitos.' : null),
});
const campoCorreo = (col) => ({
  etiqueta: 'Correo', dicho: 'el correo', leer: (r) => r[col] || '', mostrar: vacio('correo'),
  validar: (v) => (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v)) ? 'Ese correo no se ve bien (algo@dominio.com).' : null),
});
const campoRfc = (col) => ({
  etiqueta: 'RFC', dicho: 'el RFC', leer: (r) => r[col] || '', mostrar: vacio('RFC'),
  validar: (v) => (v && !/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(String(v)) ? 'El RFC lleva 12 o 13 caracteres (persona moral o física).' : null),
});

/** Ficha del cliente: sp-update-customer recibe la ficha completa, en orden. */
function argsCliente(c, cambios = {}) {
  const x = { ...c, ...cambios };
  return [c.id, x.code ?? '', x.customerName, x.tax_id ?? null, x.email ?? '', x.phone ?? '', Number(x.credit_limit) || 0, Number(x.terms_days) || 0,
          x.active === false || x.active === 0 ? 0 : 1, x.regimen_fiscal ?? null, x.uso_cfdi ?? null, x.razon_social ?? null,
          Number(x.grace_days) || 0, Number(x.late_fee_pct) || 0, Number(x.late_fee_fixed) || 0, Number(x.risk_level) || 0];
}

const cliente = {
  canal: 'sp-update-customer', api: 'electronAPI.updateCustomer', nombreDe: (c) => c.customerName,
  leerSql: `SELECT id, code, customerName, tax_id, email, phone, credit_limit, terms_days, active, regimen_fiscal, uso_cfdi, razon_social,
                   grace_days, late_fee_pct, late_fee_fixed, risk_level FROM dbo.customers WHERE id = @id;`,
  ejecutar: (c, cambios) => ({ api: 'electronAPI.updateCustomer', args: argsCliente(c, cambios) }),
  permiso: 'VENTAS_OPERAR',
  campos: {
    nombre: { ...campoNombre('customerName'), cambios: (v) => ({ customerName: String(v).trim() }) },
    telefono: { ...campoTelefono('phone'), cambios: (v) => ({ phone: v || '' }) },
    correo: { ...campoCorreo('email'), cambios: (v) => ({ email: v || '' }) },
    rfc: { ...campoRfc('tax_id'), cambios: (v) => ({ tax_id: v || null }) },
    limite: {
      etiqueta: 'Límite de crédito', dicho: 'el límite de crédito', permiso: 'CREDITO_CUPONES',
      leer: (c) => Number(c.credit_limit) || 0, mostrar: dinero, igual: (a, b) => Math.abs(Number(a) - Number(b)) < 0.005,
      validar: (v) => (!(Number(v) >= 0) ? 'El límite tiene que ser de cero o más.' : null), cambios: (v) => ({ credit_limit: Number(v) }),
    },
    dias: {
      etiqueta: 'Días de crédito', dicho: 'los días de crédito', permiso: 'CREDITO_CUPONES',
      leer: (c) => Number(c.terms_days) || 0, mostrar: (v) => `${v} días`, igual: (a, b) => Number(a) === Number(b),
      validar: (v) => (!(Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 365) ? 'Los días de crédito van de 0 a 365.' : null),
      cambios: (v) => ({ terms_days: Number(v) }),
    },
  },
};

const proveedor = {
  canal: 'sp-supplier-save', api: 'electronAPI.supplierSave', nombreDe: (p) => p.nombre,
  leerSql: 'SELECT id, nombre, telefono, correo, rfc FROM dbo.CAT_suppliers WHERE id = @id;',
  ejecutar: (p, cambios) => {
    const x = { ...p, ...cambios };
    return { api: 'electronAPI.supplierSave', payload: { id: p.id, nombre: x.nombre, telefono: x.telefono || null, correo: x.correo || null, rfc: x.rfc || null } };
  },
  permiso: 'INVENTARIO_OPERAR',
  campos: {
    nombre: { ...campoNombre('nombre'), cambios: (v) => ({ nombre: String(v).trim() }) },
    telefono: { ...campoTelefono('telefono'), cambios: (v) => ({ telefono: v || null }) },
    correo: { ...campoCorreo('correo'), cambios: (v) => ({ correo: v || null }) },
    rfc: { ...campoRfc('rfc'), cambios: (v) => ({ rfc: v || null }) },
  },
};

/**
 * Editar un campo de una ficha (cliente, proveedor): permiso, validación,
 * «ya lo tiene», y la tarjeta antes → después con el canal de la pantalla.
 */
async function editarFicha(h, ctx, { ent, tipo, id, campo, nuevo, intent }) {
  const reg = await h.uno(ent.leerSql, [h.id(id)]);
  if (!reg) return h.msg(`No encontré a ese ${tipo}.`);
  const def = ent.campos[campo];
  if (!def) return h.msg(`Ese dato del ${tipo} todavía no lo cambio yo: hazlo en su pantalla.`);
  if (def.permiso && !ctx.puede(def.permiso)) return h.msg(`Tu usuario no puede cambiar ${def.dicho}. Pídeselo a un encargado.`);
  const error = def.validar(nuevo);
  if (error) return h.msg(error);
  const antes = def.leer(reg);
  if (def.igual ? def.igual(antes, nuevo) : String(antes ?? '') === String(nuevo ?? '')) return h.msg(`${ent.nombreDe(reg)} ya tiene ${def.dicho} ${def.mostrar(nuevo)}.`);
  return h.msg('Esto voy a cambiar:', { plan: h.plan(intent, {
    titulo: `${ent.nombreDe(reg)} · ${def.dicho.replace(/^(el|la|los|las) /, '')}`,
    vista: [{ etiqueta: def.etiqueta, valor: `${def.mostrar(antes)} → ${def.mostrar(nuevo)}` }],
    ejecutar: ent.ejecutar(reg, def.cambios(nuevo)), permiso: def.permiso || ent.permiso,
  }) });
}

module.exports = { producto, cliente, proveedor, editarFicha, payloadProducto, dinero, pct };
