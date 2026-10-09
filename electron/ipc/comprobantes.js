const fs = require("node:fs");
const crypto = require("node:crypto");
const sesion = require("../seguridad/sesion");
const permisos = require("../seguridad/permisos");
function registrar({
  ipcMain,
  sql,
  poolPromise,
  receiptProfile,
  ensureBusinessConfig,
  loadDeviceConfig,
  buildTicketHtmlFromTemplate,
  loadSaleFromDbWithSp,
  generateSaleTicketPdf,
  cloudSync,
  imprimirHtml,
}) {
  async function receiptDocument(p, ses) {
    const doc = p.document === "closure" ? "closure" : "sale",
      profile = receiptProfile(doc, p.profile);
    const businessConfig = await ensureBusinessConfig();
    if (p.sample) {
      const sample =
        doc === "sale"
          ? buildTicketHtmlFromTemplate(
              {
                id: "VISTA PREVIA",
                datee: new Date(),
                payment_method: "MIXTO",
                payments_json: JSON.stringify([
                  { payment_method: "EFECTIVO", amount: 30, received: 50 },
                  { payment_method: "TARJETA", amount: 29 },
                ]),
              },
              [
                {
                  nombre: "Producto de ejemplo",
                  quantity: 1,
                  unitary_price: 59,
                  tasa_iva: 0.16,
                  objeto_impuesto: "02",
                },
              ],
              { profile },
            )
          : require("../lib/comprobante").corte(
              {
                id: "EJEMPLO",
                closed_at: "07/10/2026 20:00",
                opened_at: "07/10/2026 08:00",
                register_name: "Caja de ejemplo",
                cashier: "Ejemplo",
                tickets: 12,
                total: 1250,
                payments: [
                  { payment_method: "EFECTIVO", amount: 750 },
                  { payment_method: "TARJETA", amount: 500 },
                ],
                opening_cash: 200,
                cash_expected: 950,
                cash_delivered: 950,
                difference: 0,
              },
              profile,
              businessConfig,
            );
      return { html: sample, profile };
    }
    const id = Number(p.id);
    if (!Number.isSafeInteger(id) || id < 1)
      throw Error("Indica el comprobante.");
    const pool = await poolPromise;
    if (doc === "sale") {
      const result = await pool
        .request()
        .input("sale_id", sql.Int, id)
        .execute("sp_get_sale_ticket");
      if (!result.recordsets?.[0]?.length) throw Error("No existe esa venta.");
      return {
        html: buildTicketHtmlFromTemplate(
          result.recordsets[0][0],
          result.recordsets[1] || [],
          { profile },
        ),
        profile,
      };
    }
    const result = await pool
      .request()
      .input("closure_id", sql.Int, id)
      .execute("sp_cash_closure_ticket");
    const data = JSON.parse(result.recordset[0].document_json);
    if (
      !data.closed_at ||
      (Number(data.userId) !== sesion.actorDe(ses) &&
        !ses.permisos.has(permisos.BUNDLES.VENTAS_SUPERVISAR))
    )
      throw Error(
        "Puedes imprimir tu corte cerrado; un encargado puede consultar otros cortes.",
      );
    return {
      html: require("../lib/comprobante").corte(data, profile, businessConfig),
      profile,
    };
  }
  ipcMain.handle(
    "ticket:closures",
    sesion.proteger("ticket:closures", async (_e, p = {}, ses) => {
      try {
        const pool = await poolPromise;
        const rows = await pool
          .request()
          .input("actor", sql.Int, sesion.actorDe(ses))
          .input(
            "all",
            sql.Bit,
            ses.permisos.has(permisos.BUNDLES.VENTAS_SUPERVISAR),
          )
          .input("register", sql.Int, Number(p.registerId) || null)
          .query(
            "SELECT TOP 50 c.id,c.closed_at,r.name register_name FROM dbo.cash_closures c LEFT JOIN dbo.registers r ON r.id=c.register_id WHERE c.closed_at IS NOT NULL AND (@all=1 OR c.userId=@actor) AND (@register IS NULL OR c.register_id=@register) ORDER BY c.closed_at DESC,c.id DESC",
          );
        return { success: true, data: rows.recordset };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }),
  );
  ipcMain.handle(
    "ticket:email",
    sesion.proteger("ticket:email", async (_e, p = {}) => {
      try {
        const saleId = Number(p.saleId),
          email = String(p.email || "")
            .trim()
            .toLowerCase();
        if (
          !Number.isSafeInteger(saleId) ||
          saleId < 1 ||
          email.length > 254 ||
          !/^\S+@\S+\.\S+$/.test(email)
        )
          throw Error("Indica un correo válido y una venta.");
        const pool = await poolPromise;
        let job = (
          await pool
            .request()
            .input("sale", sql.Int, saleId)
            .input("email", sql.NVarChar(254), email)
            .query(
              "SELECT id,pdf,sent_at,created_at FROM dbo.ticket_email_jobs WHERE sale_id=@sale AND recipient=@email",
            )
        ).recordset[0];
        if (job?.sent_at) return { success: true, accepted: true };
        if (!job) {
          const { header, lines } = await loadSaleFromDbWithSp(saleId);
          if (!header) throw Error("La venta no existe.");
          const file = await generateSaleTicketPdf(header, lines),
            pdf = fs.readFileSync(file);
          if (pdf.length > 2000000)
            throw Error("El PDF supera el límite de envío.");
          job = { id: crypto.randomUUID(), pdf };
          await pool
            .request()
            .input("id", sql.UniqueIdentifier, job.id)
            .input("sale", sql.Int, saleId)
            .input("email", sql.NVarChar(254), email)
            .input("pdf", sql.VarBinary(sql.MAX), pdf)
            .query(
              "IF NOT EXISTS(SELECT 1 FROM dbo.ticket_email_jobs WITH(UPDLOCK,HOLDLOCK) WHERE sale_id=@sale AND recipient=@email) INSERT dbo.ticket_email_jobs(id,sale_id,recipient,pdf) VALUES(@id,@sale,@email,@pdf);",
            );
          job = (
            await pool
              .request()
              .input("sale", sql.Int, saleId)
              .input("email", sql.NVarChar(254), email)
              .query(
                "SELECT id,pdf FROM dbo.ticket_email_jobs WHERE sale_id=@sale AND recipient=@email",
              )
          ).recordset[0];
        }
        await cloudSync.llamarFiscal("ticket-email", {
          id: job.id,
          saleId,
          email,
          pdf: Buffer.from(job.pdf).toString("base64"),
        });
        await pool
          .request()
          .input("id", sql.UniqueIdentifier, job.id)
          .query(
            "UPDATE dbo.ticket_email_jobs SET sent_at=SYSUTCDATETIME() WHERE id=@id",
          );
        return { success: true, accepted: true };
      } catch (e) {
        return {
          success: false,
          error:
            e.message ||
            "No se confirmó el envío. El ticket queda preparado para reintentar.",
        };
      }
    }),
  );
  ipcMain.handle(
    "ticket:preview",
    sesion.proteger("ticket:preview", async (_e, p = {}, ses) => {
      try {
        return { success: true, data: await receiptDocument(p, ses) };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }),
  );
  ipcMain.handle(
    "ticket:print-document",
    sesion.proteger("ticket:print-document", async (_e, p = {}, ses) => {
      try {
        const { html, profile } = await receiptDocument(p, ses);
        const ok = await imprimirHtml(html, {
          paperWidthMm: profile.width,
          paperHeightMm: profile.height,
          format: profile.format,
          printerName:
            p.printerName || loadDeviceConfig()?.printer?.ticketPrinterName,
          silent: p.silent !== false,
        });
        if (!ok)
          throw Error(
            "La impresora no confirmó la impresión. Revisa el dispositivo y su controlador.",
          );
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }),
  );
}
module.exports = { registrar };
