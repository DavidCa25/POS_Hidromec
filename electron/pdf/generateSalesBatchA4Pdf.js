const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const puppeteer = require("puppeteer");

function ensureReportsDir() {
  const dir = path.join(app.getPath("documents"), "TicketsPOS", "ReportesVentas");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(n) {
  const x = Number(n);
  return (Number.isFinite(x) ? x : 0).toFixed(2);
}

function buildBatchHtml(docs, meta, cfg) {
  const titleRange =
    meta?.start_date && meta?.end_date
      ? `${esc(meta.start_date)} a ${esc(meta.end_date)}`
      : "—";

  const blocks = docs.map((doc, idx) => {
    const h = doc.header || {};
    const lines = doc.lines || [];

    const rows = lines.map(l => {
      const qty  = Number(l.quantity ?? l.qty ?? 0);
      const unit = Number(l.unitary_price ?? l.price ?? l.unit_price ?? 0);
      const name = esc(l.nombre ?? l.product_name ?? l.product ?? "—");
      const sub  = Number(l.subtotal ?? (qty * unit) ?? 0);

      return `
        <tr>
          <td>${name}</td>
          <td class="r">${qty}</td>
          <td class="r">$${money(unit)}</td>
          <td class="r">$${money(sub)}</td>
        </tr>`;
    }).join("");

    const subtotal = lines.reduce((a, l) => {
      const qty  = Number(l.quantity ?? l.qty ?? 0);
      const unit = Number(l.unitary_price ?? l.price ?? l.unit_price ?? 0);
      const sub  = Number(l.subtotal ?? (qty * unit) ?? 0);
      return a + (Number.isFinite(sub) ? sub : 0);
    }, 0);

    const iva = subtotal * 0.16;
    const total = Number(h.total ?? subtotal);

    return `
      <section class="sale ${idx ? "pb" : ""}">
        <div class="saleHead">
          <div>
            <div class="saleTitle">Venta #${esc(h.id ?? h.sale_id ?? "")}</div>
            <div class="muted">${esc(h.datee ?? h.date ?? h.created_at ?? "")}</div>
            <div class="muted">Cliente: ${esc(h.customer_name ?? "MOSTRADOR")}</div>
          </div>
          <div class="rightBox">
            <div class="muted">Método</div>
            <div class="strong">${esc(h.payment_method ?? "")}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Producto</th>
              <th class="r">Cant.</th>
              <th class="r">Precio</th>
              <th class="r">Importe</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>

        <div class="totals">
          <div class="row"><span>Subtotal</span><span>$${money(subtotal)}</span></div>
          <div class="row"><span>IVA</span><span>$${money(iva)}</span></div>
          <div class="row big"><span>Total</span><span>$${money(total)}</span></div>
        </div>
      </section>
    `;
  }).join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family: Arial, sans-serif; color:#111; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; }
  .brand { font-weight:800; font-size:16px; }
  .muted { color:#666; font-size:12px; margin-top:2px; }
  .strong { font-weight:800; }
  hr { border:none; border-top:1px solid #e5e5e5; margin:12px 0; }
  .sale { page-break-inside: avoid; }
  .sale.pb { margin-top: 18px; }
  .saleHead { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
  .saleTitle { font-weight:800; }
  .rightBox { text-align:right; min-width: 160px; }
  table { width:100%; border-collapse:collapse; margin-top:10px; font-size:12px; }
  thead th { background:#f5f5f5; border-bottom:1px solid #ddd; padding:7px; text-align:left; }
  tbody td { border-bottom:1px solid #eee; padding:7px; vertical-align:top; }
  .r { text-align:right; white-space:nowrap; }
  .totals { margin-top:10px; display:flex; flex-direction:column; align-items:flex-end; gap:4px; font-size:12px; }
  .totals .row { width:260px; display:flex; justify-content:space-between; }
  .totals .big { font-size:14px; font-weight:900; border-top:1px solid #eee; padding-top:6px; margin-top:6px; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">${esc(cfg?.business_name || "REPORTE DE VENTAS")}</div>
      <div class="muted">${esc(cfg?.address || "")}</div>
      <div class="muted">Rango: ${titleRange}</div>
    </div>
    <div style="text-align:right">
      <div class="muted">Generado</div>
      <div class="strong">${new Date().toLocaleString("es-MX")}</div>
    </div>
  </div>
  <hr />
  ${blocks}
</body>
</html>`;
}

async function generateSalesBatchA4Pdf(docs, opts = {}) {
  const cfg = opts.businessConfig || {};
  const outDir = ensureReportsDir();
  const fileName = `reporte_ventas_${Date.now()}.pdf`;
  const outPath = path.join(outDir, fileName);

  const html = buildBatchHtml(docs, opts, cfg);

  const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();

    page.setDefaultNavigationTimeout(0);
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    await page.pdf({
      path: outPath,
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" },
    });

    return outPath;
  } finally {
    await browser.close();
  }
}

module.exports = { generateSalesBatchA4Pdf };
