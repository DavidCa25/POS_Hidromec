/*
 * REPORTES CONTABLES (0062).
 *
 *   reportes:estado-resultados  ventas - costo congelado - mermas - egresos
 *                               de un periodo, contra el periodo anterior.
 *                               0069: menos lo que descontaron las plataformas
 *                               (liquidaciones confirmadas) y por canal.
 *
 * Todo el cálculo vive en sp_income_statement: aquí solo se validan las
 * fechas y se nombran los resultados.
 */
const sesion = require("../seguridad/sesion");

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
/* mssql entrega un DATE como medianoche UTC: su parte ISO es la fecha. */
const iso = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? null : String(v).slice(0, 10));
const num = (v) => (v == null ? null : Number(v));
const numeros = (fila) => Object.fromEntries(Object.entries(fila).map(([k, v]) => [k, typeof v === "number" || v == null || typeof v === "boolean" ? v : k === "dia" || k === "desde" || k === "hasta" ? iso(v) : typeof v === "string" ? v : num(v)]));

function registrar({ ipcMain, sql, poolPromise }) {
  ipcMain.handle(
    "reportes:estado-resultados",
    sesion.proteger("reportes:estado-resultados", async (_e, p = {}) => {
      try {
        const desde = p.desde ? String(p.desde) : null, hasta = p.hasta ? String(p.hasta) : null;
        if ((desde && !FECHA.test(desde)) || (hasta && !FECHA.test(hasta))) throw Error("Indica fechas válidas.");
        const pool = await poolPromise;
        const r = await pool.request()
          .input("desde", sql.Date, desde)
          .input("hasta", sql.Date, hasta)
          .execute("sp_income_statement");
        const [resumen = [], egresos = [], categorias = [], dias = [], productos = [], perdidas = [], canales = []] = r.recordsets;
        const fila = (x) => (x ? numeros(x) : null);
        return {
          success: true,
          data: {
            actual: fila(resumen.find((x) => x.periodo === "ACTUAL")),
            anterior: fila(resumen.find((x) => x.periodo === "ANTERIOR")),
            egresos: egresos.map(numeros),
            categorias: categorias.map(numeros),
            dias: dias.map(numeros),
            productos: productos.map(numeros),
            perdidas: perdidas.map(numeros),
            /* 0069: utilidad por canal, con lo que descontaron las plataformas. */
            canales: canales.map(numeros),
          },
        };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }),
  );
}

module.exports = { registrar };
