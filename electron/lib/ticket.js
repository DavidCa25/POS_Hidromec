/**
 * Construye el HTML del ticket de venta.
 *
 * POR QUE UN SOLO MODULO
 * ----------------------
 * Habia DOS constructores casi identicos: uno para el PDF de la venta y otro
 * para imprimir. Los dos rellenaban la misma plantilla, los dos calculaban el
 * IVA dividiendo el total entre 1.16 y los dos incrustaban el logo de otro
 * cliente. Arreglar uno dejaba el otro roto, que es exactamente lo que pasa
 * cuando la misma decision vive en dos sitios.
 *
 * Modulo puro: recibe datos y devuelve texto. No lee la base ni toca Electron,
 * asi que se puede ejercitar desde una prueba sin abrir una ventana.
 *
 * IMPUESTOS
 * ---------
 * El desglose se calcula LINEA POR LINEA con la tasa de cada producto. La
 * version anterior suponia que todo lleva IVA general: en una venta con algo
 * exento, el ticket declaraba un impuesto que nadie cobro. Cuando la linea no
 * trae su tasa -tickets de un origen viejo- se cae a la tasa general, que es
 * lo que se hacia antes: nada empeora.
 */

const IVA_GENERAL = 0.16;

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function dinero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
}

/** Tasa que aplica a una linea. 0 si el producto no es objeto de impuesto. */
function tasaDeLinea(l) {
  const objeto = l?.objeto_impuesto;
  if (objeto != null && String(objeto) !== '02') return 0;
  const t = Number(l?.tasa_iva);
  return Number.isFinite(t) && t >= 0 ? t : IVA_GENERAL;
}

/**
 * Desglose de la venta. Los precios de venta llevan el impuesto incluido, asi
 * que se separa hacia atras: base = importe / (1 + tasa).
 */
function desglosar(lineas) {
  let total = 0, base = 0, impuesto = 0;
  for (const l of lineas || []) {
    const qty = Number(l.quantity ?? l.qty ?? 0);
    const unit = Number(l.unitary_price ?? l.price ?? 0);
    const importe = Number(l.line_total ?? l.subtotal ?? (qty * unit)) || 0;
    const tasa = tasaDeLinea(l);
    const b = importe / (1 + tasa);
    total += importe;
    base += b;
    impuesto += importe - b;
  }
  return { total, base, impuesto };
}

/** Una fila de producto. En 58 mm el nombre necesita su propia linea. */
function filaProducto(l) {
  const qty = Number(l.quantity ?? l.qty ?? 0);
  const unit = Number(l.unitary_price ?? l.price ?? 0);
  const importe = Number(l.line_total ?? l.subtotal ?? (qty * unit)) || 0;
  const nombre = String(l.nombre ?? l.product_name ?? l.product ?? '').trim() || '—';
  const uom = String(l.base_uom ?? '').trim();
  // "2 x $45.00" dice mas que dos columnas sueltas, y cabe en papel estrecho.
  const cantidad = Number.isInteger(qty) ? String(qty) : String(qty);
  const detalle = `${cantidad}${uom && uom !== 'pza' ? ' ' + esc(uom) : ''} x $${dinero(unit)}`;

  const extras = [];
  if (l.modifiers) extras.push(esc(String(l.modifiers)));
  if (l.note) extras.push(esc(String(l.note)));

  return `
      <tr>
        <td>
          <div class="nombre">${esc(nombre)}</div>
          <div class="detalle num">${detalle}</div>
          ${extras.map(e => `<div class="extra">${e}</div>`).join('')}
        </td>
        <td class="r importe num">$${dinero(importe)}</td>
      </tr>`;
}

/** Etiqueta legible de la forma de pago. */
function etiquetaPago(metodo) {
  const m = String(metodo || '').toUpperCase();
  const mapa = {
    EFECTIVO: 'Efectivo', TARJETA: 'Tarjeta', TRANSFERENCIA: 'Transferencia',
    CREDITO: 'Crédito', MIXTO: 'Mixto',
  };
  return mapa[m] || (metodo ? String(metodo) : '—');
}

