/**
 * TICKETS DE PRUEBA CON VERDAD CONOCIDA.
 *
 *     node scripts/pruebas/compras-documentos/generar-tickets.cjs
 *
 * Arma tickets como los que llegan a una tienda (mayorista, nota de
 * distribuidor con cajas y envases, abarrotera con IEPS) y los fotografía en
 * dos versiones: limpia y «de celular» (chueca, borrosa, desteñida). Junto a
 * cada imagen deja `<nombre>.json` con lo que el lector debe sacar.
 *
 * Los nombres de negocio son inventados. Las reglas fiscales son las de 2026:
 * IVA 16% o 0% (alimentos básicos), IEPS 8% a botanas de alta densidad
 * calórica y $3.0818 por litro a bebidas azucaradas (DOF, LIEPS 2026).
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const OUT = path.join(__dirname, 'tickets');
fs.mkdirSync(OUT, { recursive: true });
const $ = (n) => n.toFixed(2);

/* Cada renglón: descripción como sale en el ticket, cantidad, unidad/presentación,
   precio unitario, IVA (0 | 0.16), IEPS (tasa o null). */
const TICKETS = [
  {
    id: 'mayorista',
    proveedor: 'MAYORISTA DEL BAJIO SA DE CV', rfc: 'MBA0512153K9', folio: 'T-48213', fecha: '04/11/2026 10:42',
    lineas: [
      ['ACEITE VEGETAL 1L CJ12', 2, 'CJ', 412.80, 0, null, 12],
      ['ARROZ SUPER EXTRA 1KG', 10, 'PZA', 28.50, 0, null, 1],
      ['DETERGENTE POLVO 1KG CJ10', 1, 'CJ', 389.00, 0.16, null, 10],
      ['PAPEL HIG 4R PAQ12', 3, 'PAQ', 96.90, 0.16, null, 12],
      ['FRIJOL NEGRO 900G', 12, 'PZA', 31.20, 0, null, 1],
      ['ATUN EN AGUA 140G PAQ4', 6, 'PAQ', 74.00, 0, null, 4],
    ],
    estilo: 'termico',
  },
  {
    id: 'distribuidor-refrescos',
    proveedor: 'DISTRIBUIDORA REFRESQUERA DEL CENTRO', rfc: 'DRC9807224A1', folio: 'NR 001-77412', fecha: '05/11/2026',
    lineas: [
      ['REF COLA 600ML NR CJ24', 3, 'CJ', 312.00, 0.16, 'litro', 24, 0.6],
      ['REF NARANJA 2L PET CJ8', 2, 'CJ', 198.40, 0.16, 'litro', 8, 2],
      ['AGUA NATURAL 1L CJ12', 2, 'CJ', 96.00, 0.16, null, 12],
      ['REF COLA 500ML VID RET CJ24', 1, 'CJ', 264.00, 0.16, 'litro', 24, 0.5],
    ],
    envases: { cantidad: 24, deposito: 4.0 },
    descuento: 45.0,
    estilo: 'nota',
  },
  {
    id: 'abarrotera-ieps',
    proveedor: 'ABARROTERA LA ESTRELLA', rfc: 'AES1103187T2', folio: '0005513', fecha: '03/11/2026 18:05',
    lineas: [
      ['PAPAS FRITAS SAL 45G', 20, 'PZA', 14.20, 0.16, 0.08, 1],
      ['GALLETA CHOC 6PZ', 12, 'PAQ', 19.80, 0.16, 0.08, 6],
      ['AZUCAR ESTANDAR 1KG', 10, 'KG', 27.90, 0, null, 1],
      ['JAMON PAVO', 1.35, 'KG', 142.00, 0, null, 1],
      ['CERILLOS CAJA 50', 10, 'PZA', 4.50, 0.16, null, 1],
    ],
    estilo: 'termico',
  },
];

function calcular(t) {
  let subtotal = 0, iva = 0, ieps = 0;
  const lineas = t.lineas.map(([desc, cant, um, precio, tasaIva, ieps0, factor, litros]) => {
    const importe = +(cant * precio).toFixed(2);
    let iepsLinea = 0;
    if (ieps0 === 'litro') iepsLinea = +(cant * factor * litros * 3.0818).toFixed(2);
    else if (typeof ieps0 === 'number') iepsLinea = +(importe * ieps0).toFixed(2);
    subtotal += importe; ieps += iepsLinea; iva += +((importe + iepsLinea) * tasaIva).toFixed(2);
    return { descripcion: desc, cantidad: cant, unidad: um, factor, precio_unitario: precio, importe, tasa_iva: tasaIva, ieps: iepsLinea };
  });
  const descuento = t.descuento || 0;
  const envases = t.envases ? +(t.envases.cantidad * t.envases.deposito).toFixed(2) : 0;
  const total = +(subtotal - descuento + ieps + iva + envases).toFixed(2);
  return { lineas, subtotal: +subtotal.toFixed(2), descuento, ieps: +ieps.toFixed(2), iva: +iva.toFixed(2), envases, total };
}

