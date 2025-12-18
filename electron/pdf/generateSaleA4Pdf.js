const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const puppeteer = require("puppeteer");

function ensureSalesA4Dir() {
  const dir = path.join(app.getPath("documents"), "TicketsPOS", "VentasA4");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function generateSaleA4Pdf(header, lines, extras = {}) {
  const businessConfig = extras.businessConfig || null;

  const template = fs.readFileSync(
    path.join(__dirname, "../templates/sale_a4.html"),
    "utf8"
  );

  const rowsHtml = (lines || []).map(l => {
    const qty  = Number(l.quantity ?? l.qty ?? 0);
    const unit = Number(l.unitary_price ?? l.price ?? 0);
    const nombre = (l.nombre ?? l.product_name ?? l.product ?? "").toString() || "—";
    const sub = Number(l.subtotal ?? (Number.isFinite(qty * unit) ? qty * unit : 0));

    return `
      <tr>
        <td>${nombre}</td>
        <td class="r">${qty}</td>
        <td class="r">$${unit.toFixed(2)}</td>
        <td class="r">$${sub.toFixed(2)}</td>
      </tr>`;
  }).join("");

  const subtotal = (lines || []).reduce((a, l) => {
    const qty  = Number(l.quantity ?? l.qty ?? 0);
    const unit = Number(l.unitary_price ?? l.price ?? 0);
    const sub  = Number(l.subtotal ?? (Number.isFinite(qty * unit) ? qty * unit : 0));
    return a + sub;
  }, 0);

  const iva   = subtotal * 0.16;
  const total = Number(header.total ?? subtotal);

  const pagado = extras.pagado != null ? Number(extras.pagado) : Number(header.paid_amount ?? total);
  const cambio = extras.cambio != null ? Number(extras.cambio) : (pagado - total);

  const money = (n) => Number(n || 0).toFixed(2);

  let filledHtml = template
    .replace(/{{BUSINESS_NAME}}/g, businessConfig.business_name || "")
    .replace(/{{ADDRESS}}/g,       businessConfig.address || "")
    .replace(/{{FOLIO}}/g,         String(header.id ?? header.sale_id ?? ""))
    .replace(/{{DATE}}/g,          String(header.datee ?? header.date ?? header.created_at ?? ""))
    .replace(/{{METHOD}}/g,        String(header.payment_method ?? ""))
    .replace(/{{SUBTOTAL}}/g,      money(subtotal))
    .replace(/{{IVA}}/g,           money(iva))
    .replace(/{{TOTAL}}/g,         money(total))
    .replace(/{{PAGADO}}/g,        money(pagado))
    .replace(/{{CAMBIO}}/g,        money(cambio))
    .replace(/{{ROWS}}/g,          rowsHtml);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox"],
  });

  const page = await browser.newPage();
  await page.setContent(filledHtml, { waitUntil: "networkidle0" });

  const pdfPath = path.join(ensureSalesA4Dir(), `venta_${header.id}_A4.pdf`);

  await page.pdf({
    path: pdfPath,
    format: "A4",
    printBackground: true,
    margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
  });

  await browser.close();
  return pdfPath;
}

module.exports = { generateSaleA4Pdf };
