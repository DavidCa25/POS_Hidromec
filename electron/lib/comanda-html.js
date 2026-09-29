/**
 * LA COMANDA EN PAPEL.
 *
 * Lo mismo que ensena el KDS, para la estacion que trabaja con impresora:
 * numero grande, para quien es, la hora, y cada linea con sus opciones y su
 * nota. En una cocina el papel se lee a un metro y con las manos ocupadas,
 * asi que la cantidad y el nombre van en negrita y grandes, y nada mas
 * compite con ellos.
 *
 * Funcion pura: recibe los datos ya leidos y devuelve HTML. Se prueba sin
 * impresora.
 */

const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function hora(fecha) {
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function cantidad(n) {
  const x = Number(n);
  return Number.isInteger(x) ? String(x) : x.toFixed(2).replace(/\.?0+$/, '');
}

/**
 * @param {object} c       comanda: { id, estacion, destino, area, creada_en }
 * @param {Array}  lineas  [{ id, nombre, cantidad, nota }]
 * @param {Array}  opciones [{ linea_id, option_name, quantity }]
 * @param {object} op      { anchoMm, reimpresion }
 */
function comandaHtml(c, lineas = [], opciones = [], { anchoMm = 58, reimpresion = false } = {}) {
  const ancho = Number(anchoMm) >= 80 ? 72 : 48;
  const filas = lineas.map((l) => {
    const ops = opciones.filter(o => o.linea_id === l.id)
      .map(o => `<div class="op">- ${o.quantity > 1 ? `${esc(o.quantity)}× ` : ''}${esc(o.option_name)}</div>`)
      .join('');
    const nota = l.nota ? `<div class="nota">» ${esc(l.nota)}</div>` : '';
    return `<div class="ln"><b>${esc(cantidad(l.cantidad))}</b> ${esc(l.nombre)}</div>${ops}${nota}`;
  }).join('');

  const destino = [c.destino, c.area].filter(Boolean).map(esc).join(' · ');

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { margin: 0; }
    body { margin: 0; padding: 2mm; width: ${ancho}mm; font-family: Arial, Helvetica, sans-serif; color: #000; }
    .est { font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    .num { font-size: 26px; font-weight: 800; line-height: 1.1; margin: 1mm 0; }
    .dest { font-size: 17px; font-weight: 700; }
    .hora { font-size: 12px; margin-bottom: 2mm; }
    .re { font-size: 12px; font-weight: 700; border: 1px solid #000; padding: 1px 4px; display: inline-block; margin-bottom: 1mm; }
    hr { border: 0; border-top: 1px dashed #000; margin: 2mm 0; }
    .ln { font-size: 17px; margin-top: 1.5mm; }
    .op { font-size: 14px; padding-left: 5mm; }
    .nota { font-size: 14px; padding-left: 5mm; font-style: italic; }
  </style></head><body>
    <div class="est">${esc(c.estacion)}</div>
    ${reimpresion ? '<div class="re">REIMPRESIÓN</div>' : ''}
    <div class="num">Comanda #${esc(c.id)}</div>
    <div class="dest">${destino}</div>
    <div class="hora">${esc(hora(c.creada_en))}</div>
    <hr>
    ${filas}
    <hr>
  </body></html>`;
}

module.exports = { comandaHtml };