function html(t, c) {
  const termico = t.estilo === 'termico';
  const filas = c.lineas.map(l => termico
    ? `<div>${l.descripcion}</div><div class="r">${l.cantidad} ${l.unidad} x ${$(l.precio_unitario)}<span>${$(l.importe)}${l.tasa_iva ? ' A' : ' E'}</span></div>`
    : `<tr><td>${l.cantidad}</td><td>${l.unidad}</td><td>${l.descripcion}</td><td class="n">${$(l.precio_unitario)}</td><td class="n">${$(l.importe)}</td></tr>`).join('');
  const tot = [
    ['SUBTOTAL', c.subtotal], ...(c.descuento ? [['DESCUENTO', -c.descuento]] : []),
    ...(c.ieps ? [['IEPS', c.ieps]] : []), ['IVA 16%', c.iva], ...(c.envases ? [['DEPOSITO ENVASE', c.envases]] : []), ['TOTAL', c.total],
  ].map(([k, v]) => `<div class="t"><b>${k}</b><span>${v < 0 ? '-' : ''}${$(Math.abs(v))}</span></div>`).join('');
  return `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#fff} .p{width:${termico ? 380 : 620}px;padding:22px 20px;font:${termico ? 15 : 14}px/1.35 ${termico ? "'Courier New',monospace" : 'Arial,sans-serif'};color:#111}
    h1{font-size:${termico ? 16 : 18}px;margin:0;text-align:center} .c{text-align:center} .r{display:flex;justify-content:space-between;padding-left:14px}
    .t{display:flex;justify-content:space-between;margin-top:2px} hr{border:0;border-top:1px dashed #333}
    table{width:100%;border-collapse:collapse} td,th{border-bottom:1px solid #999;padding:3px 4px;text-align:left} .n{text-align:right}
  </style><div class="p"><h1>${t.proveedor}</h1><div class="c">RFC ${t.rfc}</div><div class="c">${termico ? 'TICKET' : 'NOTA DE REMISION'} ${t.folio}</div><div class="c">FECHA ${t.fecha}</div><hr>
  ${termico ? filas : `<table><tr><th>CANT</th><th>UM</th><th>DESCRIPCION</th><th class="n">P.UNIT</th><th class="n">IMPORTE</th></tr>${filas}</table>`}
  <hr>${tot}${c.envases ? `<div class="c" style="margin-top:6px">ENVASES ENTREGADOS ${t.envases.cantidad}</div>` : ''}<hr><div class="c">GRACIAS POR SU COMPRA</div></div>`;
}

(async () => {
  const nav = await chromium.launch();
  const page = await nav.newPage({ deviceScaleFactor: 2 });
  for (const t of TICKETS) {
    const c = calcular(t);
    await page.setContent(html(t, c));
    const el = page.locator('.p');
    await el.screenshot({ path: path.join(OUT, `${t.id}.png`) });
    /* Versión «de celular»: chueca, borrosa, desteñida y con sombra. */
    await page.evaluate(() => {
      const p = document.querySelector('.p');
      document.body.style.cssText = 'background:#c9c3b8;padding:40px';
      p.style.cssText += ';transform:rotate(-2.2deg);filter:blur(0.6px) contrast(0.55) brightness(1.08) sepia(0.25);background:linear-gradient(110deg,#fff 60%,#ddd)';
    });
    await page.screenshot({ path: path.join(OUT, `${t.id}-foto.png`), fullPage: true });
    const verdad = { proveedor: t.proveedor, rfc: t.rfc, folio: t.folio, fecha: t.fecha, ...c };
    fs.writeFileSync(path.join(OUT, `${t.id}.json`), JSON.stringify(verdad, null, 2));
    fs.writeFileSync(path.join(OUT, `${t.id}-foto.json`), JSON.stringify(verdad, null, 2));
    console.log(t.id, 'total', c.total);
  }
  await nav.close();
})();
