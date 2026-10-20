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
  /* 0065: devolución (y cambio). */
  refund: ["identity", "items", "exchange", "money", "reason", "signature"],
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
    fields: doc === "closure" ? ["identity", "sales"] : doc === "refund" ? fields.refund : fields.sale,
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
        "Efectivo contado",
        data.closed_at ? money(data.cash_delivered) : "Pendiente",
      ) +
      row("Diferencia", data.closed_at ? money(data.difference) : "Pendiente") +
      /* 0056: lo que se queda fisicamente en la caja y lo que se retira. */
      (data.cash_left != null
        ? row("Se queda en caja", money(data.cash_left)) +
          row("Se retira", money(Number(data.cash_delivered) - Number(data.cash_left)))
        : "") +
      (data.closing_note
        ? `<p class="nota"><b>Notas:</b> ${esc(data.closing_note)}</p>`
        : ""),
    signature:
      '<p class="signature">________________________<br>Firma del cajero</p>',
  };
  return aplicarPerfil(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Corte</title><style>body{font:12px Arial;color:#000;background:#fff;margin:0}h1{font-size:16px;text-align:center;margin:0 0 5px}p{font-size:11px;text-align:center;margin:4px 0;overflow-wrap:anywhere}.block{padding:8px 0;border-bottom:1px dashed #888}.row{display:flex;justify-content:space-between;gap:10px;padding:3px 0}.row b{font:600 12px Consolas,monospace;white-space:nowrap}.total .row{font-weight:bold;font-size:15px}.total b{font-size:15px}.signature{margin-top:20px}.nota{text-align:left;margin-top:8px}</style></head><body>${p.fields.map((k) => `<section class="block">${blocks[k]}</section>`).join("")}</body></html>`,
    p,
  );
}
/* 0065: comprobante de devolución. Lo que se devolvió, por qué, cómo regresó
   el dinero y, si fue un cambio, lo que se llevó. */
const FORMA = { EFECTIVO: "Efectivo (del cajón)", TARJETA: "A su tarjeta", TRANSFERENCIA: "Por transferencia",
  CREDITO: "Descontado de su crédito", CAMBIO: "A cuenta del cambio", TERMINAL_MP: "Mercado Pago", PLATAFORMA: "Plataforma" };
function devolucion(d, p, business = {}) {
  p = perfil(p, "refund");
  const row = (label, value) => `<div class="row"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
  const items = (ls) => (ls ?? []).map((l) =>
    row(`${Number(l.quantity)} × ${l.nombre}`, money(Number(l.quantity) * Number(l.unitary_price)))).join("");
  const cambio = Number(d.exchange_amount || 0) > 0;
  const blocks = {
    identity: `<h1>${esc(business.business_name || "Wybix")}</h1><p>${cambio ? "CAMBIO" : "DEVOLUCIÓN"} · #${esc(d.id)}</p><p>Venta #${esc(d.sale_id)}${d.cliente ? " · " + esc(d.cliente) : ""}</p><p>${esc(d.register_name || "")} · ${esc(d.cashier || "")}</p><p>${esc(d.datee)}</p>`,
    items: `<p class="sub">SE DEVOLVIÓ</p>` + items(d.lines) + `<div class="total">${row("TOTAL DEVUELTO", money(d.total))}</div>`,
    exchange: cambio
      ? `<p class="sub">SE LLEVA A CAMBIO · VENTA #${esc(d.exchange_sale_id ?? "")}</p>` + items(d.exchange_lines) + row("Total", money(d.exchange_total))
      : "",
    money: `<p class="sub">CÓMO SE REGRESÓ</p>` + (d.payments ?? []).map((x) => row(FORMA[x.payment_method] || x.payment_method, money(x.amount))).join(""),
    reason: `<p class="nota"><b>Motivo:</b> ${esc(d.reason || "Sin motivo")}${d.note ? "<br>" + esc(d.note) : ""}</p>`,
    signature: '<p class="signature">________________________<br>Firma del cliente</p>',
  };
  return aplicarPerfil(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Devolución</title><style>body{font:12px Arial;color:#000;background:#fff;margin:0}h1{font-size:16px;text-align:center;margin:0 0 5px}p{font-size:11px;text-align:center;margin:4px 0;overflow-wrap:anywhere}.sub{text-align:left;font-weight:bold;letter-spacing:.04em;margin-top:2px}.block{padding:8px 0;border-bottom:1px dashed #888}.block:empty{display:none}.row{display:flex;justify-content:space-between;gap:10px;padding:3px 0}.row b{font:600 12px Consolas,monospace;white-space:nowrap}.total .row{font-weight:bold;font-size:14px}.signature{margin-top:20px}.nota{text-align:left}</style></head><body>${p.fields.map((k) => blocks[k] ? `<section class="block">${blocks[k]}</section>` : "").join("")}</body></html>`,
    p,
  );
}
module.exports = { perfil, fields, venta, corte, devolucion };
