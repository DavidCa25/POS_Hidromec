/* sp_mesero_cuenta
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0097 · LA CUENTA QUE LLEVA UN MESERO EN EL TURNO.

   Lo que cobró en los turnos abiertos (o en @closure_id):

   1  resumen: mesas cobradas, total, por método, propinas (y cuánto de ellas
      en efectivo), efectivo que entró a su bolsa, lo que ya entregó, lo que
      le falta entregar y la diferencia de sus entregas (− le faltó).
   2  sus cobros, del más reciente al primero: hora, mesa, método, total y
      propina.
   3  sus entregas. */
CREATE OR ALTER PROCEDURE dbo.sp_mesero_cuenta
    @mesero_id INT,
    @closure_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT c.* INTO #c
      FROM dbo.mesero_cobros c
      JOIN dbo.cash_closures z ON z.id = c.closure_id
     WHERE c.mesero_id = @mesero_id
       AND ((@closure_id IS NULL AND z.closed_at IS NULL) OR c.closure_id = @closure_id);

    SELECT e.* INTO #e
      FROM dbo.mesero_entregas e
      JOIN dbo.cash_closures z ON z.id = e.closure_id
     WHERE e.mesero_id = @mesero_id
       AND ((@closure_id IS NULL AND z.closed_at IS NULL) OR e.closure_id = @closure_id);

    SELECT @mesero_id AS mesero_id,
           (SELECT usuario FROM dbo.users WHERE id = @mesero_id) AS usuario,
           (SELECT COUNT(*) FROM #c) AS mesas,
           CAST(ISNULL((SELECT SUM(total) FROM #c), 0) AS DECIMAL(12, 2)) AS cobrado,
           CAST(ISNULL((SELECT SUM(total) FROM #c WHERE metodo = 'EFECTIVO'), 0) AS DECIMAL(12, 2)) AS en_efectivo,
           CAST(ISNULL((SELECT SUM(total) FROM #c WHERE metodo = 'TARJETA'), 0) AS DECIMAL(12, 2)) AS con_tarjeta,
           CAST(ISNULL((SELECT SUM(total) FROM #c WHERE metodo = 'TRANSFERENCIA'), 0) AS DECIMAL(12, 2)) AS por_transferencia,
           CAST(ISNULL((SELECT SUM(total) FROM #c WHERE metodo NOT IN ('EFECTIVO', 'TARJETA', 'TRANSFERENCIA')), 0) AS DECIMAL(12, 2)) AS otros,
           CAST(ISNULL((SELECT SUM(propina) FROM #c), 0) AS DECIMAL(12, 2)) AS propinas,
           CAST(ISNULL((SELECT SUM(propina) FROM #c WHERE propina_metodo = 'EFECTIVO'), 0) AS DECIMAL(12, 2)) AS propinas_efectivo,
           CAST(ISNULL((SELECT SUM(efectivo) FROM #c), 0) AS DECIMAL(12, 2)) AS en_bolsa,
           CAST(ISNULL((SELECT SUM(entregado) FROM #e), 0) AS DECIMAL(12, 2)) AS entregado,
           CAST(ISNULL((SELECT SUM(efectivo) FROM #c), 0) - ISNULL((SELECT SUM(esperado) FROM #e), 0) AS DECIMAL(12, 2)) AS por_entregar,
           CAST(ISNULL((SELECT SUM(diferencia) FROM #e), 0) AS DECIMAL(12, 2)) AS diferencia;

    SELECT c.sale_id, c.cuenta_id, c.cobrado_en, c.metodo, c.total, c.propina, c.propina_metodo, c.efectivo,
           COALESCE(m.nombre, h.etiqueta, CONCAT(N'Venta ', c.sale_id)) AS mesa
      FROM #c c
      LEFT JOIN dbo.hosp_cuentas h ON h.id = c.cuenta_id
      LEFT JOIN dbo.salon_mesas m ON m.id = h.mesa_id
     ORDER BY c.cobrado_en DESC;

    SELECT id, esperado, entregado, diferencia, entregado_en, nota FROM #e ORDER BY entregado_en DESC;
END;
GO
