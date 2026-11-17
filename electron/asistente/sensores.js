'use strict';
/**
 * SENSORES: cómo está el negocio, en forma compacta. Solo leen.
 *
 * Cada sensor lo comparten varias reglas y el motor lo ejecuta una vez por
 * pasada. Donde Wybix ya tiene la consulta, se usa ESA (sp_reorder_suggestions
 * es la definición de «se acaba»); donde no, la consulta vive aquí, chica y
 * con los mismos criterios que las pantallas:
 *
 *   ganancia   precio SIN IVA − costo, sobre el costo (como Compras y el
 *              desglose de Editar producto; utilidad de sp_get_profit_overview).
 *   receta     costo = Σ ingrediente.cost × qty_base × (1 + merma%).
 *
 * El sensor `sistema` no es SQL: lo arma el proceso principal (respaldo,
 * nube, licencia, impresora, disco) y entra por `deps.sistema()`.
 */

const r2 = (n) => Math.round(Number(n) * 100) / 100;

function crearSensores({ sql, pool, sistema = async () => ({}) }) {
  const q = async (texto, entradas = []) => {
    const req = (await pool()).request();
    for (const [n, t, v] of entradas) req.input(n, t, v);
    return (await req.query(texto)).recordset || [];
  };

  return {
    /* Lo que se acaba en ≤ 7 días (sp_reorder_suggestions, la misma lista que Alertas). */
    reorden: {
      ttlMs: 5 * 60_000,
      async leer() {
        const r = await (await pool()).request()
          .input('dias_ventana', sql.Int, 30).input('dias_alerta', sql.Int, 7).input('dias_objetivo', sql.Int, 30)
          .execute('sp_reorder_suggestions');
        return (r.recordset || []).map((x) => ({
          id: x.id, nombre: x.nombre, modo: x.inventory_mode, uom: x.base_uom || 'pza',
          stock: Number(x.stock) || 0, promDiario: Number(x.prom_diario) || 0, dias: Number(x.dias_restantes) || 0,
          sugerido: x.sugerido != null ? Number(x.sugerido) : null,
          limita: x.limita_nombre ? { nombre: x.limita_nombre, stock: Number(x.limita_stock) || 0, uom: x.limita_uom } : null,
        }));
      },
    },

    /* Precio, costo e IVA de lo que se vende. El costo de una receta sale de sus ingredientes. */
    margenes: {
      ttlMs: 10 * 60_000,
      async leer() {
        const filas = await q(`
          ;WITH receta AS (
            SELECT r.product_id,
                   SUM(rl.qty_base * (1 + rl.waste_pct / 100.0) * ISNULL(i.cost, 0)) AS costo,
                   SUM(CASE WHEN ISNULL(i.cost, 0) <= 0 THEN 1 ELSE 0 END) AS sin_costo,
                   ROW_NUMBER() OVER (PARTITION BY r.product_id ORDER BY CASE WHEN r.variant_option_id IS NULL THEN 0 ELSE 1 END, r.id) AS k
              FROM dbo.recipes r
              JOIN dbo.recipe_lines rl ON rl.recipe_id = r.id
              JOIN dbo.products i ON i.id = rl.ingredient_product_id
             WHERE r.active = 1
             GROUP BY r.product_id, r.id, r.variant_option_id
          )
          SELECT p.id, p.nombre, p.price, p.inventory_mode,
                 CASE WHEN ISNULL(p.objeto_impuesto, '02') = '02' THEN ISNULL(p.tasa_iva, 0.16) ELSE 0 END AS tasa,
                 CASE WHEN p.inventory_mode = 'RECIPE' THEN rc.costo ELSE p.cost END AS costo,
                 ISNULL(rc.sin_costo, 0) AS ingredientes_sin_costo,
                 (SELECT ISNULL(SUM(sd.quantity), 0) FROM dbo.sale_detail sd JOIN dbo.sales s ON s.id = sd.sale_id
                   WHERE sd.product_id = p.id AND s.datee >= DATEADD(DAY, -30, GETDATE())) AS vendidos_30
            FROM dbo.products p
            LEFT JOIN receta rc ON rc.product_id = p.id AND rc.k = 1
           WHERE p.active = 1 AND ISNULL(p.sellable, 1) = 1 AND p.price > 0;`);
        return filas.map((x) => {
          const precio = Number(x.price) || 0;
          const tasa = Number(x.tasa) || 0;
          const base = r2(precio / (1 + tasa));
          const costo = x.costo != null && Number(x.costo) > 0 ? Number(x.costo) : null;
          return {
            id: x.id, nombre: x.nombre, modo: x.inventory_mode, precio, tasa, base, costo,
            ganancia: costo != null ? r2(base - costo) : null,
            pctSobreCosto: costo != null && costo > 0 ? Math.round(((base - costo) / costo) * 1000) / 10 : null,
            ingredientesSinCosto: Number(x.ingredientes_sin_costo) || 0,
            vendidos30: Number(x.vendidos_30) || 0,
          };
        });
      },
    },

    /* Con existencia y sin una sola venta en N días: dinero dormido. */
    sinMovimiento: {
      ttlMs: 30 * 60_000,
      async leer() {
        return (await q(`
          SELECT p.id, p.nombre, p.stock, p.cost, p.price,
                 (SELECT MAX(s.datee) FROM dbo.sale_detail sd JOIN dbo.sales s ON s.id = sd.sale_id WHERE sd.product_id = p.id) AS ultima_venta,
                 p.registrated_date
            FROM dbo.products p
           WHERE p.active = 1 AND p.inventory_mode = 'DIRECT' AND ISNULL(p.sellable, 1) = 1 AND p.stock > 0;`))
          .map((x) => ({ id: x.id, nombre: x.nombre, stock: Number(x.stock) || 0, costo: Number(x.cost) || 0,
                         ultimaVenta: x.ultima_venta ? new Date(x.ultima_venta).toISOString() : null,
                         alta: x.registrated_date ? new Date(x.registrated_date).toISOString() : null }));
      },
    },

    /* La última compra contra la anterior, por producto: ¿subió el costo y el precio se quedó? */
    compras: {
      ttlMs: 10 * 60_000,
      async leer() {
        return (await q(`
          ;WITH c AS (
            SELECT d.product_id, d.unitary_price / NULLIF(d.factor_to_base, 0) AS costo_base, c.datee,
                   ROW_NUMBER() OVER (PARTITION BY d.product_id ORDER BY c.datee DESC, d.id DESC) AS k
              FROM dbo.purchase_detail d JOIN dbo.purchase c ON c.id = d.puchase_id
             WHERE d.unitary_price > 0 AND c.datee >= DATEADD(DAY, -120, GETDATE())
          )
          SELECT u.product_id AS id, p.nombre, p.price, p.sellable,
                 CASE WHEN ISNULL(p.objeto_impuesto, '02') = '02' THEN ISNULL(p.tasa_iva, 0.16) ELSE 0 END AS tasa,
                 u.costo_base AS costo_ultima, a.costo_base AS costo_anterior, u.datee AS fecha
            FROM c u
            JOIN c a ON a.product_id = u.product_id AND a.k = 2
            JOIN dbo.products p ON p.id = u.product_id
           WHERE u.k = 1 AND p.active = 1;`))
          .map((x) => ({ id: x.id, nombre: x.nombre, precio: Number(x.price) || 0, vendible: x.sellable !== false && x.sellable !== 0,
                         tasa: Number(x.tasa) || 0, costoUltima: Number(x.costo_ultima) || 0, costoAnterior: Number(x.costo_anterior) || 0,
                         fecha: x.fecha ? new Date(x.fecha).toISOString() : null }));
      },
    },

    /* Cortes de las últimas 2 semanas con su diferencia. */
    cortes: {
      ttlMs: 10 * 60_000,
      async leer() {
        return (await q(`
          SELECT c.id, c.create_date, c.difference, c.register_id, u.usuario
            FROM dbo.cash_closures c LEFT JOIN dbo.users u ON u.id = ISNULL(c.closed_by_user_id, c.userId)
           WHERE c.closed_at IS NOT NULL AND c.create_date >= DATEADD(DAY, -14, CAST(GETDATE() AS DATE));`))
          .map((x) => ({ id: x.id, fecha: x.create_date ? new Date(x.create_date).toISOString().slice(0, 10) : null,
                         diferencia: Number(x.difference) || 0, caja: x.register_id, usuario: x.usuario || null }));
      },
    },

    /* Lo que piden las tandas planeadas de hoy contra la existencia (sp_production_board). */
    produccion: {
      ttlMs: 5 * 60_000,
      async leer() {
        const r = await (await pool()).request().input('production_date', sql.Date, null).execute('sp_production_board');
        const [tandas = [], ingredientes = []] = r.recordsets || [];
        return {
          planeadas: tandas.filter((t) => t.status === 'PLANNED').length,
          faltan: ingredientes.filter((i) => Number(i.missing) > 0).map((i) => ({
            id: i.ingredient_product_id, nombre: i.ingredient_name, uom: i.base_uom || '',
            necesita: Number(i.needed) || 0, hay: Number(i.stock) || 0, falta: Number(i.missing) || 0,
          })),
        };
      },
    },

    /* El estado del equipo: lo arma el proceso principal. */
    sistema: { ttlMs: 60_000, leer: () => sistema() },
  };
}

module.exports = { crearSensores };
