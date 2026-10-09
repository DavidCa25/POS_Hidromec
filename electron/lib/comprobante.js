/** Perfil compartido por visor, PDF e impresión; datos siempre escapados. */
const { construirTicketHtml } = require("./ticket");
const fields = {
  sale: [
    "logo",
    "business",
    "meta",
    "items",
    "discount",
    "tax",
    "payments",
    "footer",
  ],
  closure: [
    "identity",
    "sales",
    "payments",
    "cash",
    "refunds",
    "discount",
    "tax",
    "declaration",
    "signature",
  ],
};
const esc = (v) =>
  String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
const money = (v) => "$" + Number(v ?? 0).toFixed(2);
function perfil(input = {}, doc = "sale") {
  const p = {
    format: "roll",
    width: 80,
    height: 0,
    margin: 3,
    fields: doc === "closure" ? ["identity", "sales"] : fields.sale,
    ...input,
  };
  if (
    !["roll", "sheet", "label"].includes(p.format) ||
    !Number.isFinite(p.width) ||
    p.width < 30 ||
    p.width > 300 ||
    !Number.isFinite(p.height) ||
    p.height < 0 ||
    p.height > 600 ||
    !Number.isFinite(p.margin) ||
    p.margin < 0 ||
    p.margin > 15 ||
    p.margin * 2 >= p.width ||
    !Array.isArray(p.fields) ||
    p.fields.some((x) => !fields[doc]?.includes(x)) ||
    new Set(p.fields).size !== p.fields.length
  )
    throw Error("Formato de comprobante inválido.");
  if (p.format !== "roll" && !p.height)
    throw Error("Indica el alto del papel fijo.");
  return p;
}
function aplicarPerfil(html, p) {
  return html.replace(
    "</style>",
    `\n@page{size:${p.width}mm ${p.height ? p.height + "mm" : "auto"};margin:0}body{width:${p.width}mm;padding:${p.margin}mm;box-sizing:border-box} .items tr{break-inside:avoid} .block{break-inside:avoid}\n</style>`,
  );
}
function venta(header, lines, extras, p) {
  p = perfil(p, "sale");
  let html = construirTicketHtml(header, lines, {
    ...extras,
    paperWidthMm: p.width,
    fields: p.fields,
  });
  if (!p.fields.includes("items"))
    html = html.replace(/<table class="items">[\s\S]*?<\/table>/, "");
  return aplicarPerfil(html, p);
}
function corte(data, p, business = {}) {
  p = perfil(p, "closure");
  const row = (label, value) =>
    `<div class="row"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
  const blocks = {
    identity: `<h1>${esc(business.business_name || "Wybix")}</h1><p>CORTE ${data.closed_at ? "CERRADO" : "EN CURSO"} · #${esc(data.id)}</p><p>${esc(data.register_name)} · ${esc(data.cashier)}</p><p>${esc(data.opened_at)}${data.closed_at ? " — " + esc(data.closed_at) : ""}</p>`,
    sales:
      row("Ventas", data.tickets + " tickets") +
      `<div class="total">${row("TOTAL VENDIDO", money(data.total))}</div>`,
    payments: (data.payments ?? [])
      .map((x) => row(x.payment_method, money(x.amount)))
      .join(""),
    cash:
      row("Fondo inicial", money(data.opening_cash)) +
      row("Entradas", money(data.cash_in)) +
      row("Salidas", money(data.cash_out)),
    refunds: row("Devoluciones", money(data.refunds)),
    discount: row("Descuentos", money(data.discount)),
    tax: row(
      "Impuestos incluidos",
      data.tax == null ? "No disponible" : money(data.tax),
    ),
    declaration:
      row("Efectivo esperado", money(data.cash_expected)) +
      row(
        "Efectivo entregado",
        data.closed_at ? money(data.cash_delivered) : "Pendiente",
      ) +
      row("Diferencia", data.closed_at ? money(data.difference) : "Pendiente"),
    signature:
      '<p class="signature">________________________<br>Firma del cajero</p>',
  };
  return aplicarPerfil(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Corte</title><style>body{font:12px Arial;color:#000;background:#fff;margin:0}h1{font-size:16px;text-align:center;margin:0 0 5px}p{font-size:11px;text-align:center;margin:4px 0;overflow-wrap:anywhere}.block{padding:8px 0;border-bottom:1px dashed #888}.row{display:flex;justify-content:space-between;gap:10px;padding:3px 0}.row b{font:600 12px Consolas,monospace;white-space:nowrap}.total .row{font-weight:bold;font-size:15px}.total b{font-size:15px}.signature{margin-top:20px}</style></head><body>${p.fields.map((k) => `<section class="block">${blocks[k]}</section>`).join("")}</body></html>`,
    p,
  );
}
module.exports = { perfil, fields, venta, corte };