/**
 * @param {object} header  cabecera de sp_get_sale_ticket
 * @param {Array}  lineas  partidas de sp_get_sale_ticket
 * @param {object} extras  { plantilla, paperWidthMm, negocio, logoUrl, pagado, cambio, payment_method, fecha }
 */
function construirTicketHtml(header, lineas, extras = {}) {
  const plantilla = String(extras.plantilla || '');
  const ancho = Number(extras.paperWidthMm) > 0 ? Number(extras.paperWidthMm) : 58;
  const negocio = extras.negocio || {};

  const { total, base, impuesto } = desglosar(lineas);

  const pagado = extras.pagado != null ? Number(extras.pagado)
               : (header?.paid_amount != null ? Number(header.paid_amount) : total);
  const cambio = extras.cambio != null ? Number(extras.cambio) : (pagado - total);
  const metodo = extras.payment_method ?? header?.payment_method ?? '';
  const esEfectivo = String(metodo).toUpperCase() === 'EFECTIVO';

  // --- cabecera del negocio ---
  const logo = extras.logoUrl
    ? `<img class="logo" src="${esc(extras.logoUrl)}" alt="">`
    : '';

  const datosNegocio = [negocio.address, negocio.phone ? 'Tel. ' + negocio.phone : '',
                        negocio.rfc ? 'RFC ' + negocio.rfc : '']
    .map(t => String(t || '').trim()).filter(Boolean).map(esc).join('<br>');

  // --- datos de la venta ---
  const meta = [];
  if (header?.cashier) meta.push(['Atendió', header.cashier]);
  if (header?.register_name) meta.push(['Caja', header.register_name]);
  if (header?.customer_name) meta.push(['Cliente', header.customer_name]);
  if (header?.service_mode) {
    meta.push(['Servicio', header.service_mode === 'DINE_IN' ? 'Para tomar aquí' : 'Para llevar']);
  }
  const metaHtml = meta
    .map(([k, v]) => `<div><span>${esc(k)}</span><span>${esc(v)}</span></div>`)
    .join('\n    ');

  // --- totales ---
  const totales = [];
  totales.push(`<div><span>Subtotal</span><span class="num">$${dinero(base)}</span></div>`);
  // Un negocio que no cobra impuesto no necesita una linea de impuesto en 0.
  if (impuesto > 0.004) {
    totales.push(`<div><span>IVA incluido</span><span class="num">$${dinero(impuesto)}</span></div>`);
  }
  totales.push(`<div class="grande"><span>TOTAL</span><span class="num">$${dinero(total)}</span></div>`);
  totales.push(`<div><span>${esc(etiquetaPago(metodo))}</span><span class="num">$${dinero(esEfectivo ? pagado : total)}</span></div>`);
  // Recibido y cambio solo tienen sentido en efectivo.
  if (esEfectivo && cambio > 0.004) {
    totales.push(`<div class="b"><span>Cambio</span><span class="num">$${dinero(cambio)}</span></div>`);
  }
  if (header?.balance != null && Number(header.balance) > 0.004) {
    totales.push(`<div class="b"><span>Saldo pendiente</span><span class="num">$${dinero(header.balance)}</span></div>`);
  }

  const pie = String(negocio.ticket_footer || '').trim();

  return plantilla
    .replaceAll('{{PAPER_W}}', String(ancho))
    .replaceAll('{{LOGO_BLOCK}}', logo)
    .replaceAll('{{BUSINESS_NAME}}', esc(negocio.business_name || ''))
    .replaceAll('{{BUSINESS_LINES}}', datosNegocio)
    .replaceAll('{{FOLIO}}', esc(String(header?.id ?? header?.sale_id ?? '')))
    .replaceAll('{{DATE}}', esc(String(extras.fecha ?? header?.datee ?? '')))
    .replaceAll('{{META_EXTRA}}', metaHtml)
    .replaceAll('{{ROWS}}', (lineas || []).map(filaProducto).join(''))
    .replaceAll('{{TOTALES}}', totales.join('\n    '))
    .replaceAll('{{FOOTER}}', pie ? `<div class="gracias">${esc(pie)}</div>` : '');
}

module.exports = { construirTicketHtml, desglosar, tasaDeLinea, etiquetaPago };
